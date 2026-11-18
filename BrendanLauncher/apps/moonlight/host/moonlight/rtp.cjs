'use strict';
// RTP parsing and depacketisation for Sunshine's video and audio streams.
//
// Video packets are RTP (12-byte fixed header) + NV_VIDEO_PACKET (16 bytes) +
// the H.264/HEVC RTP payload. Reassembly is per frameIndex and completes on the
// packet carrying FLAG_EOF, which yields one access unit in Annex-B form for
// FFmpeg. Audio packets carry the codec payload directly after the RTP header.

const FLAG_CONTAINS_PIC_DATA = 0x1;
const FLAG_EOF = 0x2;
const FLAG_SOF = 0x4;
const NV_VIDEO_PACKET_BYTES = 16;
const ENC_VIDEO_HEADER_BYTES = 32;

function parseRtp(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const version = buffer[0] >> 6;
  if (version !== 2) return null;
  const padding = (buffer[0] & 0x20) !== 0;
  const extension = (buffer[0] & 0x10) !== 0;
  const csrcCount = buffer[0] & 0x0f;
  const marker = (buffer[1] & 0x80) !== 0;
  const payloadType = buffer[1] & 0x7f;
  const sequence = buffer.readUInt16BE(2);
  const timestamp = buffer.readUInt32BE(4);
  const ssrc = buffer.readUInt32BE(8);
  let offset = 12 + csrcCount * 4;
  if (extension) {
    if (buffer.length < offset + 4) return null;
    const words = buffer.readUInt16BE(offset + 2);
    offset += 4 + words * 4;
  }
  if (buffer.length < offset) return null;
  let end = buffer.length;
  if (padding && end > offset) end -= buffer[end - 1];
  return {
    payloadType,
    sequence,
    timestamp,
    ssrc,
    marker,
    payload: buffer.subarray(offset, Math.max(offset, end)),
  };
}

/** Strip the NVIDIA frame header from a video RTP payload. */
function parseVideoPayload(payload) {
  if (payload.length < NV_VIDEO_PACKET_BYTES) return null;
  const streamPacketIndex = payload.readUInt32LE(0);
  const frameIndex = payload.readUInt32LE(4);
  const flags = payload.readUInt8(8);
  const extraFlags = payload.readUInt8(9);
  return {
    streamPacketIndex,
    frameIndex,
    flags,
    extraFlags,
    data: payload.subarray(NV_VIDEO_PACKET_BYTES),
  };
}

const START_CODE = Buffer.from([0x00, 0x00, 0x00, 0x01]);

class VideoDepacketizer {
  /** @param {'h264'|'hevc'} codec */
  constructor(codec = 'h264') {
    this.codec = codec;
    this.frames = new Map();
    this.stats = { packets: 0, frames: 0, dropped: 0, lastFrame: -1 };
  }

  /**
   * Push one RTP video packet.
   * @returns {Buffer|null} completed Annex-B access unit
   */
  push(rtp) {
    // Sunshine sends video data as payload type 96; everything else on the video
    // port is FEC/parity data for a shard layout this bridge does not implement.
    if (!rtp || rtp.payloadType !== 96) return null;
    const packet = parseVideoPayload(rtp.payload);
    if (!packet) return null;
    this.stats.packets += 1;
    let entry = this.frames.get(packet.frameIndex);
    if (!entry) {
      entry = { nals: [], partial: null };
      this.frames.set(packet.frameIndex, entry);
    }
    if (packet.flags & FLAG_CONTAINS_PIC_DATA) this._consume(entry, packet.data);
    if (!(packet.flags & FLAG_EOF)) {
      // Bound the map if a frame never completes (packet loss).
      if (this.frames.size > 64) {
        const oldest = Math.min(...this.frames.keys());
        this.frames.delete(oldest);
        this.stats.dropped += 1;
      }
      return null;
    }
    this.frames.delete(packet.frameIndex);
    if (entry.partial) {
      entry.nals.push(entry.partial);
      entry.partial = null;
    }
    if (!entry.nals.length) return null;
    this.stats.lastFrame = packet.frameIndex;
    this.stats.frames += 1;
    return Buffer.concat(entry.nals.flatMap(nal => [START_CODE, nal]));
  }

