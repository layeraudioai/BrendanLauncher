#!/usr/bin/env bash
# Rebuild all source targets shipped in this AIO tree before server startup.
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON=${PYTHON:-python3}
NODE=${NODE:-node}

command -v "$PYTHON" >/dev/null || { echo "Missing Python 3 executable: $PYTHON" >&2; exit 1; }
"$PYTHON" -c 'import PIL' || { echo "Python Pillow is required (python -m pip install Pillow)." >&2; exit 1; }
command -v glslangValidator >/dev/null || { echo "glslangValidator is required to compile GPU apps." >&2; exit 1; }
command -v spirv-val >/dev/null || { echo "spirv-val is required to validate GPU shaders." >&2; exit 1; }

if ! command -v "${CC:-aarch64-linux-gnu-gcc}" >/dev/null && ! command -v aarch64-none-elf-gcc >/dev/null; then
  if [ -d "/c/dkp/devkitA64/bin" ]; then
    export PATH="/c/dkp/devkitA64/bin:$PATH"
  elif [ -d "/mnt/c/dkp/devkitA64/bin" ]; then
    export PATH="/mnt/c/dkp/devkitA64/bin:$PATH"
  elif [ -d "C:/dkp/devkitA64/bin" ]; then
    export PATH="C:/dkp/devkitA64/bin:$PATH"
  elif [ -d "/opt/devkitpro/msys2/usr/bin" ]; then
    export PATH="/opt/devkitpro/msys2/usr/bin:$PATH"
  fi
fi

if ! command -v "${CC:-aarch64-linux-gnu-gcc}" >/dev/null && ! command -v aarch64-none-elf-gcc >/dev/null; then
  echo "Install an AArch64 cross-toolchain (aarch64-linux-gnu or aarch64-none-elf)." >&2; exit 1
fi
if ! command -v "${CC:-aarch64-linux-gnu-gcc}" >/dev/null; then
  export CC=aarch64-none-elf-gcc OBJCOPY=aarch64-none-elf-objcopy
  export NM=aarch64-none-elf-nm SIZE=aarch64-none-elf-size
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
step 'Sphaira-format GPU package' "$NODE" apps/sphaira/build.cjs
step 'Standalone Installer GPU package' "$NODE" apps/standalone-installer/build.cjs
step 'YouTube/VacooTube GPU package' "$NODE" apps/youtube/build.cjs
step 'IZ File Exchange GPU app package' "$NODE" apps/iz-exchange/switch/build.cjs
step 'IZ File Exchange module payload and compressed shaders' "$NODE" modules/iz-exchange/switch/build.cjs
step 'Vite/TypeScript web apps (source compilation)' "$NODE" tools/build-webapps.cjs --install
step 'Native Switch autoport for supported WebPort apps' "$NODE" tools/port-webapp.cjs hello-vite --skip-vite

printf '\n===== Publishing integrated module archives and app links =====\n'
"$NODE" scripts/link-integrated-apps.cjs
"$NODE" -e "require('./sdk/publish-modules.cjs').publish(process.cwd()).then(r=>{for(const id of r.updated)console.log('Published '+id+'.izm');if(r.errors.length){for(const e of r.errors)console.error(e.id+': '+e.error);process.exitCode=1}}).catch(e=>{console.error(e);process.exitCode=1})"
