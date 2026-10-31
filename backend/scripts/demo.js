// Starts the API in LOCAL DEMO MODE: in-memory graph pre-loaded with the synthetic repository.
// Works without Neo4j / GitHub / OpenAI credentials. Usage: npm run demo
process.env.DEMO_MODE = 'true';
await import('../src/server.js');
