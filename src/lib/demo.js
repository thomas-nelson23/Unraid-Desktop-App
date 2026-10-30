// Sample data shown until the app is connected to Cubecrusher, matching the
// approved mockups. Everything here is labelled "Sample" on screen.
const GB = 1024 ** 3;
const TB = 1e12;
const H = 3600e3;

export function demoServer() {
  return {
    host: {
      cpu: 18,
      memory: { total: 64 * GB, used: 41.6 * GB },
      disks: [
        { label: 'Array', total: 50 * TB, used: 38.2 * TB },
        { label: 'Cache', total: 2 * TB, used: 1.22 * TB },
      ],
      gpus: [{ id: 'nvidia0', name: 'RTX 4090', util: 71, memUsed: 12.8 * GB, memTotal: 16 * GB, temp: 64 }],
    },
  };
}

export const demoContainerCount = 24;

export const demoNeeds = [
  {
    id: 'radarr',
    tone: 'red',
    title: "Radarr couldn't import 6 movies",
    body: 'The cache hit 97% at 01:40. The mover freed 412 GB at 03:00, so a retry should work.',
    from: 'Radarr · 13 h ago',
    ask: 'Why did Radarr fail?',
    actions: [{ label: 'Retry imports', primary: true }, { label: 'Logs' }],
  },
  {
    id: 'parity',
    tone: 'brass',
    title: 'Parity check tonight at 2:00 AM',
    body: 'ComfyUI has 2 batch jobs queued that would still be running. Pause the queue at midnight?',
    from: 'Schedule · in 11 h',
    ask: "Move ComfyUI's jobs before parity",
    actions: [{ label: 'Pause at midnight' }, { label: 'Ignore', quiet: true }],
  },
  {
    id: 'updates',
    tone: 'cyan',
    title: '2 container updates',
    body: 'Plex 1.41.2 and Sonarr 4.0.10. Neither has breaking changes in its release notes.',
    from: 'Docker · today',
    ask: 'What changed in the Plex update?',
    actions: [{ label: 'Update both' }, { label: 'Later', quiet: true }],
  },
  {
    id: 'comfy',
    tone: 'mag',
    title: 'ComfyUI finished "neon skyline" · 3 images',
    from: 'ComfyUI · 25 min ago',
    thumbs: true,
    ask: 'Make 3 more like "neon skyline"',
    actions: [{ label: 'Open gallery' }, { label: 'Dismiss', quiet: true }],
  },
];

export function demoWeather() {
  const now = Date.now();
  const temps = [74, 77, 76, 72, 68, 65];
  return {
    location: { name: 'Austin' },
    current: { temp: 74, code: 0 },
    days: [{ high: 81, low: 58 }],
    hours: temps.map((temp, i) => ({ at: now + i * H, temp })),
  };
}

// Today's events (times relative to today) plus the server's own jobs.
export function demoEvents() {
  const at = (h, m = 0, dayOffset = 0) => {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    d.setDate(d.getDate() + dayOffset);
    return d;
  };
  return [
    { title: 'Standup', note: 'Work', start: at(9, 30), tone: 'azure' },
    { title: 'Sonarr grabbed 3 episodes', note: 'Imported to Media/TV', start: at(11), tone: 'slate', server: true },
    { title: 'Review desktop app mockups', note: 'Personal', start: at(16), tone: 'coral' },
    { title: 'Container updates', note: '2 waiting · auto-update off', start: at(23), tone: 'slate', server: true },
    { title: 'Parity check', note: 'About 9 h · disks spin up', start: at(2, 0, 1), tone: 'brass', server: true },
    { title: 'Mover', note: 'Cache at 61%', start: at(3, 0, 1), tone: 'slate', server: true },
  ];
}

