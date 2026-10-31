// Creates TraceWhy constraints and indexes in Neo4j (idempotent). Usage: npm run db:init
import { config } from '../src/config/env.js';
import { createNeo4jStore } from '../src/services/graph/neo4jStore.js';
import { schemaStatements } from '../src/services/graph/schema.js';

const store = createNeo4jStore(config.neo4j);
try {
  await store.verify();
  for (const s of schemaStatements()) console.log('  ' + s);
  await store.init();
  console.log('\nSchema ready.');
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await store.close();
}
