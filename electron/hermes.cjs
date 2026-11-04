const { net, app } = require('electron');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const ssh = require('./ssh.cjs');
const media = require('./hermesMedia.cjs');
const settings = require('./settings.cjs');
const { parseEvents, withImages, cleanImages, toChatEvent, toSession, toSessionDetail, toTranscript, toModelOptions, cleanUrl, modelFrom, isPage, isLoginWall, DASHBOARD_HINT } = require('./hermesShape.cjs');

// Talks to Hermes Agent's API server directly, for each Hermes instance
// Thomas has set up. Hermes's own API sits beside its OpenAI-style /v1.
const root = (url) => url.replace(/\/v1$/, '');
// A named Hermes profile on a shared listener answers under /p/<profile>/.
const PROFILE = /^[A-Za-z0-9_-]{1,40}$/;
const base = (h) => `${root(h.url)}${h.profile ? `/p/${h.profile}` : ''}`;
const headers = (key) => ({ 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) });

function current() {
  const { hermes, hermesCurrent } = settings.get();
  return hermes.find((h) => h.id === hermesCurrent) || hermes[0] || null;
}

async function upstreamError(res, h) {
  const text = await res.text().catch(() => '');
  let message = text.slice(0, 300);
  try {
    const json = JSON.parse(text);
    message = json.error?.message || json.error || json.detail || message;
  } catch {}
  if (res.status === 401 || res.status === 403) message = `${h.name} refused the API key (${res.status}). Check the key under Hermes instances.`;
  return new Error(`${h.name} answered ${res.status}: ${message}`);
}

