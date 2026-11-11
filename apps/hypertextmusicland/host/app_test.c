#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdint.h>
#include <stdarg.h>
#include <string.h>
#include "hbx_sdk.h"
#include "hbx_app.h"
#include "hbx_ui.h"
#include "hml.h"

static struct hbx_ctx ctx;
static struct hbx_render render;
static struct hbx_ui_ops ops;
static uint8_t save_mem[1024*1024] __attribute__((aligned(64)));
static uint32_t frame_no, presents, shapes, texts;
static uint64_t fake_ns;
static int fails;
#define CHECK(c,s) do{if(!(c)){fprintf(stderr,"FAIL %s\n",s);fails++;}else printf("ok %s\n",s);}while(0)
static void begin(void*self,uint32_t c){(void)self;(void)c;}
static void rect(void*self,float x,float y,float w,float h,float r,uint32_t c){(void)self;(void)x;(void)y;(void)w;(void)h;(void)r;(void)c;shapes++;}
static void stroke(void*self,float x,float y,float w,float h,float r,float t,uint32_t c){(void)self;(void)x;(void)y;(void)w;(void)h;(void)r;(void)t;(void)c;shapes++;}
static float text(void*self,float x,float y,uint32_t f,const char*s,uint32_t c){(void)self;(void)x;(void)y;(void)f;(void)c;texts++;return(float)strlen(s)*9.0f;}
static float width(void*self,uint32_t f,const char*s){(void)self;(void)f;return(float)strlen(s)*9.0f;}
static void line(void*self,float x,float y,float xx,float yy,float w,uint32_t c,uint32_t flags){(void)self;(void)x;(void)y;(void)xx;(void)yy;(void)w;(void)c;(void)flags;shapes++;}
static void circle(void*self,float x,float y,float r,float t,uint32_t c,uint32_t flags){(void)self;(void)x;(void)y;(void)r;(void)t;(void)c;(void)flags;shapes++;}
static void icon(void*self,float x,float y,float z,uint32_t l,uint32_t c){(void)self;(void)x;(void)y;(void)z;(void)l;(void)c;}
static void image(void*self,float x,float y,float w,float h,const void*p,uint32_t iw,uint32_t ih){(void)self;(void)x;(void)y;(void)w;(void)h;(void)p;(void)iw;(void)ih;}
static void vertices(void*self,const void*v,uint32_t n){(void)self;(void)v;(void)n;}
static int present(void*self){(void)self;presents++;return HBX_OK;}
static uint32_t getframe(void*self){(void)self;return presents;}
static uint64_t device(void*self){(void)self;return 0;}
static uint64_t queue(void*self){(void)self;return 0;}
hbx_status hbx_ctx_check(const struct hbx_ctx*c){return c&&c->magic==HBX_ABI_MAGIC&&c->abi_version==HBX_ABI_VERSION?HBX_OK:HBX_ERR_ABI;}
uint64_t hbx_now_ns(const struct hbx_ctx*c){(void)c;fake_ns+=1000000;return fake_ns;}
uint64_t hbx_pace(const struct hbx_ctx*c,uint64_t*d,uint32_t hz){struct hbx_ctx*m=(struct hbx_ctx*)(uintptr_t)c;(void)hz;frame_no++;if(d)*d+=16666667;if(frame_no>=8)m->exit=HBX_EXIT_REQUEST;return fake_ns;}
void hbx_input_poll(const struct hbx_ctx*c,struct hbx_input_state*s){static const uint32_t seq[]={HBX_R,HBX_A,HBX_Y,HBX_L,HBX_DOWN,HBX_ZR,0,0};(void)c;memset(s,0,sizeof(*s));if(frame_no<8)s->pressed=seq[frame_no];}
int hbx_touch_hit(const struct hbx_touch_point*p,int32_t x,int32_t y,int32_t w,int32_t h){int32_t px,py;if(!p)return 0;px=p->x*3/2;py=p->y*3/2;return px>=x&&px<x+w&&py>=y&&py<y+h;}
void hbx_log(const struct hbx_ctx*c,const char*s){(void)c;(void)s;}
void hbx_logf(const struct hbx_ctx*c,const char*f,...){(void)c;(void)f;}
int main(void){struct hbx_save_header*save=(struct hbx_save_header*)(void*)save_mem;uint32_t saved_magic;memset(&ctx,0,sizeof(ctx));memset(&ops,0,sizeof(ops));memset(save_mem,0,sizeof(save_mem));ops.abi=HBX_RENDER_ABI;ops.size=sizeof(ops);ops.begin=begin;ops.rect=rect;ops.stroke=stroke;ops.text=text;ops.text_width=width;ops.line=line;ops.circle=circle;ops.icon=icon;ops.image=image;ops.vertices=vertices;ops.present=present;ops.frame=getframe;ops.device=device;ops.queue=queue;render.abi=HBX_RENDER_ABI;render.size=sizeof(render);render.self=&render;render.ops=&ops;ctx.magic=HBX_ABI_MAGIC;ctx.abi_version=HBX_ABI_VERSION;ctx.size=sizeof(ctx);ctx.flags=HBX_FLAG_NO_AV;ctx.ui=(uint64_t)(uintptr_t)&render;ctx.args[6]=(uint64_t)(uintptr_t)save;ctx.args[7]=sizeof(save_mem);CHECK(hbx_app_main(&ctx)==HBX_OK,"entry returns cleanly");CHECK(frame_no==8&&presents==8,"8 paced UI frames are presented");CHECK(shapes>300&&texts>100,"renderer received substantive UI geometry and text");CHECK(save->magic==HBX_SAVE_MAGIC&&save->dirty,"project persisted to launcher save block");memcpy(&saved_magic,save_mem+sizeof(*save),sizeof(saved_magic));CHECK(saved_magic==0x504d4c48u,"HML save payload magic");CHECK(ctx.exit==HBX_EXIT_REQUEST,"launcher exit request honored");printf("%u presents, %u draw ops, %d failures\n",presents,shapes+texts,fails);return fails?1:0;}
