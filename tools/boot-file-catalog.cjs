'use strict';
/* Read-only inventory for user-supplied .bin boot payloads and .nro homebrew.
 * Does not upload, inject, reboot, chainload, or alter files. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const nroInspector = require('./nro-inspect.cjs');
const MAX_ENTRIES = 512, MAX_DEPTH = 8, MAX_FILE = 512 * 1024 * 1024;
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function classify(extension) {
  if (extension === '.bin') return {kind:'raw-payload', runnable:false, reason:'No BrendanLauncher NS2 reboot-to-payload transport is available'};
  return {kind:'switch-homebrew-nro', runnable:false, reason:'No BrendanLauncher or SmileBASIC 4 NRO loader is available'};
}
async function scan(root) {
  root = path.resolve(root); const result = [];
  async function walk(dir, depth) {
    if (depth > MAX_DEPTH) return;
    const entries = await fs.readdir(dir, {withFileTypes:true});
    entries.sort((a,b)=>a.name.localeCompare(b.name));
    for (const e of entries) {
      if (result.length >= MAX_ENTRIES) throw new Error(`Catalog limit reached (${MAX_ENTRIES})`);
      if (e.isSymbolicLink() || e.name.startsWith('.')) continue;
      const file = path.join(dir,e.name);
      if (e.isDirectory()) { await walk(file,depth+1); continue; }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase(); if (ext !== '.bin' && ext !== '.nro') continue;
      const stat = await fs.stat(file); if (stat.size > MAX_FILE) continue;
      const bytes = await fs.readFile(file);
      const entry = {name:e.name, relativePath:path.relative(root,file).split(path.sep).join('/'), extension:ext, bytes:stat.size, sha256:sha(bytes), ...classify(ext)};
      if (ext === '.nro') { try { entry.nro = nroInspector.inspect(bytes); entry.headerValid = true; } catch (error) { entry.headerValid = false; entry.reason = error.message; } }
      result.push(entry);
    }
  }
  await walk(root,0);
  return {root, entries:result, launchEnabled:false, note:'Inventory only: file selection never transfers or executes a payload.'};
}
async function main(argv=process.argv.slice(2)) {
  if (argv.length===1 && ['--help','-h'].includes(argv[0])) { console.log('Read-only .bin/.nro inventory\n\nnode tools/boot-file-catalog.cjs <folder-to-scan>\nDefault scan roots in project: payloads/ and nros/'); return 0; }
  const roots=argv.length?argv:[path.resolve(__dirname,'../payloads'),path.resolve(__dirname,'../nros')];
  const catalogs=[];
  for(const root of roots){try{catalogs.push(await scan(root));}catch(e){if(e.code==='ENOENT') catalogs.push({root:path.resolve(root),entries:[],missing:true}); else throw e;}}
  console.log(JSON.stringify({catalogs,launchEnabled:false},null,2)); return 0;
}
if(require.main===module) main().then(c=>process.exitCode=c).catch(e=>{console.error('Boot-file catalog:',e.message);process.exitCode=1;});
module.exports={MAX_ENTRIES,MAX_DEPTH,MAX_FILE,scan,classify};
