import { useCallback, useEffect, useRef, useState } from 'react';
import { api, openExternal, usePoll } from '../lib/api.js';
import { COMBOS, pressCombo, typeText } from '../lib/keys.js';
import { RETRY_MS, SAMPLE_RDP, SAMPLE_VMS, rdpTarget, socketUrl, vmTarget } from '../lib/remote.js';
import { load, save } from '../lib/store.js';
import VncScreen from './remote/VncScreen.jsx';
import RdpScreen from './remote/RdpScreen.jsx';

// The VMs page: remote control in one place. The VM tab is a VM's own screen
// (VNC, the same console Unraid opens); the RDP tab is a computer's desktop
// over RDP through guacd. Both tabs stay connected while you switch between
// them, and while you visit other pages.

const TABS = [
  { id: 'vm', label: 'VM console' },
  { id: 'rdp', label: 'RDP' },
];

// JPEG quality and compression for VNC (noVNC's 0-9 scales).
const QUALITIES = {
  best: { label: 'Best', quality: 9, compression: 1 },
  balanced: { label: 'Balanced', quality: 6, compression: 2 },
  fast: { label: 'Fast', quality: 3, compression: 6 },
};

const PHASES = {
  idle: { label: 'Not connected', k: 'var(--text-dim)' },
  connecting: { label: 'Connecting', k: 'var(--brass)' },
  waking: { label: 'Waking', k: 'var(--brass)' },
  password: { label: 'Needs sign-in', k: 'var(--brass)' },
  connected: { label: 'Connected', k: 'var(--cyan)', led: true },
  retrying: { label: 'Reconnecting', k: 'var(--brass)' },
  failed: { label: 'No connection', k: 'var(--red)' },
  refused: { label: 'Refused', k: 'var(--red)' },
};

const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.');

function KeysMenu({ session, onClose }) {
  const [text, setText] = useState('');
  const press = session.press;
  return (
    <div className="rc-keys">
      {COMBOS.map((c) => (
        <button key={c.label} className="btn md quiet" onClick={() => pressCombo(press, c.keys)}>
          {c.label}
        </button>
      ))}
      <form
        className="rc-type"
        onSubmit={(e) => {
          e.preventDefault();
          if (text) typeText(press, text, { shift: session.typeShift });
          setText('');
          onClose();
        }}
      >
        <input className="rc-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to type in" aria-label="Text to type in" />
        <button className="btn md" disabled={!text}>
          Type
        </button>
      </form>
    </div>
  );
}

