const settings = require('./settings.cjs');
const dashboard = require('./dashboard.cjs');
const unraid = require('./unraid.cjs');
const ssh = require('./ssh.cjs');
const { fromInspect, parseStatsLines } = require('./dockerShape.cjs');

// The servers whose containers the Docker page manages. Three kinds:
//   unraid     Cubecrusher through Unraid's own API: lists, starts, stops
//              and restarts; logs and live stats over SSH when it's set up.
//   dashboard  Cubecrusher through the Home-Dashboard server, read-only,
//              when no Unraid API key is set yet.
//   ssh        any machine with Docker, over SSH with the keys on this
//              computer: lists, starts, stops, restarts and reads logs.
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,100}$/;

function cubecrusher() {
  if (unraid.configured()) return { ...unraid.sshServer(), kind: 'unraid' };
  return { id: 'cubecrusher', name: 'Cubecrusher', kind: 'dashboard' };
}

function servers() {
  return [cubecrusher(), ...settings.get().servers];
}

function find(id) {
  const s = servers().find((x) => x.id === id);
  if (!s) throw new Error('No such server.');
  return s;
}

async function saveServers(list) {
  const next = [];
  for (const raw of list || []) {
    const host = String(raw.host || '').trim();
    if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new Error(`"${host || raw.name}" doesn't look like a host name or address.`);
    const user = String(raw.user || 'root').trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(user)) throw new Error('The SSH user can only have letters, numbers, dots, dashes and underscores.');
    const port = Number(raw.port) || 22;
    next.push({ id: raw.id && raw.id !== 'cubecrusher' ? String(raw.id) : settings.newId(), name: String(raw.name || '').trim().slice(0, 60) || host, kind: 'ssh', host, user, port });
  }
  await settings.update({ servers: next });
  return servers();
}

const dockerSsh = ssh.docker;

// `docker inspect` on every container, in one trip. The server's address
// as the SSH host is what the web UI links use.
async function listSsh(server) {
  const ids = (await dockerSsh(server, ['ps', '-aq'])).split('\n').filter(Boolean);
  if (!ids.length) return [];
  const raw = JSON.parse(await dockerSsh(server, ['inspect', ...ids]));
  return raw.map((c) => fromInspect(c, server.host)).sort((a, b) => a.name.localeCompare(b.name));
}

const sshStats = async (server) => parseStatsLines(await dockerSsh(server, ['stats', '--no-stream', '--format', '{{json .}}']));
// Unraid's API only streams stats over a socket, so Cubecrusher's come over
// SSH too; when that isn't set up they stay blank, and it's retried later.
const cubecrusherStats = ssh.withBackoff(sshStats);

async function stats(server) {
  if (server.kind === 'dashboard') return (await dashboard.get('/api/containers/stats')).stats;
  if (server.kind === 'unraid') return cubecrusherStats(server).catch(() => ({}));
  return sshStats(server);
}

async function containers(server) {
  if (server.kind === 'dashboard') return (await dashboard.get('/api/containers')).containers;
  if (server.kind === 'unraid') return unraid.containers();
  return listSsh(server);
}

// Over SSH, docker wants the container's own name or id, not Unraid's prefixed one.
const sshName = (c) => c.name || c.dockerId || c.id;

function register(ipcMain) {
  ipcMain.handle('docker:servers', () => servers());
  ipcMain.handle('docker:saveServers', (_e, list) => saveServers(list));
  ipcMain.handle('docker:containers', (_e, id) => containers(find(id)));
  ipcMain.handle('docker:stats', (_e, id) => stats(find(id)));
  ipcMain.handle('docker:logs', async (_e, { server, id, name, tail = 300 }) => {
    const s = find(server);
    const target = s.kind === 'unraid' ? sshName({ name, id }) : id;
    if (!ID.test(target)) throw new Error('Bad container id');
    if (s.kind === 'dashboard') throw new Error('Logs need the Unraid API and SSH. Set Cubecrusher up under Settings.');
    return dockerSsh(s, ['logs', '--tail', String(Math.min(2000, Number(tail) || 300)), '--timestamps', target], { timeout: 30_000 }).catch((err) => {
      if (s.kind === 'unraid' && /refused the SSH key|not installed|over SSH/.test(err.message)) throw new Error(`${err.message} Logs come over SSH; the API has no way to read them.`);
      throw err;
    });
  });
  ipcMain.handle('docker:action', async (_e, { server, id, action }) => {
    const s = find(server);
    if (!ID.test(id)) throw new Error('Bad container id');
    if (!['start', 'stop', 'restart', 'pause', 'unpause'].includes(action)) throw new Error('Unknown action');
    if (s.kind === 'dashboard') throw new Error(`Starting and stopping need the Unraid API. Set Cubecrusher up under Settings to ${action} containers.`);
    if (s.kind === 'unraid') return unraid.action(id, action);
    await dockerSsh(s, [action, id], { timeout: 90_000 });
    return true;
  });
  ipcMain.handle('docker:test', async (_e, raw) => {
    const server = { name: raw.name || raw.host, host: String(raw.host || '').trim(), user: String(raw.user || 'root').trim(), port: Number(raw.port) || 22, kind: 'ssh' };
    const version = (await dockerSsh(server, ['version', '--format', '{{.Server.Version}}'])).trim();
    return { ok: true, version };
  });
}

module.exports = { register, servers };
