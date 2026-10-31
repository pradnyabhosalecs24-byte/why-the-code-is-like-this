import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDecisionCandidates, parseAdr } from '../../src/services/extraction/decisions.js';

const record = (text, title = null) => ({ id: 'r1', type: 'pr_description', title, text, url: 'https://github.com/o/r/pull/1', author: { login: 'alice' }, date: '2024-01-01T00:00:00Z' });

test('extracts a decision with verbatim rationale and alternative', () => {
  const [d] = extractDecisionCandidates(record('We decided to use Redis instead of Memcached. This is because we need persistence across restarts.'));
  assert.equal(d.statement, 'We decided to use Redis instead of Memcached.');
  assert.match(d.rationale, /because we need persistence/);
  assert.deepEqual(d.alternatives, ['instead of Memcached.'.replace(/\.$/, '')]);
  assert.equal(d.author, 'alice');
});

test('records a decision without inventing a rationale', () => {
  const [d] = extractDecisionCandidates(record('Switch to pnpm for installs.'));
  assert.ok(d);
  assert.equal(d.rationale, null);
});

test('ignores text without decision language and git boilerplate', () => {
  assert.equal(extractDecisionCandidates(record('Update README badges and fix typos.')).length, 0);
  assert.equal(extractDecisionCandidates(record('This reverts commit 1234567abcdef.')).length, 0);
});

test('parses ADR status and supersession', () => {
  const adr = parseAdr('docs/adr/0002-webhooks.md', '# 2. Webhooks\n\n## Status\n\nAccepted. Supersedes ADR-0001\n\n## Context\n\nPolling is costly.\n\n## Decision\n\nUse webhooks.\n');
  assert.equal(adr.number, 2);
  assert.deepEqual(adr.supersedes, [1]);
  assert.equal(adr.decision, 'Use webhooks.');
  assert.equal(parseAdr('README.md', '# Hello\n\nNothing here'), null);
});
