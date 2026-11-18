const uint HB_A=1u,HB_B=2u,HB_X=4u,HB_Y=8u,HB_L=64u,HB_R=128u,HB_PLUS=1024u,HB_MINUS=2048u;
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
float hbFactorial(float inputValue){
    if(inputValue<0.0||inputValue>32.0||abs(inputValue-floor(inputValue+0.5))>0.00001)return 0.0;
    int n=int(floor(inputValue+0.5));
    float value=1.0;
    for(int i=1;i<=32;i++){if(i>n)break;value*=float(i);}
    return value;
}
float hbRoot(float degree,float value){
    if(degree==0.0)return 0.0;
    float rounded=round(degree);
    if(value<0.0&&abs(degree-rounded)<0.00001&&mod(abs(rounded),2.0)==1.0)
        return -pow(-value,1.0/degree);
    return pow(value,1.0/degree);
}
bool hbRunOnce(inout uint flags,uint slot){
    if(slot>=23u)return false;
    uint mask=1u<<slot;bool run=(flags&mask)==0u;flags|=mask;return run;
}
