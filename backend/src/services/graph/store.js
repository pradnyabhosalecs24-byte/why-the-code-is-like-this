import { config } from '../../config/env.js';
import { createMemoryStore } from './memoryStore.js';
import { createNeo4jStore } from './neo4jStore.js';
import { serviceUnavailable } from '../../middleware/errors.js';

let store = null;
let initError = null;

/** Lazily create the configured store. Missing credentials surface as a 503 with a clear message. */
export function getStore() {
  if (store) return store;
  if (config.graphBackend === 'memory') {
    store = createMemoryStore();
    return store;
  }
  try {
    store = createNeo4jStore(config.neo4j);
    return store;
  } catch (err) {
    initError = err;
    throw err;
  }
}

export function setStore(s) {
  store = s;
}

export async function storeHealth(get = getStore) {
  try {
    const s = get();
    await s.verify();
    return { ok: true, backend: s.kind };
  } catch (err) {
    return { ok: false, backend: config.graphBackend, code: err.code || 'GRAPH_ERROR', message: err.message || String(initError) };
  }
}

export function requireStore() {
  try {
    return getStore();
  } catch (err) {
    throw err.status ? err : serviceUnavailable('GRAPH_UNAVAILABLE', err.message);
  }
}
