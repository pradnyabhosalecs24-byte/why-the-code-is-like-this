import { test } from 'node:test';
import '../helpers/tmpCache.js';
import assert from 'node:assert/strict';
import { buildGraph } from '../../src/services/graph/buildGraph.js';
import { createMemoryStore } from '../../src/services/graph/memoryStore.js';
import { answerQuestion } from '../../src/services/answer/answerer.js';
import { parseQuestion } from '../../src/services/retrieval/questionParser.js';
import { rankSubgraph } from '../../src/services/retrieval/rank.js';
import { mergeSnapshots } from '../../src/services/importer.js';
import { fixtureSnapshot } from '../fixtures/snapshot.js';

const REPO = 'example/retry-service';

async function loaded() {
  const graph = buildGraph(fixtureSnapshot());
  const store = createMemoryStore();
  await store.upsertGraph(REPO, graph);
  return { graph, store };
}
const decisionByText = (graph, re) => graph.nodes.find((n) => n.label === 'Decision' && re.test(n.props.statement));

test('graph has the expected schema, provenance and confirmed/inferred split', async () => {
  const { graph } = await loaded();
  for (const label of ['Repository', 'File', 'Module', 'Function', 'Configuration', 'Commit', 'PullRequest', 'Issue', 'Incident', 'Decision', 'Person', 'Evidence']) {
    assert.ok(graph.stats[label] > 0, `has ${label}`);
  }
  for (const type of ['CONTAINS', 'CHANGED_BY', 'DISCUSSED_IN', 'INTRODUCED_BY', 'AFFECTS', 'AUTHORED_BY', 'RELATED_TO', 'SUPPORTED_BY', 'SUPERSEDES', 'REPORTED_IN', 'RENAMED_FROM']) {
    assert.ok(graph.relStats[type] > 0, `has ${type}`);
  }
  assert.ok(graph.rels.every((r) => ['confirmed', 'inferred'].includes(r.props.origin) && r.props.method), 'every relationship records origin + method');
  assert.ok(graph.rels.some((r) => r.props.origin === 'inferred') && graph.rels.some((r) => r.props.origin === 'confirmed'));
  assert.ok(graph.nodes.every((n) => n.props.id === n.id && n.props.importedAt));
  // the rename is resolved from GitHub's structured rename status
  const rn = graph.rels.find((r) => r.type === 'RENAMED_FROM');
  assert.equal(rn.from, `file:${REPO}:src/http/client.js`);
  assert.equal(rn.to, `file:${REPO}:src/net/request.js`);
});

test('building twice is idempotent (stable ids, no duplicates)', async () => {
  const { graph, store } = await loaded();
  await store.upsertGraph(REPO, buildGraph(fixtureSnapshot()));
  const stats = await store.stats(REPO);
  assert.equal(stats.labels.Decision, graph.stats.Decision);
  assert.equal(stats.labels.Evidence, graph.stats.Evidence);
});

test('SUPERSEDED: an older decision is superseded by a later one that explicitly replaces it', async () => {
  const { graph, store } = await loaded();
  const older = decisionByText(graph, /cache\.ttlSeconds to 60/);
  const newer = decisionByText(graph, /cache\.ttlSeconds to 300/);
  assert.equal(older.props.status, 'superseded');
  assert.equal(newer.props.status, 'active');
  assert.ok(graph.rels.some((r) => r.type === 'SUPERSEDES' && r.from === newer.id && r.to === older.id && r.props.method === 'explicit_reference'));

  const a = await answerQuestion({ store, repo: REPO, question: 'Was the cache.ttlSeconds decision later reversed?' });
  const replaced = a.answer.claims.find((c) => /replaced an earlier decision from 2023-02-05/.test(c.text));
  assert.ok(replaced, 'answer shows the original decision, the later one and the date');
  const cited = a.evidence.filter((e) => replaced.citations.includes(e.ref)).map((e) => e.url);
  assert.ok(cited.includes('https://github.com/example/retry-service/pull/6') && cited.includes('https://github.com/example/retry-service/pull/10'));
  // the historical record is preserved
  assert.ok((await store.decisions(REPO)).some((d) => d.id === older.id && d.supersededBy.includes(newer.id)));
});

test('git revert supersedes the reverted decision; ADR status is respected', async () => {
  const { graph } = await loaded();
  assert.equal(decisionByText(graph, /^Switch to exponential backoff/).props.status, 'superseded');
  assert.equal(decisionByText(graph, /poll the pricing service/).props.status, 'superseded');
  assert.notEqual(decisionByText(graph, /through webhooks/).props.status, 'superseded');
});

test('no automatic supersession: a later unrelated-looking change is only "disputed"', async () => {
  const { graph } = await loaded();
  const d = decisionByText(graph, /timeoutMs to 5000 because/);
  assert.equal(d.props.status, 'disputed');
  assert.ok(!graph.rels.some((r) => r.type === 'SUPERSEDES' && r.to === d.id));
});

