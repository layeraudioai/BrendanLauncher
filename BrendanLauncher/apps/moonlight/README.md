# Moonlight on BrendanLauncher — ABI 1 (GPU + sound, no CPU)

This directory ports Moonlight to BrendanLauncher's **ABI 1 "GPU app"** protocol —
the same format `BrendanLauncher/apps/media-machine` uses — for the `abi1-ns2jb`
target.

| | media-machine | this port |
| --- | --- | --- |
| Container | `hblauncher.gpu-app`, `abi: 1` | same |
| Console code | three shaders, no CPU image | same |
| Video | RGB565 frames written into the 8 MiB binding-0 buffer by the PC | same (double-buffered, tile-diffed) |
| Text | baked atlas + host-composed text band | same |
| Sound | `hbSound(id)` effects from `audio.effects` PCM files | same (ring of 6 slots + 2 UI sounds) |
| Local filesystem on the console | none | none |
| Data source | PC over the network | Sunshine host over the network, plus a bridge-side store |
| Host shim | `streamer.cjs` + `afterBatch()` | `streamer.cjs` / `host/runtime.cjs`, same hooks |

Everything Moonlight normally does on the CPU — pairing, app lists, RTSP, ENet
control, decoding, input forwarding — runs on the **PC** that runs Sunshine. The
Switch renders what it is handed: a video texture, a text bitmap, an item table
and a pad state. That is the only way an ABI 1 app can be a Moonlight client.

```
   Sunshine (PC)                    bridge (PC, Node)                 Switch 2 (GPU only)
 ┌───────────────┐   HTTPS   ┌──────────────────────────────┐      ┌──────────────────────┐
 │  /pair /applist│◄────────►│ protocol.cjs  (console code!) │      │ app.frag / app.comp  │
 │  /launch       │          │  ├ pairing  (node-forge)      │      │                      │
 │  RTSP 47998    │◄────────►│  ├ rtsp.cjs                   │      │ reads state buffer:  │
 │  video RTP     │─────────►│  ├ rtp.cjs → decoders (ffmpeg)│─────►│  1024x576 text band  │
 │  audio RTP     │─────────►│  ├ control.cjs (ENet + AES-GCM)│     │  32 item rectangles  │
 │  control 47999 │◄────────►│  └ session.cjs                │      │  2x 1280x720 RGB565  │
 └───────────────┘          │ bridge.cjs  (ABI 1 memory map) │      │  header + audio ring │
                            │  band · frames · audio ring    │      └──────────────────────┘
                            └──────────────────────────────┘                ▲
                                       PCM effect files (audio_3..8.pcm) ────┘
```

## Layout

```
brendanlauncher/
├── apps/moonlight/        the ABI 1 package (drop into BrendanLauncher/apps/)
│   ├── app.json           hblauncher.gpu-app, abi 1, audio effects, shaders
│   ├── layout.json        single source of truth for the 8 MiB memory map
│   ├── assets.py          bakes the label atlas, icon, state, PCM, host font pack
│   ├── build.cjs/.bat     assets → SPIR-V → sdk/build.cjs capsule
│   ├── check.cjs          structural + SPIR-V + layout checks
│   ├── shaders/           app.vert, app.frag, app.comp, generated text.glsl
│   ├── host/              the PC-side bridge (see PROTOCOL.md)
│   └── streamer.cjs       media-machine-compatible facade
├── PROTOCOL.md            exact ABI 1 memory map, header fields, commands
├── docs/launcher-integration.md   how to wire the bridge into app-runtime.cjs
└── tests/                 5 suites, no dependencies
```

## What is verified here, and what is not

Verified in this repository (run `node brendanlauncher/tests/run-all.cjs`):

* the shaders compile to SPIR-V (`app.frag`, `app.comp`, `app.vert`);
* the generated `text.glsl` constants match `layout.json` and `host/layout.cjs`;
* the full ABI 1 pipeline against an in-memory RPC stand-in: header publishing,
  band text, item table, double-buffered video slots with tile diffs, audio ring
  files, console pad forwarding, command/ack round-trips, pairing scene, clean
  shutdown (`tests/bridge.test.cjs`);
