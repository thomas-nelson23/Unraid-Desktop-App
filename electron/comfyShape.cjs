// The pure parts of talking to ComfyUI: its address, what kind of media a
// file is, and its /history answer turned into a gallery, newest first.

const KINDS = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'm4v'],
  audio: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'],
};

function kindOf(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  for (const [kind, exts] of Object.entries(KINDS)) if (exts.includes(ext)) return kind;
  return 'file';
}

// "10.1.1.3:8188" -> "http://10.1.1.3:8188"; null when it isn't an address.
function cleanComfyUrl(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

// Where a file ComfyUI made or was given can be seen.
function viewUrl(base, { filename, subfolder = '', type = 'output' }) {
  const q = new URLSearchParams({ filename, subfolder, type });
  return `${base}/view?${q}`;
}

// When a prompt finished, from its status messages (ms), or null.
function finishedAt(status) {
  for (const [name, data] of status?.messages ?? []) {
    if ((name === 'execution_success' || name === 'execution_error') && typeof data?.timestamp === 'number') return data.timestamp;
  }
  let last = null;
  for (const [, data] of status?.messages ?? []) if (typeof data?.timestamp === 'number') last = data.timestamp;
  return last;
}

// The positive prompt text, when the graph has an obvious one.
function promptText(graph) {
  if (!graph || typeof graph !== 'object') return null;
  for (const node of Object.values(graph)) {
    const t = node?.inputs?.text ?? node?.inputs?.prompt ?? node?.inputs?.tags;
    if (typeof t === 'string' && t.trim() && !/negative/i.test(node?._meta?.title || '')) return t.trim().slice(0, 500);
  }
  return null;
}

// ComfyUI's /history: { [promptId]: { prompt: [n, id, graph, ...], outputs: { [node]: { images|gifs|audio|videos: [{ filename, subfolder, type }] } }, status } }
function toGallery(history, base) {
  const out = [];
  for (const [promptId, entry] of Object.entries(history || {})) {
    const at = finishedAt(entry?.status);
    const text = promptText(Array.isArray(entry?.prompt) ? entry.prompt[2] : null);
    const failed = entry?.status?.status_str === 'error';
    for (const [node, outputs] of Object.entries(entry?.outputs || {})) {
      for (const list of Object.values(outputs || {})) {
        if (!Array.isArray(list)) continue;
        for (const f of list) {
          if (!f || typeof f.filename !== 'string') continue;
          if (f.type === 'temp') continue; // previews ComfyUI throws away
          out.push({
            id: `${promptId}:${node}:${f.subfolder || ''}/${f.filename}`,
            promptId,
            filename: f.filename,
            subfolder: f.subfolder || '',
            type: f.type || 'output',
            kind: kindOf(f.filename),
            url: viewUrl(base, f),
            at,
            prompt: text,
            failed,
          });
        }
      }
    }
  }
  return out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

// ComfyUI's /queue: how many prompts are running and waiting.
function toQueue(q) {
  return { running: Array.isArray(q?.queue_running) ? q.queue_running.length : 0, pending: Array.isArray(q?.queue_pending) ? q.queue_pending.length : 0 };
}

// A file name ComfyUI will accept: no folders, nothing odd.
function safeName(name) {
  const base = String(name || 'upload').split(/[\\/]/).pop();
  const clean = base.replace(/[^\w.\- ]+/g, '_').replace(/^\.+/, '').slice(0, 120);
  return clean || 'upload';
}

module.exports = { kindOf, cleanComfyUrl, viewUrl, toGallery, toQueue, safeName, finishedAt };
