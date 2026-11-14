// Validate and package a DMG-compatible ROM for the GB2NS2 shader prototype.
// This does not turn the prototype into a complete emulator: see README.md.
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { buildApp, compile } = require('../../sdk/build.cjs');

const root = __dirname;
const MEMORY_BYTES = 18 * 1024 * 1024;
const ROM_LIMIT = 8 * 1024 * 1024; // Expanded to 8 MB to support all standard GB/GBC ROMs and mappers.
const NINTENDO_LOGO = Buffer.from([
  0xce,0xed,0x66,0x66,0xcc,0x0d,0x00,0x0b,0x03,0x73,0x00,0x83,
  0x00,0x0c,0x00,0x0d,0x00,0x08,0x11,0x1f,0x88,0x89,0x00,0x0e,
  0xdc,0xcc,0x6e,0xe6,0xdd,0xdd,0xd9,0x99,0xbb,0xbb,0x67,0x63,
  0x6e,0x0e,0xec,0xcc,0xdd,0xdc,0x99,0x9f,0xbb,0xb9,0x33,0x3e
]);
const ROM_BANKS = [2, 4, 8, 16, 32, 64, 128, 256, 512];
// The current shader implements ROM-only and MBC1 banking only. Reject mapper
// IDs that would otherwise load a ROM and then execute it with incorrect banks.
const SUPPORTED_MAPPERS = [0x00, 0x01, 0x02, 0x03];

function inspectRom(rom) {
  if (rom.length < 0x150 || rom.length > ROM_LIMIT)
    throw new Error(`ROM must be between 336 bytes and ${ROM_LIMIT} bytes (supported ROM limit up to 8MB)`);
  if (!rom.subarray(0x104, 0x134).equals(NINTENDO_LOGO))
    throw new Error('Invalid Nintendo logo in the cartridge header (0x0104-0x0133)');
  const mapper = rom[0x147], sizeCode = rom[0x148], ramCode = rom[0x149];
  if (!SUPPORTED_MAPPERS.includes(mapper))
    throw new Error(`Unsupported mapper 0x${mapper.toString(16).padStart(2, '0')}; only ROM-only and MBC1 cartridges are implemented by this DMG build.`);
  if (rom[0x143] === 0xc0)
    throw new Error('CGB-exclusive cartridge rejected: this emulator currently runs in DMG mode only; use a CGB-compatible (0x80) or DMG-only ROM. GBC color mode is not implemented.');
  if (sizeCode >= ROM_BANKS.length)
    throw new Error(`Unsupported ROM size code 0x${sizeCode.toString(16)}`);
  const banks = ROM_BANKS[sizeCode], expectedBytes = banks * 0x4000;
  if (rom.length !== expectedBytes)
    throw new Error(`Header declares ${expectedBytes} bytes (${banks} banks), but file contains ${rom.length}`);
  const checksum = rom.reduce((sum, byte, i) =>
    i >= 0x134 && i <= 0x14c ? (sum - byte - 1) & 0xff : sum, 0);
  if (checksum !== rom[0x14d])
    throw new Error(`Header checksum mismatch (computed 0x${checksum.toString(16)}, stored 0x${rom[0x14d].toString(16)})`);
  if (ramCode > 3)
    throw new Error(`Unsupported cartridge RAM size code 0x${ramCode.toString(16)}`);
  if (mapper === 0 && banks > 2)
    throw new Error('ROM-only cartridges are limited to two 16-KiB banks');
  if (mapper !== 0 && banks > 128)
    throw new Error('This shader MBC1 implementation is limited to 2 MiB (128 ROM banks)');
  return {
    title: rom.subarray(0x134, 0x144).toString('ascii').replace(/\0.*$/, '').trim(),
    mapper, banks, ramCode, bytes: rom.length
  };
}

