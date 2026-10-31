// Brief §8.C (graph) and §8.D (API & security).
import '../helpers/tmpCache.js';
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, safeUrl } from '../../src/services/graph/buildGraph.js';
import { createMemoryStore } from '../../src/services/graph/memoryStore.js';
import { createNeo4jStore } from '../../src/services/graph/neo4jStore.js';
import { answerQuestion } from '../../src/services/answer/answerer.js';
import { luceneQuery } from '../../src/services/retrieval/questionParser.js';
import { createApp } from '../../src/app.js';
import { seedDemo } from '../../demo/seed.js';
import { DEMO_REPO_ID, syntheticSnapshot } from '../../demo/syntheticRepo.js';
import { fixtureSnapshot } from '../fixtures/snapshot.js';

describe('C. Graph', () => {
  test('missing related nodes never produce dangling relationships', () => {
    const snap = fixtureSnapshot();
    snap.pulls[0].commitShas.push('f'.repeat(40)); // commit not imported
    snap.pulls[0].body += '\n\nFixes #999 and see deadbeef1234567'; // issue / sha not imported
    const g = buildGraph(snap);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const r of g.rels) assert.ok(ids.has(r.from) && ids.has(r.to), `${r.type} ${r.from} -> ${r.to}`);
  });

  test('empty retrieval results return an empty, honest answer', async () => {
    const s = createMemoryStore();
    const a = await answerQuestion({ store: s, repo: 'nobody/empty', question: 'Why does checkout use ioredis?' });
    assert.equal(a.status, 'insufficient_evidence');
    assert.deepEqual(a.evidence, []);
  });

  test('invalid graph connection fails with a clear, credential-free error', async () => {
    assert.throws(() => createNeo4jStore({ uri: '', password: '' }), (e) => e.code === 'NEO4J_NOT_CONFIGURED');
    const store = createNeo4jStore({ uri: 'neo4j://127.0.0.1:9', username: 'neo4j', password: 'secret-pw', database: 'neo4j' });
    try {
      await assert.rejects(store.verify(), (e) => ['NEO4J_UNAVAILABLE', 'NEO4J_AUTH'].includes(e.code) && !e.message.includes('secret-pw'));
    } finally {
      await store.close();
    }
  });

  test('query construction rejects unknown labels / relationship types (no injected Cypher)', async () => {
    const store = createNeo4jStore({ uri: 'neo4j://127.0.0.1:9', username: 'neo4j', password: 'x', database: 'neo4j' });
    try {
      await assert.rejects(store.upsertGraph('a/b', { nodes: [{ id: 'x', label: 'Evil) DETACH DELETE (n', props: {} }], rels: [] }), /Unknown label/);
      await assert.rejects(store.upsertGraph('a/b', { nodes: [], rels: [{ type: 'X]->() DELETE n//', from: 'a', to: 'b', props: {} }] }), /Unknown relationship/);
    } finally {
      await store.close();
    }
    const q = luceneQuery(['ab"c', 'title:(x)', 'a*b']);
    assert.ok(!/(^|[^\\])"/.test(q.replace(/\\"/g, '')), 'quotes escaped');
    assert.ok(q.includes('title\\:\\(x\\)'));
  });

  test('evidence-chain integrity: every decision is supported by a sourced evidence record', () => {
    const g = buildGraph(syntheticSnapshot());
    const nodes = new Map(g.nodes.map((n) => [n.id, n]));
    for (const d of g.nodes.filter((n) => n.label === 'Decision')) {
      const sup = g.rels.filter((r) => r.type === 'SUPPORTED_BY' && r.from === d.id);
      assert.ok(sup.length, `decision without evidence: ${d.props.statement}`);
      for (const r of sup) {
        const ev = nodes.get(r.to);
        assert.equal(ev.label, 'Evidence');
        assert.ok(ev.props.url, 'evidence has a source link');
        assert.ok(g.rels.some((x) => x.type === 'CONTAINS' && x.to === ev.id), 'evidence belongs to a record');
      }
      assert.ok(g.rels.some((r) => r.type === 'INTRODUCED_BY' && r.from === d.id));
      assert.ok(['active', 'superseded', 'disputed', 'unknown'].includes(d.props.status));
      assert.ok(d.props.confidenceScore >= 0 && d.props.confidenceScore <= 100 && d.props.confidenceBasis);
    }
  });

  test('temporal ordering: SUPERSEDES always points from the newer to the older decision', () => {
    for (const g of [buildGraph(syntheticSnapshot()), buildGraph(fixtureSnapshot())]) {
      const nodes = new Map(g.nodes.map((n) => [n.id, n]));
      for (const r of g.rels.filter((x) => x.type === 'SUPERSEDES')) {
        const newer = nodes.get(r.from).props.date;
        const older = nodes.get(r.to).props.date;
        if (newer && older && r.props.method !== 'adr_status') assert.ok(newer > older, `${newer} > ${older}`);
      }
    }
  });

  test('synthetic data is labelled and kept apart from real data', () => {
    const g = buildGraph(syntheticSnapshot());
    assert.ok(g.nodes.filter((n) => n.label !== 'Person').every((n) => n.props.synthetic === true && n.props.repo === DEMO_REPO_ID));
    assert.ok(g.nodes.filter((n) => n.label === 'Person').every((n) => n.id.startsWith(`person:${DEMO_REPO_ID}:demo:`)), 'synthetic people never merge with GitHub accounts');
    assert.ok(g.nodes.every((n) => !n.props.url || n.props.url.startsWith('/api/demo/records/')), 'no fake github.com links');
    assert.ok(buildGraph(fixtureSnapshot()).nodes.every((n) => !n.props.synthetic));
  });
});

