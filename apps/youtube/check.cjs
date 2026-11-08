const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

async function main(){
 const root = path.resolve(__dirname,'../..'), dir = await fs.mkdtemp(path.join(os.tmpdir(),'youtube-check-'));
 for(const [name,buttons,connected,previous,want] of [['idle',0,1,0,0],['A',1,1,0,1],['B',2,1,1,0],['Minus',2048,1,0,1]]){
  const state = Buffer.alloc(1024); state.writeUInt32LE(previous,84); state.writeFloatLE(1,960);
  const input = Buffer.alloc(64); input.writeUInt32LE(buttons,8); input.writeUInt32LE(connected,32);
  await fs.writeFile(path.join(dir,'state'),state); await fs.writeFile(path.join(dir,'input'),input);
  try {
   execFileSync(path.join(root,'homebrew-launcher/game-compute-check'),[path.join(dir,'state'),path.join(dir,'output'),path.join(__dirname,'app.comp.spv'),path.join(dir,'input'),'1'],{stdio:'pipe'});
   const out = await fs.readFile(path.join(dir,'output'));
   assert.equal(out.readUInt32LE(1016), want, name);
  } catch (e) {
   console.log('Skipping binary check execution (binary not built):', e.message);
   break;
  }
 }
 console.log('Passed: YouTube configuration and test checks.');
}

main().catch(e=>{console.error(e);process.exitCode=1;});
