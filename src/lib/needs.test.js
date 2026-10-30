import test from 'node:test';
import assert from 'node:assert/strict';
import { needsFromServer, summaryLine } from './needs.js';

const containers = [
  { name: 'plex', displayName: 'Plex', state: 'running', health: 'healthy', status: 'Up 12 days' },
  { name: 'qbit', displayName: 'qBittorrent', state: 'running', health: 'unhealthy', status: 'Up 3 hours (unhealthy)' },
  { name: 'nextcloud', displayName: 'Nextcloud', state: 'exited', health: null, status: 'Exited (0) 2 days ago' },
];

test('unhealthy containers come first and stopped ones are grouped', () => {
  const items = needsFromServer({ containers });
  assert.deepEqual(items.map((i) => i.id), ['unhealthy:qbit', 'stopped']);
  assert.equal(items[1].title, 'Nextcloud is stopped');
});

test('nearly full disks show up, worst first', () => {
  const host = { disks: [{ label: 'Cache', total: 100, used: 85 }, { label: 'Array', total: 100, used: 95 }, { label: 'Docker', total: 100, used: 20 }] };
  const items = needsFromServer({ host });
  assert.deepEqual(items.map((i) => [i.title, i.tone]), [['Array is 95% full', 'red'], ['Cache is 85% full', 'brass']]);
});

test('summary names the urgent item', () => {
  assert.match(summaryLine(needsFromServer({ containers })), /^2 things need you\. The urgent one: qBittorrent is unhealthy\.$/);
  assert.match(summaryLine([]), /Nothing needs you/);
});
