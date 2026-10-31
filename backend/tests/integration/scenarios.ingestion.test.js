// Brief §8.A — repository and ingestion scenarios (simulated GitHub API; no network).
import '../helpers/tmpCache.js';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient } from '../../src/services/github/client.js';
import { startImport, getJob } from '../../src/services/importer.js';
import { createMemoryStore } from '../../src/services/graph/memoryStore.js';
import { parseRepoInput } from '../../src/middleware/validate.js';
import { validateConfig } from '../../src/config/env.js';
import { baseRoutes, fakeFetch, waitForJob } from '../helpers/fakeGitHub.js';

const A = 'https://api.github.com/repos/demo/app';
const ref = { owner: 'demo', name: 'app', id: 'demo/app' };
const run = async (routes, { store = createMemoryStore(), mode = 'full' } = {}) => {
  const gh = createGitHubClient({ fetchImpl: fakeFetch(routes), sleep: async () => {}, maxRateLimitWaitMs: 0 });
  const job = startImport({ store, repoRef: ref, mode, githubClient: gh });
  return { job: await waitForJob(getJob, job.id), store };
};

describe('A. Repository and ingestion', () => {
  test('valid public repository imports and reports fetched / processed / skipped', async () => {
    const { job } = await run(baseRoutes());
    assert.equal(job.status, 'done');
    assert.equal(job.result.fetched.commits, 1);
    assert.equal(job.result.fetched.pulls, 1);
    assert.equal(job.result.processed.commits, 1);
    assert.equal(job.result.processed.pulls, 1);
    assert.equal(job.result.skipped.count, 0);
  });

  test('invalid repository URL is rejected before any network call', () => {
    for (const bad of ['', 'not a url', 'https://gitlab.com/a/b', 'https://github.com/only-owner', 'a/b/../../x', 'x'.repeat(400)]) {
      assert.throws(() => parseRepoInput(bad), undefined, bad);
    }
  });

  test('nonexistent repository fails with a clear error', async () => {
    const { job } = await run({});
    assert.equal(job.status, 'failed');
    assert.equal(job.error.code, 'GITHUB_NOT_FOUND');
  });

  test('repository with empty history completes with zero records', async () => {
    const routes = baseRoutes();
    routes[`${A}/commits?per_page=100&sha=main`] = { status: 409, body: { message: 'Git Repository is empty.' } };
    routes[`${A}/git/trees/main?recursive=1`] = { status: 409, body: { message: 'Git Repository is empty.' } };
    const { job } = await run(routes);
    assert.equal(job.status, 'done');
    assert.equal(job.result.emptyHistory, true);
    assert.equal(job.result.processed.commits, 0);
  });

  test('duplicate ingestion does not create duplicate nodes', async () => {
    const store = createMemoryStore();
    await run(baseRoutes(), { store });
    const first = await store.stats('demo/app');
    await run(baseRoutes(), { store, mode: 'incremental' });
    const second = await store.stats('demo/app');
    assert.deepEqual(second.labels, first.labels);
  });

  test('API rate limiting stops the import with a reset time and token hint', async () => {
    const routes = baseRoutes();
    routes[`${A}/commits?per_page=100&sha=main`] = { status: 403, body: {}, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) } };
    const { job } = await run(routes);
    assert.equal(job.status, 'failed');
    assert.equal(job.error.code, 'GITHUB_RATE_LIMIT');
  });

  test('network timeout is reported as GITHUB_TIMEOUT after retries', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const fetchImpl = fakeFetch({ [A]: () => timeout });
    const gh = createGitHubClient({ fetchImpl, sleep: async () => {} });
    await assert.rejects(gh.get('/repos/demo/app'), (e) => e.code === 'GITHUB_TIMEOUT');
    assert.equal(fetchImpl.calls.length, 4, '1 attempt + 3 retries');
  });

  test('missing or malformed credentials are reported without exposing them', async () => {
    const base = { graphBackend: 'neo4j', demoMode: false, neo4j: { uri: '', password: '' }, github: { token: '' }, openai: { apiKey: '' } };
    assert.match(validateConfig(base).errors[0], /Neo4j is not configured/);
    const malformed = validateConfig({ ...base, neo4j: { uri: 'http://wrong', password: 'pw-123456' }, github: { token: 'hello' }, openai: { apiKey: 'nope' } });
    assert.match(malformed.errors.join(' '), /NEO4J_URI is malformed/);
    assert.match(malformed.warnings.join(' '), /GITHUB_TOKEN does not look like/);
    assert.match(malformed.warnings.join(' '), /OPENAI_API_KEY does not look like/);
    assert.ok(!JSON.stringify(malformed).includes('pw-123456'));
    // GitHub rejects the token
    const { job } = await run({ [A]: { status: 401, body: { message: 'Bad credentials' } } });
    assert.equal(job.error.code, 'GITHUB_BAD_TOKEN');
  });

  test('partial ingestion failure: a failing sub-resource is skipped and counted, import completes', async () => {
    const routes = baseRoutes();
    routes[`${A}/pulls/3/comments?per_page=100`] = { status: 500, body: { message: 'boom' } };
    const { job, store } = await run(routes);
    assert.equal(job.status, 'done');
    assert.equal(job.result.skipped.count, 1);
    assert.equal(job.result.skipped.byType.pr_review_comments, 1);
    assert.equal((await store.stats('demo/app')).labels.PullRequest, 1);
  });
});
