import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { desktop } from '../../lib/api.js';
import { ago } from '../../lib/format.js';
import { load, save } from '../../lib/store.js';
import Markdown from '../../lib/markdown.jsx';
import {
  FEATURED,
  STUDIO_PREFIX,
  WINDOW,
  argOptions,
  featuredBrief,
  featuredById,
  filesNote,
  filterSessions,
  isStudio,
  serverSnapshot,
  slashState,
  splitBrief,
  visibleSlice,
  withBrief,
} from '../../lib/ai.js';

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

// What you typed, with any app context folded away behind a toggle.
function UserBubble({ content, images }) {
  const [open, setOpen] = useState(false);
  const split = splitBrief(content);
  return (
    <div className="bub me">
      {split && (
        <button className="ctx" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '▾' : '▸'} Context · {split.name}
        </button>
      )}
      {split && open && <pre className="ctx-body">{split.brief}</pre>}
      {split ? split.text : content}
      {images?.length > 0 && (
        <div className="bub-pics">
          {images.map((src, i) => (
            <img key={i} src={src} alt="" loading="lazy" />
          ))}
        </div>
      )}
    </div>
  );
}

// The "/" menu above the composer.
function SlashMenu({ state, options, sel, onPick }) {
  if (!state) return null;
  let rows;
  if (state.stage === 'command') {
    rows = state.matches.map((c) => ({ key: c.cmd, label: `/${c.cmd}`, hint: c.hint }));
    if (!rows.length) rows = [{ key: 'none', label: 'No such command', hint: 'Type / to see them all', disabled: true }];
  } else if (state.command.arg === 'pick') {
    rows = options.map((o, i) => ({ key: `${o.label}${i}`, label: o.label, hint: o.hint, current: o.current }));
    if (!rows.length) rows = [{ key: 'none', label: options.loading ? 'Loading…' : 'Nothing matches', disabled: true }];
  } else if (state.command.arg === 'text') {
    rows = [{ key: 'text', label: state.query ? `Enter: /${state.command.cmd} “${state.query}”` : `Type after /${state.command.cmd}`, hint: state.command.hint, disabled: !state.query }];
  } else {
    rows = [{ key: 'run', label: `Enter: /${state.command.cmd}`, hint: state.command.hint }];
  }
  return (
    <div className="slash" role="listbox" aria-label="Commands">
      {rows.map((r, i) => (
        <button
          type="button"
          key={r.key}
          role="option"
          aria-selected={i === sel}
          className={`${i === sel ? 'cur' : ''}${r.disabled ? ' off' : ''}`}
          disabled={r.disabled}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(i);
          }}
        >
          <b>{r.label}</b>
          {r.current && <span className="pill tiny">in use</span>}
          {r.hint && <span className="dim">{r.hint}</span>}
        </button>
      ))}
    </div>
  );
}

