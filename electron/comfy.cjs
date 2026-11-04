const { net, dialog } = require('electron');
const fs = require('node:fs/promises');
const settings = require('./settings.cjs');
const { cleanComfyUrl, toGallery, toQueue, safeName, kindOf, viewUrl } = require('./comfyShape.cjs');

// ComfyUI straight from the app, for the Studio: files go into its input
// folder (where image-to-image and audio-to-audio workflows read them) and
// what it makes comes back from /history. Hermes drives the workflows; the
// app only moves the media and shows it.

const MAX_UPLOAD = 200 * 1024 * 1024;

function base() {
  const url = settings.get().comfyUrl;
  if (!url) throw new Error('Set ComfyUI\'s address first (Studio or Settings).');
  return url;
}

async function getJson(url, ms = 8000) {
  let res;
  try {
    res = await net.fetch(url, { signal: AbortSignal.timeout(ms) });
  } catch (err) {
    throw new Error(`Can't reach ComfyUI at ${url.replace(/\/[^/]*$/, '')} (${err.cause?.code || err.message}).`);
  }
  if (!res.ok) throw new Error(`ComfyUI answered ${res.status}.`);
  return res.json();
}

async function test(raw) {
  const url = cleanComfyUrl(raw);
  if (!url) throw new Error("That doesn't look like an address.");
  const stats = await getJson(`${url}/system_stats`, 5000);
  const dev = stats?.devices?.[0];
  return { ok: true, version: stats?.system?.comfyui_version || null, device: dev?.name || null };
}

async function save(raw) {
  const url = raw ? cleanComfyUrl(raw) : '';
  if (raw && !url) throw new Error("That doesn't look like an address.");
  await settings.update({ comfyUrl: url });
  return { url };
}

// One file into ComfyUI's input folder. ComfyUI's image upload takes any file,
// which is how its audio and video loaders get theirs.
async function upload({ name, bytes, mime }) {
  const b = base();
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!data.length) throw new Error('That file is empty.');
  if (data.length > MAX_UPLOAD) throw new Error('Files over 200 MB are too big to send.');
  const filename = safeName(name);
  const form = new FormData();
  form.append('image', new Blob([data], { type: mime || 'application/octet-stream' }), filename);
  form.append('type', 'input');
  form.append('overwrite', 'false');
  let res;
  try {
    res = await fetch(`${b}/upload/image`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
  } catch (err) {
    throw new Error(`Can't reach ComfyUI at ${b} (${err.cause?.code || err.message}).`);
  }
  if (!res.ok) throw new Error(`ComfyUI refused the upload (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const out = await res.json();
  const file = { filename: out.name || filename, subfolder: out.subfolder || '', type: out.type || 'input' };
  return { ...file, kind: kindOf(file.filename), url: viewUrl(b, file), at: Date.now() };
}

// Something ComfyUI made, put back into its input folder to work on again.
async function reuse({ filename, subfolder, type }) {
  const b = base();
  const res = await net.fetch(viewUrl(b, { filename, subfolder, type }), { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`ComfyUI answered ${res.status}.`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return upload({ name: filename, bytes, mime: res.headers.get('content-type') || undefined });
}

// Saves a file from ComfyUI to this computer, where Thomas picks.
async function download(win, { filename, subfolder, type }) {
  const b = base();
  const pick = await dialog.showSaveDialog(win, { defaultPath: safeName(filename) });
  if (pick.canceled || !pick.filePath) return { saved: false };
  const res = await net.fetch(viewUrl(b, { filename, subfolder, type }), { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`ComfyUI answered ${res.status}.`);
  await fs.writeFile(pick.filePath, Buffer.from(await res.arrayBuffer()));
  return { saved: true, path: pick.filePath };
}

function register(ipcMain, getWindow) {
  ipcMain.handle('comfy:get', () => ({ url: settings.get().comfyUrl || '' }));
  ipcMain.handle('comfy:test', (_e, url) => test(url));
  ipcMain.handle('comfy:save', (_e, url) => save(url));
  ipcMain.handle('comfy:gallery', async (_e, { max = 64 } = {}) => {
    const b = base();
    return toGallery(await getJson(`${b}/history?max_items=${Math.min(Math.max(1, Number(max) || 64), 256)}`), b);
  });
  ipcMain.handle('comfy:queue', async () => toQueue(await getJson(`${base()}/queue`, 4000)));
  ipcMain.handle('comfy:upload', (_e, file) => upload(file || {}));
  ipcMain.handle('comfy:reuse', (_e, file) => reuse(file || {}));
  ipcMain.handle('comfy:download', (_e, file) => download(getWindow(), file || {}));
}

module.exports = { register };
