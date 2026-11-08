'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..', '..');
const ui = fs.readFileSync(path.join(root, 'launcher/src/launcher_ui.c'), 'utf8');
const logic = fs.readFileSync(path.join(root, 'launcher/src/launcher_logic.c'), 'utf8');
const header = fs.readFileSync(path.join(root, 'launcher/src/launcher_ui.h'), 'utf8');
assert.match(header, /LAUNCHER_MODE_NRO_INFO/);
assert.match(logic, /input->pressed & HBX_X[\s\S]{0,100}LAUNCHER_MODE_NRO_INFO/);
for (const phrase of [
  'NRO companion',
  'not a BrendanLauncher app package',
  'compatible loader',
  'SD:/switch',
  'NextLoadPath',
  'cannot load NROs or browse the console SD'
]) assert.ok(ui.includes(phrase), `missing in-launcher NRO guidance: ${phrase}`);
assert.match(ui, /"X"[\s\S]{0,160}"NRO info"/);
console.log('NRO companion UI: navigation, honest capability notice, SD path and controls verified');