  /** Split one RTP payload's codec data into NAL units, honouring fragmentation. */
  _consume(entry, data) {
    if (!data.length) return;
    if (this.codec === 'hevc') {
      this._consumeHevc(entry, data);
      return;
    }
    const nalType = data[0] & 0x1f;
    if (nalType === 24) {
      // STAP-A: 1-byte header followed by 2-byte length-prefixed NAL units.
      let cursor = 1;
      while (cursor + 2 <= data.length) {
        const size = data.readUInt16BE(cursor);
        cursor += 2;
        if (size === 0 || cursor + size > data.length) break;
        entry.nals.push(data.subarray(cursor, cursor + size));
        cursor += size;
      }
      return;
    }
    if (nalType === 28) {
      // FU-A: indicator, FU header, then the fragment body.
      const fuHeader = data[1];
      const start = (fuHeader & 0x80) !== 0;
      const end = (fuHeader & 0x40) !== 0;
      const body = data.subarray(2);
      if (start) {
        entry.partial = Buffer.concat([
          Buffer.from([(data[0] & 0xe0) | (fuHeader & 0x1f)]),
          body,
        ]);
      } else if (entry.partial) {
        entry.partial = Buffer.concat([entry.partial, body]);
      }
      if (end && entry.partial) {
        entry.nals.push(entry.partial);
        entry.partial = null;
      }
      return;
    }
    // Single NAL unit packet.
    entry.nals.push(data);
  }

  _consumeHevc(entry, data) {
    if (data.length < 2) return;
    const nalType = (data[0] >> 1) & 0x3f;
    if (nalType === 48) {
      // Aggregation packet: 2-byte payload header, then 2-byte size fields.
      let cursor = 2;
      while (cursor + 2 <= data.length) {
        const size = data.readUInt16BE(cursor);
        cursor += 2;
        if (size === 0 || cursor + size > data.length) break;
        entry.nals.push(data.subarray(cursor, cursor + size));
        cursor += size;
      }
      return;
    }
    if (nalType === 49) {
      // Fragmentation unit: the FU header's low 6 bits carry the NAL type.
      const fuHeader = data[2];
      const start = (fuHeader & 0x80) !== 0;
      const end = (fuHeader & 0x40) !== 0;
      const body = data.subarray(3);
      if (start) {
        entry.partial = Buffer.concat([
          Buffer.from([(data[0] & 0x81) | ((fuHeader & 0x3f) << 1), data[1]]),
          body,
        ]);
      } else if (entry.partial) {
        entry.partial = Buffer.concat([entry.partial, body]);
      }
      if (end && entry.partial) {
        entry.nals.push(entry.partial);
        entry.partial = null;
      }
      return;
    }
    entry.nals.push(data);
  }
}

/**
 * Sunshine audio packets: RTP payload type 97 carries an Opus packet whose first
 * byte is the TOC; 127 is the FEC shard we cannot use. Decoding Opus is the
 * decoder's job (see decoders.cjs and oggopus.cjs).
 */
class AudioDepacketizer {
  constructor() {
    this.stats = { packets: 0, bytes: 0, fec: 0 };
  }

  push(rtp) {
    if (!rtp || !rtp.payload.length) return null;
    if (rtp.payloadType === 127) {
      this.stats.fec += 1;
      return null;
    }
    if (rtp.payloadType !== 97) return null;
    this.stats.packets += 1;
    this.stats.bytes += rtp.payload.length;
    return { codec: 'opus', data: rtp.payload };
  }
}

module.exports = {
  parseRtp,
  parseVideoPayload,
  VideoDepacketizer,
  AudioDepacketizer,
  FLAG_EOF,
  FLAG_SOF,
  FLAG_CONTAINS_PIC_DATA,
  NV_VIDEO_PACKET_BYTES,
  ENC_VIDEO_HEADER_BYTES,
  START_CODE,
};
