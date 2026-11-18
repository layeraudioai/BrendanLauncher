#!/usr/bin/env node
'use strict';
// One-shot Moonlight bring-up for BrendanLauncher.bat.
//
// The launcher itself needs nothing from this script. It exists so the answer to
// "will you be using Moonlight this session?" can actually mean something: the
// host side of a stream is a separate program (Sunshine) plus this app's GPU
// package inside `apps/moonlight`, and neither ships in the launcher tree.
//
//   node scripts/moonlight-setup.cjs --check   report what is missing, change nothing
//   node scripts/moonlight-setup.cjs --auto    download/install/build whatever is missing
//   node scripts/moonlight-setup.cjs --auto --rebuild   also re-run apps/moonlight/build.cjs
//
// Everything is idempotent: a second run with everything in place only probes.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { spawn, spawnSync } = require('node:child_process');

// This file lives in <launcher tree>/scripts, so the tree root is its parent.
const LAUNCHER = path.resolve(__dirname, '..');
const CACHE = path.join(LAUNCHER, 'data', 'cache');
const TOOLS = path.join(LAUNCHER, 'tools');
const STATE = path.join(LAUNCHER, 'data', 'state', 'moonlight-setup.json');

const SUNSHINE_REPOS = ['SunshineStream/Sunshine', 'LizardByte/Sunshine'];
const APP_REPOS = ['XITRIX/Moonlight-CivSwitch'];
const isWindows = process.platform === 'win32';

const argv = new Set(process.argv.slice(2));
const AUTO = argv.has('--auto');
const CHECK = argv.has('--check') || !AUTO;
const REBUILD = argv.has('--rebuild');
const NO_START = argv.has('--no-start');

const report = [];
const log = (kind, message) => {
  report.push({ kind, message });
  const tag = kind === 'error' ? 'ERROR' : kind === 'warn' ? ' WARN' : kind === 'skip' ? ' SKIP' : '  OK ';
  console.log(`[${tag}] ${message}`);
};

// ---------------------------------------------------------------- utilities --

const exists = target => fs.existsSync(target);

function findOnPath(names) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  return result.status ?? 0;
}

function silent(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  return { status: result.status ?? -1, text: `${result.stdout || ''}${result.stderr || ''}` };
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'BrendanLauncher' },
    redirect: 'follow',
  });
  if (!response.ok) throw Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

async function download(url, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const partial = `${destination}.part`;
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'BrendanLauncher' } });
  if (!response.ok) throw Error(`${url} -> HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length') || 0);
  const body = response.body;
  const out = fs.createWriteStream(partial);
  let seen = 0;
  let nextTick = 0;
  for await (const chunk of body) {
    seen += chunk.length;
    if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
    if (total && Date.now() >= nextTick) {
      nextTick = Date.now() + 400;
      const percent = Math.round((seen / total) * 100);
      process.stdout.write(`\r      ${percent}% of ${(total / 1e6).toFixed(1)} MB    `);
    }
  }
  await new Promise(resolve => out.end(resolve));
  if (total) process.stdout.write('\r'.padEnd(1) + ' '.repeat(46) + '\r');
  await fsp.rename(partial, destination);
  return destination;
}

// Windows 10+ ships bsdtar (which reads zip); Linux/macOS need unzip for archives
// like GitHub's source zips, because GNU tar cannot open them.
function extract(archive, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const attempts = [];
  const unzip = findOnPath(['unzip']);
  if (unzip) attempts.push([unzip, ['-q', '-o', archive, '-d', destination]]);
  const tar = findOnPath(['tar.exe', 'tar']);
  if (tar) attempts.push([tar, ['-xf', archive, '-C', destination]]);
  const bsdtar = findOnPath(['bsdtar']);
  if (bsdtar) attempts.push([bsdtar, ['-xf', archive, '-C', destination]]);
  if (isWindows) {
    attempts.push([
      'powershell',
      ['-NoProfile', '-Command',
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${destination}' -Force`],
    ]);
  }
  if (!attempts.length) throw Error('no unzip/tar available to open ' + path.basename(archive));
  const errors = [];
  for (const [command, args] of attempts) {
    const result = spawnSync(command, args, { stdio: 'ignore' });
    if (result.status === 0) return;
    errors.push(`${path.basename(command)} -> ${result.status}`);
  }
  throw Error(`could not extract ${path.basename(archive)} (${errors.join(', ')})`);
}

