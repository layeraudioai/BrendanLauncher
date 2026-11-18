// Gapless stream playback for the ABI-1 audio service.
//
// Runs the real core/console/audio/game-audio.cjs against a fake console: a
// virtual AudioOut device that drains its DMA queue in real time, a virtual
// SDK allocator, and a driver file that stands in for the app's `events` word.
// The trace the fake console writes back is what the assertions inspect.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

// Both live copies of the service must behave the same way: the shell launcher
// runs core/console/audio, the homebrew launcher runs homebrew-launcher/.
const SERVICES = [
  ['core', path.resolve(__dirname, 'game-audio.cjs')],
  ['homebrew', path.resolve(__dirname, '../../../homebrew-launcher/game-audio.cjs')],
];
const SYMBOLS = path.resolve(__dirname, '../abi/audio-symbols.json');
const CHUNK_BYTES = 3840; // 960 stereo frames, 20 ms at 48 kHz

const FAKE_RPC = `
const fs = require('node:fs'), path = require('node:path');
const symbols = JSON.parse(fs.readFileSync(${JSON.stringify(SYMBOLS)}, 'utf8'));
const byOffset = new Map(symbols.map(s => [s.offset, s.name]));
const DIRECTORY = __dirname + '/..';
const MAPPED = 0x400000, SDK = 0x100000, SCRATCH = 0x200000, ALLOC = 0x800000;
const memory = Buffer.alloc(32 * 1024 * 1024);
const trace = { stoppedAt: [], flushAt: [], started: 0, flushes: 0, appends: [], consumed: [], underruns: 0, pcm: [] };
let queue = [], released = [], info = new Map(), sequence = -1, kind = 0;

// 48 kHz stereo s16le = 192000 bytes per second of DMA time.
const BYTES_PER_MS = 192;
let draining = 0;
function tick(ms) {
  draining += ms;
  while (queue.length) {
    const head = queue[0];
    const need = head.bytes / BYTES_PER_MS;
    if (draining < need) break;
    draining -= need;
    queue.shift();
    released.push(head);
    trace.released = (trace.released || 0) + 1;
  }
  if (!queue.length) draining = 0;
}
setInterval(() => tick(2), 2).unref();

// Read the driver file and mirror it into the app's ABI events word.
function drive() {
  try {
    const next = JSON.parse(fs.readFileSync(path.join(DIRECTORY, 'drive.json'), 'utf8'));
    if (next.sequence !== sequence || next.kind !== kind) {
      sequence = next.sequence; kind = next.kind;
      memory.writeUInt32LE(sequence >>> 0, MAPPED + 976);
      memory.writeUInt32LE(kind >>> 0, MAPPED + 980);
    }
  } catch (error) {}
  setTimeout(drive, 4).unref();
}
drive();

const CALLS = {
  InitializeAudioOutParameter: () => 0n,
  OpenDefaultAudioOutEPNS0_8AudioOutER: () => 0n,
  GetAudioOutSampleRate: () => 48000n,
  GetAudioOutChannelCount: () => 2n,
  GetAudioOutSampleFormat: () => 2n,
  GetAudioOutBufferCount: () => BigInt(queue.length),
  GetReleasedAudioOutBuffer: () => (released.length ? BigInt(released.shift().descriptor) : 0n),
  SetAudioOutBufferInfo: (descriptor, address, capacity, bytes) => {
    info.set(Number(descriptor), { address: Number(address), capacity: Number(capacity), bytes: Number(bytes) });
    return 0n;
  },
  AppendAudioOutBuffer: (handle, descriptor) => {
    const entry = info.get(Number(descriptor));
    if (!entry) return 0n;
    const pcm = Buffer.from(memory.subarray(entry.address, entry.address + entry.bytes));
    trace.appends.push({ descriptor: Number(descriptor), bytes: entry.bytes, address: entry.address });
    trace.pcm.push(pcm);
    queue.push({ descriptor: Number(descriptor), bytes: entry.bytes });
    return 1n;
  },
  StartAudioOut: () => { trace.started += 1; return 0n; },
  StopAudioOut: () => { trace.stoppedAt.push(trace.appends.length); return 0n; },
  FlushAudioOutBuffers: () => { trace.flushes += 1; trace.flushAt.push(trace.appends.length); queue = []; released = []; return 0n; },
};

const api = {
  a: { session: 'fake-session', sdk: SDK, scratch: SCRATCH },
  mapped: MAPPED,
  async read(address, length) {
    if (address >= MAPPED) return Buffer.from(memory.subarray(address, address + length));
    return Buffer.from(memory.subarray(address, address + length));
  },
  async write(address, buffer) {
    buffer.copy(memory, address);
    if (address === MAPPED + 984) { trace.consumed.push(buffer.readUInt32LE(0)); dump(); }
  },
  async request() { return { result: 0n }; },
  async call(id, args) {
    if (id === 5732112) { memory.writeBigUInt64LE(BigInt(ALLOC), args[0]); return { result: 0n }; }
    return { result: 0n };
  },
  async callAddress(address, args) {
    const name = byOffset.get(address - SDK) || '';
    const found = Object.entries(CALLS).find(([key]) => name.includes(key));
    if (!found) throw Error('Unexpected SDK call ' + name);
    const result = found[1](...args.map(a => (typeof a === 'bigint' ? Number(a) : a)));
    dump();
    return { result };
  },
  trace,
  queue: () => queue,
};
function dump() {
  try {
    const pcm = Buffer.concat(trace.pcm).toString('base64');
    const target = path.join(DIRECTORY, 'audio-trace.json');
    fs.writeFileSync(target + '.tmp', JSON.stringify({ ...trace, pcm }));
    fs.renameSync(target + '.tmp', target);
  } catch (error) {}
}
process.on('exit', dump);
module.exports = api;
`;

