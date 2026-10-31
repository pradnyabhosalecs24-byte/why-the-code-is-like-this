// Simulated GitHub REST API for tests only. Routes map URL -> body, or {status, body, headers}.
const A = 'https://api.github.com/repos/demo/app';
const user = (login) => ({ login, html_url: `https://github.com/${login}` });

export function baseRoutes() {
  const s1 = '1'.repeat(40);
  return {
    [A]: { full_name: 'demo/app', name: 'app', owner: { login: 'demo' }, html_url: 'https://github.com/demo/app', default_branch: 'main', private: false, description: '' },
    [`${A}/commits?per_page=100&sha=main`]: [{ sha: s1, html_url: `https://github.com/demo/app/commit/${s1}`, author: user('bo'), parents: [], commit: { message: 'Use a 30s timeout (#3)', author: { date: '2024-02-01T00:00:00Z', name: 'bo' } } }],
    [`${A}/commits/${s1}`]: { files: [{ filename: 'src/net.js', status: 'modified', additions: 1, deletions: 1 }] },
    [`${A}/pulls?state=all&sort=updated&direction=desc&per_page=100`]: [
      { number: 3, title: 'Use a 30s timeout', body: 'We decided to set REQUEST_TIMEOUT to 30 because exports take 20s.', state: 'closed', merged_at: '2024-02-01T00:00:00Z', created_at: '2024-01-30T00:00:00Z', updated_at: '2024-02-01T00:00:00Z', html_url: 'https://github.com/demo/app/pull/3', user: user('bo'), comments: 0 },
    ],
    [`${A}/pulls/3/commits?per_page=100`]: [{ sha: s1 }],
    [`${A}/pulls/3/comments?per_page=100`]: [],
    [`${A}/issues?state=all&sort=updated&direction=desc&per_page=100`]: [],
    [`${A}/git/trees/main?recursive=1`]: { tree: [{ type: 'blob', path: 'src/net.js', size: 40 }] },
    [`${A}/contents/src/net.js?ref=main`]: 'export const REQUEST_TIMEOUT = 30;\n',
  };
}

export function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    let r = routes[url];
    if (typeof r === 'function') r = r();
    if (r instanceof Error) throw r;
    const spec = r && typeof r === 'object' && 'status' in r && 'body' in r ? r : r === undefined ? { status: 404, body: { message: 'Not Found' } } : { status: 200, body: r };
    return {
      ok: spec.status >= 200 && spec.status < 300,
      status: spec.status,
      headers: { get: (k) => (spec.headers || { 'x-ratelimit-remaining': '4999' })[k.toLowerCase()] ?? null },
      json: async () => spec.body,
      text: async () => (typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body)),
    };
  };
  fn.calls = calls;
  return fn;
}

export async function waitForJob(getJob, id) {
  for (let i = 0; i < 300 && getJob(id).status === 'running'; i++) await new Promise((r) => setTimeout(r, 10));
  return getJob(id);
}
