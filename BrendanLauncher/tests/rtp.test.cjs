'use strict';
// RTP video/audio depacketisation, checked against hand-built packets that
// mirror Sunshine's wire format (RTP + NV_VIDEO_PACKET + H.264 payload).

const path = require('node:path');
const { test, assert, equal, run } = require('./harness.cjs');
const { parseRtp, VideoDepacketizer, AudioDepacketizer, FLAG_EOF, FLAG_CONTAINS_PIC_DATA } =
  require(path.join(__dirname, '..', 'apps', 'moonlight', 'host', 'moonlight', 'rtp.cjs'));

function rtpPacket({ payloadType = 96, sequence = 1, timestamp = 0, payload }) {
  const header = Buffer.alloc(12);
  header[0] = 0x80;
  header[1] = payloadType & 0x7f;
  header.writeUInt16BE(sequence, 2);
  header.writeUInt32BE(timestamp, 4);
  header.writeUInt32BE(0x11223344, 8);
  return Buffer.concat([header, payload]);
}

function videoPayload({ frameIndex, flags, data, extraFlags = 0 }) {
  const head = Buffer.alloc(16);
  head.writeUInt32LE(1, 0); // streamPacketIndex
  head.writeUInt32LE(frameIndex, 4);
  head.writeUInt8(flags, 8);
  head.writeUInt8(extraFlags, 9);
  return Buffer.concat([head, data]);
}

test('parseRtp reads the fixed header and skips CSRCs', () => {
  const packet = rtpPacket({ payload: Buffer.from([1, 2, 3]) });
  const rtp = parseRtp(packet);
  equal(rtp.payloadType, 96, 'payload type');
  equal(rtp.sequence, 1, 'sequence');
  deep(rtp.payload, [1, 2, 3]);

  const withCsrc = Buffer.concat([
    Buffer.from([0x82, 96, 0x00, 0x02, 0, 0, 0, 0, 0, 0, 0, 0]),
    Buffer.alloc(8, 0xaa),
    Buffer.from([9, 9]),
  ]);
  const parsed = parseRtp(withCsrc);
  equal(parsed.sequence, 2, 'sequence with CSRC');
  deep(parsed.payload, [9, 9]);
});

test('single NAL units become one Annex-B access unit', () => {
  const depacketizer = new VideoDepacketizer('h264');
  const nal = Buffer.from([0x67, 0x42, 0xe0, 0x1f, 0xde, 0xad]);
  const out = depacketizer.push(
    parseRtp(
      rtpPacket({
        payload: videoPayload({ frameIndex: 1, flags: FLAG_CONTAINS_PIC_DATA | FLAG_EOF, data: nal }),
      }),
    ),
  );
  assert(out, 'access unit produced');
  equal(out.subarray(0, 4).toString('hex'), '00000001', 'start code');
  equal(out.subarray(4).toString('hex'), nal.toString('hex'), 'NAL payload');
});

test('STAP-A aggregates NAL units', () => {
  const depacketizer = new VideoDepacketizer('h264');
  const first = Buffer.from([0x67, 0x01]);
  const second = Buffer.from([0x68, 0x02, 0x03]);
  const stap = Buffer.alloc(1 + 2 + first.length + 2 + second.length);
  stap.writeUInt8(24, 0);
  stap.writeUInt16BE(first.length, 1);
  first.copy(stap, 3);
  stap.writeUInt16BE(second.length, 3 + first.length);
  second.copy(stap, 5 + first.length);
  const out = depacketizer.push(
    parseRtp(rtpPacket({ payload: videoPayload({ frameIndex: 2, flags: 0x7, data: stap }) })),
  );
  assert(out, 'access unit produced');
  const hex = out.toString('hex');
  assert(hex.includes('000000016701'), 'first NAL present with start code');
  assert(hex.includes('0000000168020 3'.replace(' ', '')), 'second NAL present with start code');
});

test('FU-A fragments reassemble into a single NAL unit', () => {
  const depacketizer = new VideoDepacketizer('h264');
  const body = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
  const start = Buffer.concat([Buffer.from([0x7c, 0x85]), body.subarray(0, 2)]);
  const end = Buffer.concat([Buffer.from([0x7c, 0x45]), body.subarray(2)]);
  const first = depacketizer.push(
    parseRtp(rtpPacket({ payload: videoPayload({ frameIndex: 3, flags: FLAG_CONTAINS_PIC_DATA, data: start }) })),
  );
  equal(first, null, 'frame waits for EOF');
  const second = depacketizer.push(
    parseRtp(rtpPacket({ payload: videoPayload({ frameIndex: 3, flags: FLAG_CONTAINS_PIC_DATA | FLAG_EOF, data: end }) })),
  );
  assert(second, 'access unit produced');
  const hex = second.toString('hex');
  assert(hex.startsWith('0000000165aa'), 'reconstructed NAL header (type 5) and body');
  assert(hex.endsWith('bbccdd'), 'fragment body concatenated');
});

test('FEC and control payload types are ignored', () => {
  const depacketizer = new VideoDepacketizer('h264');
  const out = depacketizer.push({ payloadType: 0x61, payload: Buffer.alloc(32) });
  equal(out, null, 'no access unit from a FEC packet');
});

test('Opus audio packets are forwarded whole and FEC is dropped', () => {
  const depacketizer = new AudioDepacketizer();
  const packet = Buffer.from([0xfc, 0x01, 0x02, 0x03]);
  const out = depacketizer.push({ payloadType: 97, payload: packet });
  equal(out.codec, 'opus', 'codec');
  deep(out.data, packet);
  equal(depacketizer.stats.packets, 1, 'packet counter');
  equal(depacketizer.push({ payloadType: 127, payload: Buffer.alloc(16) }), null, 'FEC ignored');
  equal(depacketizer.push({ payloadType: 96, payload: Buffer.alloc(16) }), null, 'video PT ignored');
});

function deep(actual, expected) {
  equal(Buffer.from(actual).toString('hex'), Buffer.from(expected).toString('hex'), 'payload bytes');
}

run('rtp.test.cjs').then(ok => {
  process.exitCode = ok ? 0 : 1;
});
