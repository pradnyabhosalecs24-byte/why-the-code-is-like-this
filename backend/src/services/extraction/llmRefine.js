/**
 * Optional LLM pass over pattern-extracted decision candidates. The LLM may only
 * REJECT candidates that are not real engineering decisions (e.g. "Fix typo instead of
 * rewriting"). It cannot rewrite or add statements, so provenance stays verbatim.
 */
export async function llmRejectCandidates(llm, candidates) {
  if (!llm || !candidates.length) return new Set();
  const rejected = new Set();
  for (let i = 0; i < candidates.length; i += 40) {
    const batch = candidates.slice(i, i + 40);
    const out = await llm.completeJSON({
      system:
        'You classify sentences from software repository history. A sentence is an ENGINEERING DECISION if it records a deliberate choice about design, architecture, dependencies, configuration values, behaviour, or process. Return JSON {"reject": [ids of sentences that are NOT engineering decisions]}. Only use ids provided.',
      user: JSON.stringify(batch.map((c) => ({ id: c.id, sentence: c.statement }))),
      maxTokens: 600,
    });
    const ids = new Set(batch.map((c) => c.id));
    for (const id of Array.isArray(out?.reject) ? out.reject : []) if (ids.has(id)) rejected.add(id);
  }
  return rejected;
}
