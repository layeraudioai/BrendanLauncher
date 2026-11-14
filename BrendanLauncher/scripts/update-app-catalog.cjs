'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const APP_ROOT = path.join(ROOT, 'apps');
const OUTPUT = path.join(ROOT, 'data', 'app-catalog.json');
const KINDS = {native: 0, nes: 1, sm64: 2};
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function validateManifest(manifest, directory) {
  const label = path.basename(directory);
  if (!ID_PATTERN.test(manifest.id || '')) throw Error(`${label}: invalid id`);
  if (typeof manifest.name !== 'string' || !manifest.name) throw Error(`${label}: missing name`);
  if (!Object.prototype.hasOwnProperty.call(KINDS, manifest.kind)) throw Error(`${label}: unsupported kind`);
  if (manifest.abi !== 3) throw Error(`${label}: unsupported ABI ${manifest.abi}`);
  const version = /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/.exec(String(manifest.version || ''));
  if (!version) {
    throw Error(`${label}: version must be x.y.z`);
  }
  const [major, minor, patch] = version.slice(1).map(Number);
  if (major > 0xffff || minor > 0xff || patch > 0xff) throw Error(`${label}: version is out of range`);
  if (manifest.description !== undefined && typeof manifest.description !== 'string') {
    throw Error(`${label}: description must be a string`);
  }
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description || '',
    version: manifest.version,
    kind: manifest.kind,
    abi: manifest.abi
  };
}

async function buildCatalog(appRoot = APP_ROOT) {
  const entries = await fs.readdir(appRoot, {withFileTypes: true});
  const apps = [], ids = new Set();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const directory = path.join(appRoot, entry.name);
    const manifestFile = path.join(directory, 'manifest.json');
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw Error(`${entry.name}: could not read manifest.json: ${error.message}`);
    }
    const app = validateManifest(manifest, directory);
    if (ids.has(app.id)) throw Error(`${entry.name}: duplicate app id ${app.id}`);
    ids.add(app.id);
    apps.push(app);
  }

  apps.sort((a, b) => KINDS[a.kind] - KINDS[b.kind] || a.name.localeCompare(b.name));
  return {format: 'brendanlauncher.app-catalog/1', apps};
}

async function updateAppCatalog({appRoot = APP_ROOT, output = OUTPUT} = {}) {
  const catalog = await buildCatalog(appRoot);
  await fs.mkdir(path.dirname(output), {recursive: true});
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`);
    await fs.rename(temporary, output);
  } catch (error) {
    await fs.rm(temporary, {force: true});
    throw error;
  }
  console.log(`[AIO] Updated app catalog (${catalog.apps.length} packages): ${output}`);
  return catalog;
}

if (require.main === module) {
  updateAppCatalog().catch(error => {
    console.error('[AIO] App catalog update failed:', error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {buildCatalog, updateAppCatalog};
