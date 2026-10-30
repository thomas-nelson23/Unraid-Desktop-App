import { useCallback, useEffect, useState } from 'react';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import ConnectDialog from './ConnectDialog.jsx';
import Home from './pages/Home.jsx';
import Hermes from './pages/Hermes.jsx';
import Docker from './pages/Docker.jsx';
import Overview from './pages/Overview.jsx';
import Settings from './pages/Settings.jsx';
import NotBuilt from './pages/NotBuilt.jsx';
import { checkConnection, desktop, usePoll } from './lib/api.js';
import { demoContainerCount, demoNeeds, demoServer } from './lib/demo.js';
import { needsFromServer } from './lib/needs.js';
import { useServerHistory } from './lib/history.js';

const EMPTY_HERMES = { instances: [], current: null, status: [] };

// The Hermes instances and whether each one answers, kept at the top so the
// Hermes page and Settings see the same list.
function useHermesList() {
  const [list, setList] = useState(EMPTY_HERMES);
  const refresh = useCallback(async (next) => {
    if (!desktop) return;
    const l = next || (await desktop.hermes.list());
    setList((s) => ({ ...l, status: s.status }));
    try {
      const status = await desktop.hermes.status();
      setList((s) => ({ ...s, status }));
    } catch {
      // The page says "checking" until a later refresh.
    }
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(() => refresh(), 60_000);
    return () => clearInterval(timer);
  }, [refresh]);
  const switchTo = async (id) => refresh(await desktop.hermes.setCurrent(id));
  return { list, refresh, switchTo };
}

export default function App() {
  const [conn, setConn] = useState({ state: 'demo', reason: 'none' });
  const [connecting, setConnecting] = useState(false);
  const [page, setPage] = useState('home');
  const [hermesTab, setHermesTab] = useState('agents');
  const [draft, setDraft] = useState('');
  const hermes = useHermesList();

  const refresh = useCallback(async () => setConn(await checkConnection()), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const live = conn.state === 'live';
  const serverPoll = usePoll('/api/server', { enabled: live, every: 5000 });
  const containerPoll = usePoll('/api/containers', { enabled: live, every: 30000 });

  const server = live ? serverPoll.data : demoServer();
  const history = useServerHistory(live ? serverPoll.data?.host : null);
  const containers = containerPoll.data?.containers;
  const needs = live ? needsFromServer({ containers, host: server?.host }) : demoNeeds;
  const counts = {
    home: needs.length || null,
    docker: live ? (containers?.length ?? null) : demoContainerCount,
  };

  // "Ask Hermes" from anywhere lands in the Hermes chat with the question filled in.
  const askHermes = (text) => {
    setDraft(text);
    setHermesTab('chat');
    setPage('hermes');
  };
  const onDraftUsed = useCallback(() => setDraft(''), []);

  let content;
  if (page === 'home') content = <Home conn={conn} needs={needs} onAsk={askHermes} onPage={setPage} />;
  else if (page === 'hermes') content = <Hermes tab={hermesTab} onTab={setHermesTab} draft={draft} onDraftUsed={onDraftUsed} hermesList={hermes.list} onSwitch={hermes.switchTo} onPage={setPage} />;
  // Array & disks is a tab of Overview; its page id opens that tab.
  else if (page === 'overview' || page === 'array') content = <Overview conn={conn} server={server} history={history} tab={page} onTab={setPage} onAsk={askHermes} />;
  else if (page === 'docker') content = <Docker conn={conn} onPage={setPage} />;
  else if (page === 'settings') content = <Settings conn={conn} onConnect={() => setConnecting(true)} hermesList={hermes.list} onHermesChanged={hermes.refresh} />;
  else content = <NotBuilt page={page} />;

  return (
    <div className="app hex">
      <div className="glow" aria-hidden="true" />
      <Sidebar page={page} onPage={setPage} counts={counts} />
      <main className="main">
        <TopBar conn={conn} server={server} onConnect={() => setConnecting(true)}>
          {conn.state !== 'live' && (
            <button className="btn md" onClick={() => setConnecting(true)}>
              {conn.state === 'signin' ? 'Sign in' : 'Connect'}
            </button>
          )}
        </TopBar>
        <div className="edge" />
        <div className="page-scroll">{content}</div>
      </main>
      {connecting && <ConnectDialog conn={conn} onClose={() => setConnecting(false)} onChanged={refresh} />}
    </div>
  );
}
