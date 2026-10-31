export default function Header({ health, healthError, onRetry }) {
  const c = health?.credentials;
  const pills = health
    ? [
        ['Graph', health.graph.ok ? health.graph.backend : 'not ready', health.graph.ok ? 'ok' : 'warn'],
        ['GitHub token', c.github ? 'set' : 'missing (60 req/h)', c.github ? 'ok' : 'warn'],
        ['LLM', c.llm ? `${c.llmProvider === 'sarvam' ? 'Sarvam AI' : 'OpenAI'} · ${c.llmModel}` : 'off (extractive answers)', c.llm ? 'ok' : 'neutral'],
      ]
    : [];
  return (
    <header className="header">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="9" cy="9" r="3.5" fill="var(--mint)" />
          <circle cx="23" cy="16" r="3.5" fill="var(--mint)" />
          <circle cx="9" cy="23" r="3.5" fill="var(--amber)" />
          <path d="M9 9 23 16 9 23" stroke="var(--mint)" strokeWidth="1.6" fill="none" />
        </svg>
        <span className="brand-name">TraceWhy</span>
        <span className="brand-sub">why the code is like this</span>
      </div>
      <div className="pills">
        {healthError && (
          <button className="pill pill-warn" onClick={onRetry}>
            backend offline · retry
          </button>
        )}
        {pills.map(([k, v, tone]) => (
          <span key={k} className={`pill pill-${tone}`} title={`${k}: ${v}`}>
            <b>{k}</b> {v}
          </span>
        ))}
      </div>
    </header>
  );
}
