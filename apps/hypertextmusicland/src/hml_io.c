#include "hml.h"

struct sink { uint8_t *p; uint32_t cap, n; int bad; };
static void u8(struct sink*s,uint8_t v){if(s->n>=s->cap){s->bad=1;return;}s->p[s->n++]=v;}
static void bytes(struct sink*s,const void*p,uint32_t n){const uint8_t*b=(const uint8_t*)p;uint32_t i;for(i=0;i<n;i++)u8(s,b[i]);}
static void be16(struct sink*s,uint16_t v){u8(s,(uint8_t)(v>>8));u8(s,(uint8_t)v);}
static void be32(struct sink*s,uint32_t v){u8(s,(uint8_t)(v>>24));u8(s,(uint8_t)(v>>16));u8(s,(uint8_t)(v>>8));u8(s,(uint8_t)v);}
static void le16(struct sink*s,uint16_t v){u8(s,(uint8_t)v);u8(s,(uint8_t)(v>>8));}
static void le32(struct sink*s,uint32_t v){u8(s,(uint8_t)v);u8(s,(uint8_t)(v>>8));u8(s,(uint8_t)(v>>16));u8(s,(uint8_t)(v>>24));}
static uint32_t vlq(uint32_t v,uint8_t b[4]){uint32_t n=0;b[n++]=(uint8_t)(v&127u);while((v>>=7)!=0&&n<4)b[n++]=(uint8_t)((v&127u)|128u);{uint32_t i;for(i=0;i<n/2;i++){uint8_t q=b[i];b[i]=b[n-1-i];b[n-1-i]=q;}}return n;}
struct ev {uint32_t tick;uint8_t pitch,vel,on;};
static void ev_add(struct ev *a,uint32_t *n,uint32_t tick,uint8_t pitch,uint8_t vel,uint8_t on){uint32_t i=*n;if(i>=HML_NOTES*2u)return;while(i&&(a[i-1].tick>tick||(a[i-1].tick==tick&&a[i-1].on>on))){a[i]=a[i-1];--i;}a[i].tick=tick;a[i].pitch=pitch;a[i].vel=vel;a[i].on=on;(*n)++;}
static void track_begin(struct sink*s,uint32_t*lenpos){bytes(s,"MTrk",4);*lenpos=s->n;be32(s,0);}
static void patch_len(struct sink*s,uint32_t p){uint32_t n=s->n-(p+4);if(p+4<=s->cap){s->p[p]=(uint8_t)(n>>24);s->p[p+1]=(uint8_t)(n>>16);s->p[p+2]=(uint8_t)(n>>8);s->p[p+3]=(uint8_t)n;}}
uint32_t hml_midi_write(const struct hml_project*p,uint8_t*out,uint32_t cap){struct sink s;uint32_t i,j,lenpos,tempo,prev;struct ev ev[HML_NOTES*2u];if(!p||!out||cap<64)return 0;s.p=out;s.cap=cap;s.n=0;s.bad=0;bytes(&s,"MThd",4);be32(&s,6);be16(&s,1);be16(&s,(uint16_t)(p->track_count+1));be16(&s,960);
    track_begin(&s,&lenpos);u8(&s,0);u8(&s,0xff);u8(&s,3);{uint32_t n=0;while(n<HML_TITLE&&p->title[n])n++;u8(&s,(uint8_t)n);bytes(&s,p->title,n);}tempo=60000000u/(p->bpm?p->bpm:120);u8(&s,0);u8(&s,0xff);u8(&s,0x51);u8(&s,3);u8(&s,(uint8_t)(tempo>>16));u8(&s,(uint8_t)(tempo>>8));u8(&s,(uint8_t)tempo);u8(&s,0);u8(&s,0xff);u8(&s,0x2f);u8(&s,0);patch_len(&s,lenpos);
    for(i=0;i<p->track_count;i++){const struct hml_track*t=&p->tracks[i];uint32_t n=0;track_begin(&s,&lenpos);u8(&s,0);u8(&s,0xff);u8(&s,3);{uint32_t l=0;while(l<HML_NAME&&t->name[l])l++;u8(&s,(uint8_t)l);bytes(&s,t->name,l);}u8(&s,0);u8(&s,0xc0);u8(&s,(uint8_t)(t->instrument==HML_DRUMS?0: t->instrument==HML_RHODES?4:t->instrument==HML_BASS?38:t->instrument==HML_CHIP?81:80));
        for(j=0;j<t->count;j++){uint32_t start=(uint32_t)(t->notes[j].beat*960.0f);uint32_t end=start+(uint32_t)(t->notes[j].length*960.0f);if(end<=start)end=start+1;ev_add(ev,&n,start,t->notes[j].pitch,t->notes[j].velocity,1);ev_add(ev,&n,end,t->notes[j].pitch,0,0);}
        prev=0;for(j=0;j<n;j++){uint8_t b[4];uint32_t k=vlq(ev[j].tick-prev,b),q;for(q=0;q<k;q++)u8(&s,b[q]);u8(&s,(uint8_t)(ev[j].on?0x90:0x80));u8(&s,ev[j].pitch);u8(&s,ev[j].on?ev[j].vel:0);prev=ev[j].tick;}
        u8(&s,0);u8(&s,0xff);u8(&s,0x2f);u8(&s,0);patch_len(&s,lenpos);if(s.bad)return 0;
    }return s.bad?0:s.n;
}
static uint16_t rd16(const uint8_t*p){return (uint16_t)(((uint16_t)p[0]<<8)|p[1]);}
static uint32_t rd32(const uint8_t*p){return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3];}
static int get_vlq(const uint8_t*d,uint32_t end,uint32_t*pos,uint32_t*out){uint32_t v=0,k=0;uint8_t c;do{if(*pos>=end||k++>=4)return 0;c=d[(*pos)++];v=(v<<7)|(c&127u);}while(c&128u);*out=v;return 1;}
int hml_midi_import(struct hml_project*p,const uint8_t*d,uint32_t size){uint32_t pos,tracks,division,ti;if(!p||!d||size<14||d[0]!='M'||d[1]!='T'||d[2]!='h'||d[3]!='d'||rd32(d+4)<6)return 0;tracks=rd16(d+10);division=rd16(d+12);if(!division||(division&0x8000u))return 0;p->track_count=0;pos=8+rd32(d+4);
    for(ti=0;ti<tracks&&pos+8<=size&&p->track_count<HML_TRACKS;ti++){uint32_t chunk,end,tick=0,run=0;uint32_t start[128];int32_t ni[128];struct hml_track*t;uint32_t k;if(d[pos]!='M'||d[pos+1]!='T'||d[pos+2]!='r'||d[pos+3]!='k')break;chunk=rd32(d+pos+4);pos+=8;end=pos+chunk;if(end>size)end=size;t=&p->tracks[p->track_count];for(k=0;k<sizeof(*t);k++)((uint8_t*)t)[k]=0;t->instrument=HML_LEAD;t->volume=.8f;t->cutoff=8000;t->color=0xff38bdf8u;for(k=0;k<128;k++){start[k]=0;ni[k]=-1;}
        while(pos<end){uint32_t delta;uint8_t status;if(!get_vlq(d,end,&pos,&delta))break;tick+=delta;if(pos>=end)break;status=d[pos];if(status&0x80u){pos++;run=status;}else status=(uint8_t)run;
            if(status==0xff){uint8_t type;uint32_t n;if(pos>=end)break;type=d[pos++];if(!get_vlq(d,end,&pos,&n)||n>end-pos)break;if(type==0x51&&n==3){uint32_t us=((uint32_t)d[pos]<<16)|((uint32_t)d[pos+1]<<8)|d[pos+2];if(us)p->bpm=60000000u/us;}else if((type==3||type==1)&&n){uint32_t q,l=n<HML_NAME-1?n:HML_NAME-1;for(q=0;q<l;q++)t->name[q]=(char)d[pos+q];t->name[l]=0;}pos+=n;if(type==0x2f)break;continue;}
            if(status==0xf0||status==0xf7){uint32_t n;if(!get_vlq(d,end,&pos,&n)||n>end-pos)break;pos+=n;continue;}
            {uint8_t cmd=status&0xf0u,ch=status&15u,a,b=0;if(pos>=end)break;a=d[pos++];if(cmd!=0xc0&&cmd!=0xd0){if(pos>=end)break;b=d[pos++];}if(cmd==0xc0&&ch==9)t->instrument=HML_DRUMS;
             else if((cmd==0x90||cmd==0x80)&&a<128){int on=(cmd==0x90&&b!=0);if(on&&t->count<HML_NOTES){struct hml_note*n=&t->notes[t->count];n->beat=(float)tick/(float)division;n->length=.25f;n->pitch=a;n->velocity=b;t->count++;ni[a]=(int32_t)t->count-1;start[a]=tick;}
                else if(ni[a]>=0){struct hml_note*n=&t->notes[ni[a]];float len=(float)(tick-start[a])/(float)division;n->length=len>.02f?len:.25f;ni[a]=-1;}}
            }
        }
        if(!t->count){pos=end;continue;}if(!t->name[0]){const char nm[]="MIDI Import";for(k=0;k<sizeof(nm);k++)t->name[k]=nm[k];}t->color=0xff38bdf8u;p->track_count++;
    }
    if(!p->track_count) return 0;
    if(!p->bpm) p->bpm=120;
    if(p->bpm<HML_MIN_BPM) p->bpm=HML_MIN_BPM;
    if(p->bpm>HML_MAX_BPM) p->bpm=HML_MAX_BPM;
    p->selected_track=0;p->bars=4;return 1;
}
uint32_t hml_wav_header(uint8_t*out,uint32_t cap,uint32_t frames,uint32_t channels,uint32_t rate){struct sink s;uint32_t data=frames*channels*2u;if(!out||cap<44||channels<1||channels>2||data>cap-44)return 0;s.p=out;s.cap=cap;s.n=0;s.bad=0;bytes(&s,"RIFF",4);le32(&s,36u+data);bytes(&s,"WAVEfmt ",8);le32(&s,16);le16(&s,1);le16(&s,(uint16_t)channels);le32(&s,rate);le32(&s,rate*channels*2u);le16(&s,(uint16_t)(channels*2u));le16(&s,16);bytes(&s,"data",4);le32(&s,data);return s.bad?0:44;}
