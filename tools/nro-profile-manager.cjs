'use strict';
/*
 * Non-destructive NRO profile manager.
 * Stores user-provided donor/payload files and their hashes for a future
 * compatible homebrew runtime. It never edits installed titles or launches NRO.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { randomUUID } = require('node:crypto');
const DEFAULT_ROOT = path.resolve(__dirname, '../data/nro-profiles');
const MAX_FILE = 512 * 1024 * 1024;
function check(ok, message) { if (!ok) throw new Error(message); }
function validId(value) { check(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value) && value !== '.' && value !== '..', 'Profile id must be 1-64 safe filename characters'); return value; }
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function nro(bytes) { return bytes.length >= 0x80 && bytes.toString('ascii', 0x10, 0x14) === 'NRO0'; }
async function readNro(filename) {
  const stat = await fs.stat(filename);
  check(stat.isFile() && stat.size >= 0x80 && stat.size <= MAX_FILE, `Invalid NRO file size: ${filename}`);
  const bytes = await fs.readFile(filename);
  check(nro(bytes), `File does not have an NRO0 header at 0x10: ${filename}`);
  return {bytes, name: path.basename(filename), sha256: sha(bytes), size: bytes.length};
}
async function atomicWrite(filename, bytes, {exclusive = false} = {}) {
  await fs.mkdir(path.dirname(filename), {recursive: true});
  if (exclusive) {
    const handle = await fs.open(filename, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    return;
  }
  const tmp = filename + '.' + randomUUID() + '.tmp';
  try {
    const handle = await fs.open(tmp, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(tmp, filename);
  } finally { await fs.rm(tmp, {force: true}); }
}
async function createProfile({id, donor, payload, root = DEFAULT_ROOT, donorLabel = '', titleId = ''}) {
  id = validId(id); root = path.resolve(root);
  check(!titleId || /^[0-9a-fA-F]{16}$/.test(titleId), 'Optional title id must be exactly 16 hexadecimal characters');
  const donorFile = await readNro(donor), payloadFile = await readNro(payload);
  check(path.resolve(donor) !== path.resolve(payload), 'Donor and payload must be different files');
  const directory = path.join(root, id);
  await fs.mkdir(root, {recursive: true});
  await fs.mkdir(directory, {recursive: false}); // Never replace an existing profile.
  try {
    await atomicWrite(path.join(directory, 'donor-original.nro'), donorFile.bytes, {exclusive: true});
    await atomicWrite(path.join(directory, 'payload.nro'), payloadFile.bytes, {exclusive: true});
    const manifest = {
      format: 'brendanlauncher.nro-profile', version: 1, id,
      titleId: titleId || null, donorLabel: String(donorLabel).slice(0, 120),
      createdAt: new Date().toISOString(),
      donorOriginal: {file: 'donor-original.nro', sourceName: donorFile.name, bytes: donorFile.size, sha256: donorFile.sha256},
      payload: {file: 'payload.nro', sourceName: payloadFile.name, bytes: payloadFile.size, sha256: payloadFile.sha256},
      state: 'staged-only',
      warning: 'No NRO loader/injector is configured. This profile is archival and is not bootable.'
    };
    await atomicWrite(path.join(directory, 'profile.json'), Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), {exclusive: true});
    return manifest;
  } catch (error) { await fs.rm(directory, {recursive: true, force: true}); throw error; }
}
async function verifyProfile({id, root = DEFAULT_ROOT}) {
  id = validId(id); const directory = path.join(path.resolve(root), id);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'profile.json'), 'utf8'));
  check(manifest.format === 'brendanlauncher.nro-profile' && manifest.version === 1 && manifest.id === id && manifest.state === 'staged-only', 'Invalid profile metadata');
  for (const key of ['donorOriginal', 'payload']) {
    const entry = manifest[key]; check(entry && /^[a-f0-9]{64}$/.test(entry.sha256), `Invalid ${key} hash`);
    check(path.basename(entry.file) === entry.file, `Unsafe ${key} path`);
    const bytes = await fs.readFile(path.join(directory, entry.file));
    check(nro(bytes) && bytes.length === entry.bytes && sha(bytes) === entry.sha256, `${key} failed NRO/hash verification`);
  }
  return manifest;
}
async function restoreDonor({id, output, root = DEFAULT_ROOT}) {
  const manifest = await verifyProfile({id, root});
  check(typeof output === 'string' && output.length > 0, 'Specify a new output path');
  const out = path.resolve(output); const bytes = await fs.readFile(path.join(path.resolve(root), validId(id), manifest.donorOriginal.file));
  await atomicWrite(out, bytes, {exclusive: true}); // refuse to clobber any file
  return {output: out, sha256: manifest.donorOriginal.sha256, bytes: bytes.length};
}
function parse(argv) {
  const [command, ...rest] = argv; const options = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]; if (!arg.startsWith('--') || !rest[i + 1]) throw new Error(`Invalid argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!['id','donor','payload','root','donorLabel','titleId','output'].includes(key)) throw new Error(`Unknown option: ${arg}`);
    check(options[key] === undefined, `Duplicate option: ${arg}`); options[key] = rest[++i];
  }
  return {command, options};
}
async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && ['--help','-h'].includes(argv[0])) {
    console.log('NRO profile manager (staging only; no NRO execution or title injection)\n\ncreate --id ID --donor donor.nro --payload app.nro [--title-id 16HEX] [--donor-label NAME] [--root DIR]\nverify --id ID [--root DIR]\nrestore-donor --id ID --output NEW_FILE.nro [--root DIR]'); return 0;
  }
  const {command, options} = parse(argv);
  if (command === 'create') console.log(JSON.stringify(await createProfile(options), null, 2));
  else if (command === 'verify') console.log(JSON.stringify(await verifyProfile(options), null, 2));
  else if (command === 'restore-donor') console.log(JSON.stringify(await restoreDonor(options), null, 2));
  else throw new Error('Command must be create, verify, or restore-donor. Use --help.');
  return 0;
}
if (require.main === module) main().then(code => {process.exitCode = code;}).catch(error => {console.error('NRO profile manager:', error.message); process.exitCode = 1;});
module.exports = {DEFAULT_ROOT, validId, nro, readNro, createProfile, verifyProfile, restoreDonor, parse};
