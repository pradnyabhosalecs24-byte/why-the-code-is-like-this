import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractReferences, supersessionCue } from '../../src/services/parse/references.js';
import { extractCodeEntities, classifyPath } from '../../src/services/parse/codeEntities.js';
import { parseRepoInput, parseQuestion } from '../../src/middleware/validate.js';

test('extractReferences finds closing keywords, #refs, reverts and identifiers', () => {
  const r = extractReferences('Fixes #12, see #7 and other/repo#9.\n\nThis reverts commit abc1234def.\nTune `MAX_RETRIES` in src/http/client.js', 'me/repo');
  assert.deepEqual(r.closes, [12]);
  assert.ok(r.numbers.includes(7) && !r.numbers.includes(9), 'cross-repo refs are ignored');
  assert.equal(r.revertsSha, 'abc1234def');
  assert.ok(r.identifiers.includes('MAX_RETRIES'));
  assert.ok(r.paths.includes('src/http/client.js'));
});

test('supersessionCue only fires on explicit change language', () => {
  assert.ok(supersessionCue('This replaces the setting from #6'));
  assert.equal(supersessionCue('Add tests for the parser'), null);
});

test('extractCodeEntities finds functions, classes and constants', () => {
  const e = extractCodeEntities('src/a.js', 'export const MAX_RETRIES = 3;\nexport async function fetchWithRetry() {}\nclass Pool {}\nconst run = async () => {}\n');
  assert.deepEqual(e.functions.map((f) => f.name).sort(), ['Pool', 'fetchWithRetry', 'run']);
  assert.equal(e.configs[0].key, 'MAX_RETRIES');
  assert.equal(e.configs[0].value, '3');
});

test('config extraction: YAML paths, JSON keys, env files never keep values', () => {
  const y = extractCodeEntities('config/app.yml', 'http:\n  timeoutMs: 5000\n  retries: 3\n');
  assert.deepEqual(y.configs.map((c) => c.key), ['http.timeoutMs', 'http.retries']);
  const j = extractCodeEntities('settings.json', '{"cache": {"ttl": 60}}');
  assert.equal(j.configs[0].key, 'cache.ttl');
  const env = extractCodeEntities('.env.example', 'API_KEY=secret\n');
  assert.equal(env.configs[0].key, 'API_KEY');
  assert.equal(env.configs[0].value, null);
});

test('classifyPath skips vendored and lock files', () => {
  assert.equal(classifyPath('node_modules/x/index.js'), 'other');
  assert.equal(classifyPath('package-lock.json'), 'other');
  assert.equal(classifyPath('docs/adr/0001-x.md'), 'doc');
  assert.equal(classifyPath('src/main.py'), 'source');
});

test('input validation accepts GitHub URLs and rejects junk', () => {
  assert.equal(parseRepoInput('https://github.com/Expressjs/Express.git').id, 'expressjs/express');
  assert.equal(parseRepoInput('expressjs/express').id, 'expressjs/express');
  assert.throws(() => parseRepoInput('https://gitlab.com'), /valid|Expected/);
  assert.throws(() => parseRepoInput('a/../../etc'), /valid/);
  assert.throws(() => parseQuestion('x'), /too short/);
  assert.throws(() => parseQuestion('y'.repeat(501)), /too long/);
});
