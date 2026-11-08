# BrendanLauncher

![BrendanLauncher interface](assets/screenshots/hblauncher.png)

BrendanLauncher is the all-in-one AArch64 homebrew launcher and app SDK for
Nintendo Switch 2, combining the dark native launcher, CPU/GPU app runtimes,
IZLauncher modules, and the Twilight Princess port in one application library.
It retains the verified-session and ABI-3 foundations of HBLauncher/IZLauncher;
there is no separate HBLauncher install required for the integrated apps.
The launcher runs inside a SmileBASIC application process with an externally
established, verified 4/4 session. CPU code handles UI layout, animation, and
input; Vulkan draws the interface.

## All-in-one app library

BrendanLauncher keeps one installation root (`apps/`) while supporting the
existing package formats through their appropriate runtimes:

- **Native/CPU apps** (ABI 3), including the Twilight Princess port, are loaded
  by the BrendanLauncher host and shown in its dark native library.
- **GPU apps** (`hblauncher.gpu-app` / `izlauncher.app`), including the
  Game Boy Color experiment and Media Machine, are discovered by the GPU app
  catalog and use the shared Vulkan/GPU-memory path. IZLauncher modules remain
  available through the integrated module registry.
- CPU, GPU, and private RAM/GPU-storage use are capabilities of the same
  launcher, not separately branded launcher editions. The available resources
  still depend on the console, runtime ABI, and app package requirements.

See [`apps/README.md`](apps/README.md) for the merged library. Run
`node scripts/link-integrated-apps.cjs` once to register the bundled IZ apps,
then use [`ports/README.md`](ports/README.md) to build/install Twilight Princess.
Twilight requires your own supported GZ2E01 disc image; the file-server runner
prompts for it when needed. No commercial game disc or extracted assets are bundled.

The platform also includes a native package loader, versioned SDK ABI,
freestanding runtime, shared Vulkan display, and mock/offline preview. Original
Hello CPU and GPU Triangle apps remain as development examples.

## One-click AIO Windows build

Run [`build-aio.bat`](BUILD-AIO-WINDOWS.md) from this project folder to rebuild
the native CPU launcher/apps, bundled GPU/IZ packages, and integrated IZ module
archives, then start the BrendanLauncher host server. The script fails closed
instead of starting the server after a partial build. See the guide for
required Windows toolchains and exact scope.

## TypeScript / web apps

The AIO build compiles TypeScript/HTML/CSS sources and runs WebPort for apps
that opt in. `node tools/build-webapps.cjs hello-vite` builds Vite assets;
`node tools/port-webapp.cjs hello-vite` generates and compiles the native ABI-3
package `apps/hello-vite-native`, which appears in BrendanLauncher's Switch app
library. The panel's **Web apps** view has a **Build Switch app** action. WebPort
v1 translates a deliberately limited HTML/CSS subset and explicitly declared
native actions to the ABI-3 UI/input API; it does not execute arbitrary browser
JavaScript or provide a DOM/browser engine. Unsupported features must be
implemented as native adapters. See [docs/WEB-APPS.md](docs/WEB-APPS.md) for
supported markup, actions, and build instructions. Existing Node server apps
remain host-side and are not sandboxed.

## NRO companion and CFW-less scope

The native launcher now has an **NRO companion information panel** (press X in
the library; A/B returns). It describes the separate companion, its SD path and
loader requirements, and the important limitation that NRO execution is not
provided by BrendanLauncher's native/GPU runtime. A read-only
[boot-file catalog](docs/BOOT-FILE-CATALOG.md) inventories user `.bin` payloads
and `.nro` files. The [separate NRO companion](ports/ozone-nro-launcher/README.md)
is a source prototype that can ask a compatible existing homebrew loader to
chainload a NRO from SD. It is not a BrendanLauncher app package and cannot run
inside the SmileBASIC/GPU runtime. It requires libnx-ounce and a loader that
provides `NextLoadPath`; neither the build nor that loader environment is bundled
or hardware-verified here.

