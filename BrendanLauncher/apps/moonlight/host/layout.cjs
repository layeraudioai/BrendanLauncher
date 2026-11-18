'use strict';
// Shared ABI-1 memory map for the Moonlight GPU app.
//
// Everything here mirrors shaders/text.glsl, which assets.py generates from the
// same layout.json. Nothing in this file may drift from that file: the tests
// compare the generated GLSL constants against these values.

const fs = require('node:fs');
const path = require('node:path');

const RAW = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'layout.json'), 'utf8'));

const APP_DATA_OFFSET = RAW.buffer.appDataOffset;
const wordIndex = absolute => (absolute - APP_DATA_OFFSET) / 4;
const assertWord = absolute => {
  if ((absolute - APP_DATA_OFFSET) % 4) throw Error(`Offset ${absolute} is not word aligned`);
  return wordIndex(absolute);
};

const HEADER = {
  magic: 0,
  version: 1,
  frameSeq: 2,
  frameSlot: 3,
  videoWidth: 4,
  videoHeight: 5,
  flags: 6,
  bandSeq: 7,
  scene: 8,
  status: 9,
  items: 10,
  selected: 11,
  audioSeq: 12,
  audioSlot: 13,
  audioConsumed: 14,
  hosts: 16,
  games: 17,
  fps: 18,
  latency: 19,
  itemsBase: 24,
  itemsStride: 5,
  cmd: 192,
  cmdArg0: 193,
  cmdArg1: 194,
  cmdSeq: 195,
  cmdAck: 196,
  cmdStatus: 197,
  words: 256,
};

// ABI `events` uvec4 (bytes 976..991): x sequence, y sound id, z chunks the
// launcher's audio service has queued, w spare. `hbSound` writes x/y; z is
// written back by the launcher so a stream can pace itself.
const EVENTS_OFFSET = 976;
const EVENTS_QUEUED = EVENTS_OFFSET + 8;

const FLAG = { video: 1, streaming: 2, busy: 4 };
const SCENE = { hosts: 0, games: 1, pair: 2, stream: 3, message: 4 };
const CMD = {
  none: 0,
  pair: 1,
  openHost: 2,
  openGame: 3,
  refresh: 4,
  start: 5,
  stop: 6,
  quit: 7,
  back: 8,
  retry: 9,
};
const CMD_NAMES = Object.fromEntries(Object.entries(CMD).map(([name, id]) => [id, name]));

const layout = {
  raw: RAW,
  buffer: RAW.buffer,
  atlas: { ...RAW.atlas, word: assertWord(RAW.atlas.offset) },
  band: {
    ...RAW.band,
    word: assertWord(RAW.band.offset),
    bytes: RAW.band.width * RAW.band.height,
  },
  header: { ...RAW.header, word: assertWord(RAW.header.offset) },
  EVENTS_OFFSET,
  EVENTS_QUEUED,
  video: {
    ...RAW.video,
    word: assertWord(RAW.video.offset),
    strideWords: RAW.video.bytesPerSlot / 4,
  },
  audio: { ...RAW.audio },
  // UI constants in screen pixels (the 1920x1080 canvas). Band drawing divides
  // by `band.scale`; the item table and the shader use screen pixels directly.
  screen: { width: 1920, height: 1080 },
  key: {
    fontTitle: 34,
    fontItem: 26,
    fontBody: 20,
    fontSmall: 16,
    fontTiny: 14,
    rowHeight: 104,
    videoFps: 60,
  },
  HEADER,
  FLAG,
  SCENE,
  CMD,
  CMD_NAMES,
  APP_DATA_OFFSET,
  wordIndex,
  // Header word helpers (word index inside the header block).
  headerOffset: index => RAW.header.offset + index * 4,
  itemOffset: (index, field) =>
    RAW.header.offset + (HEADER.itemsBase + index * HEADER.itemsStride + field) * 4,
  videoOffset: slot => RAW.video.offset + slot * RAW.video.bytesPerSlot,
  audioEffectFile: slot => path.join(__dirname, '..', 'assets', `audio_${slot}.pcm`),
};

// Fail loudly at load time if a layout change would collide with SDK memory.
function validate() {
  const atlasEnd = layout.atlas.offset + layout.atlas.width * layout.atlas.height;
  const bandEnd = layout.band.offset + layout.band.bytes;
  const headerEnd = layout.header.offset + layout.header.size;
  const videoEnd = layout.video.offset + layout.video.bytesPerSlot * layout.video.slots;
  if (layout.atlas.offset < APP_DATA_OFFSET) throw Error('Atlas overlaps ABI control bytes');
  if (bandEnd > layout.header.offset) throw Error('Text band overlaps the header block');
  if (atlasEnd > layout.band.offset) throw Error('Atlas overlaps the text band');
  if (headerEnd > layout.video.offset) throw Error('Header block overlaps the video slots');
  if (videoEnd > layout.buffer.sdkReservedOffset) throw Error('Video slots overlap SDK memory');
  if (layout.video.bytesPerSlot !== layout.video.width * layout.video.height * 2) {
    throw Error('Video slot size does not match RGB565 dimensions');
  }
  const itemTableEnd = HEADER.itemsBase + 32 * HEADER.itemsStride;
  if (itemTableEnd > HEADER.cmd) throw Error('Item table overlaps the command block');
  if (HEADER.cmdStatus >= HEADER.words) throw Error('Command block exceeds the header block');
  return true;
}

validate();

module.exports = layout;
