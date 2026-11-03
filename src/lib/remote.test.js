import test from 'node:test';
import assert from 'node:assert/strict';
import { explainGuac, rdpTarget, socketUrl, vmTarget } from './remote.js';
import { KEYSYM, keystrokes, pressCombo } from './keys.js';

test('socket addresses follow the server address', () => {
  assert.equal(socketUrl('http://10.1.1.3:3000', '/api/vms/a/screen'), 'ws://10.1.1.3:3000/api/vms/a/screen');
  assert.equal(socketUrl('https://dash.example.com/', '/api/remote/pc/tunnel'), 'wss://dash.example.com/api/remote/pc/tunnel');
});

test('a VM row says why its screen can’t open', () => {
  assert.equal(vmTarget({ id: 'a', name: 'Win', running: true, cpus: 8, memoryMb: 16384 }).meta, '8 vCPU · 16 GB');
  const off = vmTarget({ id: 'b', name: 'Mac', running: false });
  assert.equal(off.canConnect, false);
  assert.match(off.why, /is off/);
  const noScreen = vmTarget({ id: 'c', name: 'HA', running: true, problem: 'No VNC.' });
  assert.equal(noScreen.canConnect, false);
  assert.equal(noScreen.why, 'No VNC.');
});

test('an RDP row hides the usual port and offers wake when asleep', () => {
  const pc = rdpTarget({ id: 'p', name: 'PC', protocol: 'rdp', host: '10.1.1.2', port: 3389, awake: false, mac: 'aa:bb:cc:dd:ee:ff' });
  assert.equal(pc.meta, 'RDP · 10.1.1.2');
  assert.equal(pc.wakeable, true);
  assert.equal(rdpTarget({ id: 'q', name: 'Q', protocol: 'rdp', host: 'h', port: 3390, awake: true }).meta, 'RDP · h:3390');
});

test('guacd errors read as sentences', () => {
  const pc = { name: 'PC', host: '10.1.1.2', port: 3389, wakeable: true };
  assert.match(explainGuac({ code: 0x0301 }, pc), /turned down the sign-in/);
  assert.match(explainGuac({ code: 0x0207, message: '519' }, pc), /didn't answer at 10\.1\.1\.2:3389\. If it.s asleep/);
  assert.equal(explainGuac({ code: 0x0207, message: "Can't reach guacd at x:4822." }, pc), "Can't reach guacd at x:4822.");
});

test('combos press in order and release in reverse', () => {
  const log = [];
  pressCombo((k, down) => log.push([k, down]), [KEYSYM.Ctrl, KEYSYM.Alt, KEYSYM.Delete]);
  assert.deepEqual(log, [
    [KEYSYM.Ctrl, true],
    [KEYSYM.Alt, true],
    [KEYSYM.Delete, true],
    [KEYSYM.Delete, false],
    [KEYSYM.Alt, false],
    [KEYSYM.Ctrl, false],
  ]);
});

test('typing adds Shift for VNC only', () => {
  assert.deepEqual(keystrokes('aB\n'), [[0x61], [0x42], [KEYSYM.Enter]]);
  assert.deepEqual(keystrokes('aB', { shift: true }), [[0x61], [KEYSYM.Shift, 0x42]]);
});
