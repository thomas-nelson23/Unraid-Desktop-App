import test from 'node:test';
import assert from 'node:assert/strict';
import { withBrief, splitBrief, slashState, argOptions, serverSnapshot, filterSessions, isStudio, visibleSlice, FEATURED, featuredBrief } from './ai.js';

test('a brief round-trips through withBrief and splitBrief', () => {
  const msg = withBrief('Unraid maintenance', 'Role.\nLine two.', 'Run a health check');
  const back = splitBrief(msg);
  assert.deepEqual(back, { name: 'Unraid maintenance', brief: 'Role.\nLine two.', text: 'Run a health check' });
  assert.equal(splitBrief('hello'), null);
  assert.equal(withBrief('x', '', 'hi'), 'hi');
});

test('slashState lists commands, then waits for an argument', () => {
  assert.equal(slashState('hello'), null);
  const s = slashState('/mo');
  assert.equal(s.stage, 'command');
  assert.deepEqual(s.matches.map((c) => c.cmd), ['model']);
  assert.equal(slashState('/').matches.length > 5, true);
  const a = slashState('/model gpt');
  assert.equal(a.stage, 'arg');
  assert.equal(a.command.cmd, 'model');
  assert.equal(a.query, 'gpt');
  assert.deepEqual(slashState('/nope x').matches, []);
});

test('argOptions filters models by name or provider', () => {
  const models = { model: 'qwen3', providers: [{ slug: 'ollama', name: 'Ollama', current: true, models: ['qwen3', 'llama3'] }, { slug: 'openrouter', name: 'OpenRouter', models: ['gpt-5'] }] };
  const cmd = slashState('/model ').command;
  assert.equal(argOptions(cmd, '', { models }).length, 3);
  assert.deepEqual(argOptions(cmd, 'llama3', { models }).map((o) => o.value), [{ model: 'llama3', provider: 'ollama' }]);
  assert.equal(argOptions(cmd, 'openrouter', { models }).length, 1);
  assert.equal(argOptions(cmd, '', { models })[0].current, true);
});

test('serverSnapshot puts the readings into words', () => {
  const host = { cpu: 12, memory: { total: 64 * 1024 ** 3, used: 32 * 1024 ** 3 }, disks: [{ label: 'Cache', total: 100, used: 95, role: 'pool' }], gpus: [] };
  const text = serverSnapshot({ host, containers: [{ name: 'plex', state: 'running' }, { name: 'sonarr', state: 'exited' }], needs: [{ title: 'Cache is 95% full' }] });
  assert.match(text, /CPU 12%/);
  assert.match(text, /Disk Cache: 95% full \(pool\)/);
  assert.match(text, /1 of 2 containers running\. Not running: sonarr/);
  assert.match(text, /Needs attention: Cache is 95% full/);
  assert.match(serverSnapshot({}), /isn't receiving/);
});

test('featured chats: maintenance is on and carries a snapshot', () => {
  const m = FEATURED.find((f) => f.id === 'maintenance');
  assert.equal(m.on, true);
  assert.match(featuredBrief(m, {}), /Cubecrusher/);
  assert.match(featuredBrief(m, {}), /Snapshot taken/);
  assert.doesNotMatch(featuredBrief(FEATURED.find((f) => f.id === 'degoogle'), {}), /Snapshot taken/);
});

test('sessions: search, studio prefix and the visible window', () => {
  const list = [{ title: 'Studio · fox' }, { title: 'Parity', preview: 'when does it run' }];
  assert.equal(filterSessions(list, 'run').length, 1);
  assert.equal(filterSessions(list, '').length, 2);
  assert.equal(isStudio(list[0]), true);
  assert.equal(isStudio(list[1]), false);
  assert.deepEqual(visibleSlice([1, 2, 3, 4], 2), [3, 4]);
  assert.deepEqual(visibleSlice([1], 2), [1]);
});

test('madeBy gives each output to the chat that asked last before it', async () => {
  const { madeBy, filesNote } = await import('./ai.js');
  const gallery = [{ id: 'a', at: 50 }, { id: 'b', at: 150 }, { id: 'c', at: 5 }, { id: 'd', at: null }];
  const out = madeBy(gallery, [{ sid: 'x', at: 10 }, { sid: 'y', at: 100 }]);
  assert.deepEqual(out.x.map((i) => i.id), ['a']);
  assert.deepEqual(out.y.map((i) => i.id), ['b']);
  assert.match(filesNote([{ filename: 'song.wav', kind: 'audio', subfolder: '' }]), /- song\.wav \(audio\)/);
  assert.equal(filesNote([]), '');
});