/** Stereo PCM whose samples encode the chunk index, so gaps are detectable. */
function chunkPcm(index, frames = CHUNK_BYTES / 4) {
  const pcm = Buffer.alloc(frames * 4);
  for (let frame = 0; frame < frames; frame++) {
    const value = (index * 1000 + frame) % 32767;
    pcm.writeInt16LE(value, frame * 4);
    pcm.writeInt16LE(value, frame * 4 + 2);
  }
  return pcm;
}

async function withConsole(service, run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-audio-stream-'));
  await fs.mkdir(path.join(directory, 'shared'));
  await fs.writeFile(path.join(directory, 'shared', 'rpc.cjs'), FAKE_RPC);
  const effects = {};
  for (let slot = 0; slot < 4; slot++) {
    const file = path.join(directory, `chunk_${slot}.pcm`);
    await fs.writeFile(file, chunkPcm(slot));
    effects[9 + slot] = file;
  }
  const source = {
    session: 'fake-session',
    mapped: 0x400000,
    package: { id: 'test-app', fingerprint: 'fp-1', effects, stream: [9, 10, 11, 12] },
  };
  await fs.writeFile(path.join(directory, 'game-audio-source.json'), JSON.stringify(source));
  await fs.writeFile(path.join(directory, 'drive.json'), JSON.stringify({ sequence: 0, kind: 0 }));

  const child = spawn(process.execPath, [service, directory], { stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  child.stdout.on('data', d => log.push(d.toString()));
  child.stderr.on('data', d => log.push(d.toString()));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('service did not start: ' + log.join(''))), 8000);
    child.stdout.on('data', () => { if (log.join('').includes('ready')) { clearTimeout(timer); resolve(); } });
    child.on('exit', code => reject(Error('service exited early: ' + code + log.join(''))));
  });
  try {
    await ready;
    return await run({ directory, child, effects, log });
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => child.on('exit', resolve));
    }
  }
}

