# Game Boy (GPU) for BrendanLauncher

Bundled shader-based DMG emulator for user-supplied Game Boy ROMs. CGB-compatible cartridges may run in monochrome DMG mode; the CGB color hardware is not implemented. Build with BrendanLauncher's SDK and a local ROM:

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

The current source and SPIR-V build are validated, but only a small prototype subset has been implemented. Shader compilation and ROM-header validation do not establish game compatibility; test titles on target hardware before relying on them.

## ROM validation and real support boundary

`build.cjs` checks the Nintendo logo, header checksum, declared ROM size, and CGB-only flag before packaging. It accepts ROM-only and MBC1 cartridges (up to 2 MiB); unsupported mapper types and CGB-exclusive titles are rejected instead of silently running with broken bank mapping. CGB-compatible titles are only attempted in DMG monochrome mode. The CGB color processor, CGB memory banking, timer/interrupt accuracy, APU/audio, and save/battery RAM are not complete. Passing validation is not a compatibility guarantee—test titles on the actual BrendanLauncher session before relying on them.

## Sound Rendering & APU Roadmap

Sound rendering for `gb2ns2` requires implementing a cycle-accurate Game Boy APU (Audio Processing Unit) emulator state machine within the GPU compute shaders (`app.comp`) and integrating PCM buffer streaming via the Switch OS audio output service (`game-audio.cjs`). 

- **APU Core:** Decodes registers `FF10–FF3F` (Square 1, Square 2, Wave, Noise, volume envelopes, and sweep units) per audio frame.
- **PCM Mixing & Streaming:** Synthesizes 48 kHz stereo PCM audio buffers and queues them via Horizon OS audio out (`AppendAudioOutBuffer`, `StartAudioOut`) through the host RPC bridge.
- **Milestone:** Full sound rendering and audio-visual synchronization are slated for Stage 4 of the compatibility roadmap, following CPU stability and PPU/CGB improvements.
