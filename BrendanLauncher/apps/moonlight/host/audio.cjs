'use strict';
// Streamed audio through the launcher's ABI `events` channel.
//
// ABI-1 has no audio API for apps. The only supported path is a manifest effect
// (48 kHz stereo s16le PCM) triggered with hbSound(id). To make that path
// gapless, a package may declare a ring of effect ids as one *stream*
// (`audio.stream` in app.json). The launcher's audio service then appends each
// triggered chunk to the live AudioOut queue instead of stopping and restarting
// the device, and reports how many chunks it has queued back to the app through
// `events.z`.
//
// That report is what this module paces on:
//
//   produced  chunks written into ring files by the host      (header audioSeq)
//   posted    chunks the console has triggered                (events.x)
//   queued    chunks the launcher has appended to the device  (events.z)
//
// The host never runs more than `leadChunks` ahead of `queued`, and never
// overwrites a ring slot the device may still be playing, so playback stays
// continuous instead of clicking at chunk boundaries.

const fs = require('node:fs/promises');
const path = require('node:path');
const layout = require('./layout.cjs');

const BYTES_PER_SECOND = layout.audio.sampleRate * layout.audio.channels * 2;
const BYTES_PER_CHUNK = (BYTES_PER_SECOND * layout.audio.chunkMs) / 1000;
const RING = layout.audio.ringSlots;
const LEAD = layout.audio.leadChunks;

class AudioRing {
  /**
   * @param {object} header the ABI header writer
   * @param {{paths?:Map<number,string>, directory?:string, consumed?:()=>Promise<number>|number,
   *          logger?:(line:string)=>void}} options
   */
  constructor(header, { paths = null, directory = path.join(__dirname, '..', 'assets'), consumed = () => 0, logger = () => {} } = {}) {
    this.header = header;
    this.paths = paths;
    this.directory = directory;
    this.consumed = consumed;
    this.logger = logger;
    this.pending = Buffer.alloc(0);
    this.produced = 0;
    this.published = -1;
    this.stats = { chunks: 0, bytes: 0, dropped: 0, starved: 0, rewrites: 0 };
    this.slotOf = index => layout.audio.ringFirstSlot + (index % RING);
    this.pathOf = index => {
      const slot = this.slotOf(index);
      if (this.paths && this.paths.has(slot)) return this.paths.get(slot);
      return path.join(this.directory, `audio_${slot}.pcm`);
    };
  }

  push(pcm) {
    if (!Buffer.isBuffer(pcm) || !pcm.length) return;
    if (pcm.length % 4) throw Error('PCM must be whole 16-bit stereo frames');
    this.pending = Buffer.concat([this.pending, pcm]);
    // One ring of backlog is all that can ever be played; beyond that the host is
    // simply ahead of the device, so drop the oldest audio rather than grow.
    const limit = BYTES_PER_CHUNK * RING * 2;
    if (this.pending.length > limit) {
      const drop = this.pending.length - limit;
      this.pending = this.pending.subarray(drop - (drop % 4));
      this.stats.dropped += drop;
    }
  }

  /** Read how many chunks the launcher has queued, tolerating a missing channel. */
  async _queued() {
    try {
      const value = await this.consumed();
      return Number(value) >>> 0;
    } catch {
      return 0;
    }
  }

  /**
   * Write as many chunks as the launcher can accept right now.
   * @returns {Promise<number>} number of chunks written
   */
  async pump() {
    const queued = await this._queued();
    let written = 0;
    while (this.pending.length >= BYTES_PER_CHUNK) {
      const inFlight = this.produced - queued;
      // `inFlight` may be negative right after a restart; that only means the
      // launcher already played everything, so it must not block production.
      if (inFlight >= LEAD) break;
      const chunk = this.pending.subarray(0, BYTES_PER_CHUNK);
      this.pending = this.pending.subarray(BYTES_PER_CHUNK);
      await this._writeSlot(this.produced, chunk);
      this.produced += 1;
      written += 1;
      this.stats.chunks += 1;
      this.stats.bytes += chunk.length;
    }
    if (this.produced !== this.published) {
      this.header.setWord(layout.HEADER.audioSeq, this.produced);
      this.header.setWord(layout.HEADER.audioSlot, this.slotOf(this.produced - 1));
      await this.header.flush();
      this.published = this.produced;
    }
    if (!written && this.pending.length >= BYTES_PER_CHUNK) this.stats.starved += 1;
    return written;
  }

  async _writeSlot(index, chunk) {
    const target = this.pathOf(index);
    const temp = `${target}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temp, chunk);
    // Rename is atomic on both NTFS and POSIX, so the launcher never reads a
    // half-written PCM chunk.
    await fs.rename(temp, target);
    this.stats.rewrites += 1;
  }

  /** Return every ring slot to silence and stop the console-side stream. */
  async silence() {
    this.pending = Buffer.alloc(0);
    const chunk = Buffer.alloc(BYTES_PER_CHUNK);
    for (let index = 0; index < RING; index++) {
      await this._writeSlot(this.produced + index, chunk);
    }
    this.header.setWord(layout.HEADER.audioSeq, this.produced);
    await this.header.flush();
  }

  /** Locate the chunk files the launcher reported in game-audio-source.json. */
  static async resolvePaths(directory, ids) {
    const wanted = new Set(ids);
    const paths = new Map();
    try {
      const source = JSON.parse(
        await fs.readFile(path.join(directory, 'game-audio-source.json'), 'utf8'),
      );
      for (const [id, file] of Object.entries(source.package?.effects || {})) {
        const slot = Number(id);
        if (wanted.has(slot)) paths.set(slot, file);
      }
    } catch {
      /* standalone run: the bridge falls back to the app's own assets folder */
    }
    return paths;
  }
}

module.exports = {
  AudioRing,
  BYTES_PER_CHUNK,
  BYTES_PER_SECOND,
  LEAD_CHUNKS: LEAD,
  RING_SLOTS: RING,
};
