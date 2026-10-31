import { relWeight, HUB_LABELS } from '../graph/schema.js';
import { RATIONALE_CUE, INJECTION_RE } from '../extraction/decisions.js';

const HOP_DECAY = 0.8;

/**
 * Graph-based evidence ranking (pure function).
 *
 * Scores spread from seed nodes along relationships: score(node) = max over paths of
 * seedScore * Π(relWeight * HOP_DECAY). So *which relationships exist* decides which
 * evidence is reached and how strongly — e.g. an incident report linked to a config key
 * through PR -> closes -> issue is found even if it shares no words with the question.
 *
 * Returns ranked decisions and evidence, each with the graph path that reached it.
 */
export function rankSubgraph({ seeds, subgraph, query, maxEvidence = 10, maxDecisions = 5, pinned = [] }) {
  const nodes = new Map(subgraph.nodes.map((n) => [n.id, n]));
  const adj = new Map();
  for (const r of subgraph.rels) {
    for (const [a, b] of [[r.from, r.to], [r.to, r.from]]) {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push({ rel: r, other: b });
    }
  }

  // max-product best-first search (weights <= 1, so this is Dijkstra on -log w)
  const best = new Map();
  const queue = [];
  for (const s of seeds) {
    if (!nodes.has(s.id)) continue;
    if (!best.has(s.id) || best.get(s.id).score < s.score) {
      best.set(s.id, { score: s.score, path: [], seed: s.id, seedReason: s.reason });
      queue.push(s.id);
    }
  }
  while (queue.length) {
    queue.sort((a, b) => best.get(b).score - best.get(a).score);
    const id = queue.shift();
    const cur = best.get(id);
    const node = nodes.get(id);
    if (cur.path.length >= 5 || (node && HUB_LABELS.has(node.label) && cur.path.length > 0)) continue;
    for (const { rel, other } of adj.get(id) || []) {
      if (!nodes.has(other)) continue;
      const score = cur.score * relWeight(rel) * HOP_DECAY;
      const prev = best.get(other);
      if (!prev || prev.score < score - 1e-9) {
        best.set(other, { score, path: [...cur.path, { type: rel.type, from: rel.from, to: rel.to, origin: rel.props?.origin || 'confirmed', method: rel.props?.method || null }], seed: cur.seed, seedReason: cur.seedReason });
        queue.push(other);
      }
    }
  }

  const kw = query?.keywords || [];
  const lexical = (text) => {
    if (!kw.length || !text) return 0;
    const t = text.toLowerCase();
    return kw.filter((k) => t.includes(k)).length / kw.length;
  };
  const why = Boolean(query?.intent?.why);

  // Evidence ranking
  const evidence = [];
  for (const [id, b] of best) {
    const n = nodes.get(id);
    if (!n || n.label !== 'Evidence') continue;
    const suspicious = INJECTION_RE.test(n.props.text || '');
    const hasRationale = !suspicious && RATIONALE_CUE.test(n.props.text || '');
    const lex = lexical(n.props.text);
    const score = b.score + 0.25 * lex + (why && hasRationale ? 0.1 : 0);
    evidence.push({ id, node: n, score, graphScore: b.score, hasRationale, suspicious, lexical: lex, path: b.path, seed: b.seed, seedReason: b.seedReason });
  }
  evidence.sort((a, b) => b.score - a.score);

  // Decision ranking (+ the evidence that supports each decision)
  const decisions = [];
  for (const [id, b] of best) {
    const n = nodes.get(id);
    if (!n || n.label !== 'Decision') continue;
    const text = `${n.props.statement} ${n.props.rationale || ''}`;
    const score = b.score + 0.3 * lexical(text) + (why && n.props.rationaleStated ? 0.1 : 0);
    const support = subgraph.rels.filter((r) => r.type === 'SUPPORTED_BY' && r.from === id).map((r) => r.to);
    const supersededBy = subgraph.rels.filter((r) => r.type === 'SUPERSEDES' && r.to === id).map((r) => ({ id: r.from, method: r.props?.method, reason: r.props?.reason }));
    const supersedes = subgraph.rels.filter((r) => r.type === 'SUPERSEDES' && r.from === id).map((r) => ({ id: r.to, method: r.props?.method, reason: r.props?.reason }));
    const conflicts = subgraph.rels.filter((r) => r.type === 'RELATED_TO' && r.props?.method === 'possible_conflict' && (r.from === id || r.to === id)).map((r) => (r.from === id ? r.to : r.from));
    decisions.push({ id, node: n, score, path: b.path, seed: b.seed, support, supersededBy, supersedes, conflicts });
  }
  decisions.sort((a, b) => b.score - a.score);
  const topDecisions = decisions.slice(0, maxDecisions);

  // Make sure each top decision's supporting evidence is included, then fill by score
  const chosen = new Map();
  const supportOf = (decId) => subgraph.rels.filter((r) => r.type === 'SUPPORTED_BY' && r.from === decId).map((r) => r.to);
  for (const d of topDecisions) {
    const related = [...d.supersededBy, ...d.supersedes].flatMap((x) => supportOf(x.id).map((evId) => [evId, x.id]));
    for (const [evId, decId] of [...d.support.map((evId) => [evId, d.id]), ...related]) {
      const e = evidence.find((x) => x.id === evId);
      if (e && chosen.size < maxEvidence && !chosen.has(evId)) chosen.set(evId, { ...e, supportsDecision: decId });
    }
  }
  for (const evId of pinned) {
    const e = evidence.find((x) => x.id === evId);
    if (e && !chosen.has(evId)) chosen.set(evId, { ...e, pinned: true });
  }
  const floor = Math.max(0.08, 0.3 * (evidence[0]?.score || 0));
  for (const e of evidence) {
    if (chosen.size >= maxEvidence) break;
    if (!chosen.has(e.id) && e.score >= floor) chosen.set(e.id, e);
  }

  return {
    decisions: topDecisions,
    evidence: [...chosen.values()].sort((a, b) => b.score - a.score),
    reached: best.size,
  };
}
