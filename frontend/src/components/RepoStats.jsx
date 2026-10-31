import { useEffect, useState } from 'react';
import { api, fmtDate } from '../lib/api.js';
import { Notice, Spinner, ExtLink } from './ui.jsx';

const ORDER = ['Decision', 'Evidence', 'Commit', 'PullRequest', 'Issue', 'Incident', 'File', 'Function', 'Configuration', 'Module', 'Person'];

export default function RepoStats({ repos, repo, onSelect, refreshKey, onCleared }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!repo) return;
    let live = true;
    setLoading(true);
    setError(null);
    api
      .stats(repo)
      .then((d) => live && setData(d))
      .catch((e) => live && (setError(e.message), setData(null)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [repo, refreshKey]);

  const clear = async () => {
    try {
      await api.clear(repo);
      setConfirming(false);
      onCleared();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <section className="panel">
      <h3 className="panel-title">Repositories</h3>
      {repos.length === 0 ? (
        <p className="muted small">Nothing imported yet.</p>
      ) : (
        <select className="input select" value={repo || ''} onChange={(e) => onSelect(e.target.value)} aria-label="Select repository">
          {repos.map((r) => {
            const id = r.id.replace(/^repo:/, '');
            return (
              <option key={id} value={id}>
                {r.name || id}{r.synthetic ? ' (synthetic demo)' : ''}
              </option>
            );
          })}
        </select>
      )}
      {loading && <Spinner label="Loading statistics" />}
      {error && <Notice tone="danger">{error}</Notice>}
      {data && repo && (
        <>
          <p className="small muted repo-meta">
            <ExtLink href={data.repo.url}>{data.repo.name}</ExtLink> · branch <span className="mono">{data.repo.defaultBranch}</span>
            <br />
            imported {fmtDate(data.repo.lastImportAt)}
          </p>
          <dl className="stats">
            {ORDER.filter((l) => data.stats.labels[l]).map((l) => (
              <div key={l} className="stat">
                <dt>{l}</dt>
                <dd className="mono">{data.stats.labels[l]}</dd>
              </div>
            ))}
          </dl>
          <div className="split-bar" title="Relationship provenance">
            <span style={{ flex: data.stats.origins.confirmed || 0 }} className="seg-confirmed" />
            <span style={{ flex: data.stats.origins.inferred || 0 }} className="seg-inferred" />
          </div>
          <p className="small muted">
            <span className="dot dot-confirmed" /> {data.stats.origins.confirmed || 0} confirmed links (structured record data) ·{' '}
            <span className="dot dot-inferred" /> {data.stats.origins.inferred || 0} inferred (parsed from text)
          </p>
          {data.stats.decisionStatus && (
            <p className="small">
              {Object.entries(data.stats.decisionStatus).map(([s, n]) => (
                <span key={s} className={`badge status-${s}`} style={{ marginRight: 6 }}>
                  {n} {s}
                </span>
              ))}
            </p>
          )}
          {!confirming ? (
            <button className="btn btn-ghost small" onClick={() => setConfirming(true)}>
              Remove this repository's data…
            </button>
          ) : (
            <div className="confirm">
              <span className="small">Delete all graph data for <b className="mono">{repo}</b>?</span>
              <div className="row">
                <button className="btn btn-danger small" onClick={clear}>Delete</button>
                <button className="btn btn-ghost small" onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
