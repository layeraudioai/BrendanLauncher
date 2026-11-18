// A package that declares `audio.stream` must reach the audio service intact:
// the catalog keeps the ids, the runtime hands the service a *writable* chunk
// file per id, and rewriting those chunks never changes the app fingerprint.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const catalog = require('../../homebrew-launcher/app-catalog.cjs');
const coreCatalog = require('../../core/services/app-catalog.cjs');
const { create } = require('../../homebrew-launcher/app-runtime.cjs');

const CHUNK_BYTES = 3840; // 20 ms stereo s16le

function silence(bytes = CHUNK_BYTES) {
  return Buffer.alloc(bytes);
}

async function makeApp(root, { stream = [9, 10], extraEffects = {} } = {}) {
  const appRoot = path.join(root, 'stream-app');
  await fs.cp(path.resolve(__dirname, '../../apps/hello-world'), appRoot, { recursive: true });
  const effects = { 1: 'assets/click.pcm', 2: 'assets/error.pcm' };
  for (const id of stream) effects[id] = `assets/chunk_${id}.pcm`;
  Object.assign(effects, extraEffects);
  await fs.mkdir(path.join(appRoot, 'assets'), { recursive: true });
  for (const [id, file] of Object.entries(effects)) {
    await fs.writeFile(path.join(appRoot, file), silence(id === '1' || id === '2' ? 1920 : CHUNK_BYTES));
  }
  const manifestPath = path.join(appRoot, 'app.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.id = 'stream-app';
  manifest.audio = { sampleRate: 48000, channels: 2, format: 's16le', effects, stream };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { appRoot, manifestPath, effects };
}

test('audio.stream is validated and kept by both catalogs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-stream-catalog-'));
  try {
    const { appRoot, manifestPath } = await makeApp(root);
    const scanned = await catalog.scan(root);
    assert.equal(scanned.apps.length, 1);
    assert.deepEqual(scanned.apps[0].stream, [9, 10]);
    const core = await coreCatalog.scan(root, { validate: false });
    assert.deepEqual(core.apps[0].stream, [9, 10], 'the shell launcher catalog agrees');

    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.audio.stream = [11];
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const rejected = await catalog.scan(root);
    assert.equal(rejected.apps.length, 0, 'an undeclared stream id is rejected');
    assert.match(rejected.rejected[0].error, /declared effects/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('the runtime gives the service writable chunk files and the stream list', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-stream-runtime-'));
  const root = path.join(directory, 'apps');
  await fs.mkdir(root);
  try {
    const { appRoot } = await makeApp(root);
    const memory = Buffer.alloc(8 * 1024 * 1024);
    const mapped = 0x100000;
    memory.fill(0, 0, memory.length);
    const rpc = {
      a: { session: 'stream-session' },
      async read(address, length) {
        assert.ok(address >= mapped && address + length <= mapped + memory.length);
        return Buffer.from(memory.subarray(address - mapped, address - mapped + length));
      },
      async write(address, buffer) {
        assert.ok(address >= mapped && address + buffer.length <= mapped + memory.length);
        buffer.copy(memory, address - mapped);
      },
    };
    const menu = { catalog: { root }, controls: { mapped, bytes: 8 * 1024 * 1024 }, commands: [['11']] };
    const runtime = await create({
      rpc,
      menu,
      directory,
      prepareApp: async () => ({ ready: true, scratchRestored: true, commands: [['21']] }),
    });
    runtime.report.catalog = null;
    // Launch the app the way the shell does.
    memory.writeUInt32LE(1, 1012);
    await runtime.afterBatch();
    assert.equal(runtime.active.app.id, 'stream-app');

    const source = JSON.parse(
      await fs.readFile(path.join(directory, 'game-audio-source.json'), 'utf8'),
    );
    assert.deepEqual(source.package.stream, [9, 10], 'the stream ids reach the service');
    for (const id of ['9', '10']) {
      const file = source.package.effects[id];
      assert.ok(file.includes('loaded-apps'), `chunk ${id} lives in the runtime folder`);
      const stat = await fs.stat(file);
      assert.equal(stat.size % 4, 0, 'chunk is whole stereo frames');
      // The producer overwrites chunks while the app runs; that must be allowed.
      await fs.writeFile(file, silence());
    }
    // One-shot effects are still played from the package itself.
    assert.ok(source.package.effects['1'].endsWith('click.pcm'));

    // Rewriting a chunk must not change the fingerprint (no reload loop).
    const again = await catalog.scan(root);
    assert.equal(again.apps[0].fingerprint, runtime.active.app.fingerprint);
    void appRoot;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
