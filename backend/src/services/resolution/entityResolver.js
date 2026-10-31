/**
 * Entity resolution: maps names mentioned in text (identifiers, file paths, people)
 * to graph entities. Exact matching only; ambiguity is recorded, never merged away.
 */

const GENERIC = new Set(['index', 'main', 'test', 'tests', 'config', 'utils', 'helpers', 'readme', 'package', 'default', 'options', 'value', 'name', 'type', 'data', 'version', 'scripts', 'description', 'license']);
const MAX_CANDIDATES = 3;

export function createSymbolIndex() {
  const byName = new Map(); // name -> [{id,label,name}]
  const renames = new Map(); // oldPath -> newPath
  const add = (name, entry) => {
    if (!name || name.length < 4 || GENERIC.has(name.toLowerCase())) return;
    const list = byName.get(name) || [];
    if (!list.some((e) => e.id === entry.id)) list.push(entry);
    byName.set(name, list);
  };
  return {
    addFile(path, id) {
      add(path, { id, label: 'File', name: path });
      const base = path.split('/').pop();
      if (base.includes('.')) add(base, { id, label: 'File', name: path });
    },
    addFunction(name, id, path) {
      add(name, { id, label: 'Function', name, path });
    },
    addConfig(key, id, path) {
      add(key, { id, label: 'Configuration', name: key, path });
      const last = key.split('.').pop();
      if (last !== key && last.length >= 6) add(last, { id, label: 'Configuration', name: key, path });
    },
    addRename(oldPath, newPath) {
      renames.set(oldPath, newPath);
    },
    /** Follow rename chain old -> ... -> current path (cycle safe). */
    currentPath(path) {
      let p = path;
      const seen = new Set();
      while (renames.has(p) && !seen.has(p)) {
        seen.add(p);
        p = renames.get(p);
      }
      return p;
    },
    /**
     * Resolve one mention. Returns [] (unknown), [one] (resolved) or up to 3
     * candidates flagged ambiguous. More than 3 candidates => not resolved at all.
     */
    resolve(mention) {
      if (!mention) return [];
      const m = mention.replace(/^\.?\//, '');
      let hits = byName.get(m) || [];
      if (!hits.length && renames.has(m)) hits = byName.get(this.currentPath(m)) || [];
      if (!hits.length || hits.length > MAX_CANDIDATES) return [];
      const ambiguous = hits.length > 1;
      return hits.map((h) => ({ ...h, ambiguous, candidates: hits.length, mention }));
    },
    resolveAll(mentions) {
      const out = new Map();
      for (const mention of mentions || []) for (const r of this.resolve(mention)) if (!out.has(r.id)) out.set(r.id, r);
      return [...out.values()];
    },
    size: () => byName.size,
  };
}

/** Person id: GitHub login when known; otherwise a repo-scoped, explicitly unlinked name node. */
export function personId(author, repoId) {
  if (!author) return null;
  if (author.login) return `person:gh:${author.login.toLowerCase()}`;
  if (author.name) return `person:${repoId}:name:${author.name.trim().toLowerCase()}`;
  return null;
}

/**
 * Unlinked commit authors (no GitHub account match) whose display name equals exactly one
 * linked person's name get a RELATED_TO "same_display_name" inferred link, not a merge.
 */
export function inferPersonAliases(people) {
  const linked = people.filter((p) => p.login);
  const out = [];
  for (const p of people.filter((x) => !x.login)) {
    const matches = linked.filter((l) => (l.name || '').trim().toLowerCase() === p.name.trim().toLowerCase());
    if (matches.length === 1) out.push({ from: p.id, to: matches[0].id, method: 'same_display_name' });
  }
  return out;
}
