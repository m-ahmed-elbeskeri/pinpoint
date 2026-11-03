
// How full the agent's context is, as a small ring by the send button.
const exact = (n: number) => n.toLocaleString();

export function ContextMeter({ used, window = 200000 }: { used: number; window?: number }) {
  const pct = Math.min(100, Math.round((used / window) * 100));
  const left = Math.max(0, window - used);
  const r = 7, c = 2 * Math.PI * r;
  return (
    <span className={`ctx-meter ${pct >= 85 ? 'high' : pct >= 60 ? 'mid' : ''}`} tabIndex={0} aria-label={`Context ${pct}% used: ${exact(used)} of ${exact(window)} tokens`}>
      <span className="ctx-card" role="tooltip">
        <b>Context</b>
        <span className="ctx-bar"><i style={{ width: `${pct}%` }} /></span>
        <span className="ctx-row"><span>Used</span><span>{exact(used)} tokens · {pct}%</span></span>
        <span className="ctx-row"><span>Left</span><span>{exact(left)} tokens</span></span>
        <span className="ctx-row"><span>Window</span><span>{exact(window)} tokens</span></span>
        <small>{pct >= 85 ? 'Nearly full: the agent may start forgetting early parts. A new chat starts fresh.' : 'How much of the conversation the agent can keep in mind.'}</small>
      </span>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r={r} className="ctx-track" />
        <circle cx="9" cy="9" r={r} className="ctx-fill" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 9 9)" />
      </svg>
      <span>{pct}%</span>
    </span>
  );
}
