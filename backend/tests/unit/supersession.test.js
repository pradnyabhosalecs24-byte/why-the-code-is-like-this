import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSupersession } from '../../src/services/temporal/supersession.js';
import { extractReferences } from '../../src/services/parse/references.js';

const cfg = { id: 'cfg:x', label: 'Configuration', name: 'cache.ttl' };
const dec = (id, date, text, source, extra = {}) => ({ id, date, statement: text, fullText: text, refs: extractReferences(text), source, affects: [cfg], affectsAtHead: 1, merged: true, ...extra });

test('a later decision that explicitly references the older one supersedes it', () => {
  const older = dec('d1', '2023-01-01', 'Set cache.ttl to 60 because prices drift.', { kind: 'pull', number: 6 });
  const newer = dec('d2', '2024-01-01', 'Increase cache.ttl to 300; this replaces the setting from #6.', { kind: 'pull', number: 10 });
  const { links, statuses } = detectSupersession([older, newer]);
  assert.deepEqual(links.map((l) => [l.type, l.from, l.to, l.method]), [['SUPERSEDES', 'd2', 'd1', 'explicit_reference']]);
  assert.equal(statuses.d1.status, 'superseded');
  assert.equal(statuses.d2.status, 'active');
});

test('a newer record does NOT automatically supersede an older one', () => {
  const older = dec('d1', '2023-01-01', 'Set cache.ttl to 60 because prices drift.', { kind: 'pull', number: 6 });
  const newer = dec('d2', '2024-01-01', 'We decided to set cache.ttl to 120 for the new tier.', { kind: 'pull', number: 11 });
  const { links, statuses } = detectSupersession([older, newer]);
  assert.equal(links.filter((l) => l.type === 'SUPERSEDES').length, 0);
  assert.notEqual(statuses.d1.status, 'superseded');
});

test('same entity + change language without a reference is only "disputed"', () => {
  const older = dec('d1', '2023-01-01', 'Set cache.ttl to 60.', { kind: 'commit', sha: 'a'.repeat(40) });
  const newer = dec('d2', '2024-01-01', 'Switch from 60 to 90 for cache.ttl.', { kind: 'commit', sha: 'b'.repeat(40) });
  const { statuses } = detectSupersession([older, newer]);
  assert.equal(statuses.d1.status, 'disputed');
});

test('git revert supersedes, and reverting the replacement reinstates the original', () => {
  const sha = (c) => c.repeat(40);
  const a = dec('a', '2023-01-01', 'Use fixed delays for retries.', { kind: 'commit', sha: sha('1') });
  const b = dec('b', '2023-02-01', 'Switch to exponential backoff.', { kind: 'commit', sha: sha('2') }, { fullText: 'Switch to exponential backoff. Replaces fixed delays from commit ' + sha('1').slice(0, 8) });
  b.refs = extractReferences(b.fullText);
  b.refs.shas = [sha('1').slice(0, 8)];
  const c = dec('c', '2023-03-01', 'Revert "Switch to exponential backoff."', { kind: 'commit', sha: sha('3') }, { fullText: `Revert "x"\n\nThis reverts commit ${sha('2')}.` });
  c.refs = { ...extractReferences(c.fullText), revertsSha: sha('2') };
  const { statuses } = detectSupersession([a, b, c]);
  assert.equal(statuses.b.status, 'superseded');
  assert.equal(statuses.a.status, 'active', 'its replacement was reverted');
});

test('ADR status links and unmerged proposals', () => {
  const a1 = dec('a1', null, 'Poll every 30s.', { kind: 'doc', path: 'adr/1.md' }, { adrNumber: 1, adrSupersededBy: [2] });
  const a2 = dec('a2', null, 'Use webhooks.', { kind: 'doc', path: 'adr/2.md' }, { adrNumber: 2, adrSupersedes: [1] });
  const p = dec('p', '2024-05-01', 'Use gRPC.', { kind: 'pull', number: 40 }, { merged: false, affects: [] });
  const { links, statuses } = detectSupersession([a1, a2, p]);
  assert.equal(links.filter((l) => l.method === 'adr_status').length, 1);
  assert.equal(statuses.a1.status, 'superseded');
  assert.equal(statuses.p.status, 'unknown');
});
