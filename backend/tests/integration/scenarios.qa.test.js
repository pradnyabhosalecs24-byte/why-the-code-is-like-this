// Brief §8.B — question-answering scenarios, on the SYNTHETIC demo dataset and test fixtures.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../src/services/graph/buildGraph.js';
import { createMemoryStore } from '../../src/services/graph/memoryStore.js';
import { answerQuestion } from '../../src/services/answer/answerer.js';
import { seedDemo } from '../../demo/seed.js';
import { DEMO_REPO_ID } from '../../demo/syntheticRepo.js';
import { fixtureSnapshot } from '../fixtures/snapshot.js';

let demo;
before(async () => {
  demo = createMemoryStore();
  await seedDemo(demo);
});
const ask = (question, opts = {}) => answerQuestion({ store: demo, repo: DEMO_REPO_ID, question, ...opts });

async function storeWith(mutate) {
  const snap = fixtureSnapshot();
  mutate(snap);
  const s = createMemoryStore();
  await s.upsertGraph(snap.repo.id, buildGraph(snap));
  return { store: s, repo: snap.repo.id };
}

describe('B. Question answering', () => {
  test('strong supporting evidence: stated reason, cited, high confidence', async () => {
    const a = await ask('Why was the Idempotency-Key added to createPayment?');
    assert.equal(a.status, 'answered');
    assert.equal(a.confidence.level, 'high');
    assert.ok(a.answer.claims.some((c) => /duplicate charges/.test(c.text) && c.basis === 'fact'));
  });

  test('evidence across multiple source types (PR, review comment, incident issue)', async () => {
    const a = await ask('Why is MAX_RETRIES 3?');
    const kinds = new Set(a.evidence.map((e) => e.kind));
    assert.ok(kinds.size >= 3, [...kinds].join(','));
    assert.ok(kinds.has('issue_body') && kinds.has('pr_description'));
  });

  test('no supporting evidence: explicit insufficient-evidence response', async () => {
    const a = await ask('Why was legacyCsvExport not migrated?');
    assert.equal(a.status, 'insufficient_evidence');
    assert.match(a.answer.headline, /does not establish the reason/);
  });

  test('ambiguous question: vague wording, or an identifier defined in several places', async () => {
    const vague = await ask('Why is it like this?');
    assert.equal(vague.status, 'insufficient_evidence');
    assert.ok(vague.answer.unknowns.some((u) => /be more specific/.test(u)));

    const { store, repo } = await storeWith((s) => {
      s.files.push({ path: 'src/a.js', kind: 'source', size: 30, url: 'https://github.com/example/retry-service/blob/main/src/a.js', content: 'export const REQUEST_LIMIT = 5;\n' });
      s.files.push({ path: 'src/b.js', kind: 'source', size: 30, url: 'https://github.com/example/retry-service/blob/main/src/b.js', content: 'export const REQUEST_LIMIT = 9;\n' });
      s.commits[0].files.push({ path: 'src/a.js', status: 'added' }, { path: 'src/b.js', status: 'added' });
    });
    const a = await answerQuestion({ store, repo, question: 'Who introduced REQUEST_LIMIT?' });
    assert.ok(a.answer.unknowns.some((u) => /matches 2 code entities/.test(u)), JSON.stringify(a.answer.unknowns));
  });

  test('conflicting decisions are explained as conflict, not resolved by date', async () => {
    const a = await ask('Why is GATEWAY_TIMEOUT_MS 12000?');
    const conflict = a.answer.claims.find((c) => /Conflicting evidence/.test(c.text));
    assert.ok(conflict);
    assert.equal(conflict.basis, 'inference');
    assert.ok(a.decisions.some((d) => d.status === 'disputed'));
  });

  test('superseded decision shows original, replacement, evidence and dates', async () => {
    const a = await ask('Has the SESSION_TTL_MINUTES decision been superseded?');
    const c = a.answer.claims.find((x) => /replaced an earlier decision from 2024-09-03/.test(x.text));
    assert.ok(c);
    assert.equal(c.basis, 'inference');
    assert.ok(c.citations.length >= 2);
  });

  test('missing author is never invented', async () => {
    const { store, repo } = await storeWith((s) => {
      for (const p of s.pulls) p.author = null;
      for (const c of s.commits) c.author = null;
    });
    const a = await answerQuestion({ store, repo, question: 'Why is MAX_RETRIES set to 3?' });
    const text = JSON.stringify(a.answer);
    assert.ok(!/by (null|undefined)/.test(text));
    assert.ok(a.evidence.filter((e) => ['pr_description', 'commit_message'].includes(e.kind)).every((e) => e.author === null));
    assert.equal(a.decisions[0].author, null);
  });

  test('missing timestamp is shown as unknown, not guessed', async () => {
    const a = await ask('Why do we receive payment status through gateway webhooks?');
    const adr = a.evidence.find((e) => e.kind === 'adr' && /0001/.test(e.title || ''));
    if (adr) assert.equal(adr.date, null);
    assert.ok(!JSON.stringify(a.answer).includes('(null)'));
    assert.ok(!JSON.stringify(a.answer).includes('undefined'));
  });

  test('unsupported claims in a generated response are removed', async () => {
    const llm = { model: 'fake', completeJSON: async () => ({ headline: 'h', claims: [{ text: 'Chosen by the CTO in 2019', citations: ['E99'], basis: 'fact' }, { text: 'Gateway was overloaded', citations: ['E1'], basis: 'fact' }], unknowns: [] }) };
    const a = await ask('Why is MAX_RETRIES 3?', { llm });
    assert.ok(!JSON.stringify(a.answer).includes('CTO'));
    assert.equal(a.answer.droppedClaims, 1);
    assert.ok(a.generator.startsWith('openai:'));
  });

  test('broken or unavailable source links are flagged, never fabricated', async () => {
    const { store, repo } = await storeWith((s) => {
      s.pulls.find((p) => p.number === 5).url = 'javascript:alert(1)';
      s.commits.find((c) => c.message.startsWith('Reduce retries')).url = 'https://evil.example.com/x';
    });
    const a = await answerQuestion({ store, repo, question: 'Why is MAX_RETRIES set to 3?' });
    const bad = a.evidence.filter((e) => e.urlStatus !== 'ok');
    assert.ok(bad.length >= 1);
    assert.ok(bad.every((e) => e.url === null));
    assert.ok(a.answer.unknowns.some((u) => /Source link unavailable/.test(u)));
  });
});
