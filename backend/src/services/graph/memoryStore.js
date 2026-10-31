import { HUB_LABELS, TRAVERSABLE } from './schema.js';
import { stems } from '../retrieval/questionParser.js';

/**
 * In-process graph store with the same contract as neo4jStore.js.
 * Used by the test-suite and as an explicit offline fallback (GRAPH_BACKEND=memory).
 */
export function createMemoryStore() {
  const nodes = new Map(); // id -> {id,label,props}
  const rels = new Map(); // key -> {type,from,to,props}
  const adj = new Map(); // id -> Set(relKey)

  const link = (key, r) => {
    for (const id of [r.from, r.to]) {
      if (!adj.has(id)) adj.set(id, new Set());
      adj.get(id).add(key);
    }
  };
  const inRepo = (n, repo) => n && (n.props.repo === repo || n.label === 'Person');
  const sub = (nodeIds, relKeys) => ({
    nodes: [...nodeIds].map((id) => nodes.get(id)).filter(Boolean),
    rels: [...relKeys].map((k) => rels.get(k)).filter(Boolean),
  });

  return {
    kind: 'memory',
    async verify() {
      return true;
    },
    async init() {},
    async close() {},

    async upsertGraph(repo, graph, { onProgress = () => {} } = {}) {
      for (const n of graph.nodes) {
        const prev = nodes.get(n.id);
        nodes.set(n.id, prev ? { ...prev, props: { ...prev.props, ...n.props } } : structuredClone(n));
      }
      for (const r of graph.rels) {
        const key = `${r.type}|${r.from}|${r.to}`;
        const prev = rels.get(key);
        rels.set(key, prev ? { ...prev, props: { ...prev.props, ...r.props } } : { ...structuredClone(r), props: { firstSeenAt: r.props.importedAt, ...r.props } });
        link(key, r);
      }
      onProgress(graph.nodes.length + graph.rels.length);
    },

    /** Remove records of this repo not touched by the import run `importedAt`. */
    async sweep(repo, importedAt) {
      for (const [k, r] of rels) {
        const a = nodes.get(r.from);
        if (inRepo(a, repo) && a.props.repo === repo && r.props.importedAt !== importedAt) this._delRel(k);
      }
      for (const [id, n] of nodes) if (n.props.repo === repo && n.props.importedAt !== importedAt) this._delNode(id);
    },
    _delRel(k) {
      const r = rels.get(k);
      if (!r) return;
      adj.get(r.from)?.delete(k);
      adj.get(r.to)?.delete(k);
      rels.delete(k);
    },
    _delNode(id) {
      for (const k of [...(adj.get(id) || [])]) this._delRel(k);
      adj.delete(id);
      nodes.delete(id);
    },

    async clearRepo(repo) {
      let removed = 0;
      for (const [id, n] of [...nodes]) {
        if (n.props.repo === repo) {
          this._delNode(id);
          removed++;
        }
      }
      for (const [id, n] of [...nodes]) if (n.label === 'Person' && !(adj.get(id)?.size)) this._delNode(id);
      return removed;
    },

    async listRepos() {
      return [...nodes.values()].filter((n) => n.label === 'Repository').map((n) => ({ ...n.props }));
    },
    async getRepo(repo) {
      return nodes.get(`repo:${repo}`)?.props ?? null;
    },

    async stats(repo) {
      const labels = {};
      const decisionStatus = {};
      for (const n of nodes.values()) {
        if (n.props.repo !== repo) continue;
        labels[n.label] = (labels[n.label] || 0) + 1;
        if (n.label === 'Decision') decisionStatus[n.props.status] = (decisionStatus[n.props.status] || 0) + 1;
      }
      const relTypes = {};
      const origins = { confirmed: 0, inferred: 0 };
      for (const r of rels.values()) {
        if (nodes.get(r.from)?.props.repo !== repo) continue;
        relTypes[r.type] = (relTypes[r.type] || 0) + 1;
        origins[r.props.origin] = (origins[r.props.origin] || 0) + 1;
      }
      const people = new Set([...rels.values()].filter((r) => r.type === 'AUTHORED_BY' && nodes.get(r.from)?.props.repo === repo).map((r) => r.to));
      labels.Person = people.size;
      return { labels, relTypes, origins, decisionStatus };
    },

    async findSeeds(repo, q) {
      const out = new Map();
      const add = (n, score, reason) => {
        const prev = out.get(n.id);
        if (!prev || prev.score < score) out.set(n.id, { id: n.id, label: n.label, score, reason });
      };
      const st = stems(q.keywords);
      const ids = q.identifiers.map((i) => i.toLowerCase());
      for (const n of nodes.values()) {
        if (n.props.repo !== repo) continue;
        const p = n.props;
        if (n.label === 'Configuration' || n.label === 'Function' || n.label === 'File') {
          const name = String(p.key || p.name || p.path || '').toLowerCase();
          if (ids.some((i) => name === i || name.endsWith('/' + i) || name.endsWith('.' + i))) add(n, 1, 'exact identifier');
          else {
            const hits = st.filter((s) => name.includes(s)).length;
            if (hits && n.label !== 'File') add(n, Math.min(0.8, 0.35 + 0.2 * hits), `name matches ${hits} keyword(s)`);
          }
        } else if ((n.label === 'PullRequest' || n.label === 'Issue') && q.numbers.includes(p.number)) add(n, 1, `#${p.number}`);
        else if (n.label === 'Commit' && q.shas.some((s) => p.sha.startsWith(s))) add(n, 1, 'commit sha');
        if (['Decision', 'Evidence', 'PullRequest', 'Issue', 'Commit', 'Incident'].includes(n.label)) {
          const text = [p.statement, p.rationale, p.text, p.title, p.message].filter(Boolean).join(' ').toLowerCase();
          const hits = q.keywords.filter((k) => text.includes(k)).length + st.filter((s) => text.includes(s)).length * 0.5;
          if (hits && q.keywords.length) add(n, Math.min(0.9, (hits / (q.keywords.length * 1.5)) * 0.9), 'text match');
        }
      }
      return [...out.values()].sort((a, b) => b.score - a.score).slice(0, 30);
    },

    async expand(repo, seedIds, { maxDepth = 3, perNode = 25, maxNodes = 400 } = {}) {
      const seen = new Set(seedIds.filter((id) => nodes.has(id)));
      const relKeys = new Set();
      let frontier = [...seen];
      for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
        const next = [];
        for (const id of frontier) {
          const n = nodes.get(id);
          if (!n || (HUB_LABELS.has(n.label) && depth > 0)) continue;
          const neigh = [...(adj.get(id) || [])]
            .map((k) => [k, rels.get(k)])
            .filter(([, r]) => TRAVERSABLE.includes(r.type))
            .map(([k, r]) => [k, r, r.from === id ? r.to : r.from])
            .filter(([, , other]) => inRepo(nodes.get(other), repo))
            .sort((a, b) => String(nodes.get(b[2]).props.date || '').localeCompare(String(nodes.get(a[2]).props.date || '')))
            .slice(0, perNode);
          for (const [k, , other] of neigh) {
            relKeys.add(k);
            if (!seen.has(other) && seen.size < maxNodes) {
              seen.add(other);
              next.push(other);
            }
          }
        }
        frontier = next.slice(0, 80);
      }
      return sub(seen, [...relKeys].filter((k) => seen.has(rels.get(k).from) && seen.has(rels.get(k).to)));
    },

    async neighborhood(repo, nodeId, { limit = 80 } = {}) {
      if (!inRepo(nodes.get(nodeId), repo)) return { nodes: [], rels: [] };
      const ids = new Set([nodeId]);
      const keys = new Set();
      for (const k of [...(adj.get(nodeId) || [])].slice(0, limit)) {
        const r = rels.get(k);
        const other = r.from === nodeId ? r.to : r.from;
        if (inRepo(nodes.get(other), repo)) {
          ids.add(other);
          keys.add(k);
        }
      }
      return sub(ids, keys);
    },

    async overview(repo, { limit = 40 } = {}) {
      const ds = [...nodes.values()].filter((n) => n.props.repo === repo && n.label === 'Decision').sort((a, b) => String(b.props.date || '').localeCompare(String(a.props.date || ''))).slice(0, limit);
      const ids = new Set(ds.map((d) => d.id));
      const keys = new Set();
      for (const d of ds) {
        for (const k of adj.get(d.id) || []) {
          const r = rels.get(k);
          if (['SUPERSEDES', 'INTRODUCED_BY', 'AFFECTS', 'RELATED_TO'].includes(r.type)) {
            const other = r.from === d.id ? r.to : r.from;
            if (nodes.get(other)?.label !== 'Evidence') {
              ids.add(other);
              keys.add(k);
            }
          }
        }
      }
      return sub(ids, keys);
    },

    async decisions(repo) {
      return [...nodes.values()]
        .filter((n) => n.props.repo === repo && n.label === 'Decision')
        .map((d) => ({
          ...d.props,
          supersedes: [...(adj.get(d.id) || [])].map((k) => rels.get(k)).filter((r) => r.type === 'SUPERSEDES' && r.from === d.id).map((r) => r.to),
          supersededBy: [...(adj.get(d.id) || [])].map((k) => rels.get(k)).filter((r) => r.type === 'SUPERSEDES' && r.to === d.id).map((r) => r.from),
        }))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    },

    async timeline(repo, { limit = 300 } = {}) {
      return [...nodes.values()]
        .filter((n) => n.props.repo === repo && ['Decision', 'PullRequest', 'Issue', 'Incident'].includes(n.label) && n.props.date)
        .map((n) => ({ id: n.id, label: n.label, date: n.props.date, title: n.props.statement || n.props.title, url: n.props.url, status: n.props.status || n.props.state || null }))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit);
    },

    async getNodes(ids) {
      return ids.map((id) => nodes.get(id)).filter(Boolean);
    },
  };
}
