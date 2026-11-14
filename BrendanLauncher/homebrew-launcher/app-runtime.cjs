const fs=require('node:fs/promises'),path=require('node:path');
const catalogTools=require('./app-catalog.cjs');
const {prepare}=require('./gpu-app.cjs');
const check=(v,m)=>{if(!v)throw Error(m);};
async function atomic(file,value){const temp=file+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2));await fs.rename(temp,file);}
async function create({rpc,menu,directory,prepareApp=prepare}){
 const mapped=menu.controls.mapped,cache=new Map();let generation=0,refreshSeen=0,menuState=await rpc.read(mapped,1024);
 let catalog,menuData;const runtime={active:null,report:{session:rpc.a.session,started:new Date().toISOString(),transitions:[],generation:0,resourcesRetained:true}};
 const save=()=>atomic(path.join(directory,'app-runtime.json'),runtime.report);
 async function hostService(app){
   const spec=app.manifest.hostRuntime;if(!spec)return null;
   const parts=typeof spec==='string'&&spec.startsWith('module:')?spec.slice(7).split('/'):[];check(parts.length===2&&/^[a-z0-9-]+$/.test(parts[0])&&/^[A-Za-z0-9-]+$/.test(parts[1]),'Invalid module host runtime');
   const component=await require('../core/components.cjs').get(parts[0],parts[1]);
   check(typeof component.create==='function','Module host runtime has no create()');
   return component.create({rpc,mapped,directory,app});
  }
  async function audio(app){
  let effects={};
  if(app){
   const folder=path.join(directory,'loaded-apps',app.id+'-'+app.fingerprint.slice(0,16));await fs.mkdir(folder,{recursive:true});
   for(const [id,file]of Object.entries(app.effects)){effects[id]=file;}
  }
  await atomic(path.join(directory,'game-audio-source.json'),{session:rpc.a.session,mapped,package:app?{id:app.id,fingerprint:app.fingerprint,effects}:null});
 }
 async function rescan(state,upload=true){
  const selected=catalog?.apps[state.readUInt32LE(80)]?.id;
  const next=await catalogTools.scan(menu.catalog.root),bytes=await catalogTools.raster(next,directory,'catalog-'+(++generation));
  const font=await fs.readFile(path.join(__dirname,'shaders/launcher-text.bin'));check(font.length===catalogTools.ATLAS_BYTES,'Menu type atlas changed size');
  menuData=Buffer.concat([font,bytes]);check(menuData.length+1024<=menu.controls.bytes,'Catalog exceeds GPU storage');catalog=next;
  let index=selected?catalog.apps.findIndex(a=>a.id===selected):-1;if(index<0)index=Math.min(state.readUInt32LE(80),Math.max(0,catalog.apps.length-1));
  state.writeUInt32LE(index,80);state.writeFloatLE(index,68);state.writeUInt32LE(catalog.apps.length,112);state.writeUInt32LE(catalog.apps.length,1020);state.writeUInt32LE(0,116);
  state.writeFloatLE(0,96);state.writeFloatLE(0,100);state.writeFloatLE(state.readFloatLE(108)+1,108);state.writeUInt32LE(0,1012);state.writeUInt32LE(0,1016);
  refreshSeen=state.readFloatLE(104);menuState=state;
  if(upload){await rpc.write(mapped+1024,menuData);await rpc.write(mapped,menuState);}
  runtime.report.catalog=catalogTools.summary(catalog);runtime.report.generation=generation;await save();
 }
 async function returnToMenu(error){
  await runtime.active?.assetStream?.close?.();
  await runtime.active?.service?.close();
  await audio(null);runtime.active=null;runtime.report.active=null;
  menuState.writeFloatLE(1,960);menuState.writeFloatLE(0,964);menuState.writeUInt32LE(0,784);menuState.writeUInt32LE(error?1:0,92);
  await rescan(menuState);runtime.report.transitions.push({event:'return',error:error?.message,time:new Date().toISOString()});await save();
  return menu.commands[0];
 }
 runtime.afterBatch=async()=>{
  const state=await rpc.read(mapped,1024);
  if(runtime.active){
   if(state.readUInt32LE(1016)!==0)return returnToMenu();
   if(runtime.active.service?.afterBatch){const outcome=await runtime.active.service.afterBatch(state);if(outcome?.returnToMenu)return returnToMenu(outcome.error);}
   try{await runtime.active.assetStream?.afterBatch(state);}catch(error){return returnToMenu(error);}
   if(runtime.active.app.id==='media-machine'){
    try{
     const stateBuf = await rpc.read(mapped, 1024);
     const playing = stateBuf.readUInt32LE(788);
     const clipIndex = stateBuf.readUInt32LE(792);
     const timeSec = stateBuf.readFloatLE(64);
     const fps = 50;
     const targetFrame = playing === 1 ? Math.floor(timeSec * fps) : 0;
     
     if(playing === 1){
      if(!runtime.mediaMachineStreamer){
       const { MediaMachineStreamer } = require('../apps/media-machine/streamer.cjs');
       runtime.mediaMachineStreamer = new MediaMachineStreamer(runtime.active.app.root);
       await runtime.mediaMachineStreamer.init();
      }
      const streamManifestPath=path.join(runtime.active.app.root,'assets','video-stream.json');
      const manifest=JSON.parse(await fs.readFile(streamManifestPath,'utf8'));
      const clipInfo=manifest[String(clipIndex)];
      if(clipInfo){
       const absoluteSourcePath=path.resolve(runtime.active.app.root,clipInfo.source);
       const frameBytes=await runtime.mediaMachineStreamer.getFrame(clipIndex, absoluteSourcePath, targetFrame);
       if(frameBytes.length===1600*900*2){
        await rpc.write(mapped+1024+clipInfo.offset, frameBytes);
       }
      }
     }
    }catch(e){/* ignore stream sync errors */}
   }
   if(runtime.active.app.id==='youtube'){
    try{
     const pieceState=await rpc.read(mapped+800,16);
     const loadedFrame=pieceState.readInt32LE(0);
     const targetFrame=pieceState.readInt32LE(4);
     if(loadedFrame!==targetFrame){
      if(!runtime.youtubeStreamer){
       const { YouTubeStreamer } = require('../apps/youtube/streamer.cjs');
       runtime.youtubeStreamer = new YouTubeStreamer();
       await runtime.youtubeStreamer.init();
      }
      const frameBytes = await runtime.youtubeStreamer.getFrame('youtube-live-stream', targetFrame % 600);
      if(frameBytes.length===1920*1080*2){
       await rpc.write(mapped+1024, frameBytes);
       const updateBuf=Buffer.alloc(4);updateBuf.writeInt32LE(targetFrame);
       await rpc.write(mapped+800,updateBuf);
      }
     }
    }catch(e){/* ignore stream sync errors */}
   }
   if(runtime.active.service)return menu.commands[0];
    return runtime.active.gpu?.commands?.[0]||menu.commands[0];
  }
  const request=state.readUInt32LE(1012);
  if(request!==0){
   menuState=state;const selected=catalog.apps[request-1];
   try{
    check(selected,'The selected app is no longer in the catalog');
    const app=await catalogTools.readApp(selected.root);check(app.fingerprint===selected.fingerprint,'App changed; tap Refresh before opening it');
    const service=await hostService(app);
    if(service){
     const bytes=Buffer.alloc(menu.controls.bytes);app.files.state.bytes.copy(bytes);app.files.data.bytes.copy(bytes,1024);
     bytes.writeUInt32LE(0,1012);bytes.writeUInt32LE(0,1016);if(app.manifest.transition==='none')bytes.writeFloatLE(0,960);
     await rpc.write(mapped,bytes);await audio(app);runtime.active={app,service,gpu:null,assetStream:app.streamedAssets?.length?require('../core/services/app-asset-stream.cjs').create({rpc,mapped,app}):null};
     runtime.report.active={id:app.id,fingerprint:app.fingerprint};runtime.report.transitions.push({event:'launch',id:app.id,fingerprint:app.fingerprint,time:new Date().toISOString()});await save();return menu.commands[0];
    }
    if(app.manifest.displayOnly===true)throw Error('This IZLauncher package contains metadata only and cannot be launched.');
    let gpu=cache.get(app.fingerprint);
    if(!gpu){check(cache.size<64,'This session has retained 64 app versions; start a fresh session to load another');gpu=await prepareApp(rpc,menu,app,directory);check(gpu.ready&&gpu.scratchRestored,'App preparation incomplete');cache.set(app.fingerprint,gpu);}
    const bytes=Buffer.alloc(menu.controls.bytes);app.files.state.bytes.copy(bytes);app.files.data.bytes.copy(bytes,1024);
    bytes.writeUInt32LE(0,1012);bytes.writeUInt32LE(0,1016);
    if(app.manifest.transition==='none')bytes.writeFloatLE(0,960);
    if(app.files.memory){check(gpu.privateStorage?.bytes===app.files.memory.allocationBytes,'App private storage differs');const initial=Buffer.alloc(gpu.privateStorage.bytes);app.files.memory.bytes.copy(initial);await rpc.write(gpu.privateStorage.mapped,initial);}
    await rpc.write(mapped,bytes);await audio(app);
    runtime.active={app,gpu,assetStream:app.streamedAssets?.length?require('../core/services/app-asset-stream.cjs').create({rpc,mapped,app}):null};
    runtime.report.active={id:app.id,fingerprint:app.fingerprint};runtime.report.transitions.push({event:'launch',id:app.id,fingerprint:app.fingerprint,time:new Date().toISOString()});await save();
    return gpu.commands[0];
   }catch(error){
    // A failed scratch restoration means the native session must not be reused.
    if(/restore scratch/.test(error.message))throw error;
    return returnToMenu(error);
   }
  }
  if(state.readFloatLE(104)!==refreshSeen)await rescan(state);
  return menu.commands[0];
 };
 runtime.close=async()=>{await runtime.active?.assetStream?.close?.();await runtime.active?.service?.close();if(runtime.mediaMachineStreamer)await runtime.mediaMachineStreamer.close();};
 await rescan(menuState);await audio(null);return runtime;
}
module.exports={create};