export const demoAgents = [
  {
    id: 'warden',
    name: 'Server warden',
    about: 'Watches logs, disks and containers. Fixes small things, asks about big ones.',
    state: 'watching',
    loop: 'near',
    note: '12 checks today · 2 waiting for you',
  },
  {
    id: 'curator',
    name: 'Media curator',
    about: 'Keeps Sonarr and Radarr healthy, retries failed imports, cleans the queue.',
    state: 'running',
    loop: 'out',
    note: 'Retried 6 imports · 1 h ago',
  },
  {
    id: 'studio',
    name: 'Night studio',
    about: "Runs ComfyUI batches overnight when the GPU is free and parity isn't running.",
    state: 'scheduled',
    loop: 'in',
    note: 'Next run 12:00 AM · 2 jobs',
  },
];

export const demoApprovals = [
  {
    id: 'plex-restart',
    tone: 'brass',
    title: 'Restart Plex after the 2 streams end',
    body: 'Server warden wants to apply the Plex 1.41.2 update. Downtime about 40 s.',
    agent: 'warden',
    actions: [{ label: 'Approve', choice: 'approve', primary: true }, { label: 'Deny', choice: 'deny' }],
  },
  {
    id: 'orphans',
    tone: 'red',
    title: 'Delete 214 GB of orphaned downloads',
    body: 'Media curator found files in /downloads with no matching item in Sonarr or Radarr.',
    agent: 'curator',
    actions: [{ label: 'Review list…', choice: 'review' }, { label: 'Deny', choice: 'deny', quiet: true }],
  },
];

export const demoActivity = [
  { at: '14:32', who: 'warden', what: 'Checked SMART on 7 disks, all healthy' },
  { at: '13:40', who: 'curator', what: 'Retried 6 Radarr imports, 6 succeeded' },
  { at: '13:02', who: 'warden', what: 'Cache at 61%, mover not needed' },
  { at: '11:15', who: 'curator', what: 'Removed 3 stalled torrents' },
  { at: '09:00', who: 'warden', what: 'Morning report sent to Telegram' },
];

// Sample containers for the Docker page before the app is connected.
export const demoContainers = [
  ['plex', 'Plex', 'plexinc/pms-docker', 'running', 'Up 12 days (healthy)', 'healthy', 'host', null, 'http://192.168.1.10:32400/web'],
  ['binhex-radarr', 'Radarr', 'binhex/arch-radarr', 'running', 'Up 12 days', null, 'bridge', '172.17.0.4', 'http://192.168.1.10:7878/'],
  ['binhex-sonarr', 'Sonarr', 'binhex/arch-sonarr', 'running', 'Up 12 days', null, 'bridge', '172.17.0.5', 'http://192.168.1.10:8989/'],
  ['binhex-qbittorrentvpn', 'qBittorrent VPN', 'binhex/arch-qbittorrentvpn', 'running', 'Up 3 hours (unhealthy)', 'unhealthy', 'bridge', '172.17.0.6', 'http://192.168.1.10:8080/'],
  ['ollama', 'Ollama', 'ollama/ollama', 'running', 'Up 2 days', null, 'bridge', '172.17.0.9', null],
  ['comfyui', 'ComfyUI', 'ghcr.io/ai-dock/comfyui', 'running', 'Up 2 days', null, 'bridge', '172.17.0.10', 'http://192.168.1.10:8188/'],
  ['hermes-agent', 'Hermes Agent', 'nousresearch/hermes-agent', 'running', 'Up 5 days', null, 'bridge', '172.17.0.11', null],
  ['hermes-agent-2', 'Hermes Agent 2', 'nousresearch/hermes-agent', 'running', 'Up 1 day', null, 'bridge', '172.17.0.12', null],
  ['home-assistant', 'Home Assistant', 'homeassistant/home-assistant', 'running', 'Up 5 days', null, 'br0', '192.168.1.21', 'http://192.168.1.21:8123/'],
  ['nextcloud', 'Nextcloud', 'linuxserver/nextcloud', 'exited', 'Exited (0) 2 days ago', null, 'bridge', null, 'https://192.168.1.10:444/'],
  ['tautulli', 'Tautulli', 'linuxserver/tautulli', 'paused', 'Up 12 days (Paused)', null, 'bridge', '172.17.0.7', 'http://192.168.1.10:8181/'],
].map(([name, displayName, image, state, status, health, networkMode, ip, webui], i) => ({
  id: `sample${i}`.padEnd(12, '0'),
  name,
  displayName,
  image,
  state,
  status,
  health,
  networkMode,
  networks: [{ name: networkMode, ip }],
  ports: [],
  webui,
}));