**BrendanLauncher is not currently a self-contained, verified CFW-less Switch 2
NRO launcher.** It does not install or boot custom firmware, does not provide an
NRO process loader, and cannot chainload from its current native/GPU app menu.
It can launch its existing supported ABI-3/GPU app packages in the externally
established session described below. Ozone is an experimental firmware-side
project, not a drop-in userland dependency. See the [port assessment](docs/OZONE-LIBNX-NRO-PORT-PLAN.md)
for the boundary and prerequisites.

## NRO donor profiles (staging only)

`nro-profile-manager.cmd` safely archives user-provided donor/payload NROs,
verifies their hashes, and can restore a donor copy to a new path. It does **not**
patch titles or boot NROs: the project has no supported Horizon NRO runtime or
R-button title hook. See [NRO profile manager](docs/NRO-PROFILE-MANAGER.md).

## System Monitor and NRO compatibility

`apps/system-monitor/` is a read-only diagnostic app with a bounded CPU
throughput trial. It does not report fabricated per-core/per-chip MHz or
unavailable temperatures, and it does not change clock/voltage settings. The
current native app ABI has no verified per-core CPU, per-chip RAM, panel
refresh, or thermal sensor/control API. See the app README for scope and build
instructions.

The current BrendanLauncher app ABI also does not load Switch `.nro` binaries.
An NRO launcher needs a separate compatible executable loader/runtime plus
permissions and memory/entrypoint handling that the SDK does not provide. A PC
server can deliver files but cannot make NRO code executable by itself, and the
current SD browser is host-side/read-only, not an on-console filesystem API.
BrendanLauncher's native/GPU app menu therefore does not offer NRO launching
from SD or server, and does not replace a commercial game's ExeFS or bootstrap.
The separate companion described above can request an SD chainload only from an
already-running compatible homebrew loader; that is a distinct, unverified
runtime path. Existing native ABI-3 and `hblauncher.gpu-app` packages remain the
supported formats for BrendanLauncher's own runtime.

## Bundled desktop companion

The complete [Super File Bros.](tools/super-file-bros/README.md) source is
bundled at `tools/super-file-bros/` with its own GPL-2.0-only license and safety
notice. BrendanLauncher now includes a separate **mac2jb-style, read-only SD
browser adapter** at `host/sd-browser.cjs` and `tools/mac2jb-sd-browser/`.
Start it with `./hbl-sd-browser --host <Switch-IPv4>` while a verified, held
ns2jb FS-RPC session is active. It checks the session proof, displays the SD
filesystem in a local browser, and offers read-only FTP. It is a desktop-host
tool, not an app running on the Switch; no write, rename, or delete access is
exposed. See [`tools/mac2jb-sd-browser/README.md`](tools/mac2jb-sd-browser/README.md)
for setup and safety details, and [`tools/SUPER-FILE-BROS.md`](tools/SUPER-FILE-BROS.md)
for provenance and license separation.

## Features

- App catalog with controller navigation, animated transitions, and return to launcher.
- Native package loader and a versioned SDK ABI.
- Freestanding runtime with input, touch, timing, heap, logging, and package assets.
- Shared Vulkan display and a small 2D UI library, plus a raw Vulkan example.
- CPU, GPU-app, private GPU-memory and IZLauncher module support.
- Original Hello CPU and GPU Triangle demo apps.
- Mock console backend and an offline Vulkan preview for development.

Game ports, commercial assets, media, console keys, and compiled game payloads
are excluded from source releases. Build or install permitted app packages from
source and supply your own legally obtained content.

## Game ports

Twilight Princess is integrated under [`ports/twilight-princess/`](ports/twilight-princess/)
and installs into this launcher's `apps/twilight` library entry. Other ports
can use the same ABI-3 app contract; see the upstream compatibility notes.

