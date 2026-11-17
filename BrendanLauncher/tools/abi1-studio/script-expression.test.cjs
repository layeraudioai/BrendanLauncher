'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const math = require('./script-expression.js');

test('math expression transpiler preserves ordinary arithmetic and maps extended operators', () => {
  const expression = math.transpileExpression('a + b * 3 / 2 - c');
  assert.match(expression, /\+.*\*.*\/.*-/);
  assert.match(math.transpileExpression('x ^ 3'), /pow\(float\(x\), float\(3\)\)/);
  assert.match(math.transpileExpression('x ** 3'), /pow\(float\(x\), float\(3\)\)/);
  assert.match(math.transpileExpression('x % 3'), /mod\(float\(x\), float\(3\)\)/);
  assert.equal(math.transpileExpression('!enabled'), '(!enabled)');
  assert.match(math.transpileExpression('5!'), /hbFactorial\(float\(5\)\)/);
  assert.match(math.transpileExpression('factorial(n)'), /hbFactorial\(float\(n\)\)/);
});

test('math expression transpiler supports logarithms, roots, absolute values, and random', () => {
  assert.match(math.transpileExpression('log(2, 8)'), /log\(float\(8\)\) \/ log\(float\(2\)\)/);
  assert.match(math.transpileExpression('log10(x)'), /log\(float\(x\)\) \/ log\(10\.0\)/);
  assert.match(math.transpileExpression('ln(x)'), /^log\(float\(x\)\)$/);
  assert.equal(math.transpileExpression('sqrt(x)'), 'sqrt(x)');
  assert.equal(math.transpileExpression('abs(x)'), 'abs(x)');
  assert.match(math.transpileExpression('root(3, x)'), /pow\(float\(x\), 1\.0 \/ float\(3\)\)/);
  assert.match(math.transpileExpression('cbrt(x)'), /sign\(float\(x\)\).*pow\(abs\(float\(x\)\)/);
  assert.equal(math.transpileExpression('random()'), 'hbRandom(objectIndex)');
  assert.match(math.transpileExpression('random(-2, 5)'), /hbRandomRange\(float\(\(-2\)\), float\(5\), objectIndex\)/);
  assert.match(math.transpileExpression('pi * e'), /3\.141592653589793.*2\.718281828459045/);
  assert.throws(() => math.transpileExpression('random(1)'), /either no arguments or a minimum and maximum/);
});

test('once blocks are lowered to persistent per-object execution guards', () => {
  let slot = 0;
  const source = ['// once { this is documentation }', 'once { position.x = 1.0; }', 'once{ position.y = 2.0; }'].join(String.fromCharCode(10));
  const result = math.transpileSource(source, { allocateOnceSlot: () => slot++ });
  assert.ok(result.includes('hbRunOnce(onceFlags, 0u)'));
  assert.ok(result.includes('hbRunOnce(onceFlags, 1u)'));
  assert.ok(result.includes('// once { this is documentation }'));
  assert.throws(() => math.transpileSource('once { position.x = 1.0;'), /Unclosed once/);
});

test('source compiler transforms extended syntax only in assignment right-hand sides', () => {
  const source = '// x = y ^ 2;\nposition.x = abs(-2) + 3^2;\nif (buttons == HB_A) { position.y += dt; }';
  const result = math.transpileSource(source);
  assert.match(result, /^\/\/ x = y \^ 2;/);
  assert.match(result, /position\.x =\s*\(\(abs\(\(-2\)\)\) \+ \(pow\(float\(3\), float\(2\)\)\)\);/);
  assert.match(result, /if \(buttons == HB_A\) \{ position\.y \+= dt; \}/);
  assert.throws(() => math.transpileSource('position.x = random(1);'), /either no arguments or a minimum and maximum/);
});
