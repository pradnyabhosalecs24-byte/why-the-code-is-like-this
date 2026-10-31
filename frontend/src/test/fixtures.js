// UI test fixtures (shapes match the backend API). Test-only data.
export const answerOk = {
  question: 'Why is MAX_RETRIES 3?',
  status: 'answered',
  generator: 'extractive',
  answer: {
    headline: 'Best-supported decision: “Limit MAX_RETRIES to 3”',
    claims: [
      { text: 'Recorded decision: “Limit MAX_RETRIES to 3 because of a retry storm.”', citations: ['E1'], basis: 'fact' },
      { text: 'Linked record: incident issue', citations: ['E2'], basis: 'inference' },
    ],
    unknowns: ['No alternatives are documented.'],
  },
  evidence: [
    { ref: 'E1', id: 'ev1', kind: 'pr_description', recordType: 'Pull request', title: 'Limit retries', excerpt: 'Limit MAX_RETRIES to 3', url: 'https://github.com/o/r/pull/8', author: 'meera', date: '2024-07-18T00:00:00Z', direct: true, hasRationale: true, flags: [], urlStatus: 'ok', path: [], seed: { id: 'x', name: 'MAX_RETRIES' } },
    { ref: 'E2', id: 'ev2', kind: 'issue_body', recordType: 'Issue', title: 'Outage', excerpt: 'Checkout down', url: null, author: null, date: null, direct: false, hasRationale: false, flags: ['Contains text addressed to an AI system'], urlStatus: 'unavailable', path: [{ type: 'MOTIVATED_BY', from: 'd', to: 'i', origin: 'inferred', fromName: 'decision', toName: 'Issue #7' }], seed: { id: 'd', name: 'decision' } },
  ],
  decisions: [
    { id: 'd', statement: 'Limit MAX_RETRIES to 3', rationale: 'retry storm', alternatives: [], status: 'active', statusReason: 'No later record replaces it.', date: '2024-07-19T00:00:00Z', author: 'meera', url: 'https://github.com/o/r/pull/8', evidenceRefs: ['E1'], supersededBy: [], supersedes: [], conflicts: [], confidenceScore: 80, confidenceLevel: 'high', confidenceBasis: 'rationale stated +30', chain: [{ name: 'MAX_RETRIES', kind: 'question entity' }, { name: 'decision', via: 'AFFECTS', origin: 'confirmed' }, { name: 'E1', via: 'SUPPORTED_BY', origin: 'confirmed' }] },
  ],
  confidence: { level: 'high', explanation: 'High because…', factors: [{ name: 'Directness', value: 'direct', note: '' }], disclaimer: 'not a calibrated probability' },
  graph: { nodes: [{ id: 'd', label: 'Decision', name: 'Limit' }], rels: [] },
  retrieval: { seeds: [], nodesExplored: 5, relationshipsExplored: 4, keywords: ['max_retries'], identifiers: ['MAX_RETRIES'] },
};

export const answerInsufficient = {
  ...answerOk,
  status: 'insufficient_evidence',
  answer: { headline: 'The imported repository history does not establish the reason.', claims: [], unknowns: ['TraceWhy does not generate explanations without evidence.'] },
  evidence: [],
  decisions: [],
  confidence: { level: 'insufficient', explanation: 'No evidence', factors: [], disclaimer: 'not a calibrated probability' },
  graph: { nodes: [], rels: [] },
};

export const decisions = [
  { id: 'new', statement: 'Increase SESSION_TTL_MINUTES to 30', status: 'active', statusReason: 'ok', date: '2025-04-02', author: 'arjun', url: '/api/demo/records/pull/14', supersedes: ['old'], supersededBy: [], confidenceScore: 70, confidenceLevel: 'high', confidenceBasis: 'x', sourceType: 'PullRequest' },
  { id: 'old', statement: 'Set SESSION_TTL_MINUTES to 15', status: 'superseded', statusReason: 'Superseded by a later decision', date: '2024-09-03', author: null, url: '/api/demo/records/pull/9', supersedes: [], supersededBy: ['new'], confidenceScore: 60, confidenceLevel: 'medium', confidenceBasis: 'y', sourceType: 'PullRequest' },
];
