/**
 * SYNTHETIC TEST FIXTURE — not real history and never shown in the demo.
 * It has the same shape as the snapshot produced by services/github/fetchRepo.js
 * so the full pipeline can be tested without network access or credentials.
 */
const sha = (c) => c.repeat(40).slice(0, 40);
const U = 'https://github.com/example/retry-service';
const alice = { login: 'alice', name: 'alice', url: 'https://github.com/alice' };
const bob = { login: 'bob', name: 'bob', url: 'https://github.com/bob' };
const carol = { login: 'carol', name: 'carol', url: 'https://github.com/carol' };

export const SHAS = { c0: sha('a0'), c1: sha('b1'), c2: sha('c2'), c3: sha('d3'), c4: sha('e4'), c5: sha('f5'), c6: sha('a6'), c7: sha('b7'), c8: sha('c8') };

const commit = (id, date, author, message, files) => ({ sha: SHAS[id], date, author, message, url: `${U}/commit/${SHAS[id]}`, parents: [], files: files.map((p) => (typeof p === 'string' ? { path: p, status: 'modified', additions: 3, deletions: 1, previousPath: null } : p)) });

export function fixtureSnapshot() {
  return {
    repo: { id: 'example/retry-service', fullName: 'example/retry-service', owner: 'example', name: 'retry-service', url: U, description: 'fixture', defaultBranch: 'main', headSha: SHAS.c8, fetchedAt: '2024-03-01T00:00:00Z' },
    commits: [
      commit('c8', '2024-02-20T10:00:00Z', carol, 'Switch from 5000 to 8000 for timeoutMs to match the new gateway.', ['config/default.yml']),
      commit('c7', '2024-01-15T10:00:00Z', bob, 'Raise cache TTL (#10)', ['config/default.yml']),
      commit('c6', '2023-07-01T10:00:00Z', alice, `Revert "Switch to exponential backoff in fetchWithRetry"\n\nThis reverts commit ${SHAS.c3}.`, ['src/http/client.js']),
      commit('c3', '2023-06-01T10:00:00Z', bob, 'Switch to exponential backoff in fetchWithRetry\n\nWe switched to exponential backoff because fixed delays caused synchronized retries.', ['src/http/client.js']),
      commit('c5', '2023-04-02T10:00:00Z', alice, 'Set timeoutMs to 5000 (#7)', ['config/default.yml']),
      commit('c4', '2023-02-05T10:00:00Z', bob, 'Add price cache (#6)', ['config/default.yml', 'src/cache/prices.js']),
      commit('c2', '2023-03-01T10:00:00Z', alice, 'Reduce retries (#5)\n\nLimit MAX_RETRIES to 3 instead of 10 because retry storms overloaded the payments API.', ['src/http/client.js']),
      commit('c1', '2023-01-10T10:00:00Z', alice, 'Rename http helper', [{ path: 'src/http/client.js', status: 'renamed', previousPath: 'src/net/request.js', additions: 0, deletions: 0 }]),
      commit('c0', '2022-12-01T10:00:00Z', carol, 'Initial import', ['src/legacy/format.js', 'src/net/request.js']),
    ],
    pulls: [
      { number: 10, title: 'Raise cache TTL', body: 'Increase cache.ttlSeconds to 300 instead of 60. This replaces the setting from #6, since the pricing service now pushes invalidations.', state: 'closed', merged: true, mergedAt: '2024-01-15T10:00:00Z', createdAt: '2024-01-14T10:00:00Z', updatedAt: '2024-01-15T10:00:00Z', url: `${U}/pull/10`, author: bob, commitShas: [SHAS.c7], reviewComments: [], comments: [] },
      { number: 7, title: 'Set timeoutMs to 5000', body: 'Set timeoutMs to 5000 because the upstream p99 latency is 4 seconds.', state: 'closed', merged: true, mergedAt: '2023-04-02T10:00:00Z', createdAt: '2023-04-01T10:00:00Z', updatedAt: '2023-04-02T10:00:00Z', url: `${U}/pull/7`, author: alice, commitShas: [SHAS.c5], reviewComments: [], comments: [] },
      { number: 6, title: 'Add price cache', body: 'Set cache.ttlSeconds to 60 because prices older than a minute caused checkout mismatches.', state: 'closed', merged: true, mergedAt: '2023-02-05T10:00:00Z', createdAt: '2023-02-04T10:00:00Z', updatedAt: '2023-02-05T10:00:00Z', url: `${U}/pull/6`, author: bob, commitShas: [SHAS.c4], reviewComments: [], comments: [] },
      {
        number: 5, title: 'Reduce retries', body: 'We decided to limit MAX_RETRIES to 3 instead of 10.\n\nFixes #4', state: 'closed', merged: true, mergedAt: '2023-03-01T10:00:00Z', createdAt: '2023-02-28T10:00:00Z', updatedAt: '2023-03-01T10:00:00Z', url: `${U}/pull/5`, author: alice, commitShas: [SHAS.c2],
        reviewComments: [{ id: 51, body: 'Three attempts keeps worst-case latency under the 10s checkout budget.', author: carol, date: '2023-02-28T12:00:00Z', url: `${U}/pull/5#discussion_r51`, path: 'src/http/client.js' }],
        comments: [],
      },
    ],
    issues: [
      {
        number: 4, title: 'Outage: payments API overloaded by retry storm', body: 'During the outage every client retried 10 times and the payments API fell over.', state: 'closed', labels: ['incident'], createdAt: '2023-02-27T10:00:00Z', closedAt: '2023-03-01T10:00:00Z', updatedAt: '2023-03-01T10:00:00Z', url: `${U}/issues/4`, author: carol,
        comments: [], events: [{ type: 'cross-referenced', date: '2023-02-28T10:00:00Z', actor: alice, commitSha: null, sourceNumber: 5, sourceIsPull: true, sourceRepo: 'example/retry-service' }],
      },
    ],
    files: [
      { path: 'src/http/client.js', kind: 'source', size: 300, url: `${U}/blob/main/src/http/client.js`, content: 'export const MAX_RETRIES = 3;\n\nexport async function fetchWithRetry(url) {\n  for (let i = 0; i < MAX_RETRIES; i++) {}\n}\n' },
      { path: 'src/legacy/format.js', kind: 'source', size: 100, url: `${U}/blob/main/src/legacy/format.js`, content: 'function legacyFormatter(x) {\n  return String(x);\n}\n' },
      { path: 'src/cache/prices.js', kind: 'source', size: 100, url: `${U}/blob/main/src/cache/prices.js`, content: 'export class PriceCache {}\n' },
      { path: 'config/default.yml', kind: 'config', size: 100, url: `${U}/blob/main/config/default.yml`, content: 'http:\n  timeoutMs: 8000\ncache:\n  ttlSeconds: 300\n' },
      { path: 'docs/adr/0001-use-polling.md', kind: 'doc', size: 300, url: `${U}/blob/main/docs/adr/0001-use-polling.md`, content: '# 1. Use polling for price updates\n\n## Status\n\nSuperseded by ADR-0002\n\n## Context\n\nWe need price updates and the pricing service has no push API.\n\n## Decision\n\nWe will poll the pricing service every 30 seconds.\n' },
      { path: 'docs/adr/0002-use-webhooks.md', kind: 'doc', size: 300, url: `${U}/blob/main/docs/adr/0002-use-webhooks.md`, content: '# 2. Use webhooks for price updates\n\nDate: 2024-01-10\n\n## Status\n\nAccepted. Supersedes ADR-0001\n\n## Context\n\nThe pricing service now offers webhooks, which removes polling load.\n\n## Decision\n\nWe will receive price updates through webhooks.\n' },
    ],
    truncatedTree: false,
  };
}
