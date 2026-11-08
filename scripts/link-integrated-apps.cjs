'use strict';
// Expose bundled IZLauncher switch packages to BrendanLauncher’s unified
// catalog. Never replace a user-managed app directory or external symlink.
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const modules=['blitbun','iz-exchange','vacootube'];
(async()=>{
 const library=path.join(root,'data','app-links');
 await fs.mkdir(library,{recursive:true});
 for(const id of modules){
  const target=path.join(root,'modules',id,'switch');
  const marker=path.join(target,'app.json');
  await fs.access(marker);
  const link=path.join(library,id);
  try{
   const stat=await fs.lstat(link);
   if(!stat.isSymbolicLink())throw Error(`Refusing to replace existing non-link app: ${link}`);
   const existing=await fs.realpath(link);
   if(existing!==await fs.realpath(target))throw Error(`App link points elsewhere; refusing to change: ${link}`);
  }catch(error){
   if(error.code!=='ENOENT')throw error;
   const type=process.platform==='win32'?'junction':'dir';
   const linkTarget=process.platform==='win32'?target:path.relative(library,target);
   await fs.symlink(linkTarget,link,type);
  }
  console.log(`${id}: available in BrendanLauncher app library`);
 }
})().catch(error=>{console.error('Integrated app setup failed:',error.message);process.exitCode=1;});
