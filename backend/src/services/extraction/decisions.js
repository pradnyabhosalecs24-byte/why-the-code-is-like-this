import crypto from 'node:crypto';

/**
 * Pattern-based decision extraction. Every field is a verbatim span of the source
 * text (or null). Nothing is paraphrased or invented here, so each candidate can be
 * traced back to its evidence. Optional LLM refinement lives in llmRefine.js.
 */

export const DECISION_CUE =
  /\b(we(?:'ve| have)? (?:decided|chose|choose|opted|agreed|settled)|decided to|decision\s*:|we(?:'ll| will| should) (?:use|keep|switch|move|stop|avoid|not|stick)|switch(?:ed|es|ing)? (?:back )?(?:from|to)|migrat(?:e|ed|es|ing) (?:away )?(?:from|to)|replac(?:e|ed|es|ing)\b.{1,60}\bwith|instead of|rather than|in favou?r of|go(?:ing)? with|deprecat(?:e|ed|es|ing)|no longer|(?:set|change|changed|bump(?:ed)?|increase[ds]?|decrease[ds]?|reduce[ds]?|lower(?:ed)?|raise[ds]?|limit(?:ed)?|cap(?:ped)?)\b.{0,60}\bto \d[\w.]*|revert(?:s|ed|ing)?\b|do not migrate|don't migrate|won't migrate|keep(?:ing)? .{1,40} (?:as is|for now|unchanged)|disable[ds]? by default|enable[ds]? by default)/i;

/** Text that tries to instruct an AI system. Treated as data, never as rationale or a decision. */
export const INJECTION_RE = /\b(ignore|disregard|forget) (all |any |the )?(previous|prior|above|earlier) (instructions|prompts?|rules)|\byou are (now )?(chatgpt|an? (ai|assistant|language model))|\b(system|developer) prompt\b|\bact as (an? )?(ai|assistant)\b|\bnew instructions?:/i;

export const RATIONALE_CUE =
  /\b(because|since|due to|so that|in order to|to (?:avoid|prevent|reduce|improve|fix|support|keep|allow)|otherwise|the reason|reasons?:|rationale|motivation|this (?:fixes|prevents|avoids|reduces|improves|ensures)|caused|which (?:caused|led to|broke)|as (?:it|this|that) (?:was|is|caused))\b/i;

const ALT_RE = /\b(?:instead of|rather than|in favou?r of|over|considered|alternatives? (?:was|were|is|are|considered)?:?)\s+([^.;\n]{3,100})/i;

