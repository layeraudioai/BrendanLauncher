'use strict';
// The launcher asks one question on startup ("will you be using Moonlight this
// session?") and answering yes runs scripts/moonlight-setup.cjs. These tests pin
// down what that script promises: it never downloads in --check mode, it finds
// the app package next to the launcher, and it builds a package that has the
// manifest but no SPIR-V yet.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'moonlight-setup.cjs');

// A nested temp dir keeps the parent (which the script scans for a sibling
// checkout or an archive) empty, so tests do not see the host's real files.
async function scaffold() {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'moonlight-setup-'));
  const root = path.join(base, 'launcher');
  await fsp.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fsp.copyFile(SCRIPT, path.join(root, 'scripts', 'moonlight-setup.cjs'));
  return root;
}

function packageFiles(dir, { built }) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'app.json'),
    JSON.stringify({ id: 'moonlight', format: 'hblauncher.gpu-app', abi: 1 }, null, 2),
  );
  if (built) for (const stage of ['vert', 'frag', 'comp']) fs.writeFileSync(path.join(dir, `app.${stage}.spv`), 'x');
}

function run(root, args) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'moonlight-setup.cjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

function state(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'data', 'state', 'moonlight-setup.json'), 'utf8'));
}

test('check mode reports what is missing and downloads nothing', async () => {
  const root = await scaffold();
  const { status, out } = run(root, ['--check']);
  assert.equal(status, 0);
  assert.match(out, /Sunshine is not installed/);
  assert.match(out, /apps\/moonlight is not installed yet/);
  assert.ok(!fs.existsSync(path.join(root, 'data', 'cache', 'node.zip')));
  const saved = state(root);
  assert.equal(saved.sunshine, null);
  assert.equal(saved.app, null);
  assert.equal(saved.mode, 'check');
  await fsp.rm(path.dirname(root), { recursive: true, force: true });
});

test('a ready package next to the launcher is accepted without rebuilding', async () => {
  const root = await scaffold();
  packageFiles(path.join(root, 'apps', 'moonlight'), { built: true });
  fs.mkdirSync(path.join(root, 'tools', 'sunshine'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools', 'sunshine', 'sunshine.exe'), 'stub');

  const { status, out } = run(root, ['--check']);
  assert.equal(status, 0);
  assert.match(out, /Sunshine found at/);
  assert.match(out, /Moonlight app package at/);
  const saved = state(root);
  assert.match(saved.sunshine, /sunshine\.exe$/);
  assert.match(saved.app, /apps\/moonlight$/);
  await fsp.rm(path.dirname(root), { recursive: true, force: true });
});

test('a package without SPIR-V is built by --auto', async () => {
  const root = await scaffold();
  const target = path.join(root, 'apps', 'moonlight');
  packageFiles(target, { built: false });
  fs.writeFileSync(
    path.join(target, 'build.cjs'),
    "const fs=require('node:fs');for(const stage of ['vert','frag','comp'])fs.writeFileSync(`app.${stage}.spv`,'built');\n",
  );
  fs.mkdirSync(path.join(root, 'tools', 'sunshine'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools', 'sunshine', 'sunshine.exe'), 'stub');

  const { status, out } = run(root, ['--auto', '--no-start']);
  assert.equal(status, 0);
  assert.match(out, /building the Moonlight shaders/);
  for (const stage of ['vert', 'frag', 'comp']) {
    assert.ok(fs.existsSync(path.join(target, `app.${stage}.spv`)), `${stage} was not built`);
  }
  await fsp.rm(path.dirname(root), { recursive: true, force: true });
});

test('the package is installed from a neighbouring port checkout', async () => {
  const root = await scaffold();
  const siblingApp = path.join(path.dirname(root), 'moonlight-civswitch', 'brendanlauncher', 'apps', 'moonlight');
  packageFiles(siblingApp, { built: true });
  const sibling = path.join(path.dirname(root), 'moonlight-civswitch');
  fs.mkdirSync(path.join(root, 'tools', 'sunshine'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools', 'sunshine', 'sunshine.exe'), 'stub');

  const { status, out } = run(root, ['--auto', '--no-start']);
  assert.equal(status, 0);
  assert.match(out, /installing the Moonlight package from/);
  assert.ok(fs.existsSync(path.join(root, 'apps', 'moonlight', 'app.json')));
  await fsp.rm(path.dirname(root), { recursive: true, force: true });

});

test('an archive next to the launcher is unpacked when the app is missing', async (t) => {
  const zip = spawnSync('zip', ['-v'], { encoding: 'utf8' });
  if (zip.error || zip.status !== 0) {
    t.skip('no zip tool available');
    return;
  }
  const root = await scaffold();
  const stage = await fsp.mkdtemp(path.join(os.tmpdir(), 'moonlight-zip-'));
  packageFiles(path.join(stage, 'aio', 'moonlight-civswitch', 'brendanlauncher', 'apps', 'moonlight'), { built: true });
  const archive = path.join(path.dirname(root), 'moonlight-test.zip');
  spawnSync('zip', ['-qr', archive, '.'], { cwd: stage });
  fs.mkdirSync(path.join(root, 'tools', 'sunshine'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools', 'sunshine', 'sunshine.exe'), 'stub');

  const { status, out } = run(root, ['--auto', '--no-start']);
  assert.equal(status, 0);
  assert.match(out, /looking for the app inside/);
  assert.ok(fs.existsSync(path.join(root, 'apps', 'moonlight', 'app.json')));

  await fsp.rm(path.dirname(root), { recursive: true, force: true });
  await fsp.rm(stage, { recursive: true, force: true });
});
