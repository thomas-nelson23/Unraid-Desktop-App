const { net, session } = require('electron');
const settings = require('./settings.cjs');
const ssh = require('./ssh.cjs');
const { toHost, toContainer, parseNvidiaSmi } = require('./unraidShape.cjs');

// Cubecrusher through Unraid's own API (the GraphQL one built into Unraid
// 7 and reached with an API key), plus SSH for the few things it doesn't
// cover: GPU readings, container logs and live container stats.

function conf() {
  const u = settings.get().unraid || {};
  return { url: String(u.url || '').replace(/\/+$/, ''), apiKey: u.apiKey || '', insecure: Boolean(u.insecure), sshUser: u.sshUser || 'root', sshPort: Number(u.sshPort) || 22 };
}

const configured = () => Boolean(conf().url && conf().apiKey);

// The SSH view of the same machine, for the bits the API can't do.
function sshServer(c = conf()) {
  let host = '';
  try {
    host = new URL(c.url).hostname;
  } catch {}
  return { id: 'cubecrusher', name: 'Cubecrusher', host, user: c.sshUser, port: c.sshPort };
}

// Unraid's own certificate is for its myunraid.net name, so by address it
// doesn't check out. "Trust its certificate" lets that through for this
// one host only; everything else is checked as usual.
function ready() {
  session.defaultSession.setCertificateVerifyProc((req, callback) => {
    const c = override || conf();
    if (c.insecure && req.hostname && req.hostname === sshServer(c).host) return callback(0);
    callback(-3);
  });
}

class GqlError extends Error {
  constructor(message, { status, validation = false } = {}) {
    super(message);
    this.status = status;
    this.validation = validation;
  }
}

async function gql(query, variables = {}, c = conf()) {
  if (!c.url) throw new GqlError("Cubecrusher's address isn't set. Add it under Settings.");
  if (!c.apiKey) throw new GqlError('No Unraid API key yet. Make one under Settings → Management Access → API Keys on Cubecrusher and paste it in Settings.');
  let res;
  try {
    res = await net.fetch(`${c.url}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': c.apiKey },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const cause = String(err.cause?.code || err.cause?.message || err.message || err);
    if (/CERT|certificate|self.signed|unable to verify/i.test(cause)) throw new GqlError(`Cubecrusher's certificate isn't trusted by this computer (${cause.replace(/^net::/, '')}). Use its http:// address, or tick "Trust its certificate" in Settings.`);
    if (err.name === 'TimeoutError' || /TIMED_OUT/.test(cause)) throw new GqlError(`Cubecrusher (${c.url}) took too long to answer.`);
    throw new GqlError(`Can't reach Cubecrusher at ${c.url}: ${cause.replace(/^net::/, '')}`);
  }
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}
  if (res.status === 401 || res.status === 403) throw new GqlError(`Cubecrusher refused the API key (${res.status}). Check it under Settings → Management Access → API Keys on Cubecrusher; it needs at least the viewer role, and admin to start and stop containers.`, { status: res.status });
  if (!body) throw new GqlError(`Cubecrusher ${res.ok ? "didn't answer with JSON" : `answered HTTP ${res.status}`} at ${c.url}/graphql. Is that the Unraid web UI's address?`, { status: res.status });
  // GraphQL reports a bad query with errors and no data, on a 200 or a 400
  // depending on the version.
  if (body.errors?.length && !body.data) {
    const msg = body.errors.map((e) => e.message).join('; ');
    const validation = /Cannot query field|Unknown argument|Unknown type|must not have a selection|must have a selection|Syntax Error|GRAPHQL_VALIDATION_FAILED/i.test(msg + JSON.stringify(body.errors.map((e) => e.extensions?.code || '')));
    if (/forbidden|unauthori[sz]ed|permission/i.test(msg)) throw new GqlError(`The API key isn't allowed to do that: ${msg}`, { status: 403 });
    throw new GqlError(validation ? `This Unraid API version doesn't know a field the app asked for: ${msg}` : msg, { validation, status: res.status });
  }
  if (!res.ok && !body.data) throw new GqlError(`Cubecrusher answered HTTP ${res.status} at /graphql. Is ${c.url} the Unraid web UI's address?`, { status: res.status });
  return body.data;
}

// Tries the full query, and when this API version lacks one of its fields,
// the plainer one, so an older Unraid still shows something. The one that
// worked is remembered, so a poll doesn't fail its way down the list each time.
const known = new WeakMap();
async function gqlAny(queries, variables) {
  let last;
  for (let i = known.get(queries) || 0; i < queries.length; i++) {
    try {
      const out = await gql(queries[i], variables);
      known.set(queries, i);
      return out;
    } catch (err) {
      last = err;
      if (!err.validation) throw err;
    }
  }
  throw last;
}

const INFO = `info { os { hostname uptime } cpu { brand cores threads } versions { core { unraid api } } }`;
const SERVER_Q = [
  `query Server { ${INFO.replace('cpu { brand cores threads }', 'cpu { brand cores threads packages { temp } }')} server { lanip }
    metrics { cpu { percentTotal } memory { total used free available } }
    array { state capacity { kilobytes { free used total } } parityCheckStatus { status progress running paused errors speed duration }
      parities { id idx name device size status type temp isSpinning numErrors }
      disks { id idx name device size status type temp fsSize fsFree fsUsed fsType isSpinning numErrors }
      caches { id idx name device size status type temp fsSize fsFree fsUsed fsType isSpinning numErrors } } }`,
  `query Server { ${INFO} server { lanip }
    metrics { cpu { percentTotal } memory { total used free available } }
    array { state capacity { kilobytes { free used total } } parityCheckStatus { status progress running paused errors }
      parities { id name device size status type temp }
      disks { id name device size status type temp fsSize fsFree fsUsed fsType }
      caches { id name device size status type temp fsSize fsFree fsUsed fsType } } }`,
  `query Server { ${INFO} metrics { cpu { percentTotal } memory { total used free available } } array { state capacity { kilobytes { free used total } } } }`,
];

