'use strict';
// Expose bundled IZLauncher switch packages to BrendanLauncher’s unified
// catalog. Preserve populated user apps and external symlinks.
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const modules=['blitbun','iz-exchange','vacootube'];

async function linkIntegratedApps({projectRoot=root,ids=modules}={}){
 const library=path.join(projectRoot,'data','app-links');
 await fs.mkdir(library,{recursive:true});
 for(const id of ids){
  const target=path.join(projectRoot,'modules',id,'switch');
  await fs.access(path.join(target,'app.json'));
  const link=path.join(library,id);
  let create=true;
  try{
   const stat=await fs.lstat(link);
   if(stat.isSymbolicLink()){
    const existing=await fs.realpath(link);
    if(existing!==await fs.realpath(target))throw Error(`App link points elsewhere; refusing to change: ${link}`);
    create=false;
   }else if(stat.isDirectory()){
    const entries=await fs.readdir(link);
    if(entries.length)throw Error(`Refusing to replace existing non-link app: ${link}`);
    await fs.rmdir(link);
   }else{
    throw Error(`Refusing to replace existing non-link app: ${link}`);
   }
  }catch(error){
   if(error.code!=='ENOENT')throw error;
  }
  if(create){
   const type=process.platform==='win32'?'junction':'dir';
   const linkTarget=process.platform==='win32'?target:path.relative(library,target);
   await fs.symlink(linkTarget,link,type);
  }
  console.log(`${id}: available in BrendanLauncher app library`);
 }
}

if(require.main===module){
 linkIntegratedApps().catch(error=>{console.error('Integrated app setup failed:',error.message);process.exitCode=1;});
}
module.exports={linkIntegratedApps};
