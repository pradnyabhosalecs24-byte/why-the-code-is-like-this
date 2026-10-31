import { Router } from 'express';
import { asyncRoute, badRequest, notFound } from '../middleware/errors.js';
import { parseRepoInput, parseQuestion, parseNodeId } from '../middleware/validate.js';
import { credentialStatus, config, validateConfig, llmConfig } from '../config/env.js';
import { DEMO_REPO_ID } from '../../demo/syntheticRepo.js';
import { requireStore, storeHealth } from '../services/graph/store.js';
import { startImport, getJob, deleteCache } from '../services/importer.js';
import { answerQuestion, slimNode } from '../services/answer/answerer.js';
import { createLlm } from '../services/answer/llm.js';
import { rateLimit } from '../middleware/rateLimit.js';

const MODEL_RE = /^[A-Za-z0-9._:-]{1,64}$/;

export function createApiRouter({ getStore = requireStore, llm = createLlm(llmConfig()), githubClient = null, rateLimits = { import: 6, ask: 30 } } = {}) {
  const r = Router();

  const repoFromParams = (req) => parseRepoInput(`${req.params.owner}/${req.params.name}`);
  const loadRepo = async (req) => {
    const ref = repoFromParams(req);
    const store = getStore();
    const repo = await store.getRepo(ref.id);
    if (!repo) throw notFound(`${ref.id} has not been imported yet.`);
    return { ref, store, repo };
  };

  r.get('/health', asyncRoute(async (req, res) => {
    const { errors, warnings } = validateConfig();
    res.json({ ok: true, credentials: credentialStatus(), config: { errors, warnings }, graph: await storeHealth(getStore) });
  }));

  r.get('/repos', asyncRoute(async (req, res) => {
    res.json({ repos: await getStore().listRepos() });
  }));

  r.post('/repos/import', rateLimit({ windowMs: 60_000, max: rateLimits.import }), asyncRoute(async (req, res) => {
    const ref = parseRepoInput(req.body?.url);
    if (ref.id === DEMO_REPO_ID) throw badRequest('That id is reserved for the synthetic demo repository and cannot be imported from GitHub.');
    if (req.body?.mode !== undefined && !['full', 'incremental'].includes(req.body.mode)) throw badRequest('mode must be "full" or "incremental".');
    const mode = req.body?.mode === 'full' ? 'full' : 'incremental';
    const job = startImport({ store: getStore(), repoRef: ref, mode, llm, githubClient });
    res.status(202).json({ job: publicJob(job) });
  }));

  r.get('/jobs/:id', (req, res, next) => {
    const job = getJob(String(req.params.id));
    if (!job) return next(notFound('Unknown import job.'));
    res.json({ job: publicJob(job) });
  });

  r.get('/repos/:owner/:name/stats', asyncRoute(async (req, res) => {
    const { store, repo, ref } = await loadRepo(req);
    res.json({ repo, stats: await store.stats(ref.id) });
  }));

  r.get('/repos/:owner/:name/decisions', asyncRoute(async (req, res) => {
    const { store, ref } = await loadRepo(req);
    res.json({ decisions: await store.decisions(ref.id) });
  }));

  r.get('/repos/:owner/:name/timeline', asyncRoute(async (req, res) => {
    const { store, ref } = await loadRepo(req);
    res.json({ events: await store.timeline(ref.id) });
  }));

  r.get('/repos/:owner/:name/graph', asyncRoute(async (req, res) => {
    const { store, ref } = await loadRepo(req);
    const g = req.query.node ? await store.neighborhood(ref.id, parseNodeId(req.query.node)) : await store.overview(ref.id);
    res.json({
      nodes: g.nodes.map(slimNode),
      rels: g.rels.map((x) => ({ type: x.type, from: x.from, to: x.to, origin: x.props?.origin, method: x.props?.method })),
    });
  }));

  r.get('/repos/:owner/:name/nodes', asyncRoute(async (req, res) => {
    const { store } = await loadRepo(req);
    const id = parseNodeId(req.query.id);
    const [n] = await store.getNodes([id]);
    if (!n) throw notFound('Node not found.');
    res.json({ node: { id: n.id, label: n.label, props: n.props } });
  }));

  r.post('/repos/:owner/:name/ask', rateLimit({ windowMs: 60_000, max: rateLimits.ask }), asyncRoute(async (req, res) => {
    const { store, ref } = await loadRepo(req);
    const question = parseQuestion(req.body?.question);
    let model = null;
    if (req.body?.model) {
      if (!MODEL_RE.test(req.body.model)) throw badRequest('Invalid model name.');
      model = req.body.model;
    }
    const useLlm = req.body?.useLlm !== false;
    res.json(await answerQuestion({ store, repo: ref.id, question, llm: useLlm ? llm : null, model }));
  }));

  r.delete('/repos/:owner/:name', asyncRoute(async (req, res) => {
    const ref = repoFromParams(req);
    if (req.body?.confirm !== ref.id && req.query.confirm !== ref.id) throw badRequest(`Confirm deletion by sending confirm="${ref.id}".`);
    const removed = await getStore().clearRepo(ref.id);
    await deleteCache(ref.id);
    res.json({ removed });
  }));

  return r;
}

function publicJob(job) {
  if (!job) return null;
  const { id, repo, mode, status, stage, detail, startedAt, finishedAt, result, error } = job;
  return { id, repo, mode, status, stage, detail, startedAt, finishedAt, result, error, log: job.log.slice(-15) };
}