// The chat with one Hermes: its chats on the left (featured first), the
// conversation, and a composer with a "/" command menu. The Studio uses the
// same chat with its own sessions, file attachments and a media panel.
export default function Chat({ instance, instances = [], onSwitch, draft, onDraftUsed, context, mode = 'chat', attachments = [], onAttachments, onSent, onTurnDone, onCurrent, extra, drop, onPickFiles, side }) {
  const hermes = desktop?.hermes;
  const studio = mode === 'studio';
  const iid = instance?.id ?? null;
  const [sessions, setSessions] = useState({ list: [], error: null, loading: false });
  const [current, setCurrent] = useState(null);
  const [featured, setFeatured] = useState(null); // a featured chat waiting for its first message
  const [messages, setMessages] = useState([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [shown, setShown] = useState(WINDOW);
  const [text, setText] = useState('');
  const [reply, setReply] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [models, setModels] = useState(null);
  const [snapshot, setSnapshot] = useState(false);
  const [overrides, setOverrides] = useState(() => load('chatModels', {}));
  const [pendingModel, setPendingModel] = useState(null);
  const [featuredOn, setFeaturedOn] = useState(() => load('featuredOn', FEATURED.filter((f) => f.on).map((f) => f.id)));
  const [links, setLinks] = useState({});
  const [editFeatured, setEditFeatured] = useState(false);
  const end = useRef(null);
  const runRef = useRef(null);
  const box = useRef(null);
  const currentRef = useRef(null);
  currentRef.current = current;
  useEffect(() => {
    onCurrent?.(current);
  }, [current, onCurrent]);

  // Featured chats are linked to a Hermes session per instance.
  useEffect(() => {
    setLinks(load(`featuredLinks:${iid}`, {}));
  }, [iid]);
  const link = (fid, sid) => {
    const next = { ...links, [fid]: sid };
    if (!sid) delete next[fid];
    setLinks(next);
    save(`featuredLinks:${iid}`, next);
  };

  const loadSessions = useCallback(async () => {
    if (!hermes || !iid) return;
    setSessions((s) => ({ ...s, loading: true }));
    try {
      setSessions({ list: (await hermes.sessions()).sessions, error: null, loading: false });
    } catch (err) {
      setSessions((s) => ({ list: s.list, error: err.message, loading: false }));
    }
  }, [hermes, iid]);

  // A new instance means a new chat list. Keyed on the id, not the object,
  // so the minute-by-minute status check doesn't throw the open chat away.
  useEffect(() => {
    setCurrent(null);
    setFeatured(null);
    setMessages([]);
    setReply(null);
    setModels(null);
    setSessions({ list: [], error: null, loading: false });
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (draft) {
      setText(draft);
      setCurrent(null);
      setFeatured(null);
      setMessages([]);
      onDraftUsed?.();
    }
  }, [draft, onDraftUsed]);

  useEffect(() => {
    if (!hermes || !current) return undefined;
    let alive = true;
    setError(null);
    setLoadingChat(true);
    setShown(WINDOW);
    hermes
      .messages(current)
      .then((m) => alive && setMessages(m))
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoadingChat(false));
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
        onTurnDone?.(currentRef.current);
        return;
      }
      setReply((r) => (r ? applyEvent(r, e) : r));
    });
  }, [hermes, loadSessions, onTurnDone]);

  const visible = useMemo(() => visibleSlice(messages, shown), [messages, shown]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [visible.length, reply]);

  const slash = slashState(text);
  const needModels = slash?.stage === 'arg' && slash.command.cmd === 'model';
  useEffect(() => {
    if (!needModels || models || !hermes) return;
    setModels({ loading: true, providers: [] });
    hermes
      .models()
      .then(setModels)
      .catch((err) => {
        setModels({ providers: [] });
        setNote(`Couldn't list models: ${err.message}`);
      });
  }, [needModels, models, hermes]);
  const options = useMemo(() => {
    if (slash?.stage !== 'arg' || slash.command.arg !== 'pick') return [];
    const list = argOptions(slash.command, slash.query, { models: models?.loading ? null : models, instances });
    if (models?.loading && needModels) list.loading = true;
    return list;
  }, [slash?.stage, slash?.command, slash?.query, models, instances, needModels]);
  useEffect(() => {
    setSel(0);
  }, [slash?.stage, slash?.query, slash?.command?.cmd]);

  const newChat = (fid = null) => {
    setCurrent(null);
    setMessages([]);
    setFeatured(fid);
    setPendingModel(null);
    setError(null);
    setNote(null);
  };

  const openFeatured = (fid) => {
    const sid = links[fid];
    if (sid && sessions.list.some((s) => s.id === sid)) {
      setFeatured(null);
      setCurrent(sid);
      setNote(null);
    } else newChat(fid);
  };

  const modelFor = current ? overrides[current] : pendingModel;
  const setModelFor = (choice) => {
    if (!current) return setPendingModel(choice);
    const next = { ...overrides };
    if (choice) next[current] = choice;
    else delete next[current];
    setOverrides(next);
    save('chatModels', next);
  };

  // Runs a "/" command; `arg` is the picked option's value or the typed text.
  const run = async (cmd, arg) => {
    setText('');
    setNote(null);
    try {
      if (cmd === 'model') {
        setModelFor(arg);
        setNote(`${arg.model} answers from the next message in this chat.`);
      } else if (cmd === 'instance') onSwitch?.(arg);
      else if (cmd === 'snapshot') setSnapshot(true);
      else if (cmd === 'featured') openFeatured(arg);
      else if (cmd === 'new') newChat();
      else if (cmd === 'rename') {
        if (!current) return setNote('Send a message first; then the chat can be renamed.');
        await hermes.rename(current, studio && !arg.startsWith(STUDIO_PREFIX) ? STUDIO_PREFIX + arg : arg);
        await loadSessions();
        setNote(`Renamed to “${arg}”.`);
      } else if (cmd === 'usage') {
        if (!current) return setNote('Nothing used yet in a new chat.');
        const d = await hermes.session(current);
        const n = (v) => (v == null ? '—' : v.toLocaleString());
        setNote(`${d.model || 'Model unknown'}${d.provider ? ` via ${d.provider}` : ''} · ${n(d.inputTokens)} in · ${n(d.outputTokens)} out · ${n(d.toolCalls)} tool calls${d.cost != null ? ` · $${d.cost.toFixed(4)}${d.costEstimated ? ' (estimate)' : ''}` : ''}`);
      } else if (cmd === 'delete') {
        if (!current) return newChat();
        if (!window.confirm('Delete this chat from Hermes? This can’t be undone.')) return;
        await hermes.deleteSession(current);
        for (const [fid, sid] of Object.entries(links)) if (sid === current) link(fid, null);
        newChat();
        await loadSessions();
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const pick = (i) => {
    if (!slash) return;
    if (slash.stage === 'command') {
      const c = slash.matches[i];
      if (!c) return;
      if (c.arg) setText(`/${c.cmd} `);
      else run(c.cmd);
    } else if (slash.command.arg === 'pick') {
      const o = options[i];
      if (o) run(slash.command.cmd, o.value);
    } else if (slash.command.arg === 'text') {
      if (slash.query) run(slash.command.cmd, slash.query);
    } else run(slash.command.cmd);
    box.current?.focus();
  };

  const send = async (e) => {
    e?.preventDefault();
    const typed = text.trim();
    if (slash) return pick(sel);
    if ((!typed && !attachments.length) || reply) return;
    setError(null);
    setNote(null);
    const f = !current && featuredById(featured);
    let message = typed || 'Here are the files.';
    if (f) message = withBrief(f.name, featuredBrief(f, context), message);
    else if (snapshot) message = withBrief('Server snapshot', serverSnapshot(context), message);
    if (studio) message += filesNote(attachments);
    const images = studio ? attachments.filter((a) => a.dataUrl).slice(0, 4).map((a) => a.dataUrl) : [];
    setText('');
    setSnapshot(false);
    setMessages((m) => [...m, { role: 'user', content: message, images }]);
    onAttachments?.([]);
    try {
      let id = current;
      if (!id) {
        const title = studio ? STUDIO_PREFIX + typed.slice(0, 50) : f ? f.name : typed.slice(0, 60);
        id = (await hermes.createSession({ title })).id;
        if (f) link(f.id, id);
        if (pendingModel) {
          const next = { ...overrides, [id]: pendingModel };
          setOverrides(next);
          save('chatModels', next);
        }
        setFeatured(null);
        setCurrent(id);
        currentRef.current = id;
      }
      const m = (current ? overrides[current] : pendingModel) || null;
      const runId = await hermes.chat(id, message, { ...(m || {}), images });
      runRef.current = runId;
      setReply({ runId, content: '', steps: [] });
      onSent?.(id);
    } catch (err) {
      setError(err.message);
    }
  };

  const onKey = (e) => {
    if (slash) {
      const count = slash.stage === 'command' ? slash.matches.length : slash.command.arg === 'pick' ? options.length : 1;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        return setSel((s) => (count ? (s + 1) % count : 0));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        return setSel((s) => (count ? (s - 1 + count) % count : 0));
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        return pick(sel);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        return setText('');
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
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

  if (!hermes) return <Notice what="Chat" text="Chatting with Hermes works in the desktop app." />;
  if (!instance) return <Notice what="Chat" text="Add a Hermes instance under Settings to start chatting." />;

  const linked = new Set(Object.values(links));
  const own = sessions.list.filter((s) => (studio ? isStudio(s) : !isStudio(s) && !linked.has(s.id)));
  const list = filterSessions(own, query);
  const shownFeatured = FEATURED.filter((f) => featuredOn.includes(f.id));
  const activeFeatured = featured ? featuredById(featured) : shownFeatured.find((f) => links[f.id] && links[f.id] === current) || null;
  const toggleFeatured = (fid) => {
    const next = featuredOn.includes(fid) ? featuredOn.filter((x) => x !== fid) : [...featuredOn, fid];
    setFeaturedOn(next);
    save('featuredOn', next);
  };
  const empty = messages.length === 0 && !reply && !loadingChat;
  const starters = activeFeatured?.starters || (studio ? ['Make a picture of…', 'Turn this photo into…', 'Make a 30-second track that sounds like…', 'Make a short video of…'] : []);
  const placeholder = studio ? 'Ask for a picture, video or music…' : activeFeatured ? `Ask in ${activeFeatured.name}…` : `Message ${instance.name}… (type / for commands)`;
  const title = activeFeatured ? activeFeatured.name : current ? (sessions.list.find((s) => s.id === current)?.title || 'Chat').replace(STUDIO_PREFIX, '') : studio ? 'New Studio request' : 'New chat';

  return (
    <div className={`hbody chat${studio ? ' studio' : ''}`}>
      <section className="card chats">
        <div className="card-head">
          <h3 className="h4">{studio ? 'Studio chats' : 'Chats'}</h3>
          <button className="btn md quiet" onClick={() => newChat()}>
            New
          </button>
        </div>
        {instances.length > 1 && (
          <div className="inst" role="tablist" aria-label="Hermes instance">
            {instances.map((h) => (
              <button key={h.id} role="tab" aria-selected={h.id === iid} className={h.id === iid ? 'checked' : undefined} onClick={() => onSwitch?.(h.id)}>
                {h.name}
              </button>
            ))}
          </div>
        )}
        {!studio && (
          <div className="featured">
            <div className="row-between">
              <span className="eyebrow c">Featured</span>
              <button className="linkish" onClick={() => setEditFeatured(!editFeatured)}>
                {editFeatured ? 'Done' : 'Edit'}
              </button>
            </div>
            {editFeatured
              ? FEATURED.map((f) => (
                  <label key={f.id} className="feat-pick">
                    <input type="checkbox" checked={featuredOn.includes(f.id)} onChange={() => toggleFeatured(f.id)} />
                    <span>
                      <b>{f.name}</b>
                      <small>{f.blurb}</small>
                    </span>
                  </label>
                ))
              : shownFeatured.map((f) => (
                  <button key={f.id} className={`feat${activeFeatured?.id === f.id ? ' cur' : ''}`} onClick={() => openFeatured(f.id)}>
                    <b>{f.name}</b>
                    <small>{f.blurb}</small>
                  </button>
                ))}
            {!editFeatured && shownFeatured.length === 0 && <p className="dim small">No featured chats. Edit to add some.</p>}
          </div>
        )}
        <input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
        {sessions.error && <p className="err small">{sessions.error}</p>}
        <div className="list">
          {list.map((s) => (
            <button key={s.id} className={`li${current === s.id ? ' cur' : ''}`} onClick={() => { setFeatured(null); setCurrent(s.id); setNote(null); }} title={s.preview || ''}>
              <span>{(s.title || s.preview || 'New chat').replace(STUDIO_PREFIX, '')}</span>
              <small>
                {s.lastActive ? ago(s.lastActive) : ''}
                {s.source === 'telegram' ? ' · TG' : ''}
              </small>
            </button>
          ))}
          {!sessions.loading && list.length === 0 && <p className="dim small">{query ? 'No chats match.' : studio ? 'No Studio chats yet.' : 'No chats yet.'}</p>}
        </div>
      </section>
      <section className="card convo" {...(drop || {})}>
        <div className="convo-head">
          <h3 className="h4">{title}</h3>
          <div className="chips">
            {modelFor && (
              <button className="pill" onClick={() => setModelFor(null)} title="Back to Hermes's default model">
                {modelFor.model} ×
              </button>
            )}
            {current && <span className="eyebrow">{instance.name}</span>}
          </div>
        </div>
        <div className="msgs">
          {loadingChat && <p className="dim none">Loading chat…</p>}
          {empty && (
            <div className="none intro">
              <p className="dim">
                {activeFeatured
                  ? `${activeFeatured.blurb}${activeFeatured.snapshot ? " The first message brings along Cubecrusher's current state." : ''}`
                  : current
                    ? 'No messages yet.'
                    : studio
                      ? 'Ask Hermes for pictures, video or music. Attach files for image-to-image or audio-to-audio; what ComfyUI makes shows on the right.'
                      : `Start a new chat with ${instance.name}. Type / for commands.`}
              </p>
              {starters.length > 0 && (
                <div className="chips center">
                  {starters.map((s) => (
                    <button key={s} className="chip" onClick={() => { setText(s.endsWith('…') ? s.slice(0, -1) : s); box.current?.focus(); }}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages.length > visible.length && (
            <button className="btn md quiet earlier" onClick={() => setShown((n) => n + WINDOW)}>
              Show earlier messages ({messages.length - visible.length})
            </button>
          )}
          {visible.map((m, i) =>
            m.role === 'user' ? (
              <UserBubble key={m.id ?? `u${i}`} content={m.content} images={m.images} />
            ) : (
              <div className="botturn" key={m.id ?? `a${i}`}>
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
          {extra}
          <div ref={end} />
        </div>
        {error && <p className="err">{error}</p>}
        {note && <p className="ok small">{note}</p>}
        <div className="composer">
          <SlashMenu state={slash} options={options} sel={sel} onPick={pick} />
          {(snapshot || attachments.length > 0) && (
            <div className="chips attach">
              {snapshot && (
                <button className="pill" onClick={() => setSnapshot(false)}>
                  Server snapshot ×
                </button>
              )}
              {attachments.map((a) => (
                <button key={a.filename} className="pill file" onClick={() => onAttachments(attachments.filter((x) => x !== a))} title="Remove">
                  {a.kind === 'image' && <img src={a.url} alt="" />}
                  {a.filename} ×
                </button>
              ))}
            </div>
          )}
          <form className="ask" onSubmit={send}>
            {onPickFiles && (
              <button type="button" className="btn md quiet" onClick={onPickFiles} title="Attach files">
                Attach
              </button>
            )}
            <textarea ref={box} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder={placeholder} aria-label="Message Hermes" />
            {reply ? (
              <button type="button" className="btn md" onClick={stop}>
                Stop
              </button>
            ) : (
              <button className="btn md primary" disabled={!text.trim() && !attachments.length}>
                Send
              </button>
            )}
          </form>
        </div>
      </section>
      {side}
    </div>
  );
}

export function Notice({ what, text, children }) {
  return (
    <div className="hbody">
      <section className="card notbuilt">
        <span className="eyebrow c">{what}</span>
        <p className="soft">{text}</p>
        {children}
      </section>
    </div>
  );
}
