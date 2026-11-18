# Wiring the Moonlight bridge into the launcher

Moonlight needs a host-side shim, exactly like media-machine. The launcher
already has the plumbing: `homebrew-launcher/app-runtime.cjs` creates a GPU app's
shim with `{rpc, mapped, directory, app}` and calls `afterBatch(state)` between
GPU batches, then `close()` when the app is left. media-machine is wired in by a
hard-coded branch; the snippet below makes that generic so Moonlight (or any app
that ships a `host/runtime.cjs`) works without a second special case.

## 1. Copy the app in

```
BrendanLauncher/
  apps/
    moonlight/          <- brendanlauncher/apps/moonlight from this repo
```

Then build it inside the checkout (`node build.cjs`), which picks up
`sdk/build.cjs` and packages the capsule, exactly like media-machine.

## 2. Teach `app-runtime.cjs` about host bridges

In `BrendanLauncher/homebrew-launcher/app-runtime.cjs`, where the runtime builds
its service, replace the app-specific special case with a lookup:

```js
// before (media-machine only)
const bridges = {
  'media-machine': () => require('../../apps/media-machine/streamer.cjs').MediaMachineStreamer,
};

// after (any app that ships host/runtime.cjs)
function resolveBridge(app) {
  if (app && app.id === 'media-machine') {
    return require('../../apps/media-machine/streamer.cjs').MediaMachineStreamer;
  }
  const fs = require('node:fs');
  const path = require('node:path');
  const candidate = path.join(__dirname, '..', 'apps', app.id, 'host', 'runtime.cjs');
  if (fs.existsSync(candidate)) return candidate;
  return null;
}
```

and where the current media-machine branch constructs its streamer, construct the
bridge generically:

```js
const bridgeModule = resolveBridge(app);
let appHost = null;
if (bridgeModule) {
  const factory = typeof bridgeModule === 'string' ? require(bridgeModule) : bridgeModule;
  appHost = await factory.create({ rpc, mapped, directory, app });
}
```

`afterBatch` stays the same:

```js
if (appHost) await appHost.afterBatch(state);
```

and on leaving the app:

```js
if (appHost) await appHost.close();
```

If you would rather not patch the launcher, `apps/moonlight/streamer.cjs` exports
`MoonlightStreamer`, which has media-machine's shape (`init()`, `afterBatch()`,
`close()`), so the existing media-machine branch can point at it:

```js
if (app && app.id === 'moonlight') {
  const { MoonlightStreamer } = require('../../apps/moonlight/streamer.cjs');
  appHost = await new MoonlightStreamer().init({ rpc, mapped, directory, app });
}
```

## 3. Configure the bridge

Environment variables read by `host/backends/sunshine.cjs` and `host/store.cjs`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `MOONLIGHT_HOSTS` | `127.0.0.1` | comma-separated Sunshine hosts (`ip` or `ip:port`) |
| `MOONLIGHT_BACKEND` | `sunshine` | `sunshine`, or `demo` for the synthetic test pattern |
| `MOONLIGHT_DATA` | `<app directory>/moonlight` | where the pairing identity and paired hosts live |
| `MOONLIGHT_SOURCE_ROOT` | repo root | where `app/src/protocol/*` is loaded from |
| `FFMPEG` | `ffmpeg` | FFmpeg binary used for H.264/HEVC/Opus decoding |

The identity file holds the client certificate and private key (mode `0600`);
host files hold the pinned Sunshine certificate. Both live on the PC because an
ABI 1 app has no writable filesystem.

## 4. Pairing

1. On the console: hosts screen → `Y`. The bridge asks Sunshine for a PIN and
   shows it in the text band.
2. In Sunshine's web UI (`https://<pc>:47990`) → *PIN* → enter it.
3. Back on the console: `A`. The bridge completes the challenge exchange, pins
   the certificate and writes `hosts/<key>.json`.
4. `X` refreshes the list; `A` on a host lists its applications.

The pairing and app-list code is the console app's own
`app/src/protocol/sunshine-pairing.js` / `sunshine-apps.js` /
`sunshine-session.js`, executed in a VM context with Node HTTPS adapters
(`host/moonlight/protocol.cjs`). Nothing about the cryptography was re-derived.

## 5. Bring-up checklist for a real host

Things to check first on hardware, in order:

1. `MOONLIGHT_BACKEND=demo` — proves the ABI 1 path (video, band, audio ring,
   input, commands) without Sunshine.
2. Pairing — if it fails, the error message comes from the console code, so it
   usually names the step (`getservercert`, `clientchallenge`, …).
3. App list — a successful list means HTTPS + pinned certificate are correct.
4. Launch + RTSP — watch the bridge log for the negotiated control port and
   `connectData`; if `ANNOUNCE` is rejected, the SDP in `rtsp.cjs` is the file to
   adjust.
5. Video — if frames never appear, check the FFmpeg child process and whether
   payloads are arriving (`session.cjs` counts packets); Sunshine must be sending
   H.264/HEVC RTP with payload type 96 and no payload encryption (this bridge
   deliberately does not announce `a=encryption`).
6. Audio — Opus, re-muxed to Ogg in `oggopus.cjs`. If it errors, run the same
   packets through `ffmpeg -f ogg`.
7. Input — `session.cjs` maps the pad snapshot; the GameStream bit values are in
   `control.cjs` (`BUTTON`).

## 6. Optional: continuous audio

The manifest-effect ring is honest but clicks at chunk boundaries. If you want
clean audio, the launcher's existing `core/services/stream-audio.cjs` (the
PC-screen module's `AudioOut` path) can be used instead: it has `rpc` access and
can submit PCM buffers directly. That requires a launcher-side service instead of
`hbSound`, so it is intentionally not part of this app package; wire it in
`bridge.cjs` where `AudioRing.push()` is called.
