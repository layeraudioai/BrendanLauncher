#include "hml.h"
#include "hbx_math.h"

const char *const hml_screen_names[HML_SCREEN_COUNT] = {"ARRANGE", "PIANO ROLL", "MIXER", "VISION", "TOOLS", "SETTINGS"};
const char *const hml_instrument_names[HML_INS_COUNT] = {"Grand Piano", "Rhodes", "Neon Lead", "Sub Bass", "Aura Pad", "Chip", "808 Drums"};

static void copystr(char *d, uint32_t cap, const char *s) { uint32_t i=0; if(!cap)return; while(i+1<cap && s[i]){d[i]=s[i];i++;} d[i]=0; }
static void seed(struct hml_track *t, const char *name, uint32_t ins, float vol, float pan, uint32_t color) {
    uint32_t i; for(i=0;i<sizeof(*t);i++) ((uint8_t*)t)[i]=0;
    copystr(t->name,HML_NAME,name); t->instrument=(uint8_t)ins; t->volume=vol; t->pan=pan;
    t->color=color; t->cutoff=8000.0f; t->resonance=1.0f; t->reverb=0.15f;
}
void hml_project_default(struct hml_project *p) {
    uint32_t b; if(!p)return; for(b=0;b<sizeof(*p);b++)((uint8_t*)p)[b]=0;
    copystr(p->title,HML_TITLE,"AuraVision • Hybrid Genesis"); p->bpm=124; p->beats_per_bar=4; p->bars=4; p->master=0.82f; p->track_count=5; p->looping=1; p->metronome=1;
    seed(&p->tracks[0],"Aura Sub 808",HML_BASS,.84f,-.08f,0xffa855f7u);
    seed(&p->tracks[1],"66GHz Neon Saw",HML_LEAD,.62f,.12f,0xfff43f5eu); p->tracks[1].cutoff=4800;
    seed(&p->tracks[2],"Celestial Pad",HML_PAD,.52f,-.18f,0xff34d399u); p->tracks[2].muted=1; p->tracks[2].reverb=.6f;
    seed(&p->tracks[3],"Stage Rhodes",HML_RHODES,.62f,.15f,0xfffbbf24u); p->tracks[3].muted=1;
    seed(&p->tracks[4],"AuraBeat 808",HML_DRUMS,.72f,0,0xffec4899u);
    /* A D-minor / Bb / C demo arrangement, spread across four bars. */
    hml_add_note(p,0,0,38,900,.75f); hml_add_note(p,0,1.5f,38,760,.5f); hml_add_note(p,0,2,41,850,.75f); hml_add_note(p,0,3.5f,43,760,.5f);
    { const uint8_t pp[]={62,65,69,72,69,65,62,65,69,74,72,69,65,62,60,62};
      for(b=0;b<16;b++) hml_add_note(p,1,(float)b,pp[b],(b%4==0)?880:700,.42f); }
    for(b=0;b<4;b++){hml_add_note(p,2,(float)b*4,46,620,3.7f);hml_add_note(p,2,(float)b*4,53,620,3.7f);hml_add_note(p,2,(float)b*4,57,620,3.7f);}
    for(b=0;b<8;b++) hml_add_note(p,3,(float)b*2+.5f,69+(b%3)*3,620,.35f);
    for(b=0;b<16;b++){hml_add_note(p,4,(float)b,36,900,.18f); if((b%4)==2)hml_add_note(p,4,(float)b,38,740,.18f);}
    for(b=0;b<32;b++)hml_add_note(p,4,(float)b*.5f,42,(b%2)?480:650,.08f);
}
void hml_add_note(struct hml_project *p,uint32_t ti,float beat,uint32_t pitch,uint32_t velocity,float length){
    struct hml_track *t; struct hml_note *n; uint32_t i;
    if(!p||ti>=p->track_count||pitch>127) return;
    t=&p->tracks[ti];
    if(t->count>=HML_NOTES) return;
    n=&t->notes[t->count++]; n->beat=beat<0?0:beat; n->length=length<.05f?.25f:length; n->pitch=(uint8_t)pitch; n->velocity=(uint8_t)(velocity>127?127:velocity); n->flags=0;
    i=t->count-1; while(i && t->notes[i].beat<t->notes[i-1].beat){struct hml_note x=t->notes[i];t->notes[i]=t->notes[i-1];t->notes[i-1]=x;i--;}
}
void hml_delete_note(struct hml_project *p,uint32_t ti,float beat,uint32_t pitch){uint32_t i,j;struct hml_track*t;if(!p||ti>=p->track_count)return;t=&p->tracks[ti];for(i=0;i<t->count;i++)if(t->notes[i].pitch==pitch && hbx_fabsf(t->notes[i].beat-beat)<.14f){for(j=i+1;j<t->count;j++)t->notes[j-1]=t->notes[j];t->count--;return;}}
void hml_engine_init(struct hml_engine *e,uint32_t rate){uint32_t i; if(!e)return;for(i=0;i<sizeof(*e);i++)((uint8_t*)e)[i]=0;e->rate=rate<8000?48000:rate;}
void hml_engine_play(struct hml_engine *e,struct hml_project*p,int play){uint32_t i;if(!e||!p)return;p->playing=(uint8_t)(play!=0);e->ended=0;for(i=0;i<HML_TRACKS;i++)e->next_note[i]=0;if(!play){for(i=0;i<HML_VOICES;i++)e->voices[i].active=0;e->active=0;}}
void hml_note_on(struct hml_engine*e,const struct hml_project*p,uint32_t tr,uint32_t pitch,float vel,float beats){uint32_t i,best=0;uint64_t old=~(uint64_t)0;struct hml_voice*v;if(!e||!p||tr>=p->track_count||pitch>127)return;for(i=0;i<HML_VOICES;i++){if(!e->voices[i].active){best=i;old=0;break;}if(e->voices[i].start<old){old=e->voices[i].start;best=i;}}v=&e->voices[best];if(!v->active)e->active++;v->active=1;v->instrument=p->tracks[tr].instrument;v->pitch=(uint8_t)pitch;v->track=(uint8_t)tr;v->phase=0;v->phase2=0;v->velocity=vel;v->env=0;v->pan=p->tracks[tr].pan;v->cutoff=p->tracks[tr].cutoff;v->sustain=v->instrument==HML_PAD?.78f:.38f;v->attack=v->instrument==HML_PAD?.28f:(v->instrument==HML_DRUMS?.001f:.012f);v->decay=v->instrument==HML_PAD?.45f:.22f;v->filter_state=0.0f;v->start=e->sample;v->stop=beats>0?e->sample+(uint64_t)(beats*60.0f/(float)p->bpm*(float)e->rate):~(uint64_t)0;v->release=~(uint64_t)0;}
void hml_note_off(struct hml_engine*e,uint32_t tr,uint32_t pitch){uint32_t i;if(!e)return;for(i=0;i<HML_VOICES;i++)if(e->voices[i].active&&e->voices[i].track==tr&&e->voices[i].pitch==pitch)e->voices[i].release=e->sample;}
static float osc(struct hml_voice*v,uint32_t ins,float f){float a; if(ins==HML_PIANO||ins==HML_RHODES){a=hbx_sinf(v->phase*6.28318530718f)*.7f+hbx_sinf(v->phase2*6.28318530718f)*.18f;}else if(ins==HML_CHIP)a=(v->phase<.5f?1.0f:-1.0f)*.5f;else if(ins==HML_DRUMS){a=hbx_sinf(v->phase*6.28318530718f);if(v->pitch==42||v->pitch==44||v->pitch==46){uint32_t q=(uint32_t)(v->start+v->phase*100000u);q^=q<<13;q^=q>>17;q^=q<<5;a=((float)(q&65535u)/32768.0f-1.0f)*.28f;}}else if(ins==HML_BASS)a=hbx_sinf(v->phase*6.28318530718f)*.78f+(v->phase<.5f?.16f:-.16f);else a=(v->phase<.5f? v->phase*4.0f-1.0f:3.0f-v->phase*4.0f)*.48f+hbx_sinf(v->phase2*6.28318530718f)*.2f;
    (void)f; return a;}