async function copyTree(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  await fsp.cp(from, to, { recursive: true, force: true });
}

// ------------------------------------------------------------------ sunshine --

function findSunshine() {
  const candidates = [
    path.join(TOOLS, 'sunshine', 'sunshine.exe'),
    path.join(TOOLS, 'sunshine', 'Sunshine', 'sunshine.exe'),
    path.join(process.env['ProgramFiles'] || 'C:/Program Files', 'Sunshine', 'sunshine.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Sunshine', 'sunshine.exe'),
  ];
  for (const candidate of candidates) if (exists(candidate)) return candidate;
  const onPath = findOnPath(['sunshine.exe', 'sunshine']);
  return onPath || null;
}

async function latestSunshine() {
  let lastError;
  for (const repo of SUNSHINE_REPOS) {
    try {
      const release = await getJson(`https://api.github.com/repos/${repo}/releases/latest`);
      const assets = release.assets || [];
      const msi = assets.find(asset => /Windows-AMD64-installer\.msi$/i.test(asset.name));
      const zip = assets.find(asset => /Windows-AMD64-lite\.zip$/i.test(asset.name));
      if (!msi && !zip) throw Error(`${repo} ${release.tag_name} has no Windows AMD64 build`);
      return { repo, tag: release.tag_name, msi, zip };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || Error('no Sunshine release found');
}

async function installSunshine() {
  const release = AUTO ? await latestSunshine() : null;
  if (!release) {
    log('warn', 'Sunshine is not installed - run without --check to download it');
    return null;
  }
  log('ok', `found ${release.repo} ${release.tag} for Windows`);

  // Preferred: the installer, because it registers the service and firewall rules.
  if (release.msi && isWindows) {
    const file = path.join(CACHE, release.msi.name);
    if (!exists(file)) {
      console.log(`      downloading ${release.msi.name} (${(release.msi.size / 1e6).toFixed(1)} MB)`);
      await download(release.msi.browser_download_url, file);
    }
    log('ok', 'installing Sunshine (a UAC prompt may appear)');
    const status = run('msiexec', ['/i', file, '/qn', '/norestart']);
    const installed = findSunshine() || exists(path.join(process.env['ProgramFiles'] || '', 'Sunshine', 'sunshine.exe'));
    if (status === 0 && installed) return findSunshine();
    log('warn', `installer exited with ${status}; falling back to the portable build`);
  }

  // Fallback: the portable build, unpacked next to the launcher and started by hand.
  if (release.zip) {
    const file = path.join(CACHE, release.zip.name);
    if (!exists(file)) {
      console.log(`      downloading ${release.zip.name} (${(release.zip.size / 1e6).toFixed(1)} MB)`);
      await download(release.zip.browser_download_url, file);
    }
    const target = path.join(TOOLS, 'sunshine');
    extract(file, target);
    const exe = findSunshine();
    if (exe) {
      log('ok', `Sunshine unpacked at ${exe}`);
      return exe;
    }
  }
  log('error', 'could not install Sunshine automatically - install it from https://github.com/SunshineStream/Sunshine');
  return null;
}

function sunshineService() {
  if (!isWindows) return null;
  const query = silent('sc', ['query', 'sunshineservice']);
  return query.status === 0 ? 'sunshineservice' : null;
}

async function startSunshine(exe) {
  const service = sunshineService();
  if (service) {
    const status = silent('sc', ['start', service]);
    const already = /already been started|RUNNING/i.test(status.text);
    log('ok', already ? 'Sunshine service is running' : 'started the Sunshine service');
    return true;
  }
  if (!exe) return false;
  // No service: run the portable build in the foreground, detached from this window.
  try {
    const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', error => log('error', `could not start Sunshine: ${error.message}`));
    child.unref();
    log('ok', `started ${path.basename(exe)}`);
    return true;
  } catch (error) {
    log('error', `could not start Sunshine: ${error.message}`);
    return false;
  }
}

function probeHost(port = 47984, timeout = 40000) {
  // Sunshine answers on 47984 with a self-signed certificate; we only need "is it up".
  return new Promise(resolve => {
    const started = Date.now();
    const attempt = () => {
      const request = https.get(
        { host: '127.0.0.1', port, path: '/serverinfo', rejectUnauthorized: false, timeout: 3000 },
        response => {
          response.resume();
          resolve(response.statusCode || 200);
        },
      );
      request.on('error', () => {
        if (Date.now() - started > timeout) resolve(0);
        else setTimeout(attempt, 1000);
      });
      request.on('timeout', () => request.destroy());
    };
    attempt();
  });
}

// -------------------------------------------------------------- moonlight app --

function appCandidates() {
  // The port can sit next to the launcher tree, one level up (AIO layout), or
  // two levels up (a checkout where the tree is BrendanLauncher/BrendanLauncher).
  const bases = [LAUNCHER];
  let cursor = LAUNCHER;
  for (let depth = 0; depth < 3; depth++) {
    cursor = path.dirname(cursor);
    if (!cursor || cursor === path.dirname(cursor)) break;
    bases.push(cursor);
  }
  const candidates = [process.env.MOONLIGHT_APP_SOURCE, path.join(LAUNCHER, 'apps', 'moonlight')];
  for (const base of bases) {
    candidates.push(
      path.join(base, 'moonlight-civswitch', 'brendanlauncher', 'apps', 'moonlight'),
      path.join(base, 'moonlight-civswitch', 'apps', 'moonlight'),
      path.join(base, 'vendor', 'moonlight', 'apps', 'moonlight'),
    );
  }
  return candidates.filter(Boolean);
}

function appReady(dir) {
  return ['app.json', 'app.vert.spv', 'app.frag.spv', 'app.comp.spv'].every(file => exists(path.join(dir, file)));
}

function isMoonlightPackage(dir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
    return manifest.id === 'moonlight' || manifest.format === 'hblauncher.gpu-app';
  } catch {
    return false;
  }
}

// The app package is a directory containing app.json plus its SPIR-V blobs. It
// can arrive as a directory, as a zip of the port, or inside the AIO archive.
function findPackage(root, depth = 0) {
  if (depth > 6) return null;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  if (entries.some(entry => entry.name === 'app.json') && isMoonlightPackage(root)) return root;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'apps') {
      // `apps` itself may hold the package one level down; keep looking inside it.
      if (entry.name !== 'apps') continue;
    }
    const found = findPackage(path.join(root, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

function archives() {
  const explicit = [process.env.MOONLIGHT_APP_ZIP].filter(Boolean);
  // Only where a person would actually drop the archive: next to the launcher,
  // one level up (the AIO layout), or in Downloads.
  const searchDirs = [LAUNCHER, path.join(LAUNCHER, '..'), path.join(os.homedir(), 'Downloads')];
  const found = [];
  for (const dir of searchDirs) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && /moonlight.*\.zip$/i.test(entry.name)) found.push(path.join(dir, entry.name));
    }
  }
  return [...explicit, ...found];
}

