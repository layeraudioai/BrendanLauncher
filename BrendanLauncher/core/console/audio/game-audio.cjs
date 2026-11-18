// Synthesized game effects. No ROM, downloaded samples, or injected CPU code.
//
// Continuity: a package may declare that some effect ids form a *stream* - a
// ring of small PCM chunks that the app triggers in order (see `package.stream`
// in game-audio-source.json). Stream chunks are appended to the audio-out queue
// without ever stopping or flushing the device, so playback runs gaplessly from
// one chunk to the next. The number of chunks appended so far is published back
// into the app's ABI `events.z` word, which lets the app pace itself instead of
// racing the queue and dropping chunks (dropped chunks are what used to click).
const fs = require('node:fs/promises'), path = require('node:path');
const symbols = require('../abi/audio-symbols.json');
const check = (v, m) => { if (!v) throw Error(m); };
const MAX_BUFFER = 131072;       // one DMA slot, and the largest legal effect
const POLL_MS = 10;              // event poll; one chunk is typically 20 ms
const EVENTS_OFFSET = 784 + 192; // ABI `events` uvec4: seq, kind, appended, spare

function synth(kind) {
 const rate = 48000, duration = [0, .035, .065, .11, .32, .45, .08, .18][kind], frames = Math.ceil(rate * duration), pcm = Buffer.alloc(frames * 4);
 for (let i = 0; i < frames; i++) {
  const t = i / rate, u = t / duration, attack = Math.min(1, t / .004), envelope = attack * Math.pow(1 - u, 1.7);
  let frequency = kind === 1 ? 240 : kind === 2 ? 440 + u * 230 : kind === 3 ? 140 - u * 65 : kind === 5 ? 440 * Math.pow(.23, u) : kind === 6 ? 660 : 523.25;
  if (kind === 4) frequency = [523.25, 659.25, 783.99, 1046.5][Math.min(3, Math.floor(u * 4))];
  if (kind === 7) frequency = [392, 523.25, 659.25][Math.min(2, Math.floor(u * 3))];
  const fundamental = Math.sin(2 * Math.PI * frequency * t), overtone = Math.sin(4 * Math.PI * frequency * t) * .18;
  const sample = Math.round(32767 * .19 * envelope * (fundamental + overtone)); pcm.writeInt16LE(sample, i * 4); pcm.writeInt16LE(sample, i * 4 + 2);
 }
 return pcm;
}

/** Effect ids a package declares as continuous stream chunks. */
function streamIds(packageInfo) {
 const declared = packageInfo?.stream;
 const list = Array.isArray(declared) ? declared : declared?.effects;
 if (!Array.isArray(list)) return new Set();
 return new Set(list.map(Number).filter(kind => Number.isInteger(kind) && kind >= 1 && kind <= 31));
}

