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
