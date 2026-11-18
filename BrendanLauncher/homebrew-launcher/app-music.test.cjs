'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const music = require('../tools/abi1-studio/music-engine.js');
const { renderMusic, SAMPLE_RATE } = require('./app-music.cjs');

test('ABIM note arrangements render to bounded hardware stereo PCM', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'abi1-music-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const project = music.createSeededMusic('hardware music test');
  const file = path.join(directory, 'test.abim');
  await fs.writeFile(file, music.encodeAbim(project));
  const pcmPath = await renderMusic(file, path.join(directory, 'cache'), 'fixture-v1');
  const pcm = await fs.readFile(pcmPath);
  assert.ok(pcm.length > SAMPLE_RATE * 4);
  assert.equal(pcm.length % 4, 0);
  assert.ok(pcm.some(value => value !== 0));
  assert.equal(await renderMusic(file, path.join(directory, 'cache'), 'fixture-v1'), pcmPath);
});

test('ABIM render enforces bounded hardware playback duration', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'abi1-music-limit-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const project = music.createSeededMusic('duration limit');
  project.tracks[0].clips[0].startBeat = 600 * project.bpm / 60;
  const file = path.join(directory, 'long.abim');
  await fs.writeFile(file, music.encodeAbim(project));
  await assert.rejects(() => renderMusic(file, path.join(directory, 'cache')), /300-second hardware playback limit/);
});
