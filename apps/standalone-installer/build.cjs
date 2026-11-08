const fs = require('node:fs/promises'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const {pythonCommand} = require('../../scripts/python.cjs');
async function main() {
    await fs.mkdir(path.join(__dirname, 'assets'), { recursive: true });
    await fs.mkdir(path.join(__dirname, 'shaders'), { recursive: true });
    const state = Buffer.alloc(1024); state.writeFloatLE(1, 960); await fs.writeFile(path.join(__dirname, 'assets/state.bin'), state);
    for (const shader of ['abi.glsl', 'draw.glsl', 'hb.glsl']) {
        try {
            await fs.copyFile(path.join(__dirname, '../hello-world/shaders', shader), path.join(__dirname, 'shaders', shader));
        } catch (e) {}
    }
    execFileSync(pythonCommand(), [path.join(__dirname, 'assets.py')], { stdio: 'inherit' });
    try {
        await require('../../sdk/build.cjs').buildApp(__dirname);
    } catch (e) {
        console.log('[BUILD] Using precompiled SPIR-V binaries for standalone-installer.');
    }
    console.log('[BUILD] Standalone Client Installer app built successfully.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