async function call(h, method, apiPath, body, signal) {
  if (!h) throw new Error('No Hermes instance set up yet. Add one under Hermes instances.');
  let res;
  try {
    res = await net.fetch(`${base(h)}${apiPath}`, {
      method,
      headers: headers(h.key),
      body: body ? JSON.stringify(body) : undefined,
      signal: signal || AbortSignal.timeout(15_000),
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error(`Can't reach ${h.name} at ${h.url} (${err.cause?.code || err.message}).`);
  }
  if (res.status === 404 && apiPath.split('?')[0] === '/api/sessions') throw new Error(`${h.name} doesn't have the sessions API. Update that Hermes Agent container.`);
  if (res.status === 404) throw new Error('That chat no longer exists in Hermes.');
  if (!res.ok) throw await upstreamError(res, h);
  return res;
}

const PAGE = 100;

// Is each instance reachable, and what is it running? Checked side by side.
async function statusAll() {
  const { hermes } = settings.get();
  return Promise.all(
    hermes.map(async (h) => {
      const out = { id: h.id, online: false, model: null, error: null };
      try {
        const res = await net.fetch(`${base(h)}/v1/models`, { headers: headers(h.key), signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw await upstreamError(res, h);
        const json = await res.json().catch(() => ({}));
        out.online = true;
        out.model = json.data?.[0]?.id || null;
      } catch (err) {
        out.error = err.message;
      }
      return out;
    }),
  );
}

// The list as the page sees it, and the save that keeps keys that weren't retyped.
function list() {
  const s = settings.forPage();
  return { instances: s.hermes, current: current()?.id ?? null };
}

async function save(instances, currentId) {
  const old = settings.get().hermes;
  const next = [];
  for (const raw of instances || []) {
    const url = cleanUrl(raw.url);
    if (!url) throw new Error(`"${raw.name || raw.url}" doesn't look like a Hermes address.`);
    if (raw.profile && !PROFILE.test(String(raw.profile).trim())) throw new Error(`"${raw.profile}" isn't a profile name (letters, numbers, - and _).`);
    const was = old.find((h) => h.id === raw.id);
    next.push({
      id: was?.id || settings.newId(),
      name: String(raw.name || '').trim().slice(0, 60) || url.replace(/^https?:\/\//, ''),
      url,
      profile: PROFILE.test(String(raw.profile || '').trim()) ? String(raw.profile).trim() : '',
      key: typeof raw.key === 'string' ? raw.key.trim().slice(0, 500) : was?.key || '',
    });
  }
  const hermesCurrent = next.some((h) => h.id === currentId) ? currentId : (next[0]?.id ?? null);
  await settings.update({ hermes: next, hermesCurrent });
  return list();
}

async function setCurrent(id) {
  if (!settings.get().hermes.some((h) => h.id === id)) throw new Error('No such Hermes instance.');
  await settings.update({ hermesCurrent: id });
  return list();
}

// Chat turns in progress, by run id, so the page can stop one or answer an approval.
const runs = new Map();

// Runs one turn: events go to the window as they arrive, and the promise
// settles when Hermes is done.
async function chat(win, h, id, body, runId) {
  const control = new AbortController();
  runs.set(runId, control);
  const send = (event) => !win.isDestroyed() && win.webContents.send('hermes:event', { runId, ...event });
  try {
    const res = await call(h, 'POST', `/api/sessions/${encodeURIComponent(id)}/chat/stream`, body, control.signal);
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const { events, rest } = parseEvents(buffer);
      buffer = rest;
      for (const e of events) {
        const out = toChatEvent(e);
        if (out) send(out);
      }
    }
    send({ done: true });
  } catch (err) {
    send(control.signal.aborted ? { done: true, stopped: true } : { error: err.message, done: true });
  } finally {
    runs.delete(runId);
  }
}

// Tries an address and key as typed, before they're saved, and says what
// came back.
async function test({ url: rawUrl, key, id, profile }) {
  const cleaned = cleanUrl(rawUrl);
  const url = cleaned && PROFILE.test(String(profile || '').trim()) ? `${root(cleaned)}/p/${String(profile).trim()}/v1` : cleaned;
  if (!cleaned) throw new Error("That doesn't look like a Hermes address.");
  const saved = settings.get().hermes.find((h) => h.id === id);
  const useKey = typeof key === 'string' && key.trim() ? key.trim() : saved?.key || '';
  let res;
  try {
    res = await net.fetch(`${url}/models`, { headers: headers(useKey), signal: AbortSignal.timeout(6000) });
  } catch (err) {
    throw new Error(`Can't reach ${url} (${err.cause?.code || err.message}).`);
  }
  const text = (await res.text().catch(() => '')).slice(0, 2000);
  // A named profile only takes its own key: the default profile's key is
  // refused under /p/<profile>/.
  const named = PROFILE.test(String(profile || '').trim());
  if ((res.status === 401 || res.status === 403) && named)
    throw new Error(`The "${String(profile).trim()}" profile refused this key (${res.status}). A named profile needs its own API_SERVER_KEY, set in that profile's .env (inside the container: \$HERMES_HOME/profiles/${String(profile).trim()}/.env), then restart Hermes. The default profile's key doesn't work for it.`);
  if (res.status === 401 || res.status === 403) throw new Error(`Hermes refused the key (${res.status})${useKey ? '' : ', and no key was sent'}. It answered: ${text.slice(0, 200) || '(nothing)'}`);
  if (res.status === 404 && named) throw new Error(`No "${String(profile).trim()}" profile answers at ${url}. Check the name, and that Hermes has gateway.multiplex_profiles turned on.`);
  if (!res.ok) throw new Error(`Hermes answered ${res.status}: ${text.slice(0, 200) || '(nothing)'}`);
  // The web dashboard answers any path with its page, which isn't an answer.
  if (isPage(text)) throw new Error(DASHBOARD_HINT);
  const model = modelFrom(text);
  // /v1/models may answer without checking the key; the sessions API, which
  // the chat uses, does check it.
  let sessions;
  try {
    sessions = await net.fetch(`${root(url)}/api/sessions?limit=1&offset=0`, { headers: headers(useKey), signal: AbortSignal.timeout(6000) });
  } catch (err) {
    throw new Error(`Models answered, but the sessions API didn't (${err.cause?.code || err.message}).`);
  }
  if (sessions.status === 401 || sessions.status === 403) {
    const said = (await sessions.text().catch(() => '')).slice(0, 200);
    if (isLoginWall(said)) throw new Error(DASHBOARD_HINT);
    throw new Error(`Models answered, but the sessions API refused the key (${sessions.status})${useKey ? '' : ' and no key was sent'}. It said: ${said || '(nothing)'}. The key has to be this container's API_SERVER_KEY.`);
  }
  if (sessions.status === 404) throw new Error("Models answered, but this Hermes has no sessions API. Update the Hermes Agent container.");
  if (!sessions.ok) throw new Error(`Models answered, but the sessions API said ${sessions.status}.`);
  const count = (await sessions.json().catch(() => ({}))).data?.length ?? 0;
  return { ok: true, model, sentKey: Boolean(useKey), sessions: count };
}

// A list from /v1/skills or /v1/toolsets, whatever shape it comes in, as
// { name, description } rows.
function toNamed(json) {
  const list = Array.isArray(json) ? json : json?.data || json?.skills || json?.toolsets || [];
  return (Array.isArray(list) ? list : [])
    .map((x) => (typeof x === 'string' ? { name: x, description: '' } : { name: String(x?.name || x?.id || ''), description: String(x?.description || '').slice(0, 300), tools: Array.isArray(x?.tools) ? x.tools.length : null }))
    .filter((x) => x.name);
}

// The instance a call is for: the one the page names, else the default.
function pick(iid) {
  const { hermes } = settings.get();
  return (iid && hermes.find((h) => h.id === iid)) || current();
}

// Files Hermes names in its replies live inside its container. They come
// over SSH (docker exec … cat) from the server that runs it, and are kept in
// this app's cache so a chat opened again doesn't fetch them twice.
const containers = new Map();
function serverFor(h) {
  let host = '';
  try {
    host = new URL(h.url).hostname;
  } catch {}
  const unraid = require('./unraid.cjs');
  const list = [...(unraid.configured() ? [unraid.sshServer()] : []), ...settings.get().servers];
  const s = list.find((x) => x.host === host) || (unraid.configured() ? unraid.sshServer() : null);
  if (!s?.host) throw new Error("To fetch Hermes's files the app needs SSH to the server Hermes runs on. Set up Cubecrusher (with SSH) in Settings.");
  return s;
}
async function containerOf(h, server) {
  if (containers.has(h.id)) return containers.get(h.id);
  let port = null;
  try {
    port = Number(new URL(h.url).port) || null;
  } catch {}
  const out = await ssh.run(server, ['docker', 'ps', '--format', `'{{.Names}}|{{.Ports}}'`], { timeout: 15_000 });
  const name = media.containerFor(out, port);
  if (!name) throw new Error(`Couldn't tell which container on ${server.name} is ${h.name} (looked for port ${port}).`);
  containers.set(h.id, name);
  return name;
}
const cacheDir = () => path.join(app.getPath('userData'), 'hermes-media');
const cacheName = (h, p) => `${crypto.createHash('sha1').update(`${h.id}\n${p}`).digest('hex').slice(0, 24)}.${p.split('.').pop().toLowerCase()}`;

async function fetchFile(h, rawPath) {
  const p = media.safeMediaPath(rawPath);
  if (!p) throw new Error("That isn't a media file the app can fetch.");
  const name = cacheName(h, p);
  const file = path.join(cacheDir(), name);
  const out = { url: `cubemedia://file/${name}`, kind: media.kindOf(p), name: p.split('/').pop(), path: p };
  try {
    const st = await fsp.stat(file);
    if (st.size > 0) return { ...out, size: st.size };
  } catch {}
  const server = serverFor(h);
  const container = await containerOf(h, server);
  let bytes;
  try {
    bytes = await ssh.runBinary(server, media.readCommand(container, p));
  } catch (err) {
    containers.delete(h.id);
    throw new Error(/No such file|can't open/i.test(err.message) ? `${h.name} no longer has ${p}.` : err.message);
  }
  if (!bytes.length) throw new Error(`${p} is empty.`);
  await fsp.mkdir(cacheDir(), { recursive: true });
  await fsp.writeFile(file, bytes);
  return { ...out, size: bytes.length };
}

// A file from this computer into Hermes's uploads folder, so Hermes (and
// ComfyUI through it) can work on it. Returns the path inside the container.
async function uploadFile(h, { name, bytes }) {
  const data = Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []));
  if (!data.length) throw new Error('That file is empty.');
  if (data.length > 300 * 1024 * 1024) throw new Error('Files over 300 MB are too big to send.');
  const server = serverFor(h);
  const container = await containerOf(h, server);
  const where = (await ssh.runBinary(server, media.writeCommand(container, media.safeUploadName(name)), { input: data, timeout: 300_000 })).toString().trim();
  if (!where.startsWith('/')) throw new Error(`${h.name} didn't say where the file went.`);
  return { path: where, filename: where.split('/').pop(), kind: media.kindOf(where) || 'file' };
}

// Serves cached files to the page as cubemedia://file/<name>.
function serveMedia(protocol) {
  const { pathToFileURL } = require('node:url');
  protocol.handle('cubemedia', (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, ''));
    if (!/^[a-f0-9]{24}\.[a-z0-9]{2,5}$/.test(name)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(cacheDir(), name)).toString(), { headers: req.headers });
  });
}

