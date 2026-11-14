#version 450
#extension GL_GOOGLE_include_directive : require
#define STATE_ACCESS readonly
#define HB_READONLY
#include "abi.glsl"
#include "hb.glsl"
layout(location=0) out vec4 outColor;
layout(set=0,binding=1,std430) readonly buffer MachineMemory { uint data[]; } mem;
const uint VRAM=0x800000u,OAM=0x810000u,IO=64u;
uint byteAt(uint a){return (mem.data[a>>2u]>>((a&3u)*8u))&255u;}
uint tilePixel(uint tile,uint x,uint y,uint bank){uint base=0x8000u+bank*0x2000u+tile*16u+y*2u;uint lo=byteAt(base),hi=byteAt(base+1u),bit=7u-x;return ((lo>>bit)&1u)|(((hi>>bit)&1u)<<1u);}
void main(){vec2 res=vec2(1920.0,1080.0);vec2 pix=gl_FragCoord.xy;float scale=floor(min(res.x/160.0,res.y/144.0));vec2 imageSize=vec2(160.0,144.0)*scale;vec2 origin=(res-imageSize)*0.5;ivec2 p=ivec2(floor((pix-origin)/scale));if(p.x<0||p.y<0||p.x>=160||p.y>=144){outColor=vec4(.025,.035,.055,1);return;}uint lcdc=byteAt(IO+0x40u),scy=byteAt(IO+0x42u),scx=byteAt(IO+0x43u),ly=uint(p.y),lx=uint(p.x),color=0u;bool window=false;uint wx=byteAt(IO+0x4bu),wy=byteAt(IO+0x4au);if((lcdc&1u)!=0u){uint mx=(lx+scx)&255u,my=(ly+scy)&255u;if((lcdc&0x20u)!=0u&&ly>=wy&&lx+7u>=wx){mx=lx+7u-wx;my=ly-wy;window=true;}uint map=((window?(lcdc&0x40u):(lcdc&8u))!=0u?0x9c00u:0x9800u)+(my/8u)*32u+(mx/8u);uint tile=byteAt(map),index=tile;if((lcdc&0x10u)==0u)index=uint(int(tile)+128);color=tilePixel(index,mx&7u,my&7u,0u);uint pal=byteAt(IO+0x47u),shade=(pal>>(color*2u))&3u;vec3 colors[4]=vec3[4](vec3(.89,.93,.76),vec3(.59,.70,.42),vec3(.30,.45,.31),vec3(.10,.20,.20));outColor=vec4(colors[shade],1); }else outColor=vec4(.89,.93,.76,1);
if((lcdc&2u)!=0u){uint drawn=0u;for(uint i=0u;i<40u&&drawn<10u;i++){int sy=int(byteAt(OAM+i*4u))-16,sx=int(byteAt(OAM+i*4u+1u))-8;if(int(p.y)>=sy&&int(p.y)<sy+8){drawn++;if(int(p.x)>=sx&&int(p.x)<sx+8){uint ti=byteAt(OAM+i*4u+2u),attr=byteAt(OAM+i*4u+3u);uint ox=uint(int(p.x)-sx),oy=uint(int(p.y)-sy);if((attr&0x20u)!=0u)ox=7u-ox;if((attr&0x40u)!=0u)oy=7u-oy;uint sp=tilePixel(ti,ox,oy,0u);if(sp!=0u){uint pal=(attr&0x10u)!=0u?byteAt(IO+0x49u):byteAt(IO+0x48u),sh=(pal>>(sp*2u))&3u;vec3 colors[4]=vec3[4](vec3(.89,.93,.76),vec3(.59,.70,.42),vec3(.30,.45,.31),vec3(.10,.20,.20));outColor=vec4(colors[sh],1);}}}}}
}
