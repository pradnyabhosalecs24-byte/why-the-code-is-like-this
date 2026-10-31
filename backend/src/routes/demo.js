import { Router } from 'express';
import { demoRecordIndex } from '../../demo/syntheticRepo.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Read-only viewer for SYNTHETIC demo records. Synthetic evidence links here instead of to
 * github.com, so a "source link" in the demo never pretends to be a real GitHub record.
 */
export function createDemoRouter() {
  const r = Router();
  const index = demoRecordIndex();
  r.get(/^\/records\/(.+)$/, (req, res) => {
    let key = req.params[0].replace(/#.*$/, '');
    const blob = key.match(/^repo\/blob\/[^/]+\/(.+)$/);
    if (blob) key = `file/${blob[1]}`;
    const rec = index.get(key);
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    if (!rec) return res.status(404).type('html').send(page('Synthetic record not found', '<p>This synthetic record does not exist.</p>'));
    const comments = (rec.comments || []).map((c) => `<div class="c"><b>${esc(c.author?.login || c.author?.name || 'unknown')}</b> · ${esc(c.date?.slice(0, 10))}<pre>${esc(c.body)}</pre></div>`).join('');
    res.type('html').send(page(rec.title, `
      <p class="meta">${esc(rec.kind)}${rec.author ? ` · ${esc(rec.author)}` : ''}${rec.date ? ` · ${esc(rec.date.slice(0, 10))}` : ''}${rec.labels ? ` · labels: ${esc(rec.labels.join(', '))}` : ''}</p>
      <pre>${esc(rec.body)}</pre>
      ${rec.files ? `<p class="meta">Changed files: ${esc(rec.files.join(', '))}</p>` : ''}
      ${comments ? `<h2>Comments</h2>${comments}` : ''}`));
  });
  return r;
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · synthetic</title>
<style>body{margin:0;background:#16181b;color:#ece6dc;font:15px/1.55 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:24px 16px}
.banner{background:#3a2e17;color:#f0cf8f;border:1px solid #8a6a2c;border-radius:6px;padding:10px 12px;font-size:14px}
h1{font-size:20px}pre{white-space:pre-wrap;background:#1f2226;border:1px solid #2c3036;border-radius:6px;padding:12px;font:13px/1.5 ui-monospace,Consolas,monospace}
.meta{color:#9aa0a8;font-size:13px}.c{margin:10px 0}</style></head>
<body><main><div class="banner"><b>SYNTHETIC DEMO RECORD.</b> This is fictional demonstration data shipped with TraceWhy. It is not from GitHub and not real history.</div>
<h1>${esc(title)}</h1>${body}</main></body></html>`;
}
