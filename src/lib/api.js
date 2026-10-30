import { useCallback, useEffect, useRef, useState } from 'react';

// Inside Electron the preload script gives us a bridge and the main process
// talks to the server. In a plain browser (npm run dev:web) Vite proxies /api.
const bridge = typeof window !== 'undefined' ? window.cubecrusher : undefined;
export const inElectron = Boolean(bridge);

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

// Where the app stands with the server:
//   demo    no server set up, or it can't be reached: sample data
//   signin  the server answered and wants a username and password
//   live    signed in, real data
export async function checkConnection() {
  const { serverUrl } = await getSettings();
  if (!serverUrl) return { state: 'demo', reason: 'none', serverUrl };
  try {
    const s = await api('/api/session');
    if (s.user) return { state: 'live', user: s.user, serverUrl };
    return { state: 'signin', setup: s.setup, serverUrl };
  } catch (err) {
    return { state: 'demo', reason: 'offline', error: err.message, serverUrl };
  }
}

// Polls a GET endpoint while `enabled`; reload() asks again straight away.
// Keeps the last good answer if a later poll fails, so a blip doesn't blank
// the page.
export function usePoll(path, { enabled = true, every = 0 } = {}) {
  const [state, setState] = useState({ data: null, error: null });
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (!enabled || !path) {
      setState({ data: null, error: null });
      return undefined;
    }
    let timer;
    const run = async () => {
      try {
        const data = await api(path);
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
  }, [path, enabled, every, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
