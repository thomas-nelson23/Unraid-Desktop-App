// The releases the build workflow publishes, as the updater reads them.
// Each push becomes a release tagged builds/<branch>/<run number>, pointing
// at its commit, with one asset per installer: the Apple Silicon zip, the
// Windows installer, the AppImage and the pacman package.
const TAG = /^builds\/(.+)\/(\d+)$/;

// Which asset this computer installs. Linux is either an AppImage, which
// the updater swaps in place, or a pacman install, which it upgrades with
// the new package.
function assetPattern({ platform, arch, kind }) {
  if (platform === 'darwin') return new RegExp(`-${arch === 'arm64' ? 'arm64' : 'x64'}-mac\\.zip$`, 'i');
  if (platform === 'win32') return /\.exe$/i;
  if (platform === 'linux') return kind === 'pacman' ? /\.pacman$/i : /\.AppImage$/i;
  return null;
}

function pickAsset(assets, want) {
  const re = assetPattern(want);
  if (!re) return null;
  return (assets || []).find((a) => re.test(a.name)) || null;
}

// One release as the page sees it, or null when it isn't a build.
function parseRelease(r) {
  const m = TAG.exec(r?.tag_name || '');
  if (!m) return null;
  return {
    branch: m[1],
    number: Number(m[2]),
    sha: r.target_commitish || '',
    title: r.name || r.tag_name,
    notes: (r.body || '').trim(),
    at: r.published_at || r.created_at || '',
    url: r.html_url || '',
    prerelease: Boolean(r.prerelease),
    assets: (r.assets || []).map((a) => ({ name: a.name, size: a.size || 0, url: a.browser_download_url })),
  };
}

// The builds grouped by branch, newest first, and the branches that have one.
function builds(releases) {
  const byBranch = {};
  for (const r of releases || []) {
    const b = parseRelease(r);
    if (!b) continue;
    (byBranch[b.branch] ||= []).push(b);
  }
  for (const list of Object.values(byBranch)) list.sort((a, b) => b.number - a.number);
  return { branches: Object.keys(byBranch).sort(), byBranch };
}

// The newest build on a branch with this computer's installer, plus the
// newest one without (a build whose upload went wrong), so a failed build
// isn't mistaken for "up to date".
function latestFor(releases, branch, want) {
  const list = builds(releases).byBranch[branch] || [];
  let newer = null;
  for (const b of list) {
    const asset = pickAsset(b.assets, want);
    if (asset) return { run: { ...b, ready: true, asset, size: asset.size }, newer };
    if (!newer) newer = { ...b, ready: false, asset: null, size: 0 };
  }
  return { run: null, newer };
}

// Whether a build is one this computer isn't running yet.
const isNewer = (run, running) => Boolean(run?.sha) && run.sha !== running?.sha;

module.exports = { TAG, assetPattern, pickAsset, parseRelease, builds, latestFor, isNewer };
