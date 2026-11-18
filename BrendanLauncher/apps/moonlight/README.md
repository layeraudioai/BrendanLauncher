# Moonlight — ABI 1 GPU app

A Moonlight client for BrendanLauncher's `hblauncher.gpu-app` ABI 1 target
(`abi1-ns2jb`): the Switch only renders, the PC does the protocol work. Same
package shape and hooks as `apps/media-machine`.

```
app.json        hblauncher.gpu-app, abi 1, 8 audio effects, 3 shaders
layout.json     the 8 MiB memory map (single source of truth)
assets.py       bakes atlas, band, video slots, PCM, icon, state, font pack
build.cjs/.bat  assets -> SPIR-V -> sdk/build.cjs capsule
check.cjs       structural checks (run after every build)
shaders/        app.vert, app.frag (UI + video), app.comp (input + commands)
host/           PC-side bridge: protocol, RTSP, RTP, decoders, band, audio
streamer.cjs    media-machine-shaped facade for the launcher runtime
```

## Build

```bash
python -m pip install pillow           # only dependency for the assets
node build.cjs                         # or build.bat on Windows
node check.cjs
```

Inside a launcher checkout this also produces the capsule through
`sdk/build.cjs`; standalone it writes `app.vert.spv`, `app.frag.spv`,
`app.comp.spv` next to the app and stops there.

## What the console does

* `app.frag` draws one fullscreen triangle: the text band (1 bit per source
  pixel, atlas lookup, 1.875× scale), the item rectangles with selection
  highlight, and the video texture from whichever slot the header names.
* `app.comp` runs once per submission: pad navigation with repeat, `A`/`B`/`X`/`Y`
  commands, and audio ring triggers.
* Nothing else. There is no CPU image, no filesystem access and no network code
  on the console.

## What the PC does

`host/bridge.cjs` owns the ABI 1 memory map and pumps it:

| host module | responsibility |
| --- | --- |
| `band.cjs` / `font.cjs` | draw UTF-8 text into the 1024×576 band |
| `frames.cjs` | RGB565 conversion, tile diffing, double-buffered publish |
| `audio.cjs` | slice PCM into 20 ms chunks, paced by the launcher's `events.z` ack |
| `header.cjs` | publish counters/items, handshake `cmdSeq` → `cmdAck` |
| `moonlight/protocol.cjs` | run `app/src/protocol/*.js` in a Node VM |
| `moonlight/rtsp.cjs` | RTSP `OPTIONS/DESCRIBE/SETUP/ANNOUNCE/PLAY` |
| `moonlight/rtp.cjs` | RTP + H.264/HEVC/Opus depacketisation |
| `moonlight/decoders.cjs` | FFmpeg children (Annex-B → RGB frames, Ogg-Opus → PCM) |
| `moonlight/control.cjs` | ENet + AES-GCM control stream, input packets |
| `moonlight/session.cjs` | ties launch → RTSP → RTP → decoders → bridge together |
| `backends/sunshine.cjs` | real hosts; `backends/demo.cjs` for a test pattern |

## Scenes

```
hosts ──A──► games ──A──► stream
  │  └─Y─► pair ──A──► hosts
  └──B──► hbExit()
```

`B` in `games` returns to `hosts`; `B` while streaming stops the stream and
returns to `games`. Errors land in the `message` scene with `A` to retry and `B`
to go back.

## Configuration

`MOONLIGHT_HOSTS`, `MOONLIGHT_BACKEND` (`sunshine`|`demo`), `MOONLIGHT_DATA`,
`MOONLIGHT_SOURCE_ROOT`, `FFMPEG`. See the integration guide for details.

## Tests

From `brendanlauncher/`:

```bash
node tests/run-all.cjs        # layout, audio, rtp, control, bridge, oggopus
```

`tests/bridge.test.cjs` drives the whole ABI 1 pipeline with an in-memory RPC
stand-in, so a change to the memory map breaks a test rather than the console.
