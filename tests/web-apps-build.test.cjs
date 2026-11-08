'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {buildApp}=require('../tools/build-webapps.cjs');
test('Vite builder compiles a configured TypeScript web app into static output',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'brendan-vite-build-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const app=path.join(root,'web-apps','sample');await fs.mkdir(path.join(app,'node_modules','vite','bin'),{recursive:true});
 await fs.writeFile(path.join(app,'webapp.json'),JSON.stringify({format:'brendan.webapp',apiVersion:1,id:'sample',name:'Sample',version:'1.0.0',runtime:'static',distDir:'dist',build:{tool:'vite',entry:'index.html',outDir:'dist'}}));
 await fs.writeFile(path.join(app,'index.html'),'<script type="module" src="/src/main.ts"></script>');
 await fs.writeFile(path.join(app,'node_modules','vite','bin','vite.js'),`const fs=require('node:fs');const path=require('node:path');const args=process.argv;const out=args[args.indexOf('--outDir')+1];fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'index.html'),'<html><script type="module" src="./assets.js"></script></html>');fs.writeFileSync(path.join(out,'assets.js'),'compiled TS bundle');`);
 await buildApp('sample',{root});
 assert.match(await fs.readFile(path.join(app,'dist','index.html'),'utf8'),/assets.js/);
 assert.equal(await fs.readFile(path.join(app,'dist','assets.js'),'utf8'),'compiled TS bundle');
});
test('Vite builder rejects unsafe source/output paths',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'brendan-vite-invalid-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const app=path.join(root,'web-apps','sample');await fs.mkdir(app,{recursive:true});
 await fs.writeFile(path.join(app,'webapp.json'),JSON.stringify({format:'brendan.webapp',apiVersion:1,id:'sample',runtime:'static',build:{tool:'vite',entry:'../outside.html',outDir:'dist'}}));
 await assert.rejects(buildApp('sample',{root}),/Vite root entry must be index.html/);
});