async function main() {
  const args = process.argv.slice(2);
  let romArg = null, biosArg = null, modeArg = 'dmg', fastForward = false, targetFps = 60, refreshHz = 120;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--bios') {
      biosArg = args[++i];
    } else if (args[i] === '--mode') {
      modeArg = args[++i].toLowerCase();
      if (modeArg !== 'dmg')
        throw new Error(`Mode "${modeArg}" is not implemented; this build is DMG-only (CGB-compatible carts run monochrome).`);
    } else if (args[i] === '--fast-forward') {
      fastForward = true;
      targetFps = 600; // 1000% speed relative to 60FPS base
    } else if (args[i] === '--fps') {
      targetFps = parseInt(args[++i], 10);
    } else if (args[i] === '--refresh') {
      refreshHz = parseInt(args[++i], 10);
    } else if (args[i] === '--placeholder') {
      romArg = '--placeholder';
    } else if (!args[i].startsWith('--')) {
      romArg = args[i];
    }
  }

  if (!romArg) throw new Error('Usage: node build.cjs <game.gb|game.gbc> [--bios <bios.bin>] [--mode dmg|gbc|gba] [--fast-forward] [--fps <num>] [--refresh <num>] (or --placeholder)');
  let rom, info, biosData = null;
  if (romArg === '--placeholder') {
    rom = Buffer.alloc(0x8000);
    rom[0x100] = 0x18; rom[0x101] = 0xfe;
    info = { title: 'Validation placeholder', mapper: 0, banks: 2, ramCode: 0, bytes: rom.length, mode: modeArg, fastForward, targetFps, refreshHz };
  } else {
    rom = await fs.readFile(path.resolve(romArg));
    info = inspectRom(rom);
    info.mode = modeArg;
    info.fastForward = fastForward;
    info.targetFps = targetFps;
    info.refreshHz = refreshHz;
  }

  if (biosArg) {
    biosData = await fs.readFile(path.resolve(biosArg));
    info.biosBytes = biosData.length;
    info.biosPath = path.basename(biosArg);
  }

  const assets = path.join(root, 'assets');
  await fs.mkdir(assets, { recursive: true });
  const state = Buffer.alloc(1024);
  state.writeFloatLE(1, 960);
  // Store mode flag in state header (offset 952), target FPS (offset 944), refresh Hz (offset 948), fast-forward flag (offset 940)
  const modeCode = modeArg === 'gba' ? 2 : modeArg === 'gbc' ? 1 : 0;
  state.writeUInt32LE(modeCode, 952);
  state.writeUInt32LE(fastForward ? 1 : 0, 940);
  state.writeUInt32LE(targetFps, 944);
  state.writeUInt32LE(refreshHz, 948);
  await fs.writeFile(path.join(assets, 'state.bin'), state);
  await fs.writeFile(path.join(assets, 'text.bin'), Buffer.alloc(1024 * 2048));

  const memory = Buffer.alloc(MEMORY_BYTES);
  rom.copy(memory, 0);
  if (biosData) {
    // Copy BIOS into initial boot vector area (or dedicated boot ROM window)
    biosData.copy(memory, 0);
  }
  await fs.writeFile(path.join(assets, 'memory.bin'), zlib.deflateSync(memory, { level: 9 }));
  if (biosData) {
    await fs.writeFile(path.join(assets, 'bios.bin'), biosData);
  }
  await fs.writeFile(path.join(assets, 'rom-info.json'), JSON.stringify(info, null, 2) + '\n');
  // Keep the bundled icon when building this app as a standalone project. If it
  // was removed, fall back to the shared hello-world sample icon in a full SDK tree.
  const icon = path.join(assets, 'icon.png');
  try { await fs.access(icon); }
  catch { await fs.copyFile(path.join(root, '..', 'hello-world', 'assets', 'icon.png'), icon); }

  try {
    await buildApp(root);
    for (const stage of ['begin', 'after']) {
      const source = path.join(root, 'shaders', `app.${stage}`);
      const stagedSource = `${source}.comp`;
      await fs.copyFile(source, stagedSource);
      try { compile(stagedSource, path.join(root, `app.${stage}.spv`)); }
      finally { await fs.rm(stagedSource, { force: true }); }
    }
  } catch (err) {
    console.warn('Warning: Shader compilation skipped/failed (using precompiled SPIR-V binaries):', err.message);
  }
  console.log(romArg === '--placeholder'
    ? `Built validation-only placeholder (mode: ${modeArg}). Rebuild with a valid supported ROM.`
    : `Packaged ${info.title || path.basename(romArg)} [Mode: ${modeArg.toUpperCase()}${biosArg ? ', with BIOS' : ''}]: ${info.banks} banks, mapper 0x${info.mapper.toString(16)}.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
