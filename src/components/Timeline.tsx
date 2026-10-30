import { useEffect, useState } from 'react';
import { X } from './icons';
import type { ChatItem } from '../lib/types';

interface Frame { key: string; label: string; image: string }

// The page across a chat: the "before" of its first run, then the "after" of every run, on a scrubber.
export function Timeline({ items, onClose, onCompare }: { items: ChatItem[]; onClose(): void; onCompare(images: { before: string; after: string }, labels: [string, string], title: string): void }) {
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [at, setAt] = useState(0);

  useEffect(() => {
    let live = true;
    const runs = items.filter((it): it is Extract<ChatItem, { kind: 'done' }> => it.kind === 'done' && !!it.shots);
    (async () => {
      const out: Frame[] = [];
      for (const [i, r] of runs.entries()) {
        const shots = await window.pinpoint.runShots(r.runId, i === 0 ? ['before', 'after'] : ['after']).catch(() => ({} as Record<string, string>));
        if (i === 0 && shots.before) out.push({ key: `${r.runId}-before`, label: 'Before', image: shots.before });
        const request = [...items.slice(0, items.indexOf(r))].reverse().find((x) => x.kind === 'user');
        if (shots.after) out.push({ key: r.runId, label: request?.kind === 'user' && request.text ? request.text.split('\n')[0].slice(0, 60) : `Run ${i + 1}`, image: shots.after });
      }
      if (live) { setFrames(out); setAt(Math.max(0, out.length - 1)); }
    })();
    return () => { live = false; };
  }, [items]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') setAt((n) => Math.max(0, n - 1));
      else if (e.key === 'ArrowRight') setAt((n) => Math.min((frames?.length || 1) - 1, n + 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [frames, onClose]);

  const frame = frames?.[at];
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="timeline" onMouseDown={(e) => e.stopPropagation()}>
        <div className="diff-head">
          <h3>Timeline</h3>
          <span className="hint">{frames ? `${frames.length} screenshot${frames.length === 1 ? '' : 's'} · ← → to step` : 'Loading…'}</span>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} title="Close (Esc)"><X size={16} /></button>
        </div>
        {frames && frames.length === 0 && <div className="timeline-empty">No screenshots in this chat yet. Runs that change the open page take a before and after.</div>}
        {frame && (
          <>
            <div className="timeline-stage"><img src={frame.image} alt={frame.label} /></div>
            <div className="timeline-caption"><b>{at === 0 && frame.label === 'Before' ? 'Before any change' : `After: ${frame.label}`}</b><span>{at > 0 && <button className="link-btn" onClick={() => onCompare({ before: frames![at - 1].image, after: frame.image }, ['Previous', 'This one'], frame.label)}>Compare with previous</button>} {at + 1} of {frames!.length}</span></div>
            <input className="timeline-scrub" type="range" min={0} max={frames!.length - 1} value={at} onChange={(e) => setAt(Number(e.target.value))} />
            <div className="timeline-strip">
              {frames!.map((f, i) => (
                <button key={f.key} className={i === at ? 'on' : ''} onClick={() => setAt(i)} title={f.label}><img src={f.image} alt="" /></button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
