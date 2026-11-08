'use strict';
const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs/promises'); const os=require('node:os'); const path=require('node:path');
const {scan,classify}=require('../tools/boot-file-catalog.cjs'); const {inspect}=require('../tools/nro-inspect.cjs');
function nro(){const b=Buffer.alloc(0x100);b.write('NRO0',0x10,'ascii');b.writeUInt32LE(0x80,0x18);return b;}
test('catalogs NRO and raw payloads read-only and marks both non-runnable',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bootfiles-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'nested')); await fs.writeFile(path.join(root,'nested','homebrew.nro'),nro());await fs.writeFile(path.join(root,'payload.bin'),Buffer.from([1,2,3,4]));await fs.writeFile(path.join(root,'bad.nro'),Buffer.from('not an NRO'));
 const c=await scan(root);assert.equal(c.launchEnabled,false);assert.equal(c.entries.length,3);
 const app=c.entries.find(x=>x.name==='homebrew.nro');assert.equal(app.headerValid,true);assert.equal(app.runnable,false);assert.equal(app.nro.imageBytes,0x80);assert.equal(app.nro.segments.length,3);
 const bad=c.entries.find(x=>x.name==='bad.nro');assert.equal(bad.headerValid,false);assert.match(bad.reason,/NRO header|NRO0/);
 const bin=c.entries.find(x=>x.name==='payload.bin');assert.equal(bin.kind,'raw-payload');assert.equal(bin.runnable,false);
 assert.deepEqual(await fs.readFile(path.join(root,'nested','homebrew.nro')),nro());
});
test('skips symlinks and non-target extensions',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bootfiles-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'no.txt'),'x');
 const outside=await fs.mkdtemp(path.join(os.tmpdir(),'bootfiles-outside-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));
 await fs.writeFile(path.join(outside,'hidden.bin'),'secret');
 await fs.symlink(outside,path.join(root,'linked'));
 const c=await scan(root);assert.deepEqual(c.entries,[]);
});
test('NRO parser rejects invalid sizes and out-of-bounds segments',()=>{const b=nro();b.writeUInt32LE(0xffffffff,0x18);assert.throws(()=>inspect(b),/image size/);const c=nro();c.writeUInt32LE(0x100,0x20);c.writeUInt32LE(0x100,0x24);assert.throws(()=>inspect(c),/outside file/);});
test('classification explicitly disables execution',()=>{assert.equal(classify('.bin').runnable,false);assert.equal(classify('.nro').runnable,false);});
