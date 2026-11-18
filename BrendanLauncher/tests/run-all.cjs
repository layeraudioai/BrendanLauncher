'use strict';
// Test runner: `node brendanlauncher/tests/run-all.cjs`

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const directory = __dirname;
const files = fs
  .readdirSync(directory)
  .filter(name => name.endsWith('.test.cjs'))
  .sort();

let failed = 0;
for (const file of files) {
  console.log(`\n== ${file}`);
  const result = spawnSync(process.execPath, [path.join(directory, file)], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) failed += 1;
}

console.log(
  failed ? `\n${failed} test file(s) failed` : `\nall ${files.length} test files passed`,
);
process.exitCode = failed ? 1 : 0;
