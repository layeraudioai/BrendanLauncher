'use strict';
// The ABI-1 host runtime: the piece that makes Moonlight a GPU-only app.
//
// The console runs three shaders and nothing else. This bridge owns everything
// a CPU would normally do — pairing, app lists, RTSP, decoding, audio, input
// routing — and publishes the results into the app's binding-zero storage
// buffer: a 1024x576 text band, 32 item rectangles, a header block, two RGB565
// video slots and a ring of PCM effect files.
//
// ABI-1 integration: the launcher's batch loop calls afterBatch(state) between
// GPU submissions; the bridge also runs its own timer so a live stream keeps
// flowing while the console is inside a batch.

const fs = require('node:fs');
const path = require('node:path');

const layout = require('./layout.cjs');
const { Band } = require('./band.cjs');
const { Font } = require('./font.cjs');
const { Header } = require('./header.cjs');
const { FrameWriter } = require('./frames.cjs');
const { AudioRing } = require('./audio.cjs');
const { Screen } = require('./screen.cjs');

const { SCENE, CMD, FLAG, HEADER } = layout;

const PAD_OFFSET = 0; // ABI primary pad snapshot: the first 64 bytes of the buffer
const PUMP_INTERVAL_MS = 16;
const COMMAND_POLL_MS = 32;
const STATS_INTERVAL_MS = 500;

const SCENE_NAMES = {
  [SCENE.hosts]: 'hosts',
  [SCENE.games]: 'games',
  [SCENE.pair]: 'pair',
  [SCENE.stream]: 'stream',
  [SCENE.message]: 'message',
};

class Bridge {
  /**
   * @param {{rpc:object, mapped:number, directory:string, backend:object,
   *          logger?:(line:string)=>void}} options
   */
  constructor({ rpc, mapped, directory, backend, logger = () => {} }) {
    this.rpc = rpc;
    this.mapped = mapped;
    this.directory = directory;
    this.backend = backend;
    this.logger = logger;
    this.font = new Font();
    this.band = new Band(this.font);
    this.header = new Header(rpc, mapped);
    this.frames = new FrameWriter(rpc, mapped, { logger });
    this.audio = new AudioRing(this.header, {
      directory: path.join(__dirname, '..', 'assets'),
      logger,
      // The launcher's audio service publishes how many chunks it has queued in
      // the ABI `events.z` word (bytes 984..987 of the shared buffer). Reading it
      // lets the ring stay a fixed distance ahead instead of dropping audio.
      consumed: () => this._readQueuedAudio(),
    });
    this.screen = new Screen(this.band, this.font);
    this.closed = false;
    this.busy = false;
    this.state = {
      scene: SCENE.hosts,
      hosts: [],
      games: [],
      hostIndex: -1,
      gameIndex: -1,
      selected: 0,
      toast: null,
      progress: '',
      pin: null,
      streamTitle: '',
      stats: '',
    };
    this.timers = [];
    this.lastStatsAt = 0;
    this.dirty = true;
  }

  async start() {
    await this.header.read();
    this.header.setWord(HEADER.magic, 0x4e4c424d);
    this.header.setWord(HEADER.version, 1);
    this.header.setWord(HEADER.videoWidth, layout.video.width);
    this.header.setWord(HEADER.videoHeight, layout.video.height);
    this.header.setScene(SCENE.hosts);
    this.header.setItemCount(0);
    this.header.setStatus(0);
    await this.header.flush();
    await this.frames.reset(0);
    await this._bindAudioPaths();
    this._bindBackend();
    await this.refreshHosts();
    this._paint();
    this.timers.push(setInterval(() => this._poll().catch(error => this._fail(error)), COMMAND_POLL_MS));
    this.timers.push(setInterval(() => this._pump().catch(error => this._fail(error)), PUMP_INTERVAL_MS));
    this.logger('Moonlight bridge started');
    return this;
  }

  _bindBackend() {
    this.backend.on('frame', frame => {
      if (this.state.scene !== SCENE.stream) return;
      try {
        this.frames.push(frame);
      } catch (error) {
        this._fail(error);
      }
    });
    this.backend.on('audio', pcm => {
      if (this.state.scene !== SCENE.stream) return;
      this.audio.push(pcm);
    });
    this.backend.on('progress', progress => {
      if (progress && progress.pin) this.state.pin = progress.pin;
      if (progress && progress.message) this.state.progress = progress.message;
      this.dirty = true;
    });
    this.backend.on('error', error => this._fail(error));
    this.backend.on('ended', reason => {
      if (this.state.scene === SCENE.stream) this._stopStream(reason).catch(() => {});
    });
  }

  // -- launcher hooks ------------------------------------------------------
  /** Number of audio chunks the launcher's audio service has queued. */
  async _readQueuedAudio() {
    if (!this.rpc || !this.mapped) return 0;
    const word = await this.rpc.read(this.mapped + layout.EVENTS_QUEUED, 4);
    return word.readUInt32LE(0);
  }

