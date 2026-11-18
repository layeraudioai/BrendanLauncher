'use strict';
// Launcher entry point for the Moonlight app.
//
// This is the file the launcher's host runtime loads for a GPU app that needs a
// bridge (the same role media-machine's streamer.cjs plays). It returns the
// two hooks ABI-1 apps can use: afterBatch(state) between GPU submissions, and
// close() when the app is left. Everything else is autonomous.

const { Bridge } = require('./bridge.cjs');
const { DemoBackend } = require('./backends/demo.cjs');
const { SunshineBackend } = require('./backends/sunshine.cjs');

/**
 * @param {{rpc:object, mapped:number, directory:string, app:object,
 *          options?:{backend?:string, dataDirectory?:string, settings?:object}}}
 */
async function create({ rpc, mapped, directory, app, options = {} }) {
  const logger = options.logger || (line => console.log(`[MOONLIGHT] ${line}`));
  const dataDirectory =
    options.dataDirectory ||
    process.env.MOONLIGHT_DATA ||
    (directory ? require('node:path').join(directory, 'moonlight') : require('node:path').join(__dirname, '..', 'data'));
  const kind = options.backend || process.env.MOONLIGHT_BACKEND || 'sunshine';

  let backend;
  if (kind === 'demo') {
    backend = new DemoBackend({ logger });
  } else if (kind === 'sunshine') {
    backend = new SunshineBackend({
      dataDirectory,
      settings: options.settings,
      logger,
    });
  } else {
    throw Error(`Unknown Moonlight backend "${kind}" (use "sunshine" or "demo")`);
  }
  await backend.init();

  const bridge = new Bridge({ rpc, mapped, directory, backend, logger });
  await bridge.start();

  return {
    app: app && app.id ? app.id : 'moonlight',
    backend: kind,
    afterBatch: () => bridge.afterBatch(),
    close: () => bridge.close(),
    // Exposed for tests and for a future in-launcher settings screen.
    bridge,
    backendImpl: backend,
  };
}

module.exports = { create };
