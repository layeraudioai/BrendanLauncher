'use strict';
// Video frames into the ABI-1 buffer: 1280x720 RGB565, double buffered, block
// differential.
//
// The console's host channel is a request/response bridge, not a video link, so
// every byte written here costs round trips. Frames are therefore split into
// 20-row blocks; only blocks that differ from the previous frame are written,
// and adjacent dirty blocks are coalesced into as few writes as possible.

const layout = require('./layout.cjs');

const WIDTH = layout.video.width;
const HEIGHT = layout.video.height;
const ROW_BYTES = WIDTH * 2;
const ROWS_PER_BLOCK = 20;
const BLOCKS = Math.ceil(HEIGHT / ROWS_PER_BLOCK);

class FrameWriter {
  constructor(rpc, mapped, { logger = () => {} } = {}) {
    this.rpc = rpc;
    this.mapped = mapped;
    this.logger = logger;
    this.slot = 0;
    this.sequence = 0;
    this.previous = Buffer.alloc(layout.video.bytesPerSlot);
    this.pending = null;
    this.hasPrevious = false;
    this.stats = { frames: 0, bytes: 0, writes: 0, skipped: 0 };
  }

  /**
   * Queue a frame. The latest frame wins: a late frame is dropped rather than
   * queued, which is exactly what a streaming client wants. The caller must not
   * reuse the buffer after handing it over.
   */
  push(frame) {
    if (!Buffer.isBuffer(frame) || frame.length !== layout.video.bytesPerSlot) {
      throw Error(`Frame must be exactly ${layout.video.bytesPerSlot} bytes of RGB565`);
    }
    this.pending = frame;
  }

  /** Write the queued frame, if any. Called by the bridge's pump. */
  async flush() {
    const frame = this.pending;
    if (!frame) return { written: 0, runs: 0 };
    this.pending = null;
    return this._write(frame);
  }

  /** @param {Buffer} frame RGB565 little-endian, width*height*2 bytes */
  async _write(frame, { force = false } = {}) {
    if (!Buffer.isBuffer(frame) || frame.length !== layout.video.bytesPerSlot) {
      throw Error(`Frame must be exactly ${layout.video.bytesPerSlot} bytes of RGB565`);
    }
    const runs = force || !this.hasPrevious ? [[0, BLOCKS - 1]] : this._dirtyRuns(frame);
    if (!runs.length) {
      this.stats.skipped += 1;
      return { written: 0, runs: 0 };
    }
    const slot = this.slot ^ 1;
    const base = this.mapped + layout.videoOffset(slot);
    let written = 0;
    for (const [first, last] of runs) {
      const offset = first * ROWS_PER_BLOCK * ROW_BYTES;
      const length = Math.min(
        (last - first + 1) * ROWS_PER_BLOCK * ROW_BYTES,
        layout.video.bytesPerSlot - offset,
      );
      await this.rpc.write(base + offset, frame.subarray(offset, offset + length));
      written += length;
      this.stats.writes += 1;
    }
    frame.copy(this.previous);
    this.hasPrevious = true;
    this.slot = slot;
    this.sequence = (this.sequence + 1) >>> 0;
    this.stats.frames += 1;
    this.stats.bytes += written;
    // Publish only after the pixels are in place, so the shader never samples a
    // slot that is still being written.
    await this._publish();
    return { written, runs: runs.length };
  }

  _dirtyRuns(frame) {
    const dirty = new Array(BLOCKS).fill(false);
    for (let block = 0; block < BLOCKS; block++) {
      const offset = block * ROWS_PER_BLOCK * ROW_BYTES;
      const length = Math.min(ROWS_PER_BLOCK * ROW_BYTES, layout.video.bytesPerSlot - offset);
      dirty[block] = Buffer.compare(
        frame.subarray(offset, offset + length),
        this.previous.subarray(offset, offset + length),
      ) !== 0;
    }
    const runs = [];
    for (let block = 0; block < BLOCKS; block++) {
      if (!dirty[block]) continue;
      let last = block;
      while (last + 1 < BLOCKS && dirty[last + 1] && last - block < 7) last += 1;
      runs.push([block, last]);
      block = last;
    }
    return runs;
  }

  async _publish() {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(this.slot, 0);
    await this.rpc.write(this.mapped + layout.headerOffset(layout.HEADER.frameSlot), header);
    header.writeUInt32LE(this.sequence, 0);
    await this.rpc.write(this.mapped + layout.headerOffset(layout.HEADER.frameSeq), header);
  }

  /** Clear both slots and mark the stream as having no picture. */
  async reset(flags) {
    this.hasPrevious = false;
    this.previous.fill(0);
    const value = Buffer.alloc(4);
    value.writeUInt32LE(flags, 0);
    await this.rpc.write(this.mapped + layout.headerOffset(layout.HEADER.flags), value);
  }
}

module.exports = { FrameWriter, WIDTH, HEIGHT, ROWS_PER_BLOCK, BLOCKS };
