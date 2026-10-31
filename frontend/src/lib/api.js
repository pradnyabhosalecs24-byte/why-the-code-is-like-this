/** Thin client for the TraceWhy backend. All calls go through the Vite /api proxy. */

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'BACKEND_UNREACHABLE', 'Cannot reach the TraceWhy backend. Is it running on port 4000?');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code || 'HTTP_ERROR', data?.error?.message || `Request failed (${res.status})`);
  }
  return data;
}

const repoPath = (repoId) => `/repos/${repoId.split('/').map(encodeURIComponent).join('/')}`;

export const api = {
  health: () => request('/health'),
  repos: () => request('/repos'),
  startImport: (url, mode) => request('/repos/import', { method: 'POST', body: { url, mode } }),
  job: (id) => request(`/jobs/${encodeURIComponent(id)}`),
  stats: (repo) => request(`${repoPath(repo)}/stats`),
  decisions: (repo) => request(`${repoPath(repo)}/decisions`),
  timeline: (repo) => request(`${repoPath(repo)}/timeline`),
  graph: (repo, node) => request(`${repoPath(repo)}/graph${node ? `?node=${encodeURIComponent(node)}` : ''}`),
  node: (repo, id) => request(`${repoPath(repo)}/nodes?id=${encodeURIComponent(id)}`),
  ask: (repo, question, opts = {}) => request(`${repoPath(repo)}/ask`, { method: 'POST', body: { question, ...opts }, signal: opts.signal }),
  clear: (repo) => request(repoPath(repo), { method: 'DELETE', body: { confirm: repo } }),
};

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'date unknown');

export const LABEL_COLORS = {
  Decision: 'var(--mint)',
  Evidence: 'var(--text-2)',
  PullRequest: 'var(--blue)',
  Issue: 'var(--violet)',
  Incident: 'var(--amber)',
  Commit: 'var(--slate)',
  File: 'var(--sand)',
  Function: 'var(--sand)',
  Configuration: 'var(--sand)',
  Module: 'var(--slate)',
  Person: 'var(--rose)',
  Repository: 'var(--mint)',
};
