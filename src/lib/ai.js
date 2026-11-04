// The AI page's pure parts: the featured chats and the context each one hands
// Hermes, the "/" commands the composer offers, and how a message that
// carries that context is told apart when the chat shows it again.
import { gb, pct } from './format.js';
import { summary, verdicts } from './overview.js';

// A chat whose first message carries context from the app. The markers let
// the chat fold that context away when the transcript comes back.
export const BRIEF_START = '[Context from the Cubecrusher app:';
export const BRIEF_END = '[End of context]';

export function withBrief(name, brief, text) {
  if (!brief) return text;
  return `${BRIEF_START} ${name}]\n${brief.trim()}\n${BRIEF_END}\n\n${text}`;
}

// { name, brief, text } when a message starts with app context, else null.
export function splitBrief(content) {
  if (typeof content !== 'string' || !content.startsWith(BRIEF_START)) return null;
  const end = content.indexOf(BRIEF_END);
  if (end < 0) return null;
  const head = content.slice(BRIEF_START.length, end);
  const close = head.indexOf(']');
  return {
    name: head.slice(0, close).trim(),
    brief: head.slice(close + 1).trim(),
    text: content.slice(end + BRIEF_END.length).trim(),
  };
}

// What the app knows about Cubecrusher right now, in plain lines for Hermes.
export function serverSnapshot({ host, containers, needs } = {}) {
  const lines = [`Snapshot taken ${new Date().toISOString()} by the desktop app.`];
  if (host) {
    const list = verdicts(host);
    const s = summary(list);
    lines.push(`Cubecrusher is ${s.head}. ${s.rest}`.trim());
    lines.push(`CPU ${Math.round(host.cpu ?? 0)}%${host.cpuTemp != null ? ` at ${Math.round(host.cpuTemp)} °C` : ''}.`);
    if (host.memory?.total) lines.push(`RAM ${gb(host.memory.used)} of ${gb(host.memory.total)} used.`);
    for (const g of host.gpus ?? []) {
      lines.push(`GPU ${g.name}: ${Math.round(g.util ?? 0)}% use${g.temp != null ? `, ${Math.round(g.temp)} °C` : ''}${g.memTotal ? `, ${gb(g.memUsed)} of ${gb(g.memTotal)} VRAM` : ''}.`);
    }
    for (const d of host.disks ?? []) {
      const extra = [d.role, d.temp != null ? `${Math.round(d.temp)} °C` : null, d.status && d.status !== 'ok' ? `status ${d.status}` : null].filter(Boolean).join(', ');
      lines.push(`Disk ${d.label}: ${Math.round(pct(d.used, d.total))}% full${extra ? ` (${extra})` : ''}.`);
    }
    if (host.parity?.status) lines.push(`Parity: ${host.parity.status}.`);
  } else {
    lines.push("The app isn't receiving Cubecrusher's readings right now.");
  }
  if (containers?.length) {
    const running = containers.filter((c) => c.state === 'running').length;
    const off = containers.filter((c) => c.state !== 'running').map((c) => c.displayName || c.name);
    const sick = containers.filter((c) => c.health === 'unhealthy').map((c) => c.displayName || c.name);
    lines.push(`Docker: ${running} of ${containers.length} containers running.${off.length ? ` Not running: ${off.slice(0, 20).join(', ')}.` : ''}${sick.length ? ` Unhealthy: ${sick.join(', ')}.` : ''}`);
  }
  if (needs?.length) lines.push(`Needs attention: ${needs.map((n) => n.title).join('; ')}.`);
  return lines.join('\n');
}

// The chats the AI page keeps at the top. `on` ones show by default; the rest
// are suggestions Thomas can add. Each gives Hermes a role and, where it
// helps, a fresh snapshot of the server when the chat starts.
export const FEATURED = [
  {
    id: 'maintenance',
    name: 'Unraid maintenance',
    blurb: 'Health checks, disks, parity, updates and fixes for Cubecrusher.',
    on: true,
    snapshot: true,
    role: "This chat is for maintaining Thomas's Unraid server, Cubecrusher (Unraid 7.2+). Help keep it healthy: disks, SMART, parity, array, cache, shares, plugins, updates and backups. Explain what a command does before running it, and ask before anything that deletes data, stops the array or restarts the server.",
    starters: ['Run a health check on Cubecrusher', 'What needs attention this week?', 'Check disk temperatures and SMART', 'Plan the next parity check'],
  },
  {
    id: 'docker',
    name: 'Docker doctor',
    blurb: 'Troubleshoot containers, logs, updates and restart policies.',
    on: true,
    snapshot: true,
    role: "This chat is for the Docker containers on Cubecrusher. Help diagnose failing or unhealthy containers, read their logs, plan updates and tidy up images and volumes. Ask before removing anything.",
    starters: ['Why is a container unhealthy?', 'Which containers have updates?', 'Review my restart policies', 'Clean up unused images'],
  },
  {
    id: 'degoogle',
    name: 'De-Google by 2027',
    blurb: 'Plan moving off Google services onto self-hosted ones.',
    on: false,
    snapshot: false,
    role: "This chat is Thomas's plan to replace Google services with self-hosted ones on Cubecrusher by 2027 (mail, photos, drive, calendar, contacts, passwords, maps). Keep track of what's done and what's next, and suggest one concrete step at a time.",
    starters: ["What's the next service to move?", 'Compare Immich and PhotoPrism', 'How do I move Google Calendar?', 'Make a checklist for the year'],
  },
  {
    id: 'network',
    name: 'Network & remote access',
    blurb: 'WireGuard, reverse proxy, DNS and certificates.',
    on: false,
    snapshot: false,
    role: "This chat is about Thomas's home network and remote access to Cubecrusher: WireGuard, reverse proxy, DNS, certificates and firewall rules. Prefer safe changes and explain how to roll back.",
    starters: ["WireGuard can't connect, help me check", 'Set up a reverse proxy for a new service', 'Is anything exposed to the internet?'],
  },
  {
    id: 'media',
    name: 'Media library',
    blurb: 'Plex or Jellyfin and the *arr stack: imports, quality, storage.',
    on: false,
    snapshot: true,
    role: 'This chat is about the media stack on Cubecrusher: the media server and the *arr apps. Help with failed imports, quality profiles, naming, storage and transcoding.',
    starters: ['Why did imports fail?', "What's taking the most space?", 'Is transcoding using the GPU?'],
  },
  {
    id: 'daily',
    name: 'Daily brief',
    blurb: 'What happened overnight on the server, and what to look at today.',
    on: false,
    snapshot: true,
    role: 'Each message in this chat asks for a short daily brief: what happened on Cubecrusher since yesterday (jobs, errors, updates, disk changes) and what is worth doing today. Keep it short.',
    starters: ["Give me today's brief", 'Anything break overnight?'],
  },
];

