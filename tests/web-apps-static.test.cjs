'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {create}=require('../core/web-apps.cjs');
test('serves Vite static output on loopback and rejects path traversal',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'brendan-static-app-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const app=path.join(root,'web-apps','built-app'),dist=path.join(app,'dist');await fs.mkdir(path.join(dist,'assets'),{recursive:true});
 await fs.writeFile(path.join(app,'webapp.json'),JSON.stringify({format:'brendan.webapp',apiVersion:1,id:'built-app',name:'Built app',version:'1.0.0',runtime:'static',distDir:'dist',spa:true,build:{tool:'vite',entry:'index.html',outDir:'dist'}}));
 await fs.writeFile(path.join(dist,'index.html'),'<h1>Built app</h1>');await fs.writeFile(path.join(dist,'assets','app.js'),'compiled();');
 const manager=create(root);assert.equal((await manager.list())[0].state,'stopped');
 const started=await manager.start('built-app');assert.match(started.url,/^http:\/\/127\.0\.0\.1:\d+\/$/);
 assert.match(await fetch(started.url).then(r=>r.text()),/Built app/);
 const js=await fetch(new URL('/assets/app.js',started.url));assert.equal(js.headers.get('content-type'),'text/javascript; charset=utf-8');assert.equal(await js.text(),'compiled();');
 const traversal=await fetch(started.url+'%2e%2e%2fwebapp.json');assert.equal(traversal.status,400);
 await manager.stop('built-app');assert.equal((await manager.list())[0].state,'stopped');
});
test('static app without dist is marked needs-build',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'brendan-static-empty-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const app=path.join(root,'web-apps','empty');await fs.mkdir(app,{recursive:true});
 await fs.writeFile(path.join(app,'webapp.json'),JSON.stringify({format:'brendan.webapp',apiVersion:1,id:'empty',name:'Empty',version:'1.0.0',runtime:'static',distDir:'dist',build:{tool:'vite',entry:'index.html',outDir:'dist'}}));
 const manager=create(root);assert.equal((await manager.list())[0].state,'needs-build');await assert.rejects(manager.start('empty'),/node tools\/build-webapps.cjs/);
});
