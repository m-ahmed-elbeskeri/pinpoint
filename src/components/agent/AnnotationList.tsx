import { useState } from 'react';
import { Blend, ClipboardCopy, ImagePlus, PenTool, X } from '../ui/icons';
import { describe } from '../../lib/handoff';
import type { Annotation } from '../../types';

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
  editingId?: string | null;
}

const PLACEHOLDER: Record<Annotation['kind'], string> = {
  element: 'What should change here?',
  flow: 'What goes wrong (or should change) when you do this?',
  sketch: 'What is this sketch? Where should it go?',
  reference: 'What should we take from this image?',
  drawing: 'Explain your drawing…',
  request: 'What is wrong with this request, or what should it return?',
  note: 'The comment',
};

export function ImageChips({ annotations, overlayImage, onOverlay, onRemove, onActive }: { annotations: Annotation[]; overlayImage: string | null; onOverlay(a: Annotation): void; onRemove(id: string): void; onActive(id: string): void }) {
  const [open, setOpen] = useState<string | null>(null);
  const refs = annotations.filter((a) => a.kind === 'reference' && a.image);
  if (!refs.length) return null;
  const shown = refs.find((a) => a.id === open);
  return (
    <>
      <div className="img-chips">
        {refs.map((a) => (
          <span key={a.id} className={`img-chip ${open === a.id ? 'on' : ''}`}>
            <button onClick={() => { setOpen(open === a.id ? null : a.id); onActive(a.id); }} title={a.note || a.name || 'Reference image'}>
              <img src={a.image} alt="" /><span className="badge sm" style={{ background: a.color }}>{a.n}</span><span className="img-chip-name">{a.name || 'image'}</span>
            </button>
            <button onClick={() => onOverlay(a)} className={overlayImage === a.image ? 'on' : ''} title="Lay this image over the page to compare"><Blend size={11} /></button>
            <button onClick={() => onRemove(a.id)} title="Remove"><X size={11} /></button>
          </span>
        ))}
      </div>
      {shown && <img className="img-chip-full" src={shown.image} alt="" onClick={() => setOpen(null)} />}
    </>
  );
}

export function AnnotationList(p: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const pending = p.pageMarks + p.sketchMarks;
  // Reference images show as chips inside the composer instead (ImageChips).
  const rows = p.annotations.filter((a) => a.kind !== 'reference');
  if (!rows.length && !pending) return null;
  return (
    <div className="ann-list">
      {rows.map((a) => {
        const d = describe(a, p.root);
        return (
          <div key={a.id} className={`ann compact ${p.activeId === a.id ? 'active' : ''} ${open === a.id ? 'expanded' : ''}`} onClick={() => p.onFocus(a)}>
            <div className="ann-body">
              <div className="ann-title">
                <span className="badge sm" style={{ background: a.color }}>{a.n}</span>
                <span className="mono">{d.title}</span>
                <span className="ann-sub">{a.kind === 'request' ? `${a.request?.status || 'ERR'} · ` : ''}{d.sub}</span>
                {a.image && (
                  <button className={`icon-btn xs ann-img ${open === a.id ? 'on' : ''}`} title={open === a.id ? 'Hide the image' : 'Show the image'} onClick={(e) => { e.stopPropagation(); setOpen(open === a.id ? null : a.id); }}>
                    <ImagePlus size={13} />
                  </button>
                )}
              </div>
              {a.image && <div className="ann-thumb"><img src={a.image} alt="" /></div>}
              {p.editingId === a.id ? <div className="ann-note-ro">{a.note || 'Writing the note on the page…'}</div> : <textarea
                data-note={a.id}
                rows={1}
                placeholder={PLACEHOLDER[a.kind]}
                onPaste={p.onPaste}
                value={a.note}
                onFocus={() => p.onActive(a.id)}
                onChange={(e) => p.onNote(a.id, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); p.onSend(); } }}
              />}
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
