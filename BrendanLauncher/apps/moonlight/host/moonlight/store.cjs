'use strict';
// Bridge-side persistence: pairing identity, paired hosts and settings.
//
// The console has no writable filesystem in ABI 1, so everything that has to
// survive a reboot lives here on the PC (the "network filesystem" half of the
// port). Files are plain JSON in the launcher's app-storage directory.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { requestHttp, requestHttps } = require('./http.cjs');

const IDENTITY_FILE = 'identity.json';
const HOSTS_DIR = 'hosts';
const SETTINGS_FILE = 'settings.json';

const DEFAULT_SETTINGS = {
  version: 1,
  hosts: [],
  autoPair: false,
  resolution: '1280x720',
  fps: 60,
  bitrateKbps: 20000,
  packetSize: 1024,
  audio: true,
  lastHost: '',
};

class Store {
  constructor(directory) {
    this.directory = directory;
  }

  async init() {
    await fsp.mkdir(path.join(this.directory, HOSTS_DIR), { recursive: true });
    return this;
  }

  file(name) {
    return path.join(this.directory, name);
  }

  hostFile(key) {
    const safe = String(key).replace(/[^a-z0-9_.-]/gi, '_').slice(0, 80);
    return path.join(this.directory, HOSTS_DIR, `${safe}.json`);
  }

  async readJson(file, fallback) {
    try {
      return JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return fallback;
      throw error;
    }
  }

  async writeJson(file, value) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    // 0600: the identity holds the client private key, hosts hold TLS pins.
    await fsp.writeFile(temp, JSON.stringify(value, null, 1), { mode: 0o600 });
    await fsp.rename(temp, file);
  }

  async loadIdentity() {
    return this.readJson(this.file(IDENTITY_FILE), null);
  }

  async saveIdentity(identity) {
    await this.writeJson(this.file(IDENTITY_FILE), identity);
  }

  async loadHost(key) {
    return this.readJson(this.hostFile(key), null);
  }

  async saveHost(key, host) {
    await this.writeJson(this.hostFile(key), host);
  }

  async listHosts() {
    const directory = path.join(this.directory, HOSTS_DIR);
    let entries = [];
    try {
      entries = await fsp.readdir(directory);
    } catch {
      return [];
    }
    const hosts = [];
    for (const entry of entries.filter(name => name.endsWith('.json'))) {
      const host = await this.readJson(path.join(directory, entry), null);
      if (host && host.certificatePem) hosts.push(host);
    }
    return hosts;
  }

  async removeHost(key) {
    await fsp.rm(this.hostFile(key), { force: true });
  }

  async loadSettings() {
    const saved = await this.readJson(this.file(SETTINGS_FILE), {});
    const hosts = (process.env.MOONLIGHT_HOSTS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      hosts: [...new Set([...hosts, ...(saved.hosts || [])])],
    };
  }

  async saveSettings(settings) {
    await this.writeJson(this.file(SETTINGS_FILE), settings);
  }
}

/** Adapter bundle consumed by the console protocol scripts. */
function createAdapters(store, extra = {}) {
  const artworkCache = {
    get: key => {
      try {
        const bytes = fs.readFileSync(path.join(store.directory, 'artwork', `${key}.bin`));
        return new Uint8Array(bytes);
      } catch {
        return null;
      }
    },
    put: (key, bytes) => {
      try {
        fs.mkdirSync(path.join(store.directory, 'artwork'), { recursive: true });
        fs.writeFileSync(path.join(store.directory, 'artwork', `${key}.bin`), Buffer.from(bytes));
      } catch {
        /* artwork is best effort */
      }
    },
    remove: key => {
      try {
        fs.rmSync(path.join(store.directory, 'artwork', `${key}.bin`), { force: true });
      } catch {
        /* ignore */
      }
    },
  };
  return {
    requestHttp,
    requestHttps,
    randomBytes: size => crypto.randomBytes(size).toString('binary'),
    loadIdentity: () => store.loadIdentity(),
    saveIdentity: identity => store.saveIdentity(identity),
    loadHost: key => store.loadHost(key),
    saveHost: (key, host) => store.saveHost(key, host),
    artworkCache,
    ...extra,
  };
}

module.exports = { Store, createAdapters, DEFAULT_SETTINGS };
