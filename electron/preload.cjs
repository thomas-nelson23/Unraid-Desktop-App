const { contextBridge, ipcRenderer } = require('electron');

// Electron prefixes a rejected call's message with the channel; the page
// only wants the reason.
const clean = (err) => {
  throw new Error(String(err?.message || err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
};
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args).catch(clean);
const call = (channel) => (...args) => invoke(channel, ...args);
const listen = (channel) => (fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('cubecrusher', {
  platform: process.platform,
  request: (method, path, body) => invoke('api:request', { method, path, body }),
  getSettings: call('settings:get'),
  setSettings: call('settings:set'),
  openExternal: call('open:external'),
  captureKeys: (on) => ipcRenderer.send('keys:capture', on),
  hermes: {
    list: call('hermes:list'),
    test: call('hermes:test'),
    save: (instances, current) => invoke('hermes:save', { instances, current }),
    setCurrent: call('hermes:setCurrent'),
    status: call('hermes:status'),
    sessions: call('hermes:sessions'),
    session: call('hermes:session'),
    messages: call('hermes:messages'),
    createSession: call('hermes:createSession'),
    deleteSession: call('hermes:deleteSession'),
    models: call('hermes:models'),
    chat: (id, message) => invoke('hermes:chat', { id, message }),
    stop: call('hermes:stop'),
    approve: call('hermes:approve'),
    onEvent: listen('hermes:event'),
  },
  docker: {
    servers: call('docker:servers'),
    saveServers: call('docker:saveServers'),
    containers: call('docker:containers'),
    stats: call('docker:stats'),
    logs: (server, id, tail, name) => invoke('docker:logs', { server, id, tail, name }),
    action: (server, id, action) => invoke('docker:action', { server, id, action }),
    test: call('docker:test'),
  },
  unraid: {
    check: call('unraid:check'),
    test: call('unraid:test'),
    save: call('unraid:save'),
    server: call('unraid:server'),
  },
  weather: {
    get: call('weather:get'),
    search: call('weather:search'),
    setPlace: call('weather:setPlace'),
  },
  updates: {
    running: call('updates:running'),
    check: call('updates:check'),
    branches: call('updates:branches'),
    latest: call('updates:latest'),
    install: call('updates:install'),
    cancel: call('updates:cancel'),
    busy: call('updates:busy'),
    onProgress: listen('updates:progress'),
    onAvailable: listen('updates:available'),
  },
});