describe('D. API and security', () => {
  let server;
  let base;
  const store = createMemoryStore();
  const failing = { ...createMemoryStore(), getRepo: async () => ({ id: 'x' }), findSeeds: async () => { throw new Error('internal detail: bolt://10.0.0.5 password=hunter2'); } };
  let failingServer;
  let failBase;
  before(async () => {
    await seedDemo(store);
    const app = createApp({ getStore: () => store, llm: null, rateLimits: { import: 5, ask: 25 } });
    await new Promise((r) => (server = app.listen(0, r)));
    base = `http://127.0.0.1:${server.address().port}/api`;
    const app2 = createApp({ getStore: () => failing, llm: null });
    await new Promise((r) => (failingServer = app2.listen(0, r)));
    failBase = `http://127.0.0.1:${failingServer.address().port}/api`;
  });
  after(() => {
    server.close();
    failingServer.close();
  });
  const post = (url, body, raw) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) });
  const demoAsk = `/repos/${DEMO_REPO_ID}/ask`;

  test('invalid body, missing fields and unexpected types are rejected with 400', async () => {
    assert.equal((await post(base + demoAsk, null, '{"question":')).status, 400);
    assert.equal((await post(base + demoAsk, {})).status, 400);
    assert.equal((await post(base + demoAsk, { question: 123 })).status, 400);
    assert.equal((await post(base + demoAsk, { question: ['why'] })).status, 400);
    assert.equal((await post(base + demoAsk, { question: 'Why is MAX_RETRIES 3?', model: 'gpt; rm -rf /' })).status, 400);
    assert.equal((await post(base + '/repos/import', { url: { evil: true } })).status, 400);
    assert.equal((await post(base + '/repos/import', { url: 'octo/repo', mode: 'drop-all' })).status, 400);
  });

  test('invalid repository identifiers are rejected', async () => {
    assert.equal((await fetch(base + '/repos/..%2F..%2Fetc/passwd/stats')).status, 400);
    assert.equal((await post(base + '/repos/import', { url: DEMO_REPO_ID })).status, 400, 'synthetic id is reserved');
  });

  test('internal errors return a safe, structured response', async () => {
    const res = await post(failBase + '/repos/x/y/ask', { question: 'Why is MAX_RETRIES 3?' });
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    assert.ok(!JSON.stringify(body).includes('hunter2') && !JSON.stringify(body).includes('10.0.0.5'));
  });

  test('rate limiting returns 429 with Retry-After', async () => {
    let last;
    for (let i = 0; i < 8; i++) last = await post(base + '/repos/import', { url: 'not valid at all' });
    assert.equal(last.status, 429);
    assert.ok(last.headers.get('retry-after'));
  });

  test('prompt-injection text in repository content is treated as data', async () => {
    let prompt = null;
    const llm = { model: 'fake', completeJSON: async (p) => ((prompt = p), { headline: 'x', claims: [], unknowns: [] }) };
    const a = await answerQuestion({ store, repo: DEMO_REPO_ID, question: 'Why is MAX_RETRIES 3?', llm });
    const injected = a.evidence.find((e) => /Ignore previous instructions/.test(e.excerpt));
    if (injected) assert.ok(injected.flags.length && !injected.hasRationale, 'flagged and not used as rationale');
    assert.ok(!JSON.stringify(a.answer).includes('CEO'));
    assert.match(prompt.system, /UNTRUSTED data/);
    assert.ok(!prompt.user.includes('Ignore previous instructions'), 'flagged evidence is not sent to the LLM');
  });

  test('malicious or misleading source content: unsafe links dropped, viewer escapes HTML', async () => {
    assert.deepEqual(safeUrl('javascript:alert(1)'), { url: null, urlStatus: 'unavailable' });
    assert.deepEqual(safeUrl('https://github.com.evil.io/x/y'), { url: null, urlStatus: 'unavailable' });
    assert.equal(safeUrl('https://github.com/a/b/pull/1').urlStatus, 'ok');
    const html = await (await fetch(base + '/demo/records/issue/7')).text();
    assert.match(html, /SYNTHETIC DEMO RECORD/);
    assert.ok(!html.includes('<script'));
    const missing = await fetch(base + '/demo/records/../../etc/passwd');
    assert.ok([404, 400].includes(missing.status));
  });

  test('Cypher-looking questions are handled as plain data', async () => {
    const res = await post(base + demoAsk, { question: 'MATCH (n) DETACH DELETE n // why?' });
    assert.equal(res.status, 200);
    const stats = await (await fetch(base + `/repos/${DEMO_REPO_ID}/stats`)).json();
    assert.ok(stats.stats.labels.Decision > 0, 'graph intact');
  });
});