async function main(directory) {
 directory = path.resolve(directory);
 const rpc = require(path.join(directory, 'shared/rpc.cjs'));
 const source = JSON.parse(await fs.readFile(path.join(directory, 'game-audio-source.json')));
 check(source.session === rpc.a.session, 'Game audio belongs to another session');
 const file = path.join(directory, 'game-audio.json');
 const report = {
  session: rpc.a.session, started: new Date().toISOString(), functions: {}, resourcesRetained: true,
  played: 0, appended: 0, skipped: 0, underruns: 0, droppedOneShots: 0, history: [],
 };
 await fs.writeFile(file, '{}', { flag: 'wx' });
 const save = () => fs.writeFile(file, JSON.stringify(report, null, 2));
 const sdkImage = require('../abi/sdk-checks.cjs');
 async function call(name, ...args) {
  if (!report.functions[name]) {
   const matches = symbols.filter(s => s.name.includes(name));
   check(matches.length === 1, 'Ambiguous sound symbol ' + name);
   const s = matches[0], address = rpc.a.sdk + s.offset;
   await rpc.request({ command: 'verify-function', address, hex: sdkImage.bytes(s.offset, Math.min(32, s.size)).toString('hex') });
   report.functions[name] = address;
  }
  return (await rpc.callAddress(report.functions[name], args)).result;
 }

 let stop = false, audio, started = false;
 process.on('SIGINT', () => stop = true);
 process.on('SIGTERM', () => stop = true);
 try {
  const bytes = 65536 + 31 * MAX_BUFFER, temp = rpc.a.scratch + 0x10000, saved = await rpc.read(temp, 8);
  let base;
  try {
   check((await rpc.call(5732112, [temp, 65536, bytes])).result === 0n, 'Sound allocation failed');
   base = Number((await rpc.read(temp, 8)).readBigUInt64LE());
  } finally { await rpc.write(temp, saved); }
  check(Number.isSafeInteger(base) && base > 0 && base % 65536 === 0, 'Invalid sound allocation');
  audio = base; report.audio = audio; report.base = base;
  await rpc.write(base, Buffer.alloc(65536));
  let sounds = {}, stream = new Set();
  const param = base + 0x300;
  await call('InitializeAudioOutParameter', param);
  const params = await rpc.read(param, 8); params.writeUInt32LE(48000); params.writeUInt16LE(2, 4); await rpc.write(param, params);
  check((await call('OpenDefaultAudioOutEPNS0_8AudioOutER', audio, param)) === 0n, 'Game audio output failed');
  check((await call('GetAudioOutSampleRate', audio)) === 48000n
   && (await call('GetAudioOutChannelCount', audio)) === 2n
   && (await call('GetAudioOutSampleFormat', audio)) === 2n, 'Unexpected game audio format');

  let silentSince = 0, lastChunkMs = 20;
  const descriptors = new Set(Array.from({ length: 8 }, (_, i) => base + 0x400 + i * 0x40));
  const free = new Set(descriptors);
  // Which chunk id each DMA slot currently holds, so a slot's PCM buffer is never
  // rewritten while the device may still be playing it.
  const slotKind = new Map(), kindSlot = new Map();

  async function release() {
   for (let i = 0; i < descriptors.size; i++) {
    const address = await call('GetReleasedAudioOutBuffer', audio);
    if (address === 0n) break;
    check(descriptors.has(Number(address)), 'Unknown sound descriptor');
    const descriptor = Number(address);
    const kind = slotKind.get(descriptor);
    if (kind !== undefined) { slotKind.delete(descriptor); kindSlot.delete(kind); }
    free.add(descriptor);
   }
  }
  async function stopOutput() {
   if (started) { check((await call('StopAudioOut', audio)) === 0n, 'Sound pause failed'); started = false; }
   await call('FlushAudioOutBuffers', audio); await release();
   check(Number(await call('GetAudioOutBufferCount', audio)) === 0, 'Sound queue did not drain');
   free.clear(); for (const descriptor of descriptors) free.add(descriptor);
   slotKind.clear(); kindSlot.clear();
  }

  /** Read one stream chunk into its slot and queue it. */
  async function appendChunk(kind) {
   const sound = sounds[kind];
   if (!sound || kindSlot.has(kind) || !free.size) return false;
   let length = sound.bytes;
   if (sound.stream) {
    const pcm = await fs.readFile(sound.file);
    check(pcm.length > 0 && pcm.length <= MAX_BUFFER && pcm.length % 4 === 0, 'Invalid stream chunk PCM');
    await rpc.write(sound.address, pcm);
    length = pcm.length;
   }
   const descriptor = free.values().next().value;
   await call('SetAudioOutBufferInfo', descriptor, sound.address, MAX_BUFFER, length);
   check((await call('AppendAudioOutBuffer', audio, descriptor)) === 1n, 'Sound buffer rejected');
   free.delete(descriptor); slotKind.set(descriptor, kind); kindSlot.set(kind, descriptor);
   if (!started) { check((await call('StartAudioOut', audio)) === 0n, 'Sound playback failed'); started = true; }
   report.appended++; report.played++;
   // A gap longer than the previous chunk means the device ran dry: that is the
   // click the app can hear, so it is counted rather than hidden.
   const now = Date.now();
   if (silentSince && now - silentSince > Math.max(20, lastChunkMs * 1.5)) {
    report.underruns++; if (report.underruns < 8) console.log('[AUDIO] Stream underrun');
    await save();
   }
   silentSince = 0; lastChunkMs = length / 192;
   return true;
  }

  /** One-shot effect (UI blip): only when the queue is deep enough to hide it. */
  async function playOneShot(kind) {
   if (!sounds[kind] || !sounds[kind].bytes) return;
   if (kindSlot.size) { report.droppedOneShots++; return; } // never late, never mixed into a stream
   if (free.size === 0 || free.size < 6) return;
   if ((kind === 1 || kind === 2) && free.size < 8) return;
   await appendChunk(kind);
   report.history.push({ kind, time: new Date().toISOString() }); report.history = report.history.slice(-64);
  }

  report.ready = true; await save(); console.log('Game sound effects ready.');
  let sequence = -1, token = null, published = 0;
  const queue = [];

  async function loadEffects(packageInfo) {
   await stopOutput(); sounds = {};
   stream = streamIds(packageInfo);
   for (const [key, file] of Object.entries(packageInfo?.effects || {})) {
    const kind = Number(key);
    check(Number.isInteger(kind) && kind >= 1 && kind <= 31, 'Invalid sound event id');
    const address = base + 65536 + (kind - 1) * MAX_BUFFER;
    if (stream.has(kind)) {
     // Stream chunks are re-read for every trigger: the file changes as the
     // producer keeps decoding, so they are never pre-uploaded.
     const stat = await fs.stat(file);
     check(stat.size > 0 && stat.size <= MAX_BUFFER && stat.size % 4 === 0, 'Invalid stream chunk PCM');
     sounds[kind] = { address, file, bytes: 0, stream: true };
     continue;
    }
    const pcm = await fs.readFile(file);
    check(pcm.length > 0 && pcm.length <= MAX_BUFFER && pcm.length % 4 === 0, 'Invalid package PCM');
    const bytes = Buffer.alloc(MAX_BUFFER); pcm.copy(bytes);
    await rpc.write(address, bytes); check((await rpc.read(address, bytes.length)).equals(bytes), 'Sound upload differs');
    sounds[kind] = { address, bytes: pcm.length };
   }
   token = packageInfo?.fingerprint || null; sequence = -1; queue.length = 0; silentSince = 0;
   report.stream = stream.size ? { kinds: [...stream], chunkBytes: MAX_BUFFER } : null;
   report.package = packageInfo ? { id: packageInfo.id, fingerprint: token, effects: Object.keys(sounds) } : null;
   await save();
  }

  /** Keep the DMA queue fed; never stops the device while a stream is live. */
  async function pump() {
   await release();
   while (queue.length) {
    const kind = queue[0];
    if (kindSlot.has(kind) || !free.size) break; // its slot is still playing
    if (!await appendChunk(kind)) break;
    queue.shift();
   }
   // Nothing queued means the device is silent right now; remember when it went
   // quiet so the next append can tell whether it ran dry.
   if (!started || kindSlot.size) silentSince = 0;
   else if (!silentSince) silentSince = Date.now();
   if (published !== report.appended) {
    const word = Buffer.alloc(4); word.writeUInt32LE(report.appended >>> 0);
    await rpc.write(source.mapped + EVENTS_OFFSET + 8, word); // events.z
    published = report.appended;
   }
  }

  while (!stop) {
   const current = JSON.parse(await fs.readFile(path.join(directory, 'game-audio-source.json')));
   check(current.session === rpc.a.session, 'Sound source session changed');
   if ((current.package?.fingerprint || null) !== token) await loadEffects(current.package || null);
   const state = await rpc.read(source.mapped + 784, 208);
   const next = state.readUInt32LE(192), kind = state.readUInt32LE(196);
   if (next !== sequence) {
    sequence = next;
    if (next !== 0) {
     if (stream.has(kind)) {
      queue.push(kind);
      // A late consumer must not fall further behind than the ring allows.
      while (queue.length > descriptors.size) { queue.shift(); report.skipped++; }
      if (report.skipped) await save();
     } else await playOneShot(kind);
    }
   }
   await pump();
   await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
 } catch (error) { report.error = error.stack; console.error(error); process.exitCode = 1; }
 finally {
  if (started) try { await call('StopAudioOut', audio); } catch (error) { report.stopError = error.message; }
  report.completed = new Date().toISOString(); await save();
 }
}
module.exports = { synth, main, streamIds };
if (require.main === module) main(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
