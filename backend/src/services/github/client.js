import { AppError } from '../../middleware/errors.js';

const API = 'https://api.github.com';

export class GitHubError extends AppError {
  constructor(status, code, message, details) {
    super(status, code, message, details);
    this.name = 'GitHubError';
  }
}

/** Parse the RFC 5988 Link header GitHub uses for pagination. */
export function parseLinkHeader(header) {
  const links = {};
  if (!header) return links;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (m) links[m[2]] = m[1];
  }
  return links;
}

/**
 * Thin GitHub REST client with timeouts, retries (5xx / network), rate-limit
 * waits, and Link-header pagination. `fetchImpl` and `sleep` are injectable for tests.
 */
export function createGitHubClient({
  token,
  timeoutMs = 15000,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxRetries = 3,
  maxRateLimitWaitMs = 65000,
  onRateLimit = () => {},
} = {}) {
  const state = { remaining: null, reset: null, requests: 0 };

  const headers = (accept) => ({
    Accept: accept || 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'TraceWhy',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  async function request(pathOrUrl, { accept, allow404 = false } = {}) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`;
    if (!url.startsWith(API)) throw new GitHubError(400, 'BAD_URL', 'Refusing to call a non-GitHub URL.');

    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        state.requests++;
        res = await fetchImpl(url, { headers: headers(accept), signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        if (attempt < maxRetries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
        throw new GitHubError(
          504,
          timedOut ? 'GITHUB_TIMEOUT' : 'GITHUB_NETWORK',
          timedOut ? 'GitHub did not respond in time.' : 'Could not reach GitHub.',
        );
      }

      const remaining = res.headers.get('x-ratelimit-remaining');
      const reset = res.headers.get('x-ratelimit-reset');
      if (remaining !== null) state.remaining = Number(remaining);
      if (reset !== null) state.reset = Number(reset);

      if (res.ok) {
        const body = accept && accept.includes('raw') ? await res.text() : await res.json();
        return { body, links: parseLinkHeader(res.headers.get('link')) };
      }

      if (res.status === 404 && allow404) return { body: null, links: {} };

      // Rate limiting: primary (403/429 with remaining=0) or secondary (retry-after)
      const retryAfter = res.headers.get('retry-after');
      const isRateLimited =
        res.status === 429 || (res.status === 403 && (state.remaining === 0 || retryAfter !== null));
      if (isRateLimited) {
        const waitMs = retryAfter
          ? Number(retryAfter) * 1000
          : Math.max(0, (state.reset ?? 0) * 1000 - Date.now()) + 1000;
        if (waitMs <= maxRateLimitWaitMs && attempt < maxRetries) {
          onRateLimit(waitMs);
          await sleep(waitMs);
          continue;
        }
        const resetAt = state.reset ? new Date(state.reset * 1000).toISOString() : null;
        throw new GitHubError(
          429,
          'GITHUB_RATE_LIMIT',
          token
            ? `GitHub rate limit reached. It resets at ${resetAt ?? 'a later time'}.`
            : `GitHub rate limit reached (60 requests/hour without a token). Add GITHUB_TOKEN to backend/.env. Resets at ${resetAt ?? 'a later time'}.`,
          { resetAt },
        );
      }

      if (res.status >= 500 && attempt < maxRetries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }

      let message = `GitHub returned ${res.status}.`;
      try {
        const j = await res.json();
        if (j?.message) message = `GitHub: ${j.message}`;
      } catch {
        /* ignore */
      }
      if (res.status === 404) throw new GitHubError(404, 'GITHUB_NOT_FOUND', 'Repository or resource not found (is it public?).');
      if (res.status === 409) throw new GitHubError(409, 'GITHUB_EMPTY_REPO', 'The repository has no commits yet.');
      if (res.status === 401) throw new GitHubError(401, 'GITHUB_BAD_TOKEN', 'GitHub rejected the token in GITHUB_TOKEN.');
      throw new GitHubError(res.status >= 500 ? 502 : res.status, 'GITHUB_ERROR', message);
    }
  }

  async function get(path, opts) {
    return (await request(path, opts)).body;
  }

  /** Follow `next` links until `max` items are collected or `stop(item)` returns true. */
  async function paginate(path, { max = Infinity, stop, map = (x) => x } = {}) {
    const out = [];
    let next = path;
    while (next && out.length < max) {
      const { body, links } = await request(next);
      const items = Array.isArray(body) ? body : body?.items ?? [];
      for (const item of items) {
        if (stop && stop(item)) return out;
        out.push(map(item));
        if (out.length >= max) break;
      }
      next = links.next || null;
    }
    return out;
  }

  return { get, paginate, request, state };
}
