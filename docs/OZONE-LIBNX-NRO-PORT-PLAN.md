# Ozone / libnx-ounce NRO integration assessment

## What was inspected

The project sources checked were [alula/Ozone](https://github.com/alula/Ozone)
(commit `5e3c83a58883187f55ed44474f4ffd90127fe3bd`),
[alula/libnx-ounce](https://github.com/alula/libnx-ounce) (commit
`a04b88b3d3ed059963200d0a3d460754b2fe294e`), and the upstream
[nx-hbloader](https://github.com/switchbrew/nx-hbloader) source (commit
`82b95122c5ae8dc059bf23893ba7623c72c86773`). No Ozone, libnx, or hbloader
source has been copied into BrendanLauncher in this change.

- Ozone's README says the Ounce branch is not full Switch 2 CFW; its stated goal
  is to port selected Atmosphere replacements and libraries for the Ounce target.
- Ozone contains system-side `stratosphere/ro` NRO mapping code and system
  loader modules. These execute as privileged firmware services; they are not a
  userland `loadNro()` API that BrendanLauncher can call.
- libnx-ounce is an AArch64 homebrew userland library. Its `envSetNextLoad()`
  only fills a next-load path supplied by the current homebrew loader environment;
  it does not create a process, reboot the console, or provide a loader when that
  environment is absent.
- BrendanLauncher runs its own native ABI-3 and GPU app formats through a
  SmileBASIC-hosted RPC/Vulkan environment. That runtime has no Horizon process
  handle, HOS filesystem service, `ro` service, applet loader environment, or
  reboot-to-payload transport. Porting libnx alone would not add any of these.

## Recommended architecture

The least invasive eventual route is **not** to transplant Ozone into the
BrendanLauncher process. First, establish a supported NS2 boot environment that
can run libnx-ounce homebrew and provides a working NRO loader/chainload contract
(e.g. `envHasNextLoad()`/`envSetNextLoad()`); verify it on the actual console.
Then build a small, separate libnx-ounce forwarder NRO which receives a selected
NRO path, checks that the loader supports next-load, and requests a chainload.
BrendanLauncher now exposes an X-button informational panel about this boundary,
but it has no bridge to launch that forwarder. The panel is not an NRO boot
action; inspection remains read-only and NROs are not marked runnable.

For raw `.bin` reboot payloads, require a separately documented, hardware- and
firmware-specific reboot transport. Do not feed arbitrary `.bin` files to
SmileBASIC or map them as app code. The current project does not provide that
transport.

If Ozone's kernel/system modules ever need to be shipped, that is a separate
firmware integration project with boot-chain, module/signature, ABI and license
work—not a library dependency to link into this app. Do not copy or redistribute
Ozone code without following its GPL-2.0 terms and the upstream exceptions; keep
libnx-ounce notices for any future source port.

## Work included now

`tools/nro-inspect.cjs` is an independently written, read-only NRO container
bounds checker based on the public header layout in libnx-ounce's
`nx/include/switch/nro.h`. It validates the NRO header, three segment ranges,
build ID, and optional asset section bounds. The boot-file catalog uses it to
reject malformed `.nro` files. It does not relocate, import, map, or execute NRO
code.

`ports/ozone-nro-launcher/` contains a separate C companion prototype that scans
`SD:/switch/`, checks NRO header and segment bounds, and calls the libnx-ounce
next-load helper only when its environment says that handoff is supported. It
has not been built using Ounce toolchains or tested on console hardware. The
native launcher X panel documents these facts; it does not invoke or launch the
companion. A future action requires a tested, documented bridge from the
BrendanLauncher host/session to a compatible loader.
