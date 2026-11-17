'use strict';

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Abi1ProjectSeeds = api;
})(globalThis, function (root) {
  const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
  const HEADER_SIZE = 22; // p + codec flag + seven base36 length digits + 64-bit checksum
  const MAX_BYTES = 40 * 1024 * 1024;
  const MAX_PROCEDURAL_SEED_CHARS = 65536;
  const MAX_SEED_CHARS = Math.ceil(MAX_BYTES / 4) * 7 + HEADER_SIZE;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });

  function toBase36(value, width) {
    let n = BigInt(value);
    let result = '';
    do { result = ALPHABET[Number(n % 36n)] + result; n /= 36n; } while (n > 0n);
    if (result.length > width) throw new Error('Seed payload is too large');
    return result.padStart(width, '0');
  }

  function fromBase36(text) {
    let value = 0;
    for (const char of text) {
      const digit = ALPHABET.indexOf(char);
      if (digit < 0) throw new Error('Seed contains characters outside the a-z 0-9 alphabet');
      value = value * 36 + digit;
      if (!Number.isSafeInteger(value)) throw new Error('Seed length header is invalid');
    }
    return value;
  }

  function packBytes(bytes) {
    let output = '';
    for (let offset = 0; offset < bytes.length; offset += 4) {
      const length = Math.min(4, bytes.length - offset);
      let value = 0n;
      for (let i = 0; i < 4; i++) value = (value << 8n) | BigInt(i < length ? bytes[offset + i] : 0);
      output += toBase36(value, 7);
    }
    return output;
  }

  function unpackBytes(text, length) {
    const blocks = Math.ceil(length / 4);
    if (text.length !== blocks * 7) throw new Error('Project seed is truncated or has invalid length');
    const output = new Uint8Array(length);
    let cursor = 0;
    for (let offset = 0; offset < text.length; offset += 7) {
      const value = BigInt(fromBase36(text.slice(offset, offset + 7)));
      if (value > 0xffffffffn) throw new Error('Project seed contains an invalid data block');
      for (let i = 3; i >= 0 && cursor < length; i--) {
        output[cursor++] = Number((value >> BigInt(i * 8)) & 255n);
      }
    }
    return output;
  }

  async function transformBytes(bytes, mode) {
    if (typeof CompressionStream === 'function' && typeof DecompressionStream === 'function') {
      try {
        const stream = mode === 'compress'
          ? new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
          : new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
        const reader = stream.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > MAX_BYTES) {
            await reader.cancel();
            throw new Error('Decoded project exceeds the 32 MiB safety limit');
          }
          chunks.push(value);
        }
        const result = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
        return result;
      } catch (error) {
        if (error.message.includes('32 MiB')) throw error;
      }
    }
    if (typeof require === 'function') {
      const zlib = require('node:zlib');
      const result = mode === 'compress'
        ? zlib.deflateSync(bytes)
        : zlib.inflateSync(bytes, { maxOutputLength: MAX_BYTES });
      if (result.length > MAX_BYTES) throw new Error('Decoded project exceeds the 32 MiB safety limit');
      return new Uint8Array(result);
    }
    throw new Error(`This browser does not support project seed ${mode === 'compress' ? 'export' : 'import'}`);
  }

  async function encodeProject(project) {
    const raw = encoder.encode(JSON.stringify(project));
    if (raw.length > MAX_BYTES) throw new Error('Project is too large to encode (32 MiB maximum)');
    let compressed = raw;
    try { compressed = await transformBytes(raw, 'compress'); } catch (_) { /* Raw seeds work without compression APIs. */ }
    const useCompressed = compressed.length < raw.length;
    const payload = useCompressed ? compressed : raw;
    const header = `p${useCompressed ? 'c' : 'r'}${toBase36(payload.length, 7)}${hashBytes(payload).toString(36).padStart(13, '0')}`;
    return header + packBytes(payload);
  }

  function isProjectSeed(seed) {
    if (typeof seed !== 'string' || seed.length < HEADER_SIZE || !/^[p][cr][0-9a-z]+$/i.test(seed)) return false;
    try {
      const length = fromBase36(seed.slice(2, 9).toLowerCase());
      return length > 0 && length <= MAX_BYTES && seed.length === HEADER_SIZE + Math.ceil(length / 4) * 7;
    } catch (_) { return false; }
  }

  async function decodeProject(seed, model) {
    if (typeof seed !== 'string' || seed.length > MAX_SEED_CHARS || !/^[a-z0-9]+$/i.test(seed))
      throw new Error('Project seeds may contain only a-z and 0-9 and must be within the size limit');
    seed = seed.toLowerCase();
    if (seed.length < HEADER_SIZE || seed[0] !== 'p' || !['c', 'r'].includes(seed[1]))
      throw new Error('This is not an encoded project seed. Use Generate from Seed for a short seed.');
    const length = fromBase36(seed.slice(2, 9));
    if (length < 1 || length > MAX_BYTES) throw new Error('Project seed payload length is invalid');
    const payload = unpackBytes(seed.slice(HEADER_SIZE), length);
    const checksum = seed.slice(9, HEADER_SIZE);
    if (!/^[0-9a-z]{13}$/.test(checksum) || hashBytes(payload).toString(36).padStart(13, '0') !== checksum)
      throw new Error('Project seed checksum mismatch; the seed is incomplete or corrupted');
    let bytes = payload;
    if (seed[1] === 'c') bytes = await transformBytes(bytes, 'decompress');
    let value;
    try { value = JSON.parse(decoder.decode(bytes)); }
    catch (error) { throw new Error(`Project seed does not contain valid project JSON: ${error.message}`); }
    return model.normalizeProject(value);
  }

  function isShortSeed(seed) {
    const value = String(seed || '').trim();
    return value.length > 0 && value.length <= MAX_PROCEDURAL_SEED_CHARS && /^[a-z0-9]+$/i.test(value);
  }

  function seededMusic(seed) {
    const music = root.Abi1Music || (typeof require === 'function' ? require('./music-engine.js') : null);
    return music ? music.createSeededMusic(seed) : undefined;
  }

  function normalizeShortSeed(seed) {
    const value = String(seed || '').trim().toLowerCase();
    if (!value || value.length > MAX_PROCEDURAL_SEED_CHARS || !/^[a-z0-9]+$/.test(value))
      throw new Error(`A procedural seed must be 1–${MAX_PROCEDURAL_SEED_CHARS} characters using only a-z and 0-9`);
    return value;
  }

  function hashBytes(bytes) {
    let hash = 0xcbf29ce484222325n;
    for (const byte of bytes) {
      hash ^= BigInt(byte);
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash || 0x9e3779b97f4a7c15n;
  }

  function hashText(text) { return hashBytes(encoder.encode(text)); }

  function hashSeed(seed) { return hashText(normalizeShortSeed(seed)); }

  function createRandom(seed) {
    let state = hashSeed(seed);
    const mask = 0xffffffffffffffffn;
    return () => {
      state = (state + 0x9e3779b97f4a7c15n) & mask;
      let value = state;
      value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
      value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & mask;
      value ^= value >> 31n;
      return Number(value >> 11n) / 9007199254740992;
    };
  }

  function generatedName(random, index) {
    const left = ['Amber', 'Neon', 'Quiet', 'Cosmic', 'Pixel', 'Velvet', 'Nova', 'Tiny'];
    const right = ['Garden', 'Runner', 'Orbit', 'Quest', 'Arcade', 'Voyage', 'World', 'Lab'];
    return `${left[Math.floor(random() * left.length)]} ${right[Math.floor(random() * right.length)]} ${index + 1}`;
  }

  function generateProject(seed, model, scriptGenerator = root.Abi1ScriptGenerator || null) {
    seed = normalizeShortSeed(seed);
    const random = createRandom(seed);
    const project = model.createProject();
    project.app.id = `seed-${hashSeed(seed).toString(36)}`;
    project.app.name = generatedName(random, 0).slice(0, 64);
    project.app.description = `Procedurally generated from seed ${seed}`.slice(0, 160);
    const palette = ['#ff5c7a', '#52d6a4', '#ffd166', '#62a7ff', '#bb86fc', '#ff9f43', '#42d9e8', '#f3f5ff'];
    const count = 4 + Math.floor(random() * 9);
    const kinds = ['mesh', 'mesh', 'mesh', 'sprite'];
    for (let i = 0; i < count; i++) {
      const kind = kinds[Math.floor(random() * kinds.length)];
      const object = model.createObject(kind, i === 0 ? 'Player' : i === 1 ? 'Goal' : `Object ${i + 1}`);
      object.id = `seed-${hashSeed(seed).toString(36)}-${(i + 1).toString(36)}`;
      if (kind === 'mesh' && random() > 0.58) object.primitive = 'sphere';
      object.color = palette[Math.floor(random() * palette.length)];
      object.transform.x = Number(((i - (count - 1) / 2) * 1.35).toFixed(3));
      object.transform.y = Number(((random() * 1.8) - 0.9).toFixed(3));
      object.transform.z = Number(((random() * 2.2) - 1.1).toFixed(3));
      const scale = Number((0.55 + random() * 0.8).toFixed(3));
      object.transform.sx = scale;
      object.transform.sy = Number((scale * (0.75 + random() * 0.55)).toFixed(3));
      object.transform.sz = scale;
      project.scenes[0].objects.push(object);
    }

    const scriptPrefix = `seed-${hashSeed(seed).toString(36)}-s`;
    const player = project.scenes[0].objects[0];
    const startup = model.createScript('Seeded one-time setup');
    startup.id = `${scriptPrefix}1`;
    startup.source = 'once { position.y += 0.25; }';
    project.scripts.push(startup);
    player.scriptIds.push(startup.id);

    if (scriptGenerator && typeof scriptGenerator.generateScript === 'function') {
      const behaviorPrompts = [
        `move right at ${1 + Math.floor(random() * 3)} units per second when pressing A`,
        `rotate around Y at ${45 + Math.floor(random() * 4) * 45} degrees per second when pressing B`,
        'set color to random color when pressing X'
      ];
      const behaviorCount = 1 + Math.floor(random() * 2);
      for (let i = 0; i < behaviorCount; i++) {
        const prompt = behaviorPrompts[Math.floor(random() * behaviorPrompts.length)];
        const generated = scriptGenerator.generateScript(prompt, project, project.scenes[0].id);
        const script = model.createScript(generated.name);
        script.id = `${scriptPrefix}${(i + 2).toString(36)}`;
        script.source = generated.source;
        project.scripts.push(script);
        project.scenes[0].objects[i % project.scenes[0].objects.length].scriptIds.push(script.id);
      }
    }
    project.music = seededMusic(seed);
    return model.normalizeProject(project);
  }

  function deriveSeedFromPrompt(prompt) {
    const normalized = String(prompt || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!normalized) throw new Error('Enter a prompt or seed first');
    return `prompt${hashText(normalized).toString(36)}`;
  }

  function createFromPrompt(prompt, seed, model, projectGenerator, scriptGenerator) {
    const plan = projectGenerator.createPlan(prompt, scriptGenerator, model);
    const project = projectGenerator.generateProject(plan, model, scriptGenerator, 'Prompt Project');
    const prefix = `p${hashSeed(seed).toString(36)}`;
    const scriptIds = new Map(project.scripts.map((script, index) => [script.id, `${prefix}-s${(index + 1).toString(36)}`]));
    project.scripts.forEach((script, index) => { script.id = `${prefix}-s${(index + 1).toString(36)}`; });
    let objectIndex = 0;
    for (const scene of project.scenes) for (const object of scene.objects) {
      objectIndex++;
      object.id = `${prefix}-${objectIndex.toString(36)}`;
      object.scriptIds = object.scriptIds.map(id => scriptIds.get(id) || id);
    }
    project.app.id = `seed-${hashSeed(seed).toString(36)}`;
    project.app.name = generatedName(createRandom(seed), 0).slice(0, 64);
    project.app.description = `Generated from prompt seed ${seed}`.slice(0, 160);
    project.music = seededMusic(seed);
    return model.normalizeProject(project);
  }

  return {
    ALPHABET, MAX_BYTES, MAX_SEED_CHARS, MAX_PROCEDURAL_SEED_CHARS,
    encodeProject, decodeProject, isProjectSeed, isShortSeed,
    normalizeShortSeed, hashSeed, generateProject, deriveSeedFromPrompt, createFromPrompt
  };
});
