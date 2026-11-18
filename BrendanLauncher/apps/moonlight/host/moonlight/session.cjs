'use strict';
// One live Sunshine session: RTSP handshake, RTP video/audio sockets, ENet
// control channel, PC-side decoding, and the console's pad state going back out
// as GameStream controller packets.
//
// The console never sees any of this: it only receives RGB565 frames and PCM
// chunks, and reports button state in shared memory.

const dgram = require('node:dgram');
const { EventEmitter } = require('node:events');
const { RtspClient } = require('./rtsp.cjs');
const { ControlStream, BUTTON } = require('./control.cjs');
const { parseRtp, VideoDepacketizer, AudioDepacketizer } = require('./rtp.cjs');
const { VideoDecoder, AudioDecoder } = require('./decoders.cjs');

const IDLE_IDR_MS = 750;
const INPUT_INTERVAL_MS = 8;

/** Map an ABI-1 pad snapshot onto GameStream bits. */
function mapPad(pad) {
  const b = pad.buttons;
  let buttons = 0;
  if (b & 0x0001) buttons |= BUTTON.a;
  if (b & 0x0002) buttons |= BUTTON.b;
  if (b & 0x0004) buttons |= BUTTON.x;
  if (b & 0x0008) buttons |= BUTTON.y;
  if (b & 0x0040) buttons |= BUTTON.leftShoulder;
  if (b & 0x0080) buttons |= BUTTON.rightShoulder;
  if (b & 0x0200) buttons |= BUTTON.back;
  if (b & 0x0400) buttons |= BUTTON.start;
  if (b & 0x1000) buttons |= BUTTON.up;
  if (b & 0x2000) buttons |= BUTTON.down;
  if (b & 0x4000) buttons |= BUTTON.left;
  if (b & 0x8000) buttons |= BUTTON.right;
  return {
    buttons,
    // Switch ZL/ZR are digital; GameStream triggers are analogue.
    leftTrigger: b & 0x0100 ? 0xff : 0,
    rightTrigger: b & 0x0800 ? 0xff : 0,
    leftStickX: pad.leftStickX,
    leftStickY: -pad.leftStickY,
    rightStickX: pad.rightStickX,
    rightStickY: -pad.rightStickY,
  };
}

class SunshineSession extends EventEmitter {
  /**
   * @param {{
   *   host:string, sessionUrl:string, rikey:Buffer, rikeyId:number,
   *   config:{width:number,height:number,fps:number,bitrateKbps:number,packetSize?:number},
   *   ffmpeg?:string, logger?:(line:string)=>void
   * }} options
   */
  constructor(options) {
    super();
    this.host = options.host;
    this.sessionUrl = options.sessionUrl;
    this.rikey = options.rikey;
    this.rikeyId = options.rikeyId;
    this.config = options.config;
    this.logger = options.logger || (() => {});
    this.ffmpeg = options.ffmpeg;
    this.closed = false;
    this.rtsp = null;
    this.control = null;
    this.sockets = [];
    this.videoDecoder = null;
    this.audioDecoder = null;
    this.stats = { frames: 0, audioBytes: 0, videoPackets: 0, inputPackets: 0, startedAt: Date.now() };
    this._lastFrameAt = 0;
    this._lastIdrAt = 0;
    this._timers = [];
  }

