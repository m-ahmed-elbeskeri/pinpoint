const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

// How full the agent's context is, as a small ring by the send button.
export function ContextMeter({ used, window = 200000 }: { used: number; window?: number }) {
  const pct = Math.min(100, Math.round((used / window) * 100));
  const r = 7, c = 2 * Math.PI * r;
  return (
    <span className={`ctx-meter ${pct >= 85 ? 'high' : pct >= 60 ? 'mid' : ''}`} title={`Context: ${fmt(used)} of ${fmt(window)} tokens (${pct}%)`}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r={r} className="ctx-track" />
        <circle cx="9" cy="9" r={r} className="ctx-fill" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 9 9)" />
      </svg>
      <span>{pct}%</span>
    </span>
  );
}
