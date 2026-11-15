#version 450

layout(location=0) out vec4 outColor;
#define STATE_ACCESS readonly
// ABI-1 controls layout; app-owned atlas starts at byte 1024.
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

layout(set=0,binding=1,std430) readonly buffer ImageData { uint imageData[]; } imageStore;

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
            uint byteOffset=offset*4u+(pixel.y*width+pixel.x)*4u,word=imageStore.imageData[byteOffset>>2u];
            uint shift=(byteOffset&3u)*8u;
            color.rgb=vec3(float(word&255u),float((word>>8u)&255u),float((word>>16u)&255u))/255.0;
        }
    }
    outColor=vec4(color.rgb*(1.0-c.transition.x),1.0);
}
