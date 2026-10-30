import { useCallback, useEffect, useMemo, useState } from 'react';
import { desktop, openExternal, usePoll } from '../lib/api.js';
import { bytes } from '../lib/format.js';
import { demoContainers } from '../lib/demo.js';

const STATE_TONE = { running: 'on', paused: 'warm', exited: '', dead: 'bad', created: '', restarting: 'warm' };

// A container's light: green-cyan running, dim stopped, red when its health
// check fails.
function Light({ c }) {
  const tone = c.health === 'unhealthy' ? 'bad' : (STATE_TONE[c.state] ?? '');
  return <span className={`led ${tone}`} title={c.status} />;
}

function Row({ c, stat, server, busy, onAction, onLogs, selected, onSelect }) {
  const running = c.state === 'running';
  const can = server.kind === 'ssh';
  const ip = c.networks?.find((n) => n.ip)?.ip;
  return (
    <div className={`ct${selected ? ' cur' : ''}`} onClick={() => onSelect(c)}>
      <Light c={c} />
      <div className="ct-name">
        <b>{c.displayName || c.name}</b>
        <span className="dim small mono">{c.image}</span>
      </div>
      <span className="ct-state small">
        <span className={c.health === 'unhealthy' ? 'err' : running ? 'soft' : 'dim'}>{c.status}</span>
      </span>
      <span className="ct-num mono small">{stat ? `${stat.cpu.toFixed(1)}%` : '—'}</span>
      <span className="ct-num mono small">{stat ? bytes(stat.memory.used) : '—'}</span>
      <span className="ct-ip mono small dim">{c.networkMode === 'host' ? 'host' : ip || '—'}</span>
      <div className="ct-acts" onClick={(e) => e.stopPropagation()}>
        {c.webui && (
          <button className="btn md quiet" onClick={() => openExternal(c.webui)} title={c.webui}>
            WebUI
          </button>
        )}
        <button className="btn md quiet" onClick={() => onLogs(c)} disabled={!can} title={can ? 'Last 300 lines' : 'Logs need SSH access'}>
          Logs
        </button>
        {running ? (
          <>
            <button className="btn md" onClick={() => onAction(c, 'restart')} disabled={!can || busy}>
              Restart
            </button>
            <button className="btn md" onClick={() => onAction(c, 'stop')} disabled={!can || busy}>
              Stop
            </button>
          </>
        ) : (
          <button className="btn md primary" onClick={() => onAction(c, c.state === 'paused' ? 'unpause' : 'start')} disabled={!can || busy}>
            {c.state === 'paused' ? 'Resume' : 'Start'}
          </button>
        )}
      </div>
    </div>
  );
}

function Logs({ server, c, onClose }) {
  const [state, setState] = useState({ text: null, error: null });
  const fetchLogs = useCallback(() => {
    setState({ text: null, error: null });
    desktop.docker
      .logs(server.id, c.id, 300)
      .then((text) => setState({ text, error: null }))
      .catch((err) => setState({ text: null, error: err.message }));
  }, [server.id, c.id]);
  useEffect(fetchLogs, [fetchLogs]);
  return (
    <section className="card logs">
      <div className="card-head">
        <h3 className="h4">
          {c.displayName || c.name} <span className="dim">· last 300 lines</span>
        </h3>
        <div className="chips">
          <button className="btn md quiet" onClick={fetchLogs}>
            Refresh
          </button>
          <button className="btn md quiet" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {state.error && <p className="err">{state.error}</p>}
      {state.text == null && !state.error && <p className="dim small">Reading…</p>}
      {state.text != null && <pre className="logtext">{state.text.trim() || 'No output yet.'}</pre>}
    </section>
  );
}

// Which servers show, and how their containers are fetched: through the
// desktop bridge, or the dashboard API alone in a browser, or samples.
function useServers(live) {
  const [servers, setServers] = useState([]);
  const reload = useCallback(async () => {
    if (desktop) setServers(await desktop.docker.servers());
    else setServers([{ id: 'cubecrusher', name: 'Cubecrusher', kind: 'dashboard' }]);
  }, []);
  useEffect(() => {
    reload();
  }, [reload, live]);
  return { servers, reload };
}

