/* HyperText Music Land — native HBLauncher / BrendanLauncher port.
 * Freestanding ABI v3; no libc, threads, filesystems or browser APIs.
 */
#include "hml.h"
#include "hbx_app.h"
#include "hbx_ui.h"
#include "hbx_math.h"

#define C_BG      HBX_RGB(8,12,24)
#define C_PANEL   HBX_RGB(16,24,42)
#define C_PANEL2  HBX_RGB(22,34,56)
#define C_GRID    HBX_RGB(34,50,73)
#define C_TEXT    HBX_RGB(225,237,250)
#define C_MUTED   HBX_RGB(135,157,180)
#define C_CYAN    HBX_RGB(34,211,238)
#define C_SKY     HBX_RGB(56,189,248)
#define C_PINK    HBX_RGB(244,114,182)
#define C_GREEN   HBX_RGB(52,211,153)
#define C_YELLOW  HBX_RGB(251,191,36)
#define C_RED     HBX_RGB(251,113,133)
#define MAX_AUDIO_FRAMES 4096u
#define AUDIO_SLOTS 4u
#define SAVE_APP_MAGIC 0x504d4c48u /* HLMP */
#define SAVE_ARTIFACT_MIDI 0x44494d48u
#define SAVE_ARTIFACT_WAV  0x56415748u

static struct hml_project g_project;
static struct hml_engine g_engine;
static const struct hbx_ctx *g_ctx;
static struct hbx_input_state g_input;
static uint32_t g_screen, g_cursor_pitch=62, g_top_pitch=84, g_snap=2, g_last_touch;
static float g_cursor_beat, g_scroll_beat, g_zoom=58.0f;
static uint32_t g_fps=60, g_frame_count, g_status_frames, g_tool_choice;
static char g_status[72] = "D-pad move  A place  Y play  X randomize";
static int g_dirty, g_audio_ready, g_audio_opened, g_touch_press;
static uint32_t g_audio_rate=48000, g_audio_channels=2, g_audio_frames=800, g_audio_queued;
static uint64_t g_deadline;

struct app_save { uint32_t magic, version, size; struct hml_project project; uint32_t artifact, artifact_bytes; };
static struct hbx_save_header *g_save_header;
static struct app_save *g_save;
static uint32_t g_save_capacity;
static uint8_t g_out_obj[512] __attribute__((aligned(64)));
static uint8_t g_param_obj[256] __attribute__((aligned(64)));
static uint8_t g_buf_obj[AUDIO_SLOTS][128] __attribute__((aligned(64)));
static int16_t g_pcm[AUDIO_SLOTS][MAX_AUDIO_FRAMES*8u] __attribute__((aligned(64)));
static uint8_t g_slot_busy[AUDIO_SLOTS];
static uint32_t g_slot_bytes[AUDIO_SLOTS];

