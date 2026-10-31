import { classifyPath } from '../parse/codeEntities.js';

const person = (u, fallbackName) =>
  u ? { login: u.login, name: u.name || u.login, url: u.html_url || `https://github.com/${u.login}` } : fallbackName ? { login: null, name: fallbackName, url: null } : null;

const comment = (c) => ({
  id: c.id,
  body: c.body || '',
  author: person(c.user),
  date: c.created_at,
  url: c.html_url,
  path: c.path || null,
});

/**
 * Download everything TraceWhy needs from GitHub into a plain JSON "snapshot".
 * Pure data out; no graph logic here. `since` (ISO) enables incremental imports.
 */
export async function fetchRepoSnapshot(gh, { owner, name }, { limits, since = null, onProgress = () => {} }) {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const progress = (stage, detail) => onProgress({ stage, detail });
  const report = { fetched: { commits: 0, pulls: 0, issues: 0, comments: 0, files: 0 }, skipped: [] };
  const FATAL = new Set(['GITHUB_RATE_LIMIT', 'GITHUB_BAD_TOKEN']);
  /** Fetch a non-essential sub-resource; on failure record a skip and continue (partial ingestion). */
  const safe = async (what, id, fn, fallback) => {
    try {
      return await fn();
    } catch (err) {
      if (FATAL.has(err.code)) throw err;
      report.skipped.push({ type: what, id: String(id), reason: err.code || err.message });
      return fallback;
    }
  };

  progress('repository', 'Reading repository metadata');
  const meta = await gh.get(base);
  const branch = meta.default_branch;
  const repo = {
    id: meta.full_name.toLowerCase(),
    fullName: meta.full_name,
    owner: meta.owner.login,
    name: meta.name,
    url: meta.html_url,
    description: meta.description || '',
    defaultBranch: branch,
    stars: meta.stargazers_count,
    fetchedAt: new Date().toISOString(),
  };
  if (meta.private) throw Object.assign(new Error('Only public repositories are supported.'), { status: 400, expose: true, code: 'PRIVATE_REPO' });

  // ---- Commits ----
  progress('commits', 'Listing commits');
  const sinceQ = since ? `&since=${encodeURIComponent(since)}` : '';
  let commitList = [];
  try {
    commitList = await gh.paginate(`${base}/commits?per_page=100&sha=${encodeURIComponent(branch)}${sinceQ}`, { max: limits.maxCommits });
  } catch (err) {
    if (err.code !== 'GITHUB_EMPTY_REPO' && err.code !== 'GITHUB_NOT_FOUND') throw err;
    report.emptyHistory = true; // brand-new repository: nothing to import, not an error
  }
  report.fetched.commits = commitList.length;
  const commits = commitList.map((c) => ({
    sha: c.sha,
    message: c.commit?.message || '',
    date: c.commit?.author?.date || c.commit?.committer?.date || null,
    url: c.html_url,
    author: person(c.author, c.commit?.author?.name),
    parents: (c.parents || []).map((p) => p.sha),
    files: null,
  }));
  repo.headSha = commits[0]?.sha || null;

  const detailCount = Math.min(commits.length, limits.maxCommitDetails);
  for (let i = 0; i < detailCount; i++) {
    if (i % 10 === 0) progress('commits', `Reading changed files ${i + 1}/${detailCount}`);
    const d = await safe('commit_files', commits[i].sha, () => gh.get(`${base}/commits/${commits[i].sha}`), null);
    if (!d) continue;
    commits[i].files = (d.files || []).map((f) => ({
      path: f.filename,
      status: f.status,
      previousPath: f.previous_filename || null,
      additions: f.additions,
      deletions: f.deletions,
    }));
  }

  // ---- Pull requests (sorted by update time so incremental import can stop early) ----
  progress('pulls', 'Listing pull requests');
  const pullList = report.emptyHistory ? [] : await gh.paginate(`${base}/pulls?state=all&sort=updated&direction=desc&per_page=100`, {
    max: limits.maxPulls,
    stop: since ? (p) => p.updated_at < since : undefined,
  });
  const pulls = [];
  for (let i = 0; i < pullList.length; i++) {
    const p = pullList[i];
    progress('pulls', `Reading PR #${p.number} (${i + 1}/${pullList.length})`);
    const [prCommits, reviewComments, convo] = await Promise.all([
      safe('pr_commits', `#${p.number}`, () => gh.paginate(`${base}/pulls/${p.number}/commits?per_page=100`, { max: 250 }), []),
      safe('pr_review_comments', `#${p.number}`, () => gh.paginate(`${base}/pulls/${p.number}/comments?per_page=100`, { max: 100 }), []),
      p.comments === 0 ? [] : safe('pr_comments', `#${p.number}`, () => gh.paginate(`${base}/issues/${p.number}/comments?per_page=100`, { max: 100 }), []),
    ]);
    report.fetched.comments += reviewComments.length + convo.length;
    pulls.push({
      number: p.number,
      title: p.title,
      body: p.body || '',
      state: p.state,
      merged: Boolean(p.merged_at),
      mergedAt: p.merged_at,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      url: p.html_url,
      author: person(p.user),
      commitShas: prCommits.map((c) => c.sha),
      reviewComments: reviewComments.map(comment),
      comments: convo.map(comment),
    });
  }

  // ---- Issues (the issues endpoint also returns PRs; skip those) ----
  progress('issues', 'Listing issues');
  report.fetched.pulls = pullList.length;
  const issueList = await gh.paginate(
    `${base}/issues?state=all&sort=updated&direction=desc&per_page=100${sinceQ}`,
    { max: limits.maxIssues * 2 },
  );
  const issues = [];
  let timelines = 0;
  for (const it of issueList) {
    if (it.pull_request) continue; // the issues endpoint also lists PRs; they were imported above
    if (issues.length >= limits.maxIssues) {
      report.skipped.push({ type: 'issue', id: `#${it.number}`, reason: 'IMPORT_MAX_ISSUES limit' });
      continue;
    }
    report.fetched.issues++;
    progress('issues', `Reading issue #${it.number}`);
    const comments = it.comments ? await safe('issue_comments', `#${it.number}`, () => gh.paginate(`${base}/issues/${it.number}/comments?per_page=100`, { max: 100 }), []) : [];
    report.fetched.comments += comments.length;
    let events = [];
    if (timelines < limits.maxTimelines) {
      timelines++;
      const tl = await safe('issue_timeline', `#${it.number}`, () => gh.paginate(`${base}/issues/${it.number}/timeline?per_page=100`, { max: 200 }), []);
      events = tl
        .filter((e) => ['cross-referenced', 'referenced', 'closed'].includes(e.event))
        .map((e) => ({
          type: e.event,
          date: e.created_at || null,
          actor: person(e.actor),
          commitSha: e.commit_id || null,
          sourceNumber: e.source?.issue?.number ?? null,
          sourceIsPull: Boolean(e.source?.issue?.pull_request),
          sourceRepo: e.source?.issue?.repository?.full_name?.toLowerCase() ?? null,
        }));
    }
    issues.push({
      number: it.number,
      title: it.title,
      body: it.body || '',
      state: it.state,
      labels: (it.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
      createdAt: it.created_at,
      closedAt: it.closed_at,
      updatedAt: it.updated_at,
      url: it.html_url,
      author: person(it.user),
      comments: comments.map(comment),
      events,
    });
  }

  // ---- Files at HEAD ----
  progress('files', 'Reading repository tree');
  const tree = report.emptyHistory ? { tree: [] } : await safe('tree', branch, () => gh.get(`${base}/git/trees/${encodeURIComponent(branch)}?recursive=1`), { tree: [] });
  const blobs = (tree.tree || []).filter((t) => t.type === 'blob');
  const ranked = blobs
    .map((b) => ({ path: b.path, size: b.size, kind: classifyPath(b.path) }))
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
  const files = [];
  let fetched = 0;
  for (const f of ranked) {
    let content = null;
    if (f.kind !== 'other' && (fetched >= limits.maxFiles || f.size > limits.maxFileBytes)) {
      report.skipped.push({ type: 'file_content', id: f.path, reason: f.size > limits.maxFileBytes ? 'larger than IMPORT_MAX_FILE_BYTES' : 'IMPORT_MAX_FILES limit' });
    }
    if (f.kind !== 'other' && fetched < limits.maxFiles && f.size <= limits.maxFileBytes) {
      fetched++;
      if (fetched % 10 === 0) progress('files', `Reading file contents ${fetched}/${Math.min(limits.maxFiles, ranked.length)}`);
      const r = await safe('file_content', f.path, () => gh.request(`${base}/contents/${f.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`, {
        accept: 'application/vnd.github.raw+json',
        allow404: true,
      }), { body: null });
      content = typeof r.body === 'string' ? r.body : null;
      if (content !== null) report.fetched.files++;
    }
    files.push({ ...f, content, url: `${repo.url}/blob/${branch}/${f.path}` });
  }

  return { repo, commits, pulls, issues, files, truncatedTree: Boolean(tree.truncated), report };
}

function kindRank(kind) {
  return { doc: 0, config: 1, source: 2, other: 3 }[kind] ?? 3;
}
