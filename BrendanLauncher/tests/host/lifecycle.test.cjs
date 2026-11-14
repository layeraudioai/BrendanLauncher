'use strict';
/*
 * Host-side tests: package parsing, catalog layout, dispatch construction, ABI
 * sync and the complete launcher lifecycle against the mock backend.
 *
 * Run: node tests/host/lifecycle.test.cjs   (or sh tests/run.sh)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const {execFileSync} = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const {scan, buildCatalog, loadPackage, decodePng} = require(path.join(ROOT, 'host/lib/packages.cjs'));
const {buildDispatch, parseDispatchHeader} = require(path.join(ROOT, 'host/lib/dispatch.cjs'));
const {Runtime, ABI} = require(path.join(ROOT, 'host/lib/runtime.cjs'));
const {MockTarget} = require(path.join(ROOT, 'host/lib/target.cjs'));
const {createMockCallHandler} = require(path.join(ROOT, 'host/lib/mock-device.cjs'));
const {Log} = require(path.join(ROOT, 'host/lib/common.cjs'));
const {AppStorage, STATUS: FS_STATUS, handleStorageRequest} =
  require(path.join(ROOT, 'host/lib/app-storage.cjs'));

const tests = [];
const test = (name, fn) => tests.push({name, fn});
const log = new Log({quiet: true});

test('ABI json matches the C headers', () => {
  execFileSync('python3', [path.join(ROOT, 'tools/gen_abi.py'), '--check'], {stdio: 'pipe'});
});

test('dispatch header parses in declaration order', () => {
  const fields = parseDispatchHeader(path.join(ROOT, 'sdk/include/hbx_vk.h'));
  assert(fields.length > 60, 'expected the full table');
  assert.strictEqual(fields[0], 'vkCreateInstance');
  assert(fields.includes('vkQueueSubmit'));
  assert(fields.includes('vkCmdBeginRendering'));
  assert.strictEqual(new Set(fields).size, fields.length);
});

test('dispatch table resolves symbols and rejects gaps', () => {
  const fields = parseDispatchHeader(path.join(ROOT, 'sdk/include/hbx_vk.h'));
  const module = {
    base: 0x3000000000,
    symbols: fields.map((name, index) => ({name, offset: 0x1000 + index * 0x40,
      section: 1, type: 2}))
  };
  const built = buildDispatch(module);
  assert.strictEqual(built.buffer.length, fields.length * 8);
  assert.strictEqual(built.buffer.readBigUInt64LE(0), BigInt(0x3000000000 + 0x1000));
  assert.strictEqual(built.missing.length, 0);

  const broken = {base: 0x1000, symbols: module.symbols.filter(s => s.name !== 'vkQueueSubmit')};
  assert.throws(() => buildDispatch(broken), /vkQueueSubmit/);
});

test('every app package parses', () => {
  const {packages, errors} = scan(path.join(ROOT, 'apps'));
  const unsupported = errors.filter(item => path.basename(item.directory) !== 'twilight');
  assert.strictEqual(unsupported.length, 0, JSON.stringify(unsupported));
  const ids = new Set(packages.map(pkg => pkg.manifest.id));
  for (const id of ['fs-demo', 'gpu-triangle', 'hello-cpu']) assert(ids.has(id), id);
  assert.strictEqual(packages.find(pkg => pkg.manifest.id === 'fs-demo').manifest.host_storage, true);
  const kinds = new Set(packages.map(pkg => pkg.manifest.kind));
  assert.deepStrictEqual([...kinds], ['native']);
  for (const pkg of packages) {
    assert.strictEqual(pkg.manifest.abi, 3);
    if (pkg.icon) assert.strictEqual(pkg.icon.length, 96 * 96 * 4, pkg.manifest.id + ' icon');
  }
});

test('catalog layout matches struct hbx_catalog', () => {
  const {packages} = scan(path.join(ROOT, 'apps'));
  const catalog = buildCatalog(packages);
  const block = catalog.block;
  assert.strictEqual(block.readUInt32LE(0), ABI.catalogMagic);
  assert.strictEqual(block.readUInt32LE(4), packages.length);
  const stringsOff = block.readUInt32LE(8);
  assert(stringsOff >= 32 + packages.length * 32);
  const firstName = block.readUInt32LE(32 + 4);
  assert(block.subarray(stringsOff + firstName, stringsOff + firstName + 20)
    .toString().startsWith(packages[0].manifest.name));
  assert.strictEqual(catalog.iconLayers,
    Math.min(packages.filter(pkg => pkg.icon).length, 16));
  assert.strictEqual(catalog.icons.length, catalog.iconLayers * 96 * 96 * 4);
});

test('invalid packages are rejected', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hbl-pkg-'));
  const write = (id, manifest) => {
    const dir = path.join(temp, id);
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    return dir;
  };
  assert.throws(() => loadPackage(write('Bad', {id: 'Bad', name: 'x', version: '1.0.0',
    abi: 3, kind: 'native'})), /invalid id/);
  assert.throws(() => loadPackage(write('ok-id', {id: 'ok-id', name: 'x', version: '1.0.0',
    abi: 9, kind: 'native'})), /unsupported abi/);
  assert.throws(() => loadPackage(write('ok-kind', {id: 'ok-kind', name: 'x', version: '1.0.0',
    abi: 3, kind: 'pray'})), /unsupported kind/);
  assert.throws(() => loadPackage(write('ok-build', {id: 'ok-build', name: 'x', version: '1.0.0',
    abi: 3, kind: 'native'})), /report.json/);
  fs.rmSync(temp, {recursive: true, force: true});
});

test('icon PNG decodes to RGBA', () => {
  const png = fs.readFileSync(path.join(ROOT, 'apps/hello-cpu/icon.png'));
  const image = decodePng(png);
  assert.strictEqual(image.width, 96);
  assert.strictEqual(image.height, 96);
  assert.strictEqual(image.rgba.length, 96 * 96 * 4);
});

test('runtime lifecycle: launch, return, exit', async () => {
  const handler = createMockCallHandler({appFrames: 42});
  const target = new MockTarget({log, onCall: handler});
  const runtime = new Runtime({target, log, appsDir: path.join(ROOT, 'apps')});
  await runtime.open();
  assert.strictEqual(runtime.packages.length, scan(path.join(ROOT, 'apps')).packages.length);
  assert.strictEqual(runtime.catalog.iconLayers,
    Math.min(runtime.packages.filter(pkg => pkg.icon).length, 16));
  assert.strictEqual(runtime.launcher.entry, Number(BigInt(runtime.launcher.report.entry)));
  handler.setEntries(runtime.launcher.entry, Number(BigInt(runtime.packages[0].report.entry)));
  const result = await runtime.run({maxEntries: 8});
  assert.strictEqual(result.launches, 1);
  assert.strictEqual(handler.state.appCalls, 1);
  assert.strictEqual(handler.state.entries[1].resume, true,
    'the launcher must be re-entered with the resume flag after an app');
  /* App images are unmapped; the launcher image is still resident. */
  const mapped = runtime.mappedImages.map(entry => entry.label);
  assert(mapped.includes('launcher-code'), 'launcher stays mapped');
  assert(!mapped.some(label => label.includes('gpu-triangle')), 'app images are released');
  await runtime.stop();
});

