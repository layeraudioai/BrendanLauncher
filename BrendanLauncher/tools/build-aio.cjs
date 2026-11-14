'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const {execFileSync} = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');

function run(program, args, options = {}) {
  execFileSync(program, args, {cwd: ROOT, stdio: 'inherit', env: process.env, ...options});
}
function plan() {
  console.log(`AIO source build root: ${ROOT}`);
  console.log('1. Update the source app catalog inventory, then regenerate launcher assets/shaders/ABI and build native launcher + ABI-3 apps.');
  console.log('2. Build both IZlauncher/IZPSlauncher shells and all bundled GPU-app packages.');
  console.log('3. Repack IZ modules from the bundled module sources and create the integrated app links.');
  console.log('4. Verify native/GPU catalogs and module archives. The caller then starts server.cjs.');
  console.log('Not built by this script: Ozone/CFW, NRO compatibility runtimes, Twilight Princess without its separate toolchain/disc, or external IZ2S platform installations.');
}
async function main() {
  if (process.argv.includes('--plan')) { plan(); return; }
  run(process.execPath, ['scripts/update-app-catalog.cjs']);
  run('bash', ['tools/build-aio.sh']);
  run(process.execPath, ['scripts/link-integrated-apps.cjs']);

  const published = await require('../sdk/publish-modules.cjs').publish(ROOT);
  for (const id of published.updated) console.log(`[AIO] Published IZ module ${id}.izm`);
  if (published.errors.length) {
    for (const item of published.errors) console.error(`[AIO] ${item.id}: ${item.error}`);
    throw Error('IZ module publication failed; refusing to start the server.');
  }

  const {scan: scanNative} = require('../host/lib/packages.cjs');
  const native = scanNative(path.join(ROOT, 'apps'));
  const nativeReady = new Set(native.packages.map(item => item.manifest.id));
  for (const id of ['hello-cpu', 'gpu-triangle', 'system-monitor', 'fs-demo']) {
    if (!nativeReady.has(id)) throw Error(`Required native package was not built: ${id}`);
  }
  const nativeErrors = native.errors.filter(item => path.basename(item.directory) !== 'twilight');
  if (nativeErrors.length) throw Error(`Native app package errors: ${nativeErrors.map(item => `${path.basename(item.directory)}: ${item.message}`).join('; ')}`);
  if (native.errors.some(item => path.basename(item.directory) === 'twilight')) {
    console.warn('[AIO] Twilight Princess is not built by this generic script; it needs its own toolchain and user-provided game data.');
  }
  console.log(`[AIO] Native ABI-3 packages ready: ${[...nativeReady].join(', ')}`);

  const gpu = await require('../homebrew-launcher/app-catalog.cjs').scan(path.join(ROOT, 'apps'));
  const gpuIds = new Set(gpu.apps.map(item => item.id));
  const requiredGpu = ['hello-world', 'gameboy-color', 'gb2ns2', 'media-machine'];
  for (const id of requiredGpu) if (!gpuIds.has(id)) throw Error(`GPU/IZ app package is not launchable from the current catalog: ${id}`);
  const mediaMachine = gpu.apps.find(item => item.id === 'media-machine');
  if (!mediaMachine || !Object.keys(mediaMachine.effects).length) throw Error('Media Machine must have at least one valid audio effect before the launcher can start.');
  for (const item of gpu.rejected) console.warn(`[AIO] GPU app excluded ${item.folder}: ${item.error}`);
  if (gpu.rejected.length) {
    const builtIds = new Set(requiredGpu);
    const bad = gpu.rejected.filter(item => builtIds.has(item.folder));
    if (bad.length) throw Error(`GPU catalog rejected bundled apps: ${bad.map(item => `${item.folder}: ${item.error}`).join('; ')}`);
  }
  console.log(`[AIO] GPU/IZ catalog packages ready (${gpuIds.size}): ${[...gpuIds].join(', ')}`);

  const archive = require('../core/archive.cjs');
  for (const id of ['blitbun', 'iz-exchange', 'vacootube']) {
    const file = path.join(ROOT, 'modules', id, `${id}.izm`);
    const bytes = await fs.readFile(file);
    const inspected = archive.inspect(bytes);
    if (!inspected.files.some(item => item.name === 'module.json')) throw Error(`Invalid IZ module archive: ${file}`);
  }
  console.log('[AIO] IZ module archives verified. Starting the unified BrendanLauncher server is safe.');
}
main().catch(error => {
  console.error('[AIO BUILD FAILED]', error.stack || error.message);
  process.exitCode = 1;
});
