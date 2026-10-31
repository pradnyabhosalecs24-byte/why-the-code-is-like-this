// Safely removes one imported repository from Neo4j. Usage: npm run db:clear -- owner/repo
import { config } from '../src/config/env.js';
import { createNeo4jStore } from '../src/services/graph/neo4jStore.js';
import { parseRepoInput } from '../src/middleware/validate.js';
import { deleteCache } from '../src/services/importer.js';

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: npm run db:clear -- owner/repo');
  process.exit(1);
}
const { id } = parseRepoInput(arg);
const store = createNeo4jStore(config.neo4j);
try {
  const removed = await store.clearRepo(id);
  await deleteCache(id);
  console.log(`Removed ${removed} nodes for ${id}.`);
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await store.close();
}
