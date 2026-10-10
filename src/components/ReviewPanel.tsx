import { useEffect, useState } from 'react';
import { ClipboardCopy, Loader2, MessageSquare, Plus, Trash2, X } from './icons';
import type { ReviewComment, ReviewState } from '../lib/types';

interface Props {
  url: string;
  canShare: boolean;
  whyNot: string;
  comments: ReviewComment[];
  onAdd(list: ReviewComment[]): void;
  onDismiss(id: string): void;
  onState(s: ReviewState): void;
  flash(msg: string): void;
  onClose(): void;
}

const errText = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const ago = (at: number) => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

export function ReviewPanel({ url, canShare, whyNot, comments, onAdd, onDismiss, onState, flash, onClose }: Props) {
  const [state, setState] = useState<ReviewState | null>(null);
  const [working, setWorking] = useState(false);
  useEffect(() => { window.pinpoint.reviewState().then(setState).catch(() => setState({ running: false, urls: [], comments: [] })); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = async (fn: () => Promise<ReviewState>) => {
    setWorking(true);
    try { const s = await fn(); setState(s); onState(s); } catch (e) { flash(errText(e)); } finally { setWorking(false); }
  };
  const copy = (u: string) => { navigator.clipboard?.writeText(u); flash('Link copied.'); };
  const lan = state?.urls.filter((u) => !/\/\/localhost:/.test(u)) || [];

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="compare-modal review" onMouseDown={(e) => e.stopPropagation()}>
        <div className="diff-head">
          <h3><MessageSquare size={15} /> Get comments on this site</h3>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} title="Close (Esc)"><X size={16} /></button>
        </div>
        <div className="compare-body">
          {!state ? <div className="diff-empty"><Loader2 className="spin" size={18} /></div> : !state.running ? (
            <div className="review-intro">
              <p>Share a link to the site running on your machine. Whoever opens it sees the real page with a <b>Leave a comment</b> button: they click the thing they mean, type what should change, and it arrives here ready to send to the agent. They need nothing installed.</p>
              <p className="hint">The link works for anyone on the same network (same Wi-Fi or office network) who has it. To share further, point a tunnel such as <span className="mono">cloudflared tunnel --url</span> at the address shown after you start. Stop sharing when you are done.</p>
              <div>
                <button className="btn primary sm" disabled={!canShare || working} onClick={() => act(() => window.pinpoint.reviewStart(url))} title={canShare ? url : whyNot}>
                  {working ? <Loader2 size={13} className="spin" /> : null} Start sharing this page
                </button>
                {!canShare && <span className="hint review-why">{whyNot}</span>}
              </div>
            </div>
          ) : (
            <div className="review-live">
              <div className="review-links">
                <b><i className="live-dot" /> Sharing {state.target}</b>
                {lan.length === 0 && <span className="hint">This computer isn't on a network right now, so the link only works on this machine.</span>}
                {(lan.length ? lan : state.urls).map((u) => (
                  <div key={u} className="review-link">
                    <span className="mono">{u}</span>
                    <button className="btn xs" onClick={() => copy(u)}><ClipboardCopy size={12} /> Copy</button>
                  </div>
                ))}
                <span className="hint">For a tunnel, forward to <span className="mono">http://localhost:{state.port}</span> and keep the <span className="mono">?pp=…</span> part of the link.</span>
              </div>
              <button className="btn xs" disabled={working} onClick={() => act(() => window.pinpoint.reviewStop())}>Stop sharing</button>
            </div>
          )}

          <div className="review-inbox">
            <header>
              <b>Comments</b><span className="hint">{comments.length ? `${comments.length} waiting` : 'None yet'}</span>
              <div className="spacer" />
              {comments.length > 1 && <button className="btn xs primary" onClick={() => onAdd(comments)}><Plus size={12} /> Add all to the request</button>}
            </header>
            {comments.map((c) => (
              <article key={c.id}>
                <div className="review-meta">
                  <b>{c.name || 'Someone'}</b>
                  <span className="mono">{c.path}</span>
                  {c.viewport.width > 0 && <span className="hint">{c.viewport.width}px wide</span>}
                  <span className="hint">{ago(c.at)}</span>
                </div>
                <p>{c.text}</p>
                {c.selector && <code>{`<${c.tag}>`}{c.elText ? ` "${c.elText.slice(0, 60)}"` : ''} · {c.selector}</code>}
                <div className="review-actions">
                  <button className="btn xs" onClick={() => onAdd([c])}><Plus size={12} /> Add to the request</button>
                  <button className="btn xs ghost" onClick={() => onDismiss(c.id)}><Trash2 size={12} /> Dismiss</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
