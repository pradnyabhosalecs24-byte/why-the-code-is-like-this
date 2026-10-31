import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient, parseLinkHeader } from '../../src/services/github/client.js';

const response = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

test('parseLinkHeader', () => {
  const l = parseLinkHeader('<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=5>; rel="last"');
  assert.equal(l.next, 'https://api.github.com/x?page=2');
});

test('paginate follows next links and respects max', async () => {
  const pages = {
    'https://api.github.com/items': response(200, [1, 2], { link: '<https://api.github.com/items?page=2>; rel="next"' }),
    'https://api.github.com/items?page=2': response(200, [3, 4], {}),
  };
  const gh = createGitHubClient({ fetchImpl: async (u) => pages[u], sleep: async () => {} });
  assert.deepEqual(await gh.paginate('/items'), [1, 2, 3, 4]);
  assert.deepEqual(await gh.paginate('/items', { max: 3 }), [1, 2, 3]);
});

test('retries 5xx then succeeds', async () => {
  let n = 0;
  const gh = createGitHubClient({ fetchImpl: async () => (++n < 3 ? response(502, {}) : response(200, { ok: 1 })), sleep: async () => {} });
  assert.deepEqual(await gh.get('/x'), { ok: 1 });
  assert.equal(n, 3);
});

test('waits for short rate-limit resets, fails clearly on long ones', async () => {
  let waited = 0;
  let n = 0;
  const gh = createGitHubClient({ fetchImpl: async () => (++n === 1 ? response(403, {}, { 'x-ratelimit-remaining': '0', 'retry-after': '2' }) : response(200, [])), sleep: async (ms) => (waited += ms) });
  await gh.get('/x');
  assert.equal(waited, 2000);
  const reset = String(Math.floor(Date.now() / 1000) + 3600);
  const gh2 = createGitHubClient({ fetchImpl: async () => response(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }), sleep: async () => {} });
  await assert.rejects(gh2.get('/x'), (e) => e.code === 'GITHUB_RATE_LIMIT' && /GITHUB_TOKEN/.test(e.message));
});

test('404 maps to a readable error and non-GitHub URLs are refused', async () => {
  const gh = createGitHubClient({ fetchImpl: async () => response(404, { message: 'Not Found' }), sleep: async () => {} });
  await assert.rejects(gh.get('/repos/a/b'), (e) => e.code === 'GITHUB_NOT_FOUND');
  await assert.rejects(gh.get('https://evil.example.com/x'), (e) => e.code === 'BAD_URL');
});