  async start() {
    const parsed = /^rtsp:\/\/([^/:]+):(\d+)/i.exec(this.sessionUrl || '');
    if (!parsed) {
      throw Error(
        'Sunshine returned an unsupported session URL. Only plain rtsp:// URLs are ' +
          'implemented (rtspenc:// needs RTSP encryption, which the bridge does not do).',
      );
    }
    const rtspHost = this.host || parsed[1];
    const rtspPort = Number(parsed[2]);

    const videoSocket = await bindUdp();
    const audioSocket = await bindUdp();
    this.sockets.push(videoSocket, audioSocket);

    this.rtsp = new RtspClient({ host: rtspHost, port: rtspPort, url: this.sessionUrl, logger: this.logger });
    const negotiated = await this.rtsp.handshake({
      width: this.config.width,
      height: this.config.height,
      fps: this.config.fps,
      bitrateKbps: this.config.bitrateKbps,
      packetSize: this.config.packetSize,
      rikey: this.rikey,
      rikeyId: this.rikeyId,
      videoPort: videoSocket.address().port,
      audioPort: audioSocket.address().port,
      controlPort: 50000,
      clientAddress: '0.0.0.0',
    });
    if (negotiated.encryption) {
      throw Error('Sunshine signalled encrypted payloads; the bridge only handles plain RTP');
    }
    this.negotiated = negotiated;

    this.videoDecoder = new VideoDecoder({
      width: this.config.width,
      height: this.config.height,
      fps: this.config.fps,
      codec: negotiated.codec,
      ffmpeg: this.ffmpeg,
      logger: this.logger,
    });
    this.videoDecoder.on('frame', frame => {
      this.stats.frames += 1;
      this._lastFrameAt = Date.now();
      this.emit('frame', frame);
    });
    this.videoDecoder.on('error', error => this.emit('error', error));
    this.videoDecoder.start();

    this.audioDecoder = new AudioDecoder({ ffmpeg: this.ffmpeg });
    this.audioDecoder.on('pcm', pcm => {
      this.stats.audioBytes += pcm.length;
      this.emit('audio', pcm);
    });
    this.audioDecoder.on('unsupported', message => this.emit('warning', message));

    const videoDepacketizer = new VideoDepacketizer(negotiated.codec);
    const audioDepacketizer = new AudioDepacketizer();
    videoSocket.on('message', message => {
      const rtp = parseRtp(message);
      if (!rtp) return;
      this.stats.videoPackets += 1;
      const accessUnit = videoDepacketizer.push(rtp);
      if (accessUnit) this.videoDecoder.push(accessUnit);
    });
    audioSocket.on('message', message => {
      const rtp = parseRtp(message);
      if (!rtp) return;
      const audio = audioDepacketizer.push(rtp);
      if (audio) this.audioDecoder.push(audio);
    });

    this.control = new ControlStream({
      host: rtspHost,
      port: negotiated.controlPort,
      rikey: this.rikey,
      connectData: negotiated.connectData,
      logger: this.logger,
    });
    this.control.on('message', message => this._onControl(message));
    this.control.on('disconnected', () => {
      if (!this.closed) this.emit('ended', 'control stream closed');
    });
    await this.control.start();

    this._timers.push(
      setInterval(() => this._watchdog(), 250),
      setInterval(() => this._sendInput(), INPUT_INTERVAL_MS),
    );
    this.logger(`Sunshine session started (${negotiated.codec}, ${this.config.width}x${this.config.height})`);
    return this;
  }

  _onControl(message) {
    // 0x0109 is termination (extended on Sunshine). Anything else (rumble,
    // HDR mode, frame stats) is informational for this bridge.
    if (message.type === 0x0109 || message.type === 0x0100) {
      this.emit('ended', 'the PC ended the stream');
    }
  }

  _watchdog() {
    if (this.closed) return;
    const now = Date.now();
    if (this._lastFrameAt && now - this._lastFrameAt > IDLE_IDR_MS && now - this._lastIdrAt > IDLE_IDR_MS) {
      this._lastIdrAt = now;
      this.control?.requestIdr();
    }
  }

  setInput(pad) {
    this._pad = pad;
  }

  _sendInput() {
    if (this.closed || !this.control || !this._pad) return;
    const state = mapPad(this._pad);
    const key = `${state.buttons}:${state.leftTrigger}:${state.rightTrigger}:` +
      `${state.leftStickX}:${state.leftStickY}:${state.rightStickX}:${state.rightStickY}`;
    if (key === this._lastInputKey) return;
    this._lastInputKey = key;
    try {
      this.control.sendController(state);
      this.stats.inputPackets += 1;
    } catch {
      /* stream is already going away */
    }
  }

  get report() {
    const seconds = Math.max(1, (Date.now() - this.stats.startedAt) / 1000);
    return {
      fps: this.stats.frames / seconds,
      frames: this.stats.frames,
      inputPackets: this.stats.inputPackets,
      codec: this.negotiated?.codec,
      audio: this.audioDecoder?.unsupported ? 'unavailable' : 'pcm',
    };
  }

  async stop(reason = 'stopped') {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this._timers) clearInterval(timer);
    this._timers = [];
    try {
      this.control?.stop();
    } catch {
      /* ignore */
    }
    this.videoDecoder?.stop();
    this.audioDecoder?.stop();
    for (const socket of this.sockets) {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
    this.sockets = [];
    await this.rtsp?.teardown();
    this.emit('closed', reason);
  }
}

function bindUdp() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', reject);
    socket.bind(0, () => resolve(socket));
  });
}

module.exports = { SunshineSession, mapPad };
