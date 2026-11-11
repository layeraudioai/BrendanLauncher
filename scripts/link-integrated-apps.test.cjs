'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {linkIntegratedApps}=require('./link-integrated-apps.cjs');

async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'integrated-app-links-'));
 const target=path.join(root,'modules','sample','switch');
 const link=path.join(root,'data','app-links','sample');
 await fs.mkdir(target,{recursive:true});
 await fs.writeFile(path.join(target,'app.json'),'{}');
 await fs.mkdir(link,{recursive:true});
 return {root,target,link};
}

test('Replaces only an empty stale app directory and is repeatable',async()=>{
 const {root,target,link}=await fixture();
 try{
  await linkIntegratedApps({projectRoot:root,ids:['sample']});
  assert.equal(await fs.realpath(link),await fs.realpath(target));
  await linkIntegratedApps({projectRoot:root,ids:['sample']});
  assert.equal(await fs.realpath(link),await fs.realpath(target));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('Preserves a populated app directory and refuses to replace it',async()=>{
 const {root,link}=await fixture(),userFile=path.join(link,'app.json');
 try{
  await fs.writeFile(userFile,'{"id":"user-app"}');
  await assert.rejects(linkIntegratedApps({projectRoot:root,ids:['sample']}),/Refusing to replace existing non-link app/);
  assert.equal(await fs.readFile(userFile,'utf8'),'{"id":"user-app"}');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