async function installFromArchive(archive) {
  const scratch = path.join(CACHE, `unpack-${Date.now()}`);
  await fsp.rm(scratch, { recursive: true, force: true });
  try {
    extract(archive, scratch);
  } catch (error) {
    log('warn', `${path.basename(archive)}: ${error.message}`);
    return null;
  }
  const found = findPackage(scratch);
  if (!found) {
    await fsp.rm(scratch, { recursive: true, force: true });
    return null;
  }
  return found;
}

// In --check mode we point at whatever --auto would copy from, without copying.
function describeAppSource() {
  for (const candidate of appCandidates()) {
    if (candidate === path.join(LAUNCHER, 'apps', 'moonlight')) continue;
    if (!isMoonlightPackage(candidate)) continue;
    log('warn', `apps/moonlight is not installed; --auto will copy it from ${candidate}`);
    return;
  }
  const archive = archives()[0];
  if (archive) {
    log('warn', `apps/moonlight is not installed; --auto will unpack it from ${archive}`);
    return;
  }
  log('warn', 'apps/moonlight is not installed yet');
}

async function ensureApp() {
  const target = path.join(LAUNCHER, 'apps', 'moonlight');

  if (appReady(target)) {
    log('ok', `Moonlight app package ready at ${target}`);
    return target;
  }

  // 1. Copy from a neighbour that already has it (the AIO layout, a checkout, ...).
  for (const candidate of appCandidates()) {
    if (candidate === target) continue;
    if (!isMoonlightPackage(candidate)) continue;
    log('ok', `installing the Moonlight package from ${candidate}`);
    await copyTree(candidate, target);
    break;
  }

  // 2. Unpack it from an archive sitting next to the launcher or in Downloads.
  if (!exists(path.join(target, 'app.json'))) {
    for (const archive of archives()) {
      log('ok', `looking for the app inside ${archive}`);
      const found = await installFromArchive(archive);
      if (!found) continue;
      await copyTree(found, target);
      log('ok', `installed the Moonlight package from ${path.basename(archive)}`);
      break;
    }
  }

  if (!exists(path.join(target, 'app.json'))) {
    log('warn', 'apps/moonlight is not installed yet');
    log('warn', 'drop moonlight-aio.zip (or the app folder) next to BrendanLauncher.bat,');
    log('warn', 'or set MOONLIGHT_APP_SOURCE=<folder> / MOONLIGHT_APP_ZIP=<archive>');
    return null;
  }

  if (!appReady(target) || REBUILD) {
    const build = path.join(target, 'build.cjs');
    if (!exists(build)) {
      log('error', 'apps/moonlight has no build.cjs; the package is incomplete');
      return target;
    }
    log('ok', 'building the Moonlight shaders and generated assets');
    const status = run(process.execPath, [build], { cwd: target });
    if (status !== 0) log('warn', `build.cjs exited with ${status}; the app may not launch`);
  }
  if (appReady(target)) log('ok', `Moonlight app package ready at ${target}`);
  else log('warn', 'the app package is present but its SPIR-V blobs are missing');
  return target;
}

