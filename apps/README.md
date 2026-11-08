# BrendanLauncher app library

The app library is unified at `apps/`. Packages retain the runtime they need, but
users install and launch them from the BrendanLauncher environment—there is no
requirement to install a separate HBLauncher or IZLauncher application.

| App / package | Package format | Runtime | Notes |
| --- | --- | --- | --- |
| `hello-cpu` | native ABI 3 | BrendanLauncher host | CPU/SDK example |
| `system-monitor` | native ABI 3 | BrendanLauncher host | Read-only timer reference and bounded CPU throughput trial; clock/temperature telemetry and controls are not exposed by the verified app ABI |
| `gpu-triangle` | native ABI 3 | BrendanLauncher host + Vulkan | GPU/SDK example |
| `gameboy-color` | `hblauncher.gpu-app` | integrated GPU app runtime | Experimental DMG-mode SM83/MBC1 core; CGB-compatible ROMs are monochrome only. CGB color hardware, audio, saves, and broad compatibility are not implemented. |
| `gb2ns2` | `hblauncher.gpu-app` | integrated GPU app runtime | Earlier experimental variant; use `gameboy-color` for the current build and validator. |
| `media-machine` | `hblauncher.gpu-app` | integrated GPU app runtime | Local media browser with host-side FFmpeg video streaming; audio is a short preview only under the current sound-event ABI. Populate `content/` and build locally. |
| `twilight` | native ABI 3 / Linux personality | BrendanLauncher host | Dusklight port; build from `ports/twilight-princess` and provide your own supported GZ2E01 ISO and file-server resources |
| `iz-exchange` | IZ module | integrated IZ exchange service | File transfer runtime is invoked by the integrated app launcher; source module is included |
| `blitbun`, `vacootube` | IZ modules/apps | integrated host-service/streaming runtime | Separate app folders carry signed module copies; require verified module installation and compatible host/platform |

Run `node scripts/link-integrated-apps.cjs` once after extracting the tree to register the three bundled IZ app packages in BrendanLauncher’s app library. The script only creates missing links; it refuses to replace user-created entries or links aimed elsewhere. The module sources and `.izm` archives ship alongside them, and the runtime verifies each module before loading its `module:` host implementation. A missing/corrupt provider returns safely to the app library rather than dispatching an unsupported app.

The IZ module host APIs are platform services (file exchange, video capture/streaming) executed by BrendanLauncher’s host runtime. The app render packages continue to use the shared GPU shaders in the unified catalog.

## CPU, GPU and memory modes

The app's package format determines its execution backend. Native ABI-3 apps
run as CPU code with the shared native Vulkan display; GPU-app packages run
through the shader/compute GPU runtime and may request private GPU storage in
RAM. The private storage limit is declared in `app.json` and validated by the
GPU app catalog. These are execution capabilities in the same launcher, not
separate CPU/GPU/RAM editions. A profile cannot make hardware or ABI features
available when the console does not provide them.

The original native library and GPU app catalog are separate runtime surfaces
because they use different ABIs. Both live under this repository and share the
same `apps/` install root. `homebrew-launcher/app-catalog.cjs` recognizes both
`hblauncher.gpu-app` and `izlauncher.app` package formats; `host/lib/packages.cjs`
loads native ABI-3 packages.

## Build/install

- Native SDK examples: follow [`../docs/SDK.md`](../docs/SDK.md).
- Game Boy Color and Media Machine: use each app's `README.md` / `build.cjs`;
  GPU apps must be built for the package ABI before being run on-console.
- Twilight Princess: see [`../ports/README.md`](../ports/README.md).

No commercial ROM, game disc, console key, personal save, or private media is
included or required to build the generic launcher. Compatibility is
experimental; validate each app on the specific target hardware/runtime.
