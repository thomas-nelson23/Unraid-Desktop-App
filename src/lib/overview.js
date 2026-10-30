// The Overview page's readings, turned into words: a verdict per part of the
// machine, the summary line above them, suggestions for the disks, the
// "Last 24 hours" lanes and the array's growth forecast.
//
// tone: calm (cyan), busy (magenta, working as planned), watch (brass), bad (red)
import { bytes, gb, pct } from './format.js';

export const TONE = { calm: 'var(--cyan)', busy: 'var(--mag)', watch: 'var(--brass)', bad: 'var(--red)' };
const RANK = { bad: 0, watch: 1, busy: 2, calm: 3 };
const tb = (n) => bytes(n, { si: true });

function computeVerdict(host) {
  const cpu = Math.round(host.cpu ?? 0);
  const temp = host.cpuTemp != null ? `, ${Math.round(host.cpuTemp)} °C` : '';
  const why = `${cpu}% CPU${temp}.`;
  if (cpu >= 90) return { tone: 'bad', state: 'Maxed out', detail: `the CPU is at ${cpu}%`, why };
  if (cpu >= 70) return { tone: 'watch', state: 'Working hard', detail: `the CPU is at ${cpu}%`, why };
  return { tone: 'calm', state: cpu >= 30 ? 'Steady' : 'Calm', why };
}

function memoryVerdict({ used, total }) {
  const p = Math.round(pct(used, total));
  const why = `${gb(used)} of ${gb(total)}.`;
  if (p >= 90) return { tone: 'bad', state: 'Nearly full', detail: `memory is ${p}% used`, why };
  if (p >= 75) return { tone: 'watch', state: 'Getting full', detail: `memory is ${p}% used`, why };
  return { tone: 'calm', state: 'Comfortable', why };
}

function gpuVerdict(g) {
  const util = Math.round(g.util ?? 0);
  const parts = [`${util}% use`];
  if (g.temp != null) parts.push(`${Math.round(g.temp)} °C`);
  if (g.memTotal) parts.push(`${gb(g.memUsed)} of ${gb(g.memTotal)} VRAM`);
  const why = `${parts.join(', ')}.`;
  if (g.temp != null && g.temp >= 80) return { tone: 'watch', state: 'Running hot', detail: `${g.name} is at ${Math.round(g.temp)} °C`, why };
  if (util >= 50) return { tone: 'busy', state: 'Busy', why };
  return { tone: 'calm', state: util >= 10 ? 'Light load' : 'Idle', why };
}

function storageVerdict(disks) {
  const full = disks.map((d) => ({ ...d, p: Math.round(pct(d.used, d.total)) })).sort((a, b) => b.p - a.p);
  const worst = full[0];
  const why = full.length > 3 ? `Fullest: ${worst.label} at ${worst.p}%.` : full.map((d) => `${d.label} ${d.p}%`).join(' · ') + '.';
  // One full data disk is something to watch, not an alarm: Unraid writes to
  // the others. A full pool or a full array is.
  if (worst.p >= 90 && worst.role !== 'data') return { tone: 'bad', state: 'Nearly full', detail: `${worst.label} is ${worst.p}% full`, why };
  const watching = full.filter((d) => d.p >= (d.role === 'data' ? 90 : 80));
  if (watching.length) {
    const n = watching.length;
    return { tone: 'watch', state: n === 1 ? '1 thing to watch' : `${n} things to watch`, detail: `${worst.label} is ${worst.p}% full`, why };
  }
  return { tone: 'calm', state: 'Plenty of room', why };
}

// One verdict per part of the machine the server reports on.
export function verdicts(host) {
  if (!host) return [];
  const out = [{ id: 'compute', name: 'Compute', ...computeVerdict(host) }];
  if (host.memory?.total) out.push({ id: 'memory', name: 'Memory', ...memoryVerdict(host.memory) });
  (host.gpus ?? []).forEach((g, i, all) => out.push({ id: `gpu:${g.id ?? i}`, name: all.length > 1 ? `GPU ${i + 1}` : 'GPU', ...gpuVerdict(g) }));
  if (host.disks?.length) out.push({ id: 'storage', name: 'Storage', ...storageVerdict(host.disks) });
  return out;
}

