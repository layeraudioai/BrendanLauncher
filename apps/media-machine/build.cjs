const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function python() {
  return process.env.PYTHON || process.env.PYTHON3 || (process.platform === 'win32' ? 'python' : 'python3');
}

async function main() {
  const root = __dirname;
  const state = Buffer.alloc(1024);
  state.writeFloatLE(1, 960);
  await fs.writeFile(path.join(root, 'assets/state.bin'), state);

  // Do not shell-quote a path: execute Python directly so spaces and Windows
  // paths work, and propagate generator/FFmpeg failures as real build failures.
  execFileSync(python(), [path.join(root, 'assets.py')], { stdio: 'inherit' });
  await require('../../sdk/build.cjs').headers(path.join(root, 'shaders'));
  await require('../../sdk/build.cjs').buildApp(root);
  console.log('[BUILD] Media Machine assets and shaders built successfully.');
}

main().catch(error => {
  console.error('[BUILD] Media Machine failed:', error.message);
  process.exitCode = 1;
});
