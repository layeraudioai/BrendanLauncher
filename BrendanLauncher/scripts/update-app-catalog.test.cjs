'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {buildCatalog, updateAppCatalog} = require('./update-app-catalog.cjs');

test('Builds a stable catalog inventory from supported package manifests', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'app-catalog-test-'));
  try {
    for (const [folder, manifest] of [
      ['zeta', {id: 'zeta', name: 'Zeta', version: '1.2.3', abi: 3, kind: 'native'}],
      ['alpha', {id: 'alpha', name: 'Alpha', description: 'First', version: '1.0.0', abi: 3, kind: 'native'}],
      ['gpu-app', {id: 'gpu-app', name: 'GPU app', version: '1.0.0', abi: 1, kind: 'gpu'}]
    ]) {
      const directory = path.join(root, folder);
      await fs.mkdir(directory);
      await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    }

    await assert.rejects(buildCatalog(root), /gpu-app: unsupported kind/);
    await fs.rm(path.join(root, 'gpu-app'), {recursive: true});
    assert.deepEqual(await buildCatalog(root), {
      format: 'brendanlauncher.app-catalog/1',
      apps: [
        {id: 'alpha', name: 'Alpha', description: 'First', version: '1.0.0', kind: 'native', abi: 3},
        {id: 'zeta', name: 'Zeta', description: '', version: '1.2.3', kind: 'native', abi: 3}
      ]
    });

    const duplicate = path.join(root, 'duplicate');
    await fs.mkdir(duplicate);
    await fs.copyFile(path.join(root, 'alpha', 'manifest.json'), path.join(duplicate, 'manifest.json'));
    await assert.rejects(buildCatalog(root), /duplicate app id alpha/);
    await fs.rm(duplicate, {recursive: true});

    const output = path.join(root, 'data', 'app-catalog.json');
    await updateAppCatalog({appRoot: root, output});
    assert.deepEqual(JSON.parse(await fs.readFile(output, 'utf8')), await buildCatalog(root));
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});
