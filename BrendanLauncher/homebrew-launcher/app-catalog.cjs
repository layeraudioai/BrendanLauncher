const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { inflateSync } = require('node:zlib');
const run = promisify(execFile);
const ROOT = path.resolve(__dirname, '../apps'), MAX_APPS = 32, SLOT_BYTES = 131072, ATLAS_BYTES = 1024 * 2048;
const STREAM_WINDOW_OFFSET = 6 * 1024 * 1024, MAX_STREAM_BYTES = 512 * 1024 * 1024;
const check = (v, m) => { if (!v) throw Error(m); };
async function asset(root, name, max) {
    check(typeof name === 'string' && name.length > 0 && !path.isAbsolute(name) && !name.split(/[\\/]/).includes('..'), 'Asset path must stay inside its app');
    const file = await fs.realpath(path.resolve(root, name)); check(file.startsWith(root + path.sep), 'Asset escapes its app folder');
    const stat = await fs.stat(file); check(stat.isFile() && stat.size > 0 && stat.size <= max, 'Invalid asset size: ' + name);
    return { file, bytes: await fs.readFile(file) };
}
async function readApp(directory, { validate = true } = {}) {
    const root = await fs.realpath(directory);
    let manifestPath = path.join(root, 'app.json');
    let assetRoot = root;
    if (!await fs.access(manifestPath).then(() => true, () => false)) {
        manifestPath = path.join(root, 'switch/app.json');
        assetRoot = path.join(root, 'switch');
    }
    const manifestAsset = await asset(assetRoot, path.relative(assetRoot, manifestPath), 16384), m = JSON.parse(manifestAsset.bytes);
    let nativeManifest;
    try { nativeManifest = await fs.readFile(path.join(root, 'manifest.json'), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (nativeManifest) {
        const nativeId = JSON.parse(nativeManifest).id;
        if (typeof nativeId === 'string') check(nativeId === m.id, 'GPU app id does not match native package id');
    }
    check((m.format === 'hblauncher.gpu-app' || m.format === 'izlauncher.app') && m.abi === 1, 'Unsupported app format/ABI');
    check(m.format !== 'izlauncher.app' || m.displayOnly === true || m.builtin === true || !!m.shaders, 'IZ metadata-only package; mark displayOnly or provide executable GPU shaders');
    check(m.displayOnly === undefined || typeof m.displayOnly === 'boolean', 'Invalid displayOnly flag');
    check(m.hostRuntime === undefined || /^module:[a-z0-9-]+\/[A-Za-z0-9-]+$/.test(m.hostRuntime), 'Invalid module host runtime');
    check(m.builtin === undefined || (/^[a-z0-9][a-z0-9-]{0,47}$/.test(m.builtin) && Number.isInteger(m.shellContribution?.scene) && m.shellContribution.scene >= 2 && m.shellContribution.scene <= 8), 'Invalid shell contribution');
    check(typeof m.id === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(m.id), 'Invalid app id');
    check(typeof m.name === 'string' && m.name.trim().length > 0 && m.name.length <= 64, 'Invalid app name');
    check(typeof m.version === 'string' && m.version.length <= 32, 'Invalid version');
    check(typeof m.description === 'string' && m.description.length <= 160, 'Invalid description');
    check(m.transition === undefined || m.transition === 'none' || m.transition === 'fade', 'Invalid transition');
    check(m.service === undefined, 'Unsupported host service');
    check(m.streamedAssets === undefined || Array.isArray(m.streamedAssets) && m.streamedAssets.length <= 48,
        'Invalid streamed asset list');
    if (m.sdk) require('../sdk/host/runtime.cjs').validateManifest(m.sdk);
    const files = {}, hash = crypto.createHash('sha256'); hash.update(manifestAsset.bytes);
    if (m.computeSequence !== undefined) { check(m.computeSequence && Number.isInteger(m.computeSequence.repeat) && m.computeSequence.repeat >= 1 && m.computeSequence.repeat <= 512, 'Invalid compute sequence repeat'); check(typeof m.computeSequence.begin === 'string' && typeof m.computeSequence.after === 'string', 'Invalid compute sequence shaders'); }
    check(m.shaderEncoding === undefined || m.shaderEncoding === 'deflate', 'Unsupported shaderEncoding');
    const stages = [['vertex', 0, m.shaders?.vertex], ['fragment', 4, m.shaders?.fragment], ['compute', 5, m.shaders?.compute]];
    if (m.computeSequence) stages.push(['computeBegin', 5, m.computeSequence.begin], ['computeAfter', 5, m.computeSequence.after]);
    for (const [stage, model, name] of stages) {
        if (!name) continue;
        const item = await asset(assetRoot, name, 1048576);
        const b = m.shaderEncoding === 'deflate' || name.toLowerCase().endsWith('.deflate')
            ? inflateSync(item.bytes, { maxOutputLength: 1048576 }) : item.bytes;
        check(b.length >= 20 && b.length % 4 === 0 && b.readUInt32LE() === 0x07230203, 'Invalid SPIR-V ' + stage);
        let entry = false; for (let i = 5; i < b.length / 4;) { const word = b.readUInt32LE(i * 4), count = word >>> 16, op = word & 65535; check(count > 0 && i + count <= b.length / 4, 'Malformed SPIR-V instruction'); if (op === 15 && count >= 4 && b.readUInt32LE((i + 1) * 4) === model) { const name = b.subarray((i + 3) * 4, (i + count) * 4).toString('utf8').split('\0')[0]; if (name === 'main') entry = true; } i += count; }
        check(entry, 'Missing ' + stage + ' main entry point');
        files[stage] = { ...item, bytes: b }; hash.update(stage).update(b);
    }
    if (m.initialState) {
        files.state = await asset(assetRoot, m.initialState, 1024); check(files.state.bytes.length === 1024, 'Initial state must be 1024 bytes'); hash.update(files.state.bytes);
    } else {
        files.state = { file: path.join(assetRoot, 'state.bin'), bytes: Buffer.alloc(1024) };
    }
    if (m.data) {
        files.data = await asset(assetRoot, m.data, 512 * 1024 * 1024); hash.update(files.data.bytes);
    } else {
        files.data = { file: path.join(assetRoot, 'data.bin'), bytes: Buffer.alloc(0) };
    }
    const streamedAssets = [];
    let streamedBytes = 0;
    for (const [index, item] of (m.streamedAssets || []).entries()) {
        check(item && item.id === index + 1 && typeof item.file === 'string',
            'Streamed asset IDs must be sequential and each asset needs a file');
        check(!path.isAbsolute(item.file) && !item.file.split(/[\\/]/).includes('..'),
            'Asset path must stay inside its app');
        const file = await fs.realpath(path.resolve(assetRoot, item.file));
        check(file.startsWith(assetRoot + path.sep), 'Asset escapes its app folder');
        const stat = await fs.stat(file);
        check(stat.isFile() && stat.size > 0 && stat.size <= MAX_STREAM_BYTES,
            'Invalid streamed asset size: ' + item.file);
        streamedBytes += stat.size;
        check(streamedBytes <= MAX_STREAM_BYTES, 'Streamed assets exceed the 512 MiB package limit');
        hash.update(String(item.id));
        for await (const chunk of require('node:fs').createReadStream(file)) hash.update(chunk);
        streamedAssets.push({ id: item.id, file, size: stat.size });
    }
    if (streamedAssets.length)
        check(files.data.bytes.length <= STREAM_WINDOW_OFFSET,
            'Apps with streamed assets may use at most 6 MiB of inline data');
    if (m.memory !== undefined) {
        check(m.memory && Number.isInteger(m.memory.bytes) && m.memory.bytes >= 4096 && m.memory.bytes <= 32 * 1024 * 1024 && m.memory.bytes % 4096 === 0, 'Invalid private GPU memory size');
        check(m.memory.encoding === undefined || m.memory.encoding === 'deflate', 'Unsupported private memory encoding');
        const item = await asset(assetRoot, m.memory.initial, 32 * 1024 * 1024); hash.update(item.bytes);
        const bytes = m.memory.encoding === 'deflate' ? inflateSync(item.bytes, { maxOutputLength: m.memory.bytes }) : item.bytes;
        check(bytes.length <= m.memory.bytes, 'Private GPU memory image exceeds allocation'); files.memory = { ...item, bytes, allocationBytes: m.memory.bytes };
    }
    files.icon = await asset(assetRoot, m.icon, 2 * 1024 * 1024); hash.update(files.icon.bytes);
    const icon = files.icon.bytes;
    check(icon.length >= 33 && icon.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Icon must be a valid PNG image');
    const effects = {};
    check(m.audio === undefined || (m.audio.sampleRate === 48000 && m.audio.channels === 2 && m.audio.format === 's16le'), 'Unsupported audio format');
    for (const [id, name] of Object.entries(m.audio?.effects || {})) {
        check(/^(?:[1-9]|[12][0-9]|3[01])$/.test(id), 'Sound event ids must be 1..31');
        check(typeof name === 'string' && name.length > 0 && !path.isAbsolute(name) && !name.split(/[\\\\/]/).includes('..'), 'Asset path must stay inside its app');
        const file = await fs.realpath(path.resolve(assetRoot, name)); check(file.startsWith(assetRoot + path.sep), 'Asset escapes its app folder');
        const stat = await fs.stat(file); check(stat.isFile() && stat.size > 0 && stat.size <= 512 * 1024 * 1024 && stat.size % 4 === 0, 'Invalid audio asset: ' + name);
        effects[id] = file; hash.update(id);
        for await (const chunk of require('node:fs').createReadStream(file)) hash.update(chunk);
    }
    return { id: m.id, name: m.name.trim(), version: m.version, description: m.description, root, manifest: m, files, effects, streamedAssets, fingerprint: hash.digest('hex') };
}
async function scan(root = ROOT) {
    root = path.resolve(root); let entries; try { entries = await fs.readdir(root, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return { root, apps: [], rejected: [] }; throw error; }
    const apps = [], rejected = [], ids = new Set();
    async function isFile(file) {
        try { return (await fs.stat(file)).isFile(); }
        catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const folder = path.join(root, entry.name);
        if (!await isFile(path.join(folder, 'app.json')) && !await isFile(path.join(folder, 'switch/app.json'))) continue;
        try { check(apps.length < MAX_APPS, 'Catalog limit is 32 apps'); const app = await readApp(folder); check(!ids.has(app.id), 'Duplicate app id'); ids.add(app.id); apps.push(app); }
        catch (error) { rejected.push({ folder: entry.name, error: error.message }); }
    }
    return { root, apps, rejected };
}
function summary(catalog) { return { root: catalog.root, apps: catalog.apps.map(a => ({ id: a.id, name: a.name, version: a.version, description: a.description, root: a.root, fingerprint: a.fingerprint, effects: a.effects })), rejected: catalog.rejected }; }
async function raster(catalog, directory, label = 'catalog') {
    const input = path.join(directory, label + '.json'), output = path.join(directory, label + '.bin');
    const labels = [];
    for (const [i, a] of catalog.apps.entries()) {
        const icon = path.join(directory, label + '-icon-' + i + '.png'); await fs.writeFile(icon, a.files.icon.bytes);
        labels.push({ name: a.name, description: a.description, icon, transition: a.manifest.transition });
    }
    await fs.writeFile(input, JSON.stringify(labels, null, 2));
    let success = false;
    const preferred = process.env.PYTHON || process.env.PYTHON3 || 'python3';
    for (const pyCmd of [...new Set([preferred, 'python', 'py'])]) {
        try {
            await run(pyCmd, [path.join(__dirname, 'catalog-assets.py'), input, output], { timeout: 15000, maxBuffer: 65536 });
            success = true;
            break;
        } catch (e) { }
    }
    if (!success) throw Error('Failed to run catalog-assets.py with python, or py.');
    const bytes = await fs.readFile(output); check(bytes.length === MAX_APPS * SLOT_BYTES, 'Invalid catalog raster'); return bytes;
}
module.exports = {
    ROOT, MAX_APPS, SLOT_BYTES, ATLAS_BYTES, STREAM_WINDOW_OFFSET,
    asset, readApp, scan, summary, raster
};
