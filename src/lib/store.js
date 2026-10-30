// Small settings kept on this computer only (agent autonomy until the server
// side exists). Storage can be missing or blocked, so every call is guarded.
export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(`cubecrusher:${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(`cubecrusher:${key}`, JSON.stringify(value));
  } catch {
    // Not saved; the setting still applies until the app closes.
  }
}
