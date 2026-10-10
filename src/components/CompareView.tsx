import { useEffect, useRef, useState } from 'react';
import { Columns2, Loader2, MonitorSmartphone, ScanEye, SplitSquareHorizontal, X } from './icons';

export interface CompareTarget {
  runId?: string;                             // a run's shots…
  pair?: string;                              // …optionally another page of that run ("route-pricing")
  images?: { before: string; after: string }; // or two images given directly
  labels?: [string, string];
  title?: string;
}

interface Props extends CompareTarget {
  onClose(): void;
  captureSizes?(runId: string): Promise<void>;
}

type Mode = 'slider' | 'side' | 'changes';

const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

// Marks pixels that differ between before and after on top of the after image.
export async function diffOverlay(before: string, after: string): Promise<{ url: string; pct: number }> {
  const [a, b] = await Promise.all([load(before), load(after)]);
  const w = b.width, h = b.height;
  const ca = document.createElement('canvas'); ca.width = w; ca.height = h;
  const cb = document.createElement('canvas'); cb.width = w; cb.height = h;
  const xa = ca.getContext('2d', { willReadFrequently: true })!, xb = cb.getContext('2d', { willReadFrequently: true })!;
  xa.drawImage(a, 0, 0, w, h); xb.drawImage(b, 0, 0, w, h);
  const da = xa.getImageData(0, 0, w, h).data, db = xb.getImageData(0, 0, w, h);
  const px = db.data;
  let changed = 0;
  for (let i = 0; i < px.length; i += 4) {
    const d = Math.abs(px[i] - da[i]) + Math.abs(px[i + 1] - da[i + 1]) + Math.abs(px[i + 2] - da[i + 2]);
    if (d > 60) { changed++; px[i] = 255; px[i + 1] = Math.round(px[i + 1] * .25 + 50); px[i + 2] = 40; }
    else { const g = (px[i] + px[i + 1] + px[i + 2]) / 3; px[i] = px[i + 1] = px[i + 2] = g * .45 + 120; } // fade unchanged areas
  }
  xb.putImageData(db, 0, 0);
  return { url: cb.toDataURL('image/jpeg', .85), pct: (changed / (w * h)) * 100 };
}

// True when two screenshots are the same to the eye (the same test diffOverlay's `pct < 0.01` was),
// without building the marked-up image, and stopping at the first sign of a real difference.
export async function looksSame(before: string, after: string): Promise<boolean> {
  const [a, b] = await Promise.all([load(before), load(after)]);
  const w = b.width, h = b.height;
  const limit = w * h * 0.0001;
  const pixels = (img: HTMLImageElement) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(img, 0, 0, w, h);
    return x.getImageData(0, 0, w, h).data;
  };
  const da = pixels(a), db = pixels(b);
  let changed = 0;
  for (let i = 0; i < db.length; i += 4) {
    if (Math.abs(db[i] - da[i]) + Math.abs(db[i + 1] - da[i + 1]) + Math.abs(db[i + 2] - da[i + 2]) > 60 && ++changed >= limit) return false;
  }
  return true;
}

export function CompareView({ runId, pair, images, labels = ['Before', 'After'], title = 'Before & after', onClose, captureSizes }: Props) {
  const [all, setShots] = useState<Record<string, string> | null>(images ? {} : null);
  const [mode, setMode] = useState<Mode>('slider');
  const [pos, setPos] = useState(50);
  const [diff, setDiff] = useState<{ url: string; pct: number } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  const reload = () => (runId ? window.pinpoint.runShots(runId).then(setShots).catch(() => setShots({})) : Promise.resolve());
  useEffect(() => { reload(); }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Whatever the source, the rest of the view works with shots.before / shots.after.
  const shots: Record<string, string> | null = images ?? (all && pair ? { before: all[`${pair}-before`], after: all[`${pair}-after`] } : all);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    if (mode === 'changes' && shots?.before && shots?.after && !diff) diffOverlay(shots.before, shots.after).then(setDiff).catch(() => {});
  }, [mode, shots?.before, shots?.after]); // eslint-disable-line react-hooks/exhaustive-deps

  const drag = (e: React.PointerEvent) => {
    const el = stage.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      setPos(Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100)));
    };
    move(e.nativeEvent);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  // Phone, tablet, then desktop (stored as width 0).
  const width = (k: string) => parseInt(k.slice(5)) || Infinity;
  const sizes = shots && !pair && !images ? Object.keys(shots).filter((k) => k.startsWith('size-')).sort((a, b) => width(a) - width(b)) : [];
  const has = shots?.before && shots?.after;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="compare-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="diff-head">
          <h3>{title}</h3>
          <div className="seg">
            <button className={mode === 'slider' ? 'on' : ''} onClick={() => setMode('slider')}><SplitSquareHorizontal size={13} /> Slider</button>
            <button className={mode === 'side' ? 'on' : ''} onClick={() => setMode('side')}><Columns2 size={13} /> Side by side</button>
            <button className={mode === 'changes' ? 'on' : ''} onClick={() => setMode('changes')}><ScanEye size={13} /> Changes</button>
          </div>
          {mode === 'changes' && diff && <span className="hint">{diff.pct < 0.05 ? 'No visible difference' : `${diff.pct.toFixed(1)}% of pixels differ`}</span>}
          <div className="spacer" />
          {runId && !pair && captureSizes && (
            <button className="btn xs" disabled={capturing} onClick={async () => { setCapturing(true); try { await captureSizes(runId); await reload(); } finally { setCapturing(false); } }} title="Screenshot the page now at phone, tablet and desktop widths">
              {capturing ? <Loader2 size={12} className="spin" /> : <MonitorSmartphone size={12} />} Check all sizes
            </button>
          )}
          <button className="icon-btn" onClick={onClose} title="Close (Esc)"><X size={16} /></button>
        </div>

        <div className="compare-body">
          {!shots ? <div className="diff-empty"><Loader2 className="spin" size={18} /></div>
            : !has ? <div className="diff-empty">No screenshots for this run. They're taken when a run changes a page that's open in Pinpoint.</div>
              : mode === 'slider' ? (
                <div className="cmp-stage" ref={stage} onPointerDown={drag}>
                  <img src={shots.after} alt={labels[1]} draggable={false} />
                  <img src={shots.before} alt={labels[0]} draggable={false} className="cmp-before" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
                  <div className="cmp-handle" style={{ left: `${pos}%` }}><span /></div>
                  <span className="cmp-label left">{labels[0]}</span>
                  <span className="cmp-label right">{labels[1]}</span>
                </div>
              ) : mode === 'side' ? (
                <div className="cmp-side">
                  <figure><figcaption>{labels[0]}</figcaption><img src={shots.before} alt={labels[0]} /></figure>
                  <figure><figcaption>{labels[1]}</figcaption><img src={shots.after} alt={labels[1]} /></figure>
                </div>
              ) : (
                <div className="cmp-stage static">
                  {diff ? <img src={diff.url} alt="Changed areas" /> : <div className="diff-empty"><Loader2 className="spin" size={18} /></div>}
                  <span className="cmp-label left">Differences in red</span>
                </div>
              )}

          {sizes.length > 0 && (
            <div className="cmp-sizes">
              {sizes.map((k) => (
                <figure key={k}>
                  <figcaption>{k === 'size-0' ? 'Desktop' : `${k.slice(5)} px`}</figcaption>
                  <img src={shots![k]} alt={k} />
                </figure>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
