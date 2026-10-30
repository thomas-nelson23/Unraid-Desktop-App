import { useCallback, useEffect, useRef, useState } from 'react';
import { desktop } from '../lib/api.js';
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
                    {l.label}
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
      <p className="dim small">Sample agents. Autonomy settings are saved on this computer; the agents will run on Cubecrusher once the agent service is built.</p>
    </div>
  );
}

function Steps({ steps, live }) {
  const [open, setOpen] = useState(live);
  const tools = steps.filter((s) => s.kind === 'tool');
  return (
    <div className="thought">
      <button className="hd" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`led${open || live ? ' on' : ''}`} />
        {live ? 'Working' : 'Thought process'} · {tools.length === 1 ? '1 tool' : `${tools.length} tools`}
      </button>
      {open &&
        steps.map((s, i) =>
          s.kind === 'tool' ? (
            <div className="tool" key={i}>
              <b>{s.name}</b>
              <span>
                {s.args}
                {s.result != null && <span className="result">{s.failed ? 'failed: ' : ''}{s.result}</span>}
              </span>
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

// A command Hermes wants to run and is waiting on.
function Approval({ approval, onAnswer }) {
  const choices = approval.choices.filter((c) => c !== 'deny');
  const LABEL = { once: 'Allow once', session: 'Allow in this chat', always: 'Always allow' };
  return (
    <div className="approval">
      <span className="eyebrow">Hermes wants to run</span>
      <code>{approval.command}</code>
      {approval.description && <span className="soft">{approval.description}</span>}
      <div className="chips">
        {choices.map((c) => (
          <button key={c} className={`btn md${c === 'once' ? ' primary' : ''}`} onClick={() => onAnswer(c)}>
            {LABEL[c] || c}
          </button>
        ))}
        <button className="btn md quiet" onClick={() => onAnswer('deny')}>
          Deny
        </button>
      </div>
    </div>
  );
}

// Folds one streamed event into the reply being written.
function applyEvent(reply, e) {
  const steps = [...reply.steps];
  const last = steps[steps.length - 1];
  if (e.text) return { ...reply, content: reply.content + e.text };
  if (e.thinking) {
    if (last?.kind === 'thinking') steps[steps.length - 1] = { ...last, text: last.text + e.thinking };
    else steps.push({ kind: 'thinking', text: e.thinking });
    return { ...reply, steps };
  }
  if (e.tool) return { ...reply, steps: [...steps, { kind: 'tool', name: e.tool, args: e.args }] };
  if (e.toolDone) {
    const i = steps.map((s) => s.kind === 'tool' && s.name === e.toolDone && s.result == null).lastIndexOf(true);
    if (i >= 0) steps[i] = { ...steps[i], result: e.result, failed: e.failed };
    return { ...reply, steps };
  }
  if (e.note) return { ...reply, steps: [...steps, { kind: 'note', text: e.note }] };
  if (e.final !== undefined) return { ...reply, content: e.final || reply.content };
  if (e.approval) return { ...reply, approval: e.approval };
  if (e.error) return { ...reply, error: e.error };
  return reply;
}

function Chat({ instance, draft, onDraftUsed }) {
  const hermes = desktop?.hermes;
  const [sessions, setSessions] = useState({ list: [], error: null });
  const [current, setCurrent] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [reply, setReply] = useState(null); // the answer being written, with its runId
  const [error, setError] = useState(null);
  const end = useRef(null);
  const runRef = useRef(null);

  const loadSessions = useCallback(async () => {
    if (!hermes || !instance) return;
    try {
      setSessions({ list: (await hermes.sessions()).sessions, error: null });
    } catch (err) {
      setSessions((s) => ({ list: s.list, error: err.message }));
    }
  }, [hermes, instance]);

  // A new instance means a new chat list.
  useEffect(() => {
    setCurrent(null);
    setMessages([]);
    setReply(null);
    setSessions({ list: [], error: null });
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (draft) {
      setText(draft);
      setCurrent(null);
      setMessages([]);
      onDraftUsed();
    }
  }, [draft, onDraftUsed]);

  useEffect(() => {
    if (!hermes || !current) return undefined;
    let alive = true;
    setError(null);
    hermes
      .messages(current)
      .then((m) => alive && setMessages(m))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [hermes, current]);

  useEffect(() => {
    if (!hermes) return undefined;
    return hermes.onEvent((e) => {
      if (e.runId !== runRef.current) return;
      if (e.done) {
        runRef.current = null;
        setReply((r) => {
          if (r && (r.content || r.steps.length) && !e.stopped) setMessages((m) => [...m, { role: 'assistant', content: r.content, steps: r.steps }]);
          if (r?.error) setError(r.error);
          return null;
        });
        if (e.stopped) setError('Stopped.');
        loadSessions();
        return;
      }
      setReply((r) => (r ? applyEvent(r, e) : r));
    });
  }, [hermes, loadSessions]);

  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [messages, reply]);

  const send = async (e) => {
    e.preventDefault();
    const message = text.trim();
    if (!message || reply) return;
    setError(null);
    setText('');
    setMessages((m) => [...m, { role: 'user', content: message }]);
    try {
      let id = current;
      if (!id) {
        id = (await hermes.createSession({ title: message.slice(0, 60) })).id;
        setCurrent(id);
      }
      const runId = await hermes.chat(id, message);
      runRef.current = runId;
      setReply({ runId, content: '', steps: [] });
    } catch (err) {
      setError(err.message);
    }
  };

  const stop = () => reply && hermes.stop(reply.runId);
  const answer = async (choice) => {
    const a = reply?.approval;
    if (!a) return;
    try {
      await hermes.approve({ runId: a.runId, requestId: a.requestId, generation: a.generation, choice });
      setReply((r) => (r ? { ...r, approval: null } : r));
    } catch (err) {
      setError(err.message);
    }
  };

  if (!hermes) return <Later what="Chat" text="Chatting with Hermes works in the desktop app." />;
  if (!instance) return <Later what="Chat" text="Add a Hermes instance under Settings to start chatting." />;

  return (
    <div className="hbody chat">
      <section className="card chats">
        <div className="card-head">
          <h3 className="h4">Chats</h3>
          <button className="btn md quiet" onClick={() => { setCurrent(null); setMessages([]); }}>
            New
          </button>
        </div>
        {sessions.error && <p className="err small">{sessions.error}</p>}
        <div className="list">
          {sessions.list.map((s) => (
            <button key={s.id} className={`li${current === s.id ? ' cur' : ''}`} onClick={() => setCurrent(s.id)}>
              <span>{s.title || s.preview || 'New chat'}</span>
              <small>
                {s.lastActive ? ago(s.lastActive) : ''}
                {s.source === 'telegram' ? ' · TG' : ''}
              </small>
            </button>
          ))}
        </div>
      </section>
      <section className="card convo">
        <div className="msgs">
          {messages.length === 0 && !reply && <p className="dim none">{current ? 'No messages yet.' : `Start a new chat with ${instance.name}.`}</p>}
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
          {reply && (
            <div className="botturn">
              {(reply.steps.length > 0 || !reply.content) && <Steps steps={reply.steps} live />}
              {reply.content && <Markdown className="bub bot" text={reply.content} />}
              {reply.approval && <Approval approval={reply.approval} onAnswer={answer} />}
            </div>
          )}
          <div ref={end} />
        </div>
        {error && <p className="err">{error}</p>}
        <form className="ask" onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${instance.name}…`} aria-label="Message Hermes" />
          {reply ? (
            <button type="button" className="btn md" onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="btn md primary" disabled={!text.trim()}>
              Send
            </button>
          )}
        </form>
      </section>
    </div>
  );
}

function Models({ instance }) {
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    if (!desktop?.hermes || !instance) return undefined;
    let alive = true;
    setState({ data: null, error: null });
    desktop.hermes
      .models()
      .then((data) => alive && setState({ data, error: null }))
      .catch((err) => alive && setState({ data: null, error: err.message }));
    return () => {
      alive = false;
    };
  }, [instance]);
  if (!desktop?.hermes) return <Later what="Models" text="Models show in the desktop app." />;
  if (!instance) return <Later what="Models" text="Add a Hermes instance under Settings to see its models." />;
  if (state.error) return <Later what="Models" text={state.error} />;
  if (!state.data) return <Later what="Models" text={`Asking ${instance.name}…`} />;
  const data = state.data;
  return (
    <div className="hbody">
      {data.providers.length === 0 && <p className="dim">{instance.name} lists no providers.</p>}
      {data.providers.map((p) => (
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

// Which Hermes the page talks to, with a light for whether it's reachable.
function Switcher({ instances, current, status, onSwitch, onManage }) {
  const st = status.find((s) => s.id === current?.id);
  return (
    <div className="switcher">
      {instances.length > 0 && (
        <label className="lcd pick" title={st?.error || (st?.online ? `Online · ${st.model || ''}` : 'Checking…')}>
          <span className={`led${st ? (st.online ? ' on' : ' bad') : ''}`} />
          <select value={current?.id ?? ''} onChange={(e) => onSwitch(e.target.value)} aria-label="Hermes instance">
            {instances.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button className="btn md quiet" onClick={onManage}>
        {instances.length ? 'Instances…' : 'Add a Hermes…'}
      </button>
    </div>
  );
}

export default function Hermes({ tab, onTab, draft, onDraftUsed, hermesList, onSwitch, onPage }) {
  const [paused, setPaused] = useState(() => load('agentsPaused', false));
  const togglePause = () => {
    setPaused(!paused);
    save('agentsPaused', !paused);
  };
  const label = TABS.find((t) => t.id === tab)?.label;
  const instance = hermesList.instances.find((h) => h.id === hermesList.current) || null;
  let body;
  if (tab === 'agents') body = <Agents paused={paused} />;
  else if (tab === 'chat') body = <Chat instance={instance} draft={draft} onDraftUsed={onDraftUsed} />;
  else if (tab === 'models') body = <Models instance={instance} />;
  else body = <Later what={`${label} · coming next`} text={LATER[tab]} />;
  return (
    <div className="hermes-page">
      <div className="ph">
        <div>
          <span className="eyebrow c">Hermes{instance ? ` · ${instance.name}` : ''}</span>
          <h1>{label}</h1>
        </div>
        <div className="chips">
          {tab === 'agents' && (
            <button className="btn md" onClick={togglePause}>
              {paused ? 'Resume all agents' : 'Pause all agents'}
            </button>
          )}
          <Switcher instances={hermesList.instances} current={instance} status={hermesList.status} onSwitch={onSwitch} onManage={() => onPage('settings')} />
        </div>
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
