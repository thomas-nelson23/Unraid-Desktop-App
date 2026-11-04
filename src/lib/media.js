// Files Hermes hands back. Like its messaging gateways, Hermes names a file
// it made by its path in the reply (sometimes after "MEDIA:"); the app spots
// those paths, fetches the files and shows them by kind.
const EXT = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'm4v'],
  audio: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'],
};
const ALL = Object.values(EXT).flat().join('|');

export function mediaKind(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  for (const [kind, list] of Object.entries(EXT)) if (list.includes(ext)) return kind;
  return null;
}

// What the Studio calls each kind.
export const KIND_LABEL = { image: 'Images', video: 'Video', audio: 'Music' };

// Absolute or ~/ paths ending in a media extension, not inside ``` blocks.
// The path may contain spaces only when it's quoted or in backticks.
const PATH = new RegExp(
  String.raw`MEDIA:\s*(~?/\S+?\.(?:${ALL}))(?=$|\s)` +
    String.raw`|[\`"'](~?/[^\`"'\n]+?\.(?:${ALL}))[\`"']` +
    String.raw`|(?<![\w/~.:])(~?/[^\s\`"'<>()\[\]]+?\.(?:${ALL}))(?=$|[\s\`"'<>()\[\],;!?]|\.(?:\s|$))`,
  'gi',
);

export function extractMedia(text) {
  if (typeof text !== 'string' || !text) return [];
  const prose = text.replace(/```[\s\S]*?(```|$)/g, ' ');
  const seen = new Set();
  const out = [];
  for (const m of prose.matchAll(PATH)) {
    const p = (m[1] || m[2] || m[3]).trim();
    if (!p.startsWith('/') && !p.startsWith('~/')) continue;
    if (p.includes('..') || seen.has(p)) continue;
    seen.add(p);
    out.push({ path: p, kind: mediaKind(p) });
  }
  return out;
}

// The reply without lines that only carry "MEDIA:<path>", which the files
// below it already show.
export function withoutMediaLines(text) {
  if (typeof text !== 'string') return text;
  return text
    .split('\n')
    .filter((l) => !/^\s*MEDIA:\s*\S+\s*$/i.test(l))
    .join('\n')
    .trim();
}

// The library of files Hermes made, newest first, one entry per file.
export function addToLibrary(lib, items, max = 500) {
  const key = (i) => `${i.iid}\n${i.path}`;
  const fresh = new Map(items.map((i) => [key(i), i]));
  const kept = (lib || []).filter((i) => !fresh.has(key(i)));
  return [...items, ...kept].slice(0, max);
}
