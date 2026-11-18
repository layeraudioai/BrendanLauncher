# ABI 1 memory protocol for the Moonlight GPU app

This is the contract between `apps/moonlight/shaders/*` (Switch) and
`apps/moonlight/host/*` (PC). It is the ABI 1 equivalent of what media-machine's
`streamer.cjs` does: a shader can only read/write the 8 MiB storage buffer that
is binding 0, so everything the app shows has to be published into that buffer.

Three files must never disagree — `layout.json` is the source of truth and both
consumers are generated/validated against it:

* `assets.py` → `shaders/text.glsl` (word offsets and header indices),
* `host/layout.cjs` (byte offsets, header indices, command ids),
* `tests/layout.test.cjs` fails the build if any of them drift.

## The buffer

| Absolute bytes | Size | Owner | Contents |
| --- | --- | --- | --- |
| `0..783` | 784 | SDK | ABI control block, `raw[4]` pad snapshot, motion |
| `784..1023` | 240 | app | ABI scratch (`game`, `piece`, `flow`, `bag*`, `rows`) |
| `1024..1049600` | 1 MiB | app | static label atlas, 1024×1024 `R8` |
| `1049600..1639424` | 576 KiB | host | text band, 1024×576 `R8` |
| `1639424..1640448` | 1 KiB | host+app | header block (below) |
| `2097152..3940352` | 1.75 MiB | host | video slot 0, 1280×720 `RGB565LE` |
| `3940352..5783552` | 1.75 MiB | host | video slot 1, 1280×720 `RGB565LE` |
| `8323072..8388607` | 1 MiB | SDK | service mailbox, telemetry, `HB_EXT` |

`layout.json` also records `buffer.bytes`, `buffer.appDataOffset` and
`buffer.sdkReservedOffset`; `host/layout.cjs` refuses to load if any region
overlaps SDK memory.

### Why a 1024×576 band

1920/1024 = 1080/576 = 1.875. The host draws text at screen coordinates divided
by 1.875, the fragment shader multiplies back. One 576 KiB bitmap therefore
covers the entire canvas, including glyphs the app could never rasterise itself
(host names, application titles, PINs, error strings).

### Video slots

`frames.cjs` writes into the slot that is *not* currently displayed, splitting
the picture into 36 blocks of 20 rows (51 200 bytes each), skipping unchanged
blocks and coalescing adjacent dirty ones. Only after the last write does it
publish `frameSlot`/`frameSeq`, so the shader can never sample a half-written
frame. The fragment shader reads the packed pixel with

```glsl
uint pixel = y * VIDEO_WIDTH + x;
uint word  = c.atlas[VIDEO_WORD + slot * VIDEO_STRIDE + (pixel >> 1)];
uint rgb   = (word >> ((pixel & 1u) * 16u)) & 0xffffu;
```

## Header block (1 KiB at 1639424)

Word indices; GLSL names in `text.glsl` are the same with an `H_` prefix.

| Word | Field | Direction | Meaning |
| --- | --- | --- | --- |
| 0 | `magic` | host | `0x4E4C424D` (`'MBLN'`) |
| 1 | `version` | host | layout version, currently `1` |
| 2 | `frameSeq` | host | incremented when a frame is fully written |
| 3 | `frameSlot` | host | 0/1, slot holding the newest frame |
| 4–5 | `videoWidth/videoHeight` | host | pixel size of a slot |
| 6 | `flags` | host | `1` video valid, `2` streaming, `4` busy |
| 7 | `bandSeq` | host | incremented on every band repaint |
| 8 | `scene` | host | `0` hosts, `1` games, `2` pair, `3` stream, `4` message |
| 9 | `status` | host | last command result (`0` ok, `1` error) |
| 10 | `items` | host | number of valid item rectangles (≤ 32) |
| 11 | `selected` | **app** | focused row, clamped by the app |
| 12 | `audioSeq` | host | incremented for each published PCM chunk |
| 13 | `audioSlot` | host | effect id carrying the newest chunk |
| 14 | `audioConsumed` | app | last `audioSeq` the app triggered |
| 16 | `hosts` | host | paired hosts in the list |
| 17 | `games` | host | applications in the list |
| 18 | `fps` | host | measured stream rate |
| 19 | `latency` | host | reserved |
| 24..183 | item table | host | 32 × `{x, y, w, h, flags}`, screen pixels |
| 192 | `cmd` | **app** | command id (see below) |
| 193–194 | `cmdArg0/cmdArg1` | **app** | arguments, usually a row index |
| 195 | `cmdSeq` | **app** | incremented for each command |
| 196 | `cmdAck` | host | last command seq the host finished |
| 197 | `cmdStatus` | host | `0` ok, `1` failed |

Commands (`CMD_*` in `text.glsl`, `CMD` in `host/layout.cjs`): `none 0`,
`pair 1`, `openHost 2`, `openGame 3`, `refresh 4`, `start 5`, `stop 6`, `quit 7`,
`back 8`, `retry 9`. The app writes `cmd`, `cmdArg0`, then bumps `cmdSeq`; the
host acknowledges by copying the seq into `cmdAck` plus a status. Because the app
never writes any other header field it cannot corrupt host state, and because the
host only ever acknowledges a sequence it has fully processed, a dropped frame or
restart can't replay a command.

## The app's responsibilities (all in `app.comp`)

* `scene`, `items`, `selected`: navigation over the item table, D-pad and
  left stick with repeat, `A` posts `openHost`/`start`, `B` posts `back` or
  `hbExit()`, `X` posts `refresh`, `Y` posts `pair`.
* streaming input is *not* consumed by the app; the host reads the ABI pad
  snapshot at bytes `0..63` (attributes at 32, buttons at 8, sticks at 16..31)
  and forwards it to Sunshine.
* audio: when `audioSeq > audioConsumed`, call `hbSound(audioSlot)`, store the
  new seq in `audioConsumed`, and let the launcher's game-audio stream that PCM
  file.
* UI sounds: `hbSound(1)` on navigation, `hbSound(2)` on errors.
* `hbExit()` when `B` is pressed in the hosts scene.

## Audio

`app.json` declares eight effects. `1` and `2` are fixed UI sounds baked by
`assets.py`; `3..8` are a six-slot ring (120 ms each at 48 kHz stereo s16le,
i.e. 23 040 bytes). `host/audio.cjs` writes each chunk to
`assets/audio_<slot>.pcm.tmp` and renames it into place, so `game-audio.cjs`
never reads a half-written file. The ring bounds latency at 720 ms and drops the
oldest audio rather than growing the queue.

Two constraints come from the launcher, not from this app:

1. `hbSound` stops the current stream before starting the next one, so chunk
   boundaries are audible. This is inherent to the effect-based audio path.
2. Effect ids are `1..31` and each gets a dedicated buffer at
   `base + 65536 + (kind - 1) * 131072`, which is why the ring is small.

## Integration with the launcher

Two hooks are all ABI 1 exposes to a host shim: it is created with
`{rpc, mapped, directory, app}` and may implement `afterBatch(state)` and
`close()`. The bridge additionally runs a 16 ms pump, because a live stream has
to keep pushing frames while the console is inside a batch — `afterBatch` alone
is only called on transitions. See `docs/launcher-integration.md`.
