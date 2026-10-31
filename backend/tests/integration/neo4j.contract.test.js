// Runs the same pipeline against a real Neo4j (e.g. your AuraDB instance).
// Skipped unless TEST_NEO4J=1 and NEO4J_* are set. Uses a throwaway repo id and cleans up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../../src/config/env.js';
import { buildGraph } from '../../src/services/graph/buildGraph.js';
import { answerQuestion } from '../../src/services/answer/answerer.js';
import { fixtureSnapshot } from '../fixtures/snapshot.js';

const enabled = process.env.TEST_NEO4J === '1' && config.neo4j.uri && config.neo4j.password;

test('Neo4j store honours the same contract as the memory store', { skip: !enabled && 'set TEST_NEO4J=1 with NEO4J_* to run' }, async () => {
  const { createNeo4jStore } = await import('../../src/services/graph/neo4jStore.js');
  const store = createNeo4jStore(config.neo4j);
  const snap = fixtureSnapshot();
  snap.repo.id = 'tracewhy-test/fixture';
  const REPO = snap.repo.id;
  try {
    await store.verify();
    await store.init();
    await store.clearRepo(REPO);
    const graph = buildGraph(snap);
    await store.upsertGraph(REPO, graph);
    await store.upsertGraph(REPO, graph); // idempotent
    await store.sweep(REPO, graph.importedAt);
    const stats = await store.stats(REPO);
    assert.equal(stats.labels.Decision, graph.stats.Decision);
    const a = await answerQuestion({ store, repo: REPO, question: 'Was the cache.ttlSeconds decision later reversed?' });
    assert.ok(a.answer.claims.some((c) => /replaced an earlier decision/.test(c.text)));
    const b = await answerQuestion({ store, repo: REPO, question: 'Why was legacyFormatter not migrated?' });
    assert.equal(b.status, 'insufficient_evidence');
  } finally {
    await store.clearRepo(REPO);
    await store.close();
  }
});
