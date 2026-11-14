# Twilight Princess for BrendanLauncher

Integrated Switch 2 port of [TwilitRealm/Dusklight](https://github.com/TwilitRealm/dusklight), based on the Twilight Princess decompilation. It builds an AArch64 game for BrendanLauncher’s Linux personality, using Aurora/Dawn/Vulkan and the bundled `nod-lite` GameCube ISO adapter.

Build and install from the BrendanLauncher checkout root:

```sh
python3 ports/twilight-princess/hblauncher/build.py build --jobs 8
python3 ports/twilight-princess/hblauncher/build.py install
```

The driver uses BrendanLauncher’s adjacent SDK and first checks the workspace’s shared `../tp-port/toolchain`. If that compiler is not present, an interactive build prompts for the AArch64 musl toolchain directory; non-interactive builds should set `HBXL_TOOLCHAIN` explicitly. This toolchain must use the BrendanLauncher `__hbx_syscall` musl hooks and BTI-compatible libraries; a generic cross-compiler is not sufficient. An optional `HBL_ROOT` override is intended only for maintainers testing against another compatible SDK. The build fetches pinned Dawn/SDL source dependencies locally when needed and does not bundle a compiler or copy compiler sources into BrendanLauncher.

Requirements include Python 3, Git, CMake, Ninja, FFmpeg-independent build tools, a patched AArch64 musl toolchain, and the source dependencies. Builds and console gameplay remain experimental; successful compilation is not a claim of verified console compatibility.

No game disc or commercial assets are included. `serve` prompts for your own supported GZ2E01 USA GameCube ISO if it is not already in the private server root, validates the disc ID, and stages the local `res/` resources. RVZ/WIA images must be converted to a plain ISO first. Keep your disc, server files, and saves private.

## Build

From the BrendanLauncher checkout root (the driver restores pinned dependencies as needed):

```sh
python3 ports/twilight-princess/hblauncher/build.py build --jobs 8
python3 ports/twilight-princess/hblauncher/build.py install
python3 ports/twilight-princess/hblauncher/build.py serve
```

The build driver uses the adjacent BrendanLauncher SDK and looks first for the
shared `../tp-port/toolchain` compiler used by `hbxl-build.py`. If it is not
there, an interactive build prompts for the AArch64 musl toolchain directory;
for CI set `HBXL_TOOLCHAIN=/path/to/toolchain` and pass `--no-disc-prompt` to
`serve`. On a first build it fetches the pinned Dawn/SDL source dependencies.
`DAWN_SOURCE` and `SDL3_SOURCE` can override those sources. No compiler,
third-party sources, disc image, or runtime media are downloaded into the
BrendanLauncher tree implicitly.

The build applies the included Aurora patch to the bundled Aurora source,
then builds the static game and dependencies using the BrendanLauncher Linux
personality linker script and runtime. Rerunning recognizes an already applied
patch; source-only downloads are supported without nested Git metadata.

You may set `DAWN_SOURCE` and `SDL3_SOURCE` to existing matching, patched source
trees. `build.py configure` only configures. Additional `-D...` arguments are
passed to CMake. The default code/data addresses are `0x30000000` / `0x38000000`.
Code mods and Opus are disabled in this configuration. This is the GameCube
port, not a Wii emulator.

## Install and run

The resulting app directory is `ports/twilight-princess/hblauncher/dist/twilight`.
Run the integrated installer to put it into BrendanLauncher:

```sh
python3 ports/twilight-princess/hblauncher/build.py install
```

Installation only replaces the known unbuilt Twilight placeholder; it refuses
to replace a different or already-built app. Only the manifest, code/data images,
and build report are installed; no commercial disc image is included. To package
an already-linked ELF without rebuilding, run
`python3 ports/twilight-princess/hblauncher/build.py pack --elf /path/to/dusklight.elf`.

Start the private file server with the optional prompt or an explicit ISO path:

```sh
python3 ports/twilight-princess/hblauncher/build.py serve
# Or, for CI / no interactive prompt:
python3 ports/twilight-princess/hblauncher/build.py serve --disc /path/to/GZ2E01.iso --no-disc-prompt
```

If the image is absent, `serve` asks for your own USA GZ2E01 ISO, checks its
six-byte disc ID, and copies it into the private `fsroot/tp/` directory. It also
stages the source `res/` assets and writes the preload environment file. The
server uses `10.42.0.1:39501`, the runtime default. Keep it running, establish a
verified BrendanLauncher session, and select **Twilight Princess**. The
file-server root also receives configuration and saves; keep it private and
back up saves. Read `README.upstream.md` for controls and required game assets.

## Source and credits

Upstream history and licensing are preserved. Read [LICENSE.md](LICENSE.md),
[the upstream README](README.upstream.md), and
[the integration notices](hblauncher/THIRD_PARTY.md). HBLauncher integration
additions use [MIT](hblauncher/LICENSE.integration). Original upstream CI is
disabled for this port branch; local build instructions above target HBLauncher.

## Source archive

`python3 hblauncher/package-source.py` writes a source-only archive under
`hblauncher/dist/`. Initialize submodules before packaging Twilight Princess.
The archive includes their source and the applied Aurora changes. It excludes
local dependencies, build output, discs, saves, and file-server data. Build the
app locally using the instructions above; generated app packages are ignored by Git.
