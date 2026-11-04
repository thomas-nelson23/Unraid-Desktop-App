const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

// Everything the app remembers about this computer's setup, in the user's
// config folder so it survives updates: Cubecrusher's Unraid API, the
// optional dashboard server, the Hermes instances, the Docker servers, the
// weather place and which GitHub repository the updates come from.
const DEFAULTS = {
  unraid: { url: process.env.UNRAID_URL || '', apiKey: process.env.UNRAID_API_KEY || '', insecure: false, sshUser: 'root', sshPort: 22 },
  weather: null,
  serverUrl: process.env.CUBECRUSHER_URL || '',
  hermes: [],
  hermesCurrent: null,
  servers: [],
  comfyUrl: '',
  github: { owner: 'thomas-nelson23', repo: 'unraid-desktop-app' },
};

let settings = structuredClone(DEFAULTS);
let writing = Promise.resolve();

const file = () => path.join(app.getPath('userData'), 'settings.json');

async function load() {
  try {
    const saved = JSON.parse(await fs.readFile(file(), 'utf8'));
    settings = { ...structuredClone(DEFAULTS), ...saved, github: { ...DEFAULTS.github, ...(saved.github || {}) }, unraid: { ...DEFAULTS.unraid, ...(saved.unraid || {}) } };
  } catch {
    // First run: nothing saved yet.
  }
  return settings;
}

function get() {
  return settings;
}

async function update(next) {
  settings = { ...settings, ...next };
  const snapshot = JSON.stringify(settings, null, 2);
  writing = writing.then(async () => {
    await fs.mkdir(path.dirname(file()), { recursive: true });
    await fs.writeFile(`${file()}.tmp`, snapshot, { mode: 0o600 });
    await fs.rename(`${file()}.tmp`, file());
  });
  await writing;
  return settings;
}

// What the page may see: never a key, only whether one is set.
function forPage() {
  const { apiKey, ...unraid } = settings.unraid;
  return {
    unraid: { ...unraid, hasKey: Boolean(apiKey) },
    weather: settings.weather,
    serverUrl: settings.serverUrl,
    hermes: settings.hermes.map(({ key, ...h }) => ({ ...h, hasKey: Boolean(key) })),
    hermesCurrent: settings.hermesCurrent,
    servers: settings.servers,
    comfyUrl: settings.comfyUrl || '',
    github: { owner: settings.github.owner, repo: settings.github.repo },
  };
}

const newId = () => Math.random().toString(36).slice(2, 10);

module.exports = { load, get, update, forPage, newId };