typedef void (*fn_init_param)(void*);
typedef int32_t (*fn_open)(void*,const void*);
typedef uint32_t (*fn_query)(const void*);
typedef void (*fn_buffer_info)(void*,void*,uint64_t,uint64_t);
typedef int32_t (*fn_append)(void*,void*);
typedef int32_t (*fn_action)(void*);
typedef void (*fn_close)(void*);
typedef void* (*fn_released)(void*,void**);
#define AUDIO_FN(type,field) ((type)(uintptr_t)g_ctx->audio.field)
static void msg(const char*s){uint32_t i=0;while(i+1<sizeof(g_status)&&s[i]){g_status[i]=s[i];i++;}g_status[i]=0;g_status_frames=240;}
static void text(const struct hbx_ctx*ctx,float x,float y,uint32_t font,const char*s,uint32_t color){hbx_ui_text(ctx,x,y,font,s,color);}
static void center(const struct hbx_ctx*ctx,float cx,float y,uint32_t font,const char*s,uint32_t color){float w=hbx_ui_text_width(ctx,font,s);text(ctx,cx-w*.5f,y,font,s,color);}
static void rect(const struct hbx_ctx*ctx,float x,float y,float w,float h,float r,uint32_t color){hbx_ui_rect(ctx,x,y,w,h,r,color);}
static void line(const struct hbx_ctx*ctx,float x,float y,float x2,float y2,float w,uint32_t c){hbx_ui_line(ctx,x,y,x2,y2,w,c,HBX_LINE_SOFT);}
static int touch_hit(const struct hbx_input_state*in,int x,int y,int w,int h){uint32_t i;for(i=0;i<in->touch_count&&i<HBX_MAX_TOUCH;i++)if(hbx_touch_hit(&in->touch[i],x,y,w,h))return 1;return 0;}
static int button(const struct hbx_ctx*ctx,const struct hbx_input_state*in,int x,int y,int w,int h,const char*label,int active){uint32_t c=active?C_CYAN:C_PANEL2;rect(ctx,(float)x,(float)y,(float)w,(float)h,10,c);hbx_ui_stroke(ctx,(float)x,(float)y,(float)w,(float)h,10,1.0f,active?C_SKY:C_GRID);center(ctx,x+w/2.0f,y+(h-17)/2.0f,HBX_FONT_SMALL,label,active?C_BG:C_TEXT);return g_touch_press&&touch_hit(in,x,y,w,h);}
static void draw_meter(const struct hbx_ctx*ctx,float x,float y,float w,float h,float v){float q=v;if(q<0)q=0;if(q>1)q=1;rect(ctx,x,y,w,h,5,C_PANEL2);rect(ctx,x,y,w*q,h,5,q>.86f?C_RED:C_GREEN);}
static void number(char*out,uint32_t val,uint32_t width){uint32_t i;for(i=0;i<width;i++){out[width-1-i]=(char)('0'+val%10);val/=10;}out[width]=0;}
static float total_beats(const struct hml_project*p){return(float)(p->bars*p->beats_per_bar);}
static float playhead(void){return (float)g_engine.sample*(float)g_project.bpm/(60.0f*(float)g_engine.rate);}
static uint32_t artifact_offset(void){return (uint32_t)((sizeof(*g_save_header)+sizeof(*g_save)+15u)&~15u);}
static void project_sanitize(void){uint32_t i,j;if(g_project.track_count==0||g_project.track_count>HML_TRACKS)g_project.track_count=5;if(g_project.selected_track>=g_project.track_count)g_project.selected_track=0;if(g_project.bpm<HML_MIN_BPM)g_project.bpm=120;if(g_project.bpm>HML_MAX_BPM)g_project.bpm=HML_MAX_BPM;if(g_project.bars==0||g_project.bars>64)g_project.bars=4;if(g_project.beats_per_bar==0||g_project.beats_per_bar>12)g_project.beats_per_bar=4;if(g_project.master<0||g_project.master>1.2f)g_project.master=.82f;g_project.playing=0;for(i=0;i<g_project.track_count;i++){struct hml_track*t=&g_project.tracks[i];if(t->instrument>=HML_INS_COUNT)t->instrument=HML_LEAD;if(t->count>HML_NOTES)t->count=HML_NOTES;if(t->volume<0||t->volume>1.2f)t->volume=.75f;if(t->pan< -1||t->pan>1)t->pan=0;if(t->cutoff<20||t->cutoff>20000)t->cutoff=8000;if(t->delay<0||t->delay>1)t->delay=0;if(t->reverb<0||t->reverb>1)t->reverb=.15f;for(j=0;j<t->count;j++){if(t->notes[j].pitch>127)t->notes[j].pitch=60;if(t->notes[j].length<.02f||t->notes[j].length>32)t->notes[j].length=.25f;if(t->notes[j].beat<0||t->notes[j].beat>1024)t->notes[j].beat=0;}}}
static void save_flush(void){uint32_t used;if(!g_save||!g_save_header)return;g_save->magic=SAVE_APP_MAGIC;g_save->version=HML_VERSION;g_save->size=(uint32_t)sizeof(*g_save);g_save->project=g_project;used=(uint32_t)(sizeof(*g_save_header)+sizeof(*g_save));if(g_save->artifact_bytes&&artifact_offset()+g_save->artifact_bytes<=g_save_capacity)used=artifact_offset()+g_save->artifact_bytes;else if(g_save->artifact_bytes){g_save->artifact=0;g_save->artifact_bytes=0;}g_save_header->magic=HBX_SAVE_MAGIC;g_save_header->version=HML_VERSION;g_save_header->bytes=used;g_save_header->dirty=1;g_dirty=0;}
static void save_init(const struct hbx_ctx*ctx){uint32_t n=0;g_save_header=hbx_save_block(ctx,&n);g_save_capacity=n;if(!g_save_header||n<sizeof(*g_save_header)+sizeof(struct app_save)){g_save=0;hml_project_default(&g_project);return;}g_save=(struct app_save*)((uint8_t*)g_save_header+sizeof(*g_save_header));if(g_save_header->magic==HBX_SAVE_MAGIC&&g_save_header->bytes>=sizeof(*g_save_header)+sizeof(*g_save)&&g_save_header->bytes<=n&&g_save->magic==SAVE_APP_MAGIC&&g_save->version==HML_VERSION&&g_save->size==sizeof(*g_save)){g_project=g_save->project;project_sanitize();}else{hbx_memset(g_save,0,sizeof(*g_save));hml_project_default(&g_project);save_flush();}}
static void mark_dirty(void){g_dirty=1;}
static void start_audio(const struct hbx_ctx*ctx){fn_init_param initp;fn_open open;fn_query rate,ch;fn_buffer_info setinfo;fn_append append;fn_action start;uint32_t i;int32_t rc;
    if((ctx->flags&HBX_FLAG_NO_AV)||!ctx->audio.initialize_parameter||!ctx->audio.open_default_audio_out||!ctx->audio.set_buffer_info||!ctx->audio.append_buffer||!ctx->audio.start||!ctx->audio.released_buffer)return;
    initp=AUDIO_FN(fn_init_param,initialize_parameter);open=AUDIO_FN(fn_open,open_default_audio_out);setinfo=AUDIO_FN(fn_buffer_info,set_buffer_info);append=AUDIO_FN(fn_append,append_buffer);start=AUDIO_FN(fn_action,start);
    hbx_memset(g_out_obj,0,sizeof(g_out_obj));hbx_memset(g_param_obj,0,sizeof(g_param_obj));initp(g_param_obj);rc=open(g_out_obj,g_param_obj);if(rc){hbx_logf(ctx,"HML: audio open failed %d",rc);return;}g_audio_opened=1;
    rate=ctx->audio.sample_rate?(fn_query)(uintptr_t)ctx->audio.sample_rate:0;ch=ctx->audio.channel_count?(fn_query)(uintptr_t)ctx->audio.channel_count:0;if(rate){uint32_t q=rate(g_out_obj);if(q>=8000&&q<=192000)g_audio_rate=q;}if(ch){uint32_t q=ch(g_out_obj);if(q>=1&&q<=8)g_audio_channels=q;}if(g_audio_channels>8)g_audio_channels=2;
    g_audio_frames=(g_audio_rate/60u+63u)&~63u;if(g_audio_frames<64)g_audio_frames=64;if(g_audio_frames>MAX_AUDIO_FRAMES)g_audio_frames=MAX_AUDIO_FRAMES;
    for(i=0;i<AUDIO_SLOTS;i++){uint32_t samples=g_audio_frames*g_audio_channels;if(samples>MAX_AUDIO_FRAMES*8u)samples=MAX_AUDIO_FRAMES*8u;hbx_memset(g_pcm[i],0,samples*sizeof(int16_t));g_slot_bytes[i]=samples*sizeof(int16_t);setinfo(g_buf_obj[i],g_pcm[i],g_slot_bytes[i],0);if(append(g_out_obj,g_buf_obj[i])==0){g_slot_busy[i]=1;g_audio_queued++;}}
    if(start(g_out_obj)==0){g_audio_ready=1;hbx_logf(ctx,"HML: audio ready %u Hz, %u ch",g_audio_rate,g_audio_channels);}else hbx_log(ctx,"HML: audio start failed; silent clock");
}
static uint32_t service_audio(void){fn_released released;fn_buffer_info setinfo;fn_append append;uint32_t pushed=0,i;int16_t*buf;
    if(!g_audio_ready) return 0;
    released=(fn_released)(uintptr_t)g_ctx->audio.released_buffer;
    setinfo=AUDIO_FN(fn_buffer_info,set_buffer_info);
    append=AUDIO_FN(fn_append,append_buffer);
    if(!released) return 0;
    for(i=0;i<AUDIO_SLOTS;i++){void*reported=0;void*done=released(g_out_obj,&reported);uint32_t slot;if((uintptr_t)done<0x10000u)done=reported;if(!done)break;for(slot=0;slot<AUDIO_SLOTS;slot++)if(done==(void*)g_buf_obj[slot])break;if(slot>=AUDIO_SLOTS){for(slot=0;slot<AUDIO_SLOTS;slot++)if(g_slot_busy[slot])break;if(slot>=AUDIO_SLOTS)break;}g_slot_busy[slot]=0;if(g_audio_queued)g_audio_queued--;buf=g_pcm[slot];hml_engine_render(&g_engine,&g_project,buf,g_audio_frames,g_audio_channels);setinfo(g_buf_obj[slot],buf,g_slot_bytes[slot],0);if(append(g_out_obj,g_buf_obj[slot])==0){g_slot_busy[slot]=1;g_audio_queued++;pushed++;}}
    return pushed;
}
static void stop_audio(void){fn_action stop;fn_close close;if(g_audio_ready&&g_ctx->audio.stop){stop=AUDIO_FN(fn_action,stop);stop(g_out_obj);}if(g_audio_opened&&g_ctx->audio.close){close=AUDIO_FN(fn_close,close);close(g_out_obj);}g_audio_ready=0;g_audio_opened=0;}
static void draw_header(const struct hbx_ctx*ctx,const struct hbx_input_state*in){uint32_t i;rect(ctx,0,0,1920,68,0,C_PANEL);text(ctx,30,14,HBX_FONT_H2,"HYPER TEXT MUSIC LAND",C_TEXT);text(ctx,32,43,HBX_FONT_TINY,g_project.title,C_MUTED);for(i=0;i<HML_SCREEN_COUNT;i++){int x=420+(int)i*210;if(button(ctx,in,x,18,196,38,hml_screen_names[i],g_screen==i))g_screen=i;}rect(ctx,1720,18,160,36,9,g_audio_ready?HBX_RGB(10,70,59):HBX_RGB(60,44,28));center(ctx,1800,27,HBX_FONT_TINY,g_audio_ready?"AUDIO ONLINE":"SILENT PREVIEW",g_audio_ready?C_GREEN:C_YELLOW);}
static void draw_transport(const struct hbx_ctx*ctx,const struct hbx_input_state*in){char digits[8];float beat=playhead(),len=total_beats(&g_project),prog=len>0?beat/len:0;uint32_t bar=(uint32_t)(beat/g_project.beats_per_bar)+1u,sub=(uint32_t)beat%g_project.beats_per_bar+1u;rect(ctx,0,68,1920,92,0,C_BG);rect(ctx,24,80,1872,66,15,C_PANEL);if(button(ctx,in,42,92,102,42,"STOP",0)){hml_engine_play(&g_engine,&g_project,0);g_engine.sample=0;beat=0;}
    if(button(ctx,in,154,92,116,42,g_project.playing?"PAUSE":"PLAY",g_project.playing))hml_engine_play(&g_engine,&g_project,!g_project.playing);
    if(button(ctx,in,282,92,86,42,"REC",g_project.tracks[g_project.selected_track].armed)){g_project.tracks[g_project.selected_track].armed^=1;mark_dirty();}
    number(digits,bar,3);text(ctx,405,102,HBX_FONT_H2,digits,C_CYAN);text(ctx,442,103,HBX_FONT_BODY,":",C_MUTED);number(digits,sub,2);text(ctx,465,103,HBX_FONT_H2,digits,C_CYAN);text(ctx,505,107,HBX_FONT_TINY,"BAR / BEAT",C_MUTED);
    if(button(ctx,in,638,94,42,38,"-",0)&&g_project.bpm>HML_MIN_BPM){g_project.bpm--;mark_dirty();}
    number(digits,g_project.bpm,3);center(ctx,733,99,HBX_FONT_H2,digits,C_TEXT);text(ctx,766,107,HBX_FONT_SMALL,"BPM",C_MUTED);
    if(button(ctx,in,810,94,42,38,"+",0)&&g_project.bpm<HML_MAX_BPM){g_project.bpm++;mark_dirty();}
    if(button(ctx,in,876,94,90,38,"LOOP",g_project.looping)){g_project.looping^=1;mark_dirty();}
    if(button(ctx,in,972,94,124,38,"METRONOME",g_project.metronome)){g_project.metronome^=1;mark_dirty();}
    text(ctx,1142,101,HBX_FONT_SMALL,"MASTER",C_MUTED);rect(ctx,1220,101,310,20,8,C_PANEL2);rect(ctx,1220,101,310*g_project.master/1.2f,20,8,C_CYAN);center(ctx,1648,102,HBX_FONT_SMALL,"D MINOR  •  4/4",C_MUTED);rect(ctx,1740,101,130,18,7,C_PANEL2);rect(ctx,1740,101,130*prog,18,7,C_PINK);
    if(touch_hit(in,1220,95,310,34)){int x=in->touch[0].x*3/2;g_project.master=(float)(x-1220)/310.0f;if(g_project.master>1.2f)g_project.master=1.2f;if(g_project.master<0)g_project.master=0;mark_dirty();}if(g_dirty)save_flush();}
