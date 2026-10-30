import { useEffect, useRef, useState } from 'react';
import { api, usePoll } from '../lib/api.js';
import { demoActivity, demoAgents, demoApprovals } from '../lib/demo.js';
import { ago } from '../lib/format.js';
import { load, save } from '../lib/store.js';
import Markdown from '../lib/markdown.jsx';

const TABS = [
  { id: 'chat', label: 'Chat' },
  { id: 'agents', label: 'Agents' },
  { id: 'studio', label: 'Studio' },
  { id: 'models', label: 'Models' },
  { id: 'tools', label: 'Tools' },
  { id: 'memory', label: 'Memory' },
];

const TONE = { red: 'var(--red)', brass: 'var(--brass)', cyan: 'var(--cyan)' };
const LOOP = [
  { id: 'in', label: 'In the loop', hint: 'Asks before every action' },
  { id: 'near', label: 'Near', hint: 'Fixes small things, asks about big ones' },
  { id: 'out', label: 'Out', hint: 'Acts on its own and reports after' },
];
const STATE = { watching: 'Watching', running: 'Running', scheduled: 'Scheduled' };
const timeNow = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

function Agents({ paused }) {
  const [loops, setLoops] = useState(() => load('agentLoops', {}));
  const [approvals, setApprovals] = useState(demoApprovals);
  const [activity, setActivity] = useState(demoActivity);

  const setLoop = (id, loop) => {
    const next = { ...loops, [id]: loop };
    setLoops(next);
    save('agentLoops', next);
  };

  const decide = (item, action) => {
    if (action.choice === 'review') return;
    setApprovals((list) => list.filter((a) => a.id !== item.id));
    const verb = action.choice === 'approve' ? 'You approved' : 'You denied';
    setActivity((log) => [{ at: timeNow(), who: 'you', what: `${verb}: ${item.title}` }, ...log]);
  };

  return (
    <div className="hbody">
      <div className="agents">
        {demoAgents.map((a) => {
          const loop = loops[a.id] ?? a.loop;
          return (
            <section className="card agent" key={a.id}>
              <div className="card-head">
                <h3 className="h4">{a.name}</h3>
                {paused ? (
                  <span className="pill" style={{ '--k': 'var(--text-dim)' }}>
                    Paused
                  </span>
                ) : (
                  <span className="pill" style={{ '--k': a.state === 'scheduled' ? 'var(--brass)' : 'var(--cyan)' }}>
                    {a.state !== 'scheduled' && <span className="led on" />}
                    {STATE[a.state]}
                  </span>
                )}
              </div>
              <span className="soft">{a.about}</span>
              <div className="loop" role="radiogroup" aria-label={`${a.name} autonomy`}>
                {LOOP.map((l) => (
                  <button key={l.id} role="radio" aria-checked={loop === l.id} className={loop === l.id ? 'on' : undefined} title={l.hint} onClick={() => setLoop(a.id, l.id)}>
                    {l.id === 'in' ? 'In the loop' : l.label}
                  </button>
                ))}
              </div>
              <span className="dim mono small">{a.note}</span>
            </section>
          );
        })}
      </div>
      <div className="hrow">
        <section className="card appr">
          <div className="card-head">
            <h3 className="h4">Waiting for you</h3>
            <span className="eyebrow">{approvals.length === 1 ? '1 approval' : `${approvals.length} approvals`}</span>
          </div>
          {approvals.length === 0 && <p className="dim">Nothing is waiting. The agents will ask here when they need you.</p>}
          {approvals.map((item) => (
            <div className="ap" key={item.id} style={{ '--k': TONE[item.tone] }}>
              <span className="k" />
              <div>
                <b>{item.title}</b>
                <span className="soft">{item.body}</span>
              </div>
              <div className="chips">
                {item.actions.map((a) => (
                  <button key={a.label} className={`btn md${a.primary ? ' primary' : ''}${a.quiet ? ' quiet' : ''}`} onClick={() => decide(item, a)}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
        <section className="card act">
          <div className="card-head">
            <h3 className="h4">Activity</h3>
            <span className="eyebrow">Today</span>
          </div>
          <div className="log">
            {activity.map((row, i) => (
              <div key={`${row.at}${i}`}>
                <span className="dim">{row.at}</span>
                <em>{row.who}</em>
                <span>{row.what}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <p className="dim small">
        Sample agents. Autonomy settings are saved on this computer; the agents will run on Cubecrusher once the agent service is built.
      </p>
    </div>
  );
}

function Steps({ steps }) {
  const [open, setOpen] = useState(false);
  const tools = steps.filter((s) => s.kind === 'tool');
  return (
    <div className="thought">
      <button className="hd" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`led${open ? ' on' : ''}`} />
        Thought process · {tools.length === 1 ? '1 tool' : `${tools.length} tools`}
      </button>
      {open &&
        steps.map((s, i) =>
          s.kind === 'tool' ? (
            <div className="tool" key={i}>
              <b>{s.name}</b>
              <span>{s.args}</span>
            </div>
          ) : (
            <div className="reason" key={i}>
              {s.text}
            </div>
          ),
        )}
    </div>
  );
}

function Chat({ live, draft, onDraftUsed }) {
  const sessions = usePoll('/api/hermes/sessions', { enabled: live, every: 30_000 });
  const reloadSessions = sessions.reload;
  const [current, setCurrent] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const end = useRef(null);
  const list = sessions.data?.sessions ?? [];

  useEffect(() => {
    if (draft) {
      setText(draft);
      setCurrent(null);
      onDraftUsed();
    }
  }, [draft, onDraftUsed]);

  useEffect(() => {
    if (!live || !current) {
      setMessages([]);
      return;
    }
    let alive = true;
    api(`/api/hermes/sessions/${current}/messages`)
      .then((d) => alive && setMessages(d.messages))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [live, current]);

  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [messages]);

  const send = async (e) => {
    e.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    if (!live) {
      setError('Connect to Cubecrusher to chat with Hermes.');
      return;
    }
    setBusy(true);
    setError(null);
    setText('');
    setMessages((m) => [...m, { role: 'user', content: message, pending: true }]);
    try {
      let id = current;
      if (!id) {
        id = (await api('/api/hermes/sessions', { method: 'POST', body: {} })).id;
        setCurrent(id);
      }
      // The reply streams back; this waits for it to finish, then reloads.
      await api(`/api/hermes/sessions/${id}/chat`, { method: 'POST', body: { message }, raw: true });
      setMessages((await api(`/api/hermes/sessions/${id}/messages`)).messages);
      reloadSessions();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hbody chat">
      <section className="card chats">
        <div className="card-head">
          <h3 className="h4">Chats</h3>
          <button className="btn md quiet" onClick={() => setCurrent(null)}>
            New
          </button>
        </div>
        {!live && <p className="dim small">Connect to Cubecrusher to see your chats, including ones started on Telegram.</p>}
        {live && sessions.error && !sessions.data && <p className="err">{sessions.error.message}</p>}
        <div className="list">
          {list.map((s) => (
            <button key={s.id} className={`li${current === s.id ? ' cur' : ''}`} onClick={() => setCurrent(s.id)}>
              <span>{s.title || s.preview || 'New chat'}</span>
              <small>
                {s.answering ? 'answering' : ago(s.lastActive)}
                {s.source === 'telegram' ? ' · TG' : ''}
              </small>
            </button>
          ))}
        </div>
      </section>
      <section className="card convo">
        <div className="msgs">
          {messages.length === 0 && !busy && <p className="dim none">{current ? 'No messages yet.' : 'Start a new chat with Hermes.'}</p>}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div className="bub me" key={m.id ?? i}>
                {m.content}
              </div>
            ) : (
              <div className="botturn" key={m.id ?? i}>
                {m.steps?.length > 0 && <Steps steps={m.steps} />}
                <Markdown className="bub bot" text={m.content} />
              </div>
            ),
          )}
          {busy && <div className="dim mono small working">Hermes is working…</div>}
          <div ref={end} />
        </div>
        {error && <p className="err">{error}</p>}
        <form className="ask" onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message Hermes…" aria-label="Message Hermes" />
          <button className="btn md primary" disabled={!text.trim() || busy}>
            Send
          </button>
        </form>
      </section>
    </div>
  );
}

function Models({ live }) {
  const models = usePoll('/api/hermes/models', { enabled: live });
  if (!live) return <Later what="Models" text="Connect to Cubecrusher to see the models Hermes can use." />;
  if (models.error && !models.data) return <Later what="Models" text={models.error.message} />;
  const data = models.data;
  return (
    <div className="hbody">
      {data?.providers?.map((p) => (
        <section className="card" key={p.slug}>
          <div className="card-head">
            <h3 className="h4">{p.name}</h3>
            {p.current && (
              <span className="pill" style={{ '--k': 'var(--cyan)' }}>
                <span className="led on" />
                In use
              </span>
            )}
          </div>
          <div className="models">
            {p.models.map((m) => (
              <span key={m} className={`mono small${p.current && m === data.model ? ' cur' : ''}`}>
                {m}
              </span>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Later({ what, text }) {
  return (
    <div className="hbody">
      <section className="card notbuilt">
        <span className="eyebrow c">{what}</span>
        <p className="soft">{text}</p>
      </section>
    </div>
  );
}

const LATER = {
  studio: 'Image generation with ComfyUI: prompt, workflows, queue and gallery.',
  tools: 'What Hermes may do on its own, what it must ask about, and what it can never do.',
  memory: 'What Hermes remembers about you and Cubecrusher, and a way to edit it.',
};

export default function Hermes({ conn, tab, onTab, draft, onDraftUsed }) {
  const live = conn.state === 'live';
  const [paused, setPaused] = useState(() => load('agentsPaused', false));
  const togglePause = () => {
    setPaused(!paused);
    save('agentsPaused', !paused);
  };
  const label = TABS.find((t) => t.id === tab)?.label;
  let body;
  if (tab === 'agents') body = <Agents paused={paused} />;
  else if (tab === 'chat') body = <Chat live={live} draft={draft} onDraftUsed={onDraftUsed} />;
  else if (tab === 'models') body = <Models live={live} />;
  else body = <Later what={`${label} · coming next`} text={LATER[tab]} />;
  return (
    <div className="hermes-page">
      <div className="ph">
        <div>
          <span className="eyebrow c">Hermes</span>
          <h1>{label}</h1>
        </div>
        {tab === 'agents' && (
          <div className="chips">
            <button className="btn md" onClick={togglePause}>
              {paused ? 'Resume all agents' : 'Pause all agents'}
            </button>
            <button className="btn md" disabled title="Coming next">
              New agent…
            </button>
          </div>
        )}
      </div>
      <nav className="tabs" aria-label="Hermes views">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'cur' : undefined} aria-current={tab === t.id ? 'page' : undefined} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {body}
    </div>
  );
}
