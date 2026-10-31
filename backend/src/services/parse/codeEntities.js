/**
 * Lightweight, dependency-free extraction of code entities (functions, classes,
 * configuration keys, constants). Regex-based by design: it is explainable in a demo
 * and we record `method: "regex"` as provenance. It does not claim to be a full parser.
 */

const SOURCE_EXT = /\.(m?[jt]sx?|cjs|py|go|rb|java|kt|cs|rs|php|swift|scala|c|cc|cpp|h|hpp)$/i;
const CONFIG_EXT = /\.(json|ya?ml|toml|ini|cfg|conf|properties)$/i;
const DOC_EXT = /\.(md|mdx|rst|adoc|txt)$/i;
const SKIP_DIR = /(^|\/)(node_modules|vendor|dist|build|out|coverage|\.next|third_party|__snapshots__|fixtures?)\//i;
const LOCKFILE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum|composer\.lock)$/i;

export function classifyPath(path) {
  if (SKIP_DIR.test(path) || LOCKFILE.test(path) || /\.min\.js$/i.test(path)) return 'other';
  const base = path.split('/').pop();
  if (DOC_EXT.test(path)) return 'doc';
  if (/^\.env(\.example|\.sample|\.template)?$/i.test(base) || /^Dockerfile$/i.test(base) || CONFIG_EXT.test(path)) return 'config';
  if (SOURCE_EXT.test(path)) return 'source';
  return 'other';
}

export function languageOf(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const map = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', go: 'go', rb: 'ruby', java: 'java', kt: 'kotlin', cs: 'csharp', rs: 'rust', php: 'php',
    swift: 'swift', scala: 'scala', c: 'c', cc: 'cpp', cpp: 'cpp', h: 'c', hpp: 'cpp',
    json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', md: 'markdown', mdx: 'markdown',
  };
  return map[ext] || 'text';
}

/** Directory that acts as the module for a file ("" for repo root). */
export function moduleOf(path) {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

const FN_PATTERNS = {
  javascript: [
    [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/, 'function'],
    [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/, 'function'],
    [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
  ],
  python: [
    [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, 'function'],
    [/^\s*class\s+([A-Za-z_]\w*)\s*[(:]/, 'class'],
  ],
  go: [
    [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/, 'function'],
    [/^\s*type\s+([A-Za-z_]\w*)\s+struct\b/, 'class'],
  ],
  ruby: [
    [/^\s*def\s+(?:self\.)?([A-Za-z_]\w*[!?]?)/, 'function'],
    [/^\s*class\s+([A-Z]\w*)/, 'class'],
  ],
  rust: [
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, 'function'],
    [/^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/, 'class'],
  ],
  clike: [
    [/^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?(?:final\s+)?(?:abstract\s+)?(?:class|interface|record)\s+([A-Za-z_]\w*)/, 'class'],
    [/^\s*(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?[\w<>\[\],\s]+?\s+([A-Za-z_]\w*)\s*\([^;]*$/, 'function'],
  ],
};
FN_PATTERNS.typescript = FN_PATTERNS.javascript;
for (const l of ['java', 'kotlin', 'csharp', 'scala', 'swift', 'php', 'c', 'cpp']) FN_PATTERNS[l] = FN_PATTERNS.clike;

// UPPER_SNAKE constants in source files are often tunables (MAX_RETRIES = 3)
const CONST_RE = /^\s*(?:export\s+)?(?:const|let|var|final|static\s+final\s+\w+|public\s+static\s+final\s+\w+)?\s*([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z]{3,}[0-9]*)\s*(?::\s*[\w<>]+\s*)?=\s*([^;\n]{1,80})/;

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'constructor', 'else', 'new']);

export function extractCodeEntities(path, content) {
  const result = { functions: [], configs: [] };
  if (typeof content !== 'string' || !content) return result;
  const kind = classifyPath(path);
  const lang = languageOf(path);
  const lines = content.split(/\r?\n/).slice(0, 5000);

  if (kind === 'source') {
    const patterns = FN_PATTERNS[lang] || [];
    const seen = new Set();
    lines.forEach((line, i) => {
      for (const [re, k] of patterns) {
        const m = line.match(re);
        if (m && !KEYWORDS.has(m[1]) && !seen.has(`${k}:${m[1]}`)) {
          seen.add(`${k}:${m[1]}`);
          result.functions.push({ name: m[1], kind: k, line: i + 1 });
          break;
        }
      }
      const c = line.match(CONST_RE);
      if (c && !seen.has(`const:${c[1]}`)) {
        seen.add(`const:${c[1]}`);
        result.configs.push({ key: c[1], value: clean(c[2]), line: i + 1, kind: 'constant' });
      }
    });
  } else if (kind === 'config') {
    result.configs = extractConfigKeys(path, content, lines);
  }
  return result;
}

const clean = (v) => String(v).trim().replace(/[,;]\s*$/, '').slice(0, 80);

function extractConfigKeys(path, content, lines) {
  const base = path.split('/').pop();
  const out = [];
  const push = (key, value, line) => {
    if (key && out.length < 400 && !out.some((o) => o.key === key)) out.push({ key, value: value === undefined || value === null ? null : clean(value), line, kind: 'config' });
  };

  if (/\.json$/i.test(path)) {
    try {
      const walk = (obj, prefix, depth) => {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj) || depth > 3) return;
        for (const [k, v] of Object.entries(obj)) {
          const key = prefix ? `${prefix}.${k}` : k;
          if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key, depth + 1);
          else push(key, typeof v === 'string' ? v : JSON.stringify(v), lineOf(lines, `"${k}"`));
        }
      };
      walk(JSON.parse(content), '', 0);
    } catch {
      /* invalid JSON: skip */
    }
    return out;
  }

  if (/^\.env/i.test(base)) {
    lines.forEach((l, i) => {
      const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      // never store values from env files; they might be secrets
      if (m) push(m[1], null, i + 1);
    });
    return out;
  }

  if (/\.ya?ml$/i.test(path)) {
    const stack = [];
    lines.forEach((l, i) => {
      if (/^\s*(#|$)/.test(l) || /^\s*-/.test(l)) return;
      const m = l.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
      if (!m) return;
      const indent = m[1].length;
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const key = [...stack.map((s) => s.key), m[2]].join('.');
      if (m[3] === '' || m[3].startsWith('#')) stack.push({ indent, key: m[2] });
      else push(key, m[3].replace(/\s+#.*$/, ''), i + 1);
    });
    return out;
  }

  // TOML / INI / properties
  let section = '';
  lines.forEach((l, i) => {
    const s = l.match(/^\s*\[+([^\]]+)\]+\s*$/);
    if (s) {
      section = s[1].trim();
      return;
    }
    const m = l.match(/^\s*([A-Za-z0-9_.-]+)\s*[=:]\s*(.+)$/);
    if (m && !/^\s*[#;]/.test(l)) push(section ? `${section}.${m[1]}` : m[1], m[2], i + 1);
  });
  return out;
}

function lineOf(lines, needle) {
  const i = lines.findIndex((l) => l.includes(needle));
  return i >= 0 ? i + 1 : null;
}
