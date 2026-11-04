import { useCallback, useEffect, useRef, useState } from 'react';

// Inside Electron the preload script gives us a bridge and the main process
// talks to the server. In a plain browser (npm run dev:web) Vite proxies /api.
const bridge = typeof window !== 'undefined' ? window.cubecrusher : undefined;
export const inElectron = Boolean(bridge);

// The desktop-only parts: Hermes instances, Docker servers and updates. In a
// plain browser they are null and the pages say so.
export const desktop = bridge ? { hermes: bridge.hermes, comfy: bridge.comfy, docker: bridge.docker, updates: bridge.updates, unraid: bridge.unraid, weather: bridge.weather, platform: bridge.platform } : null;
export const openExternal = (url) => (bridge ? bridge.openExternal(url) : window.open(url, '_blank', 'noopener'));

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// raw: the answer isn't JSON (a chat reply streams back as server-sent events)
// and only needs to finish.
export async function api(path, { method = 'GET', body, raw = false } = {}) {
  if (bridge) {
    const res = await bridge.request(method, path, body);
    if (res.error === 'not-configured') throw new ApiError('No server set up yet', 0);
    if (res.status === 0) throw new ApiError(res.error || "Couldn't reach the server", 0);
    if (res.status >= 400) throw new ApiError(res.data?.error || `HTTP ${res.status}`, res.status);
    return res.data;
  }
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
    });
  } catch (err) {
    throw new ApiError(err.message, 0);
  }
  const text = await res.text();
  if (raw && res.ok) return text;
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // The dev proxy answers with HTML when no server is running behind it.
    throw new ApiError("Couldn't reach the server", 0);
  }
  if (!res.ok) throw new ApiError(data?.error || `HTTP ${res.status}`, res.status);
  return data;
}

export const getSettings = () => (bridge ? bridge.getSettings() : Promise.resolve({ serverUrl: location.origin }));
export const setSettings = (next) => (bridge ? bridge.setSettings(next) : Promise.resolve(next));

// Where the app stands with the optional dashboard server on Cubecrusher:
//   none     not set up
//   offline  set up but not answering
//   signin   answered and wants a username and password
//   live     signed in, real data
async function checkDashboard(serverUrl) {
  if (!serverUrl) return { state: 'none', serverUrl };
  try {
    const s = await api('/api/session');
    if (s.user) return { state: 'live', user: s.user, serverUrl };
    return { state: 'signin', setup: s.setup, serverUrl };
  } catch (err) {
    return { state: 'offline', error: err.message, serverUrl };
  }
}

// And with Cubecrusher itself, through Unraid's API:
//   none     no address or key yet
//   offline  not answering, or the key was refused (error says which)
//   live     answering
async function checkUnraid(settings) {
  if (!desktop || !settings.unraid?.url || !settings.unraid?.hasKey) return { state: 'none', url: settings.unraid?.url || '' };
  try {
    const info = await desktop.unraid.check();
    return { state: 'live', ...info };
  } catch (err) {
    return { state: 'offline', error: err.message, url: settings.unraid.url };
  }
}

// Both together. `state` sums it up for the top bar and the pages that only
// care whether there's real data: live when either answers, signin when the
// dashboard wants a password and Unraid isn't set up, demo otherwise with
// `reason` none or offline. The dashboard's user and address stay at the top
// level, where the pages that need them look.
export async function checkConnection() {
  const settings = await getSettings();
  const [dashboard, server] = await Promise.all([checkDashboard(settings.serverUrl), checkUnraid(settings)]);
  let state = 'demo';
  let reason;
  if (server.state === 'live' || dashboard.state === 'live') state = 'live';
  else if (dashboard.state === 'signin') state = 'signin';
  else reason = server.state === 'offline' || dashboard.state === 'offline' ? 'offline' : 'none';
  return { state, reason, user: dashboard.user, serverUrl: dashboard.serverUrl, error: server.error || dashboard.error, dashboard, server, hasPlace: Boolean(settings.weather) };
}

// Polls any async function while `enabled`; reload() asks again straight
// away. Keeps the last good answer if a later poll fails, so a blip doesn't
// blank the page. `key` names what's polled, so a new function each render
// doesn't start it over.
export function usePollFn(fn, { key = '', enabled = true, every = 0 } = {}) {
  const [state, setState] = useState({ data: null, error: null });
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    alive.current = true;
    if (!enabled || !latest.current) {
      setState({ data: null, error: null });
      return undefined;
    }
    let timer;
    const run = async () => {
      try {
        const data = await latest.current();
        if (alive.current) setState({ data, error: null });
      } catch (err) {
        if (alive.current) setState((s) => ({ data: s.data, error: err }));
      }
      if (alive.current && every) timer = setTimeout(run, every);
    };
    run();
    return () => {
      alive.current = false;
      clearTimeout(timer);
    };
  }, [key, enabled, every, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

// Polls a GET endpoint of the dashboard while `enabled`.
export function usePoll(path, { enabled = true, every = 0 } = {}) {
  return usePollFn(path ? () => api(path) : null, { key: path, enabled: enabled && Boolean(path), every });
}
// While a remote screen has the keyboard, the app's own shortcuts (reload,
// close, quit) go to the remote computer instead.
export const captureKeys = (on) => bridge?.captureKeys?.(Boolean(on));
