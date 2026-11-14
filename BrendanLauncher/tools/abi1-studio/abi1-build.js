'use strict';

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Abi1Build = api;
})(globalThis, function (root) {
  const encoder = new TextEncoder();
  const DEFAULT_ICON = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAASElEQVR42mOQVDb5P5CYYdQBow7AJRHd8Z9qeHg44Ot3wnjUAbgcM3IcMLzTwGg5MOqA0aJ4tCgeLYpHHTDyCqLRfsGoA+iFAdGEnibx5lwkAAAAAElFTkSuQmCC';
  const STATE_GLSL = `// ABI-1 controls layout; app-owned atlas starts at byte 1024.
#ifndef STATE_ACCESS
#define STATE_ACCESS
#endif
layout(set=0,binding=0,std430) STATE_ACCESS buffer Controls {
    uvec4 raw[4]; vec4 motion; uvec4 state;
    vec4 refresh; uvec4 library; uint touch[164];
    uvec4 game; ivec4 piece; vec4 flow; uvec4 bagMeta;
    uint bag[8]; uint rows[20]; vec4 transition;
    uvec4 events; uvec4 stats; uvec4 reserved; uint atlas[];
} c;
`;
  const HB_GLSL = `const uint HB_A=1u,HB_B=2u,HB_X=4u,HB_Y=8u,HB_L=64u,HB_R=128u,HB_PLUS=1024u,HB_MINUS=2048u;
const uint HB_LEFT=4096u,HB_UP=8192u,HB_RIGHT=16384u,HB_DOWN=32768u;
const uint HB_SHAPE_BOX=1u,HB_SHAPE_SPHERE=2u,HB_SHAPE_SPRITE=3u,HB_SHAPE_PLANE=4u;
uint hbButtons(){return c.raw[0].z;}
uint hbPressed(){return hbButtons()&~c.state.y;}
bool hbConnected(){return (c.raw[2].x&1u)!=0u;}
void hbEndFrame(){c.state.y=hbButtons();}
void hbExit(){c.reserved.z=1u;}
void hbSound(uint id){c.events.x++;c.events.y=id;}
void hbStopSound(){hbSound(0u);}
void hbSwitchSound(uint id){hbSound(id);}
uint hbCurrentScene(){return c.reserved.x;}
const uint HB_STREAM_WINDOW_WORD=1572864u,HB_STREAM_WINDOW_BYTES=65536u;
bool hbStreamRequest(uint assetId,uint offset,uint length){
    if(assetId==0u||length==0u||length>HB_STREAM_WINDOW_BYTES||
       (c.stats.x!=0u&&c.stats.w!=c.reserved.y))return false;
    uint sequence=c.stats.w+1u;if(sequence==0u)sequence=1u;
    c.stats=uvec4(assetId,offset,length,sequence);c.reserved.w=0u;return true;
}
bool hbStreamReady(){return c.stats.w!=0u&&c.reserved.y==c.stats.w&&c.reserved.w==1u;}
bool hbStreamFailed(){return c.stats.w!=0u&&c.reserved.y==c.stats.w&&c.reserved.w==2u;}
uint hbStreamByte(uint index){
    if(index>=c.stats.z)return 0u;
    uint word=c.atlas[HB_STREAM_WINDOW_WORD+index/4u];
    return (word>>((index&3u)*8u))&255u;
}
uint hbHash(uint value){
    value^=value>>16u;value*=0x7feb352du;value^=value>>15u;
    value*=0x846ca68bu;value^=value>>16u;return value;
}
float hbRandom(uint seed){return float(hbHash(seed^(c.state.z*0x9e3779b9u))>>8u)/16777215.0;}
float hbRandom(){return hbRandom(c.state.z);}
float hbRandomRange(float minimum,float maximum,uint seed){return mix(minimum,maximum,hbRandom(seed));}
vec3 hbRandomColor(uint seed){return vec3(hbRandom(seed),hbRandom(seed+1u),hbRandom(seed+2u));}
`;
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < table.length; i++) {
      let value = i;
      for (let bit = 0; bit < 8; bit++)
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[i] = value >>> 0;
    }
    return table;
  })();

  function bytesFromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function toBytes(value) {
    if (typeof value === 'string') return encoder.encode(value);
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    throw new TypeError('ZIP entries must be text or byte arrays');
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  class ZipArchive {
    constructor() {
      this.entries = new Map();
    }

    add(name, value) {
      if (typeof name !== 'string' || name.startsWith('/') || name.includes('\\') ||
          name.split('/').includes('..') || this.entries.has(name))
        throw new Error(`Invalid or duplicate ZIP path: ${name}`);
      this.entries.set(name, toBytes(value));
    }

    build() {
      const localParts = [];
      const directoryParts = [];
      let offset = 0;
      let directorySize = 0;
      for (const [name, bytes] of this.entries) {
        const nameBytes = encoder.encode(name);
        const crc = crc32(bytes);
        const local = new Uint8Array(30 + nameBytes.length);
        const localView = new DataView(local.buffer);
        localView.setUint32(0, 0x04034b50, true);
        localView.setUint16(4, 20, true);
        localView.setUint16(6, 0x0800, true);
        localView.setUint32(14, crc, true);
        localView.setUint32(18, bytes.length, true);
        localView.setUint32(22, bytes.length, true);
        localView.setUint16(26, nameBytes.length, true);
        local.set(nameBytes, 30);
        localParts.push(local, bytes);

        const directory = new Uint8Array(46 + nameBytes.length);
        const directoryView = new DataView(directory.buffer);
        directoryView.setUint32(0, 0x02014b50, true);
        directoryView.setUint16(4, 20, true);
        directoryView.setUint16(6, 20, true);
        directoryView.setUint16(8, 0x0800, true);
        directoryView.setUint32(16, crc, true);
        directoryView.setUint32(20, bytes.length, true);
        directoryView.setUint32(24, bytes.length, true);
        directoryView.setUint16(28, nameBytes.length, true);
        directoryView.setUint32(42, offset, true);
        directory.set(nameBytes, 46);
        directoryParts.push(directory);
        offset += local.length + bytes.length;
        directorySize += directory.length;
      }

      const end = new Uint8Array(22);
      const endView = new DataView(end.buffer);
      endView.setUint32(0, 0x06054b50, true);
      endView.setUint16(8, this.entries.size, true);
      endView.setUint16(10, this.entries.size, true);
      endView.setUint32(12, directorySize, true);
      endView.setUint32(16, offset, true);
      return concatenate([...localParts, ...directoryParts, end]);
    }
  }

  function concatenate(parts) {
    const total = parts.reduce((size, part) => size + part.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  class Abi1PackageBuilder {
    constructor({ model = root.Abi1SceneModel, compilerFactory = () => root.createGlslang() } = {}) {
      if (!model) throw new Error('ABI-1 scene model is not loaded');
      this.model = model;
      this.compilerFactory = compilerFactory;
    }

    shaderSources(project) {
      const scriptsById = new Map(project.scripts.map(script => [script.id, script]));
      const hasImages = this.model.flattenObjects(project).some(({ object }) =>
        project.assets.some(item => item.id === object.assetId && item.kind === 'image'));
      const sceneObjects = this.model.flattenObjects(project);
      const objectScripts = sceneObjects.map(({ object }, index) => {
        return object.scriptIds.map(scriptId => {
          const script = scriptsById.get(scriptId);
          if (!script.source.trim()) return '';
          return `if (objectIndex == ${index}u) {\n${script.source}\n}`;
        }).filter(Boolean).join('\n');
      }).filter(Boolean).join('\n');
      const classSources = project.classes.map(item => item.source).filter(Boolean).join('\n');
      const sceneIds = project.scenes.map(scene => scene.id);
      const sceneLoadGuard = sceneIds.map(id => `id==${id}u`).join('||') || 'false';
      const vertex = `#version 450
void main() {
    vec2 p = vec2((gl_VertexIndex << 1) & 2, gl_VertexIndex & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;
      const fragment = `#version 450
#extension GL_GOOGLE_include_directive : require
layout(location=0) out vec4 outColor;
#define STATE_ACCESS readonly
#include "abi.glsl"
${hasImages ? 'layout(set=0,binding=1,std430) readonly buffer ImageData { uint imageData[]; } imageStore;' : ''}

vec3 rotateXYZ(vec3 p, vec3 r) {
    float cx=cos(r.x), sx=sin(r.x), cy=cos(r.y), sy=sin(r.y), cz=cos(r.z), sz=sin(r.z);
    p=vec3(p.x, cx*p.y-sx*p.z, sx*p.y+cx*p.z);
    p=vec3(cy*p.x+sy*p.z, p.y, -sy*p.x+cy*p.z);
    return vec3(cz*p.x-sz*p.y, sz*p.x+cz*p.y, p.z);
}
bool sceneRange(uint id, out uint firstObject, out uint objectCount, out uint firstRecord) {
    for(uint s=0u;s<c.atlas[2];s++){
        uint descriptor=4u+s*10u;
        if(c.atlas[descriptor]==id){
            firstObject=c.atlas[descriptor+1u];
            objectCount=c.atlas[descriptor+2u];
            firstRecord=c.atlas[descriptor+3u];
            return true;
        }
    }
    firstObject=0u;objectCount=0u;firstRecord=0u;
    return false;
}
void sceneCamera(uint id,out vec3 position,out vec3 rotation){
    position=vec3(0.0,0.0,9.0);rotation=vec3(0.0);
    for(uint s=0u;s<c.atlas[2];s++){
        uint descriptor=4u+s*10u;
        if(c.atlas[descriptor]==id){
            position=vec3(uintBitsToFloat(c.atlas[descriptor+4u]),
                          uintBitsToFloat(c.atlas[descriptor+5u]),
                          uintBitsToFloat(c.atlas[descriptor+6u]));
            rotation=vec3(uintBitsToFloat(c.atlas[descriptor+7u]),
                          uintBitsToFloat(c.atlas[descriptor+8u]),
                          uintBitsToFloat(c.atlas[descriptor+9u]));
            return;
        }
    }
}
float objectDistance(vec3 point, uint i, uint record, out vec4 albedo, out vec2 uv, out uint textureRecord) {
    textureRecord=record;
    uint shape=c.atlas[record];
    vec3 position=vec3(uintBitsToFloat(c.atlas[record+5u]),uintBitsToFloat(c.atlas[record+6u]),uintBitsToFloat(c.atlas[record+7u]));
    vec3 rotation=vec3(uintBitsToFloat(c.atlas[record+8u]),uintBitsToFloat(c.atlas[record+9u]),uintBitsToFloat(c.atlas[record+10u]));
    vec3 scale=max(abs(vec3(uintBitsToFloat(c.atlas[record+11u]),uintBitsToFloat(c.atlas[record+12u]),uintBitsToFloat(c.atlas[record+13u]))),vec3(.001));
    vec3 p=rotateXYZ(point-position,-rotation)/scale;
    vec3 color=vec3(uintBitsToFloat(c.atlas[record+1u]),uintBitsToFloat(c.atlas[record+2u]),uintBitsToFloat(c.atlas[record+3u]));
    albedo=vec4(color,1.0);uv=vec2(p.x*.5+.5,.5-p.y*.5);
    if(shape==2u) return (length(p)-1.0)*min(scale.x,min(scale.y,scale.z));
    if(shape==0u) return 1e6;
    if(shape==3u||shape==4u) return max(abs(p.z)-.02,max(abs(p.x)-1.0,abs(p.y)-1.0))*min(scale.x,min(scale.y,scale.z));
    vec3 q=abs(p)-vec3(1.0);
    return (length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0))*min(scale.x,min(scale.y,scale.z));
}
vec2 sceneDistance(vec3 point, out vec4 color, out vec2 uv, out uint textureRecord) {
    float best=1e6; color=vec4(.8); uv=vec2(0); textureRecord=0u;
    uint firstObject,objectCount,firstRecord;
    sceneRange(c.reserved.x,firstObject,objectCount,firstRecord);
    for(uint i=0u;i<objectCount;i++){
        vec4 candidate;vec2 candidateUv;uint record;
        float distance=objectDistance(point,firstObject+i,firstRecord+i*20u,candidate,candidateUv,record);
        if(distance<best){best=distance;color=candidate;uv=candidateUv;textureRecord=record;}
    }
    return vec2(best,0.0);
}
vec3 normalAt(vec3 p){
    vec4 c0;vec2 u0;uint r0;float e=.002;
    float x=sceneDistance(p+vec3(e,0,0),c0,u0,r0).x-sceneDistance(p-vec3(e,0,0),c0,u0,r0).x;
    float y=sceneDistance(p+vec3(0,e,0),c0,u0,r0).x-sceneDistance(p-vec3(0,e,0),c0,u0,r0).x;
    float z=sceneDistance(p+vec3(0,0,e),c0,u0,r0).x-sceneDistance(p-vec3(0,0,e),c0,u0,r0).x;
    return normalize(vec3(x,y,z));
}
void main(){
    vec2 screen=(gl_FragCoord.xy-vec2(960.0,540.0))/1080.0;
    vec3 cameraPosition,cameraRotation;
    sceneCamera(c.reserved.x,cameraPosition,cameraRotation);
    vec3 origin=cameraPosition;
    vec3 direction=rotateXYZ(normalize(vec3(screen*1.35,-1.0)),cameraRotation);
    float travel=0.0;vec4 color=vec4(.025,.055,.09,1.0);vec2 uv=vec2(0);uint record=0u;
    for(int step=0;step<80;step++){
        vec4 hitColor;vec2 hitUv;uint hitRecord;
        float distance=sceneDistance(origin+direction*travel,hitColor,hitUv,hitRecord).x;
        if(distance<.002){
            vec3 normal=normalAt(origin+direction*travel);
            float light=.25+.75*max(dot(normal,normalize(vec3(-.4,.8,.6))),0.0);
            color=vec4(hitColor.rgb*light,1.0);uv=hitUv;record=hitRecord;break;
        }
        travel+=max(distance,.005);if(travel>60.0)break;
    }
    if(color.a>0.0 && record!=0u && c.atlas[record]==3u){
        uint width=c.atlas[record+17u],height=c.atlas[record+18u],offset=c.atlas[record+16u];
        if(width>0u&&height>0u){
            uvec2 pixel=min(uvec2(clamp(uv,vec2(0),vec2(.999999))*vec2(width,height)),uvec2(width-1u,height-1u));
            uint byteOffset=offset*4u+(pixel.y*width+pixel.x)*4u,word=${hasImages ? 'imageStore.imageData' : 'c.atlas'}[byteOffset>>2u];
            uint shift=(byteOffset&3u)*8u;
            color.rgb=vec3(float(word&255u),float((word>>8u)&255u),float((word>>16u)&255u))/255.0;
        }
    }
    outColor=vec4(color.rgb*(1.0-c.transition.x),1.0);
}
`;
      const compute = `#version 450
#extension GL_GOOGLE_include_directive : require
layout(local_size_x=1) in;
#include "abi.glsl"
#include "hb.glsl"
bool sceneRange(uint id, out uint firstObject, out uint objectCount, out uint firstRecord) {
    for(uint s=0u;s<c.atlas[2];s++){
        uint descriptor=4u+s*10u;
        if(c.atlas[descriptor]==id){
            firstObject=c.atlas[descriptor+1u];
            objectCount=c.atlas[descriptor+2u];
            firstRecord=c.atlas[descriptor+3u];
            return true;
        }
    }
    firstObject=0u;objectCount=0u;firstRecord=0u;
    return false;
}
void hbLoadScene(uint id){if(${sceneLoadGuard})c.reserved.x=id;}
uint hbSpawnObject(uint shape,vec3 position,vec3 scale,vec3 color){
    if(shape<HB_SHAPE_BOX||shape>HB_SHAPE_PLANE)return 0xffffffffu;
    uint firstObject,objectCount,firstRecord;
    if(!sceneRange(c.reserved.x,firstObject,objectCount,firstRecord))return 0xffffffffu;
    uint slot=objectCount;
    for(uint i=0u;i<objectCount;i++){
        uint candidate=firstRecord+i*20u;
        if(c.atlas[candidate]==0u&&c.atlas[candidate+15u]==0xffffffffu){slot=i;break;}
    }
    if(slot==objectCount){
        if(objectCount>=48u)return 0xffffffffu;
        for(uint s=0u;s<c.atlas[2];s++){
            uint descriptor=4u+s*10u;
            if(c.atlas[descriptor]==c.reserved.x){c.atlas[descriptor+2u]=objectCount+1u;break;}
        }
    }
    uint record=firstRecord+slot*20u;
    c.atlas[record]=shape;
    c.atlas[record+1u]=floatBitsToUint(clamp(color.r,0.0,1.0));
    c.atlas[record+2u]=floatBitsToUint(clamp(color.g,0.0,1.0));
    c.atlas[record+3u]=floatBitsToUint(clamp(color.b,0.0,1.0));
    c.atlas[record+4u]=0u;
    c.atlas[record+5u]=floatBitsToUint(position.x);
    c.atlas[record+6u]=floatBitsToUint(position.y);
    c.atlas[record+7u]=floatBitsToUint(position.z);
    c.atlas[record+8u]=0u;c.atlas[record+9u]=0u;c.atlas[record+10u]=0u;
    scale=max(abs(scale),vec3(.001));
    c.atlas[record+11u]=floatBitsToUint(scale.x);
    c.atlas[record+12u]=floatBitsToUint(scale.y);
    c.atlas[record+13u]=floatBitsToUint(scale.z);
    c.atlas[record+14u]=0u;c.atlas[record+15u]=0xffffffffu;
    c.atlas[record+16u]=0u;c.atlas[record+17u]=0u;c.atlas[record+18u]=0u;
    c.atlas[record+19u]=c.reserved.x;
    return firstObject+slot;
}
bool hbRemoveObject(uint objectId){
    uint firstObject,objectCount,firstRecord;
    if(!sceneRange(c.reserved.x,firstObject,objectCount,firstRecord)||objectId<firstObject)return false;
    uint slot=objectId-firstObject;if(slot>=objectCount)return false;
    uint record=firstRecord+slot*20u;
    if(c.atlas[record+15u]!=0xffffffffu||c.atlas[record]==0u)return false;
    c.atlas[record]=0u;return true;
}
uint hbSpawnOnce(uint objectIndex,uint shape,vec3 position,vec3 scale,vec3 color){
    uint firstObject,objectCount,firstRecord;
    if(!sceneRange(c.reserved.x,firstObject,objectCount,firstRecord))return 0xffffffffu;
    for(uint i=0u;i<objectCount;i++){
        uint record=firstRecord+i*20u;
        if(c.atlas[record+15u]==objectIndex){
            if((c.atlas[record+19u]&0x80000000u)!=0u)return 0xffffffffu;
            uint spawned=hbSpawnObject(shape,position,scale,color);
            if(spawned!=0xffffffffu)c.atlas[record+19u]|=0x80000000u;
            return spawned;
        }
    }
    return 0xffffffffu;
}
void hbPlayObjectAudio(uint objectIndex){
    uint firstObject,objectCount,firstRecord;
    if(!sceneRange(c.reserved.x,firstObject,objectCount,firstRecord))return;
    for(uint i=0u;i<objectCount;i++){
        uint record=firstRecord+i*20u;
        if(c.atlas[record+15u]==objectIndex&&c.atlas[record]==0u){
            uint eventId=c.atlas[record+14u];
            if(eventId>0u&&eventId<=31u)hbSound(eventId);
            return;
        }
    }
}
bool hbSetObjectAudio(uint objectIndex,uint eventId){
    if(eventId>31u)return false;
    uint firstObject,objectCount,firstRecord;
    if(!sceneRange(c.reserved.x,firstObject,objectCount,firstRecord))return false;
    for(uint i=0u;i<objectCount;i++){
        uint record=firstRecord+i*20u;
        if(c.atlas[record+15u]==objectIndex&&c.atlas[record]==0u){
            c.atlas[record+14u]=eventId;
            return true;
        }
    }
    return false;
}
${classSources}
void updateObject(inout vec3 position,inout vec3 rotation,inout vec3 scale,inout vec4 color,
                  uint objectIndex,float dt,uint buttons) {
${objectScripts || '    // Attach GLSL statements to objects in the editor.'}
}
void main(){
    float dt=1.0/60.0;uint buttons=hbPressed();
    c.motion.x+=dt;c.state.z++;
    uint firstObject,objectCount,firstRecord;
    if(!sceneRange(c.reserved.x,firstObject,objectCount,firstRecord))objectCount=0u;
    for(uint localIndex=0u;localIndex<objectCount;localIndex++){
        uint record=firstRecord+localIndex*20u;
        uint objectIndex=c.atlas[record+15u];
        vec3 position=vec3(uintBitsToFloat(c.atlas[record+5u]),uintBitsToFloat(c.atlas[record+6u]),uintBitsToFloat(c.atlas[record+7u]));
        vec3 rotation=vec3(uintBitsToFloat(c.atlas[record+8u]),uintBitsToFloat(c.atlas[record+9u]),uintBitsToFloat(c.atlas[record+10u]));
        vec3 scale=vec3(uintBitsToFloat(c.atlas[record+11u]),uintBitsToFloat(c.atlas[record+12u]),uintBitsToFloat(c.atlas[record+13u]));
        vec4 color=vec4(uintBitsToFloat(c.atlas[record+1u]),uintBitsToFloat(c.atlas[record+2u]),uintBitsToFloat(c.atlas[record+3u]),1.0);
        updateObject(position,rotation,scale,color,objectIndex,dt,buttons);
        c.atlas[record+1u]=floatBitsToUint(color.r);c.atlas[record+2u]=floatBitsToUint(color.g);c.atlas[record+3u]=floatBitsToUint(color.b);
        c.atlas[record+5u]=floatBitsToUint(position.x);c.atlas[record+6u]=floatBitsToUint(position.y);c.atlas[record+7u]=floatBitsToUint(position.z);
        c.atlas[record+8u]=floatBitsToUint(rotation.x);c.atlas[record+9u]=floatBitsToUint(rotation.y);c.atlas[record+10u]=floatBitsToUint(rotation.z);
        c.atlas[record+11u]=floatBitsToUint(scale.x);c.atlas[record+12u]=floatBitsToUint(scale.y);c.atlas[record+13u]=floatBitsToUint(scale.z);
    }
    if(hbConnected()&&(buttons&(HB_B|HB_MINUS))!=0u)hbExit();
    hbEndFrame();
}
`;
      const inline = source => source
        .replace(/^#extension GL_GOOGLE_include_directive : require\s*$/gm, '')
        .replace(/^#include "abi\.glsl"\s*$/gm, STATE_GLSL)
        .replace(/^#include "hb\.glsl"\s*$/gm, HB_GLSL);
      return { vertex, fragment: inline(fragment), compute: inline(compute) };
    }

    validateSpirv(bytes, executionModel, stage) {
      if (bytes.length < 20 || bytes.length % 4)
        throw new Error(`Invalid ${stage} SPIR-V size`);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (view.getUint32(0, true) !== 0x07230203)
        throw new Error(`Invalid ${stage} SPIR-V magic`);
      let entryPoint = false;
      for (let word = 5; word < bytes.length / 4;) {
        const instruction = view.getUint32(word * 4, true);
        const wordCount = instruction >>> 16;
        const opcode = instruction & 0xffff;
        if (!wordCount || word + wordCount > bytes.length / 4)
          throw new Error(`Malformed ${stage} SPIR-V instruction`);
        if (opcode === 15 && wordCount >= 4 &&
            view.getUint32((word + 1) * 4, true) === executionModel) {
          const entryName = bytes.subarray((word + 3) * 4, (word + wordCount) * 4);
          const end = entryName.indexOf(0);
          if (new TextDecoder().decode(entryName.subarray(0, end < 0 ? undefined : end)) === 'main')
            entryPoint = true;
        }
        word += wordCount;
      }
      if (!entryPoint) throw new Error(`Missing ${stage} SPIR-V main entry point`);
    }

    async build(projectValue) {
      const project = this.model.normalizeProject(projectValue);
      this.model.validateProject(project);
      const sources = this.shaderSources(project);
      const glslang = await this.compilerFactory();
      if (!glslang || typeof glslang.compileGLSL !== 'function')
        throw new Error('The in-browser GLSL compiler did not initialize');

      const archive = new ZipArchive();
      const sourcePaths = { vertex: 'app.vert', fragment: 'app.frag', compute: 'app.comp' };
      const executionModels = { vertex: 0, fragment: 4, compute: 5 };
      for (const [stage, source] of Object.entries(sources)) {
        const file = sourcePaths[stage];
        archive.add(`shaders/${file}`, source);
        let words;
        try { words = glslang.compileGLSL(source, stage, false, '1.0'); }
        catch (error) { throw new Error(`${stage} shader: ${error.message}`); }
        const bytes = new Uint8Array(words.length * 4);
        const view = new DataView(bytes.buffer);
        for (let i = 0; i < words.length; i++) view.setUint32(i * 4, words[i], true);
        this.validateSpirv(bytes, executionModels[stage], stage);
        archive.add(`${file}.spv`, bytes);
      }
      archive.add('shaders/abi.glsl', STATE_GLSL);
      archive.add('shaders/hb.glsl', HB_GLSL);

      const scene = this.model.toScenePackageData(project);
      const state = new Uint8Array(1024);
      const stateView = new DataView(state.buffer);
      stateView.setFloat32(960, 1, true);
      stateView.setUint32(1008, project.startupSceneId, true);
      const icon = bytesFromBase64(DEFAULT_ICON);
      archive.add('assets/state.bin', state);
      archive.add('assets/scene.bin', scene.data);
      archive.add('assets/icon.png', icon);
      if (scene.images.length) {
        const allocationBytes = Math.ceil(scene.images.length / 4096) * 4096;
        if (allocationBytes > 32 * 1024 * 1024)
          throw new Error('Image data exceeds the 32 MiB GPU texture storage limit');
        const imageData = new Uint8Array(allocationBytes);
        imageData.set(scene.images);
        archive.add('assets/image-data.bin', imageData);
      }
      archive.add('project.json', JSON.stringify(project, null, 2) + '\n');
      project.classes.forEach((item, index) => {
        const name = item.name.replace(/[^a-z0-9_-]/gi, '-') || 'class';
        archive.add(`classes/${index + 1}-${name}.glsl`, item.source);
      });

      const effects = {};
      const streamedAssets = [];
      for (const [index, asset] of project.assets.filter(item => item.kind === 'audio').entries()) {
        const eventId = asset.eventId || index + 1;
        if (!Number.isInteger(eventId) || eventId < 1 || eventId > 31)
          throw new Error('ABI-1 supports audio event IDs from 1 to 31');
        if (effects[eventId]) throw new Error(`Duplicate audio event ID ${eventId}`);
        const bytes = bytesFromBase64(asset.data);
        if (!bytes.length || bytes.length % 4 || bytes.length > 64 * 1024 * 1024)
          throw new Error(`Audio asset ${asset.name} must be 48 kHz stereo s16le PCM, at most 64 MiB`);
        const filename = `assets/audio_${eventId}.pcm`;
        archive.add(filename, bytes);
        effects[eventId] = filename;
      }
      for (const asset of project.assets.filter(item => item.kind === 'mesh')) {
        const bytes = bytesFromBase64(asset.data);
        const filename = `assets/stream/mesh_${streamedAssets.length + 1}.obj`;
        archive.add(filename, bytes);
        streamedAssets.push({ id: streamedAssets.length + 1, file: filename });
      }

      const manifest = {
        format: 'hblauncher.gpu-app',
        abi: 1,
        id: project.app.id,
        name: project.app.name,
        description: project.app.description,
        version: project.app.version,
        icon: 'assets/icon.png',
        initialState: 'assets/state.bin',
        data: 'assets/scene.bin',
        shaders: { vertex: 'app.vert.spv', fragment: 'app.frag.spv', compute: 'app.comp.spv' }
      };
      if (scene.images.length) {
        manifest.memory = {
          bytes: Math.ceil(scene.images.length / 4096) * 4096,
          initial: 'assets/image-data.bin'
        };
      }
      if (Object.keys(effects).length)
        manifest.audio = { sampleRate: 48000, channels: 2, format: 's16le', effects };
      if (streamedAssets.length) manifest.streamedAssets = streamedAssets;
      archive.add('app.json', JSON.stringify(manifest, null, 2) + '\n');

      let packageBytes = 0;
      for (const bytes of archive.entries.values()) packageBytes += bytes.byteLength;
      if (packageBytes > 128 * 1024 * 1024)
        throw new Error('The generated package exceeds the 128 MiB browser export limit');
      return {
        id: project.app.id,
        sceneCount: project.scenes.length,
        sceneObjects: this.model.flattenObjects(project).length,
        manifest,
        entries: archive.entries,
        bytes: archive.build()
      };
    }
  }

  return { Abi1PackageBuilder, ZipArchive, crc32 };
});
