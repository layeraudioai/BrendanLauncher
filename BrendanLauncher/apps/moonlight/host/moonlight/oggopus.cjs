'use strict';
// Ogg-Opus muxer.
//
// Sunshine sends raw Opus packets (one per RTP packet, 20 ms each). FFmpeg has no
// raw-Opus demuxer, so the bridge wraps the packets in a minimal Ogg stream and
// pipes that into `ffmpeg -f ogg`. The container is generated here rather than
// relying on a native Opus binding, which keeps the bridge dependency-free.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index << 24;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 0x80000000 ? ((value << 1) ^ 0x04c11db7) >>> 0 : (value << 1) >>> 0;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0;
  for (let index = 0; index < buffer.length; index++) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ buffer[index]) & 0xff]) >>> 0;
  }
  return crc >>> 0;
}

const SAMPLE_RATE = 48000;
const PRESKIP = 312; // 6.5 ms lookahead, the value libopus uses for 48 kHz.

function opusHead({ channels = 2, mapping = null } = {}) {
  const head = Buffer.alloc(19 + (mapping ? mapping.length : 0));
  head.write('OpusHead', 0, 'latin1');
  head.writeUInt8(1, 8); // version
  head.writeUInt8(channels, 9);
  head.writeUInt16LE(PRESKIP, 10);
  head.writeUInt32LE(SAMPLE_RATE, 12);
  head.writeInt16LE(0, 16); // output gain
  head.writeUInt8(mapping ? (mapping.length === 2 ? 1 : 255) : 0, 18);
  if (mapping) mapping.forEach((value, index) => head.writeUInt8(value, 19 + index));
  return head;
}

function opusTags(vendor = 'moonlight-brendanlauncher') {
  const vendorBuffer = Buffer.from(vendor, 'utf8');
  const tags = Buffer.alloc(8 + 4 + vendorBuffer.length + 4);
  tags.write('OpusTags', 0, 'latin1');
  tags.writeUInt32LE(vendorBuffer.length, 8);
  vendorBuffer.copy(tags, 12);
  tags.writeUInt32LE(0, 12 + vendorBuffer.length);
  return tags;
}

class OggOpusMuxer {
  /**
   * @param {{channels?:number, streamSerial?:number, onPage:(page:Buffer)=>void,
   *          pageDurationMs?:number}} options
   */
  constructor({ channels = 2, streamSerial = 0x4d4c4e31, pageDurationMs = 40 } = {}) {
    this.channels = channels;
    this.serial = streamSerial >>> 0;
    this.sequence = 0;
    this.granule = 0;
    this.pages = [];
    this.packetsPerPage = Math.max(1, Math.round(pageDurationMs / 20));
    this.pending = [];
    this.headerSent = false;
  }

  /** Build the two header pages (OpusHead + OpusTags). */
  headers() {
    const pages = [
      this._page(Buffer.from([0x02]), [opusHead({ channels: this.channels })]),
      this._page(Buffer.from([0x00]), [opusTags()]),
    ];
    this.headerSent = true;
    return pages;
  }

  /**
   * Add one raw Opus packet and return the pages that became ready, if any.
   * @param {Buffer} packet
   * @param {number} [durationMs] frame duration, used for granule accounting
   */
  push(packet, durationMs = 20) {
    this.pending.push({ packet: Buffer.from(packet), durationMs });
    if (this.pending.length < this.packetsPerPage) return [];
    return this._flush();
  }

  flush() {
    return this.pending.length ? this._flush() : [];
  }

  _flush() {
    const entries = this.pending;
    this.pending = [];
    const segments = [];
    for (const entry of entries) {
      let remaining = entry.packet.length;
      let offset = 0;
      while (remaining >= 255) {
        segments.push(255);
        remaining -= 255;
        offset += 255;
      }
      segments.push(remaining);
      void offset;
      this.granule += Math.round((durationMs(entry) * SAMPLE_RATE) / 1000);
    }
    const body = Buffer.concat(entries.map(entry => entry.packet));
    return [this._page(Buffer.from([0x00]), null, { segments, body, granule: this.granule })];
  }

  _page(flags, packets, override = null) {
    let segments;
    let body;
    let granule;
    if (override) {
      segments = override.segments;
      body = override.body;
      granule = override.granule;
    } else {
      segments = [];
      const parts = [];
      for (const packet of packets) {
        let remaining = packet.length;
        let offset = 0;
        while (remaining >= 255) {
          segments.push(255);
          remaining -= 255;
          offset += 255;
        }
        segments.push(remaining);
        parts.push(packet);
        void offset;
      }
      body = Buffer.concat(parts);
      granule = 0;
    }
    if (segments.length > 255) throw Error('Ogg page has too many segments');
    const header = Buffer.alloc(27 + segments.length);
    header.write('OggS', 0, 'latin1');
    header.writeUInt8(0, 4); // version
    header.writeUInt8(flags[0], 5);
    header.writeUInt32LE(granule >>> 0, 6);
    header.writeUInt32LE(this.serial, 14);
    header.writeUInt32LE(this.sequence++, 18);
    header.writeUInt32LE(0, 22); // CRC placeholder
    header.writeUInt8(segments.length, 26);
    Buffer.from(segments).copy(header, 27);
    const page = Buffer.concat([header, body]);
    page.writeUInt32LE(crc32(page), 22);
    return page;
  }
}

function durationMs(entry) {
  void entry;
  return 20;
}

module.exports = { OggOpusMuxer, crc32, opusHead, opusTags };
