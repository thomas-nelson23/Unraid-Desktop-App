const test = require('node:test');
const assert = require('node:assert/strict');
const { pickAsset, parseRelease, builds, latestFor, isNewer } = require('./updatesShape.cjs');

const asset = (name, size = 1000) => ({ name, size, browser_download_url: `https://github.com/x/y/releases/download/t/${name}` });
const ALL = [asset('Cubecrusher-0.1.0-arm64-mac.zip'), asset('Cubecrusher.Setup.0.1.0.exe'), asset('Cubecrusher-0.1.0.AppImage'), asset('cubecrusher-desktop-0.1.0.pacman')];
const release = (branch, n, sha, assets = ALL) => ({ tag_name: `builds/${branch}/${n}`, name: `${branch} @ ${sha.slice(0, 7)}`, target_commitish: sha, body: 'Fix a thing', published_at: `2026-11-0${n}T00:00:00Z`, html_url: `https://github.com/x/y/releases/tag/builds/${branch}/${n}`, prerelease: branch !== 'main', assets });

test('pickAsset finds the installer for each kind of computer', () => {
  assert.equal(pickAsset(ALL, { platform: 'darwin', arch: 'arm64' }).name, 'Cubecrusher-0.1.0-arm64-mac.zip');
  assert.equal(pickAsset(ALL, { platform: 'darwin', arch: 'x64' }), null);
  assert.equal(pickAsset(ALL, { platform: 'win32', arch: 'x64' }).name, 'Cubecrusher.Setup.0.1.0.exe');
  assert.equal(pickAsset(ALL, { platform: 'linux', arch: 'x64', kind: 'appimage' }).name, 'Cubecrusher-0.1.0.AppImage');
  assert.equal(pickAsset(ALL, { platform: 'linux', arch: 'x64', kind: 'pacman' }).name, 'cubecrusher-desktop-0.1.0.pacman');
  assert.equal(pickAsset(ALL, { platform: 'freebsd', arch: 'x64' }), null);
});

test('parseRelease reads the branch and run number out of the tag and skips other releases', () => {
  const b = parseRelease(release('fix/hermes-dashboard-address', 7, 'abcdef0123'));
  assert.equal(b.branch, 'fix/hermes-dashboard-address');
  assert.equal(b.number, 7);
  assert.equal(b.sha, 'abcdef0123');
  assert.equal(b.prerelease, true);
  assert.equal(b.assets.length, 4);
  assert.equal(b.assets[0].url, 'https://github.com/x/y/releases/download/t/Cubecrusher-0.1.0-arm64-mac.zip');
  assert.equal(parseRelease({ tag_name: 'v0.1.0' }), null);
  assert.equal(parseRelease(null), null);
});

test('builds groups releases by branch, newest first', () => {
  const { branches, byBranch } = builds([release('main', 3, 'c'), release('feature/x', 4, 'd'), release('main', 5, 'e'), { tag_name: 'v1' }]);
  assert.deepEqual(branches, ['feature/x', 'main']);
  assert.deepEqual(byBranch.main.map((b) => b.number), [5, 3]);
});

test('latestFor skips a build with no installer and reports it as newer', () => {
  const want = { platform: 'darwin', arch: 'arm64' };
  const rs = [release('main', 2, 'a'), release('main', 3, 'b'), release('main', 4, 'c', [asset('Cubecrusher.Setup.0.1.0.exe')])];
  const { run, newer } = latestFor(rs, 'main', want);
  assert.equal(run.number, 3);
  assert.equal(run.asset.name, 'Cubecrusher-0.1.0-arm64-mac.zip');
  assert.equal(run.size, 1000);
  assert.equal(newer.number, 4);
  assert.equal(newer.ready, false);
  assert.deepEqual(latestFor(rs, 'nope', want), { run: null, newer: null });
});

test('isNewer compares the commit with the one running', () => {
  assert.equal(isNewer({ sha: 'abc' }, { sha: 'abc' }), false);
  assert.equal(isNewer({ sha: 'abc' }, { sha: 'def' }), true);
  assert.equal(isNewer({ sha: 'abc' }, { sha: '' }), true);
  assert.equal(isNewer(null, { sha: 'abc' }), false);
});