// Sample Overview: the array's disks, its monthly growth, the last 24 hours
// and what's coming tonight.
export const demoDisks = [
  ['Parity', 'parity', 12, 12, 38, 'WD Red Pro · valid, checked Oct 2'],
  ['Disk 1', 'data', 12, 9.7, 36, 'WD Red Pro · 2.1 years'],
  ['Disk 2', 'data', 12, 9.5, 37, 'IronWolf · spun down'],
  ['Disk 3', 'data', 8, 5.9, 41, 'WD Red Plus · warmest disk'],
  ['Disk 4', 'data', 8, 5.4, 35, 'WD Red Plus · spun down'],
  ['Disk 5', 'data', 6, 4.0, 34, 'IronWolf · spun down'],
  ['Disk 6', 'data', 4, 3.7, 39, 'WD Red · 5.1 years · nearly full'],
  ['Cache', 'pool', 2, 1.22, 44, 'Samsung 990 Pro NVMe · mover 3 AM'],
].map(([label, role, total, used, temp, note]) => ({ label, role, total: total * TB, used: used * TB, temp, note }));

// Array use at the start of each month, oldest first, ending now.
export function demoArrayHistory() {
  const used = [27.5, 28.4, 29.6, 30.8, 32.1, 33.2, 34.6, 35.9, 37.0, 38.2];
  const now = Date.now();
  return used.map((u, i) => ({ at: now - (used.length - 1 - i) * 30.44 * 86400e3, used: u * TB }));
}

export const demoArraySuggestions = [
  {
    id: 'disk6',
    tone: 'watch',
    title: 'Replace Disk 6 with a 12 TB drive',
    body: 'It\'s 4 TB, 93% full and 5.1 years old. A 12 TB swap adds 8 TB and pushes "full" to mid-2028.',
    ask: 'How do I replace Disk 6 with a bigger drive?',
  },
  {
    id: 'parity-comfy',
    tone: 'calm',
    title: "Pause ComfyUI during tonight's parity check",
    body: 'Both read Disk 3 heavily; parity would take about 2 h longer.',
    ask: "Move ComfyUI's jobs before parity",
  },
];

// 48 half-hour cells for the last 24 hours, 0–1, with a few busy spells.
function spells(base, peaks) {
  return Array.from({ length: 48 }, (_, i) => {
    let v = base;
    for (const [at, height, width] of peaks) {
      const d = Math.abs(i - at);
      if (d < width) v += height * (1 - d / width);
    }
    return Math.min(0.95, v);
  });
}

export function demoLanes() {
  return [
    { id: 'cpu', label: 'CPU', color: '0, 229, 255', cells: spells(0.12, [[10, 0.5, 5], [26, 0.3, 4], [40, 0.25, 6]]) },
    { id: 'gpu', label: 'GPU', color: '255, 43, 214', cells: spells(0.06, [[2, 0.7, 6], [28, 0.4, 4], [46, 0.8, 6]]) },
    { id: 'ram', label: 'RAM', color: '92, 156, 255', cells: spells(0.55, [[28, 0.1, 6], [46, 0.12, 6]]) },
  ];
}

// Moments on the 24-hour timeline, as fractions of the day from 24 h ago.
export const demoMoments = [
  { at: 0.06, time: '5:40 AM', label: 'Backup to B2' },
  { at: 0.38, time: '1:40 PM', label: 'Cache at 97%' },
  { at: 0.54, time: '3:00 PM', label: 'Mover ran' },
  { at: 0.82, time: '12:00 AM', label: 'ComfyUI batch', mag: true },
];

export const demoUpcoming = [
  { time: '12:00', what: 'ComfyUI batch · 2 jobs', where: 'GPU' },
  { time: '2:00', what: 'Parity check · about 9 h', where: 'Array' },
  { time: '3:00', what: 'Mover', where: 'Cache' },
];
