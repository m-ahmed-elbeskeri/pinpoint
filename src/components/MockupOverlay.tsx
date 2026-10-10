import { useRef } from 'react';
import { Move, RotateCcw, ScanEye, Wand2, X } from './icons';

export interface Overlay { image: string; name: string; opacity: number; x: number; y: number; moving: boolean }

interface Props {
  overlay: Overlay;
  onChange(next: Overlay): void;
  onDiff(): void;
  onMatch(): void;
  canMatch: boolean;
  onClose(): void;
}

export function MockupOverlay({ overlay, onChange, onDiff, onMatch, canMatch, onClose }: Props) {
  const start = useRef<{ px: number; py: number; x: number; y: number; k: number } | null>(null);

  const down = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    start.current = { px: e.clientX, py: e.clientY, x: overlay.x, y: overlay.y, k: el.getBoundingClientRect().width / el.offsetWidth || 1 };
  };
  const move = (e: React.PointerEvent) => {
    const s = start.current;
    if (s) onChange({ ...overlay, x: Math.round(s.x + (e.clientX - s.px) / s.k), y: Math.round(s.y + (e.clientY - s.py) / s.k) });
  };

  return (
    <>
      <img
        className={`mock-img ${overlay.moving ? 'moving' : ''}`}
        src={overlay.image} alt="" draggable={false}
        style={{ opacity: overlay.opacity, transform: `translate(${overlay.x}px, ${overlay.y}px)` }}
        onPointerDown={overlay.moving ? down : undefined}
        onPointerMove={overlay.moving ? move : undefined}
        onPointerUp={() => { start.current = null; }}
      />
      <div className="mock-bar">
        <span className="mock-name" title={overlay.name}>{overlay.name}</span>
        <input type="range" min={0} max={1} step={0.05} value={overlay.opacity} onChange={(e) => onChange({ ...overlay, opacity: +e.target.value })} title={`Opacity ${Math.round(overlay.opacity * 100)}%`} />
        <button className={`icon-btn xs ${overlay.moving ? 'on' : ''}`} onClick={() => onChange({ ...overlay, moving: !overlay.moving })} title="Drag the mockup to line it up (the page stops taking clicks while this is on)"><Move size={13} /></button>
        {(overlay.x !== 0 || overlay.y !== 0) && <button className="icon-btn xs" onClick={() => onChange({ ...overlay, x: 0, y: 0 })} title="Reset position"><RotateCcw size={12} /></button>}
        <button className="btn xs" onClick={onDiff} title="Compare the mockup with the page pixel by pixel"><ScanEye size={12} /> Diff</button>
        <button className="btn xs primary" disabled={!canMatch} onClick={onMatch} title="Ask the agent to make the page match this mockup. Pinpoint compares the result with the mockup and sends back what still differs, for up to 3 rounds."><Wand2 size={12} /> Match</button>
        <button className="icon-btn xs" onClick={onClose} title="Remove the overlay"><X size={13} /></button>
      </div>
    </>
  );
}

const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

export async function fitMockup(mockup: string, shot: string, offset: { x: number; y: number }, frameWidth: number): Promise<string> {
  const [m, s] = await Promise.all([load(mockup), load(shot)]);
  const c = document.createElement('canvas');
  c.width = s.width; c.height = s.height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  const k = s.width / (frameWidth || s.width);
  ctx.drawImage(m, offset.x * k, offset.y * k, s.width, m.height * (s.width / m.width));
  return c.toDataURL('image/jpeg', 0.9);
}
