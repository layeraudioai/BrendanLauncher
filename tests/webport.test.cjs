'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {build, collect, cssRules} = require('../tools/port-webapp.cjs');

test('WebPort extracts the supported semantic subset and CSS colors', () => {
  const model = collect('<body><h1>Native hello</h1><p>Paragraph &amp; more.</p><button data-native-action="counter">Count</button></body>');
  assert.deepEqual(model, {title: 'Native hello', paragraphs: ['Paragraph & more.'], buttons: [{label: 'Count', action: 'counter'}]});
  assert.equal(cssRules('body { background: #101510 } button { color: #123456 }').button.color, '#123456');
});

test('WebPort generates an ABI-3 source package from Vite HTML without overwriting hand-written apps', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'brendan-webport-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const web = path.join(root, 'web-apps', 'sample');
  await fs.mkdir(path.join(web, 'dist', 'assets'), {recursive: true});
  await fs.writeFile(path.join(web, 'webapp.json'), JSON.stringify({
    format: 'brendan.webapp', apiVersion: 1, id: 'sample', name: 'Native sample', version: '1.0.0', runtime: 'static', distDir: 'dist',
    build: {tool: 'vite', entry: 'index.html', outDir: 'dist'},
    nativePort: {enabled: true, version: 1, actions: ['counter']}
  }));
  await fs.writeFile(path.join(web, 'index.html'), '<body><h1>Native sample</h1><p>Works on Switch.</p><button data-native-action="counter">Clicked 0 times</button></body>');
  await fs.writeFile(path.join(web, 'dist', 'index.html'), '<html><head><link rel="stylesheet" href="./assets/site.css"></head></html>');
  await fs.writeFile(path.join(web, 'dist', 'assets', 'site.css'), 'body { background: #101510 } .card { background: #171e18 } button { background: #a2ef5d }');
  const output = await build('sample', {root, skipVite: true, skipNativeBuild: true});
  const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
  const source = await fs.readFile(path.join(output, 'src', 'app.c'), 'utf8');
  assert.equal(manifest.abi, 3);
  assert.equal(manifest.id, 'sample-native');
  assert.match(source, /hbx_ui_begin/);
  assert.match(source, /HBX_A/);
  assert.match(source, /hbx_touch_hit/);
  assert.match(source, /Clicked /);
  await fs.unlink(path.join(output, '.webport-generated.json'));
  await assert.rejects(build('sample', {root, skipVite: true, skipNativeBuild: true}), /Refusing to overwrite/);
});

test('WebPort rejects undeclared native actions', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'brendan-webport-invalid-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const web = path.join(root, 'web-apps', 'sample');
  await fs.mkdir(path.join(web, 'dist'), {recursive: true});
  await fs.writeFile(path.join(web, 'webapp.json'), JSON.stringify({format:'brendan.webapp', runtime:'static', nativePort:{enabled:true,version:1,actions:[]}}));
  await fs.writeFile(path.join(web, 'index.html'), '<body><h1>Title</h1><button data-native-action="delete-all">Run</button></body>');
  await fs.writeFile(path.join(web, 'dist', 'index.html'), '<html></html>');
  await assert.rejects(build('sample', {root, skipVite:true, skipNativeBuild:true}), /unsupported or undeclared native action/);
});
