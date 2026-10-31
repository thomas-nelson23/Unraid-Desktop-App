const { net } = require('electron');
const settings = require('./settings.cjs');
const { parseEvents, toChatEvent, toSession, toSessionDetail, toTranscript, toModelOptions, cleanUrl } = require('./hermesShape.cjs');

// Talks to Hermes Agent's API server directly, for each Hermes instance
// Thomas has set up. Hermes's own API sits beside its OpenAI-style /v1.
const root = (url) => url.replace(/\/v1$/, '');
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
    res = await net.fetch(`${root(h.url)}${apiPath}`, {
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
        const res = await net.fetch(`${h.url}/models`, { headers: headers(h.key), signal: AbortSignal.timeout(4000) });
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
    const was = old.find((h) => h.id === raw.id);
    next.push({
      id: was?.id || settings.newId(),
      name: String(raw.name || '').trim().slice(0, 60) || url.replace(/^https?:\/\//, ''),
      url,
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
async function chat(win, h, id, message, runId) {
  const control = new AbortController();
  runs.set(runId, control);
  const send = (event) => !win.isDestroyed() && win.webContents.send('hermes:event', { runId, ...event });
  try {
    const res = await call(h, 'POST', `/api/sessions/${encodeURIComponent(id)}/chat/stream`, { message }, control.signal);
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
async function test({ url: rawUrl, key, id }) {
  const url = cleanUrl(rawUrl);
  if (!url) throw new Error("That doesn't look like a Hermes address.");
  const saved = settings.get().hermes.find((h) => h.id === id);
  const useKey = typeof key === 'string' && key.trim() ? key.trim() : saved?.key || '';
  let res;
  try {
    res = await net.fetch(`${url}/models`, { headers: headers(useKey), signal: AbortSignal.timeout(6000) });
  } catch (err) {
    throw new Error(`Can't reach ${url} (${err.cause?.code || err.message}).`);
  }
  const text = (await res.text().catch(() => '')).slice(0, 200);
  if (res.status === 401 || res.status === 403) throw new Error(`Hermes refused the key (${res.status})${useKey ? '' : ', and no key was sent'}. It answered: ${text || '(nothing)'}`);
  if (!res.ok) throw new Error(`Hermes answered ${res.status}: ${text || '(nothing)'}`);
  let model = null;
  try {
    model = JSON.parse(text).data?.[0]?.id || null;
  } catch {}
  return { ok: true, model, sentKey: Boolean(useKey) };
}

function register(ipcMain, getWindow) {
  ipcMain.handle('hermes:list', () => list());
  ipcMain.handle('hermes:test', (_e, raw) => test(raw || {}));
  ipcMain.handle('hermes:save', (_e, { instances, current: cur }) => save(instances, cur));
  ipcMain.handle('hermes:setCurrent', (_e, id) => setCurrent(id));
  ipcMain.handle('hermes:status', () => statusAll());
  ipcMain.handle('hermes:sessions', async (_e, { offset = 0 } = {}) => {
    const json = await (await call(current(), 'GET', `/api/sessions?limit=${PAGE}&offset=${offset}`)).json();
    const sessions = (json.data || []).map(toSession);
    return { sessions, more: sessions.length >= PAGE };
  });
  ipcMain.handle('hermes:session', async (_e, id) => toSessionDetail((await (await call(current(), 'GET', `/api/sessions/${encodeURIComponent(id)}`)).json()).session || {}));
  ipcMain.handle('hermes:messages', async (_e, id) => toTranscript((await (await call(current(), 'GET', `/api/sessions/${encodeURIComponent(id)}/messages`)).json()).data));
  ipcMain.handle('hermes:createSession', async (_e, { title } = {}) => {
    const body = typeof title === 'string' && title.trim() ? { title: title.trim().slice(0, 200) } : {};
    return toSession((await (await call(current(), 'POST', '/api/sessions', body)).json()).session || {});
  });
  ipcMain.handle('hermes:deleteSession', async (_e, id) => {
    await call(current(), 'DELETE', `/api/sessions/${encodeURIComponent(id)}`);
  });
  ipcMain.handle('hermes:models', async () => toModelOptions(await (await call(current(), 'GET', '/api/model/options?include_unconfigured=false', null, AbortSignal.timeout(30_000))).json()));
  ipcMain.handle('hermes:chat', (_e, { id, message }) => {
    if (typeof message !== 'string' || !message.trim()) throw new Error('Type a message first.');
    const runId = settings.newId();
    chat(getWindow(), current(), id, message, runId);
    return runId;
  });
  ipcMain.handle('hermes:stop', (_e, runId) => {
    runs.get(runId)?.abort();
    return runs.has(runId);
  });
  ipcMain.handle('hermes:approve', async (_e, { runId, requestId, generation, choice }) => {
    if (!['once', 'session', 'always', 'deny'].includes(choice)) throw new Error('Pick Allow or Deny.');
    const body = { choice, ...(requestId != null ? { request_id: String(requestId).slice(0, 200) } : {}), ...(Number.isInteger(generation) ? { execution_generation: generation } : {}) };
    await call(current(), 'POST', `/v1/runs/${encodeURIComponent(runId)}/approval`, body);
    return { choice };
  });
}

module.exports = { register, current };
