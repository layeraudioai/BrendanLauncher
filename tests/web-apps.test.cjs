'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {create, safeEntry, safePath} = require('../core/web-apps.cjs');
const rootFor = async () => fs.mkdtemp(path.join(os.tmpdir(), 'brendan-webapps-'));
async function fixture(root, id, manifest, entry) {
  const dir = path.join(root, 'web-apps', id);
  await fs.mkdir(dir, {recursive: true});
  await fs.writeFile(path.join(dir, 'webapp.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(dir, 'server.js'), entry);
}
const manifest = {format:'brendan.webapp',apiVersion:1,id:'sample',name:'Sample',version:'1.0.0',entry:'server.js',path:'/'};
test('validates manifest paths and only catalogs valid web app folders', async t => {
  const root = await rootFor(); t.after(() => fs.rm(root,{recursive:true,force:true}));
  await fixture(root,'sample',manifest,"require('node:http').createServer((q,s)=>s.end('ok')).listen(+process.env.PORT,process.env.HOST)");
  await fixture(root,'bad',{...manifest,id:'bad',entry:'../server.js'},'');
  const manager=create(root);
  assert.deepEqual((await manager.list()).map(a=>a.id),['sample']);
  assert.equal(safeEntry('../x.js'),false); assert.equal(safePath('//evil.test/'),false);
  assert.equal(safePath('/ok'),true);
});
test('starts Node web app with loopback dynamic host/port, then stops it', async t => {
  const root = await rootFor(); t.after(() => fs.rm(root,{recursive:true,force:true}));
  await fixture(root,'sample',manifest,"const h=require('node:http');h.createServer((q,s)=>s.end('webapp-ok')).listen(+process.env.PORT,process.env.HOST)");
  const manager=create(root);
  const running=await manager.start('sample');
  assert.equal(running.state,'running'); assert.match(running.url,/^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.equal(await fetch(running.url).then(r=>r.text()),'webapp-ok');
  assert.equal((await manager.list())[0].state,'running');
  await manager.stop('sample'); assert.equal((await manager.list())[0].state,'stopped');
});
test('rejects malformed manifest and exits cleanly when app fails', async t => {
  const root = await rootFor(); t.after(() => fs.rm(root,{recursive:true,force:true}));
  await fixture(root,'sample',{...manifest,path:'//bad'},'');
  const manager=create(root); assert.deepEqual(await manager.list(),[]);
  await assert.rejects(manager.start('sample'),/missing or its manifest is invalid/);
});
console.log('Node web-app host manager: manifest validation, start/stop and loopback verified');
