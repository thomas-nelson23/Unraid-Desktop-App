import { bytes, gb, pct } from './lib/format.js';

// One reading in the top bar: a wider bar whose colour says how close to the
// limit it is (cyan is fine, brass is getting full, red is nearly full),
// the number, and what it's out of.
function Readout({ label, fill, value, of, hot = 90, warm = 75 }) {
  const level = fill >= hot ? ' hot' : fill >= warm ? ' warm' : '';
  return (
    <span className={`rd${level}`} title={`${label}: ${value}${of ? ` of ${of}` : ''}`}>
      <span className="rd-label">{label}</span>
      <span className="rd-bar">
        <i style={{ width: `${Math.max(2, fill)}%` }} />
      </span>
      <span className="rd-num">
        <b>{value}</b>
        {of && <small>/ {of}</small>}
      </span>
    </span>
  );
}

const STATUS = {
  live: { text: 'ONLINE', led: 'on' },
  dashboard: { text: 'VIA DASHBOARD', led: 'on' },
  signin: { text: 'SIGN IN', led: 'bad' },
  offline: { text: "CAN'T REACH", led: 'bad' },
  none: { text: 'SAMPLE DATA', led: '' },
};

// The light says how the app reaches Cubecrusher: straight through Unraid's
// API, or through the dashboard, or not at all.
function statusOf(conn) {
  if (conn.server?.state === 'live') return STATUS.live;
  if (conn.dashboard?.state === 'live') return STATUS.dashboard;
  if (conn.state === 'signin') return STATUS.signin;
  return conn.reason === 'offline' ? STATUS.offline : STATUS.none;
}

// A newer build of the app, one click from installed. While it installs the
// pill shows how far along it is; if that fails it says so and opens Settings.
function UpdatePill({ updater, onPage }) {
  const { available, progress, error, note, install } = updater;
  if (!available && !progress && !error && !note) return null;
  if (progress) {
    return (
      <span className="lcd update busy" title={progress.text}>
        <span className="led on" />
        {progress.pct != null ? `UPDATING · ${progress.pct}%` : 'UPDATING…'}
        {progress.pct != null && <i style={{ width: `${progress.pct}%` }} />}
      </span>
    );
  }
  if (error) {
    return (
      <button className="lcd update failed" onClick={() => onPage('settings')} title={error}>
        <span className="led bad" />
        UPDATE FAILED · DETAILS
      </button>
    );
  }
  if (note) {
    return (
      <button className="lcd update" onClick={() => onPage('settings')} title={note}>
        <span className="led ok" />
        UPDATE DOWNLOADED · DETAILS
      </button>
    );
  }
  if (!available) return null;
  return (
    <button className="lcd update" onClick={() => install(available.branch)} title={`${available.title}\n${available.notes || ''}\nClick to install and restart.`}>
      <span className="led on" />
      UPDATE READY · {available.sha.slice(0, 7)}
    </button>
  );
}

export default function TopBar({ conn, server, updater, onConnect, onPage, children }) {
  const status = statusOf(conn);
  const host = server?.host;
  const gpu = host?.gpus?.[0];
  const array = host?.disks?.find((d) => d.label === 'Array') ?? host?.disks?.[0];
  const cache = host?.disks?.find((d) => /cache/i.test(d.label));
  return (
    <header className="top">
      <button className="lcd status" onClick={onConnect} title={conn.error || (conn.server?.state === 'live' ? `Unraid ${conn.server.unraid || ''} at ${conn.server.url}` : 'Server connection')}>
        <span className={`led ${status.led}`} />
        CUBECRUSHER · {status.text}
      </button>
      {host && (
        <div className="readouts">
          <Readout label="CPU" fill={host.cpu} value={`${Math.round(host.cpu)}%`} hot={95} warm={80} />
          <Readout label="RAM" fill={pct(host.memory.used, host.memory.total)} value={gb(host.memory.used)} of={gb(host.memory.total)} />
          {gpu && <Readout label="GPU" fill={gpu.util ?? 0} value={`${Math.round(gpu.util ?? 0)}%`} of={gpu.temp != null ? `${Math.round(gpu.temp)}°C` : undefined} hot={101} warm={101} />}
          {gpu?.memTotal ? <Readout label="VRAM" fill={pct(gpu.memUsed, gpu.memTotal)} value={gb(gpu.memUsed)} of={gb(gpu.memTotal)} /> : null}
          {array && <Readout label="ARRAY" fill={pct(array.used, array.total)} value={bytes(array.used, { si: true })} of={bytes(array.total, { si: true })} hot={95} warm={85} />}
          {cache && <Readout label="CACHE" fill={pct(cache.used, cache.total)} value={bytes(cache.used, { si: true })} of={bytes(cache.total, { si: true })} />}
        </div>
      )}
      <span className="spacer" />
      {updater && <UpdatePill updater={updater} onPage={onPage} />}
      {children}
    </header>
  );
}
