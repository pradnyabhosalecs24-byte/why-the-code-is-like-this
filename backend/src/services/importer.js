import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from '../config/env.js';
import { createGitHubClient } from './github/client.js';
import { fetchRepoSnapshot } from './github/fetchRepo.js';
import { buildGraph } from './graph/buildGraph.js';
import { llmRejectCandidates } from './extraction/llmRefine.js';
import { log } from '../middleware/errors.js';

const CACHE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.cache');
const jobs = new Map();
const running = new Set();

export function getJob(id) {
  return jobs.get(id) || null;
}

/**
 * Start an import job. Modes:
 *  - "full":        clear the repo's graph, fetch everything, rebuild.
 *  - "incremental": fetch only records newer than the last import, merge them into the
 *                   cached snapshot, rebuild (so supersession sees all history), then
 *                   upsert + sweep stale records. MERGE on stable ids prevents duplicates.
 */
export function startImport({ store, repoRef, mode = 'incremental', llm = null, githubClient = null }) {
  if (running.has(repoRef.id)) {
    const existing = [...jobs.values()].find((j) => j.repo === repoRef.id && j.status === 'running');
    return existing;
  }
  const job = {
    id: crypto.randomUUID(),
    repo: repoRef.id,
    mode,
    status: 'running',
    stage: 'queued',
    detail: '',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    log: [],
    result: null,
    error: null,
  };
  jobs.set(job.id, job);
  running.add(repoRef.id);
  const update = (stage, detail) => {
    job.stage = stage;
    job.detail = detail;
    job.log.push({ at: new Date().toISOString(), stage, detail });
    if (job.log.length > 200) job.log.shift();
  };

  (async () => {
    try {
      const gh = githubClient || createGitHubClient({
        token: config.github.token,
        timeoutMs: config.github.timeoutMs,
        onRateLimit: (ms) => update(job.stage, `GitHub rate limit: waiting ${Math.ceil(ms / 1000)}s`),
      });
      update('connecting', 'Checking graph database');
      await store.verify();
      await store.init();

      const existing = await store.getRepo(repoRef.id);
      const cached = mode === 'incremental' && existing ? await readCache(repoRef.id) : null;
      const since = cached ? existing.lastImportAt : null;
      update('fetching', since ? `Incremental import of changes since ${since}` : 'Full import');

      const fresh = await fetchRepoSnapshot(gh, repoRef, { limits: config.limits, since, onProgress: ({ stage, detail }) => update(stage, detail) });
      const snapshot = cached ? mergeSnapshots(cached, fresh) : fresh;
      await writeCache(repoRef.id, snapshot);

      update('building', 'Extracting decisions, resolving entities, detecting supersession');
      let graph = buildGraph(snapshot);
      if (llm && config.openai.refineDecisions) {
        update('building', `Asking ${llm.model} to filter ${graph.decisions.length} decision candidates`);
        const rejected = await llmRejectCandidates(llm, graph.decisions);
        if (rejected.size) graph = buildGraph(snapshot, { decisionFilter: (c) => !rejected.has(c.id) });
      }

      if (mode === 'full') {
        update('writing', 'Clearing previous data for this repository');
        await store.clearRepo(repoRef.id);
      }
      const total = graph.nodes.length + graph.rels.length;
      update('writing', `Writing ${graph.nodes.length} nodes and ${graph.rels.length} relationships`);
      await store.upsertGraph(repoRef.id, graph, { onProgress: (n) => (job.detail = `Written ${n}/${total}`) });
      await store.sweep(repoRef.id, graph.importedAt);

      const skipped = fresh.report?.skipped || [];
      job.result = {
        // fetched: records received from GitHub in this run (incremental runs fetch only new ones)
        fetched: fresh.report?.fetched || { commits: fresh.commits.length, pulls: fresh.pulls.length, issues: fresh.issues.length },
        // processed: records now represented in the graph (whole merged history)
        processed: {
          commits: graph.stats.Commit || 0,
          pulls: graph.stats.PullRequest || 0,
          issues: graph.stats.Issue || 0,
          evidence: graph.stats.Evidence || 0,
          decisions: graph.stats.Decision || 0,
          nodes: graph.nodes.length,
          relationships: graph.rels.length,
        },
        // skipped: sub-resources that failed or were over a limit; the import continued without them
        skipped: { count: skipped.length, byType: countBy(skipped.map((x) => x.type)), samples: skipped.slice(0, 20) },
        emptyHistory: Boolean(fresh.report?.emptyHistory),
        nodes: graph.stats,
        relationships: graph.relStats,
        decisions: graph.decisions.length,
        totals: { commits: snapshot.commits.length, pulls: snapshot.pulls.length, issues: snapshot.issues.length },
        githubRequests: gh.state?.requests ?? null,
        truncatedTree: snapshot.truncatedTree,
      };
      job.status = 'done';
      update('done', fresh.report?.emptyHistory ? `${snapshot.repo.fullName} has no commit history yet` : `Imported ${snapshot.repo.fullName}${skipped.length ? ` (${skipped.length} sub-records skipped)` : ''}`);
    } catch (err) {
      job.status = 'failed';
      job.error = { code: err.code || 'IMPORT_FAILED', message: err.expose || err.status ? err.message : 'Import failed. Check the backend logs.' };
      update('failed', job.error.message);
      log.error('Import failed', { repo: repoRef.id, code: err.code, message: err.message });
    } finally {
      job.finishedAt = new Date().toISOString();
      running.delete(repoRef.id);
    }
  })();

  return job;
}

/** Merge a fresh (incremental) snapshot into the cached one; newer records win. */
export function mergeSnapshots(oldS, newS) {
  const byKey = (arr, key) => new Map(arr.map((x) => [x[key], x]));
  const commits = byKey(oldS.commits, 'sha');
  for (const c of newS.commits) commits.set(c.sha, c.files ? c : { ...c, files: commits.get(c.sha)?.files ?? null });
  const pulls = byKey(oldS.pulls, 'number');
  for (const p of newS.pulls) pulls.set(p.number, p);
  const issues = byKey(oldS.issues, 'number');
  for (const i of newS.issues) issues.set(i.number, i);
  const sortDate = (a, b) => String(b.date || b.updatedAt || '').localeCompare(String(a.date || a.updatedAt || ''));
  return {
    repo: { ...newS.repo, headSha: newS.repo.headSha || oldS.repo.headSha },
    commits: [...commits.values()].sort(sortDate),
    pulls: [...pulls.values()].sort(sortDate),
    issues: [...issues.values()].sort(sortDate),
    files: newS.files, // the tree at HEAD is always re-read
    truncatedTree: newS.truncatedTree,
    report: newS.report,
  };
}

const cacheDir = () => process.env.TRACEWHY_CACHE_DIR || CACHE_DIR;
const cacheFile = (id) => path.join(cacheDir(), `${id.replace(/[^a-z0-9._-]/gi, '__')}.json`);

async function readCache(id) {
  try {
    return JSON.parse(await fs.readFile(cacheFile(id), 'utf8'));
  } catch {
    return null;
  }
}

async function writeCache(id, snapshot) {
  await fs.mkdir(cacheDir(), { recursive: true });
  await fs.writeFile(cacheFile(id), JSON.stringify(snapshot));
}

export async function deleteCache(id) {
  await fs.rm(cacheFile(id), { force: true });
}

function countBy(list) {
  return list.reduce((acc, k) => ((acc[k] = (acc[k] || 0) + 1), acc), {});
}
