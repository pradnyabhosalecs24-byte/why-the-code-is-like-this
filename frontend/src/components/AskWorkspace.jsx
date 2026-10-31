import { useRef, useState } from 'react';
import { api, fmtDate } from '../lib/api.js';
import { Notice, Spinner, StatusBadge, ExtLink, SyntheticBadge } from './ui.jsx';

const EXAMPLES = [
  'Why was this retry limit chosen?',
  'Which discussion explains this configuration flag?',
  'Who introduced this behaviour?',
  'Was the original decision later reversed?',
  'What evidence links this incident to the code change?',
  'What is known about this behaviour, and what remains uncertain?',
];

export default function AskWorkspace({ repo, synthetic = false, llm, model, onOpenGraph }) {
  const [q, setQ] = useState('');
  const [useLlm, setUseLlm] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [active, setActive] = useState(null);
  const abort = useRef(null);

  const ask = async (e) => {
    e?.preventDefault();
    if (q.trim().length < 3) return;
    abort.current?.abort();
    abort.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      setResult(await api.ask(repo, q.trim(), { useLlm, signal: abort.current.signal }));
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ask">
      <form className="ask-form" onSubmit={ask}>
        <label htmlFor="q" className="sr-only">Question</label>
        <textarea
          id="q"
          className="input ask-input"
          rows={2}
          placeholder="Ask why something is the way it is. Name the file, function, config key or PR if you can, e.g. “Why is MAX_RETRIES 3?”"
          value={q}
          maxLength={500}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) ask(e);
          }}
        />
        <div className="row between">
          <div className="chips">
            {EXAMPLES.map((ex) => (
              <button type="button" key={ex} className="chip" onClick={() => setQ(ex)}>
                {ex}
              </button>
            ))}
          </div>
          <div className="row">
            {llm && (
              <label className="small muted toggle">
                <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} /> explain with {model}
              </label>
            )}
            <button className="btn btn-primary" disabled={loading || q.trim().length < 3}>
              {loading ? 'Tracing…' : 'Trace'}
            </button>
          </div>
        </div>
      </form>

      {loading && <Spinner label="Finding seed entities, walking the graph, ranking evidence" />}
      {error && <Notice tone="danger">{error}</Notice>}
      {result && !loading && <Answer result={result} synthetic={synthetic} active={active} setActive={setActive} onOpenGraph={onOpenGraph} />}
    </div>
  );
}

