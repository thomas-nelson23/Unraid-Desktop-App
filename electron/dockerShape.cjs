// Turns what `docker inspect` and `docker stats` print into the container
// shape the Docker page shows, the same shape Home-Dashboard's /api/containers
// answers with. The web UI rules follow Home-Dashboard's server/docker.js.
const { displayName } = require('./names.cjs');

// Docker's own network modes; anything else (br0, a user network) gives the
// container its own address, which Unraid uses for [IP].
const SHARED_MODES = new Set(['bridge', 'default', 'host', 'none']);

function ownAddress(networkMode, networks) {
  if (!networkMode || SHARED_MODES.has(networkMode) || networkMode.startsWith('container:')) return null;
  const n = networks[networkMode] || Object.values(networks)[0];
  return n?.IPAddress || n?.IPAMConfig?.IPv4Address || null;
}

// Works out a container's web UI the way Unraid's Docker tab does: on bridge,
// [IP] is the server and [PORT:n] the host port n is published on; on br0 the
// container has its own address; without a label, guess the first port.
function resolveWebUi({ template, networkMode, networks, ports = [] }, hostIp) {
  const own = ownAddress(networkMode, networks || {});
  const ip = own || hostIp;
  const isBridge = !own && networkMode !== 'host';
  const hostPort = (privatePort) => {
    if (!isBridge) return privatePort;
    const match = ports.find((p) => p.private === privatePort && p.public);
    return match ? match.public : privatePort;
  };
  if (template) return template.replace(/\[IP\]/g, ip).replace(/\[PORT:(\d+)\]/g, (_, n) => String(hostPort(Number(n))));
  const guess = isBridge ? ports.find((p) => p.public)?.public : own ? ports[0]?.private : null;
  return guess ? `http://${ip}:${guess}/` : null;
}

// Ports from `docker inspect`: live bindings for a running container, else
// the configured ones.
function inspectPorts(c) {
  const live = c.NetworkSettings?.Ports || {};
  const source = Object.keys(live).length ? live : { ...Object.fromEntries(Object.keys(c.Config?.ExposedPorts || {}).map((k) => [k, null])), ...(c.HostConfig?.PortBindings || {}) };
  const ports = [];
  for (const [key, bindings] of Object.entries(source)) {
    const [privatePort, proto] = key.split('/');
    if (!bindings || !bindings.length) {
      ports.push({ private: Number(privatePort), public: null, proto });
      continue;
    }
    for (const b of bindings) {
      const pub = b.HostPort ? Number(b.HostPort) : null;
      if (ports.some((p) => p.private === Number(privatePort) && p.public === pub && p.proto === proto)) continue;
      ports.push({ private: Number(privatePort), public: pub, proto });
    }
  }
  return ports.sort((a, b) => a.private - b.private);
}

// "Up 3 hours (unhealthy)" the way `docker ps` says it, from inspect's State.
function statusLine(state) {
  const since = (t) => {
    const ms = Date.now() - Date.parse(t);
    if (!(ms > 0)) return 'just now';
    const h = ms / 3600e3;
    if (h < 1) return `${Math.max(1, Math.round(ms / 60e3))} minutes`;
    if (h < 48) return `${Math.round(h)} hours`;
    return `${Math.round(h / 24)} days`;
  };
  if (state?.Status === 'running') {
    const health = state.Health?.Status;
    return `Up ${since(state.StartedAt)}${health ? ` (${health === 'starting' ? 'health: starting' : health})` : ''}`;
  }
  if (state?.Status === 'paused') return `Up ${since(state.StartedAt)} (Paused)`;
  if (state?.Status === 'exited') return `Exited (${state.ExitCode ?? 0}) ${since(state.FinishedAt)} ago`;
  return state?.Status ? state.Status[0].toUpperCase() + state.Status.slice(1) : 'Unknown';
}

function fromInspect(c, hostIp) {
  const labels = c.Config?.Labels || {};
  const name = (c.Name || '').replace(/^\//, '');
  const ports = inspectPorts(c);
  const networkMode = c.HostConfig?.NetworkMode || null;
  const networks = c.NetworkSettings?.Networks || {};
  const health = c.State?.Health?.Status ?? null;
  return {
    id: String(c.Id || '').slice(0, 12),
    name,
    displayName: displayName(name, c.Config?.Image || ''),
    image: c.Config?.Image || '',
    state: c.State?.Status || 'unknown',
    status: statusLine(c.State),
    health: health === 'none' ? null : health,
    created: c.Created ? Math.round(Date.parse(c.Created) / 1000) : null,
    networkMode,
    networks: Object.entries(networks).map(([n, v]) => ({ name: n, ip: v.IPAddress || v.IPAMConfig?.IPv4Address || null })),
    ports,
    webui: resolveWebUi({ template: labels['net.unraid.docker.webui'], networkMode, networks, ports }, hostIp),
    icon: labels['net.unraid.docker.icon'] || null,
    restartPolicy: c.HostConfig?.RestartPolicy?.Name || 'no',
  };
}

// `docker stats --no-stream --format '{{json .}}'` prints one line per
// container with sizes as text ("1.2GiB / 62GiB").
const UNIT = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };
function size(text) {
  const m = /([\d.]+)\s*([a-z]+)/i.exec(text || '');
  return m ? Number(m[1]) * (UNIT[m[2].toLowerCase()] ?? 1) : 0;
}

function parseStatsLines(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const [used, limit] = String(row.MemUsage || '').split('/');
    const [rx, tx] = String(row.NetIO || '').split('/');
    out[row.Name] = {
      cpu: parseFloat(row.CPUPerc) || 0,
      memory: { used: size(used), limit: size(limit) || null },
      net: { rx: size(rx), tx: size(tx) },
    };
  }
  return out;
}

module.exports = { resolveWebUi, inspectPorts, fromInspect, parseStatsLines, statusLine };
