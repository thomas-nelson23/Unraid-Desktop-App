import { useCallback, useEffect, useState } from 'react';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import ConnectDialog from './ConnectDialog.jsx';
import Home from './pages/Home.jsx';
import AI from './pages/AI.jsx';
import Docker from './pages/Docker.jsx';
import Overview from './pages/Overview.jsx';
import Settings from './pages/Settings.jsx';
import NotBuilt from './pages/NotBuilt.jsx';
import Remote from './pages/Remote.jsx';
import { checkConnection, desktop, usePoll, usePollFn } from './lib/api.js';
import { demoContainerCount, demoNeeds, demoServer } from './lib/demo.js';
import { needsFromServer } from './lib/needs.js';
import { useServerHistory } from './lib/history.js';
import { useUpdates } from './lib/updater.js';

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
  const [hermesTab, setHermesTab] = useState('chat');
  const [draft, setDraft] = useState('');
  const hermes = useHermesList();
  const updater = useUpdates();
  // The VMs page stays open once visited, so its screens stay connected.
  const [remoteOpen, setRemoteOpen] = useState(false);
  useEffect(() => {
    if (page === 'vms') setRemoteOpen(true);
  }, [page]);

  const refresh = useCallback(async () => setConn(await checkConnection()), []);
  useEffect(() => {
    refresh();
    // A server that was down comes back on its own.
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  // The server's readings and containers come straight from Cubecrusher
  // through Unraid's API when that's set up, else through the dashboard.
  const live = conn.state === 'live';
  const direct = conn.server?.state === 'live';
  const viaDashboard = !direct && conn.dashboard?.state === 'live';
  const unraidPoll = usePollFn(() => desktop.unraid.server(), { key: 'unraid:server', enabled: direct, every: 5000 });
  const unraidContainers = usePollFn(() => desktop.docker.containers('cubecrusher'), { key: 'unraid:containers', enabled: direct, every: 30000 });
  const serverPoll = usePoll('/api/server', { enabled: viaDashboard, every: 5000 });
  const containerPoll = usePoll('/api/containers', { enabled: viaDashboard, every: 30000 });

  const host = direct ? unraidPoll.data : viaDashboard ? serverPoll.data?.host : null;
  const server = live ? (host ? { host, error: null } : { host: null, error: (direct ? unraidPoll.error : serverPoll.error)?.message || null }) : demoServer();
  const history = useServerHistory(host);
  const containers = (direct ? unraidContainers.data : containerPoll.data?.containers) || undefined;
  const needs = live ? needsFromServer({ containers, host: server?.host }) : demoNeeds;
  const counts = {
    home: needs.length || null,
    docker: live ? (containers?.length ?? null) : demoContainerCount,
  };

  // "Ask Hermes" from anywhere lands in the AI page's chat with the question filled in.
  const askHermes = (text) => {
    setDraft(text);
    setHermesTab('chat');
    setPage('hermes');
  };
  const onDraftUsed = useCallback(() => setDraft(''), []);

  let content;
  if (page === 'home') content = <Home conn={conn} needs={needs} onAsk={askHermes} onPage={setPage} />;
  else if (page === 'hermes') content = <AI tab={hermesTab} onTab={setHermesTab} draft={draft} onDraftUsed={onDraftUsed} hermesList={hermes.list} onSwitch={hermes.switchTo} onPage={setPage} context={{ host: server?.host, containers, needs: live ? needs : [] }} />;
  // Array & disks is a tab of Overview; its page id opens that tab.
  else if (page === 'overview' || page === 'array') content = <Overview conn={conn} server={server} history={history} tab={page} onTab={setPage} onAsk={askHermes} />;
  else if (page === 'docker') content = <Docker conn={conn} onPage={setPage} />;
  else if (page === 'settings') content = <Settings conn={conn} onConnect={() => setConnecting(true)} onChanged={refresh} hermesList={hermes.list} onHermesChanged={hermes.refresh} updater={updater} />;
  else if (page !== 'vms') content = <NotBuilt page={page} />;

  return (
    <div className="app hex">
      <div className="glow" aria-hidden="true" />
      <Sidebar page={page} onPage={setPage} counts={counts} />
      <main className="main">
        <TopBar conn={conn} server={server} updater={updater} onConnect={() => (desktop ? setPage('settings') : setConnecting(true))} onPage={setPage}>
          {conn.state !== 'live' && (
            <button className="btn md" onClick={() => (conn.state === 'signin' ? setConnecting(true) : desktop ? setPage('settings') : setConnecting(true))}>
              {conn.state === 'signin' ? 'Sign in' : 'Set up'}
            </button>
          )}
        </TopBar>
        <div className="edge" />
        {content && <div className="page-scroll">{content}</div>}
        {remoteOpen && (
          <div className="page-scroll" hidden={page !== 'vms'}>
            <Remote conn={conn} shown={page === 'vms'} />
          </div>
        )}
      </main>
      {connecting && <ConnectDialog conn={conn} onClose={() => setConnecting(false)} onChanged={refresh} />}
    </div>
  );
}
