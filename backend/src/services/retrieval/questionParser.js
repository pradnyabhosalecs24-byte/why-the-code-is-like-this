import { extractReferences } from '../parse/references.js';

const STOP = new Set(
  ('a an the and or but of to in on at by for with from into about as is are was were be been being this that these those it its ' +
    'why what which who whom when where how does did do done was were has have had can could should would will may might ' +
    'we our you your they their there here than then so not no yes any some all more most very just also only ' +
    'code repo repository project behaviour behavior known remains uncertain explain explains chosen choose chose ' +
    'like it its this way set get use used using make made add added set to value values file files function flag flags configuration config setting settings later original decision decisions reason reasons discussion introduced introduce link links evidence change changed')
    .split(' '),
);

/** Question -> retrieval terms and intent. Deterministic and explainable. */
export function parseQuestion(question, repoId = null) {
  const refs = extractReferences(question, repoId);
  const lower = question.toLowerCase();
  const keywords = [...new Set(lower.match(/[a-z][a-z0-9_-]{2,}/g) || [])].filter((w) => !STOP.has(w));
  const intent = {
    why: /\bwhy\b|\breason|rationale|motivat/.test(lower),
    who: /\bwho\b|\bauthor|introduced by/.test(lower),
    reversed: /revers|revert|supersed|replac|still (valid|current)|changed later|undo|roll(ed)? back/.test(lower),
    incident: /incident|outage|bug|crash|regression|post-?mortem/.test(lower),
    uncertain: /uncertain|unknown|not known|remains/.test(lower),
    notDone: /\bnot\b|never|didn'?t|wasn'?t|isn'?t/.test(lower),
  };
  const identifiers = [...new Set([...refs.identifiers, ...refs.paths])];
  return { keywords, identifiers, numbers: refs.numbers, shas: refs.shas, intent };
}

/** Escape Lucene special characters for the Neo4j full-text index. */
export function luceneQuery(keywords) {
  const esc = (t) => t.replace(/[+\-!(){}[\]^"~*?:\\/&|]/g, '\\$&');
  const terms = keywords.slice(0, 12).map((k) => (k.length >= 5 ? `${esc(k)} OR ${esc(k.slice(0, Math.max(4, k.length - 2)))}*` : esc(k)));
  return terms.join(' OR ');
}

/** Prefix stems used for substring matching against code identifiers ("retry" ~ "MAX_RETRIES"). */
export function stems(keywords) {
  return [...new Set(keywords.filter((k) => k.length >= 4).map((k) => k.slice(0, Math.min(k.length, Math.max(4, k.length - 2)))))];
}