export const featuredById = (id) => FEATURED.find((f) => f.id === id) || null;

// The context a featured chat's first message carries.
export function featuredBrief(f, server) {
  if (!f) return '';
  return f.snapshot ? `${f.role}\n\n${serverSnapshot(server)}` : f.role;
}

// The "/" commands the composer offers. `arg` says what follows the command:
// a pick from a list (model, instance) or free text.
export const COMMANDS = [
  { cmd: 'model', hint: 'Use another model for this chat', arg: 'pick' },
  { cmd: 'instance', hint: 'Switch to another Hermes', arg: 'pick' },
  { cmd: 'snapshot', hint: "Attach Cubecrusher's current state to the next message" },
  { cmd: 'featured', hint: 'Open a featured chat', arg: 'pick' },
  { cmd: 'new', hint: 'Start a new chat' },
  { cmd: 'rename', hint: 'Rename this chat', arg: 'text' },
  { cmd: 'usage', hint: 'Tokens and cost of this chat so far' },
  { cmd: 'delete', hint: 'Delete this chat from Hermes' },
];

// What the composer's text means for the "/" menu: nothing (null), a list
// of commands matching what's typed, or a command waiting for its argument.
export function slashState(text) {
  if (typeof text !== 'string' || !text.startsWith('/')) return null;
  const m = text.match(/^\/(\S*)(\s+([\s\S]*))?$/);
  if (!m) return null;
  const name = m[1].toLowerCase();
  if (m[2] === undefined) return { stage: 'command', query: name, matches: COMMANDS.filter((c) => c.cmd.startsWith(name)) };
  const command = COMMANDS.find((c) => c.cmd === name);
  if (!command) return { stage: 'command', query: name, matches: [] };
  return { stage: 'arg', command, query: (m[3] || '').trim() };
}

// The options a picking command offers, filtered by what's typed after it.
export function argOptions(command, query, { models, instances } = {}) {
  const q = (query || '').toLowerCase();
  let all = [];
  if (command.cmd === 'model') {
    for (const p of models?.providers ?? []) for (const m of p.models) all.push({ value: { model: m, provider: p.slug }, label: m, hint: p.name, current: p.current && m === models.model });
  } else if (command.cmd === 'instance') {
    all = (instances ?? []).map((h) => ({ value: h.id, label: h.name, hint: h.url }));
  } else if (command.cmd === 'featured') {
    all = FEATURED.map((f) => ({ value: f.id, label: f.name, hint: f.blurb }));
  }
  return all.filter((o) => !q || o.label.toLowerCase().includes(q) || String(o.hint || '').toLowerCase().includes(q)).slice(0, 40);
}

// Sessions the Studio owns are titled with this prefix, so the Chat tab can
// leave them out and the Studio can list only its own.
export const STUDIO_PREFIX = 'Studio · ';
export const isStudio = (s) => typeof s?.title === 'string' && s.title.startsWith(STUDIO_PREFIX);

// Chats matching a search, by title or preview.
export function filterSessions(list, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((s) => `${s.title || ''} ${s.preview || ''}`.toLowerCase().includes(q));
}

// A long chat shows its latest messages first; older ones load on request,
// so opening a chat with thousands of turns doesn't lock up the window.
export const WINDOW = 60;
export const visibleSlice = (messages, shown) => (messages.length > shown ? messages.slice(messages.length - shown) : messages);

// Which Studio chat each ComfyUI output belongs to: the chat with the latest
// message sent before the output finished. `sends` is [{ sid, at }].
export function madeBy(gallery, sends) {
  const sorted = [...(sends || [])].sort((a, b) => a.at - b.at);
  const out = {};
  for (const item of gallery || []) {
    if (item.at == null) continue;
    let owner = null;
    for (const s of sorted) {
      if (s.at <= item.at) owner = s.sid;
      else break;
    }
    if (owner) (out[owner] ||= []).push(item);
  }
  return out;
}

// What a Studio message tells Hermes about the files that came with it.
export function filesNote(files) {
  if (!files?.length) return '';
  const list = files.map((f) => `- ${f.subfolder ? `${f.subfolder}/` : ''}${f.filename} (${f.kind})`).join('\n');
  return `\n\nFiles for this request, already in ComfyUI's input folder:\n${list}`;
}
