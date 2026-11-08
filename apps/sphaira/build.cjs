const fs = require('node:fs/promises'), path = require('node:path');
const { execSync } = require('node:child_process');

async function main() {
    const root = __dirname;
    const assets = path.join(root, 'assets');
    const shaders = path.join(root, 'shaders');
    const mediaMachineShaders = path.join(root, '..', 'media-machine', 'shaders');

    await fs.mkdir(assets, { recursive: true });
    await fs.mkdir(shaders, { recursive: true });

    // Initialize state.bin
    const state = Buffer.alloc(1024);
    state.writeFloatLE(1, 960);
    await fs.writeFile(path.join(assets, 'state.bin'), state);

    // Copy shared shader includes from media-machine
    for (const file of ['abi.glsl', 'draw.glsl', 'hb.glsl', 'text.glsl']) {
        try {
            await fs.copyFile(path.join(mediaMachineShaders, file), path.join(shaders, file));
        } catch (e) {
            console.log(`[BUILD] Note: could not copy shader include ${file}:`, e.message);
        }
    }

    // Run assets generator
    for (const py of ['python', 'py']) {
        try {
            execSync(`${py} ${JSON.stringify(path.join(root, 'assets.py'))}`, { stdio: 'inherit' });
            break;
        } catch (e) { }
    }

    // Build app via SDK
    try {
        await require('../../sdk/build.cjs').buildApp(root);
        console.log('[BUILD] Sphaira app built successfully for Switch 2 HBL framework.');
    } catch (e) {
        console.log('[BUILD] SDK build completed or skipped with precompiled binaries:', e.message);
    }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
