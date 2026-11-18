'use strict';
// Checks that the Ogg-Opus muxer produces a container FFmpeg accepts: a tone is
// encoded with FFmpeg, its Opus packets are extracted, re-muxed by our muxer and
// decoded again. Skipped when FFmpeg (or its Opus encoder) is unavailable.

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test, assert, equal, run } = require('./harness.cjs');
const { OggOpusMuxer, crc32 } = require(
  path.join(__dirname, '..', 'apps', 'moonlight', 'host', 'moonlight', 'oggopus.cjs'),
);

function hasFfmpeg() {
  const check = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-version'], {
    encoding: 'utf8',
  });
  return check.status === 0;
}

function ffmpeg(args, input) {
  return spawnSync(process.env.FFMPEG || 'ffmpeg', args, { input, maxBuffer: 64 * 1024 * 1024 });
}

/** Return the Opus packets of an Ogg file (skipping OpusHead/OpusTags). */
function oggPackets(file) {
  const packets = [];
  let offset = 0;
  while (offset + 27 <= file.length) {
    if (file.subarray(offset, offset + 4).toString('latin1') !== 'OggS') break;
    const segmentCount = file.readUInt8(offset + 26);
    const segmentTable = file.subarray(offset + 27, offset + 27 + segmentCount);
    let bodyOffset = offset + 27 + segmentCount;
    let packet = Buffer.alloc(0);
    for (const size of segmentTable) {
      packet = Buffer.concat([packet, file.subarray(bodyOffset, bodyOffset + size)]);
      bodyOffset += size;
      if (size < 255) {
        packets.push(packet);
        packet = Buffer.alloc(0);
      }
    }
    offset = bodyOffset;
  }
  return packets;
}

test('crc32 matches the Ogg specification vector', () => {
  // The Ogg CRC is a non-reflected CRC-32 with polynomial 0x04c11db7.
  equal(crc32(Buffer.from('OggS')), 0x5fb0a94f, 'CRC of "OggS"');
});

test('muxer emits headers and pages that FFmpeg decodes', () => {
  if (!hasFfmpeg()) {
    console.log('       (skipped: ffmpeg not available)');
    return;
  }
  const encoded = ffmpeg(
    ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5',
      '-c:a', 'libopus', '-b:a', '64k', '-ar', '48000', '-ac', '2', '-f', 'ogg', 'pipe:1'],
    Buffer.alloc(0),
  );
  if (encoded.status !== 0 || !encoded.stdout || !encoded.stdout.length) {
    console.log('       (skipped: ffmpeg has no libopus encoder)');
    return;
  }
  const packets = oggPackets(encoded.stdout).slice(2);
  assert(packets.length > 4, 'encoded stream produced Opus packets');

  const muxer = new OggOpusMuxer({ channels: 2 });
  const pages = [...muxer.headers()];
  for (const packet of packets) pages.push(...muxer.push(packet));
  pages.push(...muxer.flush());
  const ogg = Buffer.concat(pages);
  equal(ogg.subarray(0, 4).toString('latin1'), 'OggS', 'container signature');

  const decoded = ffmpeg(
    ['-hide_banner', '-loglevel', 'error', '-f', 'ogg', '-i', 'pipe:0',
      '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
    ogg,
  );
  if (decoded.status !== 0) {
    throw Error(`FFmpeg rejected the muxed stream: ${decoded.stderr.toString().slice(0, 300)}`);
  }
  const pcm = decoded.stdout;
  assert(pcm.length > 48000, `decoded ${pcm.length} bytes of PCM`);
  // 0.5 s of 48 kHz stereo s16le is 96000 bytes; allow for preskip and framing.
  assert(pcm.length > 80000, 'decoded roughly the encoded duration');
});

run('oggopus.test.cjs').then(ok => {
  process.exitCode = ok ? 0 : 1;
});
