# One-click Windows AIO build and server

Run `build-aio.bat` from this project folder. It builds first and starts
`server.cjs` only if the build and catalog checks succeed. Keep the console
window open while using the launcher; Ctrl+C stops the server.

## Required tools

Install these first and ensure their executable directories are on `PATH`:

- Node.js 22 or later.
- Python 3 and Pillow (`python -m pip install Pillow`).
- Git for Windows (Git Bash) or MSYS2 Bash.
- AArch64 cross compiler plus binutils: `aarch64-none-elf-gcc` (DevkitA64) or
  the `aarch64-linux-gnu-*` family.
- `glslangValidator` and `spirv-val` for GPU app shader builds.
- DejaVu Sans fonts (including Sans Mono) or Windows Arial/Consolas fallback
  fonts; build generators use `HB_FONT_DIR`/`HB_FONT` when set.

The script stops on build errors and does not start a partial session. It
rebuilds the CPU launcher, the native ABI-3 app packages, bundled GPU ABI-1
apps (including IZ File Exchange), rebuilds both IZlauncher and IZPSlauncher
shell packages, regenerates IZ module archives from bundled sources, creates
integrated app links, then verifies the package catalogs. Bundled IZ module
archives and shell packages are rebuilt, but their host-side runtime descriptors
currently target Linux x64/ARM64; native Windows may list packages without
being able to run those Linux-only services. Use a supported Linux host for
complete IZ module-service execution.
The Game Boy build uses a blank placeholder ROM; no commercial ROM or BIOS is
bundled. Add your own supported game data separately.

The script does not install a console exploit, custom firmware, or firmware;
it only builds and starts the host server. The console must already be in a
supported session state for this project. Twilight Princess needs its own port
toolchain and user-provided game data, so it is not built here.

## Scope and Switch 2 homebrew status

This build targets the formats already implemented by BrendanLauncher: native
ABI-3 CPU apps and the GPU/IZ app package ABI. It does **not** make arbitrary
Switch `.nro` files launchable, and a displayed Sphaira-style package does not
by itself prove that an NRO execution ABI is present. The AIO server is not an
NRO loader and does not patch commercial game files.

The linked [Ozone](https://github.com/alula/Ozone) repository explicitly says
its Ounce branch is not full Switch 2 CFW; it ports parts of Atmosphere and
requires [libnx-ounce](https://github.com/alula/libnx-ounce), an AArch64 userland
library. Those projects are useful for platform/homebrew development, but are
separate from compiling these BrendanLauncher packages. This batch file does
not clone, build, install, or boot Ozone or libnx-ounce.

## Troubleshooting

- If `python` points to another interpreter, install Pillow into that same
  interpreter or set `PYTHON` before running the batch file.
- For an alternative font directory, set `HB_FONT_DIR` to a folder containing
  `DejaVuSans.ttf`, `DejaVuSans-Bold.ttf`, `DejaVuSans-Oblique.ttf`,
  `DejaVuSans-BoldOblique.ttf`, and `DejaVuSansMono.ttf`.
- A failed cross compiler or shader validator is a build failure; install the
  named tool rather than bypassing the check.
- To see the build steps without running them, use `node tools/build-aio.cjs --plan`.
