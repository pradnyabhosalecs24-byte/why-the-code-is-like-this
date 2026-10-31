import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app.js';
import { createMemoryStore } from '../../src/services/graph/memoryStore.js';
import { buildGraph } from '../../src/services/graph/buildGraph.js';
import { fixtureSnapshot } from '../fixtures/snapshot.js';
import { config } from '../../src/config/env.js';

let server;
let base;
const store = createMemoryStore();

before(async () => {
  await store.upsertGraph('example/retry-service', buildGraph(fixtureSnapshot()));
  const app = createApp({ getStore: () => store, llm: null });
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

const call = async (path, opts = {}) => {
  const res = await fetch(base + path, { headers: { 'content-type': 'application/json' }, ...opts });
  return { status: res.status, body: await res.json() };
};

test('health never leaks secrets', async () => {
  const { status, body } = await call('/health');
  assert.equal(status, 200);
  for (const v of Object.values(body.credentials)) assert.ok(typeof v === 'boolean' || typeof v === 'string' || v === null);
  assert.equal(body.graph.ok, true);
  const text = JSON.stringify(body);
  for (const secret of [config.github.token, config.neo4j.password, config.neo4j.uri, config.openai.apiKey].filter((v) => v && v.length > 3)) {
    assert.ok(!text.includes(secret), 'a configured secret value appears in /health');
  }
});

test('stats, decisions, timeline and graph endpoints', async () => {
  const s = await call('/repos/example/retry-service/stats');
  assert.equal(s.status, 200);
  assert.ok(s.body.stats.labels.Decision > 0);
  const d = await call('/repos/example/retry-service/decisions');
  assert.ok(d.body.decisions.some((x) => x.status === 'superseded'));
  const t = await call('/repos/example/retry-service/timeline');
  assert.ok(t.body.events.length > 0);
  const g = await call('/repos/example/retry-service/graph');
  assert.ok(g.body.nodes.length > 0 && g.body.rels.length > 0);
  const n = await call(`/repos/example/retry-service/graph?node=${encodeURIComponent('cfg:example/retry-service:src/http/client.js#MAX_RETRIES')}`);
  assert.ok(n.body.nodes.length > 1);
});

test('ask endpoint returns cited answer; no-evidence answer is honest', async () => {
  const a = await call('/repos/example/retry-service/ask', { method: 'POST', body: JSON.stringify({ question: 'Why is MAX_RETRIES set to 3?' }) });
  assert.equal(a.status, 200);
  assert.equal(a.body.status, 'answered');
  assert.ok(a.body.graph.nodes.length > 0);
  const b = await call('/repos/example/retry-service/ask', { method: 'POST', body: JSON.stringify({ question: 'Why was legacyFormatter not migrated?' }) });
  assert.equal(b.body.status, 'insufficient_evidence');
});

test('validation and structured errors', async () => {
  assert.equal((await call('/repos/import', { method: 'POST', body: JSON.stringify({ url: 'not a url' }) })).status, 400);
  assert.equal((await call('/repos/example/retry-service/ask', { method: 'POST', body: JSON.stringify({ question: 'x' }) })).status, 400);
  const nf = await call('/repos/nobody/nothing/stats');
  assert.equal(nf.status, 404);
  assert.equal(nf.body.error.code, 'NOT_FOUND');
  const bad = await fetch(base + '/repos/example/retry-service/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  assert.equal(bad.status, 400);
  const del = await call('/repos/example/retry-service', { method: 'DELETE', body: JSON.stringify({}) });
  assert.equal(del.status, 400, 'deletion needs explicit confirmation');
});
