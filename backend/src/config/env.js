import dotenv from 'dotenv';

dotenv.config();

const int = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const str = (name, fallback = '') => (process.env[name] ?? fallback).trim();

export const config = {
  port: int('PORT', 4000),
  corsOrigins: str('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  demoMode: str('DEMO_MODE', 'false') === 'true',
  graphBackend: str('DEMO_MODE', 'false') === 'true' ? 'memory' : str('GRAPH_BACKEND', 'neo4j').toLowerCase(),
  neo4j: {
    uri: str('NEO4J_URI'),
    username: str('NEO4J_USERNAME', 'neo4j'),
    password: str('NEO4J_PASSWORD'),
    database: str('NEO4J_DATABASE', 'neo4j'),
  },
  github: {
    token: str('GITHUB_TOKEN'),
    timeoutMs: int('GITHUB_TIMEOUT_MS', 15000),
  },
  openai: {
    apiKey: str('OPENAI_API_KEY'),
    model: str('OPENAI_MODEL', 'gpt-4o-mini'),
    refineDecisions: str('OPENAI_REFINE_DECISIONS', 'false') === 'true',
    timeoutMs: int('OPENAI_TIMEOUT_MS', 45000),
  },
  sarvam: {
    apiKey: str('SARVAM_API_KEY'),
    model: str('SARVAM_MODEL', 'sarvam-105b'),
    baseURL: str('SARVAM_BASE_URL', 'https://api.sarvam.ai/v1'),
  },
  limits: {
    maxCommits: int('IMPORT_MAX_COMMITS', 300),
    maxCommitDetails: int('IMPORT_MAX_COMMIT_DETAILS', 120),
    maxPulls: int('IMPORT_MAX_PULLS', 60),
    maxIssues: int('IMPORT_MAX_ISSUES', 80),
    maxTimelines: int('IMPORT_MAX_TIMELINES', 30),
    maxFiles: int('IMPORT_MAX_FILES', 150),
    maxFileBytes: int('IMPORT_MAX_FILE_BYTES', 120000),
  },
};

/**
 * The active LLM. LLM_PROVIDER = "sarvam" | "openai" | "none"; when unset, Sarvam is used if
 * SARVAM_API_KEY is present, otherwise OpenAI if OPENAI_API_KEY is present, otherwise none.
 */
export function llmConfig(c = config) {
  c = { ...c, sarvam: c.sarvam || {}, openai: c.openai || {} };
  const wanted = str('LLM_PROVIDER', '').toLowerCase();
  const provider = wanted || (c.sarvam.apiKey ? 'sarvam' : c.openai.apiKey ? 'openai' : 'none');
  const base = { refineDecisions: c.openai.refineDecisions, timeoutMs: c.openai.timeoutMs };
  if (provider === 'sarvam') return { ...base, provider, apiKey: c.sarvam.apiKey, model: c.sarvam.model, baseURL: c.sarvam.baseURL };
  if (provider === 'openai') return { ...base, provider, apiKey: c.openai.apiKey, model: c.openai.model, baseURL: null };
  return { ...base, provider: 'none', apiKey: '', model: null, baseURL: null };
}

/**
 * Validate configuration. Returns human-readable errors (app cannot use that integration)
 * and warnings (it can, with limits). Messages never include secret values.
 */
export function validateConfig(c = config) {
  const errors = [];
  const warnings = [];
  if (!['neo4j', 'memory'].includes(c.graphBackend)) errors.push(`GRAPH_BACKEND must be "neo4j" or "memory" (got "${c.graphBackend}").`);
  if (c.graphBackend === 'neo4j') {
    if (!c.neo4j.uri || !c.neo4j.password) errors.push('Neo4j is not configured: set NEO4J_URI and NEO4J_PASSWORD in backend/.env, or run "npm run demo" for the local demo mode.');
    else if (!/^(neo4j|neo4j\+s|neo4j\+ssc|bolt|bolt\+s|bolt\+ssc):\/\/[^\s/]+/.test(c.neo4j.uri)) errors.push('NEO4J_URI is malformed: expected something like neo4j+s://xxxx.databases.neo4j.io');
    else if (c.neo4j.uri.includes('xxxxxxxx') || c.neo4j.password.startsWith('replace-with')) errors.push('NEO4J_URI / NEO4J_PASSWORD still contain the placeholder values from .env.example.');
  }
  if (!c.github.token) warnings.push('GITHUB_TOKEN is not set: GitHub allows only 60 requests/hour, so imports will be small.');
  else if (!/^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|[0-9a-f]{40})$/.test(c.github.token)) warnings.push('GITHUB_TOKEN does not look like a GitHub token (expected ghp_…, github_pat_…). GitHub may reject it.');
  const llm = llmConfig(c);
  if (!['sarvam', 'openai', 'none'].includes(llm.provider)) errors.push(`LLM_PROVIDER must be "sarvam", "openai" or "none" (got "${llm.provider}").`);
  else if (llm.provider !== 'none' && !llm.apiKey) errors.push(`LLM_PROVIDER is "${llm.provider}" but ${llm.provider === 'sarvam' ? 'SARVAM_API_KEY' : 'OPENAI_API_KEY'} is not set.`);
  if (llm.provider === 'openai' && llm.apiKey && !/^sk-[A-Za-z0-9_-]{16,}$/.test(llm.apiKey)) warnings.push('OPENAI_API_KEY does not look like an OpenAI key (expected sk-…). LLM answers may fail and fall back to extractive answers.');
  if (llm.provider === 'sarvam' && llm.apiKey && llm.apiKey.length < 16) warnings.push('SARVAM_API_KEY looks too short. Copy it again from the Sarvam dashboard.');
  if (llm.provider === 'none') warnings.push('No LLM key set (SARVAM_API_KEY or OPENAI_API_KEY): answers are extractive (quoted evidence only), with no LLM explanation.');
  if (c.demoMode) warnings.unshift('LOCAL DEMO MODE: graph is in memory and pre-loaded with a SYNTHETIC repository. Nothing is persisted.');
  return { errors, warnings };
}

/** Which credentials are present. Never returns the secrets themselves. */
export function credentialStatus() {
  const neo4jConfigured = Boolean(config.neo4j.uri && config.neo4j.password);
  return {
    demoMode: config.demoMode,
    graphBackend: config.graphBackend,
    neo4j: neo4jConfigured,
    github: Boolean(config.github.token),
    llm: llmConfig().provider !== 'none' && Boolean(llmConfig().apiKey),
    llmProvider: llmConfig().provider,
    llmModel: llmConfig().apiKey ? llmConfig().model : null,
  };
}
