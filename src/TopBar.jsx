import { bytes, gb, pct } from './lib/format.js';

function Meter({ label, value, fill }) {
  return (
    <span className="mm" title={label}>
      {label}
      <span className="mb">
        <i style={{ width: `${fill}%` }} />
      </span>
      <b>{value}</b>
    </span>
  );
}

const STATUS = {
  live: { text: 'CUBECRUSHER · ONLINE', led: 'on' },
  signin: { text: 'CUBECRUSHER · SIGN IN', led: 'bad' },
  offline: { text: "CUBECRUSHER · CAN'T REACH", led: 'bad' },
  none: { text: 'SAMPLE DATA · CONNECT', led: '' },
};

export default function TopBar({ conn, server, onConnect, children }) {
  const key = conn.state === 'demo' ? conn.reason : conn.state;
  const status = STATUS[key] ?? STATUS.none;
  const host = server?.host;
  const gpu = host?.gpus?.[0];
  const array = host?.disks?.find((d) => d.label === 'Array') ?? host?.disks?.[0];
  return (
    <header className="top">
      <button className="lcd status" onClick={onConnect} title="Server connection">
        <span className={`led ${status.led}`} />
        {status.text}
      </button>
      {host && (
        <>
          <Meter label="CPU" fill={host.cpu} value={`${Math.round(host.cpu)}%`} />
          <Meter label="RAM" fill={pct(host.memory.used, host.memory.total)} value={gb(host.memory.used)} />
          {gpu && <Meter label="GPU" fill={gpu.util ?? 0} value={`${Math.round(gpu.util ?? 0)}%`} />}
          {gpu?.memTotal ? <Meter label="VRAM" fill={pct(gpu.memUsed, gpu.memTotal)} value={gb(gpu.memUsed)} /> : null}
          {array && <Meter label="ARRAY" fill={pct(array.used, array.total)} value={bytes(array.used, { si: true })} />}
        </>
      )}
      <span className="spacer" />
      {children}
    </header>
  );
}
