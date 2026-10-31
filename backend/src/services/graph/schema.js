/** Single source of truth for the knowledge-graph schema. */

export const NODE_LABELS = [
  'Repository', 'File', 'Module', 'Function', 'Configuration', 'Commit', 'PullRequest',
  'Issue', 'Incident', 'Decision', 'Person', 'Evidence',
];

export const REL_TYPES = [
  'CONTAINS', 'CHANGED_BY', 'DISCUSSED_IN', 'INTRODUCED_BY', 'AFFECTS', 'AUTHORED_BY',
  'RELATED_TO', 'SUPPORTED_BY', 'SUPERSEDES', 'REPORTED_IN', 'RENAMED_FROM', 'MOTIVATED_BY',
];

/** Labels that also carry the generic :CodeEntity label in Neo4j. */
export const CODE_ENTITY_LABELS = new Set(['Function', 'Configuration', 'Module']);

/** Relationship types the retriever may walk while collecting evidence. */
export const TRAVERSABLE = REL_TYPES;

/** Hub nodes: reachable, but never expanded further (they connect everything). */
export const HUB_LABELS = new Set(['Repository', 'Person', 'Module']);

/**
 * Reliability of a relationship, used for ranking and the confidence explanation.
 * These are hand-set ordinal weights, NOT probabilities.
 */
export const METHOD_WEIGHT = {
  // confirmed by GitHub's structured data
  github_pr_commits: 1, github_commit_files: 1, github_author: 1, github_record: 1,
  github_rename_status: 1, repository_tree: 1, github_timeline_cross_reference: 0.95,
  github_timeline_referenced: 0.95, github_timeline_closed: 0.95, review_comment_on_file: 0.95,
  statement_extracted_from: 1, adr_document: 1, same_statement_in_another_record: 0.9,
  decision_source_commit: 1, decision_source_pull: 1, decision_source_issue: 1, decision_source_doc: 1,
  changed_in_introducing_commit: 0.9, changed_in_introducing_pr: 0.85, author_of_source_record: 1,
  regex_symbol_extraction: 0.9, config_key_extraction: 0.95, commit_history: 1, pull_requests: 1, issues: 1,
  // inferred from text
  merge_commit_message: 0.95, squash_commit_message: 0.9, git_revert: 0.95, adr_status: 0.95,
  closing_keyword: 0.85, explicit_reference: 0.8, explicit_sha_reference: 0.8,
  explicit_number_reference: 0.7, identifier_mention: 0.6, mentioned_in_incident_report: 0.6,
  incident_label: 0.8, incident_title_keyword: 0.55, incident_document_path: 0.6,
  possible_conflict: 0.5, same_display_name: 0.4,
  introducing_record_resolves_issue: 0.8, motivating_issue_reports_incident: 0.75,
};

export function relWeight(rel) {
  const p = rel.props || {};
  let w = METHOD_WEIGHT[p.method] ?? (p.origin === 'inferred' ? 0.55 : 0.9);
  if (p.ambiguous) w *= 0.6;
  return w;
}

/** Cypher statements that create constraints and indexes (idempotent). */
export function schemaStatements() {
  const stmts = ['CREATE CONSTRAINT tw_id IF NOT EXISTS FOR (n:TW) REQUIRE n.id IS UNIQUE'];
  for (const l of NODE_LABELS) stmts.push(`CREATE CONSTRAINT ${l.toLowerCase()}_id IF NOT EXISTS FOR (n:${l}) REQUIRE n.id IS UNIQUE`);
  stmts.push('CREATE INDEX tw_repo IF NOT EXISTS FOR (n:TW) ON (n.repo)');
  stmts.push('CREATE INDEX code_entity_repo IF NOT EXISTS FOR (n:CodeEntity) ON (n.repo)');
  stmts.push('CREATE INDEX tw_type IF NOT EXISTS FOR (n:TW) ON (n.repo, n.nodeType)');
  stmts.push(
    'CREATE FULLTEXT INDEX tw_text IF NOT EXISTS FOR (n:Decision|Evidence|PullRequest|Issue|Commit|Incident) ON EACH [n.statement, n.rationale, n.text, n.title, n.message]',
  );
  return stmts;
}
