const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('node:path');
const settings = require('./settings.cjs');
const dashboard = require('./dashboard.cjs');
const hermes = require('./hermes.cjs');
const docker = require('./docker.cjs');
const updates = require('./updates.cjs');

let win = null;

function cleanServerUrl(raw) {
  const url = new URL(String(raw || '').trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The address has to start with http:// or https://');
  return url.origin;
}

ipcMain.handle('api:request', (_event, req) => dashboard.request(req));
ipcMain.handle('settings:get', () => settings.forPage());
ipcMain.handle('settings:set', async (_event, next) => {
  const serverUrl = next.serverUrl ? cleanServerUrl(next.serverUrl) : '';
  await settings.update({ serverUrl });
  return settings.forPage();
});
ipcMain.handle('open:external', (_event, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});
hermes.register(ipcMain, () => win);
docker.register(ipcMain);
updates.register(ipcMain, () => win);

// The VMs page's screens are WebSockets straight from the page to the server.
// The page isn't served by the server, so the browser would send neither the
// sign-in cookie (it's SameSite) nor an Origin the server accepts. Add both,
// for the configured server's /api/ sockets only.
function signScreenSockets() {
  session.defaultSession.webRequest.onBeforeSendHeaders(async (details, callback) => {
    try {
      const { serverUrl } = settings.get();
      if (!serverUrl || !/^wss?:/.test(details.url)) return callback({});
      const server = new URL(serverUrl);
      const url = new URL(details.url);
      if (url.host !== server.host || !url.pathname.startsWith('/api/')) return callback({});
      const cookies = await session.defaultSession.cookies.get({ url: serverUrl });
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
  win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#021d2e',
    title: 'Cubecrusher',
    // Window and taskbar icon on Windows and Linux; macOS takes the dock icon from the app bundle.
    icon: path.join(__dirname, 'icon.png'),
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
  win.on('closed', () => {
    win = null;
  });

  if (process.env.VITE_DEV_URL) win.loadURL(process.env.VITE_DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(async () => {
  await settings.load();
  signScreenSockets();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