// --------------------------------------------------------------------- main --

async function main() {
  await fsp.mkdir(CACHE, { recursive: true });
  const started = new Date().toISOString();
  console.log('');
  console.log('  Moonlight session setup');
  console.log('  ----------------------');

  const exe = findSunshine();
  if (exe) log('ok', `Sunshine found at ${exe}`);
  else if (CHECK) log('warn', 'Sunshine is not installed');
  else log('warn', 'Sunshine is not installed; fetching it');

  const installed = exe || (CHECK ? null : await installSunshine());
  // --check must not copy or build anything, so it only reports on the package.
  const app = CHECK
    ? (exists(path.join(LAUNCHER, 'apps', 'moonlight', 'app.json'))
        ? (log('ok', `Moonlight app package at ${path.join(LAUNCHER, 'apps', 'moonlight')}`),
          path.join(LAUNCHER, 'apps', 'moonlight'))
        : (describeAppSource(), null))
    : await ensureApp();

  if (!CHECK && !NO_START) {
    const running = await startSunshine(installed);
    if (running) {
      const code = await probeHost();
      if (code) log('ok', `Sunshine answers on https://127.0.0.1:47984 (HTTP ${code})`);
      else log('warn', 'Sunshine did not answer on 47984 yet; the launcher will still start');
    }
  }

  const env = {
    MOONLIGHT_BACKEND: 'sunshine',
    MOONLIGHT_HOSTS: process.env.MOONLIGHT_HOSTS || '127.0.0.1',
  };
  console.log('');
  console.log(`  host backend : ${env.MOONLIGHT_BACKEND} (${env.MOONLIGHT_HOSTS})`);
  console.log('  pair on the console with A, then enter the PIN in Sunshine');
  console.log('  web UI       : https://127.0.0.1:47990');
  console.log('');

  await fsp.mkdir(path.dirname(STATE), { recursive: true });
  await fsp.writeFile(
    STATE,
    JSON.stringify(
      {
        updated: started,
        mode: CHECK ? 'check' : 'auto',
        sunshine: installed,
        app,
        env,
        report,
      },
      null,
      2,
    ) + '\n',
  );

  return report.some(entry => entry.kind === 'error') ? 1 : 0;
}

main().then(
  code => process.exit(code),
  error => {
    console.error(`[ERROR] ${error && error.message ? error.message : error}`);
    process.exit(1);
  },
);
