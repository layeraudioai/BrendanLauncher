# GB2NS2

Standalone HBLauncher GPU app for Game Boy-family emulation research. The build script expects the HBLauncher SDK at `../../sdk/build.cjs` and an input ROM:

```sh
node build.cjs path/to/game.gb
```

`node build.cjs --placeholder` creates an idle validation package, not a game. The app folder archive includes precompiled shaders and placeholder memory only; it is not a playable ROM bundle.

## Status and staged compatibility target

This is an early shader-only prototype, **not** a complete emulator. Current code has an incomplete SM83 CPU, simplified DMG-style rendering, rudimentary cartridge banking, no audio, and no validated save/battery handling. Do not treat the app title or ability to load a ROM as a claim of compatibility.

Planned stages toward GB / Pocket / SGB / GBC (GBA is out of scope):

1. Stabilize the DMG CPU, memory map, interrupts, timer, LCD timing, input, and MBC1/2/3/5; establish test ROM and regression coverage.
2. Implement CGB banking, attributes, palettes, DMA, speed switching, and CGB CPU behavior; verify against public test ROMs.
3. Add SGB command packets, borders, palettes, and multiplayer support where the GPU-app ABI permits it.
4. Complete audio, persistence, performance testing, and device validation before calling it broadly compatible.

The current build is only a packaging/branding milestone. Each later stage needs hardware-oracle testing on the target launcher; shader compilation alone does not establish emulator correctness.

## ROM converter checks added

`build.cjs` validates the Nintendo logo and header checksum, declared ROM size, DMG compatibility, and mapper/size limits before packaging. The accepted mapper types are ROM-only, MBC1, and MBC5; accepted ROMs are at most 2 MiB (128 banks). Unsupported mappers and CGB-exclusive images are rejected with a specific error. A successful conversion means only that the image passed these checks and was packaged—not that the game will run correctly without complete compute-shader mapper state handling.

## Sound Rendering & APU Roadmap

Sound rendering for `gb2ns2` requires implementing a cycle-accurate Game Boy APU (Audio Processing Unit) emulator state machine within the GPU compute shaders (`app.comp`) and integrating PCM buffer streaming via the Switch OS audio output service (`game-audio.cjs`). 

- **APU Core:** Decodes registers `FF10–FF3F` (Square 1, Square 2, Wave, Noise, volume envelopes, and sweep units) per audio frame.
- **PCM Mixing & Streaming:** Synthesizes 48 kHz stereo PCM audio buffers and queues them via Horizon OS audio out (`AppendAudioOutBuffer`, `StartAudioOut`) through the host RPC bridge.
- **Milestone:** Full sound rendering and audio-visual synchronization are slated for Stage 4 of the compatibility roadmap, following CPU stability and PPU/CGB improvements.
