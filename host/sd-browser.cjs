'use strict';
/*
 * BrendanLauncher host bridge for mac2jb's read-only SD browser.
 * This is a host-side utility (browser/FTP); it is not a Switch app.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const readline = require('node:readline');

const ROOT = path.resolve(__dirname, '..');
const SFB = path.join(ROOT, 'tools/super-file-bros');
const BROWSER = path.join(ROOT, 'tools/mac2jb-sd-browser');
const MANIFEST_SHA256 = '337c04fdde259a971190761dd1ceb76e8744447e9a8bfd86c4a531474ebbca36';

function check(ok, message) { if (!ok) throw Error(message); }
function hash(bytes) { return require('node:crypto').createHash('sha256').update(bytes).digest('hex'); }
function emit(type, fields = {}) {
  process.stdout.write('HBL_SD_BROWSER ' + JSON.stringify({type, ...fields}) + '\n');
}

async function verifyBundledSource(folder = SFB) {
  const inventory = await fsp.readFile(path.join(folder, 'SOURCE-MANIFEST.json'));
  check(hash(inventory) === MANIFEST_SHA256, 'Bundled Super File Bros. source inventory changed');
  const manifest = JSON.parse(inventory);
  check(manifest.version === '0.1.0' && manifest.platform === 'source' &&
    Object.keys(manifest.files).length === 79, 'Unexpected Super File Bros. source manifest');
  for (const [name, digest] of Object.entries(manifest.files)) {
    check(!path.isAbsolute(name) && name.split('/').every(part => part && part !== '.' && part !== '..') &&
      /^[a-f0-9]{64}$/.test(digest), 'Invalid source inventory entry');
    const file = path.join(folder, name);
    const stat = await fsp.lstat(file);
    check(stat.isFile() && !stat.isSymbolicLink(), 'Unsupported bundled file: ' + name);
    check(hash(await fsp.readFile(file)) === digest, 'Bundled source changed: ' + name);
  }
}

function privateJson(filename) {
  const stat = fs.lstatSync(filename);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8 * 1024 * 1024,
    'Unsafe or invalid held-session record: ' + path.basename(filename));
  if (typeof process.getuid === 'function') {
    check(stat.uid === process.getuid() && (stat.mode & 0o077) === 0,
      'Held-session records must be private to the current user');
  }
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

function verifyHeldRun(runDirectory, consoleAddress, ns2jbDirectory) {
  check(net.isIPv4(consoleAddress), 'Provide the Switch IPv4 address with --host');
  const ns2jb = fs.realpathSync(ns2jbDirectory);
  const runsRoot = fs.realpathSync(path.join(ns2jb, 'runs'));
  const requested = path.resolve(runDirectory);
  const requestedStat = fs.lstatSync(requested);
  check(requestedStat.isDirectory() && !requestedStat.isSymbolicLink(),
    'Choose a real held-run directory, not a symlink');
  const run = fs.realpathSync(requested);
  check(within(runsRoot, run) && /^switch2-[A-Za-z0-9_-]+$/.test(path.basename(run)),
    'Run must be a switch2-* directory inside the selected ns2jb/runs folder');

  const result = privateJson(path.join(run, 'result.json'));
  const proof = privateJson(path.join(run, 'switch2/fs-execution-current.json'));
  const connection = privateJson(path.join(run, 'connection.json'));
  const acquisition = privateJson(path.join(run, 'switch2/current-acquisition.json'));
  const rootProof = privateJson(path.join(run, 'switch2/ro/root/current-root.json'));
  const session = connection.addresses && connection.addresses.session;
  check(typeof session === 'string' && session.length > 0 &&
    result.verified === true && result.fs?.verified === true && result.fs?.restored === true &&
    result.fs?.cleanup?.deferred === true && result.fs?.cleanup?.donor?.cleanedUp === true &&
    result.fs?.retainedEndpoint?.ready === true && result.fs?.retainedEndpoint?.session === session &&
    result.rpc?.mode === 'held' && result.rpc?.state === 'listening' && !result.completed && !result.error &&
    proof.verified === true && proof.restored === true && proof.cleanup?.deferred === true &&
    proof.retainedEndpoint?.ready === true && proof.session === session &&
    proof.retainedEndpoint.session === session && acquisition.session === session &&
    rootProof.session === session && rootProof.pid === 1 && rootProof.rootHandle,
  'Run does not prove a live, verified held FS RPC session');
  return {run, ns2jb, host: consoleAddress, session};
}

function checkedSDPath(value) {
  check(typeof value === 'string' && (value === '/sd' || value.startsWith('/sd/')) &&
    !/[\x00-\x1f\x7f\\:]/.test(value) && !value.split('/').some(part => part === '.' || part === '..') &&
    Buffer.byteLength(value) <= 740, 'Only safe paths under /sd are available');
  return value;
}

function readOnlySD(storage) {
  const rootDir = {type: 'dir', size: 0};
  const valid = value => checkedSDPath(value);
  return Object.freeze({
    list: async value => value === '/' ? [{name: 'sd', ...rootDir}] : storage.list(valid(value)),
    stat: async value => value === '/' ? rootDir : storage.stat(valid(value)),
    openRead: async value => storage.openRead(valid(value)),
    read: async (file, offset, count) => storage.read(file, offset, count),
    close: async file => storage.close(file)
  });
}

function rpcForRun(session) {
  const candidates = [
    path.join(session.run, 'shared/rpc.cjs'),
    path.join(session.ns2jb, 'rpc.cjs')
  ];
  const filename = candidates.find(file => fs.existsSync(file));
  check(filename, 'Cannot find the active ns2jb RPC client for this run');
  return require(filename);
}

async function assertSessionLive(session, rpc) {
  const status = rpc.request.length >= 2
    ? await rpc.request(session.run, {command: 'status'})
    : await rpc.request({command: 'status'});
  check(status && status.ready === true, 'The held FS RPC session is no longer ready');
  if (rpc.a?.session !== undefined)
    check(String(rpc.a.session) === session.session, 'The RPC session changed; stop and reconnect');
}

async function openBrowser(url) {
  if (process.env.HBL_SD_NO_OPEN === '1') return;
  let command, args;
  if (process.platform === 'darwin') { command = 'open'; args = [url]; }
  else if (process.platform === 'win32') { command = 'cmd'; args = ['/c', 'start', '', url]; }
  else { command = 'xdg-open'; args = [url]; }
  const child = spawn(command, args, {stdio: 'ignore', detached: true});
  child.on('error', error => emit('warning', {message: 'Open this URL in a browser: ' + url + ' (' + error.message + ')'}));
  child.unref();
}

async function runBrowser(runDirectory, consoleAddress, {ns2jbDirectory,
  onEvent = emit, open = openBrowser, sourceRoot = SFB} = {}) {
  await verifyBundledSource(sourceRoot);
  const session = verifyHeldRun(runDirectory, consoleAddress, ns2jbDirectory);
  const rpc = rpcForRun(session);
  await assertSessionLive(session, rpc);

  const library = require(path.join(sourceRoot, 'tools/dolphin-fs-rpc/library.cjs'));
  const port = await library.availablePort(session.host);
  let attachment, storage, ftp, panel, pumping, stopped = false, stopRequested = false, failure;
  const requestStop = () => { stopRequested = true; };
  const stopInput = line => {
    if (line.trim().toLowerCase() === 'q' || line.trim().toLowerCase() === 'quit') requestStop();
    else { try { if (JSON.parse(line).action === 'stop') requestStop(); } catch {} }
  };
  const input = process.stdin.isTTY
    ? readline.createInterface({input: process.stdin, terminal: true}) : null;
  process.on('SIGTERM', requestStop);
  process.on('SIGINT', requestStop);
  input?.on('line', stopInput);
  try {
    check(!stopRequested, 'SD browser stopped before opening the console filesystem');
    const sessionApi = require(path.join(sourceRoot,
      'modules/iz-exchange/server/ouncecake/engine/session.cjs'));
    attachment = await sessionApi.attachGame(session.run);
    check(!stopRequested, 'SD browser stopped before opening the filesystem');
    storage = await require(path.join(sourceRoot, 'tools/dolphin-fs-rpc/storage.cjs'))
      .createStorage(attachment);
    check(storage.mounts.includes('sd'), 'This session does not expose the SD filesystem');
    check(!stopRequested, 'SD browser stopped before starting its FTP listener');
    const native = await require(path.join(sourceRoot, 'core/console/host/ftp-native.cjs'))
      .create(rpc, session.run);
    const scoped = readOnlySD(storage);
    ftp = require(path.join(sourceRoot, 'core/console/host/ftp-server.cjs')).create({
      ...native, storage: scoped, readOnly: true, greeting: 'BrendanLauncher SD export, read-only'
    });
    await ftp.start(port);
    pumping = (async () => {
      while (!stopped) {
        await ftp.pump();
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    })();
    pumping.catch(error => { failure ||= error; requestStop(); });

    const listing = await library.probeFtp(session.host, port);
    check(listing.some(line => /(?:^|\s)sd$/.test(line)), 'FTP did not verify the /sd root');
    check(!stopRequested, 'SD browser stopped before readiness');
    panel = await require(path.join(BROWSER, 'panel-server.cjs')).createPanel(scoped,
      {ftpURL: 'ftp://' + session.host + ':' + port + '/sd/'});
    onEvent('ready', {url: 'ftp://' + session.host + ':' + port + '/sd/',
      browserURL: panel.url, port, mount: '/sd', readOnly: true,
      message: 'Read-only SD browser and FTP are ready'});
    await open(panel.url);

    let checkedAt = Date.now();
    while (!stopRequested) {
      await new Promise(resolve => setTimeout(resolve, 250));
      if (Date.now() - checkedAt >= 10000) {
        await assertSessionLive(session, rpc);
        checkedAt = Date.now();
      }
    }
  } catch (error) { failure = error; }
  finally {
    try { await panel?.close(); } catch (error) { failure ||= error; }
    stopped = true;
    try { await pumping; } catch (error) { failure ||= error; }
    try { await ftp?.stop(); } catch (error) { failure ||= error; }
    try { await attachment?.close(); } catch (error) { failure ||= error; }
    process.off('SIGTERM', requestStop);
    process.off('SIGINT', requestStop);
    input?.off('line', stopInput);
    input?.close();
  }
  if (failure) throw failure;
  onEvent('stopped', {message: 'Read-only SD browser stopped cleanly'});
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--run') options.run = argv[++i];
    else if (arg === '--host') options.host = argv[++i];
    else if (arg === '--ns2jb') options.ns2jb = argv[++i];
    else if (arg === '--no-open') options.noOpen = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw Error('Unknown option: ' + arg);
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Usage: node host/sd-browser.cjs --run <ns2jb/runs/switch2-...> --host <Switch IPv4> [--ns2jb <checkout>] [--no-open]');
    return;
  }
  const ns2jbDirectory = path.resolve(options.ns2jb || process.env.HBL_NS2JB ||
    path.join(ROOT, '..', 'ns2jb-kurumuz'));
  const runDirectory = options.run || require('./lib/session.cjs').newestRun(ns2jbDirectory);
  check(runDirectory, 'No ns2jb run found; provide --run <held-run-directory>');
  const host = options.host || process.env.HBL_RPC_TARGET;
  check(net.isIPv4(host || ''), 'Provide --host <Switch IPv4> or set HBL_RPC_TARGET');
  if (options.noOpen) process.env.HBL_SD_NO_OPEN = '1';
  await runBrowser(runDirectory, host, {ns2jbDirectory});
}

module.exports = {verifyBundledSource, privateJson, verifyHeldRun, checkedSDPath,
  readOnlySD, assertSessionLive, runBrowser, parseArgs};

if (require.main === module) main().catch(error => {
  emit('failed', {message: error.message});
  process.exitCode = 1;
});
