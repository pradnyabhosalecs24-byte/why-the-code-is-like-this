import OpenAI from 'openai';

/**
 * LLM wrapper returning parsed JSON. Works with OpenAI and with Sarvam AI, whose
 * /v1/chat/completions API uses the same request/response shape (we point the OpenAI
 * SDK at Sarvam's base URL and send its api-subscription-key header).
 */
export function createLlm({ provider = 'openai', apiKey, model, baseURL = null, timeoutMs = 45000, fetchImpl = undefined }) {
  if (!apiKey || provider === 'none') return null;
  const client = new OpenAI({
    apiKey,
    timeout: timeoutMs,
    maxRetries: 2,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    ...(baseURL ? { baseURL } : {}),
    ...(provider === 'sarvam' ? { defaultHeaders: { 'api-subscription-key': apiKey } } : {}),
  });
  return {
    provider,
    model,
    async completeJSON({ system, user, model: override, maxTokens = 900 }) {
      const res = await client.chat.completions.create({
        model: override || model,
        temperature: 0,
        max_tokens: provider === 'sarvam' ? Math.max(maxTokens, 2048) : maxTokens, // room for reasoning models
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      return parseJsonLoose(res.choices?.[0]?.message?.content || '');
    },
  };
}

/** Parse JSON even if wrapped in ```json fences or preceded by reasoning text. */
export function parseJsonLoose(text) {
  const t = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const candidates = [t, t.replace(/^```(?:json)?\s*|\s*```$/g, '')];
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(t.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === 'object') return v;
    } catch {
      /* try next */
    }
  }
  return {};
}
