#!/bin/sh
# Full offline verification.  No console required.
set -e
cd "$(dirname "$0")/.."
NODE=$(command -v node || true)
[ -n "$NODE" ] || NODE=${HBL_NODE:-"$PWD/../tools/node"}
if [ ! -x "$NODE" ] && ! command -v "$NODE" >/dev/null 2>&1; then
  echo "tests/run.sh: node not found; set HBL_NODE" >&2; exit 2
fi

echo "== generated assets are current =="
python3 tools/make_font_atlas.py --check
python3 tools/build_shaders.py --check
python3 tools/gen_abi.py --check

echo "== SDK runtime (host + qemu-aarch64) =="
sh tests/abi/build.sh

echo "== hardware probe (mock backend) =="
"$NODE" host/probe.cjs --mock

echo "== host lifecycle =="
"$NODE" tests/host/lifecycle.test.cjs

echo "== read-only mac2jb SD-browser adapter =="
"$NODE" tests/sd-browser.test.cjs

echo "== system monitor source and safety contract =="
"$NODE" tests/system-monitor.test.cjs

echo "== non-destructive NRO profile manager =="
"$NODE" tests/nro-profile-manager.test.cjs

echo "== read-only boot-file inventory =="
"$NODE" tests/boot-file-catalog.test.cjs

echo "== NRO format inspector bounds checks =="
"$NODE" tests/nro-inspect.test.cjs

echo "== separate libnx-ounce NRO companion contract =="
"$NODE" tests/nro-companion.test.cjs

echo "== host-side Node.js web apps =="
"$NODE" tests/web-apps.test.cjs tests/web-app-panel.test.cjs tests/web-apps-build.test.cjs tests/web-apps-static.test.cjs tests/webport.test.cjs

echo "== launcher navigation logic =="
mkdir -p build/tests
gcc -std=gnu11 -O2 -D_GNU_SOURCE -Wall -Wextra -Werror \
  -Isdk/include -Isdk/src -Ilauncher/src \
  tests/ui/logic.test.c launcher/src/launcher_logic.c sdk/src/hbx_app.c \
  -o build/tests/logic_test
./build/tests/logic_test
"$NODE" tests/ui/nro-panel.test.cjs

echo "== UI geometry + real Vulkan render =="
sh tests/preview/build.sh
"$NODE" tests/ui/ui.test.cjs
"$NODE" tests/ui/nro-panel-visual.test.cjs

echo "all offline tests passed"
