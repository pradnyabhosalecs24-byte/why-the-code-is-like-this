import { useEffect, useMemo, useState } from 'react';
import { api, fmtDate } from '../lib/api.js';
import { Notice, Spinner, StatusBadge, ExtLink } from './ui.jsx';

const FILTERS = ['all', 'active', 'superseded', 'disputed', 'unknown'];

export default function DecisionsView({ repo, refreshKey, onOpenGraph }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [text, setText] = useState('');

  useEffect(() => {
    let live = true;
    setList(null);
    api.decisions(repo).then((d) => live && setList(d.decisions)).catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [repo, refreshKey]);

  const byId = useMemo(() => new Map((list || []).map((d) => [d.id, d])), [list]);
  const shown = (list || []).filter((d) => (filter === 'all' || d.status === filter) && (!text || d.statement.toLowerCase().includes(text.toLowerCase())));

  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!list) return <Spinner label="Loading decisions" />;
  if (!list.length) return <p className="muted">No decision language was found in this repository's imported history.</p>;

  return (
    <div>
      <div className="row between toolbar">
        <div className="chips">
          {FILTERS.map((f) => (
            <button key={f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
              {f} {f !== 'all' && <span className="muted">{list.filter((d) => d.status === f).length}</span>}
            </button>
          ))}
        </div>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Filter text" value={text} onChange={(e) => setText(e.target.value)} aria-label="Filter decisions" />
      </div>
      <p className="small muted">
        Candidates are extracted verbatim from commits, PRs, issues and ADRs. A decision is “superseded” only when a later record explicitly reverts or replaces it.
      </p>
      <div className="decision-list">
        {shown.map((d) => (
          <article key={d.id} className="card decision">
            <div className="row between">
              <span className="row">
                <StatusBadge status={d.status} />
                <span className="small muted">{d.extractionMethod === 'adr' ? 'ADR' : d.sourceType?.replace(/_/g, ' ')}</span>
              </span>
              <span className="small muted">
                {fmtDate(d.date)} {d.author ? `· ${d.author}` : ''}
              </span>
            </div>
            <p className="statement">“{d.statement}”</p>
            {d.rationale && d.rationale !== d.statement ? <p className="small"><span className="muted">Rationale: </span>“{d.rationale}”</p> : !d.rationale && <p className="small amber">No rationale recorded in the source.</p>}
            {d.alternatives?.length > 0 && <p className="small"><span className="muted">Alternative: </span>{d.alternatives.join('; ')}</p>}
            <p className="small muted">{d.statusReason}</p>
            {d.confidenceScore != null && (
              <p className="small muted" title={d.confidenceBasis}>
                Decision confidence: <b className={`conf-${d.confidenceLevel}`}>{d.confidenceLevel}</b> ({d.confidenceScore}/100 rule-based points, not a probability) · {d.confidenceBasis}
              </p>
            )}
            {!d.author && <p className="small muted">Author not established by the evidence.</p>}
            {d.supersededBy?.map((id) => byId.get(id) && <p key={id} className="small supersede">↳ superseded by “{byId.get(id).statement}” ({fmtDate(byId.get(id).date)})</p>)}
            {d.supersedes?.map((id) => byId.get(id) && <p key={id} className="small supersede">↳ replaces “{byId.get(id).statement}” ({fmtDate(byId.get(id).date)})</p>)}
            <div className="row">
              <ExtLink href={d.url}>source record</ExtLink>
              <button className="btn btn-ghost small" onClick={() => onOpenGraph({ kind: 'node', id: d.id })}>graph</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
