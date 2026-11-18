'use strict';
// Streamed audio through the manifest sound-event bridge.
//
// ABI-1 has no audio API for apps: the only supported path is a manifest effect
// (48 kHz stereo s16le PCM) triggered with hbSound(id). The console's
// game-audio service re-reads the effect file on every trigger, so the bridge
// can replace a slot's contents and have the app play it 120 ms later.
//
// Six ring slots give 720 ms of headroom. Each trigger flushes the host's audio
// queue, so the bridge always publishes the newest chunk and lets the app skip
// rather than queue stale audio. See PROTOCOL.md for the trade-off.

const fs = require('node:fs/promises');
const path = require('node:path');
const layout = require('./layout.cjs');

const BYTES_PER_CHUNK =
  (layout.audio.sampleRate * layout.audio.channels * 2 * layout.audio.chunkMs) / 1000;

class AudioRing {
  constructor(header, { directory = path.join(__dirname, '..', 'assets'), logger = () => {} } = {}) {
    this.header = header;
    this.directory = directory;
    this.logger = logger;
    this.pending = Buffer.alloc(0);
    this.sequence = 0;
    this.slotIndex = 0;
    this.stats = { chunks: 0, bytes: 0, dropped: 0, republished: 0 };
  }

  push(pcm) {
    if (!Buffer.isBuffer(pcm) || !pcm.length) return;
    if (pcm.length % 4) throw Error('PCM must be whole 16-bit stereo frames');
    this.pending = Buffer.concat([this.pending, pcm]);
    // Never let latency grow without bound: keep at most one full ring queued.
    const limit = BYTES_PER_CHUNK * layout.audio.ringSlots;
    if (this.pending.length > limit) {
      const drop = this.pending.length - limit;
      this.pending = this.pending.subarray(drop - (drop % 4));
      this.stats.dropped += drop;
    }
  }

  /** Publish one chunk if a complete one is queued. Returns true when written. */
  async publish() {
    if (this.pending.length < BYTES_PER_CHUNK) return false;
    const chunk = this.pending.subarray(0, BYTES_PER_CHUNK);
    this.pending = this.pending.subarray(BYTES_PER_CHUNK);
    const slot = layout.audio.ringFirstSlot + this.slotIndex;
    this.slotIndex = (this.slotIndex + 1) % layout.audio.ringSlots;
    await this._writeSlot(slot, chunk);
    this.sequence += 1;
    this.header.setWord(layout.HEADER.audioSeq, this.sequence);
    this.header.setWord(layout.HEADER.audioSlot, slot);
    await this.header.flush();
    this.stats.chunks += 1;
    this.stats.bytes += chunk.length;
    return true;
  }

  async _writeSlot(slot, chunk) {
    const target = path.join(this.directory, `audio_${slot}.pcm`);
    const temp = `${target}.tmp`;
    await fs.writeFile(temp, chunk);
    // Rename is atomic on both NTFS and POSIX, so the console never stats a
    // half-written PCM file.
    await fs.rename(temp, target);
  }

  /** Return every ring slot to silence and stop the console-side stream. */
  async silence() {
    this.pending = Buffer.alloc(0);
    const chunk = Buffer.alloc(BYTES_PER_CHUNK);
    for (let index = 0; index < layout.audio.ringSlots; index++) {
      await this._writeSlot(layout.audio.ringFirstSlot + index, chunk);
    }
    this.sequence += 1;
    this.header.setWord(layout.HEADER.audioSeq, this.sequence);
    this.header.setWord(layout.HEADER.audioSlot, layout.audio.ringFirstSlot);
    await this.header.flush();
  }
}

module.exports = { AudioRing, BYTES_PER_CHUNK, BYTES_PER_SECOND: layout.audio.sampleRate * layout.audio.channels * 2 };
