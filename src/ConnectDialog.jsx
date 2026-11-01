import { useState } from 'react';
import { api, inElectron, setSettings } from './lib/api.js';

// Point the app at the Home-Dashboard server on Cubecrusher and sign in to
// it, for the calendar, to-do list and notes. The account is the same one
// used on the dashboard website. The server itself is reached through
// Unraid's API, set up under Settings.
export default function ConnectDialog({ conn: whole, onClose, onChanged }) {
  const conn = whole.dashboard || whole;
  const [url, setUrl] = useState(conn.serverUrl || 'http://cubecrusher:3000');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(conn.state === 'offline' ? `Couldn't reach ${conn.serverUrl}.` : null);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveUrl = (e) => {
    e.preventDefault();
    run(async () => {
      await setSettings({ serverUrl: url });
      await onChanged();
    });
  };

  const signIn = (e) => {
    e.preventDefault();
    run(async () => {
      await api('/api/login', { method: 'POST', body: { username, password } });
      await onChanged();
      onClose();
    });
  };

  const signOut = () =>
    run(async () => {
      await api('/api/logout', { method: 'POST' });
      await onChanged();
    });

  const useSample = () =>
    run(async () => {
      await setSettings({ serverUrl: '' });
      await onChanged();
      onClose();
    });

  return (
    <div className="scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="card dialog" role="dialog" aria-modal="true" aria-labelledby="connect-title">
        <div className="card-head">
          <h3 className="h4" id="connect-title">
            Connect Home-Dashboard
          </h3>
          <button className="btn md quiet" onClick={onClose}>
            Close
          </button>
        </div>

        {conn.state === 'live' ? (
          <div className="form">
            <p className="soft">
              Signed in to <span className="mono">{conn.serverUrl}</span> as <b>{conn.user.name || conn.user.username}</b>.
            </p>
            <div className="row-end">
              <button className="btn md" onClick={signOut} disabled={busy}>
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <>
            {inElectron && (
              <form className="form" onSubmit={saveUrl}>
                <label className="field">
                  <span className="eyebrow">Dashboard server</span>
                  <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.10:3000" spellCheck={false} />
                </label>
                <p className="dim small">The address of Home-Dashboard on Cubecrusher, for the calendar, to-do list and notes. Over WireGuard, use its LAN address.</p>
                <div className="row-end">
                  <button className="btn md quiet" type="button" onClick={useSample} disabled={busy}>
                    {conn.serverUrl ? 'Forget it' : 'Skip'}
                  </button>
                  <button className="btn md" disabled={busy || !url.trim()}>
                    Connect
                  </button>
                </div>
              </form>
            )}
            {conn.state === 'signin' && (
              <form className="form" onSubmit={signIn}>
                <label className="field">
                  <span className="eyebrow">Username</span>
                  <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
                </label>
                <label className="field">
                  <span className="eyebrow">Password</span>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
                </label>
                <div className="row-end">
                  <button className="btn md primary" disabled={busy || !username || !password}>
                    Sign in
                  </button>
                </div>
              </form>
            )}
          </>
        )}
        {error && <p className="err">{error}</p>}
      </section>
    </div>
  );
}
