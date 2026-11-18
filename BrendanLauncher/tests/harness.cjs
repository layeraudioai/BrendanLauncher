'use strict';
// Tiny test harness: no dependencies, so checks run on any machine that has the
// launcher's Node version.

const tests = [];

function withTimeout(promise, ms, name) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(`${name} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw Error(message || 'assertion failed');
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw Error(`${message || 'values differ'}: expected ${expected}, got ${actual}`);
  }
}

function deepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw Error(`${message || 'values differ'}: expected ${b}, got ${a}`);
}

/** In-memory stand-in for the launcher's RPC bridge. */
function fakeRpc(bytes = 8 * 1024 * 1024) {
  const memory = Buffer.alloc(bytes);
  const calls = { reads: 0, writes: 0, bytes: 0 };
  return {
    memory,
    calls,
    async read(address, length) {
      calls.reads += 1;
      return Buffer.from(memory.subarray(address, address + length));
    },
    async write(address, data) {
      calls.writes += 1;
      calls.bytes += data.length;
      Buffer.from(data).copy(memory, address);
    },
  };
}

async function run(fileName) {
  let failed = 0;
  let passed = 0;
  const started = Date.now();
  for (const { name, fn } of tests) {
    try {
      await withTimeout(fn(), 8000, name);
      passed += 1;
      console.log(`  ok   ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL ${name}\n       ${error.message}`);
      if (process.env.MOONLIGHT_TEST_TRACE) console.log(error.stack);
    }
  }
  console.log(`${fileName}: ${passed} passed, ${failed} failed (${Date.now() - started} ms)`);
  return failed === 0;
}

module.exports = { test, assert, equal, deepEqual, fakeRpc, run };