static void draw_arrange(const struct hbx_ctx*ctx,const struct hbx_input_state*in){uint32_t i,j;float x0=330,y0=240,lane=126;rect(ctx,24,184,1872,820,18,C_PANEL);text(ctx,50,202,HBX_FONT_H2,"ARRANGEMENT",C_TEXT);text(ctx,50,235,HBX_FONT_SMALL,"Track lanes  •  note blocks  •  four-bar loop",C_MUTED);for(i=0;i<g_project.bars&&i<64;i++){float x=x0+((float)i*g_project.beats_per_bar-g_scroll_beat)*g_zoom;if(x<x0-2||x>1880)continue;line(ctx,x,y0-10,x,984,1,C_GRID);{char b[8];number(b,i+1,2);text(ctx,x+6,y0-5,HBX_FONT_TINY,b,C_MUTED);}}
    for(i=0;i<g_project.track_count;i++){struct hml_track*t=&g_project.tracks[i];float y=y0+i*lane;if(y+lane>984)break;rect(ctx,42,y,274,lane-8,12,i==g_project.selected_track?C_PANEL2:C_BG);if(i==g_project.selected_track)hbx_ui_stroke(ctx,42,y,274,lane-8,12,2,C_CYAN);text(ctx,58,y+15,HBX_FONT_BODY,t->name,C_TEXT);text(ctx,58,y+44,HBX_FONT_TINY,hml_instrument_names[t->instrument],C_MUTED);draw_meter(ctx,60,y+78,180,12,t->volume);rect(ctx,x0,y,1520,lane-8,10,C_BG);
        for(j=0;j<t->count;j++){float nx=x0+(t->notes[j].beat-g_scroll_beat)*g_zoom, nw=t->notes[j].length*g_zoom;if(nx>x0+1510||nx+nw<x0)continue;rect(ctx,nx,y+18+(float)(127-t->notes[j].pitch)*.48f,nw<6?6:nw,15,5,t->color);}
        if(touch_hit(in,42,(int)y,274,(int)lane))g_project.selected_track=i;}
    {float px=x0+(playhead()-g_scroll_beat)*g_zoom;line(ctx,px,y0-12,px,980,3,C_PINK);}
}
static void draw_piano(const struct hbx_ctx*ctx,const struct hbx_input_state*in){struct hml_track*t=&g_project.tracks[g_project.selected_track];uint32_t i,pitch;float x0=260,y0=250,row=34,beatW=76;rect(ctx,24,184,1872,820,18,C_PANEL);text(ctx,50,202,HBX_FONT_H2,"PIANO ROLL  /  ",C_TEXT);text(ctx,280,202,HBX_FONT_H2,t->name,C_CYAN);text(ctx,50,232,HBX_FONT_SMALL,"A add • B erase • ← → move • ↑ ↓ pitch • X instrument",C_MUTED);for(i=0;i<16;i++){float x=x0+i*beatW;if(x>1850)break;line(ctx,x,y0,x,970,1,(i%4==0)?C_GRID:HBX_RGB(25,39,59));if(i%4==0){char b[8];number(b,i/4+1,2);text(ctx,x+4,y0-18,HBX_FONT_TINY,b,C_MUTED);}}
    for(i=0;i<18;i++){int pi=(int)g_top_pitch-(int)i;float y=y0+i*row;uint32_t pc,key;if(pi<0)continue;pitch=(uint32_t)pi;pc=pitch%12;key=(pc==1||pc==3||pc==6||pc==8||pc==10)?HBX_RGB(29,38,55):HBX_RGB(41,55,76);rect(ctx,46,y,202,row-2,2,key);{char c[8];number(c,pitch,3);text(ctx,57,y+6,HBX_FONT_TINY,c,C_MUTED);}line(ctx,x0,y+row,x0+1520,y+row,1,C_GRID);if(g_touch_press&&touch_hit(in,46,(int)y,202,(int)row)){g_cursor_pitch=pitch;hml_note_on(&g_engine,&g_project,g_project.selected_track,pitch,.72f,.18f);}}
    {uint32_t shown=0;for(i=0;i<t->count&&shown<64;i++){struct hml_note*n=&t->notes[i];float x=x0+(n->beat-g_scroll_beat)*beatW,y=y0+((float)g_top_pitch-(float)n->pitch)*row,w=n->length*beatW;if(x<x0-200||x>x0+1500||y<y0||y>y0+17*row)continue;rect(ctx,x,y+3,w<9?9:w,row-6,5,(n->pitch==g_cursor_pitch&&hbx_fabsf(n->beat-g_cursor_beat)<.2f)?C_YELLOW:t->color);shown++;if(touch_hit(in,(int)x,(int)y,(int)(w<9?9:w),(int)row)){g_cursor_pitch=n->pitch;g_cursor_beat=n->beat;}}
    }
    {float x=x0+(g_cursor_beat-g_scroll_beat)*beatW,y=y0+((float)g_top_pitch-(float)g_cursor_pitch)*row;hbx_ui_stroke(ctx,x,y,beatW/(float)(1u<<g_snap),row,1,2,C_CYAN);}
    {float x=x0+(playhead()-g_scroll_beat)*beatW;line(ctx,x,y0,x,970,2,C_PINK);}
}
static void draw_mixer(const struct hbx_ctx*ctx,const struct hbx_input_state*in){uint32_t i;rect(ctx,24,184,1872,820,18,C_PANEL);text(ctx,50,202,HBX_FONT_H2,"MIXER  /  TRACK STRIPS",C_TEXT);for(i=0;i<g_project.track_count&&i<7;i++){struct hml_track*t=&g_project.tracks[i];int x=48+(int)i*260;int sel=i==g_project.selected_track;rect(ctx,x,248,242,520,14,sel?C_PANEL2:C_BG);if(sel)hbx_ui_stroke(ctx,x,248,242,520,14,2,C_CYAN);text(ctx,x+16,268,HBX_FONT_SMALL,t->name,C_TEXT);text(ctx,x+16,300,HBX_FONT_TINY,hml_instrument_names[t->instrument],C_MUTED);if(button(ctx,in,x+14,344,64,34,"MUTE",t->muted))t->muted^=1;if(button(ctx,in,x+86,344,64,34,"SOLO",t->solo))t->solo^=1;if(button(ctx,in,x+158,344,68,34,"ARM",t->armed))t->armed^=1;text(ctx,x+18,408,HBX_FONT_TINY,"LEVEL",C_MUTED);draw_meter(ctx,x+18,439,204,18,t->volume);rect(ctx,x+18,496,204,18,8,C_PANEL2);rect(ctx,x+18,496,204*t->volume,18,8,t->color);text(ctx,x+18,534,HBX_FONT_TINY,"PAN",C_MUTED);line(ctx,x+24,574,x+212,574,2,C_GRID);rect(ctx,x+24+(t->pan+1)*94-8,563,16,22,7,C_CYAN);text(ctx,x+18,624,HBX_FONT_TINY,"FILTER CUTOFF",C_MUTED);draw_meter(ctx,x+18,654,204,12,t->cutoff/18000);if(touch_hit(in,x,248,242,520))g_project.selected_track=i;
        if(touch_hit(in,x+18,490,204,34)){int tx=in->touch[0].x*3/2;t->volume=(float)(tx-(x+18))/204.0f;if(t->volume<0)t->volume=0;if(t->volume>1.2f)t->volume=1.2f;mark_dirty();}if(touch_hit(in,x+18,559,204,32)){int tx=in->touch[0].x*3/2;t->pan=((float)(tx-(x+24))/188.0f)*2-1;if(t->pan< -1)t->pan=-1;if(t->pan>1)t->pan=1;mark_dirty();}}
    if(g_dirty)save_flush();}
