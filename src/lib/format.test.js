import test from 'node:test';
import assert from 'node:assert/strict';
import { bytes, greeting, pct, weatherLabel } from './format.js';

test('bytes scales to the right unit', () => {
  assert.equal(bytes(512), '512 B');
  assert.equal(bytes(1536), '1.5 KB');
  assert.equal(bytes(15.7e12, { si: true }), '15.7 TB');
});

test('pct clamps to 0..100', () => {
  assert.equal(pct(5, 0), 0);
  assert.equal(pct(150, 100), 100);
  assert.equal(pct(25, 100), 25);
});

test('greeting follows the hour', () => {
  assert.equal(greeting(3), 'Good night');
  assert.equal(greeting(9), 'Good morning');
  assert.equal(greeting(14), 'Good afternoon');
  assert.equal(greeting(20), 'Good evening');
});

test('weatherLabel knows the common codes', () => {
  assert.equal(weatherLabel(0), 'clear');
  assert.equal(weatherLabel(63), 'rain');
  assert.equal(weatherLabel(96), 'thunderstorms');
});