function readTrace(directory) {
  return JSON.parse(fsSync.readFileSync(path.join(directory, 'audio-trace.json'), 'utf8'));
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

for (const [label, service] of SERVICES) {
test(`${label}: stream chunks play back-to-back without stopping the device`, async () => {
  await withConsole(service, async ({ directory, effects }) => {
    const produced = [];
    // 24 chunks over 480 ms of audio, posted at real-time pace.
    for (let index = 0; index < 24; index++) {
      const slot = index % 4;
      const pcm = chunkPcm(index);
      await fs.writeFile(effects[9 + slot], pcm);
      produced.push(pcm);
      await fs.writeFile(
        path.join(directory, 'drive.json'),
        JSON.stringify({ sequence: index + 1, kind: 9 + slot }),
      );
      await delay(20);
    }
    await delay(120);
    const trace = readTrace(directory);

    assert.equal(trace.started, 1, 'the device is started exactly once');
    assert.ok(trace.flushAt.every(at => at === 0), `flushes happen before audio is queued (${trace.flushAt})`);
    assert.deepEqual(trace.stoppedAt, [], 'no stop during a stream');
    assert.ok(trace.appends.length >= 20, `appended ${trace.appends.length} chunks`);

    // Every appended chunk is 20 ms of contiguous audio; concatenating them must
    // reproduce the produced stream with no repeated or missing chunk except the
    // ones the driver deliberately overwrote before they were consumed.
    const pcm = Buffer.from(trace.pcm, 'base64');
    assert.equal(pcm.length % CHUNK_BYTES, 0, 'PCM is a whole number of chunks');
    const chunkCount = pcm.length / CHUNK_BYTES;
    const indices = [];
    for (let index = 0; index < chunkCount; index++) {
      const slice = pcm.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
      indices.push(slice.readInt16LE(0) / 1000);
    }
    const strictlyIncreasing = indices.every((value, i) => i === 0 || value > indices[i - 1]);
    assert.ok(strictlyIncreasing, `chunk indices must increase (${indices.slice(0, 8).join(',')}...)`);
    assert.equal(indices[0], 0, 'playback starts at the first chunk');
    assert.ok(trace.consumed.length > 0, 'the consumed counter is published to the app');
    const report = JSON.parse(
      fsSync.readFileSync(path.join(directory, 'game-audio.json'), 'utf8'),
    );
    assert.equal(report.skipped, 0, 'no chunk is skipped when the producer keeps pace');
    assert.ok(report.underruns <= 1, `underruns ${report.underruns}`);
  });
});

test(`${label}: the published counter lets a producer pace itself`, async () => {
  await withConsole(service, async ({ directory, effects }) => {
    // Publish slowly: one chunk every 60 ms. Nothing may be dropped, and the
    // device must never stop between chunks.
    for (let index = 0; index < 6; index++) {
      const slot = index % 4;
      await fs.writeFile(effects[9 + slot], chunkPcm(index));
      await fs.writeFile(
        path.join(directory, 'drive.json'),
        JSON.stringify({ sequence: index + 1, kind: 9 + slot }),
      );
      await delay(60);
    }
    await delay(100);
    const trace = readTrace(directory);
    assert.equal(trace.appends.length, 6, 'every chunk was appended exactly once');
    assert.deepEqual(trace.stoppedAt, [], 'no stop');
    const values = trace.consumed;
    const monotonic = values.every((value, i) => i === 0 || value >= values[i - 1]);
    assert.ok(monotonic, `consumed counter must be monotonic (${values.join(',')})`);
    assert.equal(values.at(-1), 6, 'the app is told all six chunks are queued');
    const report = JSON.parse(
      fsSync.readFileSync(path.join(directory, 'game-audio.json'), 'utf8'),
    );
    assert.equal(report.skipped, 0, 'nothing skipped');
    assert.ok(report.underruns >= 1, 'the 40 ms silences between chunks are counted');
  });
});

test(`${label}: a stalled producer is reported instead of silently clicking`, async () => {
  await withConsole(service, async ({ directory, effects }) => {
    await fs.writeFile(effects[9], chunkPcm(0));
    await fs.writeFile(path.join(directory, 'drive.json'), JSON.stringify({ sequence: 1, kind: 9 }));
    await delay(200); // let the queue drain completely
    await fs.writeFile(effects[10], chunkPcm(1));
    await fs.writeFile(path.join(directory, 'drive.json'), JSON.stringify({ sequence: 2, kind: 10 }));
    await delay(80);
    const report = JSON.parse(
      fsSync.readFileSync(path.join(directory, 'game-audio.json'), 'utf8'),
    );
    assert.equal(report.underruns >= 1, true, 'underrun counted after the queue ran dry');
    assert.equal(report.appended, 2, 'both chunks still played');
  });
});
}
