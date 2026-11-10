'use strict';
const readline = require('node:readline/promises');
const {execSync, spawnSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');

function discoverApps() {
  const appsDir = path.join(ROOT, 'apps');
  if (!fs.existsSync(appsDir)) return [];
  const entries = fs.readdirSync(appsDir, { withFileTypes: true });
  const list = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const base = path.join(appsDir, entry.name);
    
    const nativeManifestPath = path.join(base, 'manifest.json');
    if (fs.existsSync(nativeManifestPath)) {
      try {
        const m = JSON.parse(fs.readFileSync(nativeManifestPath, 'utf8'));
        list.push({
          id: m.id || entry.name,
          name: m.name || entry.name,
          kind: 'native',
          folder: entry.name,
          desc: m.description || 'Native CPU SDK App'
        });
        continue;
      } catch (e) {}
    }

    let gpuManifestPath = path.join(base, 'app.json');
    if (!fs.existsSync(gpuManifestPath)) {
      gpuManifestPath = path.join(base, 'switch/app.json');
    }
    if (fs.existsSync(gpuManifestPath)) {
      try {
        const m = JSON.parse(fs.readFileSync(gpuManifestPath, 'utf8'));
        list.push({
          id: m.id || entry.name,
          name: m.name || entry.name,
          kind: 'gpu',
          folder: entry.name,
          desc: m.description || 'GPU App'
        });
      } catch (e) {}
    }
  }

  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const discovered = discoverApps();

  console.log('\n============================================================');
  console.log(' BrendanLauncher AIO Interactive Launcher Menu');
  console.log('============================================================\n');
  console.log('0. Homebrew Launcher / Server (Default server.cjs)');
  console.log('------------------------------------------------------------');

  discovered.forEach((app, index) => {
    const typeLabel = app.kind === 'native' ? '[Native CPU]' : '[GPU App]';
    console.log(`${index + 1}. ${app.name} (${app.id}) ${typeLabel} - ${app.desc}`);
  });

  const answer = await rl.question(`\nSelect an option [0-${discovered.length}] (default 0): `);

  if (answer.trim() === '0' || answer.trim() === '') {
    rl.close();
    console.log('\n[MENU] Running AIO build and starting BrendanLauncher server...');
    spawnSync(process.execPath, ['tools/build-aio.cjs'], { cwd: ROOT, stdio: 'inherit' });
    spawnSync('node', ['server.cjs'], { cwd: ROOT, stdio: 'inherit' });
    return;
  }

  const index = parseInt(answer.trim(), 10);
  if (isNaN(index) || index < 0 || index > discovered.length) {
    rl.close();
    console.log('\n[MENU] Invalid option. Exiting.');
    return;
  }

  const selected = discovered[index - 1];
  console.log(`\n[MENU] Selected: ${selected.name} (${selected.folder})`);

  console.log('\nSelect execution mode:');
  console.log('1. Mock Mode (Local PC simulation)');
  console.log('2. Live Mode (Real NS2 console via ns2jb - auto-spawns runner)');
  const modeAnswer = await rl.question('\nEnter choice [1-2] (default 1): ');

  const mode = modeAnswer.trim() === '2' ? 'live' : 'mock';
  let targetIp = '10.42.0.1';
  let pairingPin = '';

  if (mode === 'live') {
    const ipAnswer = await rl.question('\nEnter NS2 console / RPC target IP [default 10.42.0.1]: ');
    if (ipAnswer.trim()) targetIp = ipAnswer.trim();

    const pinAnswer = await rl.question('\nEnter 4-digit pairing PIN (e.g. 6466, leave blank for default): ');
    if (pinAnswer.trim()) pairingPin = pinAnswer.trim();
  }
  rl.close();

  if (selected.kind === 'native') {
    const codeBase = selected.folder === 'air-guitar' ? '0x0c000000' : '0x09000000';
    const dataBase = selected.folder === 'air-guitar' ? '0x0d000000' : '0x0b000000';
    console.log(`\n[MENU] Building native app ${selected.folder}...`);
    execSync(`python sdk/tools/hbx-build.py apps/${selected.folder} --code-base ${codeBase} --data-base ${dataBase}`, { cwd: ROOT, stdio: 'inherit' });
    
    const args = ['host/start.cjs'];
    if (mode === 'mock') {
      args.push('--mock');
    } else {
      args.push('--spawn');
    }
    args.push('--app', selected.folder);

    const env = {
      ...process.env,
      HBL_RPC_TARGET: targetIp,
      HB_STREAM_HOST: targetIp,
      HBL_PIN: pairingPin,
      NS2_PIN: pairingPin
    };

    console.log(`\n[MENU] Starting ${selected.folder} via ${mode} host runner (Target IP: ${targetIp}, PIN: ${pairingPin || 'default'})...`);
    spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env });
  } else {
    console.log(`\n[MENU] Building and starting GPU app ${selected.folder}...`);
    spawnSync(process.execPath, ['tools/build-aio.cjs'], { cwd: ROOT, stdio: 'inherit' });
    spawnSync('node', ['server.cjs'], { cwd: ROOT, stdio: 'inherit' });
  }
}

main().catch(error => {
  console.error('[MENU ERROR]', error.message);
  process.exit(1);
});
