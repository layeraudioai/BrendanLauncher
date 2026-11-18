'use strict';
// Read/write side of the ABI-1 header block (1 KiB inside the app data region).
//
// The compute shader and the bridge share this block. The bridge keeps a local
// mirror, so per-frame updates cost one small write (changed words only) instead
// of a read-modify-write round trip.

const layout = require('./layout.cjs');

const H = layout.HEADER;
const BYTES = layout.header.size;

class Header {
  constructor(rpc, mapped) {
    this.rpc = rpc;
    this.mapped = mapped;
    this.local = Buffer.alloc(BYTES);
    this.remote = Buffer.alloc(BYTES);
    this.dirty = new Set();
    this.stats = { writes: 0, bytes: 0, reads: 0 };
  }

  async read() {
    const bytes = await this.rpc.read(this.mapped + layout.header.offset, BYTES);
    bytes.copy(this.remote);
    this.stats.reads += 1;
    return this.remote;
  }

  word(index) {
    return this.local.readUInt32LE(index * 4);
  }

  remoteWord(index) {
    return this.remote.readUInt32LE(index * 4);
  }

  setWord(index, value) {
    const offset = index * 4;
    const next = value >>> 0;
    if (this.local.readUInt32LE(offset) === next) return;
    this.local.writeUInt32LE(next, offset);
    this.dirty.add(index);
  }

  // Convenience accessors -------------------------------------------------
  get scene() {
    return this.word(H.scene);
  }
  setScene(scene) {
    this.setWord(H.scene, scene);
  }
  get flags() {
    return this.word(H.flags);
  }
  setFlags(flags) {
    this.setWord(H.flags, flags);
  }
  addFlags(flags) {
    this.setFlags(this.flags | flags);
  }
  clearFlags(flags) {
    this.setFlags(this.flags & ~flags);
  }
  get status() {
    return this.word(H.status);
  }
  setStatus(code) {
    this.setWord(H.status, code);
  }
  get itemCount() {
    return this.word(H.items);
  }
  setItemCount(count) {
    this.setWord(H.items, Math.min(count, 32));
  }
  setCounters({ hosts, games, fps, latency } = {}) {
    if (hosts !== undefined) this.setWord(H.hosts, hosts);
    if (games !== undefined) this.setWord(H.games, games);
    if (fps !== undefined) this.setWord(H.fps, Math.round(fps));
    if (latency !== undefined) this.setWord(H.latency, Math.round(latency));
  }

  /**
   * Publish the item table.
   * @param {{x:number,y:number,w:number,h:number,flags?:number}[]} items
   */
  setItems(items) {
    const count = Math.min(items.length, 32);
    for (let i = 0; i < 32; i++) {
      const base = H.itemsBase + i * H.itemsStride;
      const item = i < count ? items[i] : null;
      this.setWord(base, item ? Math.round(item.x) : 0);
      this.setWord(base + 1, item ? Math.round(item.y) : 0);
      this.setWord(base + 2, item ? Math.round(item.w) : 0);
      this.setWord(base + 3, item ? Math.round(item.h) : 0);
      this.setWord(base + 4, item ? (item.flags || 0) >>> 0 : 0);
    }
    this.setItemCount(count);
  }

  /** Latest command posted by the app, or null when nothing is outstanding. */
  pendingCommand() {
    const seq = this.remote.readUInt32LE(H.cmdSeq * 4);
    const ack = this.remote.readUInt32LE(H.cmdAck * 4);
    if (!seq || seq === ack) return null;
    return {
      seq,
      command: this.remote.readUInt32LE(H.cmd * 4),
      arg0: this.remote.readUInt32LE(H.cmdArg0 * 4),
      arg1: this.remote.readUInt32LE(H.cmdArg1 * 4),
      name: layout.CMD_NAMES[this.remote.readUInt32LE(H.cmd * 4)] || 'unknown',
    };
  }

  setCommandAck(seq, status = 0) {
    this.setWord(H.cmdAck, seq);
    this.setWord(H.cmdStatus, status);
  }

  get selection() {
    return this.remote.readUInt32LE(H.selected * 4);
  }

  get audioConsumed() {
    return this.remote.readUInt32LE(H.audioConsumed * 4);
  }

  /** Write changed words, coalescing runs, then refresh the remote mirror. */
  async flush() {
    if (!this.dirty.size) return 0;
    const indices = [...this.dirty].sort((a, b) => a - b);
    this.dirty.clear();
    let written = 0;
    let start = indices[0];
    let last = indices[0];
    const runs = [];
    for (const index of indices.slice(1)) {
      if (index === last + 1) {
        last = index;
        continue;
      }
      runs.push([start, last]);
      start = index;
      last = index;
    }
    runs.push([start, last]);
    for (const [from, to] of runs) {
      const offset = from * 4;
      const bytes = Buffer.from(this.local.subarray(offset, to * 4 + 4));
      await this.rpc.write(this.mapped + layout.header.offset + offset, bytes);
      bytes.copy(this.remote, offset);
      written += bytes.length;
      this.stats.writes += 1;
    }
    this.stats.bytes += written;
    return written;
  }

  /** Acknowledge the app's command mailbox without touching other fields. */
  async acknowledge(seq, status = 0) {
    this.setCommandAck(seq, status);
    await this.flush();
  }
}

module.exports = { Header, H, BYTES };
