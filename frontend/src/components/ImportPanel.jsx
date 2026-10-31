import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Notice, Spinner } from './ui.jsx';

const STAGES = ['connecting', 'fetching', 'repository', 'commits', 'pulls', 'issues', 'files', 'building', 'writing', 'done'];

export default function ImportPanel({ disabled, githubToken, onImported }) {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState('incremental');
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const poll = (id) => {
    timer.current = setTimeout(async () => {
      try {
        const { job } = await api.job(id);
        setJob(job);
        if (job.status === 'running') poll(id);
        else if (job.status === 'done') onImported(job.repo);
      } catch (err) {
        setError(err.message);
      }
    }, 1200);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const { job } = await api.startImport(url.trim(), mode);
      setJob(job);
      poll(job.id);
    } catch (err) {
      setError(err.message);
    }
  };

  const running = job?.status === 'running';
  const stageIdx = job ? Math.max(0, STAGES.indexOf(job.stage)) : 0;

  return (
    <section className="panel">
      <h3 className="panel-title">Import repository</h3>
      <form onSubmit={submit} className="import-form">
        <label htmlFor="repo-url" className="sr-only">GitHub repository URL</label>
        <input
          id="repo-url"
          className="input mono"
          placeholder="https://github.com/owner/repo"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={running}
          required
          maxLength={300}
        />
        <div className="row">
          <select className="input select" value={mode} onChange={(e) => setMode(e.target.value)} disabled={running} aria-label="Import mode">
            <option value="incremental">Incremental update</option>
            <option value="full">Full re-import</option>
          </select>
          <button className="btn btn-primary" disabled={disabled || running || !url.trim()}>
            {running ? 'Importing…' : 'Import'}
          </button>
        </div>
      </form>
      {!githubToken && <p className="hint">No GITHUB_TOKEN: GitHub allows 60 requests/hour, enough only for very small repos.</p>}
      {error && <Notice tone="danger">{error}</Notice>}
      {job && (
        <div className="job">
          <div className="progress" aria-hidden="true">
            <div className={`progress-bar ${job.status}`} style={{ width: `${job.status === 'done' ? 100 : (stageIdx / (STAGES.length - 1)) * 100}%` }} />
          </div>
          <div className="job-line">
            {running ? <Spinner label={job.stage} /> : <span className={`badge status-${job.status === 'done' ? 'active' : 'disputed'}`}>{job.status}</span>}
            <span className="muted small">{job.detail}</span>
          </div>
          {job.status === 'failed' && <Notice tone="danger" title={job.error?.code}>{job.error?.message}</Notice>}
          {job.status === 'done' && job.result && <ImportResult r={job.result} />}
        </div>
      )}
    </section>
  );
}

function ImportResult({ r }) {
  const f = r.fetched || {};
  const p = r.processed || {};
  return (
    <div className="import-result">
      {r.emptyHistory && <Notice tone="warn">This repository has no commit history yet, so there is nothing to explain.</Notice>}
      <div className="import-counts">
        <div title="Records received from GitHub in this run">
          <span className="muted">fetched</span>
          <b>{(f.commits || 0) + (f.pulls || 0) + (f.issues || 0)}</b>
          <span className="tiny muted">{f.commits || 0} commits · {f.pulls || 0} PRs · {f.issues || 0} issues · {f.comments || 0} comments</span>
        </div>
        <div title="Records now represented in the knowledge graph">
          <span className="muted">processed</span>
          <b>{(p.commits || 0) + (p.pulls || 0) + (p.issues || 0)}</b>
          <span className="tiny muted">{p.evidence || 0} evidence · {p.decisions || 0} decisions · {p.relationships || 0} links</span>
        </div>
        <div title="Sub-records that failed or exceeded a limit; the import continued without them">
          <span className="muted">skipped</span>
          <b>{r.skipped?.count || 0}</b>
          <span className="tiny muted">{Object.entries(r.skipped?.byType || {}).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(' · ') || 'none'}</span>
        </div>
      </div>
      {r.githubRequests ? <p className="tiny muted">{r.githubRequests} GitHub API requests</p> : null}
    </div>
  );
}