test('runtime aborts on a launcher failure status', async () => {
  const target = new MockTarget({log, onCall: async (address, args, t) => {
    const ctx = await t.read(args[0], ABI.ctxSize);
    const status = Buffer.alloc(8);
    status.writeBigUInt64LE(4n);
    await t.write(args[0] + ABI.ctx.status, status);
    return {result: 0};
  }});
  const runtime = new Runtime({target, log, appsDir: path.join(ROOT, 'apps')});
  await runtime.open();
  await assert.rejects(() => runtime.run({maxEntries: 2}), /status 4/);
  await runtime.stop();
});

test('asset globs expand to sorted matching files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbl-glob-'));
  try {
    fs.cpSync(path.join(ROOT, 'apps/hello-cpu'), dir, {recursive: true});
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
    manifest.assets = ['*.rom', 'b.rom'];
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    fs.mkdirSync(path.join(dir, 'assets'), {recursive: true});
    for (const name of ['b.rom', 'A.ROM', 'skip.txt']) fs.writeFileSync(path.join(dir, 'assets', name), name);
    const pkg = loadPackage(dir);
    assert.deepStrictEqual(pkg.assets.map(a => a.name), ['A.ROM', 'b.rom']);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('asset block keeps every name and payload intact', () => {
  const runtime = new Runtime({target: new MockTarget({log}), log, appsDir: path.join(ROOT, 'apps')});
  const assets = [{name: "sample-one.nes", bytes: Buffer.from('NES\x1aAAAA')},
                  {name: 'sample-two.nes', bytes: Buffer.from('NES\x1aBBBBBBBB')},
                  {name: 'c', bytes: Buffer.alloc(3, 9)}];
  const block = runtime.buildAssetBlock({manifest: {id: 't'}, assets});
  assert.strictEqual(block.readUInt32LE(4), 3);
  assets.forEach((asset, i) => {
    const nameAt = block.readUInt32LE(16 + i * 16), dataAt = block.readUInt32LE(20 + i * 16);
    const size = block.readUInt32LE(24 + i * 16);
    assert.strictEqual(block.toString('utf8', nameAt, nameAt + Buffer.byteLength(asset.name)), asset.name);
    assert.deepStrictEqual(block.subarray(dataAt, dataAt + size), asset.bytes);
  });
});

test('save block round-trips through saves/<id>.sav only when dirty', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbl-saves-'));
  const previous = process.env.HBL_SAVES_DIR;
  process.env.HBL_SAVES_DIR = dir;
  try {
    const target = new MockTarget({log});
    const runtime = new Runtime({target, log, appsDir: path.join(ROOT, 'apps')});
    const pkg = {manifest: {id: 'demo'}, saveBytes: 0x10000};
    let block = await runtime.loadSave(pkg);
    assert.strictEqual((await target.read(block, 4)).readUInt32LE(0), 0, 'fresh block has no magic');
    const body = Buffer.alloc(64, 7);
    body.writeUInt32LE(0x56534248, 0); body.writeUInt32LE(1, 4);
    body.writeUInt32LE(64, 8); body.writeUInt32LE(0, 12);
    await target.write(block, body);
    await runtime.storeSave(pkg, block);
    assert(!fs.existsSync(path.join(dir, 'demo.sav')), 'a clean block is not written');
    body.writeUInt32LE(1, 12);
    await target.write(block, body);
    await runtime.storeSave(pkg, block);
    const stored = fs.readFileSync(path.join(dir, 'demo.sav'));
    assert.strictEqual(stored.length, 64);
    assert.strictEqual(stored.readUInt32LE(12), 0, 'dirty flag is cleared on disk');
    block = await runtime.loadSave(pkg);
    assert.deepStrictEqual(await target.read(block + 16, 48), body.subarray(16));
  } finally {
    if (previous === undefined) delete process.env.HBL_SAVES_DIR; else process.env.HBL_SAVES_DIR = previous;
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('per-app host storage supports bounded read/write/list/remove', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbl-storage-'));
  try {
    const storage = new AppStorage(dir, 'demo');
    let response = await handleStorageRequest(storage, 2, 'notes/welcome.txt',
      Buffer.from('private data'), 0);
    assert.strictEqual(response.status, FS_STATUS.OK);
    response = await handleStorageRequest(new AppStorage(dir, 'other'), 1,
      'notes/welcome.txt', Buffer.alloc(0), 64);
    assert.strictEqual(response.status, FS_STATUS.NOT_FOUND, 'apps do not share storage');
    response = await handleStorageRequest(storage, 2, 'notes/welcome.txt',
      Buffer.from('updated data'), 0);
    assert.strictEqual(response.status, FS_STATUS.OK, 'existing file can be replaced');
    response = await handleStorageRequest(storage, 1, 'notes/welcome.txt',
      Buffer.alloc(0), 64);
    assert.strictEqual(response.data.toString(), 'updated data');
    response = await handleStorageRequest(storage, 1, 'notes/welcome.txt',
      Buffer.alloc(0), 2);
    assert.strictEqual(response.status, FS_STATUS.BUFFER);
    response = await handleStorageRequest(storage, 3, 'notes',
      Buffer.alloc(0), 128);
    assert.strictEqual(response.data.toString(), 'welcome.txt\n');
    response = await handleStorageRequest(storage, 4, 'notes/welcome.txt',
      Buffer.alloc(0), 0);
    assert.strictEqual(response.status, FS_STATUS.OK);
    response = await handleStorageRequest(storage, 1, 'notes/welcome.txt',
      Buffer.alloc(0), 64);
    assert.strictEqual(response.status, FS_STATUS.NOT_FOUND);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('runtime services the ABI-3 storage mailbox', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbl-storage-mailbox-'));
  const target = new MockTarget({log});
  const runtime = new Runtime({target, log, appStorageDir: dir});
  const mailboxAddress = await target.allocate(0x11000, 0x1000);
  const submit = async (sequence, operation, value, input, capacity) => {
    const request = Buffer.alloc(132 + 65536);
    request.writeUInt32LE(0x53464248, 0);
    request.writeUInt32LE(1, 4);
    request.writeUInt32LE(sequence, 8);
    request.writeUInt32LE(operation, 16);
    const pathBytes = Buffer.from(value);
    request.writeUInt32LE(pathBytes.length, 24);
    request.writeUInt32LE(input.length, 28);
    request.writeUInt32LE(capacity, 32);
    pathBytes.copy(request, 36);
    input.copy(request, 132);
    await target.write(mailboxAddress, request);
    await runtime.serviceStorage({manifest: {id: 'demo'}}, mailboxAddress);
    const response = await target.read(mailboxAddress, 132 + capacity);
    assert.strictEqual(response.readUInt32LE(12), sequence);
    assert.strictEqual(response.readInt32LE(20), FS_STATUS.OK);
    return response.subarray(132, 132 + response.readUInt32LE(28));
  };
  try {
    assert.strictEqual((await submit(1, 2, 'memo.txt', Buffer.from('through mailbox'), 0)).length, 0);
    assert.strictEqual((await submit(2, 1, 'memo.txt', Buffer.alloc(0), 64)).toString(),
      'through mailbox');
  } finally {
    await target.free(mailboxAddress);
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('per-app host storage rejects traversal and symlinks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbl-storage-safe-'));
  try {
    const storage = new AppStorage(dir, 'demo');
    let response = await handleStorageRequest(storage, 2, '../outside',
      Buffer.from('no'), 0);
    assert.strictEqual(response.status, FS_STATUS.INVALID_PATH);
    await fs.promises.mkdir(path.join(dir, 'demo'), {recursive: true});
    const outside = path.join(dir, 'outside.txt');
    fs.writeFileSync(outside, 'outside');
    try {
      await fs.promises.symlink(outside, path.join(dir, 'demo', 'escape.txt'));
      response = await handleStorageRequest(storage, 1, 'escape.txt',
        Buffer.alloc(0), 64);
      assert.strictEqual(response.status, FS_STATUS.INVALID_PATH);
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    }
    response = await handleStorageRequest(storage, 1, 'missing.txt',
      Buffer.alloc(0), 64);
    assert.strictEqual(response.status, FS_STATUS.NOT_FOUND);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

(async () => {
  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`ok   ${item.name}`);
    } catch (error) {
      failed++;
      console.error(`FAIL ${item.name}\n     ${error.message}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} host tests passed`);
  process.exit(failed ? 1 : 0);
})();
