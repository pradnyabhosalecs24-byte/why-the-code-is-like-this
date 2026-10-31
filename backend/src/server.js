import { createApp } from './app.js';
import { config, credentialStatus, validateConfig } from './config/env.js';
import { log } from './middleware/errors.js';
import { getStore, storeHealth } from './services/graph/store.js';
import { seedDemo } from '../demo/seed.js';

const { errors, warnings } = validateConfig();
for (const w of warnings) log.warn(w);
for (const e of errors) log.error(e);

if (config.demoMode) {
  const r = await seedDemo(getStore());
  log.info(`Demo mode: loaded SYNTHETIC repository ${r.repo} (${r.nodes} nodes, ${r.decisions} decisions)`);
}

const app = createApp();
app.listen(config.port, async () => {
  log.info(`TraceWhy API listening on http://localhost:${config.port}`);
  log.info('Credentials present', credentialStatus());
  const graph = await storeHealth();
  if (!graph.ok) log.warn(`Graph database not ready: ${graph.message}`);
  else log.info(`Graph backend ready (${graph.backend})`);
});
