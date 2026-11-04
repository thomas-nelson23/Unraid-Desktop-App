const test = require('node:test');
const assert = require('node:assert/strict');
const { kindOf, cleanComfyUrl, toGallery, toQueue, safeName } = require('./comfyShape.cjs');

test('kindOf sorts files by extension', () => {
  assert.equal(kindOf('a.PNG'), 'image');
  assert.equal(kindOf('clip.mp4'), 'video');
  assert.equal(kindOf('song.flac'), 'audio');
  assert.equal(kindOf('notes.txt'), 'file');
});

test('cleanComfyUrl adds http and drops trailing slashes', () => {
  assert.equal(cleanComfyUrl('10.1.1.3:8188/'), 'http://10.1.1.3:8188');
  assert.equal(cleanComfyUrl('https://comfy.lan'), 'https://comfy.lan');
  assert.equal(cleanComfyUrl(''), null);
  assert.equal(cleanComfyUrl('http://'), null);
});

test('toGallery lists outputs newest first and skips temp previews', () => {
  const history = {
    old: {
      prompt: [1, 'old', { 6: { inputs: { text: 'a red fox' }, _meta: { title: 'Positive' } } }],
      outputs: { 9: { images: [{ filename: 'fox.png', subfolder: '', type: 'output' }, { filename: 'p.png', type: 'temp' }] } },
      status: { status_str: 'success', messages: [['execution_start', { timestamp: 100 }], ['execution_success', { timestamp: 200 }]] },
    },
    new: {
      prompt: [2, 'new', {}],
      outputs: { 3: { audio: [{ filename: 'song.mp3', subfolder: 'audio', type: 'output' }] } },
      status: { status_str: 'success', messages: [['execution_success', { timestamp: 900 }]] },
    },
  };
  const g = toGallery(history, 'http://c:8188');
  assert.deepEqual(g.map((x) => x.filename), ['song.mp3', 'fox.png']);
  assert.equal(g[0].kind, 'audio');
  assert.equal(g[0].url, 'http://c:8188/view?filename=song.mp3&subfolder=audio&type=output');
  assert.equal(g[1].prompt, 'a red fox');
});

test('toQueue counts running and pending', () => {
  assert.deepEqual(toQueue({ queue_running: [[1]], queue_pending: [[2], [3]] }), { running: 1, pending: 2 });
  assert.deepEqual(toQueue(null), { running: 0, pending: 0 });
});

test('safeName keeps only a plain file name', () => {
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('my song (1).wav'), 'my song _1_.wav');
  assert.equal(safeName('.hidden'), 'hidden');
});
