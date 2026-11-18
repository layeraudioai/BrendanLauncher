'use strict';
// Sunshine backend: pairs, enumerates applications and runs a live stream using
// the console app's own protocol sources (pairing / app list / launch) plus the
// bridge's RTSP, control and decode stack.

const { EventEmitter } = require('node:events');
const { Store, createAdapters } = require('../moonlight/store.cjs');
const { loadProtocol } = require('../moonlight/protocol.cjs');
const { SunshineSession } = require('../moonlight/session.cjs');
const layout = require('../layout.cjs');

const DEFAULT_HTTP_PORT = 47989;

class SunshineBackend extends EventEmitter {
  /**
   * @param {{dataDirectory:string, settings?:object, logger?:(line:string)=>void,
   *          sourceRoot?:string}} options
   */
  constructor({ dataDirectory, settings, logger = () => {}, sourceRoot }) {
    super();
    this.dataDirectory = dataDirectory;
    this.logger = logger;
    this.name = 'sunshine';
    this.settings = settings || {};
    this.protocol = loadProtocol(sourceRoot);
    this.store = new Store(dataDirectory);
    this.session = null;
    this.startedAt = 0;
    this.frames = 0;
    this.pairing = null;
  }

  async init() {
    await this.store.init();
    this.settings = { ...(await this.store.loadSettings()), ...this.settings };
    const identity = await this.store.loadIdentity();
    this.identity = identity;
    this.logger(
      identity ? 'Sunshine backend ready' : 'Sunshine backend ready (no pairing identity yet)',
    );
    return this;
  }

  /** Configured addresses, newest first, annotated with their pairing state. */
  async listHosts() {
    const addresses = [...this.settings.hosts];
    if (!addresses.some(value => /^(127\.|localhost)/.test(value))) addresses.push('127.0.0.1');
    const hosts = [];
    for (const address of addresses) {
      let parsed;
      try {
        parsed = this.protocol.parseHost(address);
      } catch (error) {
        this.logger(`ignoring host "${address}": ${error.message}`);
        continue;
      }
      const saved = await this.store.loadHost(parsed.key);
      hosts.push({
        key: parsed.key,
        address: parsed.host,
        name: saved && saved.hostname ? saved.hostname : parsed.host,
        state: saved && saved.certificatePem ? 'paired' : 'unpaired',
        httpsPort: saved ? saved.httpsPort : undefined,
      });
    }
    return hosts;
  }

  async _hostRecord(hostKey) {
    const hosts = await this.listHosts();
    const host = hosts.find(item => item.key === hostKey);
    if (!host) throw Error('Unknown host');
    const saved = await this.store.loadHost(host.key);
    if (!saved || !saved.certificatePem) throw Error('Pair with this host first (press Y)');
    return { host, saved };
  }

  async listGames(hostKey) {
    const { host, saved } = await this._hostRecord(hostKey);
    const apps = this.protocol.createApps(createAdapters(this.store));
    const result = await apps.listApps(host.address, saved.httpsPort);
    this.logger(`${result.apps.length} applications on ${result.hostname}`);
    return result.apps.map(app => ({ id: app.id, name: app.title }));
  }

  async beginPair(hostKey) {
    const hosts = await this.listHosts();
    const host = hosts.find(item => item.key === hostKey) || hosts[0];
    if (!host) throw Error('Configure a Sunshine host first');
    const steps = [];
    const pairing = this.protocol.createPairing(
      createAdapters(this.store, {
        onProgress: progress => {
          steps.push(progress.stage);
          if (progress.pin) {
            this.statePin = progress.pin;
            this.emit('progress', { pin: progress.pin, message: progress.message });
          } else {
            this.emit('progress', { message: progress.message });
          }
        },
      }),
    );
    this.pairing = pairing;
    // checkAndPair blocks on the user typing the PIN into Sunshine's web UI.
    pairing
      .checkAndPair(host.address)
      .then(result => {
        this.emit('progress', { message: `Paired with ${result.hostname}` });
        this.logger(`paired with ${result.hostname} after ${steps.length} steps`);
      })
      .catch(error => this.emit('error', error))
      .finally(() => {
        this.pairing = null;
      });
    // Surface the PIN as soon as the pairing code produces one.
    return { pin: await this._waitForPin() };
  }

  _waitForPin(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (this.statePin) return resolve(this.statePin);
        if (Date.now() - started > timeoutMs) {
          return reject(Error('Sunshine did not issue a pairing PIN in time'));
        }
        setTimeout(tick, 100);
      };
      const onProgress = progress => {
        if (progress.pin) this.statePin = progress.pin;
      };
      this.on('progress', onProgress);
      tick();
    });
  }

  async startStream(hostKey, appId) {
    const { host, saved } = await this._hostRecord(hostKey);
    const launch = this.protocol.createLaunch(createAdapters(this.store));
    const mode = {
      width: layout.video.width,
      height: layout.video.height,
      fps: layout.key.videoFps,
      bitrate: this.settings.bitrateKbps || 20000,
    };
    const started = await launch.launch(host.address, appId, mode);
    this.logger(`launched app ${appId} on ${host.address} (${started.resumed ? 'resume' : 'launch'})`);
    if (this.session) await this.session.stop('restart');
    this.session = new SunshineSession({
      host: started.host,
      sessionUrl: started.url,
      rikey: Buffer.from(started.key),
      rikeyId: started.keyId,
      config: {
        width: mode.width,
        height: mode.height,
        fps: mode.fps,
        bitrateKbps: mode.bitrate,
        packetSize: this.settings.packetSize,
      },
      ffmpeg: process.env.FFMPEG,
      logger: this.logger,
    });
    this.session.on('frame', frame => {
      this.frames += 1;
      this.emit('frame', frame);
    });
    this.session.on('audio', pcm => this.emit('audio', pcm));
    this.session.on('warning', message => this.emit('progress', { message }));
    this.session.on('error', error => this.emit('error', error));
    this.session.on('ended', reason => this.emit('ended', reason));
    this.session.setInput({ buttons: 0, leftStickX: 0, leftStickY: 0, rightStickX: 0, rightStickY: 0 });
    await this.session.start();
    this.startedAt = Date.now();
    return { host: saved.hostname || host.address };
  }

  setInput(pad) {
    if (this.session) this.session.setInput(pad);
  }

  async stopStream() {
    if (!this.session) return;
    const session = this.session;
    this.session = null;
    await session.stop('stopStream');
  }

  get stats() {
    const seconds = Math.max(1, (Date.now() - this.startedAt) / 1000);
    return {
      fps: this.frames / seconds,
      codec: this.session && this.session.negotiated ? this.session.negotiated.codec : 'h264',
      audio: 'pcm',
    };
  }

  async close() {
    await this.stopStream();
  }
}

module.exports = { SunshineBackend, DEFAULT_HTTP_PORT };
