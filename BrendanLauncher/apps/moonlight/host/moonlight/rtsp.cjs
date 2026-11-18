'use strict';
// Sunshine RTSP client: OPTIONS, DESCRIBE, SETUP (audio/video/control),
// ANNOUNCE (client SDP), PLAY. Truth source: moonlight-common-c
// src/RtspConnection.c and src/SdpGenerator.c.
//
// Sunshine 7.1.431+ speaks plain TCP RTSP (the ENet transport is only used by
// GFE builds before 404). Its session URL may be "rtspenc://", which adds
// message-level encryption this client does not implement; that case is
// rejected with an explicit error instead of failing obscurely later.

const net = require('node:net');

const DEFAULT_UA = 'moonlight-brendanlauncher/1.0';

class RtspError extends Error {}

class RtspClient {
  constructor({ host, port, url, logger = () => {}, timeoutMs = 10000, userAgent = DEFAULT_UA }) {
    this.host = host;
    this.port = port;
    this.url = url;
    this.logger = logger;
    this.timeoutMs = timeoutMs;
    this.userAgent = userAgent;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = null;
    this.cseq = 1;
    this.session = null;
  }

  async open() {
    if (this.socket) return this;
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      socket.setNoDelay(true);
      socket.setTimeout(this.timeoutMs);
      socket.once('connect', () => {
        this.socket = socket;
        resolve();
      });
      socket.once('error', reject);
      socket.once('timeout', () => reject(new RtspError('RTSP connection timed out')));
      socket.on('data', chunk => this._onData(chunk));
      socket.on('close', () => {
        this.socket = null;
        if (this.pending) {
          this.pending.reject(new RtspError('RTSP connection closed'));
          this.pending = null;
        }
      });
    });
    return this;
  }

  close() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.pending) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const head = this.buffer.subarray(0, headerEnd).toString('latin1');
      const lines = head.split('\r\n');
      const status = /^RTSP\/\d\.\d\s+(\d{3})\s*(.*)$/.exec(lines[0]);
      if (!status) {
        this.pending.reject(new RtspError(`Malformed RTSP response: ${lines[0]}`));
        this.pending = null;
        return;
      }
      const headers = {};
      for (const line of lines.slice(1)) {
        const match = /^([^:]+):\s*(.*)$/.exec(line);
        if (match) headers[match[1].toLowerCase()] = match[2];
      }
      const length = Number(headers['content-length'] || 0);
      const total = headerEnd + 4 + length;
      if (this.buffer.length < total) return;
      const body = this.buffer.subarray(headerEnd + 4, total).toString('utf8');
      this.buffer = this.buffer.subarray(total);
      const pending = this.pending;
      this.pending = null;
      pending.resolve({ status: Number(status[1]), message: status[2], headers, body });
    }
  }

  _request(method, target, headers = {}, body = '') {
    if (!this.socket) throw new RtspError('RTSP socket is not open');
    return new Promise((resolve, reject) => {
      const lines = [
        `${method} ${target} RTSP/1.0`,
        `CSeq: ${this.cseq++}`,
        `User-Agent: ${this.userAgent}`,
      ];
      for (const [key, value] of Object.entries(headers)) {
        if (value === undefined || value === null) continue;
        lines.push(`${key}: ${value}`);
      }
      if (this.session) lines.push(`Session: ${this.session}`);
      if (body) lines.push(`Content-length: ${Buffer.byteLength(body)}`);
      const payload = `${lines.join('\r\n')}\r\n\r\n${body}`;
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new RtspError(`${method} ${target} timed out`));
      }, this.timeoutMs);
      this.pending = {
        resolve: value => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.socket.write(payload);
    });
  }

  async _expect(method, target, headers, body) {
    const response = await this._request(method, target, headers, body);
    if (response.status !== 200) {
      throw new RtspError(`${method} ${target} returned ${response.status} ${response.message}`);
    }
    const session = response.headers.session;
    if (session) this.session = session.split(';')[0];
    return response;
  }

  /**
   * Full handshake.
   * @param {{width:number,height:number,fps:number,bitrateKbps:number,
   *          rikey:Buffer,rikeyId:number,packetSize?:number,videoPort:number,
   *          audioPort:number}} config
   */
  async handshake(config) {
    await this.open();
    const { width, height, fps, bitrateKbps, rikey, rikeyId, videoPort, audioPort } = config;
    const packetSize = config.packetSize || 1024;

    await this._expect('OPTIONS', this.url);
    const describe = await this._expect('DESCRIBE', this.url, {
      Accept: 'application/sdp',
      'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT',
    });
    const sdp = describe.body;
    const encryption = /a=encryption:/i.test(sdp);
    const codec = /a=rtpmap:\d+\s+H265/i.test(sdp) ? 'hevc' : 'h264';

    const transport = port => `unicast;X-GS-ClientPort=${port}-${port + 1}`;
    await this._expect('SETUP', `${this.url}/streamid=audio/0/0`, { Transport: transport(audioPort) });
    const videoSetup = await this._expect('SETUP', `${this.url}/streamid=video/0/0`, {
      Transport: transport(videoPort),
    });
    const controlSetup = await this._expect('SETUP', `${this.url}/streamid=control/13/0`, {
      Transport: transport(config.controlPort || audioPort + 2),
    });
    const connectData = Number.parseInt(controlSetup.headers['x-ss-connect-data'] || '0', 0) || 0;

    const announceSdp = buildAnnounceSdp({
      width,
      height,
      fps,
      bitrateKbps,
      packetSize,
      rikey,
      rikeyId,
      videoPort,
      audioPort,
      client: config.clientAddress || '0.0.0.0',
    });
    await this._expect(
      'ANNOUNCE',
      `${this.url}/streamid=control/13/0`,
      { 'Content-type': 'application/sdp' },
      announceSdp,
    );
    await this._expect('PLAY', `${this.url}/streamid=video/0/0`);
    await this._expect('PLAY', `${this.url}/streamid=audio/0/0`);

    return {
      sdp,
      videoPort: parseTransportPort(videoSetup.headers.transport) || videoPort,
      audioPort: parseTransportPort(videoSetup.headers.transport) ? audioPort : audioPort,
      controlPort: parseTransportPort(controlSetup.headers['x-ss-port'] || '') || 47999,
      connectData: Number.isFinite(connectData) ? connectData : 0,
      encryption,
      codec,
      pingPayload: controlSetup.headers['x-ss-ping-payload'] || null,
    };
  }

  /** TEARDOWN; safe to call after a failure. */
  async teardown() {
    if (!this.socket) return;
    try {
      await this._request('TEARDOWN', this.url);
    } catch {
      /* best effort */
    }
    this.close();
  }
}

