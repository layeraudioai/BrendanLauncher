#ifndef HML_H
#define HML_H
#include <stdint.h>
#include "hbx_sdk.h"

#define HML_TRACKS 8u
#define HML_NOTES 96u
#define HML_VOICES 24u
#define HML_NAME 24u
#define HML_TITLE 40u
#define HML_SAVE_MAGIC 0x4c4d4848u /* HHML */
#define HML_VERSION 2u
#define HML_MAX_BPM 240u
#define HML_MIN_BPM 40u

enum hml_instrument { HML_PIANO, HML_RHODES, HML_LEAD, HML_BASS, HML_PAD, HML_CHIP, HML_DRUMS, HML_INS_COUNT };
enum hml_screen { HML_ARRANGE, HML_PIANO_ROLL, HML_MIXER, HML_VISION, HML_TOOLS, HML_SETTINGS, HML_SCREEN_COUNT };
struct hml_note { float beat, length; uint8_t pitch, velocity; uint16_t flags; };
struct hml_track {
    char name[HML_NAME];
    uint32_t color;
    uint8_t instrument, muted, solo, armed;
    float volume, pan, cutoff, resonance, delay, reverb;
    uint32_t count;
    struct hml_note notes[HML_NOTES];
};
struct hml_project {
    char title[HML_TITLE];
    uint32_t bpm, beats_per_bar, bars, track_count, selected_track;
    float master;
    uint8_t playing, looping, metronome, reserved;
    uint32_t theme;
    struct hml_track tracks[HML_TRACKS];
};
_Static_assert(sizeof(struct hml_project) == 9768, "save/project ABI size; update host extractor if this changes");
struct hml_voice {
    uint8_t active, instrument, pitch, track;
    float phase, phase2, velocity, env, pan, cutoff, sustain, attack, decay, filter_state;
    uint64_t start, stop, release;
};
struct hml_engine {
    uint32_t rate;
    uint64_t sample;
    uint32_t next_note[HML_TRACKS];
    struct hml_voice voices[HML_VOICES];
    uint32_t active;
    uint8_t ended;
    float peak, rms;
    uint32_t delay_pos, click_remaining;
    float click_phase, click_frequency;
    float delay_l[8192], delay_r[8192];
};
extern const char *const hml_screen_names[HML_SCREEN_COUNT];
extern const char *const hml_instrument_names[HML_INS_COUNT];
void hml_project_default(struct hml_project *p);
void hml_engine_init(struct hml_engine *e, uint32_t rate);
void hml_engine_play(struct hml_engine *e, struct hml_project *p, int play);
void hml_engine_render(struct hml_engine *e, const struct hml_project *p, int16_t *out, uint32_t frames, uint32_t channels);
void hml_note_on(struct hml_engine *e, const struct hml_project *p, uint32_t track, uint32_t pitch, float velocity, float beats);
void hml_note_off(struct hml_engine *e, uint32_t track, uint32_t pitch);
void hml_add_note(struct hml_project *p, uint32_t track, float beat, uint32_t pitch, uint32_t velocity, float length);
void hml_delete_note(struct hml_project *p, uint32_t track, float beat, uint32_t pitch);
uint32_t hml_midi_write(const struct hml_project *p, uint8_t *out, uint32_t cap);
int hml_midi_import(struct hml_project *p, const uint8_t *data, uint32_t size);
uint32_t hml_wav_header(uint8_t *out, uint32_t capacity, uint32_t frames, uint32_t channels, uint32_t rate);
#endif
