import { extractCodeEntities, moduleOf, languageOf } from '../parse/codeEntities.js';
import { extractReferences } from '../parse/references.js';
import { extractDecisionCandidates, parseAdr, adrToDecision, stableId } from '../extraction/decisions.js';
import { createSymbolIndex, personId, inferPersonAliases } from '../resolution/entityResolver.js';
import { detectSupersession } from '../temporal/supersession.js';

const MAX_TEXT = 4000;
const MAX_AFFECTS_FROM_CHANGES = 25;
const INCIDENT_LABEL = /incident|outage|regression|post-?mortem|\bsev[-_ ]?\d|production|crash|data[-_ ]?loss|security/i;
const INCIDENT_TITLE = /\b(incident|outage|post-?mortem|regression|crash(es|ed)?|production (issue|bug|down)|data loss)\b/i;

/**
 * Pure transformation: GitHub snapshot -> { nodes, rels, decisions, stats }.
 * No I/O. Every node has a stable `id` and `repo`; every relationship records
 * `origin` ("confirmed" = GitHub structured data, "inferred" = parsed from text)
 * and the `method` that produced it.
 */
export function buildGraph(snapshot, { decisionFilter = null } = {}) {
  const { repo } = snapshot;
  const R = repo.id;
  const SYN = Boolean(repo.synthetic);
  const now = new Date().toISOString();
  const nodes = new Map();
  const rels = new Map();

  const node = (id, label, props) => {
    if ('url' in props) props = { ...props, ...safeUrl(props.url) };
    const prev = nodes.get(id);
    if (prev) Object.assign(prev.props, stripUndefined(props));
    else nodes.set(id, { id, label, props: { id, nodeType: label, ...(label === 'Person' ? {} : { repo: R }), ...(SYN ? { synthetic: true } : {}), importedAt: now, ...stripUndefined(props) } });
    return id;
  };
  const rel = (type, from, to, props = {}) => {
    if (!from || !to || from === to || !nodes.has(from) || !nodes.has(to)) return;
    const key = `${type}|${from}|${to}`;
    if (!rels.has(key)) rels.set(key, { type, from, to, props: { origin: 'confirmed', importedAt: now, ...stripUndefined(props) } });
  };
  const personNode = (author) => {
    // synthetic people are scoped to the demo repo so they can never merge with real GitHub accounts
    const id = SYN && author ? `person:${R}:demo:${(author.login || author.name || '').toLowerCase()}` : personId(author, R);
    if (!id) return null;
    return node(id, 'Person', { login: author.login || null, name: author.name || author.login, url: author.url || null, resolution: author.login ? 'github_account' : 'unlinked_name' });
  };
  const evidence = (parentId, kind, sourceType, { text, url, author, date, title, extra = {} }) => {
    const id = `evidence:${stableId(R, kind, url || '', (text || '').slice(0, 200))}`;
    const aId = personNode(author);
    node(id, 'Evidence', {
      kind,
      sourceType,
      title: title || null,
      text: (text || '').slice(0, MAX_TEXT),
      url: url || null,
      author: author?.login || author?.name || null,
      date: date || null,
      ...extra,
    });
    rel('CONTAINS', parentId, id, { method: 'github_record' });
    if (aId) rel('AUTHORED_BY', id, aId, { method: 'github_author' });
    return id;
  };

  node(`repo:${R}`, 'Repository', {
    name: repo.fullName, owner: repo.owner, url: repo.url, description: repo.description,
    defaultBranch: repo.defaultBranch, headSha: repo.headSha, lastImportAt: repo.fetchedAt,
  });
  const repoNode = `repo:${R}`;
  const index = createSymbolIndex();

  // ---------- Files, modules, functions, configuration at HEAD ----------
  const fileId = (path) => `file:${R}:${path}`;
  const headPaths = new Set(snapshot.files.map((f) => f.path));
  const fileByPath = new Map(snapshot.files.map((f) => [f.path, f]));
  const ensureFile = (path) =>
    nodes.has(fileId(path))
      ? fileId(path)
      : node(fileId(path), 'File', { path, language: languageOf(path), existsAtHead: headPaths.has(path), kind: fileByPath.get(path)?.kind || 'other', url: headPaths.has(path) ? `${repo.url}/blob/${repo.defaultBranch}/${path}` : null });

  for (const f of snapshot.files) {
    if (f.kind === 'other') continue; // keep the graph focused on code/config/docs
    const fid = ensureFile(f.path);
    index.addFile(f.path, fid);
    const mod = moduleOf(f.path);
    if (mod) {
      const mid = node(`module:${R}:${mod}`, 'Module', { path: mod, name: mod.split('/').pop() });
      rel('CONTAINS', repoNode, mid, { method: 'repository_tree' });
      rel('CONTAINS', mid, fid, { method: 'repository_tree' });
    } else rel('CONTAINS', repoNode, fid, { method: 'repository_tree' });

    const ents = extractCodeEntities(f.path, f.content);
    for (const fn of ents.functions) {
      const id = node(`fn:${R}:${f.path}#${fn.name}`, 'Function', { name: fn.name, kind: fn.kind, path: f.path, line: fn.line, url: `${f.url}#L${fn.line}` });
      rel('CONTAINS', fid, id, { method: 'regex_symbol_extraction' });
      index.addFunction(fn.name, id, f.path);
    }
    for (const c of ents.configs) {
      const id = node(`cfg:${R}:${f.path}#${c.key}`, 'Configuration', { key: c.key, value: c.value, kind: c.kind, path: f.path, line: c.line, url: c.line ? `${f.url}#L${c.line}` : f.url });
      rel('CONTAINS', fid, id, { method: 'config_key_extraction' });
      index.addConfig(c.key, id, f.path);
    }
  }

  // ---------- Commits ----------
  const commitId = (sha) => `commit:${R}:${sha}`;
  const commitBySha = new Map(snapshot.commits.map((c) => [c.sha, c]));
  const filesOfCommit = new Map();
  for (const c of snapshot.commits) {
    const cid = node(commitId(c.sha), 'Commit', { sha: c.sha, shortSha: c.sha.slice(0, 7), title: c.message.split('\n')[0].slice(0, 200), message: c.message.slice(0, MAX_TEXT), date: c.date, url: c.url, author: c.author?.login || c.author?.name || null });
    rel('CONTAINS', repoNode, cid, { method: 'commit_history' });
    const aId = personNode(c.author);
    if (aId) rel('AUTHORED_BY', cid, aId, { method: 'github_author' });
    evidence(cid, 'commit_message', 'Commit', { text: c.message, url: c.url, author: c.author, date: c.date, title: c.message.split('\n')[0] });

    const changed = [];
    for (const f of c.files || []) {
      const fid = ensureFile(f.path);
      changed.push(fid);
      rel('CHANGED_BY', fid, cid, { method: 'github_commit_files', status: f.status, additions: f.additions, deletions: f.deletions });
      if (f.status === 'renamed' && f.previousPath) {
        const oldId = ensureFile(f.previousPath);
        rel('RENAMED_FROM', fid, oldId, { method: 'github_rename_status', commit: c.sha, date: c.date });
        index.addRename(f.previousPath, f.path);
      }
    }
    filesOfCommit.set(c.sha, changed);
  }

  // ---------- Pull requests ----------
  const prId = (n) => `pr:${R}:${n}`;
  const issueId = (n) => `issue:${R}:${n}`;
  const prNumbers = new Set(snapshot.pulls.map((p) => p.number));
  const issueNumbers = new Set(snapshot.issues.map((i) => i.number));
  const numberTarget = (n) => (prNumbers.has(n) ? prId(n) : issueNumbers.has(n) ? issueId(n) : null);
  const evidenceOf = []; // {evId, kind, record:{...}, sourceCtx}

  for (const p of snapshot.pulls) {
    const pid = node(prId(p.number), 'PullRequest', { number: p.number, title: p.title, state: p.state, merged: p.merged, mergedAt: p.mergedAt, createdAt: p.createdAt, date: p.mergedAt || p.createdAt, url: p.url, author: p.author?.login || null });
    rel('CONTAINS', repoNode, pid, { method: 'pull_requests' });
    const aId = personNode(p.author);
    if (aId) rel('AUTHORED_BY', pid, aId, { method: 'github_author' });
    for (const sha of p.commitShas) if (commitBySha.has(sha)) rel('DISCUSSED_IN', commitId(sha), pid, { method: 'github_pr_commits' });

    const ctx = { kind: 'pull', number: p.number, title: p.title, shas: p.commitShas, merged: p.merged, recordId: pid };
    const desc = evidence(pid, 'pr_description', 'PullRequest', { text: `${p.title}\n\n${p.body}`, url: p.url, author: p.author, date: p.createdAt, title: p.title });
    evidenceOf.push({ evId: desc, record: { id: desc, type: 'pr_description', title: p.title, text: p.body, url: p.url, author: p.author, date: p.mergedAt || p.createdAt }, ctx });
    for (const c of p.reviewComments) {
      const e = evidence(pid, 'pr_review_comment', 'PullRequest', { text: c.body, url: c.url, author: c.author, date: c.date, title: `Review on ${c.path || 'PR #' + p.number}`, extra: { codePath: c.path } });
      if (c.path) rel('RELATED_TO', e, ensureFile(c.path), { method: 'review_comment_on_file' });
      evidenceOf.push({ evId: e, record: { id: e, type: 'pr_review_comment', text: c.body, url: c.url, author: c.author, date: c.date }, ctx });
    }
    for (const c of p.comments) {
      const e = evidence(pid, 'pr_comment', 'PullRequest', { text: c.body, url: c.url, author: c.author, date: c.date, title: `Comment on PR #${p.number}` });
      evidenceOf.push({ evId: e, record: { id: e, type: 'pr_comment', text: c.body, url: c.url, author: c.author, date: c.date }, ctx });
    }
  }

  // Squash / merge commit messages that reference a PR: inferred DISCUSSED_IN
  const squashPr = new Map();
  for (const c of snapshot.commits) {
    const first = c.message.split('\n')[0];
    const m = first.match(/\(#(\d+)\)\s*$/) || first.match(/^Merge pull request #(\d+)/);
    if (m && prNumbers.has(Number(m[1]))) {
      squashPr.set(c.sha, Number(m[1]));
      rel('DISCUSSED_IN', commitId(c.sha), prId(Number(m[1])), { origin: 'inferred', method: first.startsWith('Merge') ? 'merge_commit_message' : 'squash_commit_message' });
    }
  }

  // ---------- Issues & incidents ----------
  for (const it of snapshot.issues) {
    const iid = node(issueId(it.number), 'Issue', { number: it.number, title: it.title, state: it.state, labels: it.labels, createdAt: it.createdAt, closedAt: it.closedAt, date: it.createdAt, url: it.url, author: it.author?.login || null });
    rel('CONTAINS', repoNode, iid, { method: 'issues' });
    const aId = personNode(it.author);
    if (aId) rel('AUTHORED_BY', iid, aId, { method: 'github_author' });
    const ctx = { kind: 'issue', number: it.number, title: it.title, merged: null, recordId: iid };
    const body = evidence(iid, 'issue_body', 'Issue', { text: `${it.title}\n\n${it.body}`, url: it.url, author: it.author, date: it.createdAt, title: it.title });
    evidenceOf.push({ evId: body, record: { id: body, type: 'issue_body', title: it.title, text: it.body, url: it.url, author: it.author, date: it.createdAt }, ctx });
    for (const c of it.comments) {
      const e = evidence(iid, 'issue_comment', 'Issue', { text: c.body, url: c.url, author: c.author, date: c.date, title: `Comment on #${it.number}` });
      evidenceOf.push({ evId: e, record: { id: e, type: 'issue_comment', text: c.body, url: c.url, author: c.author, date: c.date }, ctx });
    }
    for (const ev of it.events) {
      if (ev.type === 'cross-referenced' && ev.sourceNumber && (!ev.sourceRepo || ev.sourceRepo === R)) {
        rel('RELATED_TO', numberTarget(ev.sourceNumber), iid, { method: 'github_timeline_cross_reference', date: ev.date });
      }
      if ((ev.type === 'referenced' || ev.type === 'closed') && ev.commitSha && commitBySha.has(ev.commitSha)) {
        rel('RELATED_TO', commitId(ev.commitSha), iid, { method: `github_timeline_${ev.type}`, date: ev.date });
      }
    }
    const isIncident = it.labels.some((l) => INCIDENT_LABEL.test(l)) || INCIDENT_TITLE.test(it.title);
    if (isIncident) {
      const incId = node(`incident:${R}:issue:${it.number}`, 'Incident', { title: it.title, date: it.createdAt, labels: it.labels, url: it.url, detectedBy: it.labels.some((l) => INCIDENT_LABEL.test(l)) ? 'label' : 'title_keyword' });
      rel('REPORTED_IN', incId, iid, { origin: 'inferred', method: it.labels.some((l) => INCIDENT_LABEL.test(l)) ? 'incident_label' : 'incident_title_keyword' });
      const refs = extractReferences(`${it.title}\n${it.body}`, R);
      for (const hit of index.resolveAll([...refs.paths, ...refs.identifiers])) {
        rel('AFFECTS', incId, hit.id, { origin: 'inferred', method: 'mentioned_in_incident_report', ambiguous: hit.ambiguous, mention: hit.mention });
      }
    }
  }

  // ---------- Text references between records (explicit #N / sha mentions) ----------
  for (const e of evidenceOf) {
    const text = [e.record.title, e.record.text].filter(Boolean).join('\n');
    const refs = extractReferences(text, R);
    e.refs = refs;
    const fromRecord = e.ctx.recordId;
    for (const n of refs.closes) {
      const t = numberTarget(n);
      if (t) rel('RELATED_TO', fromRecord, t, { origin: 'inferred', method: 'closing_keyword', evidenceId: e.evId });
    }
    for (const n of refs.numbers) {
      const t = numberTarget(n);
      if (t && !refs.closes.includes(n)) rel('RELATED_TO', fromRecord, t, { origin: 'inferred', method: 'explicit_number_reference', evidenceId: e.evId });
    }
    for (const sha of refs.shas) {
      const full = [...commitBySha.keys()].find((s) => s.startsWith(sha));
      if (full) rel('RELATED_TO', fromRecord, commitId(full), { origin: 'inferred', method: 'explicit_sha_reference', evidenceId: e.evId });
    }
    for (const hit of index.resolveAll([...refs.paths, ...refs.identifiers])) {
      rel('RELATED_TO', e.evId, hit.id, { origin: 'inferred', method: 'identifier_mention', ambiguous: hit.ambiguous, candidates: hit.candidates, mention: hit.mention });
    }
  }
  // commit messages referencing issues / PRs (e.g. "fix: retry storm (#42)", "Fixes #12")
  for (const c of snapshot.commits) {
    const refs = extractReferences(c.message, R);
    for (const n of refs.closes) rel('RELATED_TO', commitId(c.sha), numberTarget(n), { origin: 'inferred', method: 'closing_keyword' });
    for (const n of refs.numbers) if (squashPr.get(c.sha) !== n) rel('RELATED_TO', commitId(c.sha), numberTarget(n), { origin: 'inferred', method: 'explicit_number_reference' });
    const evId = `evidence:${stableId(R, 'commit_message', c.url || '', (c.message || '').slice(0, 200))}`;
    for (const hit of index.resolveAll([...refs.paths, ...refs.identifiers])) {
      rel('RELATED_TO', evId, hit.id, { origin: 'inferred', method: 'identifier_mention', ambiguous: hit.ambiguous, candidates: hit.candidates, mention: hit.mention });
    }
    evidenceOf.push({
      evId,
      refs,
      record: { id: evId, type: 'commit_message', text: c.message, url: c.url, author: c.author, date: c.date },
      ctx: { kind: 'commit', sha: c.sha, title: c.message.split('\n')[0], number: squashPr.get(c.sha) ?? null, merged: true, recordId: commitId(c.sha) },
    });
  }

  // ---------- Documentation: sections as evidence, ADRs as decisions ----------
  const adrDecisions = [];
  for (const f of snapshot.files) {
    if (f.kind !== 'doc' || !f.content) continue;
    const fid = fileId(f.path);
    const adr = parseAdr(f.path, f.content);
    if (adr) adrDecisions.push({ adr, file: f });
    const sections = splitDocSections(f.content).slice(0, 40);
    for (const s of sections) {
      const e = evidence(fid, adr ? 'adr' : 'doc_section', 'File', { text: s.text, url: s.anchor ? `${f.url}#${s.anchor}` : f.url, title: `${f.path}${s.heading ? ' › ' + s.heading : ''}`, date: null });
      const refs = extractReferences(s.text, R);
      for (const hit of index.resolveAll([...refs.paths, ...refs.identifiers])) {
        rel('RELATED_TO', e, hit.id, { origin: 'inferred', method: 'identifier_mention', ambiguous: hit.ambiguous, candidates: hit.candidates, mention: hit.mention });
      }
      if (!adr) evidenceOf.push({ evId: e, refs, record: { id: e, type: 'doc_section', title: s.heading, text: s.text, url: f.url, author: null, date: null }, ctx: { kind: 'doc', path: f.path, merged: true, recordId: fid } });
    }
    if (/post-?mortem|incident/i.test(f.path)) {
      const incId = node(`incident:${R}:doc:${f.path}`, 'Incident', { title: sections[0]?.heading || f.path, date: null, url: f.url, detectedBy: 'document_path' });
      rel('REPORTED_IN', incId, fid, { origin: 'inferred', method: 'incident_document_path' });
    }
  }

  // ---------- Decisions ----------
  const decisions = [];
  const byStatement = new Map();
  const changedFilesFor = (ctx) => {
    if (ctx.kind === 'commit') return filesOfCommit.get(ctx.sha) || [];
    if (ctx.kind === 'pull') return [...new Set(ctx.shas.flatMap((s) => filesOfCommit.get(s) || []))];
    return [];
  };

  const addDecision = (cand, ctx, evId, refs) => {
    if (!cand.statement) return;
    if (decisionFilter && !decisionFilter(cand)) return;
    const norm = cand.statement.replace(/\s*\(#\d+\)\s*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    let existing = byStatement.get(norm);
    if (!existing && norm.length >= 15) {
      // a squash-commit title that repeats the start of its PR's decision sentence
      for (const [k, d] of byStatement) if (k.startsWith(norm) && (d.source.number === ctx.number || (d.source.shas || []).includes(ctx.sha))) existing = d;
    }
    if (existing) {
      rel('SUPPORTED_BY', existing.id, evId, { method: 'same_statement_in_another_record' });
      return;
    }
    const did = node(cand.id, 'Decision', {
      statement: cand.statement, rationale: cand.rationale, alternatives: cand.alternatives, date: cand.date,
      author: cand.author, sourceType: cand.sourceType, url: cand.url, extractionMethod: cand.method,
      rationaleStated: Boolean(cand.rationale), adrNumber: cand.adrNumber ?? null,
    });
    rel('SUPPORTED_BY', did, evId, { method: cand.method === 'adr' ? 'adr_document' : 'statement_extracted_from' });
    rel('INTRODUCED_BY', did, ctx.recordId, { method: `decision_source_${ctx.kind}` });
    const aNode = cand.author ? [...nodes.values()].find((n) => n.label === 'Person' && (n.props.login === cand.author || n.props.name === cand.author)) : null;
    if (aNode) rel('AUTHORED_BY', did, aNode.id, { method: 'author_of_source_record' });

    const affects = [];
    const changed = changedFilesFor(ctx);
    for (const fid of changed.slice(0, MAX_AFFECTS_FROM_CHANGES)) {
      rel('AFFECTS', did, fid, { method: ctx.kind === 'commit' ? 'changed_in_introducing_commit' : 'changed_in_introducing_pr', truncated: changed.length > MAX_AFFECTS_FROM_CHANGES });
      affects.push({ id: fid, label: 'File', name: nodes.get(fid)?.props.path });
    }
    const mentionRefs = extractReferences(`${cand.statement}\n${cand.rationale || ''}`, R);
    for (const hit of index.resolveAll([...mentionRefs.paths, ...mentionRefs.identifiers])) {
      rel('AFFECTS', did, hit.id, { origin: 'inferred', method: 'identifier_mention', ambiguous: hit.ambiguous, candidates: hit.candidates, mention: hit.mention });
      affects.push({ id: hit.id, label: hit.label, name: hit.name });
    }
    const affectsAtHead = affects.filter((a) => a.label !== 'File' || nodes.get(a.id)?.props.existsAtHead).length;
    const d = {
      id: did, date: cand.date, statement: cand.statement, fullText: evidenceText(nodes, evId), refs: refs || extractReferences(evidenceText(nodes, evId), R),
      source: { kind: ctx.kind, sha: ctx.sha, number: ctx.number ?? null, path: ctx.path, title: ctx.title, shas: ctx.shas },
      affects, affectsAtHead, merged: ctx.merged, adrNumber: cand.adrNumber ?? null,
      adrSupersedes: cand.adrSupersedes || [], adrSupersededBy: cand.adrSupersededBy || [], declaredStatus: cand.declaredStatus || null,
    };
    byStatement.set(norm, d);
    decisions.push(d);
  };

  for (const { adr, file } of adrDecisions) {
    const cand = adrToDecision(adr, file, R);
    const evId = [...rels.values()].find((r) => r.type === 'CONTAINS' && r.from === fileId(file.path) && nodes.get(r.to)?.label === 'Evidence')?.to;
    if (evId) addDecision(cand, { kind: 'doc', path: file.path, merged: true, recordId: fileId(file.path) }, evId, extractReferences(file.content, R));
  }
  for (const e of evidenceOf) {
    for (const cand of extractDecisionCandidates(e.record)) addDecision(cand, e.ctx, e.evId, e.refs);
  }

  // ---------- Temporal reasoning ----------
  const { links, statuses } = detectSupersession(decisions);
  for (const l of links) {
    if (l.type === 'SUPERSEDES') rel('SUPERSEDES', l.from, l.to, { origin: 'inferred', method: l.method, reason: l.reason, date: l.date });
    else rel('RELATED_TO', l.from, l.to, { origin: 'inferred', method: 'possible_conflict', reason: l.reason, date: l.date });
  }
  // ---------- Motivation: the issue the introducing PR/commit explicitly resolves ----------
  const RESOLVES = new Set(['closing_keyword', 'github_timeline_cross_reference', 'github_timeline_closed']);
  const relList0 = [...rels.values()];
  const motivatedBy = new Map();
  for (const d of decisions) {
    const introducing = relList0.find((r) => r.type === 'INTRODUCED_BY' && r.from === d.id)?.to;
    if (!introducing) continue;
    const records = [introducing, ...relList0.filter((r) => r.type === 'DISCUSSED_IN' && r.from === introducing).map((r) => r.to)];
    for (const rec of records) {
      for (const r of relList0) {
        const other = r.from === rec ? r.to : r.to === rec ? r.from : null;
        if (!other || r.type !== 'RELATED_TO' || !RESOLVES.has(r.props.method) || nodes.get(other)?.label !== 'Issue') continue;
        rel('MOTIVATED_BY', d.id, other, { origin: 'inferred', method: 'introducing_record_resolves_issue', via: r.props.method });
        motivatedBy.set(d.id, true);
        for (const inc of relList0.filter((x) => x.type === 'REPORTED_IN' && x.to === other)) {
          rel('MOTIVATED_BY', d.id, inc.from, { origin: 'inferred', method: 'motivating_issue_reports_incident' });
        }
      }
    }
  }

  const relList1 = [...rels.values()];
  for (const d of decisions) {
    const s = statuses[d.id];
    const support = relList1.filter((r) => r.type === 'SUPPORTED_BY' && r.from === d.id);
    const affects = relList1.filter((r) => r.type === 'AFFECTS' && r.from === d.id);
    const sourceKind = nodes.get(support[0]?.to)?.props.kind;
    const conf = decisionConfidence({
      rationaleStated: Boolean(nodes.get(d.id).props.rationale),
      sourceKind,
      supportCount: support.length,
      motivated: motivatedBy.has(d.id),
      affectsConfirmed: affects.some((r) => r.props.origin === 'confirmed'),
      affectsInferred: affects.some((r) => r.props.origin === 'inferred'),
      status: s.status,
    });
    Object.assign(nodes.get(d.id).props, { status: s.status, statusReason: s.reason, confidenceScore: conf.score, confidenceLevel: conf.level, confidenceBasis: conf.parts });
  }

  // ---------- People: record possible aliases without merging ----------
  const people = [...nodes.values()].filter((n) => n.label === 'Person').map((n) => ({ id: n.id, login: n.props.login, name: n.props.name }));
  for (const a of inferPersonAliases(people)) rel('RELATED_TO', a.from, a.to, { origin: 'inferred', method: a.method });

  const nodeList = [...nodes.values()];
  const relList = [...rels.values()];
  return {
    importedAt: now,
    nodes: nodeList,
    rels: relList,
    decisions: decisions.map((d) => ({ id: d.id, statement: d.statement, status: statuses[d.id].status })),
    stats: countBy(nodeList, (n) => n.label),
    relStats: countBy(relList, (r) => r.type),
  };
}

function evidenceText(nodes, id) {
  return nodes.get(id)?.props.text || '';
}

export function splitDocSections(content) {
  const out = [];
  let cur = { heading: null, lines: [] };
  const flush = () => {
    const text = cur.lines.join('\n').trim();
    if (text.length >= 40) out.push({ heading: cur.heading, anchor: cur.heading ? slug(cur.heading) : null, text: (cur.heading ? `${cur.heading}\n` : '') + text.slice(0, 1500) });
  };
  for (const line of content.split(/\r?\n/)) {
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) {
      flush();
      cur = { heading: h[1].trim(), lines: [] };
    } else cur.lines.push(line);
  }
  flush();
  return out;
}

const slug = (s) => s.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
const stripUndefined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const countBy = (arr, fn) => arr.reduce((acc, x) => ((acc[fn(x)] = (acc[fn(x)] || 0) + 1), acc), {});

/**
 * Only GitHub links and TraceWhy's own synthetic-record viewer are kept as source links.
 * Anything else (javascript:, data:, unknown hosts) is dropped and marked unavailable.
 */
export function safeUrl(url) {
  if (url === null || url === undefined) return { url: null, urlStatus: 'missing' };
  const u = String(url);
  if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(u) || /^\/api\/demo\/records\/[\w:.\/#-]+$/.test(u)) return { url: u, urlStatus: 'ok' };
  return { url: null, urlStatus: 'unavailable' };
}

/**
 * Per-decision confidence (0-100, ordinal points; NOT a probability).
 *  +30 rationale stated verbatim in the source      +20/+12/+8 source quality
 *  +10 per additional supporting record (max +20)   +10 motivated by a linked issue/incident
 *  +10 affected code linked by confirmed edge (+5 if only inferred)
 *  status: active +10, superseded 0, unknown -5, disputed -15
 * Level: >=70 high, >=45 medium, else low.
 */
export function decisionConfidence({ rationaleStated, sourceKind, supportCount, motivated, affectsConfirmed, affectsInferred, status }) {
  const quality = { adr: 20, pr_description: 20, doc_section: 12, pr_review_comment: 12, commit_message: 12 }[sourceKind] ?? 8;
  const parts = [
    ['rationale stated', rationaleStated ? 30 : 0],
    ['source quality', quality],
    ['corroboration', Math.min(20, Math.max(0, supportCount - 1) * 10)],
    ['motivating issue', motivated ? 10 : 0],
    ['affected code', affectsConfirmed ? 10 : affectsInferred ? 5 : 0],
    ['status', { active: 10, superseded: 0, unknown: -5, disputed: -15 }[status] ?? 0],
  ];
  const score = Math.max(0, Math.min(100, parts.reduce((a, [, v]) => a + v, 0)));
  return { score, level: score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low', parts: parts.map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ') };
}
