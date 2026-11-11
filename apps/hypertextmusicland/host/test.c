#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <math.h>
#include "hml.h"
static int failures,checks;
#define CHECK(x,msg) do{checks++;if(!(x)){fprintf(stderr,"FAIL: %s\n",msg);failures++;}else printf("ok: %s\n",msg);}while(0)
int main(void){struct hml_project p,q;struct hml_engine e;int16_t pcm[48000*2];uint8_t midi[256*1024],wav[64];uint32_t n,i,nz=0;double rms=0;hml_project_default(&p);CHECK(p.track_count==5,"default project has 5 tracks");CHECK(p.tracks[4].count>=48,"seeded drums and hats");hml_engine_init(&e,48000);p.playing=1;hml_engine_render(&e,&p,pcm,48000,2);for(i=0;i<96000;i++){if(pcm[i])nz++;rms+=(double)pcm[i]*pcm[i];}rms=sqrt(rms/96000.0)/32768.0;CHECK(nz>2000,"render contains audio signal");CHECK(rms>.005&&rms<.8,"render RMS is sane");n=hml_midi_write(&p,midi,sizeof(midi));CHECK(n>64&&midi[0]=='M'&&midi[1]=='T'&&midi[2]=='h'&&midi[3]=='d',"MIDI format 1 export");hml_project_default(&q);q.track_count=0;CHECK(hml_midi_import(&q,midi,n),"MIDI import round-trip");CHECK(q.track_count>=4,"MIDI import restores tracks");CHECK(hml_wav_header(wav,sizeof(wav),2,2,48000)==44,"WAV header writer");CHECK(wav[0]=='R'&&wav[8]=='W'&&wav[40]==8,"WAV RIFF structure");printf("%d checks, %d failures; size project=%zu\n",checks,failures,sizeof(p));return failures?1:0;}
