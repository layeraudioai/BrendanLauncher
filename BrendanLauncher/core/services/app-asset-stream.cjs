'use strict';

const fs = require('node:fs/promises');
const catalog = require('../../homebrew-launcher/app-catalog.cjs');

const WINDOW_BYTES = 64 * 1024;
const WINDOW_OFFSET = catalog.STREAM_WINDOW_OFFSET;
const REQUEST_OFFSET = 992;
const ACK_OFFSET = 1012;
const STATUS_OFFSET = 1020;
const STATUS_READY = 1;
const STATUS_FAILED = 2;
const check = (value, message) => { if (!value) throw Error(message); };

function create({ rpc, mapped, app }) {
  const assets = app.streamedAssets || [];

  return {
    async afterBatch(state) {
      if (!assets.length) return;
      const id = state.readUInt32LE(REQUEST_OFFSET);
      const offset = state.readUInt32LE(REQUEST_OFFSET + 4);
      const length = state.readUInt32LE(REQUEST_OFFSET + 8);
      const sequence = state.readUInt32LE(REQUEST_OFFSET + 12);
      if (!id || !sequence || sequence === state.readUInt32LE(ACK_OFFSET)) return;

      const asset = assets[id - 1];
      let bytes, status = STATUS_READY;
      if (!asset || length === 0 || length > WINDOW_BYTES ||
          offset > asset.size || length > asset.size - offset) {
        status = STATUS_FAILED;
      } else {
        const handle = await fs.open(asset.file, 'r');
        try {
          bytes = Buffer.alloc(length);
          const result = await handle.read(bytes, 0, length, offset);
          check(result.bytesRead === length, 'Streamed asset changed or ended during read');
        } finally {
          await handle.close();
        }
        await rpc.write(mapped + 1024 + WINDOW_OFFSET, bytes);
      }

      const response = Buffer.alloc(4);
      response.writeUInt32LE(sequence);
      await rpc.write(mapped + ACK_OFFSET, response);
      response.writeUInt32LE(status);
      await rpc.write(mapped + STATUS_OFFSET, response);
    }
  };
}

module.exports = { create, WINDOW_BYTES, WINDOW_OFFSET };
