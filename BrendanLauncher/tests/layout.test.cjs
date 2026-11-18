'use strict';
// The memory map is shared by three consumers: the generated GLSL, the Python
// asset baker and the host bridge. This test keeps them honest.

const fs = require('node:fs');
const path = require('node:path');
const { test, assert, equal, run } = require('./harness.cjs');

const APP = path.join(__dirname, '..', 'apps', 'moonlight');
const layout = require(path.join(APP, 'host', 'layout.cjs'));
const RAW = JSON.parse(fs.readFileSync(path.join(APP, 'layout.json'), 'utf8'));
const GLSL = fs.readFileSync(path.join(APP, 'shaders', 'text.glsl'), 'utf8');

function glslInt(name) {
  const match = new RegExp(`const (?:u?int) ${name} = (-?\\d+)u?;`).exec(GLSL);
  assert(match, `${name} is missing from text.glsl`);
  return Number(match[1]);
}

test('layout.json round-trips through host/layout.cjs', () => {
  equal(layout.atlas.offset, RAW.atlas.offset, 'atlas offset');
  equal(layout.band.bytes, RAW.band.width * RAW.band.height, 'band size');
  equal(layout.video.bytesPerSlot, RAW.video.width * RAW.video.height * 2, 'slot size');
  equal(layout.video.strideWords, RAW.video.bytesPerSlot / 4, 'slot stride in words');
});

test('generated GLSL agrees with layout.json', () => {
  equal(glslInt('BAND_WORD'), layout.band.word, 'band word offset');
  equal(glslInt('HDR_WORD'), layout.header.word, 'header word offset');
  equal(glslInt('VIDEO_WORD'), layout.video.word, 'video word offset');
  equal(glslInt('VIDEO_STRIDE'), layout.video.strideWords, 'video stride');
  equal(glslInt('VIDEO_WIDTH'), layout.video.width, 'video width');
  equal(glslInt('VIDEO_HEIGHT'), layout.video.height, 'video height');
  equal(glslInt('VIDEO_SLOTS'), layout.video.slots, 'video slots');
  equal(glslInt('BAND_WIDTH'), layout.band.width, 'band width');
  equal(glslInt('BAND_HEIGHT'), layout.band.height, 'band height');
  equal(glslInt('AUDIO_RING_SLOTS'), layout.audio.ringSlots, 'audio ring size');
  equal(glslInt('AUDIO_RING_FIRST'), layout.audio.ringFirstSlot, 'audio ring base');
});

test('header field indices are identical in GLSL and JS', () => {
  const names = {
    magic: 'H_MAGIC',
    version: 'H_VERSION',
    frameSeq: 'H_FRAME_SEQ',
    frameSlot: 'H_FRAME_SLOT',
    flags: 'H_FLAGS',
    bandSeq: 'H_BAND_SEQ',
    scene: 'H_SCENE',
    status: 'H_STATUS',
    items: 'H_ITEMS',
    selected: 'H_SELECTED',
    audioSeq: 'H_AUDIO_SEQ',
    audioSlot: 'H_AUDIO_SLOT',
    audioConsumed: 'H_AUDIO_CONSUMED',
    hosts: 'H_HOSTS',
    games: 'H_GAMES',
    fps: 'H_FPS',
    latency: 'H_LATENCY',
    itemsBase: 'H_ITEMS_BASE',
    cmd: 'H_CMD',
    cmdArg0: 'H_CMD_ARG0',
    cmdArg1: 'H_CMD_ARG1',
    cmdSeq: 'H_CMD_SEQ',
    cmdAck: 'H_CMD_ACK',
    cmdStatus: 'H_CMD_STATUS',
  };
  for (const [field, glslName] of Object.entries(names)) {
    equal(glslInt(glslName), layout.HEADER[field], `header.${field}`);
  }
});

test('regions never overlap and stay out of SDK memory', () => {
  // layout.cjs validates on load; reaching here means the invariants hold.
  const atlasEnd = layout.atlas.offset + layout.atlas.width * layout.atlas.height;
  const bandEnd = layout.band.offset + layout.band.bytes;
  const headerEnd = layout.header.offset + layout.header.size;
  const videoEnd = layout.video.offset + layout.video.bytesPerSlot * layout.video.slots;
  assert(atlasEnd <= layout.band.offset, 'atlas must end before the band');
  assert(bandEnd <= layout.header.offset, 'band must end before the header');
  assert(headerEnd <= layout.video.offset, 'header must end before the video slots');
  assert(videoEnd <= layout.buffer.sdkReservedOffset, 'video slots must stay below SDK memory');
  const itemTableEnd = layout.HEADER.itemsBase + 32 * layout.HEADER.itemsStride;
  assert(itemTableEnd <= layout.HEADER.cmd, 'item table must not reach the command block');
  assert(layout.HEADER.cmdStatus < layout.HEADER.words, 'command block must fit the header');
});

test('every header word index is addressable inside the header block', () => {
  for (const [name, index] of Object.entries(layout.HEADER)) {
    if (name === 'words' || name === 'itemsBase' || name === 'itemsStride') continue;
    assert(Number.isInteger(index) && index >= 0 && index < layout.HEADER.words, `header.${name}`);
  }
});

run('layout.test.cjs').then(ok => {
  process.exitCode = ok ? 0 : 1;
});
