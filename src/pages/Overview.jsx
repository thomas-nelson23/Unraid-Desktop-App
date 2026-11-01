import { useMemo, useState } from 'react';
import { bytes, pct } from '../lib/format.js';
import { askChips, byAttention, diskSuggestions, forecast, lane, summary, TONE, verdicts } from '../lib/overview.js';
import { demoArrayHistory, demoArraySuggestions, demoDisks, demoLanes, demoMoments, demoUpcoming } from '../lib/demo.js';
import './overview.css';

// Design option 4 ("Story"): the server's state in words first, then the
// last 24 hours, then what's coming. Array & disks is the second tab.
export const OVERVIEW_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'array', label: 'Array & disks' },
];

const tb = (n) => bytes(n, { si: true });
const monthYear = (ms) => new Date(ms).toLocaleDateString([], { month: 'short', year: 'numeric' });
const LANES = [
  { id: 'cpu', label: 'CPU', color: '0, 229, 255' },
  { id: 'gpu', label: 'GPU', color: '255, 43, 214' },
  { id: 'ram', label: 'RAM', color: '92, 156, 255' },
];

function span(ms) {
  const m = Math.round(ms / 60e3);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

function Mark({ tone }) {
  return <span className="ov-mark" style={{ '--k': TONE[tone] }} />;
}

function Lead({ children }) {
  return <p className="ov-lead">{children}</p>;
}

function Ask({ chips, onAsk }) {
  const [text, setText] = useState('');
  const send = (e) => {
    e.preventDefault();
    if (text.trim()) onAsk(text.trim());
  };
  return (
    <section className="card ov-askcard">
      <h3 className="h3">Ask about the server</h3>
      <form className="ask" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Why was the GPU busy last night?" aria-label="Ask Hermes about the server" />
        <button className="btn md primary" disabled={!text.trim()}>
          Ask
        </button>
      </form>
      <div className="chips">
        {chips.map((q) => (
          <button key={q} className="chip" style={{ '--k': 'var(--cyan)' }} onClick={() => onAsk(q)}>
            <i />
            {q}
          </button>
        ))}
      </div>
    </section>
  );
}

function Timeline({ lanes, moments, title, note }) {
  return (
    <section className="card ov-timeline">
      <div className="card-head">
        <h3 className="h3">{title}</h3>
        <span className="eyebrow">{note}</span>
      </div>
      <div className="ov-scroll">
        <div className="ov-lanes">
          {lanes.map((l) => (
            <div className="ov-lane" key={l.id}>
              <span className="eyebrow">{l.label}</span>
              <div className="ov-cells">
                {l.cells.map((v, i) => (
                  <span key={i} className={v == null ? 'empty' : undefined} style={v == null ? undefined : { background: `rgba(${l.color}, ${(0.05 + v * 0.85).toFixed(2)})` }} />
                ))}
              </div>
            </div>
          ))}
          {moments.length > 0 && (
            <div className="ov-lane">
              <span />
              <div className="ov-pins">
                {moments.map((m) => (
                  <span key={m.label} className={`ov-pin${m.mag ? ' mag' : ''}`} style={{ left: `${m.at * 100}%` }}>
                    <span className="mono soft">{m.time}</span>
                    {m.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function SystemTab({ sample, host, history, onAsk }) {
  const list = useMemo(() => verdicts(host), [host]);
  const { head, rest } = summary(list);
  const lastAt = history.at(-1)?.at;
  const timeline = useMemo(() => {
    const now = Date.now();
    if (sample) return { lanes: demoLanes(), title: 'Last 24 hours', note: 'Sample · brighter is busier' };
    if (history.length < 2) return null;
    const from = history[0].at;
    const lanes = LANES.filter((l) => history.some((s) => s[l.id] != null)).map((l) => ({ ...l, cells: lane(history, l.id, { from, to: now }) }));
    return { lanes, title: `Last ${span(now - from)}`, note: 'Since the app opened · brighter is busier' };
  }, [sample, history, lastAt]);

  return (
    <div className="hbody">
      <section className="card ov-story">
        <Lead>
          Cubecrusher is <b>{head}</b>. {rest}
        </Lead>
        <div className="ov-verdicts">
          {list.map((v) => (
            <div className="ov-verdict" key={v.id}>
              <span className="eyebrow">
                <Mark tone={v.tone} />
                {v.name}
              </span>
              <b>{v.state}</b>
              <span className="dim small">{v.why}</span>
            </div>
          ))}
        </div>
      </section>
      {timeline ? (
        <Timeline lanes={timeline.lanes} moments={sample ? demoMoments : []} title={timeline.title} note={timeline.note} />
      ) : (
        <section className="card ov-timeline">
          <h3 className="h3">Last 24 hours</h3>
          <p className="dim small">Collecting readings. The lanes fill in while the app is open.</p>
        </section>
      )}
      <div className="hrow">
        <Ask chips={sample ? ["What's using the most RAM?", 'Is Disk 6 safe to keep?', 'Move renders before parity'] : askChips(list)} onAsk={onAsk} />
        <section className="card ov-upcoming">
          <h3 className="h3">Coming up</h3>
          {sample ? (
            <div className="ov-list">
              {demoUpcoming.map((u) => (
                <div className="ov-li" key={u.what}>
                  <span className="mono ov-time">{u.time}</span>
                  <span>{u.what}</span>
                  <span className="dim">{u.where}</span>
                </div>
              ))}
            </div>
          ) : host?.array?.parity?.running || host?.array?.parity?.paused ? (
            <div className="ov-list">
              <div className="ov-li">
                <span className="mono ov-time">{host.array.parity.progress != null ? `${Math.round(host.array.parity.progress)}%` : 'now'}</span>
                <span>Parity check {host.array.parity.paused ? 'paused' : 'running'}</span>
                <span className="dim">{[host.array.parity.speed, host.array.parity.errors ? `${host.array.parity.errors} errors` : null].filter(Boolean).join(' · ')}</span>
              </div>
            </div>
          ) : (
            <p className="dim small">
              {host?.array?.state && host.array.state !== 'STARTED' ? `The array is ${host.array.state.toLowerCase().replace(/_/g, ' ')}. ` : ''}
              Parity checks, the mover and backups will show here once the app reads Unraid's schedules.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function Forecast({ series, total, fc }) {
  const max = total * 1.02;
  const bars = series.map((p, i) => ({ h: pct(p.used, max), now: i === series.length - 1, title: `${monthYear(p.at)} · ${tb(p.used)}` }));
  const last = series.at(-1);
  if (fc?.fullAt) {
    const months = Math.min(24, Math.ceil((fc.fullAt - last.at) / (30.44 * 86400e3)));
    for (let i = 1; i <= months; i++) {
      const used = Math.min(total, last.used + fc.perMonth * i);
      bars.push({ h: pct(used, max), future: true, title: `Projected · ${tb(used)}` });
    }
  }
  return (
    <>
      <div className="ov-forecast" role="img" aria-label={`Array use by month${fc?.fullAt ? `, projected full around ${monthYear(fc.fullAt)}` : ''}`}>
        <span className="ov-cap" style={{ bottom: `${pct(total, max)}%` }} />
        {bars.map((b, i) => (
          <span key={i} title={b.title} className={b.future ? 'future' : b.now ? 'now' : undefined} style={{ height: `${b.h}%` }} />
        ))}
      </div>
      <div className="ov-axis mono dim small">
        <span>{monthYear(series[0].at)}</span>
        <span>Now</span>
        {fc?.fullAt && <span>{monthYear(fc.fullAt)} · full</span>}
      </div>
    </>
  );
}

function ArrayTab({ sample, host, onAsk }) {
  const disks = sample ? demoDisks : (host?.disks ?? []);
  const array = sample ? { used: 38.2e12, total: 50e12 } : (disks.find((d) => d.label === 'Array') ?? disks[0]);
  const series = sample ? demoArrayHistory() : null;
  const fc = series && array ? forecast(series, array.total) : null;
  const suggestions = sample ? demoArraySuggestions : diskSuggestions(disks);
  // The array row is the lead line above, not a disk.
  const ranked = byAttention(disks.filter((d) => d.role !== 'array'));

  return (
    <div className="hbody">
      <section className="card ov-story">
        {array ? (
          <Lead>
            The array is <b>{tb(array.used)} of {tb(array.total)}</b>
            {fc?.fullAt ? (
              <>
                {' '}
                and growing about <b>{tb(fc.perMonth)} a month</b>. At that rate it's full around <b>{monthYear(fc.fullAt)}</b>.
              </>
            ) : (
              '.'
            )}{' '}
            {sample ? 'Parity is valid and every disk passes SMART.' : host?.array?.parity?.running ? `A parity check is ${Math.round(host.array.parity.progress ?? 0)}% through.` : 'A growth forecast needs a usage history, which the app will keep in a later build.'}
          </Lead>
        ) : (
          <Lead>The server hasn't reported its disks yet.</Lead>
        )}
        {series && array && <Forecast series={series} total={array.total} fc={fc} />}
      </section>
      <div className="hrow">
        <section className="card ov-suggest">
          <h3 className="h3">{sample ? 'Hermes suggests' : 'Suggestions'}</h3>
          {suggestions.length === 0 ? (
            <p className="dim small">Nothing to do. Every disk has room.</p>
          ) : (
            suggestions.map((s) => (
              <div className="ov-verdict row-item" key={s.id}>
                <Mark tone={s.tone} />
                <div>
                  <b>{s.title}</b>
                  <span className="dim small">{s.body}</span>
                </div>
                <button className="btn md" onClick={() => onAsk(s.ask)}>
                  Ask Hermes
                </button>
              </div>
            ))
          )}
        </section>
        <section className="card ov-disks">
          <h3 className="h3">Disks by attention</h3>
          <div className="ov-list">
            {ranked.map((d) => {
              const p = pct(d.used, d.total);
              const tone = d.role === 'parity' ? 'busy' : p >= 90 ? 'watch' : d.role === 'pool' ? null : 'calm';
              return (
                <div className="ov-li ov-disk" key={d.label}>
                  <b>{d.label}</b>
                  <span>
                    <span className="ov-bar">
                      <i style={{ width: `${p}%`, background: tone ? TONE[tone] : 'var(--ch-slate)' }} />
                    </span>
                    <span className="dim small">{d.note ?? (d.role === 'parity' ? `${tb(d.total)} · ${d.status === 'DISK_OK' ? 'valid' : d.status || ''}` : `${tb(d.used)} of ${tb(d.total)}`)}</span>
                  </span>
                  <span className="mono soft">{d.temp != null ? `${Math.round(d.temp)} °C` : d.used == null ? '' : `${Math.round(p)}%`}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function Overview({ conn, server, history, tab, onTab, onAsk }) {
  const sample = conn.state !== 'live';
  const host = server?.host;
  // Sample mode reads the sample disks one by one, as the per-disk view will.
  const shown = useMemo(() => (sample && host ? { ...host, disks: demoDisks.filter((d) => d.role !== 'parity') } : host), [sample, host]);
  return (
    <div className="overview-page">
      <div className="ph">
        <div>
          <span className="eyebrow c">Server{sample ? ' · sample data' : ''}</span>
          <h1>Overview</h1>
        </div>
        <div className="chips">
          <button className="btn md" disabled title="Power actions need the dashboard to support them">
            Reboot
          </button>
          <button className="btn md" disabled title="Power actions need the dashboard to support them">
            Shut down
          </button>
        </div>
      </div>
      <nav className="tabs" aria-label="Overview views">
        {OVERVIEW_TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'cur' : undefined} aria-current={tab === t.id ? 'page' : undefined} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'array' ? <ArrayTab sample={sample} host={host} onAsk={onAsk} /> : <SystemTab sample={sample} host={shown} history={history} onAsk={onAsk} />}
    </div>
  );
}
