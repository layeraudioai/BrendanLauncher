'use strict';
// End-to-end exercise of the ABI-1 pipeline with an in-memory stand-in for the
// launcher's RPC bridge: band text, item table, header, video slots, audio ring
// and the console -> host command/input path.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, assert, equal, fakeRpc, run } = require('./harness.cjs');

const APP = path.join(__dirname, '..', 'apps', 'moonlight');
const layout = require(path.join(APP, 'host', 'layout.cjs'));
const { Bridge } = require(path.join(APP, 'host', 'bridge.cjs'));
const { DemoBackend } = require(path.join(APP, 'host', 'backends', 'demo.cjs'));

const { HEADER, FLAG, SCENE, CMD, videoOffset, headerOffset } = layout;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function headerWord(memory, field) {
  return memory.readUInt32LE(headerOffset(field));
}

function writeHeaderWord(memory, field, value) {
  memory.writeUInt32LE(value >>> 0, headerOffset(field));
}

async function command(memory, cmd, arg0 = 0) {
  const sequence = headerWord(memory, HEADER.cmdSeq) + 1;
  writeHeaderWord(memory, HEADER.cmd, cmd);
  writeHeaderWord(memory, HEADER.cmdArg0, arg0);
  writeHeaderWord(memory, HEADER.cmdSeq, sequence);
  return sequence;
}

async function waitFor(predicate, description, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await delay(25);
  }
  throw Error(`timed out waiting for ${description}`);
}

async function withBridge(fn) {
  const rpc = fakeRpc();
  const backend = new DemoBackend();
  await backend.init();
  const bridge = new Bridge({ rpc, mapped: 0, directory: os.tmpdir(), backend, logger: () => {} });
  await bridge.start();
  try {
    await fn({ rpc, bridge, backend, memory: rpc.memory });
  } finally {
    await bridge.close();
    await backend.close();
  }
}

test('startup publishes a magic header, scene and painted band', () =>
  withBridge(async ({ memory }) => {
    equal(headerWord(memory, HEADER.magic), 0x4e4c424d, 'header magic');
    equal(headerWord(memory, HEADER.version), 1, 'header version');
    equal(headerWord(memory, HEADER.scene), SCENE.hosts, 'initial scene');
    equal(headerWord(memory, HEADER.videoWidth), layout.video.width, 'published width');
    const band = memory.subarray(layout.band.offset, layout.band.offset + layout.band.bytes);
    assert(band.some(value => value !== 0), 'band contains drawn pixels');
    const hosts = headerWord(memory, HEADER.hosts);
    assert(hosts >= 1, 'demo hosts were listed');
  }));

test('opening a host switches scene, paints items and acknowledges the command', () =>
  withBridge(async ({ memory, bridge }) => {
    const sequence = await command(memory, CMD.openHost, 0);
    await waitFor(
      () => headerWord(memory, HEADER.scene) === SCENE.games,
      'scene change to games',
    );
    await waitFor(
      () => headerWord(memory, HEADER.cmdAck) === sequence,
      'command acknowledgement',
    );
    equal(headerWord(memory, HEADER.cmdStatus), 0, 'command status ok');
    assert(headerWord(memory, HEADER.games) >= 1, 'games published');
    assert(headerWord(memory, HEADER.items) >= 1, 'item count published');
    // First item rectangle must be inside the canvas.
    const rect = [0, 1, 2, 3].map(field =>
      memory.readUInt32LE(headerOffset(HEADER.itemsBase + field)),
    );
    assert(rect[2] > 0 && rect[3] > 0, 'item rectangle has size');
    void bridge;
  }));

test('streaming fills the video slots, pumps audio and forwards input', () =>
  withBridge(async ({ memory, backend }) => {
    await command(memory, CMD.openHost, 0);
    await waitFor(() => headerWord(memory, HEADER.scene) === SCENE.games, 'games scene');
    await command(memory, CMD.start, 0);
    await waitFor(() => headerWord(memory, HEADER.scene) === SCENE.stream, 'stream scene');

    // The frame writer publishes a frame sequence once pixels are in place.
    await waitFor(() => headerWord(memory, HEADER.frameSeq) >= 1, 'first frame published', 6000);
    const flags = headerWord(memory, HEADER.flags);
    assert(flags & FLAG.streaming, 'streaming flag set');

    const slot = headerWord(memory, HEADER.frameSlot) % layout.video.slots;
    const base = videoOffset(slot);
    const pixels = memory.subarray(base, base + layout.video.bytesPerSlot);
    assert(pixels.some(value => value !== 0), 'video slot contains pixels');

    // The second slot must stay untouched until it is written, so a reader never
    // sees a half-updated picture.
    const other = videoOffset(slot === 0 ? 1 : 0);
    const otherPixels = memory.subarray(other, other + layout.video.bytesPerSlot);
    assert(otherPixels.every(value => value === 0) || headerWord(memory, HEADER.frameSeq) > 1,
      'alternate slot either clean or already used');

    // Audio chunks are published as effect files and announced in the header.
    await waitFor(() => headerWord(memory, HEADER.audioSeq) >= 1, 'first audio chunk', 6000);
    const audioSlot = headerWord(memory, HEADER.audioSlot);
    assert(
      audioSlot >= layout.audio.ringFirstSlot &&
        audioSlot < layout.audio.ringFirstSlot + layout.audio.ringSlots,
      `audio slot ${audioSlot} inside the ring`,
    );
    const chunk = path.join(APP, 'assets', `audio_${audioSlot}.pcm`);
    const size = fs.statSync(chunk).size;
    equal(size % 4, 0, 'PCM chunk is whole stereo frames');
    assert(size > 0, 'PCM chunk has samples');

    // Console pad state reaches the backend.
    memory.writeUInt32LE(0x0001, 8); // A pressed
    memory.writeUInt32LE(1, 32); // connected
    memory.writeInt32LE(12000, 16);
    await waitFor(() => /buttons 0x1/.test(backend.lastInput || ''), 'input forwarded');

    await command(memory, CMD.stop);
    await waitFor(() => headerWord(memory, HEADER.scene) === SCENE.games, 'back to games');
    equal(headerWord(memory, HEADER.flags) & FLAG.streaming, 0, 'streaming flag cleared');
  }));

test('pairing shows the PIN and returns to the host list afterwards', () =>
  withBridge(async ({ memory, bridge }) => {
    await command(memory, CMD.pair, 0);
    await waitFor(() => headerWord(memory, HEADER.scene) === SCENE.pair, 'pair scene');
    await waitFor(() => Boolean(bridge.state.pin), 'PIN generated');
    assert(/^\d{4}$/.test(bridge.state.pin), `PIN is four digits (${bridge.state.pin})`);
    await delay(2600); // the demo backend completes pairing after 2.5 s
    await command(memory, CMD.back);
    await waitFor(() => headerWord(memory, HEADER.scene) === SCENE.hosts, 'hosts scene');
  }));

test('close() clears streaming flags and stops timers', () =>
  withBridge(async ({ memory, bridge }) => {
    await bridge.close();
    equal(headerWord(memory, HEADER.flags), 0, 'flags cleared on close');
  }));

run('bridge.test.cjs').then(ok => {
  process.exitCode = ok ? 0 : 1;
});