function Answer({ result, synthetic, active, setActive, onOpenGraph }) {
  const { answer, confidence, evidence, decisions, retrieval, status, generator } = result;
  const insufficient = status === 'insufficient_evidence';
  return (
    <div className="answer-grid">
      <div className="answer-col">
        <article className={`card answer ${insufficient ? 'answer-insufficient' : ''}`}>
          <div className="row between">
            <span className="eyebrow">{insufficient ? 'No established reason' : 'Answer'}</span>
            <span className="small muted mono">{generator}</span>
          </div>
          <h2 className="headline">{answer.headline}</h2>
          {answer.claims.length > 0 && (
            <ul className="claims">
              {answer.claims.map((c, i) => (
                <li key={i}>
                  <span className={`badge badge-${c.basis === 'fact' ? 'fact' : 'inference'}`} title={c.basis === 'fact' ? 'Stated directly in the cited record or GitHub metadata' : 'Depends on links between records that TraceWhy inferred'}>
                    {c.basis === 'fact' ? 'fact' : 'inference'}
                  </span>
                  {c.text}{' '}
                  {c.citations.map((r) => (
                    <button key={r} className={`cite ${active === r ? 'on' : ''}`} onMouseEnter={() => setActive(r)} onFocus={() => setActive(r)} onClick={() => document.getElementById(`ev-${r}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                      {r}
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          )}
          {decisions[0]?.chain?.length > 1 && (
            <div>
              <span className="eyebrow">Reasoning chain</span>
              <div className="chain" aria-label="Reasoning chain from code entity to decision to evidence">
                {decisions[0].chain.map((c, i) => (
                  <span key={i} className="path-step">
                    {c.via && <span className={`path-rel ${c.origin}`} title={c.method?.replace(/_/g, ' ')}>{c.via} →</span>}
                    <span className="path-node">{c.name}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {answer.unknowns.length > 0 && (
            <div className="unknowns">
              <span className="eyebrow amber">Uncertain or not recorded</span>
              <ul>
                {answer.unknowns.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="row">
            {result.graph.nodes.length > 0 && (
              <button className="btn btn-ghost small" onClick={() => onOpenGraph({ kind: 'answer', graph: result.graph, title: result.question })}>
                Inspect supporting graph ({result.graph.nodes.length} nodes)
              </button>
            )}
          </div>
        </article>

        <Confidence c={confidence} />

        {decisions.length > 0 && (
          <section className="card">
            <span className="eyebrow">Decisions involved</span>
            {decisions.slice(0, 3).map((d) => (
              <div key={d.id} className="decision-mini">
                <div className="row between">
                  <span className="row">
                    <StatusBadge status={d.status} />
                    {d.confidenceScore != null && <span className="small muted" title={d.confidenceBasis}>decision confidence {d.confidenceLevel} ({d.confidenceScore}/100)</span>}
                  </span>
                  <span className="small muted">{fmtDate(d.date)}{d.author ? ` · ${d.author}` : ' · author not established'}</span>
                </div>
                <p className="statement">“{d.statement}”</p>
                <p className="small muted">{d.statusReason}</p>
                {d.supersededBy.map((s) => (
                  <p key={s.id} className="small supersede">
                    ↳ superseded {s.date ? `on ${fmtDate(s.date)}` : ''} by “{s.statement}” <span className="muted">({s.method?.replace(/_/g, ' ')})</span>
                  </p>
                ))}
                {d.supersedes.map((s) => (
                  <p key={s.id} className="small supersede">
                    ↳ replaced “{s.statement}” {s.date ? `from ${fmtDate(s.date)}` : ''} <span className="muted">({s.method?.replace(/_/g, ' ')})</span>
                  </p>
                ))}
              </div>
            ))}
          </section>
        )}

        <details className="card retrieval">
          <summary className="small">How this was retrieved</summary>
          <p className="small muted">
            Keywords: <span className="mono">{retrieval.keywords.join(', ') || '—'}</span>
            <br />
            Identifiers: <span className="mono">{retrieval.identifiers.join(', ') || '—'}</span>
            <br />
            Explored {retrieval.nodesExplored} nodes and {retrieval.relationshipsExplored} relationships from {retrieval.seeds.length} seed entities.
          </p>
          <ul className="small seeds">
            {retrieval.seeds.map((s) => (
              <li key={s.id}>
                <span className="mono">{s.label}</span> {s.id.split(':').slice(2).join(':') || s.id} <span className="muted">({s.reason})</span>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className="evidence-col">
        <span className="eyebrow">Evidence ({evidence.length})</span>
        {evidence.length === 0 && <p className="muted small">No evidence in the graph is connected to this question.</p>}
        {evidence.map((e) => (
          <EvidenceCard key={e.ref} e={e} synthetic={synthetic} active={active === e.ref} onHover={() => setActive(e.ref)} />
        ))}
      </div>
    </div>
  );
}

function EvidenceCard({ e, synthetic, active, onHover }) {
  return (
    <article id={`ev-${e.ref}`} className={`card evidence ${active ? 'active' : ''}`} onMouseEnter={onHover}>
      <div className="row between">
        <span className="row">
          <span className="ref mono">{e.ref}</span>
          <span className="rtype">{e.recordType}</span>
          {e.direct ? <span className="badge badge-direct">direct</span> : <span className="badge badge-linked">via graph</span>}
          {synthetic && <SyntheticBadge />}
        </span>
        <ExtLink href={e.url}>open</ExtLink>
      </div>
      {e.title && <p className="ev-title">{e.title}</p>}
      <blockquote className="excerpt">{e.excerpt}</blockquote>
      <p className="small muted">
        {e.author || 'author unknown'} · {fmtDate(e.date)}
      </p>
      {e.flags?.map((f) => (
        <p key={f} className="flag">⚠ {f}</p>
      ))}
      {e.path.length > 0 && <PathTrail e={e} />}
    </article>
  );
}

function Confidence({ c }) {
  return (
    <section className={`card confidence conf-${c.level}`}>
      <div className="row between">
        <span className="eyebrow">Confidence</span>
        <span className={`conf-level conf-${c.level}`}>{c.level}</span>
      </div>
      <p className="small">{c.explanation}</p>
      {c.factors.length > 0 && (
        <dl className="factors">
          {c.factors.map((f) => (
            <div key={f.name} title={f.note}>
              <dt>{f.name}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="tiny muted">{c.disclaimer}</p>
    </section>
  );
}

/** Walk the (undirected) path from the seed entity to this record and name each hop. */
function PathTrail({ e }) {
  let cur = e.seed.id;
  const steps = e.path.map((s, i) => {
    const forward = s.from === cur;
    const nextId = forward ? s.to : s.from;
    const name = i === e.path.length - 1 ? 'this record' : forward ? s.toName : s.fromName;
    cur = nextId;
    return { ...s, name, forward };
  });
  return (
    <div className="path" aria-label="Graph path from the question to this record">
      <span className="path-node">{e.seed.name}</span>
      {steps.map((s, i) => (
        <span key={i} className="path-step">
          <span className={`path-rel ${s.origin}`} title={`${s.origin}${s.method ? ' · ' + s.method.replace(/_/g, ' ') : ''}`}>
            {s.forward ? `${s.type} →` : `← ${s.type}`}
          </span>
          <span className="path-node">{s.name}</span>
        </span>
      ))}
    </div>
  );
}
