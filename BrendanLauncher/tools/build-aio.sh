#!/usr/bin/env bash
# Rebuild all source targets shipped in this AIO tree before server startup.
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON=${PYTHON:-python3}
NODE=${NODE:-node}
DEVKITPRO_DIR=${DEVKITPRO:-}
if [ -n "$DEVKITPRO_DIR" ] && command -v cygpath >/dev/null; then
  DEVKITPRO_DIR=$(cygpath -u "$DEVKITPRO_DIR")
fi

command -v "$PYTHON" >/dev/null || { echo "Missing Python 3 executable: $PYTHON" >&2; exit 1; }
"$PYTHON" -c 'import PIL' || { echo "Python Pillow is required (python -m pip install Pillow)." >&2; exit 1; }
command -v glslangValidator >/dev/null || { echo "glslangValidator is required to compile GPU apps." >&2; exit 1; }
command -v spirv-val >/dev/null || { echo "spirv-val is required to validate GPU shaders." >&2; exit 1; }

if [ -z "${CC:-}" ]; then
  if command -v aarch64-linux-gnu-gcc >/dev/null; then
    export CC=aarch64-linux-gnu-gcc OBJCOPY=aarch64-linux-gnu-objcopy
    export NM=aarch64-linux-gnu-nm SIZE=aarch64-linux-gnu-size
  elif [ -n "$DEVKITPRO_DIR" ] && [ -x "$DEVKITPRO_DIR/devkitA64/bin/aarch64-none-elf-gcc" ]; then
    export PATH="$DEVKITPRO_DIR/devkitA64/bin:$PATH"
    export CC="$DEVKITPRO_DIR/devkitA64/bin/aarch64-none-elf-gcc"
    export OBJCOPY="$DEVKITPRO_DIR/devkitA64/bin/aarch64-none-elf-objcopy"
    export NM="$DEVKITPRO_DIR/devkitA64/bin/aarch64-none-elf-nm"
    export SIZE="$DEVKITPRO_DIR/devkitA64/bin/aarch64-none-elf-size"
  elif command -v aarch64-none-elf-gcc >/dev/null; then
    export CC=aarch64-none-elf-gcc OBJCOPY=aarch64-none-elf-objcopy
    export NM=aarch64-none-elf-nm SIZE=aarch64-none-elf-size
  else
    echo "Install an AArch64 cross-toolchain (aarch64-linux-gnu or aarch64-none-elf)." >&2; exit 1
  fi
fi

step() { printf '\n===== %s =====\n' "$1"; shift; "$@"; }
step 'Launcher generated assets' "$PYTHON" tools/make_font_atlas.py
step 'Launcher Vulkan shader blobs' "$PYTHON" tools/build_shaders.py
step 'IZLauncher platform server shaders and app package' bash -c 'source scripts/toolchain.sh; export PYTHON="${PYTHON:-python3}"; bash shells/izlauncher/server/build.sh; "$NODE" shells/izlauncher/server/build-app.cjs'
step 'IZPSLauncher platform assets and app package' "$NODE" shells/izpslauncher/build.cjs
step 'Launcher ABI tables' "$PYTHON" tools/gen_abi.py
step 'Native CPU launcher' bash launcher/build.sh
step 'Native ABI-3 apps (Hello CPU, GPU Triangle, System Monitor; Twilight is a separate Linux-personality port)' bash tools/build-apps.sh

# GPU ABI-1 packages bundled with the project. Emulator builds deliberately
# use their bundled blank placeholder ROM; no game/BIOS data is included.
step 'GPU Hello World' "$NODE" apps/hello-world/build.cjs
step 'Game Boy Color DMG-mode package (blank placeholder; add your own ROM in app flow)' "$NODE" apps/gameboy-color/build.cjs --placeholder
step 'GB2NS2 DMG-mode package (blank placeholder)' "$NODE" apps/gb2ns2/build.cjs --placeholder
step 'Media Machine GPU package' "$NODE" apps/media-machine/build.cjs

printf '\n===== Publishing integrated module archives and app links =====\n'
"$NODE" scripts/link-integrated-apps.cjs
"$NODE" -e "require('./sdk/publish-modules.cjs').publish(process.cwd()).then(r=>{for(const id of r.updated)console.log('Published '+id+'.izm');if(r.errors.length){for(const e of r.errors)console.error(e.id+': '+e.error);process.exitCode=1}}).catch(e=>{console.error(e);process.exitCode=1})"
