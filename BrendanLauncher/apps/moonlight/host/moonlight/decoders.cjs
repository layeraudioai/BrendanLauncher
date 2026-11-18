'use strict';
// Decoders for the two streams Sunshine sends.
//
// Video arrives as H.264/HEVC access units. ABI-1 exposes no hardware decoder
// and the bundle may not ship one, so decoding happens here on the PC with
// FFmpeg and the result is packed as RGB565 for the console's GPU slots. Audio
// is 48 kHz stereo PCM; Opus is transcoded with FFmpeg when available.

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { OggOpusMuxer } = require('./oggopus.cjs');

class VideoDecoder extends EventEmitter {
  /**
   * @param {{width:number,height:number,fps:number,codec?:'h264'|'hevc',
   *          ffmpeg?:string,logger?:(line:string)=>void}} options
   */
  constructor({ width, height, fps, codec = 'h264', ffmpeg, logger = () => {} }) {
    super();
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.codec = codec;
    this.ffmpeg = ffmpeg || process.env.FFMPEG || 'ffmpeg';
    this.logger = logger;
    this.frameBytes = width * height * 2;
    this.stderr = [];
    this.chunks = [];
    this.pending = 0;
    this.frames = 0;
    this.dropped = 0;
    this.started = false;
  }

  start() {
    if (this.started) return this;
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-probesize', '32',
      '-analyzeduration', '0',
      '-f', this.codec,
      '-i', 'pipe:0',
      '-an',
      '-vf',
      `scale=${this.width}:${this.height}:force_original_aspect_ratio=decrease,` +
        `pad=${this.width}:${this.height}:(ow-iw)/2:(oh-ih)/2`,
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb565le',
      'pipe:1',
    ];
    this.child = spawn(this.ffmpeg, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', chunk => this._onData(chunk));
    this.child.stderr.on('data', chunk => {
      this.stderr.push(chunk);
      if (this.stderr.length > 8) this.stderr.shift();
    });
    this.child.on('error', error => this.emit('error', error));
    this.child.on('exit', code => {
      if (code !== 0 && !this.closing) {
        const detail = Buffer.concat(this.stderr).toString('utf8').trim().slice(-400);
        this.emit('error', Error(`FFmpeg video decoder exited with ${code}${detail ? ': ' + detail : ''}`));
      }
    });
    this.started = true;
    return this;
  }

  /** @param {Buffer} accessUnit Annex-B access unit */
  push(accessUnit) {
    if (!accessUnit || !this.started || this.closing) return;
    // Keep at most two access units buffered: a Moonlight client that falls
    // behind should skip frames, not accumulate latency.
    if (this.pending > this.frameBytes * 3) {
      this.dropped += 1;
      return;
    }
    this.pending += accessUnit.length;
    this.child.stdin.write(accessUnit, () => {
      this.pending -= accessUnit.length;
    });
  }

  _onData(chunk) {
    this.chunks.push(chunk);
    let total = this.chunks.reduce((sum, part) => sum + part.length, 0);
    while (total >= this.frameBytes) {
      const joined = Buffer.concat(this.chunks, total);
      const frame = Buffer.from(joined.subarray(0, this.frameBytes));
      const rest = joined.subarray(this.frameBytes);
      this.chunks = rest.length ? [Buffer.from(rest)] : [];
      total = rest.length;
      this.frames += 1;
      this.emit('frame', frame);
    }
  }

  stop() {
    this.closing = true;
    if (this.child) {
      try {
        this.child.stdin.end();
      } catch {
        /* already closed */
      }
      this.child.kill('SIGKILL');
      this.child = null;
    }
    this.started = false;
  }
}

class AudioDecoder extends EventEmitter {
  constructor({ sampleRate = 48000, channels = 2, ffmpeg, logger = () => {} } = {}) {
    super();
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.ffmpeg = ffmpeg || process.env.FFMPEG || 'ffmpeg';
    this.logger = logger;
    this.child = null;
    this.muxer = null;
    this.unsupported = null;
    this.packets = 0;
  }

  /**
   * Sunshine sends Opus. The packets are re-muxed into Ogg here and decoded by
   * FFmpeg into the exact format the console's audio effect ring expects.
   */
  push({ codec, data }) {
    if (this.unsupported) return;
    if (codec !== 'opus') {
      this.unsupported = `Unsupported audio codec: ${codec}`;
      this.emit('unsupported', this.unsupported);
      return;
    }
    if (!this.child) this._start();
    if (!this.child) return;
    this.packets += 1;
    for (const page of this.muxer.push(data)) this.child.stdin.write(page);
  }

  _start() {
    this.muxer = new OggOpusMuxer({ channels: this.channels, onPage: () => {} });
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-fflags', 'nobuffer',
      '-f', 'ogg',
      '-i', 'pipe:0',
      '-f', 's16le',
      '-ar', String(this.sampleRate),
      '-ac', String(this.channels),
      'pipe:1',
    ];
    this.child = spawn(this.ffmpeg, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.stderr = [];
    this.child.stdout.on('data', chunk => this.emit('pcm', chunk));
    this.child.stderr.on('data', chunk => {
      this.stderr.push(chunk);
      if (this.stderr.length > 8) this.stderr.shift();
    });
    this.child.on('error', error => this.emit('error', error));
    this.child.on('exit', code => {
      if (code !== 0 && !this.closing) {
        const detail = Buffer.concat(this.stderr).toString('utf8').trim().slice(-300);
        this.emit('unsupported', `FFmpeg audio decoder exited with ${code}${detail ? ': ' + detail : ''}`);
      }
    });
    for (const page of this.muxer.headers()) this.child.stdin.write(page);
  }

  stop() {
    this.closing = true;
    if (this.child) {
      try {
        for (const page of this.muxer.flush()) this.child.stdin.write(page);
        this.child.stdin.end();
      } catch {
        /* ignore */
      }
      this.child.kill('SIGKILL');
      this.child = null;
    }
  }
}

module.exports = { VideoDecoder, AudioDecoder };
