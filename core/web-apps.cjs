'use strict';
/*
 * Local web-app runner for the host panel. Node apps run as child processes;
 * built static/Vite apps use a small loopback static server. This is NOT a
 * sandbox: Node app code has the current user's permissions.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const {createReadStream} = require('node:fs');
const {spawn} = require('node:child_process');
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const MAX_APPS = 64;
const MAX_LOG = 4096;
function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 240 &&
    !value.includes('\\') && !value.includes(':') && !/[\x00-\x20\x7f]/.test(value) && !value.startsWith('/') &&
    value.split('/').every(part => part && part !== '.' && part !== '..');
}
function safeEntry(value) { return safeRelative(value) && value.endsWith('.js'); }
function safeDir(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 &&
    !value.includes('\\') && !value.includes(':') && !value.startsWith('/') &&
    value.split('/').every(part => part && part !== '.' && part !== '..');
}
function safePath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') &&
    !/[\\\r\n\0]/.test(value) && !/%(?:2e|2f|5c)/i.test(value) && !value.split('/').includes('..');
}
function safeEnvironment() {
  const env = {};
  for (const key of ['PATH','HOME','TMPDIR','TMP','TEMP','SYSTEMROOT','WINDIR','LANG','LC_ALL','PYTHON','PYTHON3'])
    if (process.env[key]) env[key] = process.env[key];
  return env;
}
async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  return port;
}
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.wasm':'application/wasm','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8'};
function create(root) {
  const directory=path.join(root,'web-apps'),active=new Map();
  async function catalog() {
    let entries;try{entries=await fs.readdir(directory,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}
    const apps=[];
    for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
      if(!entry.isDirectory()||entry.isSymbolicLink()||!ID.test(entry.name))continue;
      try{
        const base=path.join(directory,entry.name),manifestPath=path.join(base,'webapp.json'),st=await fs.lstat(manifestPath);
        if(!st.isFile()||st.isSymbolicLink()||st.size>16384)continue;
        const m=JSON.parse(await fs.readFile(manifestPath,'utf8'));
        if(m.format!=='brendan.webapp'||m.apiVersion!==1||m.id!==entry.name||!ID.test(m.id)||typeof m.name!=='string'||!m.name.trim()||m.name.length>80||typeof m.version!=='string'||m.version.length>40||!safePath(m.path||'/'))continue;
        const runtime=m.runtime||'node';
        if(!['node','static'].includes(runtime))continue;
        let entryFile=null,distDir=null,build=null,built=true;
        if(m.build!==undefined){if(!m.build||m.build.tool!=='vite'||!safeRelative(m.build.entry||'index.html')||!safeDir(m.build.outDir||m.distDir||'dist'))continue;build={tool:'vite',entry:m.build.entry||'index.html',outDir:m.build.outDir||m.distDir||'dist'};}
        if(runtime==='node'){
          if(!safeEntry(m.entry))continue;
          entryFile=path.join(base,m.entry);const es=await fs.lstat(entryFile);if(!es.isFile()||es.isSymbolicLink())continue;
        }else{
          const distName=m.distDir||build?.outDir||'dist';if(!safeDir(distName))continue;
          if(build&&build.outDir!==distName)continue;
          distDir=path.join(base,distName);
          try{const ds=await fs.lstat(distDir);if(!ds.isDirectory()||ds.isSymbolicLink())continue;const is=await fs.lstat(path.join(distDir,'index.html'));if(!is.isFile()||is.isSymbolicLink())continue;}catch(e){if(e.code!=='ENOENT')throw e;built=false;}
          if(m.spa!==undefined&&typeof m.spa!=='boolean')continue;
        }
        const nativePort=m.nativePort?.enabled===true&&m.nativePort.version===1?{version:1,actions:Array.isArray(m.nativePort.actions)?m.nativePort.actions.filter(x=>typeof x==='string').slice(0,16):[]}:null;
        apps.push({id:m.id,name:m.name,version:m.version,description:typeof m.description==='string'?m.description.slice(0,240):'',runtime,path:m.path||'/',entry:entryFile,distDir,spa:m.spa===true,build,built,nativePort,folder:base});
        if(apps.length>=MAX_APPS)break;
      }catch{}
    }
    return apps;
  }
  async function list(){const apps=await catalog();return apps.map(({folder,entry,distDir,built,...a})=>({...a,state:active.get(a.id)?.state||(a.runtime==='static'&&!built?'needs-build':'stopped'),url:active.get(a.id)?.url||null,log:active.get(a.id)?.log||''}));}
  async function startStatic(app){
    let dist;try{dist=await fs.realpath(app.distDir);}catch{throw Error(`Web app ${app.id} has no built dist/index.html. Run node tools/build-webapps.cjs ${app.id}.`);}
    const appRoot=await fs.realpath(app.folder);
    if(!dist.startsWith(appRoot+path.sep))throw Error('Static app output must remain inside its app folder');
    const port=await reservePort();
    const server=http.createServer(async(req,res)=>{
      res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');res.setHeader('cache-control','no-store');
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'allow':'GET, HEAD'});return res.end();}
      try{
        const url=new URL(req.url,'http://127.0.0.1');let relative;
        try{relative=decodeURIComponent(url.pathname);}catch{res.writeHead(400);return res.end('Bad path');}
        if(relative.includes('\\')||relative.split('/').includes('..')||relative.includes('\0')){res.writeHead(400);return res.end('Bad path');}
        let file=path.resolve(dist,'.'+relative);
        if(!file.startsWith(dist+path.sep)&&file!==dist){res.writeHead(403);return res.end('Forbidden');}
        try{if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');await fs.access(file);}
        catch{if(app.spa)file=path.join(dist,'index.html');else{res.writeHead(404);return res.end('Not found');}}
        const real=await fs.realpath(file);if(!real.startsWith(dist+path.sep)){res.writeHead(403);return res.end('Forbidden');}
        const stat=await fs.stat(real);if(!stat.isFile()){res.writeHead(404);return res.end('Not found');}
        res.writeHead(200,{'content-type':TYPES[path.extname(real).toLowerCase()]||'application/octet-stream','content-length':stat.size});
        if(req.method==='HEAD')return res.end();
        const stream=createReadStream(real);stream.on('error',()=>{if(!res.headersSent)res.writeHead(500);res.end();});stream.pipe(res);
      }catch{if(!res.headersSent)res.writeHead(500);res.end('Server error');}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
    const row={id:app.id,server,state:'running',url:`http://127.0.0.1:${port}${app.path}`,log:''};active.set(app.id,row);
    server.once('close',()=>{if(active.get(app.id)===row)active.delete(app.id);});
    return {id:app.id,state:'running',url:row.url};
  }
  async function start(id){
    if(typeof id!=='string'||!ID.test(id))throw Error('Invalid web app id');
    const app=(await catalog()).find(item=>item.id===id);if(!app)throw Error('Web app is missing or its manifest is invalid');
    const existing=active.get(id);if(existing?.state==='running')return {id,state:'running',url:existing.url};if(existing)await stop(id);
    if(app.runtime==='static')return startStatic(app);
    const port=await reservePort(),env={...safeEnvironment(),HOST:'127.0.0.1',PORT:String(port),NODE_ENV:'production',BRENDAN_WEBAPP_ID:id};
    const child=spawn(process.execPath,[app.entry],{cwd:app.folder,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
    const row={id,child,state:'starting',url:`http://127.0.0.1:${port}${app.path}`,log:''};
    const append=chunk=>{row.log=(row.log+chunk.toString()).slice(-MAX_LOG);};child.stdout.on('data',append);child.stderr.on('data',append);child.once('error',error=>append(`\n${error.message}`));
    child.once('exit',(code,signal)=>{row.state='stopped';row.exit={code,signal};if(active.get(id)===row)active.delete(id);});active.set(id,row);
    const deadline=Date.now()+8000;let lastError;
    while(Date.now()<deadline){if(child.exitCode!==null||child.signalCode)break;try{await new Promise((resolve,reject)=>{const socket=net.connect({host:'127.0.0.1',port});socket.setTimeout(300);socket.once('connect',()=>{socket.destroy();resolve();});socket.once('timeout',()=>{socket.destroy();reject(Error('timed out'));});socket.once('error',reject);});row.state='running';return {id,state:row.state,url:row.url};}catch(error){lastError=error;}await new Promise(resolve=>setTimeout(resolve,100));}
    const detail=row.log.trim();await stop(id);throw Error(`Web app did not listen on 127.0.0.1:${port}. It must use process.env.HOST and process.env.PORT.${detail?` ${detail}`:lastError?` ${lastError.message}`:''}`.slice(0,1000));
  }
  async function stop(id){const row=active.get(id);if(!row)return {id,state:'stopped'};
    if(row.server){await new Promise(resolve=>row.server.close(()=>resolve()));active.delete(id);return {id,state:'stopped'};}
    await new Promise(resolve=>{const timer=setTimeout(()=>{row.child.kill('SIGKILL');resolve();},3000);row.child.once('exit',()=>{clearTimeout(timer);resolve();});row.child.kill('SIGTERM');});active.delete(id);return {id,state:'stopped'};
  }
  async function build(id){
    if(typeof id!=='string'||!ID.test(id))throw Error('Invalid web app id');
    const app=(await catalog()).find(item=>item.id===id);if(!app||app.runtime!=='static'||!app.build)throw Error('Web app has no supported Vite build configuration');
    const child=spawn(process.execPath,[path.join(root,'tools','build-webapps.cjs'),id,'--install'],{cwd:root,env:safeEnvironment(),stdio:['ignore','pipe','pipe'],windowsHide:true});
    let output='';const append=b=>{output=(output+b.toString()).slice(-MAX_LOG*4);};child.stdout.on('data',append);child.stderr.on('data',append);
    await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(Error((output.trim()||`Vite build failed (${signal||code})`).slice(-MAX_LOG*2))));});
    return {id,state:'built',output};
  }
  async function port(id){
    if(typeof id!=='string'||!ID.test(id))throw Error('Invalid web app id');
    const app=(await catalog()).find(item=>item.id===id);if(!app||!app.nativePort)throw Error('Web app has no enabled nativePort v1 configuration');
    const child=spawn(process.execPath,[path.join(root,'tools','port-webapp.cjs'),id],{cwd:root,env:safeEnvironment(),stdio:['ignore','pipe','pipe'],windowsHide:true});
    let output='';const append=b=>{output=(output+b.toString()).slice(-MAX_LOG*4);};child.stdout.on('data',append);child.stderr.on('data',append);
    await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(Error((output.trim()||`Native web port failed (${signal||code})`).slice(-MAX_LOG*2))));});
    return {id,state:'ported',nativeAppId:`${id}-native`,output};
  }
  async function close(){await Promise.all([...active.keys()].map(stop));}
  return {list,start,stop,build,port,close};
}
module.exports={create,safeEntry,safeDir,safePath};
