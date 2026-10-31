import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLlmAnswer } from '../../src/services/answer/answerer.js';
import { assessConfidence } from '../../src/services/answer/confidence.js';
import { redact } from '../../src/middleware/errors.js';

const pack = { evidence: [{ ref: 'E1' }, { ref: 'E2' }] };

test('LLM claims citing evidence that does not exist are dropped', () => {
  const out = validateLlmAnswer({ headline: 'h', claims: [{ text: 'Real', citations: ['E1'] }, { text: 'Invented by Dave in 2019', citations: ['E9'] }, { text: 'Uncited', citations: [] }] }, pack);
  assert.deepEqual(out.claims.map((c) => c.text), ['Real']);
  assert.equal(out.droppedClaims, 2);
});

test('when retrieval did not establish a reason the headline says so, whatever the LLM wrote', () => {
  const out = validateLlmAnswer({ headline: 'Because of performance', claims: [{ text: 'x', citations: ['E1'] }] }, pack, false);
  assert.match(out.headline, /does not establish the reason/);
});

test('confidence is "insufficient" with no evidence and never a probability', () => {
  const c = assessConfidence({ evidence: [], decisions: [], establishesReason: false, question: 'why?' });
  assert.equal(c.level, 'insufficient');
  assert.match(c.disclaimer, /not a calibrated probability/);
});

test('secrets are redacted from logs', () => {
  assert.equal(redact('token ghp_abcdefghijklmnopqrstuvwxyz123456'), 'token [redacted]');
  assert.match(redact('url?password=hunter2&x=1'), /password=\[redacted\]/);
});
