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

// Each Hermes Agent container the app can talk to. Its API server listens
// on 8642 in the container; the address is wherever that's published.
function HermesInstances({ hermesList, onChanged, live }) {
  const [rows, setRows] = useState(hermesList.instances);
  const [current, setCurrent] = useState(hermesList.current);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const dashboard = usePoll('/api/hermes', { enabled: live });
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
        Cubecrusher's containers already show through the dashboard, read only. To start, stop and read logs there, and to manage radioshack or any other machine, add it here. The app uses the SSH keys on this computer, so{' '}
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

// Pick a branch and install its latest GitHub Actions build.
function Updates({ github, onToken }) {
  const [token, setToken] = useState('');
  const [branches, setBranches] = useState(null);
  const [branch, setBranch] = useState(BUILD.branch);
  const [latest, setLatest] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);

  const loadBranches = async () => {
    setError(null);
    try {
      const list = await desktop.updates.branches();
      setBranches(list);
      if (!list.includes(branch)) setBranch(list[0] || '');
    } catch (err) {
      setError(err.message);
    }
  };
  useEffect(() => {
    if (github.hasToken) loadBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [github.hasToken]);
  useEffect(() => {
    if (!branch || !branches) return undefined;
    let alive = true;
    setLatest(null);
    desktop.updates
      .latest(branch)
      .then((l) => alive && setLatest(l))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [branch, branches]);
  useEffect(() => desktop.updates.onProgress(setProgress), []);

  const saveToken = async (e) => {
    e.preventDefault();
    onToken(await desktop.updates.setToken(token));
    setToken('');
  };
  const install = async () => {
    setError(null);
    setProgress('Starting…');
    try {
      const out = await desktop.updates.install(branch);
      setProgress(out.note || 'Installed. Restarting…');
    } catch (err) {
      setProgress(null);
      setError(err.message);
    }
  };
  const same = latest?.run?.sha && BUILD.sha && latest.run.sha === BUILD.sha;

  return (
    <section className="card settings-card">
      <div className="card-head">
        <h3 className="h4">Updates</h3>
        <span className="eyebrow mono">
          Running {BUILD.branch} @ {BUILD.sha.slice(0, 7) || 'dev'}
        </span>
      </div>
      <p className="soft">
        Every push builds the app on GitHub. Pick a branch to try its latest build; the app replaces itself and restarts. GitHub only hands builds to a signed-in user, so a personal access token with access to the repository is needed once.
      </p>
      {!github.hasToken || token ? (
        <form className="form" onSubmit={saveToken}>
          <Field label={`GitHub token for ${github.owner}/${github.repo}`}>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" autoComplete="off" />
          </Field>
          <div className="row-end">
            <button className="btn md primary" disabled={!token.trim()}>
              Save token
            </button>
          </div>
        </form>
      ) : (
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
                {!latest ? 'Checking…' : !latest.run ? 'No finished build yet' : `${latest.run.sha.slice(0, 7)} · ${ago(Date.parse(latest.run.at))} · ${latest.run.conclusion}${latest.run.ready ? '' : ' · no installer for this computer'}`}
              </span>
            </Field>
          </div>
          {latest?.run && <p className="soft small">{latest.run.title}</p>}
          <div className="row-end">
            <button type="button" className="btn md quiet" onClick={() => setToken(' ')}>
              Change token
            </button>
            <button type="button" className="btn md quiet" onClick={loadBranches}>
              Refresh
            </button>
            <button type="button" className="btn md primary" onClick={install} disabled={!latest?.run?.ready || Boolean(progress)}>
              {same ? 'Reinstall this build' : 'Download and install'}
            </button>
          </div>
        </div>
      )}
      {progress && <p className="ok">{progress}</p>}
      {error && <p className="err">{error}</p>}
    </section>
  );
}

export default function Settings({ conn, onConnect, hermesList, onHermesChanged }) {
  const [settings, setSettings] = useState(null);
  useEffect(() => {
    if (desktop) window.cubecrusher.getSettings().then(setSettings);
  }, []);
  return (
    <div className="content">
      <div className="ph nopad">
        <div>
          <span className="eyebrow c">Cubecrusher desktop</span>
          <h1>Settings</h1>
        </div>
      </div>
      <section className="card settings-card">
        <div className="card-head">
          <h3 className="h4">Dashboard server</h3>
          <span className={`pill`} style={{ '--k': conn.state === 'live' ? 'var(--cyan)' : 'var(--text-dim)' }}>
            {conn.state === 'live' ? 'Connected' : conn.state === 'signin' ? 'Sign in' : 'Not connected'}
          </span>
        </div>
        <p className="soft">
          {conn.serverUrl ? (
            <>
              Home-Dashboard at <span className="mono">{conn.serverUrl}</span>
              {conn.user ? ` as ${conn.user.name || conn.user.username}` : ''}. Home, the top bar and Cubecrusher's containers come from here.
            </>
          ) : (
            'Not set up. Home shows sample data until the app is connected.'
          )}
        </p>
        <div className="row-end">
          <button className="btn md" onClick={onConnect}>
            {conn.state === 'live' ? 'Change…' : 'Connect…'}
          </button>
        </div>
      </section>
      {desktop ? (
        <>
          <HermesInstances hermesList={hermesList} onChanged={onHermesChanged} live={conn.state === 'live'} />
          <DockerServers />
          {settings && <Updates github={settings.github} onToken={(github) => setSettings((s) => ({ ...s, github }))} />}
        </>
      ) : (
        <p className="dim">Hermes instances, Docker servers and updates are set up in the desktop app.</p>
      )}
    </div>
  );
}
