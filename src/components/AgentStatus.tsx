import { FilePen, FileText, Search } from './icons';
import { shortPath } from './Chat';
import type { ChatItem } from '../lib/types';

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

// What the agent is looking at right now: the last few files its steps touched in this turn.
export function ReadingStrip({ items, root }: { items: ChatItem[]; root: string }) {
  let start = 0;
  items.forEach((it, i) => { if (it.kind === 'user') start = i; });
  const seen = new Map<string, { name: string; running: boolean }>();
  for (const it of items.slice(start)) {
    if (it.kind !== 'tool' || !it.detail || !/[\\/.]/.test(it.detail) || /\s/.test(it.detail.trim())) continue;
    seen.delete(it.detail);
    seen.set(it.detail, { name: it.name, running: it.status === 'running' });
  }
  const recent = [...seen].slice(-3).reverse();
  if (!recent.length) return null;
  return (
    <div className="reading-strip">
      {recent.map(([file, t], i) => {
        const Icon = /Edit|Write/.test(t.name) ? FilePen : /Grep|Glob|Search/.test(t.name) ? Search : FileText;
        const rel = shortPath(file, root);
        return (
          <span key={file} className={`reading-file ${i === 0 ? 'now' : ''}`} title={rel}>
            <Icon size={11} /> {rel.split('/').pop()}
          </span>
        );
      })}
    </div>
  );
}