// One tab: the list on the left, the screen on the right.
function Console({ kind, conn, shown, tabBar }) {
  const live = conn.state === 'live';
  const isVm = kind === 'vm';
  // Keeps polling while hidden (more slowly), so an open screen stays put.
  const poll = usePoll(isVm ? '/api/vms' : '/api/remote', { enabled: live, every: shown ? 15000 : 60000 });
  const targets = live ? (isVm ? poll.data?.vms?.map(vmTarget) : poll.data?.computers?.map(rdpTarget)) : isVm ? SAMPLE_VMS : SAMPLE_RDP;

  const [picked, setPicked] = useState(() => load(`remote:${kind}`, null));
  const [want, setWant] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [wake, setWake] = useState(false);
  const [state, setStateRaw] = useState({ phase: 'idle' });
  const [fit, setFit] = useState(true);
  const [quality, setQuality] = useState(() => (load('remote:quality', 'balanced') in QUALITIES ? load('remote:quality', 'balanced') : 'balanced'));
  const [keysOpen, setKeysOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const picker = useRef(null);
  const [note, setNote] = useState(null);
  const [retry, setRetry] = useState(null);
  const [adding, setAdding] = useState(false);
  const tries = useRef(0);
  const stage = useRef(null);
  const onState = useCallback((s) => setStateRaw(s), []);

  // The drop-down closes on a click anywhere else.
  useEffect(() => {
    if (!pickerOpen) return undefined;
    const close = (e) => !picker.current?.contains(e.target) && setPickerOpen(false);
    // Capture phase: the screen keeps its own mouse events to itself.
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [pickerOpen]);

  const target = targets && (targets.find((t) => t.id === picked) || (isVm && targets.find((t) => t.canConnect)) || targets[0]);
  const session = state.phase === 'connected' ? state.session : null;
  const showScreen = live && want && target?.canConnect;

  // The VM tab opens the screen as soon as there is one to show. An RDP
  // sign-in can lock the person at that computer out, so it waits to be asked.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!isVm || !live || !shown || autoOpened.current || !target?.canConnect) return;
    autoOpened.current = true;
    setWant(true);
  }, [isVm, live, shown, target]);

  useEffect(() => {
    if (state.phase === 'connected') {
      tries.current = 0;
      setWake(false);
    }
  }, [state.phase]);

  // A dropped connection comes back by itself, waiting a little longer each
  // time. A refused sign-in, or a deliberate disconnect, stays put.
  useEffect(() => {
    if (state.phase !== 'failed' || !showScreen || tries.current >= RETRY_MS.length) return undefined;
    poll.reload();
    const wait = RETRY_MS[tries.current];
    tries.current += 1;
    const until = Date.now() + wait;
    setRetry(Math.ceil(wait / 1000));
    const tick = setInterval(() => setRetry(Math.max(0, Math.ceil((until - Date.now()) / 1000))), 500);
    const t = setTimeout(() => {
      setRetry(null);
      setAttempt((a) => a + 1);
    }, wait);
    return () => {
      clearInterval(tick);
      clearTimeout(t);
      setRetry(null);
    };
    // poll.reload is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, showScreen]);

  function pick(id) {
    if (id === target?.id) return;
    setPicked(id);
    save(`remote:${kind}`, id);
    tries.current = 0;
    setKeysOpen(false);
    setStateRaw({ phase: 'idle' });
    // Moving between VMs keeps the console open; an RDP sign-in waits.
    const next = targets.find((t) => t.id === id);
    setWant(isVm && Boolean(next?.canConnect));
  }

  function connect({ wakeUp = false } = {}) {
    tries.current = 0;
    setWake(wakeUp);
    setWant(true);
    setAttempt((a) => a + 1);
  }

  function disconnect() {
    setWant(false);
    setKeysOpen(false);
    setStateRaw({ phase: 'idle' });
  }

  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else stage.current?.requestFullscreen?.().catch(() => {});
  }

  async function paste() {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = '';
    }
    if (!text) {
      setKeysOpen(true);
      return;
    }
    await typeText(session.press, text, { shift: session.typeShift });
    session.focus();
  }

  async function snapshot() {
    const blob = await session.snapshot();
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${target.name} ${stamp()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    setNote('Saved a picture of the screen.');
    setTimeout(() => setNote(null), 2500);
  }

  const phaseId = retry !== null ? 'retrying' : showScreen ? state.phase : 'idle';
  const phase = PHASES[phaseId];
  const url = target && socketUrl(conn.serverUrl, isVm ? `/api/vms/${encodeURIComponent(target.id)}/screen` : `/api/remote/${encodeURIComponent(target.id)}/tunnel`);
  const guacdDown = !isVm && live && poll.data && !poll.data.guacdUp;

  let splash = null;
  if (!live) {
    splash = (
      <>
        <span className="eyebrow c">Sample</span>
        <b className="rc-big">{target?.name}</b>
        <p className="soft">{isVm ? "Connect to Cubecrusher to use your VMs' screens here." : 'Connect to Cubecrusher to open RDP desktops through guacd.'}</p>
      </>
    );
  } else if (!targets) {
    splash = <p className="soft">{poll.error ? `Couldn't load the list: ${poll.error.message}` : 'Loading…'}</p>;
  } else if (!target) {
    splash = isVm ? (
      <>
        <b className="rc-big">No VMs yet</b>
        <p className="soft">Start a VM in Unraid and it shows up here. A VM needs its Graphics Card set to VNC to have a screen.</p>
      </>
    ) : (
      <>
        <b className="rc-big">No computers yet</b>
        <p className="soft">Add a Windows PC or VM by its address. Turn on Remote Desktop on it first.</p>
        <button className="btn md primary" onClick={() => setAdding(true)}>
          Add a computer
        </button>
      </>
    );
  } else if (!target.canConnect) {
    splash = (
      <>
        <b className="rc-big">{target.name}</b>
        <p className="soft">{target.why}</p>
      </>
    );
  } else if (!want) {
    splash = (
      <>
        <b className="rc-big">{target.name}</b>
        <p className="soft">
          {isVm
            ? 'Disconnected.'
            : target.on
              ? `${target.protocol.toUpperCase()} at ${target.host}:${target.port}. Signing in may lock out whoever is at that computer.`
              : `${target.name} didn't answer the last check.${target.wakeable ? ' Wake it, or try anyway.' : ''}`}
        </p>
        <div className="chips">
          <button className="btn md primary" onClick={() => connect()}>
            Connect
          </button>
          {target.wakeable && (
            <button className="btn md" onClick={() => connect({ wakeUp: true })}>
              Wake and connect
            </button>
          )}
        </div>
      </>
    );
  }

  const failedNow = showScreen && (state.phase === 'refused' || (state.phase === 'failed' && retry === null));

  const pill = (
    <span className="pill rc-pill" style={{ '--k': phase.k }} title={state.message || ''}>
      {phase.led && <span className="led on" />}
      {phase.label}
      {retry !== null && ` in ${retry}s`}
    </span>
  );

  const chips = (targets || []).map((t) => (
    <button key={t.id} className={`rc-li${target?.id === t.id ? ' cur' : ''}`} aria-current={target?.id === t.id || undefined} onClick={() => pick(t.id)}>
      <span className={`led${t.warn ? '' : t.on ? ' on' : ''}`} style={t.warn ? { background: 'var(--brass)' } : undefined} />
      <span className="rc-name">
        <b>{t.name}</b>
        <small>{t.meta}</small>
      </span>
    </button>
  ));

  const extras = (
    <>
      {!isVm && live && (
        <button className="btn quiet" onClick={() => setAdding(true)}>
          Add computer…
        </button>
      )}
      {isVm && live && poll.data?.unraidUrl && (
        <button className="btn quiet" onClick={() => openExternal(poll.data.unraidUrl)}>
          Unraid VMs ↗
        </button>
      )}
    </>
  );

  const tools = showScreen && (
    <div className="rc-tools">
      <button
        className={`btn quiet${keysOpen ? ' checked' : ''}`}
        onClick={() => setKeysOpen((k) => !k)}
        disabled={!session}
        aria-expanded={keysOpen}
        title="Ctrl+Alt+Del, Win, Alt+Tab and text to type"
      >
        Keys
      </button>
      <button className="btn quiet" onClick={paste} disabled={!session} title="Type this computer's clipboard into the screen">
        Paste
      </button>
      <button className="btn quiet" onClick={snapshot} disabled={!session} title="Save a picture of the screen">
        Snapshot
      </button>
      <div className="seg" role="group" aria-label="Size">
        <button className={fit ? 'checked' : undefined} onClick={() => setFit(true)}>
          Fit
        </button>
        <button className={fit ? undefined : 'checked'} onClick={() => setFit(false)}>
          1:1
        </button>
      </div>
      {isVm && (
        <div className="seg" role="group" aria-label="Picture quality" title="Picture quality: Fast uses less of the connection">
          {Object.entries(QUALITIES).map(([id, q]) => (
            <button
              key={id}
              className={quality === id ? 'checked' : undefined}
              onClick={() => {
                setQuality(id);
                save('remote:quality', id);
              }}
            >
              {q.label}
            </button>
          ))}
        </div>
      )}
      <button className="btn quiet" onClick={fullscreen} title="Full screen (Esc to leave)">
        Full screen
      </button>
    </div>
  );

  const end = (
    <>
      {failedNow && (
        <button className="btn primary" onClick={() => connect()}>
          Try again
        </button>
      )}
      {showScreen && (
        <button className="btn" onClick={disconnect}>
          Disconnect
        </button>
      )}
    </>
  );

  const guacdWarn = guacdDown && <p className="err small rc-warn">guacd isn't answering at {poll.data.guacd}, so RDP can't connect. Is its container running?</p>;

  const screenArea = showScreen ? (
    <>
      {isVm ? (
        <VncScreen key={target.id} target={target} url={url} attempt={attempt} fit={fit} quality={QUALITIES[quality]} onState={onState} />
      ) : (
        <RdpScreen key={target.id} target={target} url={url} attempt={attempt} wake={wake} fit={fit} onState={onState} />
      )}
      {(state.phase === 'failed' || state.phase === 'refused') && (
        <p className="err rc-err">
          {state.message || `Couldn't reach ${target.name}.`}
          {state.phase === 'failed' && retry === null && tries.current >= RETRY_MS.length && ' Stopped trying; press Try again.'}
        </p>
      )}
    </>
  ) : (
    <div className="rc-splash">{splash}</div>
  );

  const popups = (
    <>
      {keysOpen && session && <KeysMenu session={session} onClose={() => setKeysOpen(false)} />}
      {note && <p className="dim small rc-note">{note}</p>}
    </>
  );

  // One slim bar: the tabs, the VMs or computers in a drop-down, the
  // connection's state and its tools. The screen gets the rest.
  const body = (
    <>
      <div className="rc-strip">
        {tabBar}
        <div className="rc-pick" ref={picker}>
          <button className="rc-li cur" onClick={() => setPickerOpen((o) => !o)} aria-expanded={pickerOpen}>
            <span className={`led${target?.warn ? '' : target?.on ? ' on' : ''}`} style={target?.warn ? { background: 'var(--brass)' } : undefined} />
            <span className="rc-name">
              <b>{target?.name ?? (isVm ? 'No VMs' : 'No computers')}</b>
              <small>{target?.meta}</small>
            </span>
            <span className="rc-caret">▾</span>
          </button>
          {pickerOpen && (
            <div className="rc-menu" onClick={() => setPickerOpen(false)}>
              {chips}
              {extras}
            </div>
          )}
        </div>
        {pill}
        {!live && (
          <span className="pill" style={{ '--k': 'var(--brass)' }}>
            Sample
          </span>
        )}
        <span className="rc-sp" />
        {tools}
        {end}
      </div>
      {guacdWarn}
      {popups}
      <div className="rc-stage" ref={stage}>
        {screenArea}
      </div>
    </>
  );

  return (
    <div className="rc" hidden={!shown}>
      {body}
      {adding && (
        <AddComputer
          onClose={() => setAdding(false)}
          onAdded={(c) => {
            setAdding(false);
            poll.reload();
            setPicked(c.id);
            save(`remote:${kind}`, c.id);
            setWant(false);
          }}
        />
      )}
    </div>
  );
}

// Saves a computer on the dashboard server (the password stays there and
// never comes back to the app).
function AddComputer({ onClose, onAdded }) {
  const [form, setForm] = useState({ name: '', host: '', port: '', username: '', password: '', domain: '', mac: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onAdded(await api('/api/remote', { method: 'POST', body: { ...form, protocol: 'rdp' } }));
    } catch (err) {
      setError(err.status === 403 ? 'Only an admin can add computers.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  const field = (k, label, props = {}) => (
    <label className="field">
      <span className="label">{label}</span>
      <input value={form[k]} onChange={set(k)} {...props} />
    </label>
  );

  return (
    <div className="scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="card dialog" role="dialog" aria-modal="true" aria-labelledby="add-pc-title">
        <div className="card-head">
          <h3 className="h4" id="add-pc-title">
            Add a computer
          </h3>
        </div>
        <form className="form" onSubmit={submit}>
          {field('name', 'Name', { autoFocus: true, placeholder: 'Gaming PC', required: true })}
          <div className="rc-pair">
            {field('host', 'Address', { placeholder: '10.1.1.20', required: true })}
            {field('port', 'Port', { placeholder: '3389', inputMode: 'numeric' })}
          </div>
          <div className="rc-pair">
            {field('username', 'Username', { autoComplete: 'off' })}
            {field('password', 'Password', { type: 'password', autoComplete: 'new-password' })}
          </div>
          {field('domain', 'Domain (optional)')}
          {field('mac', 'MAC address, to wake it (optional)', { placeholder: '3c:7c:3f:12:ab:cd' })}
          {error && <p className="err">{error}</p>}
          <div className="row-end">
            <button type="button" className="btn md quiet" onClick={onClose}>
              Cancel
            </button>
            <button className="btn md primary" disabled={busy}>
              {busy ? 'Saving…' : 'Add'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function Remote({ conn, shown = true }) {
  const [tab, setTab] = useState(() => (load('remote:tab', 'vm') === 'rdp' ? 'rdp' : 'vm'));
  const pickTab = (id) => {
    setTab(id);
    save('remote:tab', id);
  };
  // The page has no header of its own: the tabs lead the bar.
  const tabBar = (
    <div className="seg rc-tabs" role="tablist" aria-label="Remote control">
      {TABS.map((t) => (
        <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'checked' : undefined} onClick={() => pickTab(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
  return (
    <div className="rc-page">
      {/* Both tabs stay mounted so switching doesn't drop a connection. */}
      <Console kind="vm" conn={conn} shown={shown && tab === 'vm'} tabBar={tabBar} />
      <Console kind="rdp" conn={conn} shown={shown && tab === 'rdp'} tabBar={tabBar} />
    </div>
  );
}
