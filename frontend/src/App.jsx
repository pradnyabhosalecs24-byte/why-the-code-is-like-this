import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api.js';
import Header from './components/Header.jsx';
import ImportPanel from './components/ImportPanel.jsx';
import RepoStats from './components/RepoStats.jsx';
import AskWorkspace from './components/AskWorkspace.jsx';
import DecisionsView from './components/DecisionsView.jsx';
import TimelineView from './components/TimelineView.jsx';
import GraphView from './components/GraphView.jsx';
import Overview from './components/Overview.jsx';
import { Notice } from './components/ui.jsx';

const TABS = [
  ['overview', 'Overview'],
  ['ask', 'Ask'],
  ['decisions', 'Decisions'],
  ['timeline', 'Timeline'],
  ['graph', 'Graph'],
];

export default function App() {
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);
  const [repos, setRepos] = useState([]);
  const [repo, setRepo] = useState(() => {
    try {
      return localStorage.getItem('tracewhy.repo') || null;
    } catch {
      return null;
    }
  });
  const [tab, setTab] = useState('overview');
  const [graphSeed, setGraphSeed] = useState(null); // {kind:'answer', graph} | {kind:'node', id}
  const [refreshKey, setRefreshKey] = useState(0);

  const loadHealth = useCallback(async () => {
    try {
      setHealth(await api.health());
      setHealthError(null);
    } catch (err) {
      setHealthError(err.message);
    }
  }, []);

  const loadRepos = useCallback(async () => {
    try {
      const { repos } = await api.repos();
      setRepos(repos);
      setRepo((cur) => (cur && repos.some((r) => r.id === `repo:${cur}`) ? cur : repos[0]?.id?.replace(/^repo:/, '') || null));
    } catch {
      setRepos([]);
    }
  }, []);

  useEffect(() => {
    loadHealth();
    loadRepos();
  }, [loadHealth, loadRepos]);

  useEffect(() => {
    try {
      if (repo) localStorage.setItem('tracewhy.repo', repo);
    } catch {
      /* storage unavailable */
    }
  }, [repo]);

  const onImported = (repoId) => {
    loadRepos();
    setRepo(repoId);
    setRefreshKey((k) => k + 1);
  };

  const openGraph = (seed) => {
    setGraphSeed(seed);
    setTab('graph');
  };

  const graphReady = health?.graph?.ok;
  const current = repos.find((r) => r.id === `repo:${repo}`);
  const synthetic = Boolean(current?.synthetic);
  const demo = health?.credentials?.demoMode;

  return (
    <div className="app">
      <Header health={health} healthError={healthError} onRetry={loadHealth} />
      <div className="layout">
        <aside className="sidebar">
          <ImportPanel disabled={!graphReady} githubToken={health?.credentials?.github} onImported={onImported} />
          <RepoStats
            repos={repos}
            repo={repo}
            onSelect={(r) => {
              setRepo(r);
              setGraphSeed(null);
            }}
            refreshKey={refreshKey}
            onCleared={() => {
              setRepo(null);
              loadRepos();
            }}
          />
        </aside>
        <main className="main">
          {healthError && <Notice tone="danger" title="Backend unreachable">{healthError} Start it with <code>npm run dev</code> in <code>backend/</code>.</Notice>}
          {demo && (
            <Notice tone="warn" title="Local demo mode">
              The graph is held in memory and pre-loaded with a synthetic repository. Not active:{' '}
              {[!health.credentials.neo4j && 'Neo4j AuraDB', !health.credentials.github && 'GitHub token', !health.credentials.llm && 'LLM (Sarvam AI / OpenAI)'].filter(Boolean).join(', ') || 'none'}
              {health.credentials.neo4j ? '' : '. Nothing is persisted.'}
            </Notice>
          )}
          {health && !demo && health.config?.errors?.length > 0 && (
            <Notice tone="warn" title="Configuration">
              {health.config.errors.join(' ')}
            </Notice>
          )}
          {health && !health.graph.ok && (
            <Notice tone="warn" title="Graph database not ready">
              {health.graph.message} See the README section “Configure Neo4j AuraDB”.
            </Notice>
          )}
          {!repo ? (
            <EmptyState />
          ) : (
            <>
              <nav className="tabs" role="tablist">
                {TABS.map(([id, label]) => (
                  <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>
                    {label}
                  </button>
                ))}
                <span className="tabs-repo mono">{repo}</span>
              </nav>
              {synthetic && (
                <div className="synthetic-banner" role="note">
                  <b>Synthetic demonstration data.</b> <span className="mono">{repo}</span> is a fictional, hand-written history shipped with TraceWhy to demonstrate each
                  scenario. It is not a GitHub repository and is never mixed with imported data.
                </div>
              )}
              <section className="tab-body">
                {tab === 'overview' && <Overview repo={repo} refreshKey={refreshKey} synthetic={synthetic} onOpenGraph={openGraph} onAsk={() => setTab('ask')} />}
                {tab === 'ask' && <AskWorkspace repo={repo} synthetic={synthetic} llm={health?.credentials?.llm} model={health?.credentials?.llmModel} onOpenGraph={openGraph} />}
                {tab === 'decisions' && <DecisionsView repo={repo} refreshKey={refreshKey} onOpenGraph={openGraph} />}
                {tab === 'timeline' && <TimelineView repo={repo} refreshKey={refreshKey} onOpenGraph={openGraph} />}
                {tab === 'graph' && <GraphView repo={repo} seed={graphSeed} onSeed={setGraphSeed} />}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <h2>Reconstruct why the code is like this</h2>
      <p>
        Import a public GitHub repository. TraceWhy builds a knowledge graph of its commits, pull requests, issues, docs and code,
        extracts engineering decisions, and answers questions only from evidence you can open.
      </p>
      <ol className="steps">
        <li>Paste a repository URL on the left and start the import.</li>
        <li>Ask why something is the way it is.</li>
        <li>Open the cited records and inspect the graph path behind each answer.</li>
      </ol>
    </div>
  );
}
