import { useEffect, useState } from 'react';
import { api, fmtDate } from '../lib/api.js';
import { Notice, Spinner, StatusBadge, ExtLink, SyntheticBadge } from './ui.jsx';

/** Dashboard: what was imported, and the records most worth asking about. */
export default function Overview({ repo, refreshKey, synthetic, onOpenGraph, onAsk }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    Promise.all([api.stats(repo), api.decisions(repo), api.timeline(repo)])
      .then(([s, d, t]) => live && setData({ stats: s.stats, decisions: d.decisions, events: t.events }))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [repo, refreshKey]);

  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return <Spinner label="Loading overview" />;
  const L = data.stats.labels;
  const counts = [
    ['Commits', L.Commit], ['Pull requests', L.PullRequest], ['Issues', L.Issue], ['Incidents', L.Incident],
    ['Decisions', L.Decision], ['Evidence records', L.Evidence], ['Evidence links', (data.stats.origins.confirmed || 0) + (data.stats.origins.inferred || 0)], ['People', L.Person],
  ];
  const empty = !L.Commit && !L.PullRequest && !L.Issue;
  const prs = data.events.filter((e) => e.label === 'PullRequest').slice(0, 6);
  const incidents = data.events.filter((e) => e.label === 'Incident').slice(0, 6);

  return (
    <div>
      <div className="counts">
        {counts.map(([k, v]) => (
          <div className="count" key={k}>
            <b>{v || 0}</b>
            <span>{k}</span>
          </div>
        ))}
      </div>
      {empty && <p className="muted">This repository has no imported history yet. Run an incremental import, or check the import result for skipped records.</p>}
      <div className="overview-grid">
        <section className="card">
          <div className="row between">
            <span className="eyebrow">Recent decisions</span>
            <button className="btn btn-ghost small" onClick={onAsk}>Ask why →</button>
          </div>
          {data.decisions.length === 0 ? (
            <p className="small muted">No decision language was found in the imported history.</p>
          ) : (
            <ul className="mini-list">
              {data.decisions.slice(0, 6).map((d) => (
                <li key={d.id}>
                  <StatusBadge status={d.status} />
                  <span className="t" title={d.statement}>{d.statement}</span>
                  <button className="btn btn-ghost small" onClick={() => onOpenGraph({ kind: 'node', id: d.id })}>graph</button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <span className="eyebrow">Incidents</span>
          {incidents.length === 0 ? (
            <p className="small muted">No issues labelled or titled as incidents.</p>
          ) : (
            <ul className="mini-list">
              {incidents.map((e) => (
                <li key={e.id}>
                  <span className="t" title={e.title}>{e.title}</span>
                  <span className="small muted">{fmtDate(e.date)}</span>
                  <ExtLink href={e.url}>open</ExtLink>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <div className="row between">
            <span className="eyebrow">Pull requests</span>
            {synthetic && <SyntheticBadge />}
          </div>
          {prs.length === 0 ? (
            <p className="small muted">No pull requests imported.</p>
          ) : (
            <ul className="mini-list">
              {prs.map((e) => (
                <li key={e.id}>
                  <span className="t" title={e.title}>{e.title}</span>
                  <span className="small muted">{fmtDate(e.date)}</span>
                  <ExtLink href={e.url}>open</ExtLink>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
