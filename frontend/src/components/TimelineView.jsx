import { useEffect, useState } from 'react';
import { api, fmtDate } from '../lib/api.js';
import { Notice, Spinner, StatusBadge, ExtLink, LabelTag } from './ui.jsx';

const KINDS = ['Decision', 'Incident', 'PullRequest', 'Issue'];

export default function TimelineView({ repo, refreshKey, onOpenGraph }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);
  const [kinds, setKinds] = useState(new Set(['Decision', 'Incident']));

  useEffect(() => {
    let live = true;
    setEvents(null);
    api.timeline(repo).then((d) => live && setEvents(d.events)).catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [repo, refreshKey]);

  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!events) return <Spinner label="Loading timeline" />;

  const shown = events.filter((e) => kinds.has(e.label));
  const toggle = (k) => setKinds((s) => {
    const n = new Set(s);
    n.has(k) ? n.delete(k) : n.add(k);
    return n;
  });

  let lastMonth = null;
  return (
    <div>
      <div className="chips toolbar">
        {KINDS.map((k) => (
          <button key={k} className={`chip ${kinds.has(k) ? 'on' : ''}`} onClick={() => toggle(k)}>
            {k}
          </button>
        ))}
      </div>
      {!shown.length && <p className="muted">No dated records of the selected kinds.</p>}
      <ol className="timeline">
        {shown.map((e) => {
          const month = e.date.slice(0, 7);
          const header = month !== lastMonth ? (lastMonth = month) : null;
          return (
            <li key={e.id}>
              {header && <div className="tl-month mono">{new Date(e.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}</div>}
              <div className={`tl-item tl-${e.label}`}>
                <span className="tl-date small muted mono">{fmtDate(e.date)}</span>
                <div className="tl-body">
                  <div className="row">
                    <LabelTag label={e.label} />
                    {e.label === 'Decision' ? <StatusBadge status={e.status} /> : e.status && <span className="small muted">{e.status}</span>}
                  </div>
                  <p className="tl-title">{e.title}</p>
                  <div className="row">
                    <ExtLink href={e.url}>open</ExtLink>
                    <button className="btn btn-ghost small" onClick={() => onOpenGraph({ kind: 'node', id: e.id })}>graph</button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
