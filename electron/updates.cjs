const { app, net, shell } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');
const { createWriteStream } = require('node:fs');
const settings = require('./settings.cjs');

// In-app updates from GitHub Actions: pick a branch, fetch its latest build
// and install it. Builds are workflow artifacts, which GitHub only hands out
// to a signed-in user, so a token with repo access is needed even for a
// public repository.
const WORKFLOW = 'build.yml';
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';
// The artifact names this computer can install, best first. Newer builds
// upload a small zip per Mac chip; older ones only the big all-in-one.
const ARTIFACTS = { darwin: [`cubecrusher-mac-${ARCH}`, 'cubecrusher-mac'], win32: ['cubecrusher-win'], linux: ['cubecrusher-linux'] }[process.platform] || [];
// A download that moves no bytes for this long is given up on.
const STALL = 60_000;

function pickArtifact(artifacts) {
  for (const name of ARTIFACTS) {
    const a = (artifacts || []).find((x) => x.name === name && !x.expired);
    if (a) return a;
  }
  return null;
}

const mb = (n) => `${Math.round(n / 1e6)} MB`;

const run = (cmd, args) =>
  new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve(stdout))));

async function gh(apiPath) {
  const { github } = settings.get();
  if (!github.token) throw new Error('Add a GitHub token under Settings to check for builds.');
  const res = await net.fetch(`https://api.github.com/repos/${github.owner}/${github.repo}${apiPath}`, {
    headers: { Authorization: `Bearer ${github.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    let why = '';
    try {
      why = (await res.json()).message || '';
    } catch {}
    const said = why ? ` GitHub said: "${why}".` : '';
    if (res.status === 401) throw new Error(`GitHub refused the token (401) on ${apiPath}.${said} Check it was pasted whole, hasn't expired, and is a classic token with the "repo" scope or a fine-grained one with Contents and Actions read access to ${github.owner}/${github.repo}.`);
    if (res.status === 403) throw new Error(`GitHub wouldn't allow ${apiPath} with this token (403).${said} A fine-grained token needs Actions read access for builds.`);
    if (res.status === 404) throw new Error(`GitHub can't see ${github.owner}/${github.repo} with this token (404).${said}`);
    throw new Error(`GitHub answered ${res.status} on ${apiPath}.${said}`);
  }
  return res.json();
}

async function branches() {
  const list = await gh('/branches?per_page=100');
  return list.map((b) => b.name).sort();
}

// The newest finished build on a branch, and whether it has this platform's installer.
async function latest(branch) {
  const runs = await gh(`/actions/workflows/${WORKFLOW}/runs?branch=${encodeURIComponent(branch)}&per_page=5`);
  const done = (runs.workflow_runs || []).filter((r) => r.status === 'completed');
  const latestRun = done[0] || null;
  if (!latestRun) return { branch, run: null };
  const { artifacts } = await gh(`/actions/runs/${latestRun.id}/artifacts`);
  const artifact = pickArtifact(artifacts);
  return {
    branch,
    run: {
      id: latestRun.id,
      sha: latestRun.head_sha,
      title: latestRun.display_title,
      at: latestRun.updated_at,
      conclusion: latestRun.conclusion,
      url: latestRun.html_url,
      ready: Boolean(artifact),
      size: artifact?.size_in_bytes || 0,
    },
  };
}

// GitHub answers an artifact download with a redirect to a signed storage
// URL, which refuses the token if it's still attached. So the redirect is
// followed by hand, without the Authorization header. Progress goes back to
// the page as bytes land, and a download that stops moving is given up on
// instead of sitting there for ever.
async function download(url, to, { report, signal, size }) {
  const { github } = settings.get();
  let res = await fetch(url, { headers: { Authorization: `Bearer ${github.token}`, Accept: 'application/vnd.github+json' }, redirect: 'manual', signal });
  for (let hop = 0; hop < 5 && res.status >= 300 && res.status < 400; hop++) {
    const next = res.headers.get('location');
    if (!next) break;
    res = await fetch(next, { redirect: 'manual', signal });
  }
  if (!res.ok) throw new Error(`The download failed (HTTP ${res.status}${res.status === 401 || res.status === 403 ? ', the token was refused for the download' : ''}).`);
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
  if (process.platform === 'win32') return run('tar', ['-xf', file, '-C', dir]);
  return run('unzip', ['-o', '-q', file, '-d', dir]);
}

// Swaps the running .app for the new one and relaunches. The new bundle is
// signed ad hoc and cleared of quarantine first, so macOS doesn't call it damaged.
async function installMac(dir, report) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const inner = (await fs.readdir(dir)).find((f) => f.endsWith(`-${arch}-mac.zip`));
  if (!inner) throw new Error(`The build has no Mac zip for ${arch}.`);
  report('Unpacking the app…');
  const appDir = path.join(dir, 'app');
  await unzip(path.join(dir, inner), appDir);
  const bundle = path.join(appDir, (await fs.readdir(appDir)).find((f) => f.endsWith('.app')));
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

async function installLinux(dir, report) {
  const image = (await fs.readdir(dir)).find((f) => f.endsWith('.AppImage'));
  if (!image) throw new Error('The build has no AppImage.');
  const current = process.env.APPIMAGE;
  if (!current) {
    await shell.openPath(dir);
    return { relaunch: false, note: `Not running from an AppImage, so the new one is in ${dir}.` };
  }
  report('Replacing the AppImage…');
  await fs.copyFile(path.join(dir, image), `${current}.new`);
  await fs.chmod(`${current}.new`, 0o755);
  await fs.rename(`${current}.new`, current);
  await fs.rm(dir, { recursive: true, force: true });
  return { relaunch: true };
}

async function installWindows(dir) {
  const exe = (await fs.readdir(dir)).find((f) => f.endsWith('.exe'));
  if (!exe) throw new Error('The build has no Windows installer.');
  await shell.openPath(path.join(dir, exe));
  return { relaunch: false, quit: true, note: 'The installer is open. It replaces the app; start Cubecrusher again when it finishes.' };
}

async function install(branch, report, signal) {
  const { run: build } = await latest(branch);
  if (!build?.ready) throw new Error(`No finished build for ${branch} yet.`);
  const { artifacts } = await gh(`/actions/runs/${build.id}/artifacts`);
  const artifact = pickArtifact(artifacts);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cubecrusher-update-'));
  try {
    report(`Starting the download of ${branch} @ ${build.sha.slice(0, 7)} (${mb(artifact.size_in_bytes)})…`);
    const zip = path.join(dir, 'artifact.zip');
    await download(artifact.archive_download_url, zip, { report, signal, size: artifact.size_in_bytes });
    report('Unpacking…');
    await unzip(zip, dir);
    await fs.rm(zip, { force: true });
    if (process.platform === 'darwin') return await installMac(dir, report);
    if (process.platform === 'linux') return await installLinux(dir, report);
    return await installWindows(dir);
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

// The one update allowed at a time, with the handle that cancels it.
let installing = null;

function register(ipcMain, getWindow) {
  const report = (text, pct = null) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('updates:progress', { text, pct });
  };
  ipcMain.handle('updates:setToken', async (_e, token) => {
    await settings.update({ github: { ...settings.get().github, token: String(token || '').trim() } });
    return settings.forPage().github;
  });
  ipcMain.handle('updates:branches', () => branches());
  ipcMain.handle('updates:latest', (_e, branch) => latest(branch));
  ipcMain.handle('updates:install', async (_e, branch) => {
    if (installing) throw new Error('An update is already running. Cancel it first.');
    installing = new AbortController();
    try {
      const out = await install(branch, report, installing.signal);
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
