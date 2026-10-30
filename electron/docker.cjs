const { execFile } = require('node:child_process');
const settings = require('./settings.cjs');
const dashboard = require('./dashboard.cjs');
const { fromInspect, parseStatsLines } = require('./dockerShape.cjs');

// The servers whose containers the Docker page manages. Two kinds:
//   dashboard  Cubecrusher through the Home-Dashboard server: read-only,
//              nothing to set up.
//   ssh        any machine with Docker, over SSH with the keys on this
//              computer: lists, starts, stops, restarts and reads logs.
const CUBECRUSHER = { id: 'cubecrusher', name: 'Cubecrusher', kind: 'dashboard' };
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;

function servers() {
  return [CUBECRUSHER, ...settings.get().servers];
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
    next.push({ id: raw.id && raw.id !== CUBECRUSHER.id ? String(raw.id) : settings.newId(), name: String(raw.name || '').trim().slice(0, 60) || host, kind: 'ssh', host, user, port });
  }
  await settings.update({ servers: next });
  return servers();
}

// Runs one docker command on a server over SSH. BatchMode means a missing key
// fails straight away instead of waiting for a password nobody can type.
function ssh(server, args, { timeout = 20_000 } = {}) {
  const sshArgs = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new', '-p', String(server.port || 22), `${server.user || 'root'}@${server.host}`, 'docker', ...args];
  return new Promise((resolve, reject) => {
    execFile('ssh', sshArgs, { timeout, maxBuffer: 64 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      const text = String(stderr || err.message).trim();
      if (err.code === 'ENOENT') return reject(new Error('The ssh command is not installed on this computer.'));
      if (/Permission denied/i.test(text)) return reject(new Error(`${server.name} refused the SSH key. Add this computer's public key to ${server.user}@${server.host}.`));
      if (/Host key verification failed/i.test(text)) return reject(new Error(`${server.name}'s SSH host key changed. Check ~/.ssh/known_hosts.`));
      if (/Could not resolve|Connection (refused|timed out)|No route to host|Operation timed out/i.test(text)) return reject(new Error(`Can't reach ${server.name} (${server.host}): ${text.split('\n').pop()}`));
      if (/docker: (command )?not found/i.test(text)) return reject(new Error(`Docker isn't installed on ${server.name}.`));
      if (err.killed) return reject(new Error(`${server.name} took too long to answer.`));
      reject(new Error(text.split('\n').pop() || `${server.name}: ssh failed`));
    });
  });
}

// `docker inspect` on every container, in one trip. The server's address
// as the SSH host is what the web UI links use.
async function listSsh(server) {
  const ids = (await ssh(server, ['ps', '-aq'])).split('\n').filter(Boolean);
  if (!ids.length) return [];
  const raw = JSON.parse(await ssh(server, ['inspect', ...ids]));
  return raw.map((c) => fromInspect(c, server.host)).sort((a, b) => a.name.localeCompare(b.name));
}

const stats = async (server) => (server.kind === 'dashboard' ? (await dashboard.get('/api/containers/stats')).stats : parseStatsLines(await ssh(server, ['stats', '--no-stream', '--format', '{{json .}}'])));

async function containers(server) {
  if (server.kind === 'dashboard') return (await dashboard.get('/api/containers')).containers;
  return listSsh(server);
}

function register(ipcMain) {
  ipcMain.handle('docker:servers', () => servers());
  ipcMain.handle('docker:saveServers', (_e, list) => saveServers(list));
  ipcMain.handle('docker:containers', (_e, id) => containers(find(id)));
  ipcMain.handle('docker:stats', (_e, id) => stats(find(id)));
  ipcMain.handle('docker:logs', async (_e, { server, id, tail = 300 }) => {
    const s = find(server);
    if (!ID.test(id)) throw new Error('Bad container id');
    if (s.kind === 'dashboard') throw new Error('Logs need SSH access. Add Cubecrusher as an SSH server to read them.');
    return ssh(s, ['logs', '--tail', String(Math.min(2000, Number(tail) || 300)), '--timestamps', id]).catch((err) => {
      // docker logs writes the log to stderr too, which execFile reports as a failure only with an exit code.
      throw err;
    });
  });
  ipcMain.handle('docker:action', async (_e, { server, id, action }) => {
    const s = find(server);
    if (!ID.test(id)) throw new Error('Bad container id');
    if (!['start', 'stop', 'restart', 'pause', 'unpause'].includes(action)) throw new Error('Unknown action');
    if (s.kind === 'dashboard') throw new Error(`Starting and stopping need SSH access. Add Cubecrusher as an SSH server to ${action} containers.`);
    await ssh(s, [action, id], { timeout: 90_000 });
    return true;
  });
  ipcMain.handle('docker:test', async (_e, raw) => {
    const server = { name: raw.name || raw.host, host: String(raw.host || '').trim(), user: String(raw.user || 'root').trim(), port: Number(raw.port) || 22, kind: 'ssh' };
    const version = (await ssh(server, ['version', '--format', '{{.Server.Version}}'])).trim();
    return { ok: true, version };
  });
}

module.exports = { register, servers };