// The line above the verdicts: how the server is, then what to watch.
export function summary(list) {
  if (!list.length) return { head: 'not reporting yet', rest: '' };
  const worry = list.filter((v) => v.tone === 'bad' || v.tone === 'watch').sort((a, b) => RANK[a.tone] - RANK[b.tone]);
  const busy = list.some((v) => v.tone === 'busy');
  let head;
  if (list.some((v) => v.tone === 'bad')) head = 'under strain';
  else if (worry.length) head = busy ? 'healthy and busy' : 'healthy';
  else head = busy ? 'healthy and busy' : 'healthy and quiet';
  if (!worry.length) return { head, rest: 'Nothing needs watching right now.' };
  const items = worry.map((v) => v.detail);
  const said = items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  return { head, rest: `${worry.length === 1 ? 'One thing to watch' : 'To watch'}: ${said}.` };
}

// Suggested Hermes questions: one per worry, then everyday ones.
export function askChips(list) {
  const fromWorries = list.filter((v) => v.tone === 'bad' || v.tone === 'watch').map((v) => `Why ${v.detail.replace(/^(.*?) is /, 'is $1 ')}?`);
  return [...fromWorries, "What's using the most RAM?", 'What ran overnight?'].slice(0, 3);
}

// Disks, most in need of attention first: fullest, then hottest.
export function byAttention(disks) {
  return [...disks].sort((a, b) => pct(b.used, b.total) - pct(a.used, a.total) || (b.temp ?? 0) - (a.temp ?? 0));
}

// What to do about the disks, from fill alone (age and SMART come with
// per-disk data).
export function diskSuggestions(disks) {
  return byAttention(disks)
    .filter((d) => d.role !== 'parity' && pct(d.used, d.total) >= 85)
    .map((d) => {
      const p = Math.round(pct(d.used, d.total));
      return {
        id: `full:${d.label}`,
        tone: p >= 90 ? 'bad' : 'watch',
        title: `Free up space on ${d.label}`,
        body: `It's ${p}% full, ${tb(d.total - d.used)} left.`,
        ask: `What's taking up space on ${d.label}?`,
      };
    });
}

// Linear growth over the readings, and when that line reaches `total`.
// series: [{ at: ms, used: bytes }], oldest first.
export function forecast(series, total) {
  if (!series || series.length < 2) return null;
  const n = series.length;
  const mx = series.reduce((s, p) => s + p.at, 0) / n;
  const my = series.reduce((s, p) => s + p.used, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of series) {
    num += (p.at - mx) * (p.used - my);
    den += (p.at - mx) ** 2;
  }
  if (!den) return null;
  const perMs = num / den;
  const MONTH = 30.44 * 86400e3;
  const last = series[n - 1];
  const fullAt = perMs > 0 ? last.at + (total - last.used) / perMs : null;
  return { perMonth: perMs * MONTH, fullAt };
}

// Readings bucketed into `cells` equal slices of [from, to]; each cell is the
// slice's average as 0–1, or null when nothing was read in it.
export function lane(samples, key, { from, to, cells = 48 }) {
  const sums = new Array(cells).fill(0);
  const counts = new Array(cells).fill(0);
  const span = to - from;
  if (span <= 0) return sums.map(() => null);
  for (const s of samples) {
    if (s[key] == null || s.at < from || s.at > to) continue;
    const i = Math.min(cells - 1, Math.floor(((s.at - from) / span) * cells));
    sums[i] += s[key];
    counts[i]++;
  }
  return sums.map((sum, i) => (counts[i] ? Math.max(0, Math.min(1, sum / counts[i] / 100)) : null));
}
