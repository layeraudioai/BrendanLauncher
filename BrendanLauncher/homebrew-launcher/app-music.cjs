'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const musicApi = require('../tools/abi1-studio/music-engine.js');

const SAMPLE_RATE = 48000;
const CHUNK_FRAMES = 4096;
const MAX_SECONDS = 300;
const MAX_NOTES = 100000;
const MAX_POLYPHONY = 128;
const MAX_NOTE_SAMPLE_FRAMES = 96 * 1024 * 1024;
const MAX_AUDIO_BYTES = 96 * 1024 * 1024;
const clamp16 = value => Math.max(-32768, Math.min(32767, Math.round(value)));

async function decodeEmbeddedTrack(track, file, bpm) {
  const bytes = Buffer.from(track.data, 'base64');
  if (!bytes.length || bytes.length > 24 * 1024 * 1024) throw Error(`Embedded audio track ${track.name} is empty or exceeds 24 MiB`);
  await new Promise((resolve, reject) => {
    const ffmpeg = process.env.FFMPEG || 'ffmpeg';
    const child = spawn(ffmpeg, ['-v', 'error', '-y', '-i', 'pipe:0', '-t', String(MAX_SECONDS), '-vn', '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', String(SAMPLE_RATE), '-ac', '2', file], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { if (stderr.length < 4096) stderr += chunk.toString(); });
    child.once('error', error => reject(new Error(`ABIM embedded audio needs FFmpeg on the launcher host: ${error.message}`)));
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Could not decode ABIM audio ${track.name} with FFmpeg${stderr.trim() ? `: ${stderr.trim()}` : ''}`)));
    child.stdin.once('error', () => {});
    child.stdin.end(bytes);
  });
  const stat = await fs.stat(file);
  if (!stat.size || stat.size % 4 || stat.size > MAX_AUDIO_BYTES) throw Error(`Decoded ABIM audio ${track.name} is invalid or exceeds 96 MiB`);
  return { file, startFrame: Math.max(0, Math.round(track.startBeat * 60 / bpm * SAMPLE_RATE)), frames: stat.size / 4 };
}

async function renderMusic(abimFile, outputDirectory, fingerprint = path.basename(abimFile)) {
  const project = musicApi.decodeAbim(await fs.readFile(abimFile, 'utf8'));
  const flat = musicApi.flattenNotes(project);
  if (flat.notes.some(note => !Number.isFinite(note.start) || !Number.isFinite(note.duration) || !Number.isFinite(note.note) || !Number.isFinite(note.velocity) || note.start < 0 || note.duration < 0))
    throw Error('ABIM soundtrack contains invalid note data');
  if (flat.audioTracks.length && !process.env.FFMPEG) {
    const { spawnSync } = require('node:child_process');
    if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).error)
      throw Error('This ABIM soundtrack includes imported audio; install FFmpeg on the launcher host to decode it');
  }
  if (flat.notes.length > MAX_NOTES) throw Error(`ABIM soundtrack exceeds the ${MAX_NOTES} note hardware limit`);
  const preparedNotes = flat.notes.map(note => {
    const startFrame = Math.floor(note.start * SAMPLE_RATE);
    const endFrame = Math.ceil((note.start + note.duration) * SAMPLE_RATE);
    return { startFrame, endFrame, start: note.start, duration: note.duration,
      frequency: 440 * Math.pow(2, (note.note - 69) / 12),
      velocity: Math.max(0, Math.min(1, note.velocity)),
      attack: Math.max(1, Math.round(Math.min(0.012, note.duration * 0.2) * SAMPLE_RATE)),
      release: Math.max(1, Math.round(Math.min(0.015, note.duration * 0.25) * SAMPLE_RATE)) };
  }).sort((a, b) => a.startFrame - b.startFrame);
  let noteSampleFrames = 0;
  const noteEvents = [];
  for (const note of preparedNotes) {
    noteSampleFrames += Math.max(0, note.endFrame - note.startFrame);
    noteEvents.push([note.startFrame, 1], [note.endFrame, -1]);
  }
  if (noteSampleFrames > MAX_NOTE_SAMPLE_FRAMES) throw Error('ABIM soundtrack exceeds the bounded synthesis workload limit');
  noteEvents.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let polyphony = 0;
  for (const event of noteEvents) if ((polyphony += event[1]) > MAX_POLYPHONY)
    throw Error(`ABIM soundtrack exceeds the ${MAX_POLYPHONY}-note polyphony limit`);
  let duration = Math.max(1, flat.duration, ...flat.audioTracks.map(track => track.startBeat * 60 / project.bpm));
  if (duration > MAX_SECONDS) throw Error(`ABIM soundtrack exceeds the ${MAX_SECONDS}-second hardware playback limit`);
  await fs.mkdir(outputDirectory, { recursive: true });
  const tag = String(fingerprint).replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || 'music';
  const output = path.join(outputDirectory, `abim-${tag}.pcm`);
  try { if ((await fs.stat(output)).size > 0) return output; } catch (_) {}

  const decoded = [];
  try {
    for (let i = 0; i < flat.audioTracks.length; i++) {
      const track = flat.audioTracks[i];
      decoded.push(await decodeEmbeddedTrack(track, path.join(outputDirectory, `abim-${tag}-audio-${i}.pcm`), project.bpm));
    }
    duration = Math.max(duration, ...decoded.map(track => (track.startFrame + track.frames) / SAMPLE_RATE));
    if (duration > MAX_SECONDS) throw Error(`ABIM soundtrack exceeds the ${MAX_SECONDS}-second hardware playback limit`);
    const frames = Math.ceil(duration * SAMPLE_RATE);
    if (frames * 4 > MAX_AUDIO_BYTES) throw Error('Rendered ABIM soundtrack exceeds the hardware PCM cache limit');
    const handles = await Promise.all(decoded.map(item => fs.open(item.file, 'r')));
    const outputHandle = await fs.open(output, 'w');
    try {
      let nextNote = 0, activeNotes = [];
      for (let first = 0; first < frames; first += CHUNK_FRAMES) {
        const count = Math.min(CHUNK_FRAMES, frames - first), chunkEnd = first + count;
        const mix = new Float64Array(count * 2);
        while (nextNote < preparedNotes.length && preparedNotes[nextNote].startFrame < chunkEnd)
          activeNotes.push(preparedNotes[nextNote++]);
        activeNotes = activeNotes.filter(note => note.endFrame > first);
        for (const note of activeNotes) {
          const start = Math.max(first, note.startFrame);
          const end = Math.min(chunkEnd, note.endFrame);
          if (end <= start) continue;
          for (let frame = start; frame < end; frame++) {
            const elapsed = frame - note.startFrame;
            const remain = note.endFrame - frame;
            const envelope = Math.min(1, elapsed / note.attack) * Math.min(1, remain / note.release);
            const sample = Math.sin(2 * Math.PI * note.frequency * elapsed / SAMPLE_RATE) * envelope * note.velocity * 0.2 * 32767;
            const at = (frame - first) * 2;
            mix[at] += sample; mix[at + 1] += sample;
          }
        }
        for (let index = 0; index < decoded.length; index++) {
          const track = decoded[index], handle = handles[index];
          const sourceFrame = first - track.startFrame;
          if (sourceFrame + count <= 0 || sourceFrame >= track.frames) continue;
          const sourceStart = Math.max(0, sourceFrame), targetStart = Math.max(0, -sourceFrame);
          const sourceCount = Math.min(count - targetStart, track.frames - sourceStart);
          const pcm = Buffer.alloc(sourceCount * 4);
          const result = await handle.read(pcm, 0, pcm.length, sourceStart * 4);
          for (let frame = 0; frame < Math.floor(result.bytesRead / 4); frame++) {
            const target = (targetStart + frame) * 2;
            mix[target] += pcm.readInt16LE(frame * 4);
            mix[target + 1] += pcm.readInt16LE(frame * 4 + 2);
          }
        }
        const bytes = Buffer.alloc(count * 4);
        for (let frame = 0; frame < count * 2; frame++) bytes.writeInt16LE(clamp16(mix[frame]), frame * 2);
        await outputHandle.write(bytes);
      }
    } finally {
      await outputHandle.close();
      await Promise.all(handles.map(handle => handle.close()));
    }
  } catch (error) {
    await fs.rm(output, { force: true });
    throw error;
  }
  return output;
}

module.exports = { renderMusic, SAMPLE_RATE, CHUNK_FRAMES, MAX_SECONDS };
