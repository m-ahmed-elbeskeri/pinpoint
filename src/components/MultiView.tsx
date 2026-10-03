import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

const SIZES = [
  { label: 'Phone', w: 390, h: 844 },
  { label: 'Tablet', w: 820, h: 1180 },
  { label: 'Desktop', w: 1440, h: 900 },
];
const GAP = 18;

interface Props {
  url: string;
  onNavigate(url: string): void;         // a link was followed in one of the panes
  onPick(w: number, h: number): void;    // open the main view at this size
  onClose(): void;
}

// The same page at phone, tablet and desktop size, live and scrolling together.
// For looking; picking and drawing happen in the main view.
export function MultiView({ url, onNavigate, onPick, onClose }: Props) {
  const body = useRef<HTMLDivElement>(null);
  const views = useRef<(HTMLElement | null)[]>([]);
  const [scale, setScale] = useState(0.4);
  const cb = useRef(onNavigate);
  cb.current = onNavigate;

  useEffect(() => {
    const el = body.current!;
    const fit = () => {
      const w = el.clientWidth - GAP * (SIZES.length + 1), h = el.clientHeight - 60;
      setScale(Math.max(0.15, Math.min(1, w / SIZES.reduce((s, x) => s + x.w, 0), h / Math.max(...SIZES.map((x) => x.h)))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scrolling one pane scrolls the others to the same relative position.
  useEffect(() => {
    const offs = views.current.map((v, i) => {
      if (!v) return () => {};
      const onMsg = (e: any) => {
        if (e.channel !== 'scroll') return;
        views.current.forEach((o, j) => { if (o && j !== i) (o as any).send('syncScroll', e.args?.[0] ?? 0); });
      };
      const onNav = (e: any) => { if (e.url && e.url !== url) cb.current(e.url); };
      v.addEventListener('ipc-message', onMsg);
      v.addEventListener('did-navigate', onNav);
      return () => { v.removeEventListener('ipc-message', onMsg); v.removeEventListener('did-navigate', onNav); };
    });
    return () => offs.forEach((off) => off());
  }, [url]);

  return (
    <div className="multi">
      <div className="multi-head">
        <b>All sizes</b><span className="hint">Live and scroll-synced. Click a size to work on the page at that width.</span>
        <div className="spacer" />
        <button className="icon-btn xs" onClick={onClose} title="Back to one view"><X size={14} /></button>
      </div>
      <div className="multi-body" ref={body}>
        {SIZES.map((s, i) => (
          <figure key={s.label} style={{ width: s.w * scale }}>
            <figcaption><button className="chip mono" onClick={() => onPick(s.w, s.h)}>{s.label} · {s.w}×{s.h}</button></figcaption>
            <div className="multi-box" style={{ width: s.w * scale, height: s.h * scale }}>
              <div style={{ width: s.w, height: s.h, transform: `scale(${scale})` }}>
                <webview ref={(el: any) => { views.current[i] = el; }} src={url} partition="persist:pinpoint" className="webview" />
              </div>
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}
