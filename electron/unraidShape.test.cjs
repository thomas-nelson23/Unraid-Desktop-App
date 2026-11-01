const test = require('node:test');
const assert = require('node:assert/strict');
const { toHost, toContainer, parseNvidiaSmi, toDisk } = require('./unraidShape.cjs');

const KB = 1024;

test('toHost turns the array query into the host shape the pages draw', () => {
  const host = toHost({
    info: { os: { hostname: 'Cubecrusher', uptime: '2026-10-01T00:00:00Z' }, cpu: { brand: 'Ryzen 9', packages: [{ temp: 52 }] }, versions: { core: { unraid: '7.2.0', api: '4.40.0' } } },
    metrics: { cpu: { percentTotal: 18.4 }, memory: { total: 64e9, used: 41e9, free: 20e9, available: 23e9 } },
    array: {
      state: 'STARTED',
      capacity: { kilobytes: { total: 50e9, used: 38e9, free: 12e9 } },
      parityCheckStatus: { status: 'RUNNING', progress: 42, running: true, paused: false, errors: 0, speed: '180 MB/s', duration: 3600 },
      parities: [{ id: 'p', name: 'parity', device: 'sdb', size: 12e9, status: 'DISK_OK', type: 'PARITY', temp: 38, isSpinning: true, numErrors: 0 }],
      disks: [
        { id: 'd1', name: 'disk1', device: 'sdc', size: 12e9, status: 'DISK_OK', type: 'DATA', temp: 36, fsSize: 11.9e9, fsUsed: 9.7e9, fsFree: 2.2e9, fsType: 'xfs', isSpinning: true, numErrors: 0 },
        { id: 'd2', name: 'disk2', device: 'sdd', size: 12e9, status: 'DISK_OK', type: 'DATA', temp: null, fsSize: 11.9e9, fsUsed: 9.5e9, fsFree: 2.4e9, fsType: 'xfs', isSpinning: false, numErrors: 2 },
      ],
      caches: [
        { id: 'c1', name: 'cache', device: 'nvme0n1', size: 2e9, status: 'DISK_OK', type: 'CACHE', temp: 44, fsSize: 1.95e9, fsUsed: 1.2e9, fsFree: 0.75e9, fsType: 'btrfs' },
        { id: 'c2', name: 'cache2', device: 'nvme1n1', size: 2e9, status: 'DISK_OK', type: 'CACHE', temp: 41, fsSize: 1.95e9, fsUsed: 0.2e9, fsFree: 1.75e9, fsType: 'btrfs' },
      ],
    },
    gpus: [{ id: 'nvidia0', util: 71 }],
  });
  assert.equal(host.hostname, 'Cubecrusher');
  assert.equal(host.cpu, 18.4);
  assert.equal(host.cpuTemp, 52);
  assert.deepEqual(host.memory, { total: 64e9, used: 41e9, free: 20e9, available: 23e9 });
  assert.deepEqual(host.disks.map((d) => [d.label, d.role]), [
    ['Array', 'array'],
    ['Cache', 'pool'],
    ['Parity', 'parity'],
    ['Disk 1', 'data'],
    ['Disk 2', 'data'],
  ]);
  assert.equal(host.disks[0].total, 50e9 * KB);
  assert.equal(host.disks[0].used, 38e9 * KB);
  // Both cache members add up into one pool row, at the warmer temperature.
  assert.equal(host.disks[1].total, 2 * 1.95e9 * KB);
  assert.equal(host.disks[1].used, 1.4e9 * KB);
  assert.equal(host.disks[1].temp, 44);
  assert.equal(host.disks[4].note, 'spun down · 2 errors · xfs');
  assert.equal(host.disks[4].temp, null);
  assert.equal(host.array.parity.progress, 42);
  assert.equal(host.gpus[0].util, 71);
  assert.equal(host.versions.unraid, '7.2.0');
});

test('toHost copes with the plainest answer', () => {
  const host = toHost({ metrics: { cpu: { percentTotal: 3 }, memory: { total: 8e9, used: 1e9 } }, array: { state: 'STOPPED' } });
  assert.equal(host.cpu, 3);
  assert.deepEqual(host.disks, []);
  assert.equal(host.array.state, 'STOPPED');
  assert.equal(host.array.parity, null);
});

test('toDisk reads sizes from the filesystem when it has one', () => {
  const d = toDisk({ name: 'disk3', size: 100, fsSize: 90, fsUsed: 45, status: 'DISK_OK', temp: 30 }, 'data');
  assert.equal(d.total, 90 * KB);
  assert.equal(d.used, 45 * KB);
  assert.equal(d.note, null);
  const p = toDisk({ name: 'parity', size: 100, status: 'DISK_DSBL', temp: null }, 'parity');
  assert.equal(p.total, 100 * KB);
  assert.equal(p.used, null);
  assert.equal(p.note, 'dsbl');
});

test('toContainer matches the docker inspect shape', () => {
  const c = toContainer(
    {
      id: 'docker:abcdef1234567890',
      names: ['/plex'],
      image: 'lscr.io/linuxserver/plex:latest',
      state: 'RUNNING',
      status: 'Up 3 days (healthy)',
      autoStart: true,
      isUpdateAvailable: false,
      webUiUrl: null,
      iconUrl: 'https://x/plex.png',
      ports: [{ privatePort: 32400, publicPort: 32400, type: 'TCP', ip: '0.0.0.0' }],
      hostConfig: { networkMode: 'bridge' },
      labels: { 'net.unraid.docker.webui': 'http://[IP]:[PORT:32400]/web' },
      networkSettings: { Networks: { bridge: { IPAddress: '172.17.0.5' } } },
    },
    '192.168.1.10',
  );
  assert.equal(c.id, 'docker:abcdef1234567890');
  assert.equal(c.dockerId, 'abcdef123456');
  assert.equal(c.name, 'plex');
  assert.equal(c.displayName, 'Plex');
  assert.equal(c.state, 'running');
  assert.equal(c.health, 'healthy');
  assert.deepEqual(c.ports, [{ private: 32400, public: 32400, proto: 'tcp' }]);
  assert.equal(c.webui, 'http://192.168.1.10:32400/web');
  assert.equal(c.icon, 'https://x/plex.png');
  assert.deepEqual(c.networks, [{ name: 'bridge', ip: '172.17.0.5' }]);
  const stopped = toContainer({ id: 'docker:1', names: ['sonarr'], image: 'sonarr', state: 'EXITED', status: 'Exited (0) 2 hours ago' }, '10.0.0.1');
  assert.equal(stopped.state, 'exited');
  assert.equal(stopped.health, null);
  assert.equal(stopped.webui, null);
});

test('parseNvidiaSmi reads the csv with units stripped', () => {
  const [g] = parseNvidiaSmi('0, NVIDIA GeForce RTX 4090, 71, 13107, 24564, 64, 310.5, 450.0\n');
  assert.equal(g.id, 'nvidia0');
  assert.equal(g.name, 'NVIDIA GeForce RTX 4090');
  assert.equal(g.util, 71);
  assert.equal(g.memUsed, 13107 * 1024 ** 2);
  assert.equal(g.memTotal, 24564 * 1024 ** 2);
  assert.equal(g.temp, 64);
  assert.deepEqual(parseNvidiaSmi(''), []);
});
