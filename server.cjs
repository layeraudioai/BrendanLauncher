'use strict';
const {spawn} = require('node:child_process');
const path = require('node:path');
const {execSync} = require('node:child_process');

function ensurePythonAndPillow() {
  let command;
  for (const candidate of ['python', 'py']) {
    try {
      execSync(`${candidate} --version`, {stdio: 'ignore'});
      command = candidate;
      break;
    } catch {}
  }
  if (!command) throw Error('Python 3 is required but was not found on the system.');
  try {
    execSync(`${command} -c "import PIL"`, {stdio: 'ignore'});
  } catch {
    console.log('[SETUP] Installing the Pillow dependency for app catalog rendering...');
    execSync(`${command} -m pip install Pillow`, {stdio: 'inherit'});
  }
}

function launcherArgs(argv) {
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pin') {
      i++;
      continue;
    }
    if (argv[i] === '--verbose' || argv[i] === '--debug') continue;
    args.push(argv[i]);
  }
  return args;
}

function runLauncher(args) {
  const script = path.join(__dirname, 'homebrew-launcher', 'start-launcher.cjs');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: __dirname,
      stdio: 'inherit',
      env: process.env
    });
    const forwardSignal = signal => child.kill(signal);
    const cleanup = () => {
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
    };
    const onInterrupt = () => forwardSignal('SIGINT');
    const onTerminate = () => forwardSignal('SIGTERM');
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
    child.once('error', error => {
      cleanup();
      reject(error);
    });
    child.once('close', (code, signal) => {
      cleanup();
      if (code === 0) resolve();
      else reject(Error(`BrendanLauncher stopped (${signal || `exit ${code}`}).`));
    });
  });
}

async function main() {
  const args = launcherArgs(process.argv.slice(2));
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node server.cjs [computer-IP]');
    return;
  }
  console.log('[SETUP] Verifying Python and Pillow dependencies for BrendanLauncher...');
  ensurePythonAndPillow();
  await runLauncher(args);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
