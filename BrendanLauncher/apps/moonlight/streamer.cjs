'use strict';
// media-machine-compatible streamer facade.
//
// The launcher's app runtime already special-cases media-machine by constructing
// its streamer and calling afterBatch() between batches. Moonlight exposes the
// same shape so the same integration code (see ../../docs/launcher-integration.md) works for
// both apps: either point `hostRuntime` at this module or let app-runtime build
// it by app id.

const { EventEmitter } = require('node:events');
const runtime = require('./host/runtime.cjs');

class MoonlightStreamer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.host = null;
    this.started = false;
  }

  /**
   * @param {{rpc:object, mapped:number, directory:string, app:object,
   *          backend?:string, dataDirectory?:string, settings?:object}} options
   */
  async init(options = {}) {
    if (this.started) return this;
    const merged = { ...this.options, ...options };
    this.host = await runtime.create({
      rpc: merged.rpc,
      mapped: merged.mapped,
      directory: merged.directory,
      app: merged.app,
      options: {
        backend: merged.backend,
        dataDirectory: merged.dataDirectory,
        settings: merged.settings,
        logger: merged.logger,
      },
    });
    this.started = true;
    return this;
  }

  /**
   * Called by the launcher between GPU batches. The bridge also runs its own
   * pump, so this only needs to service console -> host commands and input.
   */
  async afterBatch() {
    if (this.host) await this.host.afterBatch();
  }

  /** Media-machine's runtime asks for a frame; the bridge has already pushed one. */
  getFrame() {
    return null;
  }

  async close() {
    if (!this.host) return;
    const host = this.host;
    this.host = null;
    this.started = false;
    await host.close();
  }
}

module.exports = { MoonlightStreamer };
