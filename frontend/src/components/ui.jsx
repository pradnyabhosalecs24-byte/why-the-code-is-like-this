import { LABEL_COLORS } from '../lib/api.js';

export function Notice({ tone = 'info', title, children }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {title && <strong>{title}. </strong>}
      {children}
    </div>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <span className="spinner" role="status">
      <span className="spinner-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function StatusBadge({ status }) {
  if (!status) return null;
  return <span className={`badge status-${status}`}>{status}</span>;
}

export function LabelTag({ label }) {
  return (
    <span className="label-tag">
      <i style={{ background: LABEL_COLORS[label] || 'var(--muted)' }} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Only GitHub links and TraceWhy's synthetic-record viewer are rendered as links. */
export const isSafeHref = (href) => typeof href === 'string' && (/^https:\/\/github\.com\//.test(href) || /^\/api\/demo\/records\//.test(href));

export function SyntheticBadge() {
  return <span className="badge badge-synthetic" title="Fictional demonstration data, not from GitHub">synthetic</span>;
}

export function ExtLink({ href, children }) {
  if (!isSafeHref(href)) return <span className="muted small" title="No verifiable source link for this record">link unavailable</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="ext">
      {children}
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}
