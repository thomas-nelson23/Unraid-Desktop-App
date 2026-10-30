// Helpers for the VMs page: a VM's screen (VNC, through the dashboard) and a
// computer's desktop (RDP, through guacd). Both are WebSockets to the
// dashboard server; in Electron the main process adds the sign-in cookie and
// the Origin the server checks for.

// The WebSocket address for an /api/... path on the server.
export function socketUrl(serverUrl, path) {
  const base = serverUrl || (typeof location !== 'undefined' ? location.origin : '');
  return base.replace(/^http/, 'ws').replace(/\/+$/, '') + path;
}

const memoryText = (mb) => (mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10} GB` : `${mb} MB`);

// One row of the list on either tab, from what the server sends.
export function vmTarget(vm) {
  const meta = vm.problem
    ? 'No screen'
    : vm.running
      ? [vm.cpus && `${vm.cpus} vCPU`, vm.memoryMb && memoryText(vm.memoryMb), vm.kind === 'manual' && `${vm.host}:${vm.port}`].filter(Boolean).join(' · ') || 'Running'
      : 'Off';
  let why = null;
  if (vm.problem) why = vm.problem;
  else if (!vm.running) why = vm.kind === 'manual' ? `Nothing answers at ${vm.host}:${vm.port}.` : `${vm.name} is off. Start it in Unraid and its screen shows up here.`;
  return { id: vm.id, name: vm.name, on: Boolean(vm.running), warn: Boolean(vm.problem), meta, canConnect: Boolean(vm.running && !vm.problem), why, password: vm.password };
}

export function rdpTarget(c) {
  return {
    id: c.id,
    name: c.name,
    on: Boolean(c.awake),
    warn: false,
    meta: `${c.protocol.toUpperCase()} · ${c.host}${c.port === (c.protocol === 'rdp' ? 3389 : 5900) ? '' : `:${c.port}`}`,
    // guacd tries even when nothing answered the last check: it may have
    // just woken up.
    canConnect: true,
    why: null,
    wakeable: Boolean(c.mac) && !c.awake,
    host: c.host,
    port: c.port,
    protocol: c.protocol,
    raw: c,
  };
}

// What went wrong, in words, from a Guacamole status code.
export function explainGuac(status, target) {
  const code = status?.code;
  const msg = status?.message && !/^\d+$/.test(status.message) ? status.message : '';
  if (code === 0x0301 || code === 0x0303 || code === 0x031d) return `${target.name} turned down the sign-in. Check the username and password.`;
  if (code === 0x0207 || code === 0x0208 || code === 0x0204) {
    if (msg && /guacd/.test(msg)) return msg;
    return `${target.name} didn't answer at ${target.host}:${target.port}.${target.wakeable ? ' If it’s asleep, press Wake.' : ''}`;
  }
  return msg || `Lost the connection to ${target.name}.`;
}
export const refusedGuac = (status) => [0x0301, 0x0303, 0x031d].includes(status?.code);

// How long to wait before each try to get back a dropped connection.
export const RETRY_MS = [2000, 4000, 8000, 15000, 30000];

// Sample rows for when the app isn't connected, labelled "Sample" on screen.
export const SAMPLE_VMS = [
  { id: 'win11', name: 'Windows 11', running: true, cpus: 8, memoryMb: 16384 },
  { id: 'ubuntu-ai', name: 'Ubuntu AI dev', running: true, cpus: 12, memoryMb: 32768 },
  { id: 'haos', name: 'Home Assistant', running: true, problem: 'This VM has no VNC screen. Set its Graphics Card to VNC in Unraid.' },
  { id: 'macos', name: 'macOS Sequoia', running: false },
].map(vmTarget);

export const SAMPLE_RDP = [
  { id: 'pc-desk', name: 'Gaming PC', protocol: 'rdp', host: '10.1.1.20', port: 3389, awake: true, mac: '3c:7c:3f:12:ab:cd' },
  { id: 'pc-win11', name: 'Windows 11 VM', protocol: 'rdp', host: '10.1.1.31', port: 3389, awake: true },
  { id: 'pc-laptop', name: 'Work laptop', protocol: 'rdp', host: '10.1.1.44', port: 3389, awake: false, mac: '8c:16:45:aa:01:02' },
].map(rdpTarget);
