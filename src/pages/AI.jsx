import { useEffect, useState } from 'react';
import { desktop } from '../lib/api.js';
import Chat, { Notice } from './ai/Chat.jsx';
import Studio from './ai/Studio.jsx';

const TABS = [
  { id: 'chat', label: 'Chat' },
  { id: 'agents', label: 'Agents' },
  { id: 'studio', label: 'Studio' },
  { id: 'models', label: 'Models' },
  { id: 'tools', label: 'Tools' },
  { id: 'memory', label: 'Memory' },
];

// Ideas for the tabs that aren't built yet, shown on them so they're not
// forgotten. Each is a direction to pick from, not a promise.
function Ideas({ title, items }) {
  return (
    <section className="card ideas">
      <div className="card-head">
        <h3 className="h4">{title}</h3>
        <span className="eyebrow">Ideas</span>
      </div>
      <ul>
        {items.map(([head, body]) => (
          <li key={head}>
            <b>{head}</b>
            <span className="soft">{body}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Agents() {
  return (
    <div className="hbody">
      <section className="card notbuilt">
        <span className="eyebrow c">Agents · n8n</span>
        <p className="soft">This tab will be the way into n8n: your workflows, what ran and what failed, and buttons to run them. Nothing is connected yet.</p>
      </section>
      <Ideas
        title="What this could become"
        items={[
          ['Workflow list', "Every n8n workflow with an on/off switch, its trigger (schedule, webhook, event) and when it last ran, read from n8n's API with an API key."],
          ['Runs and failures', 'Recent executions with their status; a failed run lands in the "Needs you" feed on Home with a retry button.'],
          ['Run now', 'Start a workflow by hand, with a form for its inputs when it takes any.'],
          ['Waiting for you', 'Workflows that pause for approval (n8n\'s "wait" step) show here and in notifications, so the In / Near / Out idea works for real.'],
          ['Hermes ⇄ n8n', 'Hermes can start a workflow from a chat ("back up the photos now"), and a workflow can ask Hermes to write or decide something.'],
          ['Open the editor', 'The n8n editor inside the app for building new workflows.'],
        ]}
      />
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
      .models(instance.id)
      .then((data) => alive && setState({ data, error: null }))
      .catch((err) => alive && setState({ data: null, error: err.message }));
    return () => {
      alive = false;
    };
  }, [instance?.id]);
  const ideas = (
    <Ideas
      title="Later on this page"
      items={[
        ['Ollama models', 'Pull, delete and update models on Cubecrusher, with their size and which GPU they fit on.'],
        ['Default per chat type', 'A model for maintenance chats, another for Studio, another for quick questions.'],
        ['What it costs', 'Tokens and cost per model over the week, for the paid providers.'],
        ['GPU fit', 'Which models fit in VRAM right now beside ComfyUI, and which would push it out.'],
      ]}
    />
  );
  if (!desktop?.hermes) return <Notice what="Models" text="Models show in the desktop app." />;
  if (!instance) return <Notice what="Models" text="Add a Hermes instance under Settings to see its models." />;
  const data = state.data;
  return (
    <div className="hbody">
      {state.error && <p className="err">{state.error}</p>}
      {!data && !state.error && <p className="dim">Asking {instance.name}…</p>}
      {data?.providers.length === 0 && <p className="dim">{instance.name} lists no providers.</p>}
      {data?.providers.map((p) => (
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
      <p className="dim small">In a chat, type /model to switch that chat to any of these.</p>
      {ideas}
    </div>
  );
}

function Tools({ instance }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!desktop?.hermes?.skills || !instance) return;
    setState(null);
    desktop.hermes
      .skills(instance.id)
      .then(setState)
      .catch((err) => setState({ skills: [], toolsets: [], error: err.message }));
  }, [instance?.id]);
  return (
    <div className="hbody">
      {instance && (
        <div className="hrow">
          {['toolsets', 'skills'].map((k) => (
            <section className="card grow" key={k}>
              <div className="card-head">
                <h3 className="h4">{k === 'toolsets' ? 'Toolsets' : 'Skills'}</h3>
                <span className="eyebrow">{state ? `${state[k].length}` : '…'}</span>
              </div>
              {state?.[k]?.length ? (
                <div className="kv-list">
                  {state[k].map((x) => (
                    <div key={x.name}>
                      <b className="mono small">{x.name}</b>
                      {x.description && <span className="soft small">{x.description}</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="dim small">{state ? state.error || `${instance.name} lists none.` : `Asking ${instance.name}…`}</p>
              )}
            </section>
          ))}
        </div>
      )}
      <Ideas
        title="What Tools could be"
        items={[
          ['Permissions', 'Per tool: may run on its own, must ask first, or never. The approval card in chat would follow these.'],
          ['Server actions', 'Tools that use the app\'s own connection: restart a container, read its logs, check a disk. Hermes asks, the app does it.'],
          ['Recipes', 'Saved ComfyUI workflows (txt2img, img2img, music) with names, so Studio requests can say "use the portrait one".'],
          ['Usage', 'Which tools ran this week, how often they failed, how long they took.'],
        ]}
      />
    </div>
  );
}

function Memory() {
  return (
    <div className="hbody">
      <section className="card notbuilt">
        <span className="eyebrow c">Memory</span>
        <p className="soft">Not built yet. Hermes keeps its own memory on Cubecrusher; this page would show it and let you correct it.</p>
      </section>
      <Ideas
        title="What Memory could be"
        items={[
          ['What Hermes knows', 'The facts it keeps about you and Cubecrusher (disks, services, preferences), in a list you can edit or delete from.'],
          ['Server notes', 'A living page about Cubecrusher that maintenance chats keep up to date: what was changed, when and why.'],
          ['Pin from chat', 'A button on any reply: "remember this", so a fix you worked out once is there next time.'],
          ['Per chat type', 'Separate memory for maintenance, Studio and personal chats, so they don\'t bleed into each other.'],
        ]}
      />
    </div>
  );
}

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

export default function AI({ tab, onTab, draft, onDraftUsed, hermesList, onSwitch, onPage, context }) {
  const label = TABS.find((t) => t.id === tab)?.label;
  const instance = hermesList.instances.find((h) => h.id === hermesList.current) || null;
  const common = { instances: hermesList.instances, defaultIid: hermesList.current };
  let body;
  if (tab === 'chat') body = hermesList.instances.length ? <Chat {...common} draft={draft} onDraftUsed={onDraftUsed} context={context} /> : <Notice what="Chat" text="Add a Hermes instance under Settings to start chatting." />;
  else if (tab === 'agents') body = <Agents />;
  else if (tab === 'models') body = <Models instance={instance} />;
  else if (tab === 'tools') body = <Tools instance={instance} />;
  else if (tab === 'memory') body = <Memory />;
  return (
    <div className="hermes-page">
      <div className="ph">
        <div>
          <span className="eyebrow c">AI{instance && (tab === 'models' || tab === 'tools') ? ` · ${instance.name}` : ''}</span>
          <h1>{label}</h1>
        </div>
        <div className="chips">
          {(tab === 'models' || tab === 'tools') && <Switcher instances={hermesList.instances} current={instance} status={hermesList.status} onSwitch={onSwitch} onManage={() => onPage('settings')} />}
        </div>
      </div>
      <nav className="tabs" aria-label="AI views">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'cur' : undefined} aria-current={tab === t.id ? 'page' : undefined} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {/* The Studio stays mounted once opened so uploads and the gallery survive tab switches. */}
      <StudioKeeper show={tab === 'studio'} common={common} />
      {tab !== 'studio' && body}
    </div>
  );
}

function StudioKeeper({ show, common }) {
  const [opened, setOpened] = useState(show);
  useEffect(() => {
    if (show) setOpened(true);
  }, [show]);
  if (!opened) return null;
  return (
    <div hidden={!show}>
      {common.instances.length ? <Studio {...common} /> : <Notice what="Studio" text="Add a Hermes instance under Settings to use the Studio." />}
    </div>
  );
}
