'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Abi1Music = api;
})(globalThis, function () {
  const MAX_MUSIC_BYTES = 40 * 1024 * 1024;
  const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
  const MAX_MIDI_BYTES = 16 * 1024 * 1024;
  const PPQ = 480;
  const NOTE_NAMES = ['c', 'c+', 'd', 'd+', 'e', 'f', 'f+', 'g', 'g+', 'a', 'a+', 'b'];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function noteNumber(name, octave, accidental = '') {
    const semitones = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
    let n = (octave + 1) * 12 + semitones[name.toLowerCase()];
    if (accidental === '+' || accidental === '#') n++;
    if (accidental === '-') n--;
    return clamp(n, 0, 127);
  }

  function parseMml(source, options = {}) {
    source = String(source || '');
    if (source.length > 65536) throw new Error('MML source exceeds 64 KiB');
    let bpm = clamp(Number(options.bpm) || 120, 20, 300);
    let octave = 4, defaultLength = 4, velocity = 0.75;
    let cursor = 0, index = 0;
    const events = [];
    const duration = (denom, dots) => {
      const base = 240 / bpm / denom;
      let factor = 1, add = 0.5;
      for (let i = 0; i < dots; i++, add /= 2) factor += add;
      return base * factor;
    };
    const emit = (match, at = cursor) => {
      const [, letter, accidental = '', length = '', dots = ''] = match;
      const seconds = duration(Number(length) || defaultLength, dots.length);
      if (letter.toLowerCase() === 'r') cursor = at + seconds;
      else {
        events.push({ start: at, duration: seconds, note: noteNumber(letter, octave, accidental), velocity });
        cursor = at + seconds;
      }
    };
    while (index < source.length) {
      const rest = source.slice(index).match(/^\s+/);
      if (rest) { index += rest[0].length; continue; }
      if (source[index] === ';') { const end = source.indexOf('\n', index); index = end < 0 ? source.length : end + 1; continue; }
      const command = source.slice(index).match(/^([a-z])\s*(-?\d+(?:\.\d+)?)/i);
      if (command && 't o l v'.includes(command[1].toLowerCase())) {
        const value = Number(command[2]);
        switch (command[1].toLowerCase()) {
          case 't': bpm = clamp(value, 20, 300); break;
          case 'o': octave = clamp(Math.trunc(value), 0, 8); break;
          case 'l': defaultLength = clamp(Math.trunc(value), 1, 64); break;
          case 'v': velocity = clamp(value > 1 ? value / 127 : value, 0, 1); break;
        }
        index += command[0].length;
        continue;
      }
      if (source[index] === '>' || source[index] === '<') {
        octave = clamp(octave + (source[index] === '>' ? 1 : -1), 0, 8); index++; continue;
      }
      if (source[index] === '[') {
        const end = source.indexOf(']', index + 1);
        if (end < 0) throw new Error(`Unclosed MML chord at character ${index + 1}`);
        const chordText = source.slice(index + 1, end);
        const notes = [...chordText.matchAll(/([a-gr])([+#-]?)(\d+)?(\.*)/gi)];
        if (!notes.length || notes.map(n => n[0]).join('').replace(/\s/g, '').toLowerCase() !== chordText.replace(/\s/g, '').toLowerCase())
          throw new Error(`Invalid MML chord at character ${index + 1}`);
        const after = source.slice(end + 1).match(/^(\d+)?(\.*)/);
        const chordLength = after && after[1] ? Number(after[1]) : null;
        const chordDots = after ? after[2].length : 0;
        const seconds = duration(chordLength || defaultLength, chordDots);
        for (const note of notes) if (note[1].toLowerCase() !== 'r')
          events.push({ start: cursor, duration: seconds, note: noteNumber(note[1], octave, note[2]), velocity });
        cursor += seconds;
        index = end + 1 + (after ? after[0].length : 0);
        continue;
      }
      const token = source.slice(index).match(/^([a-gr])([+#-]?)(\d+)?(\.*)/i);
      if (!token) throw new Error(`Unsupported MML token “${source[index]}” at character ${index + 1}`);
      emit(token);
      index += token[0].length;
    }
    return { bpm, events, duration: cursor };
  }

  function scheduleEnvelope(gain, start, end, velocity) {
    const duration = Math.max(0.001, end - start);
    const attack = Math.min(0.012, duration * 0.2);
    const releaseStart = Math.max(attack, duration - Math.min(0.015, duration * 0.25));
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(velocity * 0.2, start + attack);
    gain.gain.setValueAtTime(velocity * 0.2, start + releaseStart);
    gain.gain.linearRampToValueAtTime(0.0001, end);
  }

  function validateProject(value) {
    if (!value || value.format !== 'ABIM' || value.version !== 1 || !Array.isArray(value.tracks) || value.tracks.length > 64)
      throw new Error('Invalid ABIM music file');
    const project = { format: 'ABIM', version: 1, title: String(value.title || 'Untitled Music').slice(0, 128), bpm: clamp(Number(value.bpm) || 120, 20, 300), melodies: [], patterns: [], tracks: [] };
    const ids = new Set();
    const addId = (id, prefix) => {
      id = String(id || `${prefix}-${project.melodies.length + project.patterns.length + project.tracks.length + 1}`).toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate music ID: ${id}`);
      ids.add(id); return id;
    };
    for (const item of Array.isArray(value.melodies) ? value.melodies : []) {
      if (!item) throw new Error('Invalid ABIM melody');
      const melody = { id: addId(item.id, 'melody'), name: String(item.name || 'Melody').slice(0, 64), source: String(item.source || '') };
      parseMml(melody.source, { bpm: project.bpm }); project.melodies.push(melody);
    }
    const legacyTracks = [];
    for (const item of value.tracks) {
      if (item?.type === 'mml') {
        const id = addId(item.id || `melody-${project.melodies.length + 1}`, 'melody');
        const melody = { id, name: String(item.name || 'Melody').slice(0, 64), source: String(item.source || '') };
        parseMml(melody.source, { bpm: project.bpm }); project.melodies.push(melody);
        legacyTracks.push({ type: 'sequence', id: `${id}-track`, name: melody.name, clips: [{ kind: 'melody', ref: id, startBeat: 0, repeat: 1, delta: 0 }] });
      } else legacyTracks.push(item);
    }
    for (const item of Array.isArray(value.patterns) ? value.patterns : []) {
      if (!item || !Array.isArray(item.steps) || item.steps.length > 256) throw new Error('Invalid ABIM pattern');
      project.patterns.push({ id: addId(item.id, 'pattern'), name: String(item.name || 'Pattern').slice(0, 64), steps: item.steps.map(step => {
        if (!step || !project.melodies.some(m => m.id === step.melodyId)) throw new Error('Pattern references an unknown melody');
        return { melodyId: step.melodyId, delta: clamp(Math.trunc(Number(step.delta) || 0), -48, 48), repeat: clamp(Math.trunc(Number(step.repeat) || 1), 1, 64) };
      }) });
    }
    for (const item of legacyTracks) {
      if (!item || !['sequence', 'audio'].includes(item.type)) throw new Error('ABIM track type must be sequence or audio');
      if (item.type === 'sequence') {
        if (!Array.isArray(item.clips) || item.clips.length > 1024) throw new Error('Invalid ABIM track clips');
        project.tracks.push({ type: 'sequence', id: addId(item.id, 'track'), name: String(item.name || 'Track').slice(0, 64), clips: item.clips.map(clip => {
          if (!clip || !['melody', 'pattern'].includes(clip.kind)) throw new Error('Invalid music clip kind');
          const ref = String(clip.ref || '');
          if (clip.kind === 'melody' && !project.melodies.some(m => m.id === ref)) throw new Error('Track references an unknown melody');
          if (clip.kind === 'pattern' && !project.patterns.some(p => p.id === ref)) throw new Error('Track references an unknown pattern');
          const startBeat = Number(clip.startBeat ?? 0);
          if (!Number.isFinite(startBeat) || startBeat < 0 || startBeat > 1000000) throw new Error('Invalid music clip start beat');
          return { kind: clip.kind, ref, startBeat, repeat: clamp(Math.trunc(Number(clip.repeat) || 1), 1, 64), delta: clamp(Math.trunc(Number(clip.delta) || 0), -48, 48) };
        }) });
      } else {
        const data = String(item.data || '');
        if (!/^([A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data) || data.length > MAX_AUDIO_BYTES * 4 / 3 + 8)
          throw new Error('Invalid or oversized ABIM audio track');
        const startBeat = Number(item.startBeat ?? 0);
        if (!Number.isFinite(startBeat) || startBeat < 0 || startBeat > 1000000) throw new Error('Invalid audio clip position');
        project.tracks.push({ type: 'audio', id: addId(item.id, 'audio'), name: String(item.name || 'Audio').slice(0, 64), mime: String(item.mime || 'audio/mpeg').slice(0, 80), data, startBeat });
      }
    }
    if (!project.melodies.length && !project.tracks.some(t => t.type === 'audio')) {
      const id = addId('melody-1', 'melody'); project.melodies.push({ id, name: 'Melody 1', source: `t${project.bpm} o4 l8 c e g c5` });
      project.tracks.push({ type: 'sequence', id: addId('track-1', 'track'), name: 'Track 1', clips: [{ kind: 'melody', ref: id, startBeat: 0, repeat: 1, delta: 0 }] });
    }
    return project;
  }

  function flattenNotes(value) {
    const project = validateProject(value), melodies = new Map(project.melodies.map(m => [m.id, parseMml(m.source, { bpm: project.bpm })]));
    const notes = [], audioTracks = project.tracks.filter(t => t.type === 'audio');
    let duration = 0;
    function appendMelody(id, start, delta, trackId, repeats = 1) {
      const parsed = melodies.get(id);
      for (let repetition = 0; repetition < repeats; repetition++) {
        const offset = start + parsed.duration * repetition;
        for (const event of parsed.events) {
          const item = { trackId, start: offset + event.start, duration: event.duration, note: clamp(event.note + delta, 0, 127), velocity: event.velocity };
          notes.push(item); duration = Math.max(duration, item.start + item.duration);
        }
      }
      return parsed.duration * repeats;
    }
    for (const track of project.tracks) {
      if (track.type === 'audio') { duration = Math.max(duration, track.startBeat * 60 / project.bpm); continue; }
      for (const clip of track.clips) {
        let start = clip.startBeat * 60 / project.bpm;
        for (let repeat = 0; repeat < clip.repeat; repeat++) {
          if (clip.kind === 'melody') start += appendMelody(clip.ref, start, clip.delta, track.id);
          else {
            const pattern = project.patterns.find(p => p.id === clip.ref);
            for (const step of pattern.steps) start += appendMelody(step.melodyId, start, clip.delta + step.delta, track.id, step.repeat);
          }
        }
        duration = Math.max(duration, start);
      }
    }
    return { project, notes, audioTracks, duration };
  }

  function createSeededMusic(seed) {
    let hash = 2166136261;
    for (const char of String(seed)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    let state = hash >>> 0;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const bpm = 90 + Math.floor(random() * 61);
    const scale = [0, 2, 4, 7, 9];
    const phrase = length => Array.from({ length }, () => scale[Math.floor(random() * scale.length)]);
    const a = phrase(8), b = phrase(8);
    const melodySource = notes => `t${bpm} o4 l8 ${notes.map(n => `${['c','d','e','g','a'][scale.indexOf(n)]}`).join(' ')}`;
    return validateProject({ format: 'ABIM', version: 1, title: 'Seeded Soundtrack', bpm,
      melodies: [{ id: 'motif-a', name: 'Motif A', source: melodySource(a) }, { id: 'motif-b', name: 'Motif B', source: melodySource(b) }],
      patterns: [{ id: 'seed-verse', name: 'Seed Verse', steps: [{ melodyId: 'motif-a', delta: 0 }, { melodyId: 'motif-a', delta: 7 }, { melodyId: 'motif-b', delta: -12 }] }],
      tracks: [{ type: 'sequence', id: 'seed-lead', name: 'Lead', clips: [{ kind: 'pattern', ref: 'seed-verse', startBeat: 0 }] }, { type: 'sequence', id: 'seed-bass', name: 'Bass', clips: [{ kind: 'melody', ref: 'motif-b', startBeat: 0, delta: -24, repeat: 2 }] }] });
  }

  function encodeAbim(project) {
    const text = JSON.stringify(validateProject(project));
    if (new TextEncoder().encode(text).length > MAX_MUSIC_BYTES) throw new Error('ABIM music file exceeds 40 MiB');
    return text;
  }
  function decodeAbim(text) {
    if (typeof text !== 'string' || text.length > MAX_MUSIC_BYTES || new TextEncoder().encode(text).byteLength > MAX_MUSIC_BYTES) throw new Error('ABIM file is invalid or exceeds 40 MiB');
    let value;
    try { value = JSON.parse(text); } catch (error) { throw new Error(`Invalid ABIM JSON: ${error.message}`); }
    return validateProject(value);
  }

  function vlq(value) {
    let n = Math.max(0, Math.trunc(value)), buffer = n & 0x7f, bytes = [];
    while ((n >>= 7)) { buffer <<= 8; buffer |= ((n & 0x7f) | 0x80); }
    while (true) { bytes.push(buffer & 255); if (buffer & 0x80) buffer >>= 8; else break; }
    return bytes;
  }
  function chunk(id, data) { return [...id].map(c => c.charCodeAt(0)).concat([(data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255], data); }
  function exportMidi(value) {
    const { project, notes } = flattenNotes(value);
    const tracks = project.tracks.filter(track => track.type === 'sequence');
    if (!tracks.length || !notes.length) throw new Error('No playable MML clips to export to MIDI');
    const tempo = Math.round(60000000 / project.bpm);
    const midiTracks = tracks.map(track => {
      const name = new TextEncoder().encode(track.name);
      const events = [{ tick: 0, bytes: [0xff, 0x03, ...vlq(name.length), ...name] }];
      for (const note of notes.filter(item => item.trackId === track.id)) {
        const start = Math.round(note.start * project.bpm / 60 * PPQ);
        const end = Math.max(start + 1, Math.round((note.start + note.duration) * project.bpm / 60 * PPQ));
        events.push({ tick: start, bytes: [0x90, note.note, Math.round(note.velocity * 127)] });
        events.push({ tick: end, bytes: [0x80, note.note, 0] });
      }
      events.sort((a, b) => a.tick - b.tick || a.bytes[0] - b.bytes[0]);
      const data = [0, 0xff, 0x51, 3, (tempo >>> 16) & 255, (tempo >>> 8) & 255, tempo & 255];
      let previous = 0;
      for (const event of events) { data.push(...vlq(event.tick - previous), ...event.bytes); previous = event.tick; }
      data.push(0, 0xff, 0x2f, 0);
      return chunk('MTrk', data);
    });
    const header = chunk('MThd', [0, 1, (midiTracks.length >>> 8) & 255, midiTracks.length & 255, (PPQ >>> 8) & 255, PPQ & 255]);
    return new Uint8Array([...header, ...midiTracks.flat()]);
  }

  function importMidi(input) {
    const data = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (data.byteLength > MAX_MIDI_BYTES) throw new Error('MIDI file exceeds the 16 MiB import limit');
    let p = 0;
    const read32 = () => { if (p + 4 > data.length) throw new Error('Truncated MIDI file'); const n = data[p] * 0x1000000 + (data[p+1] << 16) + (data[p+2] << 8) + data[p+3]; p += 4; return n; };
    const read16 = () => { if (p + 2 > data.length) throw new Error('Truncated MIDI file'); const n = (data[p] << 8) | data[p+1]; p += 2; return n; };
    const readId = () => String.fromCharCode(...data.slice(p, p += 4));
    if (readId() !== 'MThd') throw new Error('Not a Standard MIDI File');
    const headerLength = read32(); if (headerLength < 6 || p + headerLength > data.length) throw new Error('Invalid MIDI header');
    const format = read16(), count = read16(), division = read16(); p += headerLength - 6;
    if (format > 1 || !count || count > 64 || !division || division & 0x8000) throw new Error('Unsupported MIDI format or time division');
    const tracks = []; let bpm = 120;
    for (let ti = 0; ti < count; ti++) {
      if (readId() !== 'MTrk') throw new Error('Missing MIDI track chunk');
      const length = read32(), end = p + length; if (end > data.length) throw new Error('Truncated MIDI track');
      let tick = 0, running = 0, name = `MIDI Track ${ti + 1}`;
      const pending = new Map(), notes = [];
      const readVar = () => { let v = 0, b; do { if (p >= end) throw new Error('Truncated MIDI event'); b = data[p++]; v = (v << 7) | (b & 127); } while (b & 128); return v; };
      while (p < end) {
        tick += readVar();
        let status = data[p++]; if (status < 0x80) { p--; status = running; } else if (status < 0xf0) running = status;
        if (status === 0xff) {
          const type = data[p++], size = readVar(); if (p + size > end) throw new Error('Truncated MIDI meta event');
          if (type === 0x03) name = new TextDecoder().decode(data.slice(p, p + size)) || name;
          if (type === 0x51 && size === 3) { const micros = data[p] * 65536 + data[p+1] * 256 + data[p+2]; if (ti === 0 && micros) bpm = 60000000 / micros; }
          p += size; if (type === 0x2f) break; continue;
        }
        if (status === 0xf0 || status === 0xf7) { const size = readVar(); p += size; continue; }
        const kind = status & 0xf0, channel = status & 15;
        if (kind === 0xc0 || kind === 0xd0) { p++; continue; }
        if (p + 2 > end) throw new Error('Truncated MIDI note event');
        const note = data[p++], velocity = data[p++];
        if (kind === 0x90 && velocity) { const key = `${channel}:${note}`; if (!pending.has(key)) pending.set(key, []); pending.get(key).push({ tick, note, velocity, channel }); }
        else if (kind === 0x80 || kind === 0x90) { const list = pending.get(`${channel}:${note}`); if (list && list.length) { const start = list.shift(); notes.push({ start: start.tick, end: Math.max(start.tick + 1, tick), note, velocity: start.velocity / 127, channel }); } }
      }
      // Keep each overlapping MIDI note in an independent MML voice.
      const voices = [];
      notes.sort((a, b) => a.start - b.start || a.end - b.end);
      for (const note of notes) {
        let voice = voices.find(v => v.end <= note.start);
        if (!voice) { voice = { end: 0, notes: [] }; voices.push(voice); }
        voice.notes.push(note); voice.end = note.end;
      }
      for (let vi = 0; vi < voices.length; vi++) {
        const voice = voices[vi];
        tracks.push({ type: 'mml', name: voices.length > 1 ? `${name} ${vi + 1}` : name, source: midiVoiceToMml(voice.notes, division, bpm) });
      }
      p = end;
    }
    if (p !== data.length) throw new Error('Unexpected data after MIDI tracks');
    return validateProject({ format: 'ABIM', version: 1, title: 'Imported MIDI', bpm: clamp(Math.round(bpm), 20, 300), tracks });
  }

  function midiVoiceToMml(notes, division, bpm) {
    if (!notes.length) return `t${Math.round(bpm)} r1`;
    const unit = division / 4;
    const grid = Math.max(1, Math.round(unit / 4));
    const quant = tick => Math.max(0, Math.round(tick / grid) * grid);
    const events = notes.map(n => ({ start: quant(n.start), end: Math.max(quant(n.start) + grid, quant(n.end)), note: n.note, velocity: n.velocity })).sort((a,b)=>a.start-b.start);
    let cursor = 0, octave = 4, source = `t${Math.round(bpm)} l16 `;
    const tokenFor = midi => {
      const name = NOTE_NAMES[midi % 12], targetOctave = Math.floor(midi / 12) - 1;
      let prefix = '';
      while (octave < targetOctave) { prefix += '>'; octave++; }
      while (octave > targetOctave) { prefix += '<'; octave--; }
      return prefix + name;
    };
    for (const event of events) {
      const start = Math.max(cursor, event.start);
      if (start > cursor) source += `r${Math.max(1, Math.min(64, Math.round(division * 4 / (start - cursor))))} `;
      const durationTicks = Math.max(grid, event.end - start);
      const denom = Math.max(1, Math.min(64, Math.round(division * 4 / durationTicks)));
      source += `v${Math.round(event.velocity * 127)} ${tokenFor(event.note)}${denom} `;
      cursor = start + durationTicks;
    }
    return source.trim();
  }

  async function decodeAudioFile(file, AudioContextType = globalThis.AudioContext || globalThis.webkitAudioContext) {
    if (!file || !/\.(mp3|wav|wave|m4a|aac|ogg|opus|flac)$/i.test(file.name || '') || file.size <= 0 || file.size > MAX_AUDIO_BYTES)
      throw new Error('Choose a non-empty MP3/audio file no larger than 24 MiB');
    if (!AudioContextType) throw new Error('MP3 import requires Web Audio support');
    const arrayBuffer = await file.arrayBuffer();
    const context = new AudioContextType();
    try { await context.decodeAudioData(arrayBuffer.slice(0)); }
    catch (error) { throw new Error(`Could not decode audio file: ${error.message}`); }
    finally { await context.close(); }
    const bytes = new Uint8Array(arrayBuffer);
    let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { type: 'audio', name: (file.name || 'Imported audio').replace(/\.[^.]+$/, '').slice(0, 64), mime: file.type || 'audio/mpeg', data: btoa(binary) };
  }

  function decodedAudio(track) {
    const binary = atob(track.data), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  async function play(value, status = () => {}) {
    const AudioContextType = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextType) throw new Error('Playback requires Web Audio support');
    const { project, notes } = flattenNotes(value);
    const ctx = new AudioContextType(); await ctx.resume();
    const startAt = ctx.currentTime + 0.06;
    let maxEnd = startAt;
    const buffers = [];
    try {
      for (const track of project.tracks.filter(item => item.type === 'audio')) {
        const buffer = await ctx.decodeAudioData(decodedAudio(track));
        const start = startAt + track.startBeat * 60 / project.bpm;
        const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(ctx.destination); source.start(start); maxEnd = Math.max(maxEnd, start + buffer.duration); buffers.push(source);
      }
      for (const event of notes) {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.value = 440 * Math.pow(2, (event.note - 69) / 12);
        const when = startAt + event.start, end = when + event.duration;
        scheduleEnvelope(gain, when, end, event.velocity);
        osc.connect(gain); gain.connect(ctx.destination); osc.start(when); osc.stop(end + 0.02); maxEnd = Math.max(maxEnd, end);
      }
      status(`Playing ${project.title || 'music'}`);
      let timer;
      let resolveDone;
      const done = new Promise(resolve => {
        resolveDone = resolve;
        timer = setTimeout(async () => { await ctx.close(); status('Playback finished'); resolve(); }, Math.min(600000, Math.max(0, (maxEnd - startAt) * 1000 + 100)));
      });
      return { stop() { clearTimeout(timer); for (const item of buffers) try { item.stop(); } catch (_) {} ctx.close(); status('Playback stopped'); resolveDone(); }, done };
    } catch (error) { await ctx.close(); throw error; }
  }

  async function exportMp3(project, encoder = globalThis.lamejs) {
    if (!encoder || !encoder.Mp3Encoder) throw new Error('MP3 encoder is unavailable. Reload ABI-1 Studio to load its bundled encoder.');
    const AudioContextType = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (!AudioContextType) throw new Error('MP3 export requires OfflineAudioContext support');
    const flat = flattenNotes(project);
    project = flat.project;
    const audioTracks = flat.audioTracks;
    let decodedTracks = [];
    if (audioTracks.length) {
      const DecodeContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!DecodeContext) throw new Error('Importing audio into an MP3 render requires Web Audio support');
      const decodeContext = new DecodeContext();
      try { decodedTracks = await Promise.all(audioTracks.map(async track => ({ track, buffer: await decodeContext.decodeAudioData(decodedAudio(track)) }))); }
      finally { await decodeContext.close(); }
    }
    const duration = Math.max(1, flat.duration, ...decodedTracks.map(({ track, buffer }) => track.startBeat * 60 / project.bpm + buffer.duration));
    if (duration > 300) throw new Error('MP3 export is limited to five minutes per render');
    const sampleRate = 44100, frames = Math.ceil(duration * sampleRate);
    const offline = new AudioContextType(2, frames, sampleRate);
    for (const { track, buffer } of decodedTracks) {
      const source = offline.createBufferSource(); source.buffer = buffer; source.connect(offline.destination); source.start(track.startBeat * 60 / project.bpm);
    }
    for (const event of flat.notes) {
      const osc = offline.createOscillator(), gain = offline.createGain();
      osc.type = 'triangle'; osc.frequency.value = 440 * Math.pow(2, (event.note - 69) / 12);
      const start = event.start, end = Math.min(duration, start + event.duration);
      scheduleEnvelope(gain, start, end, event.velocity);
      osc.connect(gain); gain.connect(offline.destination); osc.start(start); osc.stop(end + 0.02);
    }
    const rendered = await offline.startRendering();
    const mp3 = new encoder.Mp3Encoder(2, sampleRate, 128), left = rendered.getChannelData(0), right = rendered.getChannelData(1), parts = [];
    const l = new Int16Array(1152), r = new Int16Array(1152);
    for (let i = 0; i < frames; i += 1152) {
      const count = Math.min(1152, frames - i);
      for (let j = 0; j < count; j++) { l[j] = Math.max(-32768, Math.min(32767, left[i+j] * 32767)); r[j] = Math.max(-32768, Math.min(32767, right[i+j] * 32767)); }
      const encoded = mp3.encodeBuffer(l.subarray(0, count), r.subarray(0, count)); if (encoded.length) parts.push(new Uint8Array(encoded));
    }
    const tail = mp3.flush(); if (tail.length) parts.push(new Uint8Array(tail));
    return new Blob(parts, { type: 'audio/mpeg' });
  }

  return { PPQ, MAX_MUSIC_BYTES, parseMml, validateProject, flattenNotes, createSeededMusic, encodeAbim, decodeAbim, exportMidi, importMidi, decodeAudioFile, decodedAudio, play, exportMp3 };
});
