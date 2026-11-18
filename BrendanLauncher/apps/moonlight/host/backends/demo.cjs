'use strict';
// Demo video source: proves the whole console-side pipeline (video slots, text
// bands, audio ring, input round-trip) without a Sunshine host. Frames are
// generated in JS at the layout resolution; audio is a 440 Hz tone.

const { EventEmitter } = require('node:events');
const { video, key } = require('../layout.cjs');

class DemoBackend extends EventEmitter {
  constructor({ logger = () => {} } = {}) {
    super();
    this.logger = logger;
    this.name = 'demo';
    this.timer = null;
    this.audioTimer = null;
    this.frame = 0;
    this.width = video.width;
    this.height = video.height;
    this.buffer = null;
    this.audioPhase = 0;
    this.streaming = false;
    this.startedAt = 0;
  }

  async init() {
    this.hosts = [
      { key: 'demo-living-room', name: 'Demo host (this PC)', address: '127.0.0.1', state: 'paired' },
      { key: 'demo-basement', name: 'Demo host (basement)', address: '192.168.1.42', state: 'unpaired' },
    ];
    this.games = [
      { id: 1, name: 'Hollow Knight' },
      { id: 2, name: 'Celeste' },
      { id: 3, name: 'Desktop' },
    ];
    return this;
  }

  async listHosts() {
    return this.hosts;
  }

  async listGames(hostKey) {
    void hostKey;
    return this.games;
  }

  async beginPair(hostKey) {
    const pin = String(1000 + Math.floor(Math.random() * 9000));
    setTimeout(() => {
      const host = this.hosts.find(item => item.key === hostKey);
      if (host) host.state = 'paired';
      this.emit('progress', { message: `Demo pairing finished (${pin})`, done: true });
    }, 2500);
    return { pin };
  }

  async startStream(hostKey, gameId) {
    const game = this.games.find(item => item.id === gameId);
    this.logger(`demo stream: ${hostKey} / ${game ? game.name : gameId}`);
    this.streaming = true;
    this.startedAt = Date.now();
    this.frame = 0;
    this.lastInput = 'idle';
    const fps = key.videoFps;
    this.timer = setInterval(() => this._emitFrame(), Math.round(1000 / fps));
    this.audioTimer = setInterval(() => this._emitAudio(), 20);
    return { game: game ? game.name : String(gameId) };
  }

  setInput(pad) {
    const summary = `buttons 0x${pad.buttons.toString(16)} stick ${pad.leftStickX},${pad.leftStickY}`;
    if (summary !== this.lastInput) this.lastInput = summary;
  }

  _emitFrame() {
    const { width, height } = this;
    const time = this.frame / key.videoFps;
    // A fresh buffer per frame: the frame writer takes ownership.
    const buf = Buffer.alloc(this.width * this.height * 2);
    // Cheap plasma + moving bars: enough motion to exercise the tile diff.
    for (let y = 0; y < height; y += 4) {
      const row = y * width * 2;
      for (let x = 0; x < width; x += 4) {
        const wave = Math.sin((x / 60) + time * 2) + Math.sin((y / 45) - time * 1.7);
        const r = (Math.sin(wave + time) * 0.5 + 0.5) * 31;
        const g = (Math.sin(wave + 2 + time * 1.3) * 0.5 + 0.5) * 63;
        const b = (Math.sin(wave + 4 - time) * 0.5 + 0.5) * 31;
        const pixel = (Math.round(r) << 11) | (Math.round(g) << 5) | Math.round(b);
        const offset = row + x * 2;
        buf.writeUInt16LE(pixel, offset);
        buf.writeUInt16LE(pixel, offset + 2);
        buf.writeUInt16LE(pixel, offset + width * 2);
        buf.writeUInt16LE(pixel, offset + width * 2 + 2);
      }
    }
    // Sweep a bright marker so a stale slot is obvious on screen.
    const markerX = Math.floor((0.5 + 0.45 * Math.sin(time * 1.5)) * (width - 24));
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        buf.writeUInt16LE(0xffff, ((y + 20) * width + markerX + x) * 2);
      }
    }
    this.frame += 1;
    this.emit('frame', buf);
  }

  _emitAudio() {
    // 440 Hz + 660 Hz tone, 20 ms of 48 kHz stereo s16le.
    const samples = (48000 * 20) / 1000;
    const pcm = Buffer.alloc(samples * 4);
    for (let i = 0; i < samples; i++) {
      const value = Math.round(
        6000 * Math.sin(this.audioPhase) + 3000 * Math.sin(this.audioPhase * 1.5),
      );
      pcm.writeInt16LE(value, i * 4);
      pcm.writeInt16LE(value, i * 4 + 2);
      this.audioPhase += (2 * Math.PI * 440) / 48000;
    }
    this.emit('audio', pcm);
  }

  async stopStream() {
    clearInterval(this.timer);
    clearInterval(this.audioTimer);
    this.timer = null;
    this.audioTimer = null;
    this.streaming = false;
  }

  get stats() {
    const seconds = Math.max(1, (Date.now() - this.startedAt) / 1000);
    return { fps: this.frame / seconds, codec: 'demo', audio: 'tone' };
  }

  async close() {
    await this.stopStream();
  }
}

module.exports = { DemoBackend };
