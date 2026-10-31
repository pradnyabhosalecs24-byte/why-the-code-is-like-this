import { buildGraph } from '../src/services/graph/buildGraph.js';
import { syntheticSnapshot, DEMO_REPO_ID } from './syntheticRepo.js';

/** Load the synthetic demo repository into a store (Neo4j or memory). Deterministic and idempotent. */
export async function seedDemo(store) {
  const graph = buildGraph(syntheticSnapshot());
  await store.init();
  await store.upsertGraph(DEMO_REPO_ID, graph);
  await store.sweep(DEMO_REPO_ID, graph.importedAt);
  return { repo: DEMO_REPO_ID, nodes: graph.nodes.length, relationships: graph.rels.length, decisions: graph.stats.Decision };
}
