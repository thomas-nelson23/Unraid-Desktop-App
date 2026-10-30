const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cubecrusher', {
  request: (method, path, body) => ipcRenderer.invoke('api:request', { method, path, body }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (next) => ipcRenderer.invoke('settings:set', next),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  platform: process.platform,
});
