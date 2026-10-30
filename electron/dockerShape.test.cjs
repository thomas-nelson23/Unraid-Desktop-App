const test = require('node:test');
const assert = require('node:assert/strict');
const { fromInspect, parseStatsLines, resolveWebUi } = require('./dockerShape.cjs');

test('fromInspect reads an Unraid container', () => {
  const c = fromInspect(
    {
      Id: 'abcdef1234567890',
      Name: '/binhex-radarr',
      Created: '2026-10-01T00:00:00Z',
      Config: { Image: 'binhex/arch-radarr', Labels: { 'net.unraid.docker.webui': 'http://[IP]:[PORT:7878]/', 'net.unraid.docker.icon': 'x.png' }, ExposedPorts: { '7878/tcp': {} } },
      State: { Status: 'running', StartedAt: new Date(Date.now() - 2 * 3600e3).toISOString(), Health: { Status: 'healthy' } },
      HostConfig: { NetworkMode: 'bridge', PortBindings: {}, RestartPolicy: { Name: 'unless-stopped' } },
      NetworkSettings: { Ports: { '7878/tcp': [{ HostIp: '0.0.0.0', HostPort: '7878' }, { HostIp: '::', HostPort: '7878' }] }, Networks: { bridge: { IPAddress: '172.17.0.4' } } },
    },
    '10.0.0.5',
  );
  assert.equal(c.id, 'abcdef123456');
  assert.equal(c.displayName, 'Radarr');
  assert.equal(c.status, 'Up 2 hours (healthy)');
  assert.equal(c.health, 'healthy');
  assert.deepEqual(c.ports, [{ private: 7878, public: 7878, proto: 'tcp' }]);
  assert.equal(c.webui, 'http://10.0.0.5:7878/');
});

test('a br0 container is reached on its own address', () => {
  assert.equal(resolveWebUi({ template: 'http://[IP]:8123/', networkMode: 'br0', networks: { br0: { IPAddress: '192.168.1.21' } }, ports: [] }, '10.0.0.5'), 'http://192.168.1.21:8123/');
});

test('parseStatsLines reads docker stats json lines', () => {
  const s = parseStatsLines('{"Name":"plex","CPUPerc":"3.52%","MemUsage":"1.5GiB / 62.7GiB","NetIO":"12MB / 3.4MB"}\nnot json\n');
  assert.equal(Math.round(s.plex.memory.used / 1024 ** 2), 1536);
  assert.equal(s.plex.cpu, 3.52);
  assert.equal(s.plex.net.rx, 12e6);
});
