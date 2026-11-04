import { useEffect, useState } from 'react';
import { desktop, usePoll } from '../lib/api.js';
import { ago } from '../lib/format.js';

// eslint-disable-next-line no-undef
const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : { branch: 'dev', sha: '', at: '' };

function Field({ label, children }) {
  return (
    <label className="field">
      <span className="eyebrow">{label}</span>
      {children}
    </label>
  );
}

// Cubecrusher itself, through Unraid's own API: the web UI's address and an
// API key made on the server. SSH (with this computer's keys) covers what the
// API can't: GPU readings, container logs and live container stats.
function Cubecrusher({ conn, saved: savedSettings, onSaved }) {
  const u = savedSettings.unraid || {};
  const [form, setForm] = useState({ url: u.url || '', apiKey: '', insecure: Boolean(u.insecure), sshUser: u.sshUser || 'root', sshPort: u.sshPort || 22 });
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const edit = (patch) => setForm((f) => ({ ...f, ...patch }));
  const server = conn.server || {};

  const test = async () => {
    setBusy(true);
    setError(null);
    setNote('Asking Cubecrusher…');
    try {
      const out = await desktop.unraid.test(form);
      setNote(`${out.hostname || 'It'} answered: Unraid ${out.unraid || '?'}, API ${out.api || '?'}. SSH ${out.ssh.ok ? `works · ${out.ssh.text}` : `not working: ${out.ssh.text}`}`);
    } catch (err) {
      setNote(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const next = await desktop.unraid.save(form);
      onSaved(next);
      setForm((f) => ({ ...f, apiKey: '' }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const state = server.state === 'live' ? 'Connected' : server.state === 'offline' ? "Can't reach" : 'Not set up';

  return (
    <section className="card settings-card">
      <div className="card-head">
        <h3 className="h4">Cubecrusher</h3>
        <span className="pill" style={{ '--k': server.state === 'live' ? 'var(--cyan)' : server.state === 'offline' ? 'var(--red)' : 'var(--text-dim)' }}>
          {state}
        </span>
      </div>
      <p className="soft">
        {server.state === 'live' ? (
          <>
            Talking to <b>{server.hostname}</b> at <span className="mono">{server.url}</span>, Unraid {server.unraid}. The top bar, Overview, Array and containers come straight from here.
          </>
        ) : server.state === 'offline' ? (
          <span className="err">{server.error}</span>
        ) : (
          <>
            The app talks to Unraid's own API. On Cubecrusher, open <b>Settings → Management Access → API Keys</b>, make a key with the <b>admin</b> role, and paste it here.
          </>
        )}
      </p>
      <form className="form" onSubmit={submit}>
        <div className="inst">
          <div className="fields three">
            <Field label="Unraid address">
              <input value={form.url} onChange={(e) => edit({ url: e.target.value })} placeholder="http://192.168.1.10" spellCheck={false} />
            </Field>
            <Field label={u.hasKey ? 'API key (saved)' : 'API key'}>
              <input type="password" value={form.apiKey} onChange={(e) => edit({ apiKey: e.target.value })} placeholder={u.hasKey ? 'Leave empty to keep it' : 'Paste the key'} autoComplete="off" />
            </Field>
            <Field label="SSH user and port">
              <span className="two">
                <input value={form.sshUser} onChange={(e) => edit({ sshUser: e.target.value })} spellCheck={false} />
                <input value={form.sshPort} onChange={(e) => edit({ sshPort: e.target.value })} inputMode="numeric" />
              </span>
            </Field>
          </div>
          <div className="inst-acts">
            <label className="small soft">
              <input type="checkbox" checked={form.insecure} onChange={(e) => edit({ insecure: e.target.checked })} /> Trust its certificate (for an https:// address by IP)
            </label>
            <button type="button" className="btn md quiet" onClick={test} disabled={busy || !form.url}>
              Test
            </button>
            <button className="btn md primary" disabled={busy}>
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
        <p className="dim small">
          SSH uses the keys on this computer, so <span className="mono">ssh {form.sshUser || 'root'}@{(() => { try { return new URL(form.url).hostname; } catch { return 'cubecrusher'; } })()}</span> has to work in a terminal first. Without it the GPU readouts, container logs and per-container CPU and memory stay blank; everything else still works.
        </p>
        {note && <p className="ok">{note}</p>}
        {error && <p className="err">{error}</p>}
      </form>
    </section>
  );
}

// The place the Home card's weather is for, straight from Open-Meteo.
function WeatherPlace({ place, onSaved }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [error, setError] = useState(null);
  const search = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      setFound(await desktop.weather.search(q));
    } catch (err) {
      setError(err.message);
    }
  };
  const pick = async (p) => {
    setError(null);
    try {
      onSaved(await desktop.weather.setPlace({ ...p, units: place?.units || 'fahrenheit' }));
      setFound(null);
      setQ('');
    } catch (err) {
      setError(err.message);
    }
  };
  const units = async (u) => onSaved(await desktop.weather.setPlace({ ...place, units: u }));
  const label = (p) => [p.name, p.region, p.country].filter(Boolean).join(', ');
  return (
    <section className="card settings-card">
      <div className="card-head">
        <h3 className="h4">Weather</h3>
        <span className="eyebrow">{place ? label(place) : 'No place yet'}</span>
      </div>
      <p className="soft">The weather on Home comes straight from Open-Meteo, no account needed. Pick the place to show.</p>
      <form className="form" onSubmit={search}>
        <div className="two">
          <Field label="Find a place">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Austin" />
          </Field>
          {place && (
            <Field label="Units">
              <select value={place.units || 'fahrenheit'} onChange={(e) => units(e.target.value)}>
                <option value="fahrenheit">°F</option>
                <option value="celsius">°C</option>
              </select>
            </Field>
          )}
        </div>
        {found && (
          <div className="chips">
            {found.length ? (
              found.map((p) => (
                <button type="button" key={p.id} className="chip" onClick={() => pick(p)}>
                  {label(p)}
                </button>
              ))
            ) : (
              <span className="dim small">Nothing found.</span>
            )}
          </div>
        )}
        <div className="row-end">
          {place && (
            <button type="button" className="btn md quiet" onClick={() => pick(null).catch(() => {})}>
              Clear
            </button>
          )}
          <button className="btn md" disabled={q.trim().length < 2}>
            Search
          </button>
        </div>
        {error && <p className="err">{error}</p>}
      </form>
    </section>
  );
}

// Each Hermes Agent container the app can talk to. Its API server listens
// on 8642 in the container; the address is wherever that's published.
function HermesInstances({ hermesList, onChanged, live }) {
  const [rows, setRows] = useState(hermesList.instances);
  const [current, setCurrent] = useState(hermesList.current);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [tested, setTested] = useState({});
  const dashboard = usePoll('/api/hermes', { enabled: live });
  const test = async (h) => {
    setTested((t) => ({ ...t, [h.id]: 'Testing…' }));
    try {
      const out = await desktop.hermes.test(h);
      setTested((t) => ({ ...t, [h.id]: `Answered, chats readable${out.model ? ` · ${out.model}` : ''}${out.sentKey ? '' : ' · no key needed'}.` }));
    } catch (err) {
      setTested((t) => ({ ...t, [h.id]: err.message }));
    }
  };
  useEffect(() => {
    setRows(hermesList.instances);
    setCurrent(hermesList.current);
  }, [hermesList]);

  const edit = (i, patch) => setRows((r) => r.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const add = (preset = {}) => setRows((r) => [...r, { id: `new-${Date.now()}`, name: '', url: '', key: '', ...preset }]);
  const remove = (i) => setRows((r) => r.filter((_, j) => j !== i));
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await onChanged(await desktop.hermes.save(rows.map(({ hasKey, ...h }) => h), current));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    }
  };
  const fromDashboard = dashboard.data?.url && !rows.some((h) => h.url === dashboard.data.url) ? dashboard.data : null;

  return (
    <section className="card settings-card">
      <div className="card-head">
        <h3 className="h4">Hermes instances</h3>
        <span className="eyebrow">{rows.length === 1 ? '1 instance' : `${rows.length} instances`}</span>
      </div>
      <p className="soft">Each Hermes Agent container, with the address of its API server and its key. The Hermes page switches between them.</p>
      <form className="form" onSubmit={submit}>
        {rows.map((h, i) => (
          <div className="inst" key={h.id}>
            <div className="fields three">
            <Field label="Name">
              <input value={h.name} onChange={(e) => edit(i, { name: e.target.value })} placeholder="Hermes on Cubecrusher" />
            </Field>
            <Field label="API address">
              <input value={h.url} onChange={(e) => edit(i, { url: e.target.value })} placeholder="http://192.168.1.10:8642/v1" spellCheck={false} />
            </Field>
            <Field label={h.hasKey && h.key === undefined ? 'API key (saved)' : 'API key'}>
              <input type="password" value={h.key ?? ''} onChange={(e) => edit(i, { key: e.target.value })} placeholder={h.hasKey ? 'Leave empty to keep it' : 'Optional'} autoComplete="off" />
            </Field>
            </div>
            <div className="inst-acts">
              <label className="small soft">
                <input type="radio" name="hermes-current" checked={current === h.id} onChange={() => setCurrent(h.id)} /> Use by default
              </label>
              <span className={`small ${tested[h.id]?.startsWith('Answered') ? 'ok' : 'err'}`}>{tested[h.id] || ''}</span>
              <button type="button" className="btn md quiet" onClick={() => test(h)}>
                Test
              </button>
              <button type="button" className="btn md quiet" onClick={() => remove(i)}>
                Remove
              </button>
            </div>
          </div>
        ))}
        <div className="row-end">
          {fromDashboard && (
            <button type="button" className="btn md quiet" onClick={() => add({ name: fromDashboard.container || 'Hermes', url: fromDashboard.url })} title="The one the dashboard on Cubecrusher uses">
              Add the dashboard's ({fromDashboard.container || fromDashboard.url})
            </button>
          )}
          <button type="button" className="btn md" onClick={() => add()}>
            Add instance
          </button>
          <button className="btn md primary">{saved ? 'Saved' : 'Save'}</button>
        </div>
        {error && <p className="err">{error}</p>}
      </form>
    </section>
  );
}

// Machines whose Docker the app manages over SSH, with the keys on this computer.
function DockerServers() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [tested, setTested] = useState({});
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    desktop.docker.servers().then((list) => setRows(list.filter((s) => s.kind === 'ssh')));
  }, []);
  const edit = (i, patch) => setRows((r) => r.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const add = () => setRows((r) => [...r, { id: `new-${Date.now()}`, name: '', host: '', user: 'root', port: 22, kind: 'ssh' }]);
  const remove = (i) => setRows((r) => r.filter((_, j) => j !== i));
  const test = async (s) => {
    setTested((t) => ({ ...t, [s.id]: 'Testing…' }));
    try {
      const { version } = await desktop.docker.test(s);
      setTested((t) => ({ ...t, [s.id]: `Docker ${version} answered.` }));
    } catch (err) {
      setTested((t) => ({ ...t, [s.id]: err.message }));
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const list = await desktop.docker.saveServers(rows);
      setRows(list.filter((s) => s.kind === 'ssh'));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <section className="card settings-card">
      <div className="card-head">
        <h3 className="h4">Docker servers</h3>
        <span className="eyebrow">Over SSH</span>
      </div>
      <p className="soft">
        Cubecrusher's containers come through Unraid's API, set up above. To manage radioshack or any other machine with Docker, add it here. The app uses the SSH keys on this computer, so{' '}
        <span className="mono">ssh root@host docker ps</span> has to work in a terminal first.
      </p>
      <form className="form" onSubmit={submit}>
        {rows.map((s, i) => (
          <div className="inst" key={s.id}>
            <div className="fields four">
              <Field label="Name">
                <input value={s.name} onChange={(e) => edit(i, { name: e.target.value })} placeholder="radioshack" />
              </Field>
              <Field label="Host">
                <input value={s.host} onChange={(e) => edit(i, { host: e.target.value })} placeholder="192.168.1.20" spellCheck={false} />
              </Field>
              <Field label="User">
                <input value={s.user} onChange={(e) => edit(i, { user: e.target.value })} spellCheck={false} />
              </Field>
              <Field label="Port">
                <input value={s.port} onChange={(e) => edit(i, { port: e.target.value })} inputMode="numeric" />
              </Field>
            </div>
            <div className="inst-acts">
              <span className="small soft">{tested[s.id] || ''}</span>
              <button type="button" className="btn md quiet" onClick={() => test(s)}>
                Test
              </button>
              <button type="button" className="btn md quiet" onClick={() => remove(i)}>
                Remove
              </button>
            </div>
          </div>
        ))}
        <div className="row-end">
          <button type="button" className="btn md" onClick={add}>
            Add server
          </button>
          <button className="btn md primary">{saved ? 'Saved' : 'Save'}</button>
        </div>
        {error && <p className="err">{error}</p>}
      </form>
    </section>
  );
}

// Which build is running, and any branch's latest build a click away. The
// app's own branch is checked on its own; this card also lets another
// branch's build be tried.
function Updates({ updater }) {
  const { running, available, progress, error, note, install, cancel } = updater;
  const [branches, setBranches] = useState(null);
  const [branch, setBranch] = useState(running?.branch || BUILD.branch);
  const [latest, setLatest] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const loadBranches = async (fresh) => {
    setLoadError(null);
    try {
      const list = await desktop.updates.branches(fresh);
      setBranches(list);
      if (!list.includes(branch)) setBranch(list.includes(running?.branch) ? running.branch : list[0] || '');
    } catch (err) {
      setLoadError(err.message);
    }
  };
  useEffect(() => {
    loadBranches(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!branch || !branches) return undefined;
    let alive = true;
    setLatest(null);
    desktop.updates
      .latest(branch)
      .then((l) => alive && setLatest(l))
      .catch((err) => alive && setLoadError(err.message));
    return () => {
      alive = false;
    };
  }, [branch, branches]);

  const sha = running?.sha || BUILD.sha;
  const same = latest?.run?.sha && sha && latest.run.sha === sha;
  const size = latest?.run?.size ? ` (${Math.round(latest.run.size / 1e6)} MB)` : '';
  const shown = error || loadError;

  return (
    <section className="card settings-card">
      <div className="card-head">
        <h3 className="h4">Updates</h3>
        <span className="eyebrow mono">
          Running {running?.branch || BUILD.branch} @ {sha.slice(0, 7) || 'dev'}
        </span>
      </div>
      <p className="soft">
        Every push to GitHub becomes a build. The app checks its own branch when it starts and every hour, and offers a newer build in the top bar; one click installs it and restarts. Pick another branch here to try its build.
      </p>
      {available && !progress && (
        <p className="ok small">
          A newer build is ready: {available.title}. <button type="button" className="linkish" onClick={() => install(available.branch)}>Install it and restart</button>
        </p>
      )}
      <div className="form">
        <div className="two">
          <Field label="Branch">
            <select value={branch} onChange={(e) => setBranch(e.target.value)} disabled={!branches}>
              {(branches || [branch]).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Latest build">
            <span className="small mono" style={{ height: 36, display: 'flex', alignItems: 'center' }}>
              {!latest ? 'Checking…' : !latest.run ? (latest.building ? 'Building now…' : 'No finished build yet') : `${latest.run.sha.slice(0, 7)} · ${ago(Date.parse(latest.run.at))}${same ? ' · running now' : ''}`}
            </span>
          </Field>
        </div>
        {latest?.run?.notes && <p className="soft small">{latest.run.notes.split('\n')[0]}</p>}
        {latest?.newer && (
          <p className="err small">
            The newest push ({latest.newer.sha.slice(0, 7)}, {ago(Date.parse(latest.newer.at))}) has no installer for this computer. {latest.run ? 'Showing the last one that does.' : ''}
            {latest.building ? ' Another build is running now.' : ''}
          </p>
        )}
        <div className="row-end">
          <button type="button" className="btn md quiet" onClick={() => loadBranches(true)}>
            Check now
          </button>
          <button type="button" className="btn md primary" onClick={() => install(branch)} disabled={!latest?.run?.ready || Boolean(progress)}>
            {same ? 'Reinstall this build' : 'Download and install'}
            {size}
          </button>
        </div>
      </div>
      {progress && (
        <div className="progress">
          <p className="ok">{progress.text}</p>
          {progress.pct != null && (
            <span className="progress-bar" aria-hidden="true">
              <i style={{ width: `${progress.pct}%` }} />
            </span>
          )}
          <button type="button" className="btn md quiet" onClick={cancel}>
            Cancel
          </button>
        </div>
      )}
      {note && <p className="ok">{note}</p>}
      {shown && <p className="err">{shown}</p>}
    </section>
  );
}

export default function Settings({ conn, onConnect, onChanged, hermesList, onHermesChanged, updater }) {
  const [settings, setSettings] = useState(null);
  useEffect(() => {
    if (desktop) window.cubecrusher.getSettings().then(setSettings);
  }, []);
  const dash = conn.dashboard || conn;
  return (
    <div className="content">
      <div className="ph nopad">
        <div>
          <span className="eyebrow c">Cubecrusher desktop</span>
          <h1>Settings</h1>
        </div>
      </div>
      {desktop && settings && (
        <Cubecrusher
          conn={conn}
          saved={settings}
          onSaved={(unraid) => {
            setSettings((x) => ({ ...x, unraid }));
            onChanged?.();
          }}
        />
      )}
      <section className="card settings-card">
        <div className="card-head">
          <h3 className="h4">Home-Dashboard (optional)</h3>
          <span className={`pill`} style={{ '--k': dash.state === 'live' ? 'var(--cyan)' : 'var(--text-dim)' }}>
            {dash.state === 'live' ? 'Connected' : dash.state === 'signin' ? 'Sign in' : 'Not connected'}
          </span>
        </div>
        <p className="soft">
          {dash.serverUrl ? (
            <>
              Home-Dashboard at <span className="mono">{dash.serverUrl}</span>
              {conn.user ? ` as ${conn.user.name || conn.user.username}` : ''}. Only the calendar, to-do list and notes come from here{conn.server?.state === 'live' ? '' : ', and the server readings until Cubecrusher is set up above'}.
            </>
          ) : (
            'Not connected. The calendar on Home needs it; nothing else does.'
          )}
        </p>
        <div className="row-end">
          <button className="btn md" onClick={onConnect}>
            {dash.state === 'live' ? 'Change…' : 'Connect…'}
          </button>
        </div>
      </section>
      {desktop ? (
        <>
          {settings && (
            <WeatherPlace
              place={settings.weather}
              onSaved={(weather) => {
                setSettings((x) => ({ ...x, weather }));
                onChanged?.();
              }}
            />
          )}
          <HermesInstances hermesList={hermesList} onChanged={onHermesChanged} live={dash.state === 'live'} />
          <DockerServers />
          {settings && updater && <Updates updater={updater} />}
        </>
      ) : (
        <p className="dim">Hermes instances, Docker servers and updates are set up in the desktop app.</p>
      )}
    </div>
  );
}
