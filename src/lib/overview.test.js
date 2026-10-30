import test from 'node:test';
import assert from 'node:assert/strict';
import { askChips, diskSuggestions, forecast, lane, summary, verdicts } from './overview.js';

const GB = 1024 ** 3;
const TB = 1e12;
const host = {
  cpu: 18,
  memory: { total: 64 * GB, used: 41.6 * GB },
  gpus: [{ id: 'g0', name: 'RTX 4060 Ti', util: 71, temp: 64, memUsed: 12.8 * GB, memTotal: 16 * GB }],
  disks: [
    { label: 'Array', total: 50 * TB, used: 38.2 * TB },
    { label: 'Cache', total: 2 * TB, used: 1.22 * TB },
  ],
};

test('a calm server with a busy GPU reads "healthy and busy"', () => {
  const list = verdicts(host);
  assert.deepEqual(list.map((v) => [v.name, v.tone]), [['Compute', 'calm'], ['Memory', 'calm'], ['GPU', 'busy'], ['Storage', 'calm']]);
  assert.deepEqual(summary(list), { head: 'healthy and busy', rest: 'Nothing needs watching right now.' });
});

test('a nearly full data disk is one thing to watch, a full pool is an alarm', () => {
  const data = verdicts({ cpu: 5, disks: [{ label: 'Disk 6', role: 'data', total: 4 * TB, used: 3.7 * TB }, { label: 'Disk 1', role: 'data', total: 12 * TB, used: 9.7 * TB }] });
  assert.equal(data.at(-1).tone, 'watch');
  assert.equal(data.at(-1).state, '1 thing to watch');
  assert.equal(summary(data).rest, 'One thing to watch: Disk 6 is 93% full.');
  assert.equal(askChips(data)[0], 'Why is Disk 6 93% full?');

  const pool = verdicts({ cpu: 5, disks: [{ label: 'Cache', role: 'pool', total: 2 * TB, used: 1.9 * TB }] });
  assert.equal(pool.at(-1).tone, 'bad');
  assert.equal(summary(pool).head, 'under strain');
});

test('suggestions skip parity and disks with room', () => {
  const s = diskSuggestions([
    { label: 'Parity', role: 'parity', total: 12 * TB, used: 12 * TB },
    { label: 'Disk 6', role: 'data', total: 4 * TB, used: 3.7 * TB },
    { label: 'Disk 1', role: 'data', total: 12 * TB, used: 6 * TB },
  ]);
  assert.deepEqual(s.map((x) => x.id), ['full:Disk 6']);
});

test('forecast finds the monthly growth and when the array fills', () => {
  const MONTH = 30.44 * 86400e3;
  const series = [0, 1, 2, 3].map((i) => ({ at: i * MONTH, used: (30 + i) * TB }));
  const fc = forecast(series, 40 * TB);
  assert.equal(Math.round(fc.perMonth / TB), 1);
  assert.equal(Math.round(fc.fullAt / MONTH), 10);
  assert.equal(forecast(series.slice(0, 1), 40 * TB), null);
  assert.equal(forecast([{ at: 0, used: 5 }, { at: 1, used: 5 }], 10).fullAt, null);
});

test('lane averages readings into cells and leaves gaps empty', () => {
  const cells = lane([{ at: 0, cpu: 20 }, { at: 1, cpu: 40 }, { at: 9, cpu: 100 }], 'cpu', { from: 0, to: 10, cells: 5 });
  assert.deepEqual(cells, [0.3, null, null, null, 1]);
});