export default function Docker({ conn, onPage }) {
  const live = conn.state === 'live';
  const { servers } = useServers(live);
  const [serverId, setServerId] = useState('cubecrusher');
  const server = servers.find((s) => s.id === serverId) || servers[0] || { id: 'cubecrusher', name: 'Cubecrusher', kind: 'dashboard' };
  const demo = server.kind === 'dashboard' && !live;
  const [tick, setTick] = useState(0);
  const [data, setData] = useState({ containers: null, error: null });
  const [stats, setStats] = useState({});
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState('all');
  const [busy, setBusy] = useState(null);
  const [logsFor, setLogsFor] = useState(null);
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState(null);

  // Containers come through the bridge for any server; the dashboard poll is
  // the browser fallback.
  const dashPoll = usePoll('/api/containers', { enabled: !desktop && live && server.kind === 'dashboard', every: 15000 });
  useEffect(() => {
    if (demo) {
      setData({ containers: demoContainers, error: null });
      return undefined;
    }
    if (!desktop) {
      setData({ containers: dashPoll.data?.containers ?? null, error: dashPoll.error?.message ?? null });
      return undefined;
    }
    let alive = true;
    const run = () =>
      desktop.docker
        .containers(server.id)
        .then((containers) => alive && setData({ containers, error: null }))
        .catch((err) => alive && setData((d) => ({ containers: d.containers, error: err.message })));
    // (a later failure keeps the last good list; a new server starts empty)
    run();
    const timer = setInterval(run, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [server.id, demo, tick, dashPoll.data, dashPoll.error]);

  useEffect(() => {
    if (demo || !desktop) return undefined;
    let alive = true;
    const run = () => desktop.docker.stats(server.id).then((s) => alive && setStats(s)).catch(() => {});
    run();
    const timer = setInterval(run, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [server.id, demo]);

  // A different server means a fresh list.
  useEffect(() => {
    setLogsFor(null);
    setSelected(null);
    setNotice(null);
    setStats({});
    setData({ containers: null, error: null });
  }, [server.id]);

  const act = async (c, action) => {
    setBusy(c.id);
    setNotice(null);
    try {
      await desktop.docker.action(server.id, c.id, action);
      setNotice({ ok: true, text: `${c.displayName || c.name}: ${action} done.` });
      setTick((t) => t + 1);
    } catch (err) {
      setNotice({ ok: false, text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data.containers ?? [])
      .filter((c) => (only === 'all' ? true : only === 'running' ? c.state === 'running' : c.state !== 'running'))
      .filter((c) => !q || [c.name, c.displayName, c.image, ...(c.networks ?? []).map((n) => n.ip)].some((v) => v && String(v).toLowerCase().includes(q)))
      .sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name));
  }, [data.containers, query, only]);
  const all = data.containers ?? [];
  const running = all.filter((c) => c.state === 'running').length;
  const unhealthy = all.filter((c) => c.health === 'unhealthy').length;

  return (
    <div className="docker-page">
      <div className="ph">
        <div>
          <span className="eyebrow c">Docker · {server.name}</span>
          <h1>Containers</h1>
        </div>
        <div className="chips">
          <input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name, image or IP" aria-label="Filter containers" />
          <div className="loop seg3" role="radiogroup" aria-label="Show">
            {['all', 'running', 'stopped'].map((o) => (
              <button key={o} role="radio" aria-checked={only === o} className={only === o ? 'on' : undefined} onClick={() => setOnly(o)}>
                {o}
              </button>
            ))}
          </div>
        </div>
      </div>
      <nav className="tabs servers" aria-label="Servers">
        {servers.map((s) => (
          <button key={s.id} className={s.id === server.id ? 'cur' : undefined} onClick={() => setServerId(s.id)}>
            {s.name}
            {s.kind === 'dashboard' && <span className="dim"> · read only</span>}
          </button>
        ))}
        <button className="add" onClick={() => onPage('settings')}>
          + Add server
        </button>
      </nav>
      <div className="hbody">
        <div className="feedhead">
          <span className="soft">
            {all.length ? `${running} of ${all.length} running${unhealthy ? ` · ${unhealthy} unhealthy` : ''}` : data.error ? 'Unavailable' : 'Loading…'}
          </span>
          <span className="eyebrow">
            {demo ? 'Sample' : server.kind === 'dashboard' ? 'Through the dashboard · add Cubecrusher over SSH to start and stop' : `SSH · ${server.user}@${server.host}`}
          </span>
        </div>
        {data.error && <p className="err">{data.error}</p>}
        {notice && <p className={notice.ok ? 'ok' : 'err'}>{notice.text}</p>}
        {logsFor && <Logs server={server} c={logsFor} onClose={() => setLogsFor(null)} />}
        <section className="card ctlist">
          <div className="ct head" aria-hidden="true">
            <span />
            <span>Application</span>
            <span>State</span>
            <span className="ct-num">CPU</span>
            <span className="ct-num">Memory</span>
            <span className="ct-ip">IP</span>
            <span />
          </div>
          {list.map((c) => (
            <Row key={c.id} c={c} stat={c.state === 'running' ? stats[c.name] : null} server={server} busy={busy === c.id} onAction={act} onLogs={setLogsFor} selected={selected === c.id} onSelect={(x) => setSelected(x.id === selected ? null : x.id)} />
          ))}
          {!list.length && all.length > 0 && <p className="dim none">Nothing matches.</p>}
        </section>
        {selected && (() => {
          const c = all.find((x) => x.id === selected);
          if (!c) return null;
          return (
            <section className="card detail">
              <div className="card-head">
                <h3 className="h4">{c.displayName || c.name}</h3>
                <span className="eyebrow">{c.id}</span>
              </div>
              <dl className="kv">
                <dt>Image</dt>
                <dd>{c.image}</dd>
                <dt>Network</dt>
                <dd>{c.networkMode}{(c.networks ?? []).filter((n) => n.ip).map((n) => ` · ${n.name} ${n.ip}`)}</dd>
                <dt>Ports</dt>
                <dd>{(c.ports ?? []).length ? c.ports.map((p) => `${p.public ? `${p.public}→` : ''}${p.private}/${p.proto}`).join(', ') : '—'}</dd>
                <dt>Web UI</dt>
                <dd>{c.webui || '—'}</dd>
                {c.restartPolicy && (
                  <>
                    <dt>Restart</dt>
                    <dd>{c.restartPolicy}</dd>
                  </>
                )}
              </dl>
            </section>
          );
        })()}
      </div>
    </div>
  );
}