function register(ipcMain, getWindow) {
  ipcMain.handle('hermes:list', () => list());
  ipcMain.handle('hermes:test', (_e, raw) => test(raw || {}));
  ipcMain.handle('hermes:save', (_e, { instances, current: cur }) => save(instances, cur));
  ipcMain.handle('hermes:setCurrent', (_e, id) => setCurrent(id));
  ipcMain.handle('hermes:status', () => statusAll());
  ipcMain.handle('hermes:sessions', async (_e, { iid, offset = 0 } = {}) => {
    const json = await (await call(pick(iid), 'GET', `/api/sessions?limit=${PAGE}&offset=${Number(offset) || 0}`)).json();
    const sessions = (json.data || []).map(toSession);
    return { sessions, more: sessions.length >= PAGE };
  });
  ipcMain.handle('hermes:session', async (_e, { iid, id }) => toSessionDetail((await (await call(pick(iid), 'GET', `/api/sessions/${encodeURIComponent(id)}`)).json()).session || {}));
  ipcMain.handle('hermes:messages', async (_e, { iid, id }) => toTranscript((await (await call(pick(iid), 'GET', `/api/sessions/${encodeURIComponent(id)}/messages`)).json()).data));
  ipcMain.handle('hermes:createSession', async (_e, { iid, title } = {}) => {
    const body = typeof title === 'string' && title.trim() ? { title: title.trim().slice(0, 200) } : {};
    return toSession((await (await call(pick(iid), 'POST', '/api/sessions', body)).json()).session || {});
  });
  ipcMain.handle('hermes:deleteSession', async (_e, { iid, id }) => {
    await call(pick(iid), 'DELETE', `/api/sessions/${encodeURIComponent(id)}`);
  });
  ipcMain.handle('hermes:models', async (_e, { iid } = {}) => toModelOptions(await (await call(pick(iid), 'GET', '/api/model/options?include_unconfigured=false', null, AbortSignal.timeout(30_000))).json()));
  // A turn, optionally on another model (Hermes takes model and provider per
  // request) and with pictures, sent as image parts beside the text.
  ipcMain.handle('hermes:chat', (_e, { iid, id, message, model, provider, images }) => {
    const pics = cleanImages(images);
    if (typeof message !== 'string' || (!message.trim() && !pics.length)) throw new Error('Type a message first.');
    if (message.length > 200_000) throw new Error('That message is too long.');
    const body = { message: withImages(message, pics) };
    if (typeof model === 'string' && model.trim()) body.model = model.trim().slice(0, 200);
    if (typeof provider === 'string' && provider.trim()) body.provider = provider.trim().slice(0, 100);
    const runId = settings.newId();
    chat(getWindow(), pick(iid), id, body, runId);
    return runId;
  });
  ipcMain.handle('hermes:rename', async (_e, { iid, id, title }) => {
    const t = typeof title === 'string' ? title.trim().slice(0, 200) : '';
    if (!t) throw new Error('Give the chat a name.');
    return toSession((await (await call(pick(iid), 'PATCH', `/api/sessions/${encodeURIComponent(id)}`, { title: t })).json()).session || { id, title: t });
  });
  // What Hermes can do: its skills and toolsets, read only.
  ipcMain.handle('hermes:skills', async (_e, { iid } = {}) => {
    const get = async (p) => {
      try {
        return await (await call(pick(iid), 'GET', p)).json();
      } catch (err) {
        return { error: err.message };
      }
    };
    const [skills, toolsets] = await Promise.all([get('/v1/skills'), get('/v1/toolsets')]);
    return { skills: toNamed(skills), toolsets: toNamed(toolsets), error: skills.error && toolsets.error ? skills.error : null };
  });
  ipcMain.handle('hermes:file', (_e, { iid, path: p }) => fetchFile(pick(iid), p));
  ipcMain.handle('hermes:saveFile', async (_e, { iid, path: p }) => {
    const { dialog } = require('electron');
    const f = await fetchFile(pick(iid), p);
    const choice = await dialog.showSaveDialog(getWindow(), { defaultPath: media.safeUploadName(f.name) });
    if (choice.canceled || !choice.filePath) return { saved: false };
    await fsp.copyFile(path.join(cacheDir(), f.url.split('/').pop()), choice.filePath);
    return { saved: true, path: choice.filePath };
  });
  ipcMain.handle('hermes:upload', (_e, { iid, name, bytes }) => uploadFile(pick(iid), { name, bytes }));
  ipcMain.handle('hermes:stop', (_e, runId) => {
    runs.get(runId)?.abort();
    return runs.has(runId);
  });
  ipcMain.handle('hermes:approve', async (_e, { iid, runId, requestId, generation, choice }) => {
    if (!['once', 'session', 'always', 'deny'].includes(choice)) throw new Error('Pick Allow or Deny.');
    const body = { choice, ...(requestId != null ? { request_id: String(requestId).slice(0, 200) } : {}), ...(Number.isInteger(generation) ? { execution_generation: generation } : {}) };
    // An approval goes to the instance whose turn asked for it.
    await call(pick(iid), 'POST', `/v1/runs/${encodeURIComponent(runId)}/approval`, body);
    return { choice };
  });
}

module.exports = { register, current, serveMedia };