function parseTransportPort(transport) {
  if (!transport) return 0;
  const match = /server_port=(\d+)(?:-(\d+))?/.exec(transport);
  return match ? Number(match[1]) : 0;
}

/**
 * Client-side SDP for ANNOUNCE. Mirrors the attributes moonlight-common-c's
 * SdpGenerator emits for H.264 + stereo audio, minus HDR/surround/LTR paths.
 */
function buildAnnounceSdp({
  width,
  height,
  fps,
  bitrateKbps,
  packetSize,
  rikey,
  rikeyId,
  videoPort,
  audioPort,
  client,
}) {
  // Note: no "a=encryption" attribute is announced. Sunshine only encrypts
  // payloads for clients that ask for it, and AES-CBC/GCM payload decryption is
  // not implemented in the bridge. rikey/rikeyId are still required: they key
  // the control channel's AES-GCM messages.
  void rikey;
  void rikeyId;
  const attributes = [
    'a=rtpmap:96 H264/90000',
    'a=fmtp:96 packetization-mode=1;profile-level-id=42e01f;sprop-parameter-sets=',
    `a=x-nv-video[0].clientViewportWd:${width}`,
    `a=x-nv-video[0].clientViewportHt:${height}`,
    `a=x-nv-video[0].maxFPS:${fps}`,
    `a=x-nv-video[0].packetSize:${packetSize}`,
    'a=x-nv-video[0].rateControlMode:4',
    'a=x-nv-video[0].timeoutLengthMs:7000',
    'a=x-nv-video[0].framesWithInvalidRefThreshold:0',
    `a=x-nv-video[0].initialBitrateKbps:${bitrateKbps}`,
    `a=x-nv-video[0].initialPeakBitrateKbps:${bitrateKbps}`,
    'a=x-nv-video[0].videoEncoderSlicesPerFrame:1',
    'a=x-nv-video[0].dynamicRangeMode:0',
    'a=x-nv-video[0].maxNumReferenceFrames:1',
    `a=x-nv-video[0].clientRefreshRateX100:${Math.round(fps * 100)}`,
    'a=x-nv-audio.surround.numChannels:2',
    'a=x-nv-audio.surround.channelMask:3',
    'a=x-nv-audio.surround.enable:0',
    'a=x-nv-audio.surround.AudioQuality:2',
    'a=x-nv-video[0].encoderCscMode:0',
    'a=x-ss-general.featureFlags:0',
  ];
  return [
    'v=0',
    `o=rtsp 0 0 IN IPv4 ${client}`,
    's=Session streamed by Moonlight',
    'i=Microsoft GameStream Protocol',
    `c=IN IPv4 ${client}`,
    't=0 0',
    ...attributes,
    `m=video ${videoPort}  `,
    `m=audio ${audioPort}  `,
    '',
  ].join('\r\n');
}

module.exports = { RtspClient, RtspError, buildAnnounceSdp, parseTransportPort };
