# HyperText Music Land — NS2 / HBLauncher native app

A native C11 reimplementation of the HyperTextMusicLand browser DAW for the HBLauncher ABI v3 runtime. This is an app package under `brendan/apps/hypertextmusicland/`; it does not replace or change the original Electron/Vite application at the repository root.

## Current port contents

- Six launcher-rendered views: Arrangement, Piano Roll, Mixer, Vision Flow, Tools and Settings.
- Default AuraVision demo project: five tracks, seeded bass/lead/pad/Rhodes/808 patterns.
- Freestanding software synthesizer with polyphonic voices, ADSR release, stereo pan, soft master limiting and sample-accurate beat scheduling. It uses the host-resolved `nn::audio::AudioOut` ABI when supplied; otherwise a silent preview clock keeps editing and visuals responsive.
- Controller and touchscreen interaction via `hbx_input_poll` / `hbx_touch_hit`.
- Project save/restore through the HBLauncher save block.
- MIDI format-1 export and MIDI package-asset import; PCM16 WAV bounce to the save block.
- Vision screen with animated spectrum-like bands, beat rings and deterministic particles.
- Standalone host smoke tests for project seeding, rendered signal, MIDI round-trip and WAV headers.

This is a fresh reimplementation based on the prior port specification. It is intentionally compact and does not claim feature parity with every browser modal/service (Gemini/LayAI, stem separation, arbitrary SF2 loading, or full WebAudio effects). Hardware audio and touchscreen behavior still require verification on the target console/runtime.

## Build

From the HBLauncher checkout:

```sh
python3 sdk/tools/hbx-build.py /path/to/hypertextmusicland/brendan/apps/hypertextmusicland
```

Or in this folder:

```sh
make -C host test
make -C host console HBX=/path/to/HBLauncher
```

The package manifest requests ABI 3, 4 MiB heap, 1 MiB stack, 1 MiB persistent save, and a finite-entry frame budget. Generated files are under `build/` and should be rebuilt with the SDK tool before launch.

## Controls

| Input | Action |
|---|---|
| L / R | Previous / next screen |
| D-pad | Move pitch/beat cursor or select track/tool |
| A | Add note / activate tool / toggle mixer mute |
| B | Delete selected piano-roll note; back from subviews |
| X | Cycle selected track instrument |
| Y | Play/pause (Y on Tools also runs SonicRNG) |
| ZL / ZR | Decrease / increase tempo |
| + | Return to launcher |
| Touch | Navigate tabs, operate transport, select/add piano-roll notes, adjust mixer |

In the Tools screen, use Up/Down and A: export MIDI, render a four-second WAV, import a `.mid` package asset, or roll a seeded patch/glitch fill. Export bytes are appended to the app's save block; the host save file is `saves/hypertextmusicland.sav` in the HBLauncher runtime's saves directory.
