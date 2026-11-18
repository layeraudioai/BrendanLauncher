// Moonlight ABI-1 package build: assets -> SPIR-V -> (optional) capsule.
//
// Mirrors media-machine's build.cjs, but resolves the launcher SDK from either
// the in-tree BrendanLauncher checkout or a vendored copy so the package can be
// built from the Moonlight repository alone.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = __dirname;
const VENDOR = path.join(ROOT, 'shaders', 'vendor');

async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}

// Find the launcher SDK: $BLC_SDK, ../../sdk (inside BrendanLauncher), or the
// vendored header copies this repository ships.
async function resolveSdk() {
  const candidates = [
    process.env.BLC_SDK,
    path.resolve(ROOT, '..', '..', 'sdk'),
    path.resolve(ROOT, '..', '..', '..', 'sdk'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (await exists(path.join(dir, 'include', 'state.glsl'))) return dir;
  }
  return null;
}

function tool(name, fallback) {
  return process.env[name.toUpperCase()] || fallback;
}

async function copyHeaders(sdk) {
  const targets = [['state.glsl', 'abi.glsl'], ['hb.glsl', 'hb.glsl'], ['draw.glsl', 'draw.glsl']];
  for (const [source, target] of targets) {
    const from = sdk ? path.join(sdk, 'include', source) : path.join(VENDOR, target);
    await fs.copyFile(from, path.join(ROOT, 'shaders', target));
  }
}

function compile(source, output) {
  const shaders = path.join(ROOT, 'shaders');
  const glslang = tool('GLSLANG', 'glslangValidator');
  execFileSync(glslang, ['-V', '-Os', '-g0', '--target-env', 'vulkan1.0', source, '-o', output], {
    cwd: shaders,
    stdio: 'inherit',
  });
}

async function main() {
  const sdk = await resolveSdk();
  // 1. Deterministic assets and generated GLSL constants (needs Pillow).
  execFileSync(tool('PYTHON', 'python3'), [path.join(ROOT, 'assets.py')], { stdio: 'inherit' });
  // 2. ABI headers, then the three shader stages.
  await copyHeaders(sdk);
  for (const stage of ['vert', 'frag', 'comp']) {
    compile(path.join(ROOT, 'shaders', 'app.' + stage), path.join(ROOT, 'app.' + stage + '.spv'));
  }
  // 3. Package when the shared launcher build helper is reachable.
  const buildHelper = sdk ? path.join(sdk, 'build.cjs') : null;
  if (buildHelper && await exists(buildHelper)) {
    await require(buildHelper).buildApp(ROOT);
  } else {
    console.log('[BUILD] SDK not found; wrote app.*.spv next to the app (no launcher capsule).');
  }
  console.log('[BUILD] Moonlight app built successfully.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
