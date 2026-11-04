const test = require('node:test');
const assert = require('node:assert/strict');
const { safeMediaPath, containerFor, readCommand, writeCommand, safeUploadName } = require('./hermesMedia.cjs');

test('safeMediaPath takes media paths only', () => {
  assert.equal(safeMediaPath('/opt/data/cache/out 1.png'), '/opt/data/cache/out 1.png');
  assert.equal(safeMediaPath('~/.hermes/cache/song.mp3'), '~/.hermes/cache/song.mp3');
  assert.equal(safeMediaPath('/etc/passwd'), null);
  assert.equal(safeMediaPath('/x/$(rm -rf ~).png'), null);
  assert.equal(safeMediaPath("/x/a'b.png"), null);
  assert.equal(safeMediaPath('/x/../../etc/a.png'), null);
  assert.equal(safeMediaPath('relative.png'), null);
});

test('containerFor finds the container by its published port', () => {
  const ps = 'plex|0.0.0.0:32400->32400/tcp\nhermes-agent|0.0.0.0:8642->8642/tcp, 0.0.0.0:9119->9119/tcp\nhermes-2|0.0.0.0:8643->8642/tcp';
  assert.equal(containerFor(ps, 8643), 'hermes-2');
  assert.equal(containerFor(ps, 8642), 'hermes-agent');
  assert.equal(containerFor('plex|\nhermes|', 9999), 'hermes');
  assert.equal(containerFor('a|\nb|', 1), null);
});

test('commands quote what they pass to the shell', () => {
  const r = readCommand('hermes', '~/.hermes/a b.png');
  assert.deepEqual(r.slice(0, 3), ['docker', 'exec', "'hermes'"]);
  assert.match(r[5], /cat "\$HOME"\//);
  const w = writeCommand('hermes', "it's.wav");
  assert.match(w.at(-1), /uploads/);
  assert.equal(safeUploadName('../x/../my song?.wav'), 'my song_.wav');
});