void hml_engine_render(struct hml_engine *e, const struct hml_project *p, int16_t *out, uint32_t frames, uint32_t channels) {
    uint32_t f, i, t; float peak = 0.0f, sumsq = 0.0f; int solo_mode = 0;
    if (!e || !p || !out || !channels) return;
    for (t=0;t<p->track_count&&t<HML_TRACKS;t++) if(p->tracks[t].solo) solo_mode=1;
    for (f = 0; f < frames; ++f) {
        float l = 0.0f, r = 0.0f, send_l=0.0f, send_r=0.0f, beat0 = 0.0f, beat1 = 0.0f;
        uint32_t total = p->bars * p->beats_per_bar;
        if (p->playing && !e->ended && total) {
            float absolute0 = (float)e->sample * (float)p->bpm / (60.0f * (float)e->rate);
            float absolute1 = (float)(e->sample + 1u) * (float)p->bpm / (60.0f * (float)e->rate);
            if (p->looping) {
                beat0 = absolute0 - hbx_floorf(absolute0 / (float)total) * (float)total;
                beat1 = absolute1 - hbx_floorf(absolute1 / (float)total) * (float)total;
                if (beat1 < beat0) {
                    for (t = 0; t < p->track_count; ++t) e->next_note[t] = 0;
                    for (i = 0; i < HML_VOICES; ++i) if (e->voices[i].active) e->voices[i].release = e->sample;
                    beat0 = -0.001f;
                }
            } else { beat0 = absolute0; beat1 = absolute1; }
            if (p->metronome && hbx_floorf(beat1) > hbx_floorf(beat0)) {
                uint32_t whole=(uint32_t)beat1;
                e->click_frequency=(whole%p->beats_per_bar)==0u?1000.0f:750.0f;
                e->click_remaining=e->rate/32u;
            }
            for (t = 0; t < p->track_count; ++t) {
                const struct hml_track *tr = &p->tracks[t];
                if (tr->muted || (solo_mode && !tr->solo)) continue;
                while (e->next_note[t] < tr->count && tr->notes[e->next_note[t]].beat <= beat1) {
                    const struct hml_note *n = &tr->notes[e->next_note[t]++];
                    if (n->beat >= beat0 - 0.002f) hml_note_on(e, p, t, n->pitch, (float)n->velocity / 127.0f, n->length);
                }
            }
            if (!p->looping && beat1 >= (float)total) {
                e->ended = 1;
                for (i = 0; i < HML_VOICES; ++i) if (e->voices[i].active) e->voices[i].release = e->sample;
            }
        }
        for (i = 0; i < HML_VOICES; ++i) {
            struct hml_voice *v = &e->voices[i]; float freq = 440.0f, env, raw, angle;
            if (!v->active) continue;
            if (e->sample >= v->stop && v->release == ~(uint64_t)0) v->release = e->sample;
            { float age=(float)(e->sample-v->start)/(float)e->rate;
              if(age<v->attack) env=age/(v->attack>0.0f?v->attack:0.001f);
              else if(age<v->attack+v->decay) env=1.0f-(1.0f-v->sustain)*(age-v->attack)/(v->decay>0.0f?v->decay:0.001f);
              else env=v->sustain; }
            if (v->release != ~(uint64_t)0) {
                float rel = (float)(e->sample - v->release) / (float)e->rate;
                float release_time=(v->instrument == HML_DRUMS ? 0.12f : (v->instrument==HML_PAD?1.2f:.28f));
                if (rel > release_time) { v->active = 0; if (e->active) --e->active; continue; }
                env *= 1.0f - rel / release_time;
            }
            { int d = (int)v->pitch - 69; while (d > 0) { freq *= 1.0594631f; --d; } while (d < 0) { freq *= 0.9438743f; ++d; } }
            if (v->instrument == HML_DRUMS && v->pitch <= 36) freq *= 1.0f + 2.0f * (1.0f - env);
            { const struct hml_track *tr=&p->tracks[v->track]; float alpha=v->cutoff/(v->cutoff+(float)e->rate*.159f); float source=osc(v,v->instrument,freq); if(alpha<.002f)alpha=.002f;if(alpha>.98f)alpha=.98f;v->filter_state+=alpha*(source-v->filter_state);raw=v->filter_state*v->velocity*env*tr->volume*.38f;raw=raw/(1.0f+hbx_fabsf(raw)*(tr->resonance*.025f)); }
            v->phase += freq / (float)e->rate; v->phase2 += freq * 2.01f / (float)e->rate;
            if (v->phase >= 1.0f) v->phase -= 1.0f;
            if (v->phase2 >= 1.0f) v->phase2 -= 1.0f;
            angle = (v->pan + 1.0f) * 0.78539816f;
            l += raw * hbx_cosf(angle); r += raw * hbx_sinf(angle);
            { const struct hml_track *tr=&p->tracks[v->track]; float send=tr->delay*.20f+tr->reverb*.08f; send_l+=raw*hbx_cosf(angle)*send; send_r+=raw*hbx_sinf(angle)*send; }
        }
        if (e->click_remaining) {
            float click=hbx_sinf(e->click_phase*6.28318530718f)*(float)e->click_remaining/(float)(e->rate/32u+1u)*.22f;
            l+=click;r+=click;e->click_phase+=e->click_frequency/(float)e->rate;if(e->click_phase>=1.0f)e->click_phase-=1.0f;--e->click_remaining;
        }
        { uint32_t delay_frames=e->rate/4u, read; float dl,dr; if(delay_frames>8191u)delay_frames=8191u;if(!delay_frames)delay_frames=1;read=(e->delay_pos+8192u-delay_frames)&8191u;dl=e->delay_l[read];dr=e->delay_r[read];e->delay_l[e->delay_pos]=send_l+dr*.36f;e->delay_r[e->delay_pos]=send_r+dl*.36f;l+=dl*.45f;r+=dr*.45f;e->delay_pos=(e->delay_pos+1u)&8191u; }
        l *= p->master; r *= p->master;
        l /= 1.0f + hbx_fabsf(l) * 0.65f; r /= 1.0f + hbx_fabsf(r) * 0.65f;
        if (l > 1.0f) l = 1.0f;
        if (l < -1.0f) l = -1.0f;
        if (r > 1.0f) r = 1.0f;
        if (r < -1.0f) r = -1.0f;
        if (hbx_fabsf(l) > peak) peak = hbx_fabsf(l);
        if (hbx_fabsf(r) > peak) peak = hbx_fabsf(r);
        sumsq += (l*l + r*r) * 0.5f;
        if (channels == 1) out[f] = (int16_t)(((l + r) * 0.5f) * 32760.0f);
        else { out[f*channels] = (int16_t)(l * 32760.0f); out[f*channels+1] = (int16_t)(r * 32760.0f); for (t=2;t<channels;t++) out[f*channels+t]=0; }
        ++e->sample;
    }
    e->peak = peak; e->rms = frames ? hbx_sqrtf(sumsq / (float)frames) : 0.0f;
}
