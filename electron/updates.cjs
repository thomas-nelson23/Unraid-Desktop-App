const { app, net, shell } = require('electron');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');
const { createWriteStream } = require('node:fs');
const settings = require('./settings.cjs');
const { builds, latestFor, isNewer } = require('./updatesShape.cjs');

// In-app updates from GitHub Releases. Every push publishes one with the
// installers attached (see .github/workflows/build.yml); the repository is
// public, so they're fetched with no token. The app checks its own branch
// at startup and every hour and tells the page when there's a newer build,
// and Settings lets any branch's build be installed.
const API = process.env.CUBECRUSHER_GITHUB_API || 'https://api.github.com';
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';
// A download that moves no bytes for this long is given up on.
const STALL = 60_000;
const CHECK_EVERY = 60 * 60 * 1000;
const FIRST_CHECK = 15_000;

// How this Linux install can be replaced: an AppImage is swapped in place;
// a pacman install (under /opt) is upgraded with the new package.
function linuxKind() {
  if (process.env.APPIMAGE) return 'appimage';
  if (process.execPath.startsWith('/opt/')) return 'pacman';
  return 'appimage';
}
const WANT = { platform: process.platform, arch: ARCH, kind: process.platform === 'linux' ? linuxKind() : undefined };

// Which build this is: written next to the page by the build (vite.config.js).
let running = { branch: 'dev', sha: '', at: '' };
try {
  running = { ...running, ...require(path.join(__dirname, '..', 'dist', 'build.json')) };
} catch {
  // Running from source, with no build.
}

const mb = (n) => `${Math.round(n / 1e6)} MB`;

const run = (cmd, args) =>
  new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve(stdout))));

async function gh(apiPath) {
  const { github } = settings.get();
  let res;
  try {
    res = await net.fetch(`${API}/repos/${github.owner}/${github.repo}${apiPath}`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new Error(`Can't reach GitHub (${err.cause?.code || err.message}).`);
  }
  if (!res.ok) {
    let why = '';
    try {
      why = (await res.json()).message || '';
    } catch {}
    const said = why ? ` GitHub said: "${why}".` : '';
    if (res.status === 403 || res.status === 429) throw new Error(`GitHub is rate-limiting update checks from this address for a while (${res.status}).${said}`);
    if (res.status === 404) throw new Error(`GitHub can't find ${github.owner}/${github.repo} (404).${said}`);
    throw new Error(`GitHub answered ${res.status}.${said}`);
  }
  return res.json();
}

// The releases, kept a minute so the page and the hourly check don't ask twice.
let cached = { at: 0, list: null };
async function releases(fresh = false) {
  if (!fresh && cached.list && Date.now() - cached.at < 60_000) return cached.list;
  const list = await gh('/releases?per_page=100');
  cached = { at: Date.now(), list };
  return list;
}

const branches = async (fresh) => builds(await releases(fresh)).branches;

// Whether the workflow is building this branch right now (public too).
async function building(branch) {
  try {
    const { total_count: n } = await gh(`/actions/workflows/build.yml/runs?branch=${encodeURIComponent(branch)}&status=in_progress&per_page=1`);
    return n > 0;
  } catch {
    return false;
  }
}

// The newest build on a branch that has this computer's installer.
async function latest(branch, fresh = false) {
  const { run: build, newer } = latestFor(await releases(fresh), branch, WANT);
  return { branch, run: build, newer, building: !build || newer ? await building(branch) : false, running };
}

// A plain download with progress, given up on when nothing arrives for a
// while instead of sitting there for ever.
async function download(url, to, { report, signal, size }) {
  let res;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (signal?.aborted) throw new Error('Download cancelled.');
    throw new Error(`The download couldn't start (${err.cause?.code || err.message}).`);
  }
  if (!res.ok) throw new Error(`The download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || size || 0;
  let got = 0;
  let moved = Date.now();
  let told = 0;
  const tell = () => {
    const pct = total ? Math.min(100, Math.round((got / total) * 100)) : null;
    report(`Downloading… ${mb(got)}${total ? ` of ${mb(total)}` : ''}`, pct);
  };
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      got += chunk.length;
      moved = Date.now();
      if (Date.now() - told > 400) {
        told = Date.now();
        tell();
      }
      cb(null, chunk);
    },
  });
  const stalled = setInterval(() => {
    if (Date.now() - moved > STALL) {
      clearInterval(stalled);
      res.body.cancel(new Error('stalled')).catch(() => {});
      counter.destroy(new Error(`The download stopped: nothing arrived for ${STALL / 1000} seconds (${mb(got)} of ${mb(total)}). Check the connection and try again.`));
    }
  }, 5000);
  try {
    await pipeline(Readable.fromWeb(res.body), counter, createWriteStream(to));
  } catch (err) {
    if (signal?.aborted) throw new Error('Download cancelled.');
    throw err;
  } finally {
    clearInterval(stalled);
  }
  tell();
}

async function unzip(file, dir) {
  await fs.mkdir(dir, { recursive: true });
  if (process.platform === 'darwin') return run('ditto', ['-x', '-k', file, dir]);
  return run('unzip', ['-o', '-q', file, '-d', dir]);
}

// Swaps the running .app for the new one and relaunches. The new bundle is
// signed ad hoc and cleared of quarantine first, so macOS doesn't call it damaged.
async function installMac(file, dir, report) {
  report('Unpacking the app…');
  const appDir = path.join(dir, 'app');
  await unzip(file, appDir);
  const name = (await fs.readdir(appDir)).find((f) => f.endsWith('.app'));
  if (!name) throw new Error('The download has no app in it.');
  const bundle = path.join(appDir, name);
  await run('xattr', ['-cr', bundle]);
  await run('codesign', ['--force', '--deep', '-s', '-', bundle]);
  const target = path.resolve(app.getPath('exe'), '..', '..', '..');
  if (!target.endsWith('.app')) throw new Error(`Not running from an app bundle (${target}), so there is nothing to replace. Use the zip in ${dir} by hand.`);
  report('Replacing the app…');
  const old = `${target}.old`;
  await fs.rm(old, { recursive: true, force: true });
  await fs.rename(target, old);
  try {
    await run('ditto', [bundle, target]);
  } catch (err) {
    await fs.rename(old, target);
    throw err;
  }
  await fs.rm(old, { recursive: true, force: true });
  await fs.rm(dir, { recursive: true, force: true });
  return { relaunch: true };
}

async function installAppImage(file, dir, report) {
  const current = process.env.APPIMAGE;
  if (!current) {
    shell.openPath(dir).catch(() => {});
    return { relaunch: false, note: `Not running from an AppImage, so the new one is in ${dir}.` };
  }
  report('Replacing the AppImage…');
  await fs.copyFile(file, `${current}.new`);
  await fs.chmod(`${current}.new`, 0o755);
  await fs.rename(`${current}.new`, current);
  await fs.rm(dir, { recursive: true, force: true });
  return { relaunch: true };
}

// Upgrades a pacman install with the new package. pkexec asks for the
// password in a window; without it the package is left to install by hand.
async function installPacman(file, dir, report) {
  const have = async (p) => fs.access(p).then(() => true, () => false);
  if (!(await have('/usr/bin/pkexec')) || !(await have('/usr/bin/pacman'))) {
    shell.openPath(dir).catch(() => {});
    return { relaunch: false, note: `The package is in ${dir}; install it with: sudo pacman -U ${path.basename(file)}` };
  }
  report('Installing the package (enter your password when asked)…');
  try {
    await run('/usr/bin/pkexec', ['/usr/bin/pacman', '-U', '--noconfirm', file]);
  } catch (err) {
    if (/dismissed|not authorized|cancel/i.test(err.message)) throw new Error('The password prompt was cancelled, so the update was not installed.');
    throw new Error(`pacman couldn't install the package: ${err.message}`);
  }
  await fs.rm(dir, { recursive: true, force: true });
  return { relaunch: true };
}