static void draw_vision(const struct hbx_ctx*ctx){uint32_t i;float cx=960,cy=594,beat=playhead();rect(ctx,24,184,1872,820,18,C_BG);text(ctx,50,202,HBX_FONT_H2,"VISION FLOW  /  LIVE AUDIO REACTIVE",C_TEXT);for(i=0;i<14;i++){float x=100+(float)i*132;float h=70+(float)((i*37u+g_engine.sample/997u)%280u)*(0.35f+g_engine.peak);rect(ctx,x,870-h,82,h,8,(i%3==0)?C_PINK:(i%2?C_CYAN:C_SKY));}for(i=0;i<8;i++){float r=70+(float)i*48+(beat-(float)(uint32_t)beat)*20;hbx_ui_circle(ctx,cx,cy,r,2.0f,i%2?HBX_RGBA(56,189,248,90):HBX_RGBA(244,114,182,90),HBX_LINE_SOFT);}for(i=0;i<24;i++){float x=100+(float)((i*191u+g_engine.sample/37u)%1690u);float y=300+(float)((i*83u+g_engine.sample/73u)%500u);hbx_ui_circle(ctx,x,y,2+(float)(i%5),0,HBX_RGBA(72,220,244,170),HBX_LINE_SOFT);}center(ctx,960,380,HBX_FONT_H1,g_project.title,C_TEXT);center(ctx,960,426,HBX_FONT_BODY,"AURAVISION  •  SOUND IN MOTION",C_CYAN);}
static void draw_tools(const struct hbx_ctx*ctx,const struct hbx_input_state*in){uint32_t i;const char*items[]={"Export MIDI to save block","Render 4-second stereo WAV","Import MIDI package asset","Randomize selected track"};rect(ctx,24,184,1872,820,18,C_PANEL);text(ctx,50,202,HBX_FONT_H2,"TOOLS  /  PROJECT WORKFLOW",C_TEXT);text(ctx,50,236,HBX_FONT_SMALL,"Exports are written to the persistent save block; copy the app .sav file from the host saves directory.",C_MUTED);for(i=0;i<4;i++){int y=300+(int)i*128;rect(ctx,70,y,1780,100,14,i==g_tool_choice?C_PANEL2:C_BG);if(i==g_tool_choice)hbx_ui_stroke(ctx,70,y,1780,100,14,2,C_CYAN);text(ctx,100,y+16,HBX_FONT_H2,items[i],C_TEXT);text(ctx,100,y+55,HBX_FONT_SMALL,i==0?"Standard MIDI File, format 1":i==1?"48 kHz PCM16, audible synth render":i==2?"Reads the first .mid package asset":"Seeded variation; notes and patch stay editable",C_MUTED);if(touch_hit(in,70,y,1780,100))g_tool_choice=i;}text(ctx,50,858,HBX_FONT_SMALL,"Use ↑ / ↓ then A to run the selected tool.",C_CYAN);}
static void draw_settings(const struct hbx_ctx*ctx,const struct hbx_input_state*in){(void)in;rect(ctx,24,184,1872,820,18,C_PANEL);text(ctx,50,202,HBX_FONT_H2,"SETTINGS  /  SESSION",C_TEXT);text(ctx,70,292,HBX_FONT_BODY,"Project",C_MUTED);text(ctx,330,292,HBX_FONT_H2,g_project.title,C_TEXT);text(ctx,70,366,HBX_FONT_BODY,"Tempo",C_MUTED);{char b[8];number(b,g_project.bpm,3);text(ctx,330,366,HBX_FONT_H2,b,C_CYAN);}text(ctx,385,374,HBX_FONT_SMALL,"BPM  (ZL / ZR)",C_MUTED);text(ctx,70,440,HBX_FONT_BODY,"Arrangement",C_MUTED);text(ctx,330,440,HBX_FONT_H2,"4 bars  •  4/4  •  5 seeded tracks",C_TEXT);text(ctx,70,514,HBX_FONT_BODY,"Audio",C_MUTED);text(ctx,330,514,HBX_FONT_H2,g_audio_ready?"Native AudioOut active":"Silent clock / display preview",g_audio_ready?C_GREEN:C_YELLOW);text(ctx,70,588,HBX_FONT_BODY,"Persistence",C_MUTED);text(ctx,330,588,HBX_FONT_H2,g_save?"HBLauncher save block":"Save block not provided",g_save?C_GREEN:C_YELLOW);text(ctx,70,686,HBX_FONT_SMALL,"B returns to arrangement.  PLUS exits to launcher.",C_MUTED);}
static void draw_ui(const struct hbx_ctx*ctx,const struct hbx_input_state*in){hbx_ui_begin(ctx,C_BG);draw_header(ctx,in);draw_transport(ctx,in);switch(g_screen){case HML_ARRANGE:draw_arrange(ctx,in);break;case HML_PIANO_ROLL:draw_piano(ctx,in);break;case HML_MIXER:draw_mixer(ctx,in);break;case HML_VISION:draw_vision(ctx);break;case HML_TOOLS:draw_tools(ctx,in);break;default:draw_settings(ctx,in);break;}rect(ctx,0,1014,1920,66,0,C_PANEL);text(ctx,34,1024,HBX_FONT_SMALL,g_status,C_MUTED);{char b[8];number(b,g_fps,2);text(ctx,1670,1026,HBX_FONT_TINY,"FPS",C_MUTED);text(ctx,1710,1026,HBX_FONT_SMALL,b,C_CYAN);text(ctx,1790,1026,HBX_FONT_TINY,"B BACK  •  + EXIT",C_MUTED);}hbx_ui_present(ctx);}
static void do_export_midi(void){uint32_t cap=0,n;uint8_t*out;struct hbx_save_header*h=hbx_save_block(g_ctx,&cap);uint32_t start=(uint32_t)((sizeof(*h)+sizeof(struct app_save)+15u)&~15u);if(!h||cap<=start+4096){msg("Save block too small for MIDI export");return;}out=(uint8_t*)h+start;n=hml_midi_write(&g_project,out,cap-start);if(!n){msg("MIDI export failed");return;}g_save->artifact=SAVE_ARTIFACT_MIDI;g_save->artifact_bytes=n;h->bytes=start+n;h->dirty=1;msg("MIDI exported • copy hypertextmusicland.sav from saves/");}
static void do_export_wav(void){uint32_t cap=0,frames,bytes,start;struct hbx_save_header*h=hbx_save_block(g_ctx,&cap);struct hml_engine tmp=g_engine;struct hml_project p=g_project;uint8_t*out;int16_t*pcm;const uint32_t rate=48000;start=(uint32_t)((sizeof(*h)+sizeof(struct app_save)+15u)&~15u);if(!h||cap<=start+44+4096){msg("Save block too small for WAV bounce");return;}frames=cap-start-44;frames/=4;if(frames>rate*4u)frames=rate*4u;if(frames<rate) {msg("Save block cannot fit WAV bounce");return;}bytes=44+frames*4u;out=(uint8_t*)h+start;pcm=(int16_t*)(void*)(out+44);hml_engine_init(&tmp,rate);p.playing=1;p.looping=0;hml_engine_render(&tmp,&p,pcm,frames,2);if(!hml_wav_header(out,cap-start,frames,2,rate)){msg("WAV header failed");return;}g_save->artifact=SAVE_ARTIFACT_WAV;g_save->artifact_bytes=bytes;h->bytes=start+bytes;h->dirty=1;msg("WAV bounced • copy hypertextmusicland.sav from saves/");}
static void import_asset(void){const struct hbx_asset_table*tab=(const struct hbx_asset_table*)(uintptr_t)g_ctx->assets;uint32_t i;if(!tab||tab->magic!=HBX_ASSET_MAGIC||tab->count>HBX_MAX_ASSETS){msg("No MIDI assets in this package");return;}for(i=0;i<tab->count;i++){uint32_t n=0,limit=tab->entries[i].size;const char*name;const uint8_t*d;if(tab->entries[i].name_off>=g_ctx->data_size||tab->entries[i].data_off>g_ctx->data_size||limit>g_ctx->data_size-tab->entries[i].data_off)continue;name=(const char*)(uintptr_t)(g_ctx->data_base+tab->entries[i].name_off);d=(const uint8_t*)(uintptr_t)(g_ctx->data_base+tab->entries[i].data_off);while(n<HBX_PATH_MAX&&tab->entries[i].name_off+n<g_ctx->data_size&&name[n])n++;if(n<4||n>=HBX_PATH_MAX||name[n-4]!='.'||(name[n-3]!='m'&&name[n-3]!='M')||(name[n-2]!='i'&&name[n-2]!='I')||(name[n-1]!='d'&&name[n-1]!='D'))continue;if(hml_midi_import(&g_project,d,limit)){mark_dirty();msg("MIDI imported from package asset");return;}}msg("No valid .mid package asset found");}
static void randomize(void){struct hml_track*t=&g_project.tracks[g_project.selected_track];uint32_t x=(uint32_t)(g_engine.sample+0x9e3779b9u);uint32_t i;x^=x<<13;x^=x>>17;x^=x<<5;t->cutoff=500.0f+(float)(x%15000u);t->resonance=0.5f+(float)((x>>8)%80u)/10.0f;t->delay=(float)((x>>16)%50u)/100.0f;for(i=0;i<8&&t->count<HML_NOTES;i++){x^=x<<13;x^=x>>17;x^=x<<5;hml_add_note(&g_project,g_project.selected_track,(float)(x%16u)*.25f,60u+(x>>8)%24u,55u+(x>>20)%70u,.18f+(float)((x>>26)&7u)*.05f);}mark_dirty();msg("SonicRNG: patch and glitch fill rolled");}
static void handle_input(const struct hbx_input_state*in){uint32_t b=in->pressed;int touch=(in->touch_count&&!g_last_touch);g_touch_press=touch;g_last_touch=in->touch_count;
    if(b&HBX_PLUS){hbx_request_exit(g_ctx);return;}if((b&HBX_B)&&g_screen==HML_SETTINGS){g_screen=HML_ARRANGE;return;}if((b&HBX_B)&&g_screen==HML_PIANO_ROLL){hml_delete_note(&g_project,g_project.selected_track,g_cursor_beat,g_cursor_pitch);mark_dirty();msg("Note deleted");}else if((b&HBX_B)&&g_screen!=HML_ARRANGE)g_screen=HML_ARRANGE;
    if(b&HBX_L) g_screen=(g_screen+HML_SCREEN_COUNT-1)%HML_SCREEN_COUNT;
    if(b&HBX_R) g_screen=(g_screen+1)%HML_SCREEN_COUNT;
    if(b&HBX_ZL&&g_project.bpm>HML_MIN_BPM){g_project.bpm--;mark_dirty();}if(b&HBX_ZR&&g_project.bpm<HML_MAX_BPM){g_project.bpm++;mark_dirty();}
    if(b&HBX_Y){if(g_screen==HML_TOOLS)randomize();else{hml_engine_play(&g_engine,&g_project,!g_project.playing);msg(g_project.playing?"Transport playing":"Transport paused");}}
    if(b&HBX_UP){if(g_screen==HML_PIANO_ROLL){if(g_cursor_pitch<127)g_cursor_pitch++;}else if(g_project.selected_track)g_project.selected_track--;}
    if(b&HBX_DOWN){if(g_screen==HML_PIANO_ROLL){if(g_cursor_pitch)g_cursor_pitch--;}else if(g_project.selected_track+1<g_project.track_count)g_project.selected_track++;}
    if(g_screen==HML_PIANO_ROLL){if(g_cursor_pitch>g_top_pitch)g_top_pitch=g_cursor_pitch;if(g_cursor_pitch+17u<g_top_pitch)g_top_pitch=g_cursor_pitch+17u;if(g_top_pitch<17u)g_top_pitch=17u;}
    if(b&HBX_LEFT){if(g_screen==HML_PIANO_ROLL){g_cursor_beat-=.25f;if(g_cursor_beat<0)g_cursor_beat=0;}else if(g_screen==HML_TOOLS&&g_tool_choice)g_tool_choice--;else if(g_screen==HML_ARRANGE&&g_scroll_beat>=4)g_scroll_beat-=4;}
    if(b&HBX_RIGHT){if(g_screen==HML_PIANO_ROLL)g_cursor_beat+=.25f;else if(g_screen==HML_TOOLS&&g_tool_choice<3)g_tool_choice++;else if(g_screen==HML_ARRANGE)g_scroll_beat+=4;}
    if(in->stick_lx>55||in->stick_lx< -55){if(g_screen==HML_PIANO_ROLL)g_cursor_beat+=in->stick_lx>0?.25f:-.25f;else if(g_screen==HML_TOOLS){if(in->stick_lx>0&&g_tool_choice<3)g_tool_choice++;if(in->stick_lx<0&&g_tool_choice)g_tool_choice--;}else g_scroll_beat+=in->stick_lx>0?.15f:-.15f;}
    if(in->stick_ly>55||in->stick_ly< -55){if(g_screen==HML_PIANO_ROLL){if(in->stick_ly>0&&g_cursor_pitch)g_cursor_pitch--;if(in->stick_ly<0&&g_cursor_pitch<127)g_cursor_pitch++;}else if(in->stick_ly>0&&g_project.selected_track)g_project.selected_track--;else if(in->stick_ly<0&&g_project.selected_track+1<g_project.track_count)g_project.selected_track++;}
    if(b&HBX_X){struct hml_track*t=&g_project.tracks[g_project.selected_track];t->instrument=(uint8_t)((t->instrument+1)%HML_INS_COUNT);mark_dirty();msg("Instrument changed");}
    if(b&HBX_A){if(g_screen==HML_PIANO_ROLL){hml_add_note(&g_project,g_project.selected_track,g_cursor_beat,g_cursor_pitch,100,.25f);hml_note_on(&g_engine,&g_project,g_project.selected_track,g_cursor_pitch,.78f,.25f);mark_dirty();msg("Note added");}else if(g_screen==HML_MIXER){g_project.tracks[g_project.selected_track].muted^=1;mark_dirty();}else if(g_screen==HML_TOOLS){if(g_tool_choice==0)do_export_midi();else if(g_tool_choice==1)do_export_wav();else if(g_tool_choice==2)import_asset();else randomize();}else if(g_screen==HML_ARRANGE){hml_engine_play(&g_engine,&g_project,!g_project.playing);}else if(g_screen==HML_VISION){g_project.theme=(g_project.theme+1)%6;}}
    if(touch){int x=in->touch[0].x*3/2,y=in->touch[0].y*3/2;if(y<66&&x>=420&&x<1680){g_screen=(uint32_t)((x-420)/210);if(g_screen>=HML_SCREEN_COUNT)g_screen=HML_SETTINGS;}else if(y>=82&&y<146&&x>=154&&x<270)hml_engine_play(&g_engine,&g_project,!g_project.playing);else if(g_screen==HML_PIANO_ROLL&&x>=260&&x<1780&&y>=250&&y<250+18*34){float beat=(float)(x-260)/76.0f+g_scroll_beat;uint32_t pitch=g_top_pitch-(uint32_t)((y-250)/34);g_cursor_beat=beat;g_cursor_pitch=pitch;hml_add_note(&g_project,g_project.selected_track,beat,pitch,96,.25f);mark_dirty();}}
    if(g_dirty)save_flush();
}
int hbx_app_main(const struct hbx_ctx*ctx){uint32_t rate,frames,frame=0;int16_t silent[MAX_AUDIO_FRAMES*2u];if(hbx_ctx_check(ctx)!=HBX_OK)return HBX_ERR_ABI;g_ctx=ctx;hbx_memset(&g_input,0,sizeof(g_input));save_init(ctx);hml_engine_init(&g_engine,48000);start_audio(ctx);rate=g_audio_ready?g_audio_rate:48000;hml_engine_init(&g_engine,rate);frames=(rate/60u+63u)&~63u;if(frames>MAX_AUDIO_FRAMES)frames=MAX_AUDIO_FRAMES;hbx_log(ctx,"HyperText Music Land native entry");
    while(!hbx_stop_requested(ctx)){uint64_t start=hbx_now_ns(ctx);hbx_input_poll(ctx,&g_input);handle_input(&g_input);if(g_audio_ready){uint32_t pushed=service_audio();(void)pushed;}else{hml_engine_render(&g_engine,&g_project,silent,frames,2);}
        if(g_engine.ended)g_project.playing=0;
        draw_ui(ctx,&g_input);hbx_frame_end(ctx);frame++;g_frame_count++;{uint64_t elapsed=hbx_now_ns(ctx)-start;if(elapsed>0)g_fps=(uint32_t)(1000000000ull/elapsed);}
        if((frame&63u)==0&&g_dirty) save_flush();
        hbx_pace(ctx,&g_deadline,60);
    }
    if(g_dirty) save_flush();
    stop_audio();hbx_logf(ctx,"HML exit frames=%u",frame);return HBX_OK;
}