* H.264 (single NAL, STAP-A, FU-A) and HEVC (AP, FU) depacketisation, RTP
  header/CSRC handling and payload-type filtering;
* control-channel AES-GCM framing (V2 header, `CC`/`HC` IVs, replay rejection,
  tamper rejection) and the `NV_MULTI_CONTROLLER_PACKET` layout;
* ENet framing: `VERIFY_CONNECT` adoption, ACK emission, reliable payloads,
  fragmentation;
* the Ogg-Opus muxer: an FFmpeg-encoded Opus stream is re-muxed by
  `oggopus.cjs` and decoded back by FFmpeg.

**Not verified** (no Sunshine host or console was available while writing this):

* pairing/app-list/launch against a live Sunshine build — the code is the
  console app's own `app/src/protocol/*`, which is already exercised there;
* the RTSP `ANNOUNCE` SDP against Sunshine's parser;
* the AU/UDP behaviour on real hardware, and the batch cadence of the launcher;
* audio through `game-audio.cjs` with a live ring (see the caveat below);
* whether `rpc.write` throughput is enough for 720p60 on a LAN (see below).

Treat the Sunshine backend as the part that needs a hardware bring-up session.
The ABI 1 side is exercised by the tests above.

## Running it

```bash
# 1. build the package (same steps as media-machine)
cd brendanlauncher/apps/moonlight
node build.cjs            # or build.bat on Windows (needs Python + Pillow)
node check.cjs

# 2. copy it into a launcher checkout and package with the SDK
cp -r . /path/to/BrendanLauncher/BrendanLauncher/apps/moonlight
node build.cjs            # now sdk/build.cjs produces the lazily-loaded capsule

# 3. wire the bridge (once) - see docs/launcher-integration.md

# 4. tell the bridge where Sunshine is (default 127.0.0.1:47989, i.e. this PC)
set MOONLIGHT_HOSTS=192.168.1.10
set MOONLIGHT_BACKEND=sunshine      # or "demo" for a synthetic test pattern
```

`build.cjs` works outside a launcher checkout too: it then writes `app.*.spv`
next to the app and skips the capsule step.

## Controls

| Scene | A | B | X | Y |
| --- | --- | --- | --- | --- |
| Hosts | open host | exit app | refresh | pair (PIN shown on screen) |
| Games | start stream | back | refresh | — |
| Pairing | confirm (Sunshine accepted the PIN) | back | — | — |
| Streaming | forwarded to the PC | stop stream | forwarded | forwarded |

While streaming, the console sends its pad state to the bridge, which maps it to
a GameStream controller packet (`IDX_INPUT_DATA`) every 8 ms when it changes.
Face buttons, shoulders, triggers, sticks and the d-pad map 1:1; `Plus`/`Minus`
become `Start`/`Back`.

## The two honest caveats

**1. Audio latency, because ABI 1 audio is event based.** `game-audio.cjs`
flushes the current stream every time the compute shader calls `hbSound(id)`, so
continuous audio has to be sliced into `audio_3..8.pcm` chunks (120 ms each,
720 ms of ring). The console triggers the next slot from the header and the
bridge keeps the ring filled, which works, but every chunk boundary is a
stop/start on the console's audio path — expect clicks, not clean gapless audio.
The alternative — driving `AudioOut` directly from the host, the way the bundled
`stream-audio` service does for the PC-screen module — needs a launcher-side
service rather than a manifest effect, so it is out of scope for an app that must
stay a pure ABI 1 package. It is the right next step if the clicks matter.

**2. Bandwidth.** Each video frame is written into the console's buffer over the
launcher's RPC channel. `frames.cjs` only writes changed 20-row blocks and
coalesces neighbours (a static screen writes nothing), but full-motion 720p60 is
about 110 MB/s of writes. `MOONLIGHT_STREAM_SIZE` and the `video` block in
`layout.json` are there so you can drop to 960x540 or 854x480 if the channel
cannot keep up; the shader scales whatever it finds to 1920x1080.

## Licensing

The console protocol sources under `app/src/protocol` are the Moonlight-CivSwitch
project's own; node-forge is BSD-3-Clause (`app/vendor/forge-LICENSE`). This port
adds no third-party code. FFmpeg is used as an external process on the PC.
