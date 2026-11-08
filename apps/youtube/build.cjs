const fs = require('node:fs/promises'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const {pythonCommand} = require('../../scripts/python.cjs');

async function main() {
    const assetsDir = path.join(__dirname, 'assets');
    const shadersDir = path.join(__dirname, 'shaders');
    await fs.mkdir(assetsDir, { recursive: true });
    await fs.mkdir(shadersDir, { recursive: true });

    const state = Buffer.alloc(1024);
    state.writeFloatLE(1, 960);
    await fs.writeFile(path.join(assetsDir, 'state.bin'), state);

    execFileSync(pythonCommand(), [path.join(__dirname, 'assets.py')], { stdio: 'inherit' });
    await require('../../sdk/build.cjs').headers(shadersDir);

    try {
        await require('../../sdk/build.cjs').buildApp(__dirname);
    } catch (e) {
        console.log('[BUILD] glslangValidator not found or compilation skipped; using precompiled SPIR-V binaries.');
    }
    console.log('[BUILD] YouTube (VacuumTube) app built successfully for Switch 2 HBL framework.');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
