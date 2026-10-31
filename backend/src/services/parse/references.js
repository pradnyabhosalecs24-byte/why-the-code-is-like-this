/**
 * Extract explicit cross-references from free text (commit messages, PR bodies,
 * comments, docs). These are *explicit* mentions, never keyword similarity.
 */

const CLOSING = /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/gi;
const HASH_REF = /(?:^|[\s(\[,])(?:([\w.-]+\/[\w.-]+))?#(\d{1,7})\b/g;
const GH_URL = /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(issues|pull)\/(\d+)/gi;
const SHA = /\b([0-9a-f]{7,40})\b/g;
const REVERTS_COMMIT = /This reverts commit ([0-9a-f]{7,40})/i;
const REVERT_TITLE = /^Revert\s+"(.+)"\s*$/im;
const ADR_REF = /\bADR[-\s_#]?0*(\d{1,4})\b/gi;
const BACKTICK = /`([^`\n]{2,80})`/g;
const PATHLIKE = /(?:^|[\s(`'"])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,6}|[\w-]+\.(?:js|ts|py|go|rb|java|json|ya?ml|toml|md|env|cfg|ini))\b/g;
const IDENT = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[a-z]+(?:[A-Z][a-z0-9]+){1,}|[a-z]+(?:_[a-z0-9]+){1,})\b/g;

export function extractReferences(text, repoId = null) {
  const refs = { closes: [], numbers: [], shas: [], revertsSha: null, revertTitle: null, adrs: [], paths: [], identifiers: [] };
  if (!text) return refs;
  const sameRepo = (r) => !r || !repoId || r.toLowerCase() === repoId.toLowerCase();

  for (const m of text.matchAll(CLOSING)) if (sameRepo(m[2])) refs.closes.push(Number(m[3]));
  for (const m of text.matchAll(HASH_REF)) if (sameRepo(m[1])) refs.numbers.push(Number(m[2]));
  for (const m of text.matchAll(GH_URL)) if (sameRepo(m[1])) refs.numbers.push(Number(m[3]));

  const rv = text.match(REVERTS_COMMIT);
  if (rv) refs.revertsSha = rv[1].toLowerCase();
  const rt = text.match(REVERT_TITLE);
  if (rt) refs.revertTitle = rt[1];

  for (const m of text.matchAll(SHA)) {
    const s = m[1];
    // require both a digit and a letter so we don't match plain numbers or words
    if (/\d/.test(s) && /[a-f]/.test(s)) refs.shas.push(s.toLowerCase());
  }
  for (const m of text.matchAll(ADR_REF)) refs.adrs.push(Number(m[1]));
  for (const m of text.matchAll(PATHLIKE)) refs.paths.push(m[1]);
  for (const m of text.matchAll(BACKTICK)) {
    const t = m[1].trim();
    if (/^[\w./-]+$/.test(t)) refs.identifiers.push(t);
  }
  for (const m of text.matchAll(IDENT)) refs.identifiers.push(m[1]);

  for (const k of Object.keys(refs)) if (Array.isArray(refs[k])) refs[k] = [...new Set(refs[k])];
  refs.numbers = refs.numbers.filter((n) => n > 0);
  return refs;
}

/** Explicit supersession language. Returns the matched phrase or null. */
export function supersessionCue(text) {
  if (!text) return null;
  const m = text.match(
    /\b(supersed(?:es|ed by)|replac(?:es|ed by|ing)|revert(?:s|ed|ing)?|roll(?:s|ed)? back|undo(?:es)?|no longer|instead of|switch(?:es|ed)? (?:back )?(?:from|to)|migrat(?:es|ed|e) (?:away )?from|deprecat(?:es|ed)|in favou?r of)\b/i,
  );
  return m ? m[0] : null;
}
