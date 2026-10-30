const { app, net, shell } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { createWriteStream } = require('node:fs');
const settings = require('./settings.cjs');

// In-app updates from GitHub Actions: pick a branch, fetch its latest build
// and install it. Builds are workflow artifacts, which GitHub only hands out
// to a signed-in user, so a token with repo access is needed even for a
// public repository.
const WORKFLOW = 'build.yml';
const ARTIFACT = { darwin: 'cubecrusher-mac', win32: 'cubecrusher-win', linux: 'cubecrusher-linux' }[process.platform];

const run = (cmd, args) =>
  new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve(stdout))));

async function gh(apiPath) {
  const { github } = settings.get();
  if (!github.token) throw new Error('Add a GitHub token under Settings to check for builds.');
  const res = await net.fetch(`https://api.github.com/repos/${github.owner}/${github.repo}${apiPath}`, {
    headers: { Authorization: `Bearer ${github.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401) throw new Error('GitHub refused the token. Make a new one with access to the repository.');
  if (res.status === 404) throw new Error(`GitHub can't see ${github.owner}/${github.repo} with this token.`);
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
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
  const artifact = (artifacts || []).find((a) => a.name === ARTIFACT && !a.expired) || null;
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
    },
  };
}

async function download(url, to) {
  const { github } = settings.get();
  const res = await net.fetch(url, { headers: { Authorization: `Bearer ${github.token}`, Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`The download failed (HTTP ${res.status}).`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(to));
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

async function install(branch, report) {
  const { run: build } = await latest(branch);
  if (!build?.ready) throw new Error(`No finished build for ${branch} yet.`);
  const { artifacts } = await gh(`/actions/runs/${build.id}/artifacts`);
  const artifact = artifacts.find((a) => a.name === ARTIFACT && !a.expired);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cubecrusher-update-'));
  report(`Downloading ${branch} @ ${build.sha.slice(0, 7)}…`);
  const zip = path.join(dir, 'artifact.zip');
  await download(artifact.archive_download_url, zip);
  await unzip(zip, dir);
  await fs.rm(zip, { force: true });
  if (process.platform === 'darwin') return installMac(dir, report);
  if (process.platform === 'linux') return installLinux(dir, report);
  return installWindows(dir);
}

let installing = false;

function register(ipcMain, getWindow) {
  const report = (text) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('updates:progress', text);
  };
  ipcMain.handle('updates:setToken', async (_e, token) => {
    await settings.update({ github: { ...settings.get().github, token: String(token || '').trim() } });
    return settings.forPage().github;
  });
  ipcMain.handle('updates:branches', () => branches());
  ipcMain.handle('updates:latest', (_e, branch) => latest(branch));
  ipcMain.handle('updates:install', async (_e, branch) => {
    if (installing) throw new Error('An update is already running.');
    installing = true;
    try {
      const out = await install(branch, report);
      if (out.relaunch) {
        app.relaunch();
        setTimeout(() => app.exit(0), 300);
      } else if (out.quit) setTimeout(() => app.quit(), 1500);
      return out;
    } finally {
      installing = false;
    }
  });
}

module.exports = { register };
