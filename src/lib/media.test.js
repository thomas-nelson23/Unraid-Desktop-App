import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMedia, withoutMediaLines, addToLibrary, mediaKind } from './media.js';

test('extractMedia finds the paths Hermes names', () => {
  const text = [
    "Here's your fox: /opt/data/cache/images/fox_001.png.",
    'MEDIA:/opt/data/cache/audio/song.mp3',
    'And a clip at `~/.hermes/cache/clip 2.mp4`',
    'Not this: https://example.com/a.png or C:/x.png or notes.txt',
    '```\n/opt/data/in-code.png\n```',
    'Again /opt/data/cache/images/fox_001.png',
  ].join('\n');
  assert.deepEqual(extractMedia(text), [
    { path: '/opt/data/cache/images/fox_001.png', kind: 'image' },
    { path: '/opt/data/cache/audio/song.mp3', kind: 'audio' },
    { path: '~/.hermes/cache/clip 2.mp4', kind: 'video' },
  ]);
  assert.deepEqual(extractMedia('(saved to /tmp/out.webm)'), [{ path: '/tmp/out.webm', kind: 'video' }]);
  assert.deepEqual(extractMedia(''), []);
  assert.equal(mediaKind('a.FLAC'), 'audio');
});

test('withoutMediaLines drops MEDIA: lines only', () => {
  assert.equal(withoutMediaLines('Done!\nMEDIA:/a/b.png\n'), 'Done!');
  assert.equal(withoutMediaLines('See /a/b.png'), 'See /a/b.png');
});

test('addToLibrary keeps one entry per file, newest first', () => {
  const lib = addToLibrary([{ iid: 'h', path: '/a.png', at: 1 }], [{ iid: 'h', path: '/b.png', at: 2 }, { iid: 'h', path: '/a.png', at: 3 }]);
  assert.deepEqual(lib.map((i) => [i.path, i.at]), [['/b.png', 2], ['/a.png', 3]]);
});
