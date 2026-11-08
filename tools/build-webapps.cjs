'use strict';
/* Build trusted TypeScript/Vite web-app sources to static dist/ assets. */
const fs=require('node:fs/promises');const path=require('node:path');const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),WEB=path.join(ROOT,'web-apps');
const ID=/^[a-z0-9][a-z0-9-]{0,47}$/;
function rel(value){return typeof value==='string'&&value.length>0&&value.length<=240&&!value.includes('\\')&&!value.includes(':')&&!value.startsWith('/')&&value.split('/').every(p=>p&&p!=='.'&&p!=='..');}
async function isFile(file){try{return (await fs.lstat(file)).isFile();}catch{return false;}}
async function buildApp(id,{install=false,root=ROOT}={}){
 if(!ID.test(id))throw Error('Invalid web-app id: '+id);
 const webRoot=path.join(root,'web-apps'),dir=path.join(webRoot,id),manifest=JSON.parse(await fs.readFile(path.join(dir,'webapp.json'),'utf8'));
 if(manifest.format!=='brendan.webapp'||manifest.apiVersion!==1||manifest.id!==id||manifest.runtime!=='static'||manifest.build?.tool!=='vite')throw Error(`${id}: expected a static brendan.webapp Vite manifest`);
 const entry=manifest.build.entry||'index.html',outDir=manifest.build.outDir||manifest.distDir||'dist';
 if(manifest.distDir&&manifest.distDir!==outDir)throw Error(`${id}: build.outDir must match distDir`);
 if(!rel(entry)||entry!=='index.html'||!rel(outDir))throw Error(`${id}: Vite root entry must be index.html and output paths must be safe`);
 const source=path.join(dir,entry);if(!await isFile(source))throw Error(`${id}: missing Vite entry ${entry}`);
 const viteCli=path.join(dir,'node_modules','vite','bin','vite.js');
 if(!await isFile(viteCli)){
   if(!install)throw Error(`${id}: Vite is not installed. Run npm install in ${path.relative(ROOT,dir)} or use --install.`);
   const npm=process.platform==='win32'?'npm.cmd':'npm';
   execFileSync(npm,['install','--ignore-scripts','--no-audit','--no-fund'],{cwd:dir,stdio:'inherit',env:process.env,shell:process.platform==='win32'});
 }
 if(!await isFile(viteCli))throw Error(`${id}: npm install completed but local vite/bin/vite.js was not found`);
 console.log(`[webapps] Vite build ${id}: ${entry} -> ${outDir}`);
 execFileSync(process.execPath,[viteCli,'build','--base','./','--outDir',outDir,'--emptyOutDir'],{cwd:dir,stdio:'inherit',env:process.env});
 if(!await isFile(path.join(dir,outDir,'index.html')))throw Error(`${id}: Vite did not produce ${outDir}/index.html`);
 console.log(`[webapps] Built ${id}`);
}
async function main(){const args=process.argv.slice(2),install=args.includes('--install'),ids=args.filter(a=>a!=='--install');let entries=[];try{entries=await fs.readdir(WEB,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
 const apps=[];for(const e of entries)if(e.isDirectory()&&ID.test(e.name)){try{const m=JSON.parse(await fs.readFile(path.join(WEB,e.name,'webapp.json'),'utf8'));if(m.build?.tool==='vite')apps.push(e.name);}catch{}}
 const selected=ids.length?ids:apps;if(!selected.length){console.log('[webapps] No Vite web apps configured.');return;}
 for(const id of selected)await buildApp(id,{install});
}
if(require.main===module)main().catch(error=>{console.error('[webapps build failed] '+(error.stack||error.message));process.exitCode=1;});
module.exports={buildApp};
