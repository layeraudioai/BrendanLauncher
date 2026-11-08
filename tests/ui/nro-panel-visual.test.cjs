'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..', '..');
const binary = path.join(root, 'build/preview/hbl-preview');
const out = path.join(root, 'tests/preview/out-nro');
assert.ok(fs.existsSync(binary), 'build preview first with tests/preview/build.sh');
fs.mkdirSync(out, {recursive: true});
const lavapipe = ['/usr/share/vulkan/icd.d/lvp_icd.json', '/usr/share/vulkan/icd.d/lvp_icd.x86_64.json']
  .find(candidate => fs.existsSync(candidate));
const env = Object.assign({}, process.env, {VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES || lavapipe || ''});
const result = execFileSync(binary, [out, '1', 'nro'], {env, encoding: 'utf8'});
assert.match(result, /frame 0: \d+ vertices/);
const ppm = fs.readFileSync(path.join(out, 'frame-00.ppm'));
assert.ok(ppm.subarray(0, 32).toString().startsWith('P6\n1920 1080\n255\n'));
assert.ok(ppm.length > 1920 * 1080 * 3, 'NRO panel frame should contain a complete rendered image');
console.log('NRO panel Vulkan preview: rendered at 1920x1080');
