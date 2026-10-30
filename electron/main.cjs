const { app, BrowserWindow, ipcMain, net, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

// Where the app finds Cubecrusher's dashboard server. Kept in the user's
// config folder so it survives updates.
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { serverUrl: process.env.CUBECRUSHER_URL || '' };

async function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(await fs.readFile(settingsFile(), 'utf8')) };
  } catch {
    // First run: nothing saved yet.
  }
}

async function saveSettings(next) {
  settings = { ...settings, ...next };
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 2));
  return settings;
}

function cleanServerUrl(raw) {
  const url = new URL(String(raw || '').trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The address has to start with http:// or https://');
  return url.origin;
}

// The page asks for /api/... and the main process makes the request, so the
// server's sign-in cookie lives in Electron's own cookie jar and no CORS
// rules get in the way.
ipcMain.handle('api:request', async (_event, { method = 'GET', path: apiPath, body }) => {
  if (!settings.serverUrl) return { status: 0, error: 'not-configured' };
  if (typeof apiPath !== 'string' || !apiPath.startsWith('/api/')) return { status: 400, error: 'Bad path' };
  try {
    const res = await net.fetch(settings.serverUrl + apiPath, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text.slice(0, 200) };
    }
    return { status: res.status, data };
  } catch (err) {
    return { status: 0, error: err.message };
  }
});

ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', async (_event, next) => {
  const serverUrl = next.serverUrl ? cleanServerUrl(next.serverUrl) : '';
  return saveSettings({ serverUrl });
});
ipcMain.handle('open:external', (_event, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});

// The VMs page's screens are WebSockets straight from the page to the server.
// The page isn't served by the server, so the browser would send neither the
// sign-in cookie (it's SameSite) nor an Origin the server accepts. Add both,
// for the configured server's /api/ sockets only.
function signScreenSockets() {
  session.defaultSession.webRequest.onBeforeSendHeaders(async (details, callback) => {
    try {
      if (!settings.serverUrl || !/^wss?:/.test(details.url)) return callback({});
      const server = new URL(settings.serverUrl);
      const url = new URL(details.url);
      if (url.host !== server.host || !url.pathname.startsWith('/api/')) return callback({});
      const cookies = await session.defaultSession.cookies.get({ url: settings.serverUrl });
      const requestHeaders = { ...details.requestHeaders, Origin: server.origin };
      if (cookies.length) requestHeaders.Cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      callback({ requestHeaders });
    } catch {
      callback({});
    }
  });
}

// While a remote screen has the keyboard, Ctrl+R, Ctrl+W and the like go to
// the remote computer instead of reloading or closing the app.
ipcMain.on('keys:capture', (event, on) => {
  event.sender.setIgnoreMenuShortcuts(Boolean(on));
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#021d2e',
    title: 'Cubecrusher',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Links to other sites open in the browser, not inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(process.env.VITE_DEV_URL || 'file://')) event.preventDefault();
  });

  if (process.env.VITE_DEV_URL) win.loadURL(process.env.VITE_DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(async () => {
  await loadSettings();
  signScreenSockets();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
