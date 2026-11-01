// Turns what Unraid's own GraphQL API answers into the shapes the pages
// already draw: the same `host` Home-Dashboard's /api/server gives, and the
// same container rows as `docker inspect`. Pure functions, tested on their own.
const { displayName } = require('./names.cjs');
const { resolveWebUi } = require('./dockerShape.cjs');

const KB = 1024;
const MiB = 1024 ** 2;

// A disk from the array query. Sizes are kilobytes; temp is °C or null when
// the disk is spun down.
function toDisk(d, role) {
  const total = d.fsSize != null ? Number(d.fsSize) * KB : Number(d.size || 0) * KB;
  const used = d.fsUsed != null ? Number(d.fsUsed) * KB : null;
  const parts = [];
  if (d.status && d.status !== 'DISK_OK') parts.push(d.status.replace(/^DISK_/, '').replace(/_/g, ' ').toLowerCase());
  if (d.isSpinning === false) parts.push('spun down');
  if (d.numErrors) parts.push(`${d.numErrors} errors`);
  if (d.fsType) parts.push(d.fsType);
  return {
    id: d.id,
    label: d.name ? d.name.replace(/^disk(\d+)$/i, 'Disk $1').replace(/^parity$/i, 'Parity').replace(/^parity2$/i, 'Parity 2').replace(/^(\w)/, (c) => c.toUpperCase()) : role,
    role,
    device: d.device || null,
    total,
    used,
    temp: d.temp ?? null,
    spinning: d.isSpinning ?? null,
    status: d.status || null,
    errors: d.numErrors ?? 0,
    note: parts.join(' · ') || null,
  };
}

const sum = (list, key) => list.reduce((n, d) => n + (d[key] || 0), 0);

// The host shape the top bar, Home and Overview read.
function toHost({ info, metrics, array, gpus = [], hostname } = {}) {
  const mem = metrics?.memory || {};
  const parities = (array?.parities || []).map((d) => toDisk(d, 'parity'));
  const data = (array?.disks || []).map((d) => toDisk(d, 'data'));
  const caches = (array?.caches || []).map((d) => toDisk(d, 'pool'));
  const cap = array?.capacity?.kilobytes;
  const arrayTotal = cap ? Number(cap.total) * KB : sum(data, 'total');
  const arrayUsed = cap ? Number(cap.used) * KB : sum(data, 'used');
  // Pools: one row per pool name (cache, cache2…), their members added up.
  const pools = new Map();
  for (const c of caches) {
    const name = c.label.replace(/\s*\d+$/, '');
    const p = pools.get(name) || { label: name, role: 'pool', total: 0, used: 0, temp: null, note: null, members: 0 };
    p.total += c.total;
    p.used += c.used || 0;
    p.temp = c.temp != null ? Math.max(p.temp ?? 0, c.temp) : p.temp;
    p.members += 1;
    pools.set(name, p);
  }
  const disks = [
    ...(arrayTotal ? [{ label: 'Array', role: 'array', total: arrayTotal, used: arrayUsed }] : []),
    ...[...pools.values()].map((p) => ({ ...p, label: p.label === 'Cache' ? 'Cache' : p.label })),
    ...parities,
    ...data,
  ];
  const parity = array?.parityCheckStatus || null;
  const cpuTemp = info?.cpu?.packages?.[0]?.temp ?? null;
  return {
    at: Date.now(),
    hostname: hostname || info?.os?.hostname || null,
    uptime: info?.os?.uptime || null,
    cpu: Number(metrics?.cpu?.percentTotal ?? 0),
    cpuTemp,
    cpuName: info?.cpu?.brand || null,
    memory: { total: Number(mem.total || 0), used: Number(mem.used || 0), free: Number(mem.free || 0), available: Number(mem.available || 0) },
    disks,
    gpus,
    array: {
      state: array?.state || null,
      parity: parity
        ? { status: parity.status || null, running: Boolean(parity.running), paused: Boolean(parity.paused), progress: parity.progress ?? null, errors: parity.errors ?? null, speed: parity.speed || null, duration: parity.duration ?? null }
        : null,
    },
    versions: info?.versions?.core || null,
  };
}

// Unraid's container state names, to Docker's own.
const STATE = { RUNNING: 'running', EXITED: 'exited', PAUSED: 'paused', CREATED: 'created', RESTARTING: 'restarting', DEAD: 'dead', REMOVING: 'removing' };

function toContainer(c, hostIp) {
  const name = String((c.names || [])[0] || '').replace(/^\//, '');
  const labels = c.labels && typeof c.labels === 'object' ? c.labels : {};
  const networkMode = c.hostConfig?.networkMode || null;
  const networks = c.networkSettings?.Networks || {};
  const ports = (c.ports || [])
    .map((p) => ({ private: Number(p.privatePort), public: p.publicPort ? Number(p.publicPort) : null, proto: String(p.type || 'tcp').toLowerCase() }))
    .filter((p) => p.private)
    .sort((a, b) => a.private - b.private);
  const state = STATE[String(c.state || '').toUpperCase()] || String(c.state || 'unknown').toLowerCase();
  return {
    id: String(c.id || ''),
    dockerId: String(c.id || '').replace(/^[a-z]+:/i, '').slice(0, 12),
    name,
    displayName: displayName(name, c.image || ''),
    image: c.image || '',
    state,
    status: c.status || state,
    health: /\(unhealthy\)/i.test(c.status || '') ? 'unhealthy' : /\(healthy\)/i.test(c.status || '') ? 'healthy' : null,
    created: c.created ? Number(c.created) : null,
    networkMode,
    networks: Object.entries(networks).map(([n, v]) => ({ name: n, ip: v?.IPAddress || v?.IPAMConfig?.IPv4Address || null })),
    ports,
    webui: c.webUiUrl || resolveWebUi({ template: labels['net.unraid.docker.webui'], networkMode, networks, ports }, hostIp),
    icon: c.iconUrl || labels['net.unraid.docker.icon'] || null,
    autoStart: c.autoStart ?? null,
    updateAvailable: c.isUpdateAvailable ?? null,
  };
}

// nvidia-smi's CSV, the way Home-Dashboard reads it.
function num(s) {
  const n = Number(s);
  return s === '' || s == null || !Number.isFinite(n) ? null : n;
}
function parseNvidiaSmi(csv) {
  return String(csv || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [index, name, util, memUsed, memTotal, temp, power, powerLimit] = line.split(',').map((s) => s.trim());
      return {
        id: `nvidia${index}`,
        vendor: 'nvidia',
        name,
        util: num(util),
        memUsed: num(memUsed) == null ? null : num(memUsed) * MiB,
        memTotal: num(memTotal) == null ? null : num(memTotal) * MiB,
        temp: num(temp),
        power: num(power),
        powerLimit: num(powerLimit),
      };
    });
}

module.exports = { toDisk, toHost, toContainer, parseNvidiaSmi };
