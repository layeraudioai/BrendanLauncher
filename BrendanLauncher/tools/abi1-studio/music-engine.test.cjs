'use strict';
const assert = require('node:assert/strict');
const music = require('./music-engine.js');

const parsed = music.parseMml('t120 o4 l8 c d+ e. r8 [ceg]4 >c4');
assert.equal(parsed.bpm, 120);
assert.equal(parsed.events.length, 7);
assert.equal(parsed.events[0].note, 60);
assert.equal(parsed.events[1].note, 63);
assert.ok(parsed.events.at(-1).note > parsed.events[4].note);
assert.throws(() => music.parseMml('z4'), /Unsupported MML token/);
assert.throws(() => music.parseMml('[ceg'), /Unclosed MML chord/);

const project = { format: 'ABIM', version: 1, title: 'Test song', bpm: 120,
  melodies: [
    { id: 'lead-motif', name: 'Lead motif', source: 't120 o4 l8 c e g c5' },
    { id: 'bass-motif', name: 'Bass motif', source: 'o2 l4 c r4 c' }
  ],
  patterns: [{ id: 'verse', name: 'Verse', steps: [{ melodyId: 'lead-motif', delta: 0 }, { melodyId: 'lead-motif', delta: 7 }, { melodyId: 'bass-motif', delta: -12 }] }],
  tracks: [
    { type: 'sequence', id: 'lead-track', name: 'Lead', clips: [{ kind: 'pattern', ref: 'verse', startBeat: 0, repeat: 1, delta: 0 }] },
    { type: 'sequence', id: 'bass-track', name: 'Bass', clips: [{ kind: 'melody', ref: 'bass-motif', startBeat: 0, repeat: 1, delta: 0 }] }
  ] };
const canonical = music.validateProject(project);
assert.equal(canonical.melodies.length, 2, 'melody source is stored once');
assert.equal(canonical.patterns[0].steps[1].melodyId, 'lead-motif', 'patterns reference shared melody definitions');
assert.equal(canonical.tracks[0].clips[0].ref, 'verse', 'tracks call shared pattern definitions');
const flat = music.flattenNotes(canonical);
assert.ok(flat.notes.some(note => note.note === 67), 'pattern delta transposes a referenced melody');
assert.equal(flat.notes.filter(note => note.trackId === 'lead-track').length, 10);
const abim = music.encodeAbim(canonical);
assert.deepEqual(music.decodeAbim(abim), canonical);
assert.throws(() => music.decodeAbim('{"format":"bad"}'), /Invalid ABIM/);
const withAudio = { format: 'ABIM', version: 1, title: 'Audio', bpm: 120, melodies: [], patterns: [], tracks: [{ type: 'audio', id: 'clip', name: 'clip', mime: 'audio/mpeg', data: 'AQID', startBeat: 4 }] };
assert.deepEqual(music.decodeAbim(music.encodeAbim(withAudio)), music.validateProject(withAudio));
assert.throws(() => music.validateProject({ ...withAudio, tracks: [{ ...withAudio.tracks[0], data: 'not base64!' }] }), /Invalid or oversized/);
assert.throws(() => music.validateProject({ ...canonical, patterns: [{ id: 'bad', name: 'Bad', steps: [{ melodyId: 'missing', delta: 0 }] }] }), /unknown melody/);

const midi = music.exportMidi(canonical);
assert.equal(String.fromCharCode(...midi.slice(0, 4)), 'MThd');
const roundTrip = music.importMidi(midi);
assert.equal(roundTrip.tracks.length, 2);
assert.ok(roundTrip.melodies.length >= 2);
assert.ok(roundTrip.tracks.every(track => track.type === 'sequence'));
assert.ok(roundTrip.tracks.every(track => track.clips.every(clip => clip.kind === 'melody')));
const midiNotes = music.flattenNotes(roundTrip).notes.map(note => note.note).sort((a, b) => a - b);
assert.deepEqual(midiNotes, flat.notes.map(note => note.note).sort((a, b) => a - b));
assert.throws(() => music.importMidi(new Uint8Array([1, 2, 3])), /Truncated|Standard MIDI/);

const oldAbim = music.validateProject({ format: 'ABIM', version: 1, title: 'Old', bpm: 120, tracks: [{ type: 'mml', name: 'Legacy', source: 't120 o4 l8 c' }] });
assert.equal(oldAbim.melodies.length, 1);
assert.equal(oldAbim.tracks[0].clips[0].kind, 'melody');
assert.equal(oldAbim.tracks[0].clips[0].ref, oldAbim.melodies[0].id);
const seedA = music.createSeededMusic('abc123'), seedB = music.createSeededMusic('abc123');
assert.deepEqual(seedA, seedB);
assert.ok(seedA.patterns.length && seedA.tracks.some(track => track.clips.some(clip => clip.kind === 'pattern')));
console.log('ABI-1 music engine tests passed');
