'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const ids=['blitbun','iz-exchange','vacootube'];

test('bundled IZ apps expose valid shared GPU packages and host-service entry points',async()=>{
 const catalog=require('../core/services/app-catalog.cjs');
 const modules=require('../core/modules.cjs');
 const inventory=await modules.list(root);
 assert.deepEqual(inventory.errors,[]);
 for(const id of ids){
  const app=await catalog.readApp(path.join(root,'modules',id,'switch'),{validate:false});
  assert.equal(app.id,id);
  assert.match(app.manifest.hostRuntime,/^module:/);
  assert.equal(app.manifest.format,'hblauncher.gpu-app');
  await modules.verify(root,[id]);
  const descriptor=inventory.modules.find(item=>item.id===id);
  assert.ok(descriptor,`missing module ${id}`);
  const [owner,entry]=app.manifest.hostRuntime.slice('module:'.length).split('/');
  assert.equal(owner,id);
  const component=(await modules.loadServer(root,id)).load(entry);
  assert.equal(typeof component.create,'function',`${id} does not export create()`);
  const archive=await fs.readFile(path.join(root,'apps',id,id+'.izm'));
  const unpacked=require('../core/archive.cjs').inspect(archive);
  assert.equal(unpacked.descriptor.id,id);
 }
});

test('Media Machine metadata and emulator packages pass ABI and bounded-data checks',async()=>{
 const catalog=require('../core/services/app-catalog.cjs');
 for(const id of ['media-machine','gameboy-color']){
  const app=await catalog.readApp(path.join(root,'apps',id),{validate:false});
  assert.equal(app.id,id);
  assert.equal(app.manifest.format,'hblauncher.gpu-app');
  assert.ok(app.files.data.bytes.length<=7*1024*1024);
 }
 const media=JSON.parse(await fs.readFile(path.join(root,'apps/media-machine/assets/video-stream.json'),'utf8'));
 for(const clip of Object.values(media)){
  assert.equal(clip.width,1600);assert.equal(clip.height,900);assert.equal(clip.frameRate,5);
  assert.ok(clip.offset+clip.width*clip.height*2<=7*1024*1024);
 }
});
