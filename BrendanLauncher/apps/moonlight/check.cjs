'use strict';
// App check: the same shape as media-machine's check.cjs, plus the ABI-1
// invariants that matter for a shader-only app.
//
//   node check.cjs            structural checks (manifest, assets, SPIR-V)
//   node check.cjs --compute  ... plus the launcher's game-compute-check, when
//                             a built launcher checkout provides the binary

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APP = __dirname;
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(APP, file), 'utf8'));
}

const manifest = readJson('app.json');
const layout = readJson('layout.json');
const textGlsl = fs.readFileSync(path.join(APP, 'shaders', 'text.glsl'), 'utf8');

check(manifest.format === 'hblauncher.gpu-app', 'app.json format must be hblauncher.gpu-app');
check(manifest.abi === 1, 'app.json abi must be 1');
check(manifest.id === 'moonlight', 'app.json id must be moonlight');
check(!manifest.code, 'a GPU app must not ship CPU code (app.json.code)');

// Shaders compiled by build.cjs.
for (const stage of ['vertex', 'fragment', 'compute']) {
  const file = manifest.shaders[stage];
  check(Boolean(file), `app.json must declare a ${stage} shader`);
  if (!file) continue;
  const spv = path.join(APP, file);
  check(fs.existsSync(spv), `missing compiled shader ${file}`);
  if (fs.existsSync(spv)) {
    const bytes = fs.readFileSync(spv);
    check(bytes.length > 20 && bytes.readUInt32LE(0) === 0x07230203, `${file} is not SPIR-V`);
  }
}

// Assets referenced by the manifest.
const dataPath = path.join(APP, manifest.data);
check(fs.existsSync(dataPath), `missing data asset ${manifest.data}`);
if (fs.existsSync(dataPath)) {
  const size = fs.statSync(dataPath).size;
  check(
    size === layout.atlas.width * layout.atlas.height,
    `data asset must be exactly the ${layout.atlas.width}x${layout.atlas.height} atlas`,
  );
}
const statePath = path.join(APP, manifest.initialState);
check(fs.existsSync(statePath), `missing initial state ${manifest.initialState}`);
if (fs.existsSync(statePath)) {
  check(fs.statSync(statePath).size === 1024, 'initialState must be 1024 bytes');
}
check(fs.existsSync(path.join(APP, manifest.icon)), `missing icon ${manifest.icon}`);

// Audio effects: every ring slot and UI sound needs a whole stereo s16le file.
const effects = Object.entries((manifest.audio && manifest.audio.effects) || {});
check(manifest.audio && manifest.audio.format === 's16le', 'audio format must be s16le');
check(manifest.audio && manifest.audio.sampleRate === 48000, 'audio sample rate must be 48000');
check(manifest.audio && manifest.audio.channels === 2, 'audio must be stereo');
const ring = layout.audio.ringSlots;
check(effects.length === ring + 2, `expected ${ring + 2} audio effects (2 UI + ${ring} chunks), found ${effects.length}`);
for (const [, file] of effects) {
  const target = path.join(APP, file);
  check(fs.existsSync(target), `missing audio effect ${file}`);
  if (!fs.existsSync(target)) continue;
  const size = fs.statSync(target).size;
  check(size > 0, `audio effect ${file} is empty`);
  check(size % 4 === 0, `audio effect ${file} is not whole 16-bit stereo frames`);
}

// The stream declaration is what makes playback gapless in the launcher: every
// ring id must be declared, the ring must match layout.json, and every chunk must
// be exactly one layout-sized chunk of PCM.
const ringIds = [];
for (let index = 0; index < layout.audio.ringSlots; index++) {
  ringIds.push(layout.audio.ringFirstSlot + index);
}
const declaredStream = (manifest.audio && manifest.audio.stream) || [];
check(Array.isArray(declaredStream), 'app.json audio.stream must be a list of effect ids');
check(
  declaredStream.length === ringIds.length && ringIds.every(id => declaredStream.includes(id)),
  `audio.stream must be exactly ${ringIds.join(',')} (got ${declaredStream.join(',') || 'nothing'})`,
);
for (const id of declaredStream) {
  const file = (manifest.audio.effects || {})[String(id)];
  check(Boolean(file), `audio.stream id ${id} is not a declared effect`);
  if (!file) continue;
  const target = path.join(APP, file);
  check(fs.existsSync(target), `missing stream chunk ${file}`);
  if (!fs.existsSync(target)) continue;
  const size = fs.statSync(target).size;
  const expected = (layout.audio.sampleRate * layout.audio.channels * 2 * layout.audio.chunkMs) / 1000;
  check(size === expected, `stream chunk ${file} is ${size} bytes, expected ${expected}`);
}
for (const id of [layout.audio.clickEffect, layout.audio.errorEffect]) {
  const file = (manifest.audio.effects || {})[String(id)];
  check(Boolean(file), `UI sound ${id} is missing from the manifest`);
  if (!file) continue;
  const target = path.join(APP, file);
  check(fs.existsSync(target), `missing UI sound ${file}`);
  if (fs.existsSync(target)) {
    check(fs.statSync(target).size < 48000, `UI sound ${file} is longer than half a second`);
  }
}
check(
  layout.audio.leadChunks >= 1 && layout.audio.leadChunks < layout.audio.ringSlots,
  'audio.leadChunks must be at least 1 and smaller than the ring',
);
const computeSource = fs.readFileSync(path.join(APP, 'shaders', 'app.comp'), 'utf8');
check(computeSource.includes('AUDIO_LEAD'), 'app.comp must pace audio with AUDIO_LEAD');
check(computeSource.includes('c.events.z'), 'app.comp must read the launcher audio ack');

// Generated GLSL must exist and describe the same memory map as layout.json.
check(textGlsl.includes('const uint HDR_WORD'), 'text.glsl is missing the header word offset');
check(
  textGlsl.includes(`const uint BAND_WORD = ${(layout.band.offset - layout.buffer.appDataOffset) / 4}u`),
  'text.glsl band offset disagrees with layout.json',
);

// Never let a packed asset push past the 7 MiB app-data limit.
const packaged = [manifest.data];
let packagedBytes = 0;
for (const file of packaged) {
  const target = path.join(APP, file);
  if (fs.existsSync(target)) packagedBytes += fs.statSync(target).size;
}
check(packagedBytes < 7 * 1024 * 1024, `packaged assets exceed the 7 MiB limit (${packagedBytes})`);

// The runtime bridge must load with this layout.
try {
  require('./host/layout.cjs');
  require('./host/bridge.cjs');
} catch (error) {
  failures.push(`host bridge failed to load: ${error.message}`);
}

if (process.argv.includes('--compute')) {
  const candidates = [
    process.env.GAME_COMPUTE_CHECK,
    path.join(APP, '..', '..', 'build', 'game-compute-check'),
  ].filter(Boolean);
  const binary = candidates.find(file => fs.existsSync(file));
  if (!binary) {
    console.log('[CHECK] game-compute-check not found; skipping the compute simulation');
  } else {
    try {
      execFileSync(binary, [APP], { stdio: 'inherit' });
      console.log('[CHECK] compute simulation passed');
    } catch (error) {
      failures.push(`compute simulation failed: ${error.message}`);
    }
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`[CHECK] ${failure}`);
  console.error(`[CHECK] ${failures.length} problem(s) found`);
  process.exit(1);
}
console.log('[CHECK] Moonlight GPU app is consistent');