test('evidence-grounded answer with citations to real records', async () => {
  const { store } = await loaded();
  const a = await answerQuestion({ store, repo: REPO, question: 'Why is MAX_RETRIES set to 3?' });
  assert.equal(a.status, 'answered');
  assert.notEqual(a.confidence.level, 'insufficient');
  const refs = new Set(a.evidence.map((e) => e.ref));
  for (const c of a.answer.claims) {
    assert.ok(c.citations.length, 'every claim is cited');
    for (const r of c.citations) assert.ok(refs.has(r));
  }
  for (const e of a.evidence) {
    assert.match(e.url, /^https:\/\/github\.com\/example\/retry-service\//);
    assert.ok(e.recordType);
  }
  assert.ok(a.answer.claims.some((c) => /retry storms overloaded/.test(c.text)));
  assert.ok(a.answer.claims.some((c) => /Issue #4/.test(c.text)), 'incident issue is reached through the graph');
});

test('REFUSAL: the system refuses to invent a rationale that the repository does not record', async () => {
  const { store } = await loaded();
  const a = await answerQuestion({ store, repo: REPO, question: 'Why was legacyFormatter not migrated?' });
  assert.equal(a.status, 'insufficient_evidence');
  assert.equal(a.confidence.level, 'insufficient');
  assert.match(a.answer.headline, /does not establish the reason/);
  assert.ok(a.answer.claims.every((c) => !/because|reason was|in order to/i.test(c.text.replace(/“[^”]*”/g, ''))));

  // ...even when an LLM tries to make one up
  const lyingLlm = { model: 'fake', completeJSON: async () => ({ headline: 'It was kept for IE11 support', claims: [{ text: 'Kept for IE11 support, decided by Dave in 2019', citations: ['E42'] }], unknowns: [] }) };
  const b = await answerQuestion({ store, repo: REPO, question: 'Why was legacyFormatter not migrated?', llm: lyingLlm });
  assert.match(b.answer.headline, /does not establish the reason/);
  assert.ok(!JSON.stringify(b.answer).includes('IE11'));
  assert.ok(!JSON.stringify(b.answer).includes('Dave'));

  const c = await answerQuestion({ store, repo: REPO, question: 'Why does the quantum flux capacitor exist?' });
  assert.equal(c.status, 'insufficient_evidence');
  assert.equal(c.evidence.length, 0);
});

test('GRAPH MATTERS: relationships change which evidence is retrieved', async () => {
  const { store } = await loaded();
  const query = parseQuestion('Why is MAX_RETRIES set to 3?', REPO);
  const seeds = (await store.findSeeds(REPO, query)).filter((s) => s.label === 'Configuration');
  assert.ok(seeds.length, 'question resolves to the MAX_RETRIES configuration node');
  const sub = await store.expand(REPO, seeds.map((s) => s.id), { maxDepth: 4 });

  const withGraph = rankSubgraph({ seeds, subgraph: sub, query, maxEvidence: 20 });
  const issueUrl = 'https://github.com/example/retry-service/issues/4';
  const hit = withGraph.evidence.find((e) => e.node.props.url === issueUrl);
  assert.ok(hit, 'incident report found although it never mentions MAX_RETRIES');
  assert.ok(hit.path.some((s) => ['DISCUSSED_IN', 'RELATED_TO', 'MOTIVATED_BY'].includes(s.type)));

  // remove the PR <-> issue / commit <-> PR links and the same query can no longer reach it
  // (MOTIVATED_BY is derived from those links, so it goes too)
  const cut = { nodes: sub.nodes, rels: sub.rels.filter((r) => !['RELATED_TO', 'DISCUSSED_IN', 'MOTIVATED_BY'].includes(r.type)) };
  const without = rankSubgraph({ seeds, subgraph: cut, query, maxEvidence: 20 });
  assert.ok(!without.evidence.some((e) => e.node.props.url === issueUrl));
});

test('who-introduced follows renames and states the limits of file-level history', async () => {
  const { store } = await loaded();
  const a = await answerQuestion({ store, repo: REPO, question: 'Who introduced fetchWithRetry?' });
  assert.match(a.answer.headline, /src\/net\/request\.js/);
  assert.match(a.answer.headline, /carol/);
  assert.ok(a.answer.unknowns.some((u) => /line-level/.test(u)));
});

test('incremental merge dedupes by sha / number and keeps newer versions', () => {
  const base = fixtureSnapshot();
  const fresh = { ...fixtureSnapshot(), commits: [base.commits[0]], pulls: [{ ...base.pulls[0], title: 'Raise cache TTL (edited)' }], issues: [] };
  const merged = mergeSnapshots(base, fresh);
  assert.equal(merged.commits.length, base.commits.length);
  assert.equal(merged.pulls.find((p) => p.number === 10).title, 'Raise cache TTL (edited)');
  assert.equal(merged.issues.length, 1);
});

test('sweep removes records that disappeared from the source', async () => {
  const { store } = await loaded();
  const snap = fixtureSnapshot();
  snap.pulls = snap.pulls.filter((p) => p.number !== 7);
  const g2 = buildGraph(snap);
  await store.upsertGraph(REPO, g2);
  await store.sweep(REPO, g2.importedAt);
  assert.equal((await store.getNodes([`pr:${REPO}:7`])).length, 0);
  assert.equal((await store.getNodes([`pr:${REPO}:10`])).length, 1);
});
