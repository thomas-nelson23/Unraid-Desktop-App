const { app, BrowserWindow, ipcMain, shell } = require('electron');
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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
