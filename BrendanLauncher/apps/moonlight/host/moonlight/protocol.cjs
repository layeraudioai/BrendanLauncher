'use strict';
// Runs the console app's proven Sunshine protocol code (pairing, application
// list, launch negotiation) on the bridge host.
//
// The console sources are plain adapter-driven scripts that expect a global
// object, so they are evaluated in a VM context with Forge bound to it. Nothing
// is rewritten: the same files the Switch build ships are what run here.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const DEFAULT_ROOT = path.resolve(__dirname, '../../../../..');
const FILES = {
  forge: 'app/vendor/forge-1.4.3.min.js',
  pairing: 'app/src/protocol/sunshine-pairing.js',
  apps: 'app/src/protocol/sunshine-apps.js',
  launch: 'app/src/streaming/sunshine-session.js',
};

let cachedSandbox = null;

function loadProtocol(root = process.env.MOONLIGHT_SOURCE_ROOT || DEFAULT_ROOT) {
  if (cachedSandbox && cachedSandbox.root === root) return cachedSandbox.api;
  const read = name => {
    const file = path.join(root, FILES[name]);
    if (!fs.existsSync(file)) {
      throw Error(`Moonlight protocol source is missing: ${file}`);
    }
    return fs.readFileSync(file, 'utf8');
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    DataView,
    Promise,
    Math,
    Date,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  // Forge's UMD wrapper looks for a CommonJS-ish environment; in this context it
  // falls through to `window.forge`, which is exactly what the protocol files use.
  vm.runInContext(read('forge'), sandbox, { filename: FILES.forge });
  if (!sandbox.forge) throw Error('node-forge failed to initialise in the bridge sandbox');
  vm.runInContext(read('pairing'), sandbox, { filename: FILES.pairing });
  vm.runInContext(read('apps'), sandbox, { filename: FILES.apps });
  vm.runInContext(read('launch'), sandbox, { filename: FILES.launch });
  for (const name of ['MoonlightPairing', 'MoonlightApps', 'MoonlightSessionProtocol']) {
    if (!sandbox[name]) throw Error(`${name} was not exported by the console protocol sources`);
  }

  const api = {
    root,
    parseHost: value => sandbox.MoonlightPairing.parseHost(value),
    createPairing: options => sandbox.MoonlightPairing.create(options),
    createApps: options => sandbox.MoonlightApps.create(options),
    createLaunch: options => sandbox.MoonlightSessionProtocol.create(options),
    randomBytes: size => crypto.randomBytes(size).toString('binary'),
  };
  cachedSandbox = { root, api };
  return api;
}

module.exports = { loadProtocol, DEFAULT_ROOT };
