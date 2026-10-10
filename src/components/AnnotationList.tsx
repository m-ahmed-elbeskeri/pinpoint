import { Blend, ClipboardCopy, PenTool, Square, X } from './icons';
import { describe } from '../lib/handoff';
import type { Annotation } from '../lib/types';

interface Props {
  annotations: Annotation[];
  root: string;
  activeId: string | null;
  overlayImage: string | null;
  pageMarks: number;
  sketchMarks: number;
  onFocus(a: Annotation): void;
  onActive(id: string): void;
  onNote(id: string, note: string): void;
  onPaste(e: React.ClipboardEvent): void;
  onSend(): void;
  onCopyTest(a: Annotation): void;
  onOverlay(a: Annotation): void;
  onRemove(id: string): void;
}

const PLACEHOLDER: Record<Annotation['kind'], string> = {
  element: 'What should change here?',
  flow: 'What goes wrong (or should change) when you do this?',
  sketch: 'What is this sketch? Where should it go?',
  reference: 'What should we take from this image?',
  drawing: 'Explain your drawing…',
  request: 'What is wrong with this request, or what should it return?',
};

export function AnnotationList(p: Props) {
  const pending = p.pageMarks + p.sketchMarks;
  if (!p.annotations.length && !pending) return null;
  return (
    <div className="ann-list">
      {p.annotations.map((a) => {
        const d = describe(a, p.root);
        return (
          <div key={a.id} className={`ann ${p.activeId === a.id ? 'active' : ''}`} onClick={() => p.onFocus(a)}>
            <div className="ann-thumb">
              {a.image ? <img src={a.image} alt="" /> : a.kind === 'request' ? <b className="ann-code">{a.request?.status || 'ERR'}</b> : <Square size={16} />}
              <span className="badge" style={{ background: a.color }}>{a.n}</span>
            </div>
            <div className="ann-body">
              <div className="ann-title"><span className="mono">{d.title}</span><span className="ann-sub">{d.sub}</span></div>
              <textarea
                data-note={a.id}
                rows={1}
                placeholder={PLACEHOLDER[a.kind]}
                onPaste={p.onPaste}
                value={a.note}
                onFocus={() => p.onActive(a.id)}
                onChange={(e) => p.onNote(a.id, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); p.onSend(); } }}
              />
            </div>
            {a.kind === 'flow' && (
              <button className="icon-btn xs ann-act" title="Copy these steps as a Playwright test" onClick={(e) => { e.stopPropagation(); p.onCopyTest(a); }}><ClipboardCopy size={13} /></button>
            )}
            {a.kind === 'reference' && a.image && (
              <button
                className={`icon-btn xs ann-act ${p.overlayImage === a.image ? 'on' : ''}`} title="Lay this image over the page to compare"
                onClick={(e) => { e.stopPropagation(); p.onOverlay(a); }}
              ><Blend size={13} /></button>
            )}
            <button className="icon-btn xs ann-x" onClick={(e) => { e.stopPropagation(); p.onRemove(a.id); }} title="Remove"><X size={13} /></button>
          </div>
        );
      })}
      {pending > 0 && (
        <div className="ann pending">
          <PenTool size={14} /> {p.pageMarks ? `${p.pageMarks} mark${p.pageMarks > 1 ? 's' : ''} on page` : ''}
          {p.pageMarks && p.sketchMarks ? ' · ' : ''}
          {p.sketchMarks ? `${p.sketchMarks} in sketch` : ''} will be attached
        </div>
      )}
    </div>
  );
}
