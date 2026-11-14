'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'apps/system-monitor/src/app.c'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps/system-monitor/manifest.json'), 'utf8'));

test('system monitor is a valid native ABI 3 app package', () => {
  assert.equal(manifest.id, 'system-monitor');
  assert.equal(manifest.kind, 'native');
  assert.equal(manifest.abi, 3);
  assert.ok(manifest.limits.heap_bytes >= 65536);
});

test('monitor labels architectural timer separately from processor clocks', () => {
  assert.match(source, /Timer reference \(CNTFRQ\)/);
  assert.match(source, /NOT the CPU clock frequency/);
  assert.match(source, /CPU cluster \/ per-core MHz: not exposed/);
});

test('benchmark is bounded and does not attempt hardware controls', () => {
  assert.match(source, /#define BENCH_ITERATIONS 350000u/);
  assert.match(source, /Press A to run the short CPU trial/);
  assert.doesNotMatch(source, /NvRmGpuClockSet|SetModuleClockRate|SetCpuOverclock|ThermalAlertSetLimit/);
  assert.doesNotMatch(source, /write\s*\(/);
});

test('NRO launching is not advertised as implemented', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /does not load Switch `\.nro` binaries/);
  assert.match(readme, /does not offer NRO launching from SD\/server/);
});
