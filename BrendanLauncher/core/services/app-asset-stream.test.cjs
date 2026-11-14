'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { create, WINDOW_OFFSET } = require('./app-asset-stream.cjs');

test('streams bounded file chunks into the app window and acknowledges requests', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'app-asset-stream-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = Buffer.alloc(100000);
  for (let i = 0; i < source.length; i++) source[i] = i % 251;
  const file = path.join(directory, 'asset.bin');
  await fs.writeFile(file, source);

  const mapped = 4096;
  const memory = Buffer.alloc(mapped + 8 * 1024 * 1024);
  const rpc = {
    async write(address, bytes) {
      bytes.copy(memory, address);
    }
  };
  const service = create({
    rpc, mapped, app: { streamedAssets: [{ id: 1, file, size: source.length }] }
  });
  const state = Buffer.alloc(1024);
  state.writeUInt32LE(1, 992);
  state.writeUInt32LE(32768, 996);
  state.writeUInt32LE(4096, 1000);
  state.writeUInt32LE(7, 1004);

  await service.afterBatch(state);
  assert.deepEqual(
    memory.subarray(mapped + 1024 + WINDOW_OFFSET, mapped + 1024 + WINDOW_OFFSET + 4096),
    source.subarray(32768, 32768 + 4096)
  );
  assert.equal(memory.readUInt32LE(mapped + 1012), 7);
  assert.equal(memory.readUInt32LE(mapped + 1020), 1);

  state.writeUInt32LE(8, 1004);
  state.writeUInt32LE(source.length - 2, 996);
  state.writeUInt32LE(4, 1000);
  await service.afterBatch(state);
  assert.equal(memory.readUInt32LE(mapped + 1012), 8);
  assert.equal(memory.readUInt32LE(mapped + 1020), 2);
});
