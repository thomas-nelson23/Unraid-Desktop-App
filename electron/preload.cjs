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
  hermes: {
    list: call('hermes:list'),
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
    logs: (server, id, tail) => invoke('docker:logs', { server, id, tail }),
    action: (server, id, action) => invoke('docker:action', { server, id, action }),
    test: call('docker:test'),
  },
  updates: {
    setToken: call('updates:setToken'),
    branches: call('updates:branches'),
    latest: call('updates:latest'),
    install: call('updates:install'),
    onProgress: listen('updates:progress'),
  },
});
