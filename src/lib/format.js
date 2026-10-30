const GB = 1024 ** 3;

export const pct = (part, whole) => (whole ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0);

export function bytes(n, { si = false } = {}) {
  if (n == null) return '—';
  const base = si ? 1000 : 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (Math.abs(n) >= base && i < units.length - 1) {
    n /= base;
    i++;
  }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export const gb = (n) => `${(n / GB).toFixed(1)} GB`;

export function greeting(h) {
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export const clock = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const shortTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
export const hourLabel = (d) => d.toLocaleTimeString([], { hour: 'numeric' }).replace(/\s?([AP])M$/i, '$1');
export const dayLabel = (d) => d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

export function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

// WMO weather codes, as Open-Meteo reports them.
export function weatherLabel(code) {
  if (code === 0) return 'clear';
  if (code === 1) return 'mostly clear';
  if (code === 2) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code === 61 || code === 80) return 'light rain';
  if (code === 63 || code === 81) return 'rain';
  if (code === 65 || code === 82) return 'heavy rain';
  if (code === 66 || code === 67) return 'freezing rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunderstorms';
  return '';
}

export const deg = (v) => (v == null ? '—' : `${Math.round(v)}°`);