  /** Point the ring at the chunk files inside the launcher's runtime folder. */
  async _bindAudioPaths() {
    const ids = [];
    for (let index = 0; index < layout.audio.ringSlots; index++) {
      ids.push(layout.audio.ringFirstSlot + index);
    }
    const paths = await AudioRing.resolvePaths(this.directory, ids);
    if (paths.size === ids.length) this.audio.paths = paths;
    else this.logger(`audio chunks stay in ${this.audio.directory} (no launcher paths)`);
  }

  /** Called by the launcher between GPU batches. */
  async afterBatch() {
    await this._poll();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    try {
      await this.backend.stopStream();
    } catch {
      /* ignore */
    }
    this.header.setFlags(0);
    await this.header.flush().catch(() => {});
  }

  // -- pumps ---------------------------------------------------------------
  async _pump() {
    if (this.closed) return;
    if (this.state.scene === SCENE.stream) {
      await this.frames.flush();
      await this.audio.pump();
      const now = Date.now();
      if (now - this.lastStatsAt > STATS_INTERVAL_MS) {
        this.lastStatsAt = now;
        const stats = this.backend.stats || {};
        this.state.stats = `${Math.round(stats.fps || 0)} fps · ${stats.codec || '?'}`;
        this.header.setCounters({ fps: Math.round(stats.fps || 0) });
        this.dirty = true;
      }
    }
    if (this.dirty) await this._paint();
  }

  async _poll() {
    if (this.closed) return;
    await this.header.read();
    const selected = this.header.word(HEADER.selected) >>> 0;
    if (selected !== this.state.selected) {
      this.state.selected = selected;
      this.dirty = true;
    }
    if (this.state.scene === SCENE.stream) await this._forwardInput();
    const pending = this.header.pendingCommand();
    if (!pending) return;
    await this._handle({ cmd: pending.command, arg0: pending.arg0, seq: pending.seq });
  }

  /** Read the ABI pad snapshot and hand it to the streaming backend. */
  async _forwardInput() {
    const raw = await this.rpc.read(this.mapped + PAD_OFFSET, 64);
    if (!raw || raw.length < 36) return;
    this.backend.setInput?.({
      buttons: raw.readUInt32LE(8),
      connected: (raw.readUInt32LE(32) & 1) !== 0,
      leftStickX: raw.readInt32LE(16),
      leftStickY: raw.readInt32LE(20),
      rightStickX: raw.readInt32LE(24),
      rightStickY: raw.readInt32LE(28),
    });
  }

  // -- commands ------------------------------------------------------------
  async _handle({ cmd, arg0, seq }) {
    try {
      switch (cmd) {
        case CMD.openHost:
          await this.openHost(arg0);
          break;
        case CMD.start:
        case CMD.openGame:
          await this.startStream(arg0);
          break;
        case CMD.pair:
          await this.pair(arg0 >= 0 ? arg0 : this.state.selected);
          break;
        case CMD.refresh:
          await this.refreshHosts();
          break;
        case CMD.stop:
          await this._stopStream('stopped from the console');
          break;
        case CMD.back:
          await this.back();
          break;
        case CMD.retry:
          await this.refreshHosts();
          break;
        case CMD.quit:
          await this.close();
          break;
        default:
          break;
      }
      await this.header.acknowledge(seq, 0);
    } catch (error) {
      this.logger(`command ${layout.CMD_NAMES[cmd] || cmd} failed: ${error.message}`);
      await this.header.acknowledge(seq, 1);
      await this._fail(error);
    }
  }

  async back() {
    if (this.state.scene === SCENE.stream) {
      await this._stopStream('back');
      return;
    }
    if (this.state.scene === SCENE.games || this.state.scene === SCENE.pair) {
      await this.refreshHosts();
    }
  }

  // -- scenes --------------------------------------------------------------
  async refreshHosts() {
    this.busy = true;
    this.header.addFlags(FLAG.busy);
    await this.header.flush();
    try {
      this.state.hosts = await this.backend.listHosts();
    } finally {
      this.busy = false;
      this.header.clearFlags(FLAG.busy);
      await this.header.flush();
    }
    this.state.scene = SCENE.hosts;
    this.state.games = [];
    this.state.selected = 0;
    this.state.progress = '';
    this.state.pin = null;
    this.header.setScene(SCENE.hosts);
    this.header.setCounters({ hosts: this.state.hosts.length });
    this.dirty = true;
    await this._paint();
  }

  async openHost(index) {
    const host = this.state.hosts[index];
    if (!host) throw Error('No such host');
    this.state.hostIndex = index;
    this.busy = true;
    this.state.progress = `Loading applications from ${host.name}\u2026`;
    this.dirty = true;
    await this._paint();
    try {
      this.state.games = await this.backend.listGames(host.key);
    } finally {
      this.busy = false;
    }
    this.state.scene = SCENE.games;
    this.state.selected = 0;
    this.state.progress = '';
    this.header.setScene(SCENE.games);
    this.header.setCounters({ games: this.state.games.length });
    this.dirty = true;
    await this._paint();
  }