// Runs the Windows installer quietly; it replaces the app and starts it again.
async function installWindows(file) {
  const child = spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' });
  child.unref();
  return { relaunch: false, quit: true, note: 'Installing… Cubecrusher closes and comes back on its own.' };
}

async function install(branch, report, signal) {
  const { run: build } = await latest(branch, true);
  if (!build?.ready) throw new Error(`No finished build for ${branch} yet.`);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cubecrusher-update-'));
  try {
    report(`Starting the download of ${branch} @ ${build.sha.slice(0, 7)} (${mb(build.size)})…`);
    const file = path.join(dir, build.asset.name);
    await download(build.asset.url, file, { report, signal, size: build.size });
    if (process.platform === 'darwin') return await installMac(file, dir, report);
    if (process.platform === 'win32') return await installWindows(file);
    if (WANT.kind === 'pacman') return await installPacman(file, dir, report);
    return await installAppImage(file, dir, report);
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

// The one update allowed at a time, with the handle that cancels it.
let installing = null;
// The newer build on this app's own branch, if the last check found one.
let available = null;

function register(ipcMain, getWindow) {
  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  const report = (text, pct = null) => send('updates:progress', { text, pct });

  // Looks at this app's own branch and tells the page when a newer build is out.
  const check = async (fresh = true) => {
    if (!running.sha || running.branch === 'dev') return { available: null, running };
    const { run: build } = await latest(running.branch, fresh);
    available = isNewer(build, running) ? build : null;
    send('updates:available', available);
    return { available, running };
  };
  if (running.sha && running.branch !== 'dev' && !process.env.CUBECRUSHER_NO_UPDATE_CHECK) {
    setTimeout(() => check().catch(() => {}), process.env.CUBECRUSHER_FIRST_CHECK_MS ? Number(process.env.CUBECRUSHER_FIRST_CHECK_MS) : FIRST_CHECK).unref?.();
    setInterval(() => check().catch(() => {}), CHECK_EVERY).unref?.();
  }

  ipcMain.handle('updates:running', () => running);
  ipcMain.handle('updates:check', (_e, fresh) => check(fresh !== false));
  ipcMain.handle('updates:branches', (_e, fresh) => branches(Boolean(fresh)));
  ipcMain.handle('updates:latest', (_e, branch, fresh) => latest(branch, Boolean(fresh)));
  ipcMain.handle('updates:install', async (_e, branch) => {
    if (installing) throw new Error('An update is already running. Cancel it first.');
    installing = new AbortController();
    try {
      const out = await install(branch || running.branch, report, installing.signal);
      if (out.relaunch) {
        app.relaunch();
        setTimeout(() => app.exit(0), 300);
      } else if (out.quit) setTimeout(() => app.quit(), 1500);
      return out;
    } finally {
      installing = null;
    }
  });
  ipcMain.handle('updates:cancel', () => {
    installing?.abort();
    return Boolean(installing);
  });
  // Whether an update is still running, for a page that was reloaded in the middle of one.
  ipcMain.handle('updates:busy', () => Boolean(installing));
}

module.exports = { register };
