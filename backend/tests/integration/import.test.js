// Runs the real import job (fetch -> build -> write) against a simulated GitHub REST API.
import '../helpers/tmpCache.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient } from '../../src/services/github/client.js';
import { startImport, getJob } from '../../src/services/importer.js';
import { createMemoryStore } from '../../src/services/graph/memoryStore.js';
import { answerQuestion } from '../../src/services/answer/answerer.js';

const A = 'https://api.github.com/repos/demo/app';
const sha1 = '1'.repeat(40);
const sha2 = '2'.repeat(40);
const user = (login) => ({ login, html_url: `https://github.com/${login}` });
const routes = {
  [A]: { full_name: 'demo/app', name: 'app', owner: { login: 'demo' }, html_url: 'https://github.com/demo/app', default_branch: 'main', private: false, description: '' },
  [`${A}/commits?per_page=100&sha=main`]: [
    { sha: sha2, html_url: `https://github.com/demo/app/commit/${sha2}`, author: user('bo'), parents: [], commit: { message: 'Use a 30s timeout (#3)', author: { date: '2024-02-01T00:00:00Z', name: 'bo' } } },
    { sha: sha1, html_url: `https://github.com/demo/app/commit/${sha1}`, author: null, parents: [], commit: { message: 'init', author: { date: '2024-01-01T00:00:00Z', name: 'Ann' } } },
  ],
  [`${A}/commits/${sha2}`]: { files: [{ filename: 'src/net.js', status: 'modified', additions: 1, deletions: 1 }] },
  [`${A}/commits/${sha1}`]: { files: [{ filename: 'src/net.js', status: 'added', additions: 10, deletions: 0 }] },
  [`${A}/pulls?state=all&sort=updated&direction=desc&per_page=100`]: [
    { number: 3, title: 'Use a 30s timeout', body: 'We decided to set REQUEST_TIMEOUT to 30 because the export job takes 20s. Closes #2', state: 'closed', merged_at: '2024-02-01T00:00:00Z', created_at: '2024-01-30T00:00:00Z', updated_at: '2024-02-01T00:00:00Z', html_url: 'https://github.com/demo/app/pull/3', user: user('bo'), comments: 0 },
  ],
  [`${A}/pulls/3/commits?per_page=100`]: [{ sha: sha2 }],
  [`${A}/pulls/3/comments?per_page=100`]: [],
  [`${A}/issues?state=all&sort=updated&direction=desc&per_page=100`]: [
    { number: 3, pull_request: {}, title: 'pr' },
    { number: 2, title: 'Exports time out', body: 'Exports fail after 10s.', state: 'closed', labels: [{ name: 'bug' }], created_at: '2024-01-20T00:00:00Z', closed_at: '2024-02-01T00:00:00Z', updated_at: '2024-02-01T00:00:00Z', html_url: 'https://github.com/demo/app/issues/2', user: user('cy'), comments: 0 },
  ],
  [`${A}/issues/2/timeline?per_page=100`]: [{ event: 'cross-referenced', created_at: '2024-01-30T00:00:00Z', actor: user('bo'), source: { issue: { number: 3, pull_request: {}, repository: { full_name: 'demo/app' } } } }],
  [`${A}/git/trees/main?recursive=1`]: { tree: [{ type: 'blob', path: 'src/net.js', size: 40 }, { type: 'blob', path: 'logo.png', size: 999 }] },
  [`${A}/contents/src/net.js?ref=main`]: 'export const REQUEST_TIMEOUT = 30;\n',
};
const fetchImpl = async (url) => {
  const body = routes[url];
  return {
    ok: body !== undefined,
    status: body !== undefined ? 200 : 404,
    headers: { get: (k) => (k === 'x-ratelimit-remaining' ? '4999' : null) },
    json: async () => body ?? { message: 'Not Found' },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
};

test('import job ingests GitHub data into the graph and answers from it', async () => {
  const store = createMemoryStore();
  const gh = createGitHubClient({ fetchImpl, sleep: async () => {} });
  const job = startImport({ store, repoRef: { owner: 'demo', name: 'app', id: 'demo/app' }, mode: 'full', githubClient: gh });
  for (let i = 0; i < 100 && getJob(job.id).status === 'running'; i++) await new Promise((r) => setTimeout(r, 10));
  const done = getJob(job.id);
  assert.equal(done.status, 'done', JSON.stringify(done.error));
  assert.equal(done.result.fetched.issues, 1, 'pull requests are filtered out of the issues list');

  const stats = await store.stats('demo/app');
  assert.equal(stats.labels.PullRequest, 1);
  assert.equal(stats.labels.Configuration, 1);
  assert.ok(stats.relTypes.DISCUSSED_IN >= 1 && stats.relTypes.RELATED_TO >= 1);

  const a = await answerQuestion({ store, repo: 'demo/app', question: 'Why is REQUEST_TIMEOUT 30?' });
  assert.equal(a.status, 'answered');
  assert.ok(a.evidence.some((e) => e.url === 'https://github.com/demo/app/pull/3'));
  assert.ok(a.evidence.some((e) => e.url === 'https://github.com/demo/app/issues/2'), 'linked issue reached via the graph');
});

test('import reports GitHub errors clearly', async () => {
  const store = createMemoryStore();
  const gh = createGitHubClient({ fetchImpl, sleep: async () => {} });
  const job = startImport({ store, repoRef: { owner: 'demo', name: 'missing', id: 'demo/missing' }, mode: 'full', githubClient: gh });
  for (let i = 0; i < 100 && getJob(job.id).status === 'running'; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(getJob(job.id).status, 'failed');
  assert.equal(getJob(job.id).error.code, 'GITHUB_NOT_FOUND');
});