  async pair(index) {
    const host = this.state.hosts[index];
    if (!host) throw Error('No such host');
    this.state.hostIndex = index;
    this.state.scene = SCENE.pair;
    this.state.progress = 'Waiting for Sunshine to accept the pairing PIN\u2026';
    this.state.pin = null;
    this.header.setScene(SCENE.pair);
    this.dirty = true;
    await this._paint();
    const result = await this.backend.beginPair(host.key);
    this.state.pin = result.pin;
    this.state.progress = `Enter PIN ${result.pin} in Sunshine, then press A`;
    this.dirty = true;
  }

  async startStream(gameIndex) {
    const host = this.state.hosts[this.state.hostIndex];
    const game = this.state.games[gameIndex];
    if (!host || !game) throw Error('Select a host and an application first');
    this.state.gameIndex = gameIndex;
    this.state.scene = SCENE.stream;
    this.state.streamTitle = `${game.name} — ${host.name}`;
    this.state.progress = '';
    this.state.toast = `Starting ${game.name}\u2026`;
    this.header.setScene(SCENE.stream);
    this.header.addFlags(FLAG.streaming);
    await this.header.flush();
    this.dirty = true;
    await this._paint();
    await this.backend.startStream(host.key, game.id);
    this.state.toast = null;
    this.header.addFlags(FLAG.video);
    await this.header.flush();
    this.dirty = true;
  }

  async _stopStream(reason) {
    await this.backend.stopStream();
    await this.audio.silence();
    await this.frames.reset(0);
    this.header.clearFlags(FLAG.streaming | FLAG.video);
    this.state.scene = SCENE.games;
    this.state.toast = `Stream ended (${reason})`;
    this.state.stats = '';
    this.header.setScene(SCENE.games);
    this.dirty = true;
    await this.header.flush();
    await this._paint();
  }

  async _fail(error) {
    this.state.toast = String(error && error.message ? error.message : error);
    this.dirty = true;
    this.logger(`error: ${this.state.toast}`);
    await this._paint().catch(() => {});
  }

  // -- painting ------------------------------------------------------------
  async _paint() {
    const state = this.state;
    const host = state.hosts[state.hostIndex];
    let view;
    if (state.scene === SCENE.hosts) {
      view = {
        scene: state.scene,
        title: 'Moonlight',
        subtitle: 'Sunshine hosts paired with this PC',
        status: `${state.hosts.length} host${state.hosts.length === 1 ? '' : 's'}`,
        items: state.hosts.map((item, index) => ({
          name: item.name,
          detail: [item.address, index === state.hostIndex ? 'selected' : ''].filter(Boolean).join('  '),
          flags: item.state === 'paired' ? 1 : 0,
        })),
        empty: 'No hosts yet — press Y to pair this PC',
        footer: 'A open   Y pair   X refresh   B exit',
        progress: state.progress,
        toast: state.toast,
      };
    } else if (state.scene === SCENE.games) {
      view = {
        scene: state.scene,
        title: host ? host.name : 'Applications',
        subtitle: host ? `Paired at ${host.address}` : '',
        status: `${state.games.length} apps`,
        items: state.games.map(item => ({ name: item.name, detail: '' })),
        empty: 'This host reported no applications',
        footer: 'A start stream   X refresh   B back',
        progress: state.progress,
        toast: state.toast,
      };
    } else if (state.scene === SCENE.pair) {
      view = {
        scene: state.scene,
        title: 'Pairing',
        subtitle: host ? host.name : '',
        status: state.pin ? `PIN ${state.pin}` : 'waiting',
        items: [],
        empty: state.pin ? `PIN ${state.pin}` : 'Requesting a PIN from Sunshine\u2026',
        footer: 'Enter the PIN in Sunshine (http://<pc>:47990), then press A',
        progress: state.progress,
        toast: state.toast,
      };
    } else if (state.scene === SCENE.stream) {
      view = {
        scene: state.scene,
        stream: true,
        title: state.streamTitle,
        toast: state.toast,
        stats: state.stats,
      };
    } else {
      view = {
        scene: state.scene,
        title: 'Moonlight',
        items: [],
        empty: state.toast || '',
        footer: 'B back',
      };
    }

    const items = this.screen.draw({ ...view, selected: state.selected });
    this.header.setItems(items);
    this.header.setItemCount(view.items ? Math.min(view.items.length, 32) : 0);
    this.header.setCounters({
      hosts: state.hosts.length,
      games: state.games.length,
    });
    this.header.setWord(HEADER.bandSeq, (this.header.word(HEADER.bandSeq) + 1) >>> 0);
    await this.header.flush();
    await this.band.commit(this.rpc, this.mapped);
    this.dirty = false;
  }
}

module.exports = { Bridge, SCENE_NAMES };
