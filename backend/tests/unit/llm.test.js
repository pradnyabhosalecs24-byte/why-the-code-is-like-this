import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLlm, parseJsonLoose } from '../../src/services/answer/llm.js';
import { llmConfig, validateConfig } from '../../src/config/env.js';

const okResponse = (content) =>
  new Response(JSON.stringify({ id: 'x', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

test('Sarvam AI provider calls api.sarvam.ai with its subscription key and parses JSON', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) };
    return okResponse('```json\n{"headline":"h","claims":[],"unknowns":[]}\n```');
  };
  const llm = createLlm({ provider: 'sarvam', apiKey: 'sk_test_abcdefghijklmnop', model: 'sarvam-105b', baseURL: 'https://api.sarvam.ai/v1', fetchImpl });
  const out = await llm.completeJSON({ system: 's', user: 'u' });
  assert.equal(seen.url, 'https://api.sarvam.ai/v1/chat/completions');
  assert.equal(seen.headers.get('api-subscription-key'), 'sk_test_abcdefghijklmnop');
  assert.equal(seen.body.model, 'sarvam-105b');
  assert.equal(seen.body.response_format.type, 'json_object');
  assert.equal(out.headline, 'h');
  assert.equal(llm.provider, 'sarvam');
});

test('parseJsonLoose handles fences, reasoning text and garbage', () => {
  assert.deepEqual(parseJsonLoose('<think>hmm</think>{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Here you go: {"a":2} thanks'), { a: 2 });
  assert.deepEqual(parseJsonLoose('not json'), {});
});

test('provider selection prefers Sarvam when its key is set; missing key is a config error', () => {
  const base = { graphBackend: 'memory', demoMode: false, neo4j: {}, github: { token: '' }, openai: { apiKey: '', model: 'gpt-4o-mini', refineDecisions: false, timeoutMs: 1 }, sarvam: { apiKey: 'sk_abcdefghijklmnopqrst', model: 'sarvam-105b', baseURL: 'https://api.sarvam.ai/v1' } };
  if (!process.env.LLM_PROVIDER) {
    assert.equal(llmConfig(base).provider, 'sarvam');
    assert.equal(llmConfig({ ...base, sarvam: { ...base.sarvam, apiKey: '' } }).provider, 'none');
    assert.match(validateConfig({ ...base, sarvam: { ...base.sarvam, apiKey: '' } }).warnings.join(' '), /SARVAM_API_KEY or OPENAI_API_KEY/);
  }
  assert.ok(!JSON.stringify(validateConfig(base)).includes('sk_abcdefghijklmnopqrst'));
});
