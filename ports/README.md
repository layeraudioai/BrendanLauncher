# Integrated ports and companions

## Ozone/libnx-ounce NRO companion prototype

[`ozone-nro-launcher/`](ozone-nro-launcher/) is a separate userland NRO source
project. It enumerates top-level NROs on the SD card and requests a next-load
handoff only when the active compatible loader provides the libnx-ounce
`NextLoadPath` environment. It is not linked into the BrendanLauncher process,
does not run on the current SmileBASIC app ABI, and has not been built or tested
on Switch 2 hardware. Follow its README for the toolchain prerequisites and
explicit limits; this is not a CFW-less boot path by itself.

## Twilight Princess (Dusklight)

Twilight Princess is included as source at
[`twilight-princess/`](twilight-princess/). Its native ABI-3 package installs
into this checkout's `apps/twilight`, so it appears in BrendanLauncher's native
app library; the standalone HBLauncher is not needed.

### Build and install

Build prerequisites and detailed upstream/resource notes are in
[`twilight-princess/README.md`](twilight-princess/README.md). In addition to
those dependencies, configure the patched AArch64 musl toolchain and Dawn/SDL
source paths described there. From `ports/twilight-princess`:

```sh
# In an integrated checkout this defaults HBL_ROOT to the parent
# BrendanLauncher directory. Keep the following paths set for your local toolchain.
export HBXL_TOOLCHAIN=/path/to/patched-toolchain
export DAWN_SOURCE=/path/to/dawn
export SDL3_SOURCE=/path/to/SDL
python3 hblauncher/build.py build
python3 hblauncher/build.py install
```

`install` replaces only the shipped unbuilt `apps/twilight` placeholder, and
refuses to overwrite an already built or differently named app. To build
against a different ABI-3 SDK intentionally, set `HBL_ROOT` explicitly.

The build still requires a supported **GZ2E01 GameCube disc** supplied by you;
compressed RVZ/WIA images must be converted to ISO. Run the included file server
with your private file-server root as described in the port README. Neither a
disc image nor extracted game data is bundled. Hardware compatibility and
performance are experimental and not guaranteed.

### Clean source bundle behavior

The integrated source archive omits nested Git histories. Aurora integration
patch application therefore supports both a Git checkout and a source-only
bundle using `patch`; the patch is applied idempotently. The Aurora, Borealis,
and other upstream source notices remain in the port directory. External
Dawn/SDL/toolchain dependencies remain local build prerequisites and are not
vendored by BrendanLauncher.
