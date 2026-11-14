const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execSync } = require('node:child_process');
const { chooseHost, connectCommand } = require('./smilebasic/connection.cjs');
const { pairingCode, listen } = require('./smilebasic/engine/lib/connection.cjs');
const { NativeClient } = require('./smilebasic/engine/lib/native.cjs');
const { qualify } = require('./smilebasic/engine/lib/qualify.cjs');
const { serve } = require('./smilebasic/engine/lib/bridge.cjs');

async function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: 'inherit',
      cwd: __dirname
    });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(Error(`Script exited with code ${code}: ${scriptPath}`));
    });
  });
}

function ensurePythonAndPillow() {
  let pyCmd = null;
  for (const cmd of ['python', 'py']) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore' });
      pyCmd = cmd;
      break;
    } catch (e) {}
  }
  if (!pyCmd) {
    throw new Error('Python 3 is required but was not found on the system. Please install Python 3.');
  }

  let hasPillow = false;
  try {
    execSync(`${pyCmd} -c "import PIL"`, { stdio: 'ignore' });
    hasPillow = true;
  } catch (e) {}

  if (!hasPillow) {
    console.log('[SETUP] Python Pillow (PIL) module not found. Attempting automatic installation via pip...');
    try {
      execSync(`${pyCmd} -m pip install Pillow`, { stdio: 'inherit' });
      console.log('[SETUP] Pillow installed successfully.');
    } catch (err) {
      throw new Error('Failed to install Python Pillow automatically. Please run: pip install Pillow');
    }
  }
}

async function main() {
  const verbose = process.argv.includes('--verbose') || process.argv.includes('--debug');
  global.VERBOSE = verbose;

  console.log('[SETUP] Verifying Python and Pillow dependencies for BrendanLauncher...');
  ensurePythonAndPillow();

  const rawArgs = process.argv.slice(2);
  let pinVal = null;
  const filteredArgs = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--pin' && rawArgs[i+1]) {
      pinVal = rawArgs[++i];
    } else {
      filteredArgs.push(rawArgs[i]);
    }
  }

  const host = await chooseHost(filteredArgs);
  const token = pairingCode(pinVal);
  
  console.log('==================================================');
  console.log(' BrendanLauncher Unified Switch 2 Server & Panel');
  console.log(' IZLauncher, HBLauncher, & SPHAIRA Hybrid Suite');
  console.log('==================================================');
  console.log(`Host IP: ${host}`);
  console.log(`Port: 39380`);
  console.log('\nManual Connection Command for SmileBASIC on Switch 2:');
  console.log(connectCommand(host, token));
  console.log('==================================================\n');

  await fs.mkdir(path.join(__dirname, 'runs'), { recursive: true, mode: 0o700 });
  const directory = path.join(__dirname, 'runs', 'latest');
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(directory, { recursive: true });

  console.log('[SETUP] Publishing and verifying IZLauncher modules (.izm packages)...');
  try {
    const publication = await require('./sdk/publish-modules.cjs').publish(__dirname);
    console.log('[SETUP] Published modules:', publication.updated);
    for (const error of publication.errors) {
      console.error('Module source not published:', error.id, error.error);
    }
  } catch (err) {
    console.warn('[SETUP] Module publication warning:', err.message);
  }

  let native, bridge;
  try {
    const connected = await listen({
      host,
      port: 39380,
      token,
      onRejected: console.error,
      onWaiting() {
        console.log('Waiting for SmileBASIC console connection on port 39380...');
        console.log('Run the REMOVE and START commands manually on the console now.');
      }
    });

    console.log('Console connected! Initializing native client...');
    native = new NativeClient(connected.connection, connected.addresses);
    
    console.log('Qualifying native session...');
    const qualification = await qualify(native);
    console.log('Qualification passed:', qualification);

    console.log('Starting RPC bridge server...');
    bridge = await serve(native);
    bridge.keepAwake(qualification.activity);

    await fs.mkdir(path.join(directory, 'shared'), { recursive: true });
    await fs.copyFile(
      path.join(__dirname, 'smilebasic/engine/shared/rpc.cjs'),
      path.join(directory, 'shared/rpc.cjs')
    );
    await fs.writeFile(
      path.join(directory, 'connection.json'),
      JSON.stringify({
        port: bridge.port,
        token: bridge.token,
        addresses: { ...native.addresses, session: 'latest', target: 'switch2' }
      }, null, 2)
    );

    console.log(`Bridge server ready on port ${bridge.port}. Run folder: ${directory}`);

    console.log('\n--- Running BrendanLauncher Initialization Pipeline ---');
    console.log('\n[1/6] Inspecting Display Imports...');
    await runScript(path.join(__dirname, 'homebrew-launcher/inspect-display.cjs'), [directory]);
    console.log('\n[2/6] Inspecting Compatibility & Driver Symbol Module...');
    await runScript(path.join(__dirname, 'homebrew-launcher/inspect-compatibility.cjs'), [directory]);
    console.log('\n[3/6] Inspecting Input & HID State Functions...');
    await runScript(path.join(__dirname, 'homebrew-launcher/inspect-input.cjs'), [directory]);
    console.log('\n[4/6] Setting Up Vulkan Display Resources...');
    await runScript(path.join(__dirname, 'homebrew-launcher/vulkan-copy.cjs'), [directory, 'display']);
    console.log('\n[5/6] Initializing Unified Launcher Menu (launcher.cjs)...');
    await runScript(path.join(__dirname, 'homebrew-launcher/launcher.cjs'), [directory, 'auto']);
    console.log('\n[6/6] Verifying Launcher Frame & Input Check...');
    await runScript(path.join(__dirname, 'homebrew-launcher/launcher-check.cjs'), [directory, 'auto']);

    console.log('\n--- Starting BrendanLauncher continuous launcher loop ---');
    const launcherData = JSON.parse(await fs.readFile(path.join(directory, 'launcher-auto.json'), 'utf8'));
    const loopChild = spawn(process.execPath, [path.join(__dirname, 'homebrew-launcher/launcher-loop.cjs'), directory, 'auto'], {
      cwd: __dirname,
      stdio: 'inherit'
    });

    const audioChild = spawn(process.execPath, [path.join(__dirname, 'homebrew-launcher/game-audio.cjs'), directory], {
      cwd: __dirname,
      stdio: 'inherit'
    });

    console.log('\nBrendanLauncher is running successfully with pre-compiled apps (Hello World, Media Machine, BlitBun, VacooTube, iz-exchange). Press Ctrl+C to stop.');
    await new Promise(resolve => {
      const done = () => {
        process.removeListener('SIGINT', done);
        process.removeListener('SIGTERM', done);
        resolve();
      };
      connected.connection.socket.once('close', done);
      loopChild.once('close', done);
      audioChild.once('close', done);
      process.once('SIGINT', done);
      process.once('SIGTERM', done);
    });

    loopChild.kill('SIGTERM');
    audioChild.kill('SIGTERM');

  } catch (error) {
    console.error('Error in BrendanLauncher server execution:', error);
    throw error;
  } finally {
    await bridge?.close();
    await native?.stop();
    console.log('BrendanLauncher stopped.');
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack);
    process.exitCode = 1;
  });
}