const CONTAINERS_Q = [
  `query Containers { docker { containers { id names image state status autoStart isUpdateAvailable webUiUrl iconUrl created labels ports { ip privatePort publicPort type } hostConfig { networkMode } networkSettings } } }`,
  `query Containers { docker { containers { id names image state status autoStart created labels ports { ip privatePort publicPort type } hostConfig { networkMode } } } }`,
  `query Containers { docker { containers { id names image state status autoStart } } }`,
];

// nvidia-smi over SSH. Without SSH set up, or on a box without an NVIDIA
// card, the GPU readouts just stay off; it's tried again a minute later.
const nvidia = ssh.withBackoff(async () => {
  const out = await ssh.run(sshServer(), ['nvidia-smi', '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit', '--format=csv,noheader,nounits'], { timeout: 8000 });
  return parseNvidiaSmi(out);
});

let lanip = null;
async function server() {
  const [data, gpus] = await Promise.all([gqlAny(SERVER_Q), nvidia().catch(() => [])]);
  lanip = data.server?.lanip || lanip;
  return toHost({ info: data.info, metrics: data.metrics, array: data.array, gpus });
}

// What the containers' web UI links use for [IP] when a container lacks a URL of its own.
const hostIp = () => lanip || sshServer().host;

async function containers() {
  const data = await gqlAny(CONTAINERS_Q);
  return (data.docker?.containers || []).map((c) => toContainer(c, hostIp())).sort((a, b) => a.name.localeCompare(b.name));
}

const ACTIONS = { start: 'start', stop: 'stop', restart: 'restart', pause: 'pause', unpause: 'unpause' };
async function action(id, what) {
  const field = ACTIONS[what];
  if (!field) throw new Error('Unknown action');
  if (field === 'restart') {
    // Older APIs have no restart; stop then start does the same.
    try {
      await gql(`mutation Restart($id: PrefixedID!) { docker { restart(id: $id) { id state } } }`, { id });
      return true;
    } catch (err) {
      if (!err.validation) throw err;
      await gql(`mutation Stop($id: PrefixedID!) { docker { stop(id: $id) { id state } } }`, { id });
    }
    await gql(`mutation Start($id: PrefixedID!) { docker { start(id: $id) { id state } } }`, { id });
    return true;
  }
  await gql(`mutation Act($id: PrefixedID!) { docker { ${field}(id: $id) { id state } } }`, { id });
  return true;
}

// Runs fn with the certificate rule reading these settings instead of the saved ones.
let override = null;
async function withTrust(c, fn) {
  override = c;
  try {
    return await fn();
  } finally {
    override = null;
  }
}

// A quick look: is it there, and what is it?
async function check(c = conf()) {
  const data = await gql(`query Check { ${INFO} server { lanip localurl } }`, {}, c);
  return { hostname: data.info?.os?.hostname || null, unraid: data.info?.versions?.core?.unraid || null, api: data.info?.versions?.core?.api || null, lanip: data.server?.lanip || null, url: c.url };
}

async function save(raw) {
  const next = {
    url: String(raw.url || '').trim().replace(/\/+$/, ''),
    apiKey: raw.apiKey === undefined || raw.apiKey === '' ? settings.get().unraid?.apiKey || '' : String(raw.apiKey).trim(),
    insecure: Boolean(raw.insecure),
    sshUser: String(raw.sshUser || 'root').trim(),
    sshPort: Number(raw.sshPort) || 22,
  };
  if (next.url) {
    let u;
    try {
      u = new URL(next.url);
    } catch {
      throw new Error('The address has to look like http://192.168.1.10 or https://cubecrusher.local');
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('The address has to start with http:// or https://');
    next.url = u.origin;
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(next.sshUser)) throw new Error('The SSH user can only have letters, numbers, dots, dashes and underscores.');
  await settings.update({ unraid: next });
  return settings.forPage().unraid;
}

function register(ipcMain) {
  ipcMain.handle('unraid:check', () => check());
  ipcMain.handle('unraid:test', async (_e, raw) => {
    const current = conf();
    const c = { url: String(raw.url || '').trim().replace(/\/+$/, ''), apiKey: raw.apiKey || current.apiKey, insecure: Boolean(raw.insecure) };
    // The certificate check reads the saved settings, so a test of an unsaved address trusts it for the moment.
    const out = await withTrust(c, () => check(c));
    const gpu = await ssh.run({ ...sshServer({ ...current, url: c.url, sshUser: raw.sshUser || current.sshUser, sshPort: raw.sshPort || current.sshPort }) }, ['nvidia-smi', '-L'], { timeout: 8000 })
      .then((t) => ({ ok: true, text: t.trim().split('\n')[0] }))
      .catch((err) => ({ ok: false, text: err.message }));
    return { ...out, ssh: gpu };
  });
  ipcMain.handle('unraid:save', (_e, raw) => save(raw));
  ipcMain.handle('unraid:server', () => server());
}

module.exports = { register, ready, configured, server, containers, action, sshServer, gql };
