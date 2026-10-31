import { useEffect, useRef, useState } from 'react';
import type { WebviewTag } from 'electron';
import { Check, Layers, Loader2, X } from '../ui/icons';
import { errText } from '../../lib/util';
import { useEscape, useScrollSync } from '../../lib/hooks';

interface Option { runId: string; index: number; files: number }
interface Props {
  options: Option[];
  chosen?: string | null;
  page: string;
  busy: boolean;
  onPick(runId: string): void;
  onClose(): void;
}

const WIDTH = 1280;
const HEIGHT = 900;
const GAP = 16;

export function VariantsLive({ options, chosen, page, busy, onPick, onClose }: Props) {
  const shown = options.slice(0, 4);
  const [views, setViews] = useState<{ runId: string; url: string | null }[] | null>(null);
  const [progress, setProgress] = useState('Getting ready…');
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(0.4);
  const body = useRef<HTMLDivElement>(null);
  const frames = useRef<(WebviewTag | null)[]>([]);

  useEffect(() => {
    let live = true;
    const off = window.pinpoint.onVariantsProgress(setProgress);
    window.pinpoint.variantsLive({ runIds: shown.map((o) => o.runId), page })
      .then((v) => { if (live) setViews(v); })
      .catch((e) => { if (live) setError(errText(e)); });
    return () => { live = false; off(); window.pinpoint.variantsClose().catch(() => {}); };
  }, []);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const fit = () => setScale(Math.max(0.15, Math.min(1, (el.clientWidth - GAP * (shown.length + 1)) / (WIDTH * shown.length), (el.clientHeight - 70) / HEIGHT)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shown.length]);

  useScrollSync(frames, views);

  useEscape(onClose);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="compare-modal variants-live" onMouseDown={(e) => e.stopPropagation()}>
        <div className="diff-head">
          <h3><Layers size={15} /> Variants, live</h3>
          <span className="hint">Each one is running in its own copy of the project. Click around, scroll, then choose.{options.length > shown.length ? ` Showing the first ${shown.length}.` : ''}</span>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} title="Close and stop the previews (Esc)"><X size={16} /></button>
        </div>
        <div className="variants-live-body" ref={body}>
          {error ? <div className="ws-error">{error}</div>
            : !views ? <div className="diff-empty"><span><Loader2 className="spin" size={16} /> {progress}</span></div>
              : shown.map((o, i) => {
                const url = views.find((v) => v.runId === o.runId)?.url;
                return (
                  <figure key={o.runId} style={{ width: WIDTH * scale }} className={chosen === o.runId ? 'chosen' : ''}>
                    <figcaption>
                      <b>Variant {o.index}</b><small>{o.files} file{o.files > 1 ? 's' : ''}</small>
                      <div className="spacer" />
                      {chosen === o.runId
                        ? <span className="df-tag"><Check size={11} /> Applied</span>
                        : <button className="btn xs primary" disabled={busy} onClick={() => onPick(o.runId)}>Use this</button>}
                    </figcaption>
                    <div className="multi-box" style={{ width: WIDTH * scale, height: HEIGHT * scale }}>
                      {url
                        ? <div style={{ width: WIDTH, height: HEIGHT, transform: `scale(${scale})` }}><webview ref={(el) => { frames.current[i] = el as unknown as WebviewTag | null; }} src={url} partition="persist:pinpoint" className="webview" /></div>
                        : <div className="ws-error">Its dev server didn't start. The screenshot in the chat still shows this variant.</div>}
                    </div>
                  </figure>
                );
              })}
        </div>
      </div>
    </div>
  );
}
