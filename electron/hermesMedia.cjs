// The pure parts of moving files between this app and a Hermes container:
// which paths are safe to ask for, which container is the instance's, and
// the shell commands that read or write a file inside it.

const EXT = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'm4v'],
  audio: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'],
};

function kindOf(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  for (const [kind, list] of Object.entries(EXT)) if (list.includes(ext)) return kind;
  return null;
}

// An absolute or home-relative path to a media file, with nothing a shell
// could read as anything but a path. Null otherwise.
function safeMediaPath(p) {
  if (typeof p !== 'string') return null;
  const s = p.trim();
  if (s.length > 400 || !/^(~\/|\/)[A-Za-z0-9_.\/ @+,=-]+$/.test(s) || s.includes('..')) return null;
  return kindOf(s) ? s : null;
}

// A plain file name for an upload.
function safeUploadName(name) {
  const base = String(name || 'upload').split(/[\\/]/).pop();
  return base.replace(/[^\w.\- ]+/g, '_').replace(/^[.\s]+/, '').slice(0, 120) || 'upload';
}

// Which container publishes this port, from `docker ps --format '{{.Names}}|{{.Ports}}'`.
// Falls back to the only container with "hermes" in its name.
function containerFor(psOutput, port) {
  const rows = String(psOutput || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('|');
      return { name: i < 0 ? l : l.slice(0, i), ports: i < 0 ? '' : l.slice(i + 1) };
    });
  if (port) {
    const hit = rows.find((r) => new RegExp(`:${port}->`).test(r.ports));
    if (hit) return hit.name;
  }
  const hermes = rows.filter((r) => /hermes/i.test(r.name));
  return hermes.length === 1 ? hermes[0].name : null;
}

// Single-quoted for sh, safely.
const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

// A path inside the container, with a leading ~ meaning that user's home.
const inContainer = (p) => (p.startsWith('~/') ? `"$HOME"/${q(p.slice(2))}` : q(p));

function readCommand(container, path) {
  return ['docker', 'exec', q(container), 'sh', '-c', q(`cat ${inContainer(path)}`)];
}

// Writes stdin to Hermes's uploads folder and prints where it went.
function writeCommand(container, name) {
  const script = `d="\${HERMES_HOME:-$HOME/.hermes}/uploads"; mkdir -p "$d" && f="$d/$(date +%Y%m%d-%H%M%S)-"${q(name)} && cat > "$f" && printf %s "$f"`;
  return ['docker', 'exec', '-i', q(container), 'sh', '-c', q(script)];
}

module.exports = { kindOf, safeMediaPath, safeUploadName, containerFor, readCommand, writeCommand, q };
