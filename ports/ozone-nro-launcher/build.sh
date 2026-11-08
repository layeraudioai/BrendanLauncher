#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${DEVKITPRO:?Set DEVKITPRO to your devkitPro installation}"
: "${PORTLIBS_PATH:=${DEVKITPRO}/portlibs}"
export PORTLIBS_PATH
if [ ! -f "${DEVKITPRO}/libounce/switch_rules" ]; then
  echo "Missing ${DEVKITPRO}/libounce/switch_rules." >&2
  echo "Build/install alula/libnx-ounce for the Ounce target first; see README.md." >&2
  exit 2
fi
command -v make >/dev/null 2>&1 || { echo "GNU make is required." >&2; exit 2; }
make -C "$HERE" clean
make -C "$HERE"
printf 'NRO companion build complete: %s/build/BrendanNroLauncher.nro\n' "$HERE"
