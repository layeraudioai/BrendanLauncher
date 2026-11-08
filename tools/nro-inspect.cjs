'use strict';
/* Conservative, read-only parser for the public libnx NRO container layout.
 * It validates file bounds only; it does not map, relocate, link, or execute code. */
const fs=require('node:fs/promises');
const path=require('node:path');
const NRO_MAGIC=0x304f524e, ASSET_MAGIC=0x54455341;
const HEADER_OFFSET=0x10, HEADER_BYTES=0x70, ASSET_BYTES=0x38;
function fail(message){throw new Error(message);}
function checkedRange(offset,size,limit,label){
 if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0||offset+size>limit) fail(`${label} lies outside file`);
 return {offset,size};
}
function inspect(bytes){
 if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);
 if(bytes.length<HEADER_OFFSET+HEADER_BYTES)fail('File is too short for an NRO header');
 if(bytes.readUInt32LE(HEADER_OFFSET)!==NRO_MAGIC)fail('NRO0 magic not found at 0x10');
 const imageSize=bytes.readUInt32LE(HEADER_OFFSET+8);
 if(imageSize<HEADER_OFFSET+HEADER_BYTES||imageSize>bytes.length)fail('NRO image size is invalid');
 const segments=[];
 for(let i=0;i<3;i++){
  const at=HEADER_OFFSET+0x10+i*8,offset=bytes.readUInt32LE(at),size=bytes.readUInt32LE(at+4);
  checkedRange(offset,size,imageSize,`segment ${i}`);
  segments.push({name:['text','rodata','data'][i],offset,size});
 }
 const bssBytes=bytes.readUInt32LE(HEADER_OFFSET+0x28);
 const modOffset=bytes.readUInt32LE(4);
 if(modOffset && (modOffset>=imageSize || modOffset%4!==0))fail('NRO module offset is invalid');
 const buildId=bytes.subarray(HEADER_OFFSET+0x30,HEADER_OFFSET+0x50).toString('hex');
 let assets=null;
 if(imageSize+ASSET_BYTES<=bytes.length && bytes.readUInt32LE(imageSize)===ASSET_MAGIC){
  const version=bytes.readUInt32LE(imageSize+4);
  if(version!==0)fail(`Unsupported NRO asset header version ${version}`);
  const sections={};
  for(let i=0;i<3;i++){
   const at=imageSize+8+i*16,offset=Number(bytes.readBigUInt64LE(at)),size=Number(bytes.readBigUInt64LE(at+8));
   if(size)checkedRange(offset,size,bytes.length,['icon','nacp','romfs'][i]);
   sections[['icon','nacp','romfs'][i]]={offset,size};
  }
  assets={version,sections};
 }
 return {format:'NRO0',fileBytes:bytes.length,imageBytes:imageSize,bssBytes,modOffset,buildId,segments,assets,bytesAfterImage:bytes.length-imageSize};
}
async function inspectFile(filename){const st=await fs.stat(filename);if(!st.isFile()||st.size>512*1024*1024)fail('Input must be a regular file <=512 MiB');return {path:path.resolve(filename),...inspect(await fs.readFile(filename))};}
async function main(argv=process.argv.slice(2)){if(argv.length===1&&['--help','-h'].includes(argv[0])){console.log('Read-only NRO header/segment inspector.\n\nnode tools/nro-inspect.cjs <app.nro>');return 0;}if(argv.length!==1)fail('Usage: node tools/nro-inspect.cjs <app.nro>');console.log(JSON.stringify(await inspectFile(argv[0]),null,2));return 0;}
if(require.main===module)main().then(c=>process.exitCode=c).catch(e=>{console.error('NRO inspector:',e.message);process.exitCode=1;});
module.exports={inspect,inspectFile};