const BOILERPLATE = /^(This reverts commit|\(cherry picked from|Signed-off-by|Co-authored-by|Merge (branch|pull request))/i;
const TEMPLATE_NOISE = /^(- \[[ x]\]|<!--|#+\s*(checklist|type of change|how has this been tested))/i;

export function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .split(/\r?\n/)
    .filter((l) => !/^\s*>/.test(l) && !TEMPLATE_NOISE.test(l.trim()))
    .join('\n');
}

export function splitSentences(text) {
  const out = [];
  for (const para of cleanText(text).split(/\n\s*\n/)) {
    const flat = para.replace(/\s*\n\s*/g, ' ').replace(/^#+\s*/, '').trim();
    if (!flat) continue;
    const parts = flat.split(/(?<=[.!?])\s+(?=[A-Z0-9`"(])/);
    const group = [];
    for (const p of parts) {
      const s = p.replace(/^[-*+]\s+/, '').trim();
      if (s.length >= 8) group.push(s);
    }
    if (group.length) out.push(group);
  }
  return out; // array of paragraphs, each an array of sentences
}

export const stableId = (...parts) => crypto.createHash('sha1').update(parts.join('␟')).digest('hex').slice(0, 16);

/**
 * @param record {{id, type, title?, text, url, author, date}}
 * @returns candidates with verbatim statement / rationale / alternatives
 */
export function extractDecisionCandidates(record, { max = 3 } = {}) {
  const candidates = [];
  const bodyStarts = (record.text || '').toLowerCase();
  const title = record.title && bodyStarts.includes(record.title.toLowerCase().replace(/\s*\(#\d+\)\s*$/, '')) ? null : record.title;
  const text = [title, record.text].filter(Boolean).join('\n\n');
  const paragraphs = splitSentences(text);

  for (const sentences of paragraphs) {
    for (let i = 0; i < sentences.length && candidates.length < max; i++) {
      const s = sentences[i];
      if (s.length < 20 || s.length > 450 || BOILERPLATE.test(s) || INJECTION_RE.test(s) || !DECISION_CUE.test(s)) continue;

      let rationale = null;
      const why = (x) => x && RATIONALE_CUE.test(x) && !INJECTION_RE.test(x);
      if (why(s)) rationale = s;
      else if (why(sentences[i + 1])) rationale = sentences[i + 1];
      else if (why(sentences[i - 1])) rationale = sentences[i - 1];

      const alt = s.match(ALT_RE);
      candidates.push({
        id: `decision:${stableId(record.id, s)}`,
        statement: s,
        rationale,
        alternatives: alt ? [alt[0].split(/\s+\b(?:because|since|due to|so that|as|to avoid|which)\b/i)[0].trim()] : [],
        cue: s.match(DECISION_CUE)[0],
        sourceId: record.id,
        sourceType: record.type,
        url: record.url,
        author: record.author?.login || record.author?.name || null,
        date: record.date || null,
        method: 'pattern',
      });
    }
  }
  return candidates;
}

/**
 * Parse an Architecture Decision Record (Nygard / MADR style).
 * Returns null if the document does not look like an ADR.
 */
export function parseAdr(path, content) {
  if (!content) return null;
  const isAdrPath = /(^|\/)(adr|adrs|decisions?|architecture[-_]?decisions?)\//i.test(path) || /(^|\/)\d{3,4}[-_].+\.md$/i.test(path);
  const sections = {};
  let current = '_preamble';
  let title = null;
  for (const line of content.split(/\r?\n/)) {
    const h = line.match(/^#{1,3}\s+(.*)$/);
    if (h) {
      if (!title) title = h[1].trim();
      current = h[1].trim().toLowerCase();
      sections[current] = '';
      continue;
    }
    sections[current] = (sections[current] || '') + line + '\n';
  }
  const find = (re) => {
    const k = Object.keys(sections).find((key) => re.test(key));
    return k ? sections[k].trim() : null;
  };
  const decision = find(/^(decision|decision outcome)/);
  if (!decision || (!isAdrPath && !find(/^context/))) return null;

  let status = find(/^status/);
  if (!status) {
    const m = content.match(/^\s*\**status\**\s*:\s*(.+)$/im);
    status = m ? m[1] : null;
  }
  const numMatch = path.match(/(\d{1,4})[-_][^/]*$/) || (title || '').match(/(\d{1,4})/);
  const refsIn = (s, re) => [...(s || '').matchAll(re)].map((m) => Number(m[1]));
  const statusText = status || '';
  const dateMatch = content.match(/^\s*\**date\**\s*:\s*(\d{4}-\d{2}-\d{2})/im);

  return {
    number: numMatch ? Number(numMatch[1]) : null,
    title: title || path,
    status: statusText.split('\n')[0].trim() || null,
    context: find(/^context/),
    decision,
    consequences: find(/^consequences/),
    alternatives: find(/^(considered options|alternatives|options considered)/),
    supersedes: refsIn(statusText + '\n' + (sections._preamble || ''), /supersedes\s+(?:\[?ADR[-\s]?)?0*(\d{1,4})/gi),
    supersededBy: refsIn(statusText + '\n' + (sections._preamble || ''), /superseded\s+by\s+(?:\[?ADR[-\s]?)?0*(\d{1,4})/gi),
    date: dateMatch ? dateMatch[1] : null,
  };
}

const firstSentence = (s) => (s || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0]?.slice(0, 400) || null;

/** Turn a parsed ADR into a decision candidate (verbatim fields only). */
export function adrToDecision(adr, file, repoId) {
  const declared = (adr.status || '').toLowerCase();
  return {
    id: `decision:${stableId(repoId, 'adr', file.path)}`,
    statement: firstSentence(adr.decision),
    rationale: firstSentence(adr.context),
    alternatives: adr.alternatives ? [firstSentence(adr.alternatives)] : [],
    cue: 'ADR',
    sourceId: `file:${repoId}:${file.path}`,
    sourceType: 'doc',
    url: file.url,
    author: null,
    date: adr.date,
    method: 'adr',
    adrNumber: adr.number,
    adrTitle: adr.title,
    declaredStatus: /superseded\s+by|^\W*(superseded|deprecated)/.test(declared) ? 'superseded' : declared.includes('accept') ? 'accepted' : declared || null,
    adrSupersedes: adr.supersedes,
    adrSupersededBy: adr.supersededBy,
  };
}
