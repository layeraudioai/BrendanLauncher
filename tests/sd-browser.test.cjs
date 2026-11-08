'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {verifyBundledSource, verifyHeldRun, checkedSDPath, readOnlySD, parseArgs} = require('../host/sd-browser.cjs');
const {createPanel} = require('../tools/mac2jb-sd-browser/panel-server.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbl-sd-test-'));
  const run = path.join(root, 'runs', 'switch2-test-1');
  fs.mkdirSync(path.join(run, 'switch2/ro/root'), {recursive: true, mode: 0o700});
  fs.chmodSync(root, 0o700);
  const session = 'session-test-1';
  const result = {verified: true, completed: false, fs: {
    verified: true, restored: true, cleanup: {deferred: true, donor: {cleanedUp: true}},
    retainedEndpoint: {ready: true, session}
  }, rpc: {mode: 'held', state: 'listening'}};
  const proof = {verified: true, restored: true, cleanup: {deferred: true}, session,
    retainedEndpoint: {ready: true, session}};
  const rows = {
    'result.json': result,
    'connection.json': {addresses: {session}},
    'switch2/fs-execution-current.json': proof,
    'switch2/current-acquisition.json': {session},
    'switch2/ro/root/current-root.json': {session, pid: 1, rootHandle: 123}
  };
  for (const [name, value] of Object.entries(rows)) {
    const file = path.join(run, name);
    fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
    fs.writeFileSync(file, JSON.stringify(value), {mode: 0o600});
  }
  return {root, run, cleanup: () => fs.rmSync(root, {recursive: true, force: true})};
}

test('bundled Super File Bros. source inventory verifies', async () => {
  await verifyBundledSource();
});

test('SD path guard confines all access to normalized /sd paths', () => {
  assert.equal(checkedSDPath('/sd'), '/sd');
  assert.equal(checkedSDPath('/sd/roms/nes'), '/sd/roms/nes');
  for (const value of ['/save', '/sd/../save', '/sd/..', '/sd\\save', '/sd/x:y', '/sd/\0x']) {
    assert.throws(() => checkedSDPath(value));
  }
});

test('read-only storage adapter never delegates outside /sd', async () => {
  const calls = [];
  const raw = {
    list: async value => (calls.push(['list', value]), []),
    stat: async value => (calls.push(['stat', value]), {type: 'dir', size: 0}),
    openRead: async value => (calls.push(['openRead', value]), {handle: 1}),
    read: async (...args) => (calls.push(['read', ...args]), Buffer.alloc(0)),
    close: async value => (calls.push(['close', value]), undefined)
  };
  const scoped = readOnlySD(raw);
  assert.deepEqual(await scoped.list('/'), [{name: 'sd', type: 'dir', size: 0}]);
  assert.deepEqual(await scoped.stat('/'), {type: 'dir', size: 0});
  await scoped.list('/sd');
  assert.deepEqual(calls, [['list', '/sd']]);
  for (const method of ['list', 'stat', 'openRead'])
    await assert.rejects(() => scoped[method]('/save/x'));
});

test('run verifier requires in-tree current held FS proof', t => {
  const f = fixture(); t.after(f.cleanup);
  const proof = verifyHeldRun(f.run, '192.168.1.20', f.root);
  assert.equal(proof.run, fs.realpathSync(f.run));
  assert.equal(proof.session, 'session-test-1');
  assert.throws(() => verifyHeldRun(f.run, 'not-an-ip', f.root), /IPv4/);
});

test('run verifier rejects ordinary, incomplete, or out-of-tree folders', t => {
  const f = fixture(); t.after(f.cleanup);
  const resultFile = path.join(f.run, 'result.json');
  const result = JSON.parse(fs.readFileSync(resultFile));
  result.rpc.state = 'closed';
  fs.writeFileSync(resultFile, JSON.stringify(result), {mode: 0o600});
  assert.throws(() => verifyHeldRun(f.run, '192.168.1.20', f.root), /verified held FS RPC/);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hbl-sd-outside-'));
  t.after(() => fs.rmSync(outside, {recursive: true, force: true}));
  assert.throws(() => verifyHeldRun(outside, '192.168.1.20', f.root), /held-run directory|switch2/);
});

test('local browser panel authenticates requests and issues one-use read-only downloads', async t => {
  const payload = Buffer.from('read-only fixture');
  const storage = {
    async stat(value) {
      if (value === '/sd') return {type: 'dir', size: 0};
      if (value === '/sd/test.bin') return {type: 'file', size: payload.length};
      throw Error('missing');
    },
    async list(value) { assert.equal(value, '/sd'); return [{name: 'test.bin', type: 'file', size: payload.length}]; },
    async openRead(value) { assert.equal(value, '/sd/test.bin'); return {size: payload.length}; },
    async read(_file, offset, count) { return payload.subarray(offset, offset + count); },
    async close() {}
  };
  const panel = await createPanel(storage);
  t.after(() => panel.close());
  const page = await fetch(panel.origin + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  const request = (route, body, authenticated = true) => fetch(panel.origin + route, {
    method: 'POST', headers: {'content-type': 'application/json', origin: panel.origin,
      ...(authenticated ? {'x-hbl-sd-key': panel.token} : {})}, body: JSON.stringify(body)
  });
  assert.equal((await request('/api/list', {path: '/sd'}, false)).status, 403);
  const listing = await request('/api/list', {path: '/sd'});
  assert.equal(listing.status, 200);
  assert.equal((await listing.json()).entries[0].name, 'test.bin');
  assert.equal((await request('/api/list', {path: '/save'})).status, 400);
  const ticketReply = await request('/api/ticket', {path: '/sd/test.bin'});
  const ticket = (await ticketReply.json()).url;
  const download = await fetch(panel.origin + ticket);
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), payload);
  assert.equal((await fetch(panel.origin + ticket)).status, 404);
});

test('CLI parsing accepts explicit run, host, checkout, and no-open mode', () => {
  assert.deepEqual(parseArgs(['--run', '/tmp/run', '--host', '192.168.1.2', '--ns2jb', '/tmp/ns2jb', '--no-open']),
    {run: '/tmp/run', host: '192.168.1.2', ns2jb: '/tmp/ns2jb', noOpen: true});
  assert.throws(() => parseArgs(['--writable']), /Unknown option/);
});
