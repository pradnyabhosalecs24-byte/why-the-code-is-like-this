import neo4j from 'neo4j-driver';
import { HUB_LABELS, NODE_LABELS, REL_TYPES, TRAVERSABLE, CODE_ENTITY_LABELS, schemaStatements } from './schema.js';
import { luceneQuery, stems } from '../retrieval/questionParser.js';
import { serviceUnavailable } from '../../middleware/errors.js';

const BATCH = 500;

/** Convert Neo4j driver values (Integer, Node, etc.) to plain JS. */
export function toNative(v) {
  if (v === null || v === undefined) return v;
  if (neo4j.isInt(v)) return v.inSafeRange() ? v.toNumber() : v.toString();
  if (Array.isArray(v)) return v.map(toNative);
  if (typeof v === 'object') {
    if (v.properties && v.labels) return toNative(v.properties);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toNative(x)]));
  }
  return v;
}

const asNode = (props) => ({ id: props.id, label: props.nodeType, props });

export function createNeo4jStore({ uri, username, password, database }) {
  if (!uri || !password) throw serviceUnavailable('NEO4J_NOT_CONFIGURED', 'Neo4j credentials are missing. Set NEO4J_URI and NEO4J_PASSWORD in backend/.env.');
  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
    connectionTimeout: 15000,
    maxTransactionRetryTime: 15000,
    disableLosslessIntegers: false,
  });

  async function run(cypher, params = {}, mode = 'READ') {
    const session = driver.session({ database, defaultAccessMode: mode === 'WRITE' ? neo4j.session.WRITE : neo4j.session.READ });
    try {
      const res = await session.run(cypher, params, { timeout: 30000 });
      return res.records.map((r) => toNative(r.toObject()));
    } catch (err) {
      if (err.code === 'ServiceUnavailable' || err.code === 'SessionExpired') throw serviceUnavailable('NEO4J_UNAVAILABLE', 'Cannot reach Neo4j. Check NEO4J_URI and that the Aura instance is running (free instances pause when idle).');
      if (err.code?.includes('Security')) throw serviceUnavailable('NEO4J_AUTH', 'Neo4j rejected the credentials in backend/.env.');
      throw err;
    } finally {
      await session.close();
    }
  }
  const write = (c, p) => run(c, p, 'WRITE');

  const subgraph = async (nodeIds, relRows) => {
    const nodes = nodeIds.length ? (await run('MATCH (n:TW) WHERE n.id IN $ids RETURN properties(n) AS p', { ids: nodeIds })).map((r) => asNode(r.p)) : [];
    return { nodes, rels: relRows };
  };

  return {
    kind: 'neo4j',
    driver,

    async verify() {
      try {
        await driver.verifyConnectivity({ database });
        return true;
      } catch (err) {
        if (err.code?.includes('Security')) throw serviceUnavailable('NEO4J_AUTH', 'Neo4j rejected the credentials in backend/.env.');
        throw serviceUnavailable('NEO4J_UNAVAILABLE', `Cannot reach Neo4j (${err.code || err.message}). Check NEO4J_URI and that the Aura instance is running.`);
      }
    },

    async init() {
      for (const s of schemaStatements()) await write(s);
    },

    async close() {
      await driver.close();
    },

    async upsertGraph(repo, graph, { onProgress = () => {} } = {}) {
      let done = 0;
      const byLabel = groupBy(graph.nodes, (n) => n.label);
      for (const [label, list] of Object.entries(byLabel)) {
        if (!NODE_LABELS.includes(label)) throw new Error(`Unknown label ${label}`);
        for (let i = 0; i < list.length; i += BATCH) {
          const rows = list.slice(i, i + BATCH).map((n) => ({ id: n.id, props: n.props }));
          // label is from a fixed whitelist, never from user input
          const extra = CODE_ENTITY_LABELS.has(label) ? ':CodeEntity' : '';
          await write(`UNWIND $rows AS row MERGE (n:TW {id: row.id}) SET n:${label}${extra} SET n += row.props`, { rows });
          done += rows.length;
          onProgress(done);
        }
      }
      const byType = groupBy(graph.rels, (r) => r.type);
      for (const [type, list] of Object.entries(byType)) {
        if (!REL_TYPES.includes(type)) throw new Error(`Unknown relationship ${type}`);
        for (let i = 0; i < list.length; i += BATCH) {
          const rows = list.slice(i, i + BATCH).map((r) => ({ from: r.from, to: r.to, props: r.props }));
          await write(
            `UNWIND $rows AS row
             MATCH (a:TW {id: row.from}) MATCH (b:TW {id: row.to})
             MERGE (a)-[r:${type}]->(b)
             ON CREATE SET r.firstSeenAt = row.props.importedAt
             SET r += row.props`,
            { rows },
          );
          done += rows.length;
          onProgress(done);
        }
      }
    },

    async sweep(repo, importedAt) {
      await write('MATCH (a:TW {repo: $repo})-[r]->() WHERE r.importedAt <> $ts DELETE r', { repo, ts: importedAt });
      for (;;) {
        const [{ c }] = await write('MATCH (n:TW {repo: $repo}) WHERE n.importedAt <> $ts WITH n LIMIT 2000 DETACH DELETE n RETURN count(*) AS c', { repo, ts: importedAt });
        if (!c) break;
      }
      await write('MATCH (p:Person) WHERE NOT (p)--() DELETE p');
    },

    async clearRepo(repo) {
      let total = 0;
      for (;;) {
        const [{ c }] = await write('MATCH (n:TW {repo: $repo}) WITH n LIMIT 2000 DETACH DELETE n RETURN count(*) AS c', { repo });
        total += c;
        if (!c) break;
      }
      await write('MATCH (p:Person) WHERE NOT (p)--() DELETE p');
      return total;
    },

    async listRepos() {
      return (await run('MATCH (r:Repository) RETURN properties(r) AS p ORDER BY r.lastImportAt DESC')).map((r) => r.p);
    },

    async getRepo(repo) {
      const rows = await run('MATCH (r:Repository {id: $id}) RETURN properties(r) AS p', { id: `repo:${repo}` });
      return rows[0]?.p ?? null;
    },

    async stats(repo) {
      const labelRows = await run('MATCH (n:TW {repo: $repo}) RETURN n.nodeType AS t, count(*) AS c', { repo });
      const relRows = await run('MATCH (n:TW {repo: $repo})-[r]->() RETURN type(r) AS t, r.origin AS o, count(*) AS c', { repo });
      const statusRows = await run('MATCH (d:Decision {repo: $repo}) RETURN d.status AS s, count(*) AS c', { repo });
      const [{ people }] = await run('MATCH (n:TW {repo: $repo})-[:AUTHORED_BY]->(p:Person) RETURN count(DISTINCT p) AS people', { repo });
      const labels = Object.fromEntries(labelRows.map((r) => [r.t, r.c]));
      labels.Person = people;
      const relTypes = {};
      const origins = { confirmed: 0, inferred: 0 };
      for (const r of relRows) {
        relTypes[r.t] = (relTypes[r.t] || 0) + r.c;
        origins[r.o] = (origins[r.o] || 0) + r.c;
      }
      return { labels, relTypes, origins, decisionStatus: Object.fromEntries(statusRows.map((r) => [r.s, r.c])) };
    },

    async findSeeds(repo, q) {
      const out = new Map();
      const add = (id, label, score, reason) => {
        const prev = out.get(id);
        if (!prev || prev.score < score) out.set(id, { id, label, score, reason });
      };
      const ids = q.identifiers.map((i) => i.toLowerCase());
      const st = stems(q.keywords);

      // 1) code entities: exact identifiers, then keyword stems inside identifier names
      const code = await run(
        `MATCH (n:TW {repo: $repo}) WHERE n.nodeType IN ['Configuration','Function','File']
         WITH n, toLower(coalesce(n.key, n.name, n.path)) AS name
         WITH n, name,
              any(i IN $ids WHERE name = i OR name ENDS WITH '/' + i OR name ENDS WITH '.' + i) AS exact,
              size([s IN $stems WHERE name CONTAINS s]) AS hits
         WHERE exact OR (hits > 0 AND n.nodeType <> 'File')
         RETURN n.id AS id, n.nodeType AS label, exact, hits
         ORDER BY exact DESC, hits DESC LIMIT 25`,
        { repo, ids, stems: st },
      );
      for (const r of code) add(r.id, r.label, r.exact ? 1 : Math.min(0.8, 0.35 + 0.2 * r.hits), r.exact ? 'exact identifier' : `name matches ${r.hits} keyword(s)`);

      // 2) explicit #numbers and commit shas
      if (q.numbers.length || q.shas.length) {
        const refRows = await run(
          `MATCH (n:TW {repo: $repo})
           WHERE (n.nodeType IN ['PullRequest','Issue'] AND n.number IN $numbers)
              OR (n.nodeType = 'Commit' AND any(s IN $shas WHERE n.sha STARTS WITH s))
           RETURN n.id AS id, n.nodeType AS label`,
          { repo, numbers: q.numbers, shas: q.shas },
        );
        for (const r of refRows) add(r.id, r.label, 1, 'explicit reference');
      }

      // 3) full-text over decisions, evidence and records
      if (q.keywords.length) {
        const text = await run(
          `CALL db.index.fulltext.queryNodes('tw_text', $lucene) YIELD node, score
           WHERE node.repo = $repo
           RETURN node.id AS id, node.nodeType AS label, score
           ORDER BY score DESC LIMIT 30`,
          { repo, lucene: luceneQuery(q.keywords) },
        );
        const max = Math.max(1, ...text.map((t) => t.score));
        for (const r of text) add(r.id, r.label, 0.9 * (r.score / max), 'full-text match');
      }
      return [...out.values()].sort((a, b) => b.score - a.score).slice(0, 30);
    },

    async expand(repo, seedIds, { maxDepth = 3, perNode = 25, maxNodes = 400 } = {}) {
      const seen = new Set(seedIds);
      const relMap = new Map();
      let frontier = [...seedIds];
      for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
        const rows = await run(
          `MATCH (n:TW) WHERE n.id IN $frontier AND ($depth = 0 OR NOT n.nodeType IN $hubs)
           CALL {
             WITH n
             MATCH (n)-[r]-(m:TW)
             WHERE type(r) IN $types AND (m.repo = $repo OR m:Person)
             RETURN r, m ORDER BY coalesce(m.date, '') DESC LIMIT $perNode
           }
           RETURN type(r) AS type, startNode(r).id AS from, endNode(r).id AS to, properties(r) AS props, m.id AS mid`,
          { frontier, depth: neo4j.int(depth), hubs: [...HUB_LABELS], types: TRAVERSABLE, repo, perNode: neo4j.int(perNode) },
        );
        const next = [];
        for (const r of rows) {
          relMap.set(`${r.type}|${r.from}|${r.to}`, { type: r.type, from: r.from, to: r.to, props: r.props });
          if (!seen.has(r.mid) && seen.size < maxNodes) {
            seen.add(r.mid);
            next.push(r.mid);
          }
        }
        frontier = next.slice(0, 80);
      }
      const rels = [...relMap.values()].filter((r) => seen.has(r.from) && seen.has(r.to));
      return subgraph([...seen], rels);
    },

    async neighborhood(repo, nodeId, { limit = 80 } = {}) {
      const rows = await run(
        `MATCH (n:TW {id: $id}) WHERE n.repo = $repo OR n:Person
         OPTIONAL MATCH (n)-[r]-(m:TW) WHERE m.repo = $repo OR m:Person
         WITH n, r, m LIMIT $limit
         RETURN type(r) AS type, startNode(r).id AS from, endNode(r).id AS to, properties(r) AS props, m.id AS mid`,
        { id: nodeId, repo, limit: neo4j.int(limit) },
      );
      const ids = new Set([nodeId]);
      const rels = [];
      for (const r of rows) {
        if (!r.type) continue;
        ids.add(r.mid);
        rels.push({ type: r.type, from: r.from, to: r.to, props: r.props });
      }
      const g = await subgraph([...ids], rels);
      return g.nodes.length ? g : { nodes: [], rels: [] };
    },

    async overview(repo, { limit = 40 } = {}) {
      const rows = await run(
        `MATCH (d:Decision {repo: $repo})
         WITH d ORDER BY d.date DESC LIMIT $limit
         OPTIONAL MATCH (d)-[r:SUPERSEDES|INTRODUCED_BY|AFFECTS|RELATED_TO]-(m:TW) WHERE m.nodeType <> 'Evidence'
         RETURN d.id AS did, type(r) AS type, startNode(r).id AS from, endNode(r).id AS to, properties(r) AS props, m.id AS mid`,
        { repo, limit: neo4j.int(limit) },
      );
      const ids = new Set();
      const rels = [];
      for (const r of rows) {
        ids.add(r.did);
        if (r.type) {
          ids.add(r.mid);
          rels.push({ type: r.type, from: r.from, to: r.to, props: r.props });
        }
      }
      return subgraph([...ids], rels);
    },

    async decisions(repo) {
      return (
        await run(
          `MATCH (d:Decision {repo: $repo})
           OPTIONAL MATCH (d)-[:SUPERSEDES]->(o:Decision)
           OPTIONAL MATCH (n:Decision)-[:SUPERSEDES]->(d)
           RETURN properties(d) AS p, collect(DISTINCT o.id) AS supersedes, collect(DISTINCT n.id) AS supersededBy
           ORDER BY d.date DESC`,
          { repo },
        )
      ).map((r) => ({ ...r.p, supersedes: r.supersedes, supersededBy: r.supersededBy }));
    },

    async timeline(repo, { limit = 300 } = {}) {
      return run(
        `MATCH (n:TW {repo: $repo})
         WHERE n.nodeType IN ['Decision','PullRequest','Issue','Incident'] AND n.date IS NOT NULL
         RETURN n.id AS id, n.nodeType AS label, n.date AS date, coalesce(n.statement, n.title) AS title,
                n.url AS url, coalesce(n.status, n.state) AS status
         ORDER BY n.date DESC LIMIT $limit`,
        { repo, limit: neo4j.int(limit) },
      );
    },

    async getNodes(ids) {
      return (await subgraph(ids, [])).nodes;
    },
  };
}

function groupBy(arr, fn) {
  return arr.reduce((acc, x) => ((acc[fn(x)] ||= []).push(x), acc), {});
}