Set up BrendanLauncher using [Getting started](docs/GETTING_STARTED.md), then
follow the port guide for build, installation, and file-server instructions.
The game requires your own supported disc image.

## Build


Use Linux with Node.js 18+, Python 3 with Pillow, GCC, the AArch64 GNU
compiler/binutils, glslang, SPIR-V Tools, and DejaVu fonts. The offline tests
also need QEMU user emulation and a Vulkan implementation such as Mesa lavapipe.
On Debian/Ubuntu, the dependency packages are:

```sh
sudo apt install nodejs python3 python3-pil gcc gcc-aarch64-linux-gnu \
  binutils-aarch64-linux-gnu glslang-tools spirv-tools fonts-dejavu-core \
  qemu-user libvulkan1 mesa-vulkan-drivers
```

From the repository root:

```sh
sh tools/build-all.sh
sh tests/run.sh
./hbl-start --mock
```

If Node is installed outside `PATH`, set `HBL_NODE` to its executable path.
The build regenerates the font atlas, shader blobs, and ABI metadata, then
builds the launcher, apps, hardware probe, SDK example, and offline preview.
Generated binaries and local state are ignored by Git.

To render preview frames after building:

```sh
./build/preview/hbl-preview tests/preview/out 6
```

The preview uses a synthetic catalog. Tests default to the lavapipe ICD at
`/usr/share/vulkan/icd.d/lvp_icd.json`; set `VK_ICD_FILENAMES` if your system
uses a different path.

## Console setup

Provide a separate `ns2jb-kurumuz` checkout and establish the required session.
The launcher requires verified 4/4 before mapping native code.

```sh
export HBL_NS2JB=/path/to/ns2jb-kurumuz
./hbl-start --preflight
./hbl-start
```

See [Getting started](docs/GETTING_STARTED.md) and [Recovery](docs/RECOVERY.md)
for session setup and diagnostics. `--spawn --guide` additionally requires the
external controller tooling described there.

| Variable | Purpose |
| --- | --- |
| `HBL_NODE` | Node executable |
| `HBL_NS2JB` | External session runner checkout |
| `HBL_APPS` | Alternate app package directory |
| `HBL_RPC_TARGET` | Console RPC address |
| `HBL_PICO_TOOL` | External controller tool for guided setup |
| `HBL_COMPAT_ROOT` | Optional external legacy compatibility projects |

## Develop an app

```sh
python3 sdk/tools/hbx-new.py apps/my-app "My App"
python3 sdk/tools/hbx-build.py apps/my-app
```

Read the [SDK guide](docs/SDK.md), [SDK reference](sdk/README.md), and
[raw Vulkan example](sdk/examples/raw-vulkan/). The optional
[Linux personality runtime](sdk/linux/README.md) requires a separately
configured musl toolchain and is not built by the default build.

## Source layout

| Directory | Contents |
| --- | --- |
| `launcher/` | Native launcher, navigation, and Vulkan UI |
| `host/` | Session management, package loading, and app lifecycle |
| `sdk/` | ABI headers, runtime, templates, examples, and build tools |
| `apps/` | Native SDK apps, GPU apps, integrations, and app sources |
| `assets/` | Font atlas and font license notice |
| `docs/` | Architecture, SDK, setup, and recovery guides |
| `tests/` | ABI, mock lifecycle, navigation, and rendering checks |
| `tools/` | Asset generators and development utilities |

## Source release

Run `python3 tools/package-release.py` to create
`release/hblauncher-native-source.tar.gz` from the current source tree.
It excludes Git history, build products, local settings, and user app assets,
and checks the included files for private workstation identifiers.
Use this archive for a fresh public repository; the existing local Git history
still contains earlier versions and is not sanitized by deleting working files.

## License

[MIT](LICENSE), copyright RavensClawX and contributors. The font atlas retains
its separate [third-party notice](THIRD_PARTY.md). This independent project is
not affiliated with or endorsed by Nintendo.
