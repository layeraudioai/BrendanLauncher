// Start the standard 4/4 session and restore the picker once it is verified.
const {spawn}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const {ns2jbDir}=require('../host/lib/session.cjs');
const children=new Set();
let stopping;
function start(script,args=[],readyText,cwd=root){
 const child=spawn(process.execPath,[script,...args],{cwd,stdio:['ignore','pipe','inherit'],
  env:{...process.env,NS2_RPC_TIMEOUT_MS:process.env.NS2_RPC_TIMEOUT_MS||'86400000'}});
 child.script=script;children.add(child);let output='',readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 // Some stages only need completion; keep unused readiness rejections handled.
 ready.catch(()=>{});
 child.stdout.on('data',bytes=>{
  process.stdout.write(bytes);output=(output+bytes).slice(-32768);
  if(readyText&&(typeof readyText==='function'?readyText(output):output.includes(readyText)))readyResolve(output);
 });
 const done=new Promise((resolve,reject)=>{
  child.once('error',reject);
  child.once('close',(code,signal)=>{children.delete(child);readyReject(Error(script+' exited before ready'));if(code===0)resolve(output);else reject(Error(script+' exited: '+(signal||code)));});
 });
 done.catch(()=>{});return {child,ready,done};
}
function stop(){
 if(stopping)return stopping;
 stopping=(async()=>{
  async function end(child){
   if(!children.has(child))return;
   await new Promise(resolve=>{const timer=setTimeout(resolve,5000);child.once('close',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});
  }
  // Keep RPC alive until the audio owner has stopped its console output.
  await Promise.all([...children].filter(c=>path.basename(c.script)==='game-audio.cjs').map(end));
  await Promise.all([...children].filter(c=>!c.sessionHost).map(end));
  await Promise.all([...children].map(end));
 })();return stopping;
}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
async function main(){
 const runner=ns2jbDir(),host=start(path.join(runner,'run.cjs'),['--rpc',...process.argv.slice(2)],
  output=>output.includes('4/4 verified.')&&/Run folder: [^\r\n]+/.test(output),runner);
 host.child.sessionHost=true;
 try{
  const output=await host.ready;
  const match=output.match(/Run folder: ([^\r\n]+)/);if(!match)throw Error('Missing fresh run directory');
  const directory=match[1];
  const stages=[['homebrew-launcher/inspect-display.cjs'],['homebrew-launcher/inspect-compatibility.cjs'],['homebrew-launcher/inspect-input.cjs'],['homebrew-launcher/vulkan-copy.cjs','display'],['homebrew-launcher/launcher.cjs','auto'],['homebrew-launcher/launcher-check.cjs','auto']];
  for(const [script,...args] of stages)await start(script,[directory,...args]).done;
  const graphics=start('homebrew-launcher/launcher-loop.cjs',[directory,'auto'],'HBLauncher game event source ready.');
  await graphics.ready;
  const effects=start('homebrew-launcher/game-audio.cjs',[directory],'Game sound effects ready.');await effects.ready;
  console.log('BrendanLauncher GPU and CPU apps are running in the verified 4/4 session.');
  await Promise.race([host.done,graphics.done,effects.done]);
 }finally{await stop();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
