// Loads the clearly labelled SYNTHETIC demo repository into Neo4j. Usage: npm run seed:demo
import { config } from '../src/config/env.js';
import { createNeo4jStore } from '../src/services/graph/neo4jStore.js';
import { seedDemo } from '../demo/seed.js';

const store = createNeo4jStore(config.neo4j);
try {
  await store.verify();
  const r = await seedDemo(store);
  console.log(`Seeded synthetic repository "${r.repo}": ${r.nodes} nodes, ${r.relationships} relationships, ${r.decisions} decisions.`);
  console.log('It is labelled SYNTHETIC in the UI and never mixed with imported GitHub data.');
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await store.close();
}
