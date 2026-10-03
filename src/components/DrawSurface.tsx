import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Shape, Tool } from '../lib/types';
import { drawShape, hitShape, renderShapes, uid } from '../lib/draw';

interface Props {
  shapes: Shape[];
  onChange(shapes: Shape[]): void;
  tool: Tool;
  color: string;
  size: number;
  board?: boolean; // whiteboard background (sketch mode)
}

// A full-bleed canvas for freehand markup. Coordinates are CSS pixels of the
// surface, which sits exactly on top of the webview (or is the whiteboard).
export function DrawSurface({ shapes, onChange, tool, color, size, board }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<Shape | null>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [textAt, setTextAt] = useState<{ x: number; y: number; value: string } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setDims({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);

  const paint = () => {
    const c = canvas.current;
    if (!c) return;
    const dpr = devicePixelRatio;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dims.w, dims.h);
    renderShapes(ctx, shapes);
    if (live.current) drawShape(ctx, live.current);
  };

  useEffect(() => {
    const c = canvas.current!;
    c.width = Math.round(dims.w * devicePixelRatio);
    c.height = Math.round(dims.h * devicePixelRatio);
    paint();
  }, [dims]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(paint, [shapes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (textAt) setTimeout(() => textRef.current?.focus(), 0); }, [textAt]);

  const pos = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    const k = r.width / canvas.current!.offsetWidth || 1; // the stage may be zoomed in responsive mode
    return [Math.round((e.clientX - r.left) / k), Math.round((e.clientY - r.top) / k)];
  };

  const commitText = () => {
    if (textAt?.value.trim()) {
      onChange([...shapes, { id: uid(), tool: 'text', color, size, points: [[textAt.x, textAt.y]], text: textAt.value.trim() }]);
    }
    setTextAt(null);
  };

  const erasing = useRef(false);
  const eraseAt = (p: [number, number]) => {
    const hit = [...shapes].reverse().find((s) => hitShape(s, p[0], p[1]));
    if (hit) onChange(shapes.filter((s) => s !== hit));
  };

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = pos(e);
    if (tool === 'text') {
      // An open input commits on blur; this click only closes it.
      if (!textAt) setTextAt({ x: p[0], y: p[1] - 4, value: '' });
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (tool === 'eraser') { erasing.current = true; eraseAt(p); return; }
    live.current = { id: uid(), tool, color, size, points: [p, p] };
    paint();
  };

  const move = (e: React.PointerEvent) => {
    if (erasing.current) { eraseAt(pos(e)); return; }
    const s = live.current;
    if (!s) return;
    const p = pos(e);
    if (s.tool === 'pen' || s.tool === 'highlighter') {
      const last = s.points[s.points.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 1.5) s.points.push(p);
    } else {
      // Shift constrains shapes to squares/circles and arrows to 45° steps.
      let q = p;
      if (e.shiftKey) {
        const [a] = s.points;
        const dx = p[0] - a[0], dy = p[1] - a[1];
        if (s.tool === 'arrow') {
          const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(dx, dy);
          q = [Math.round(a[0] + len * Math.cos(ang)), Math.round(a[1] + len * Math.sin(ang))];
        } else {
          const m = Math.max(Math.abs(dx), Math.abs(dy));
          q = [a[0] + Math.sign(dx) * m, a[1] + Math.sign(dy) * m];
        }
      }
      s.points = [s.points[0], q];
    }
    paint();
  };

  const up = () => {
    erasing.current = false;
    const s = live.current;
    live.current = null;
    if (!s) return;
    const [a, b] = [s.points[0], s.points[s.points.length - 1]];
    const tiny = s.tool !== 'pen' && s.tool !== 'highlighter' && Math.hypot(b[0] - a[0], b[1] - a[1]) < 4;
    if (tiny) { paint(); return; }
    onChange([...shapes, s]);
  };

  const cursor = tool === 'text' ? 'text' : tool === 'eraser' ? 'cell' : 'crosshair';

  return (
    <div ref={wrap} className={`draw-surface ${board ? 'board' : ''}`} style={{ cursor }}>
      <canvas
        ref={canvas}
        style={{ width: dims.w, height: dims.h }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      {textAt && (
        <textarea
          ref={textRef}
          className="draw-text-input"
          style={{ left: textAt.x, top: textAt.y, color, fontSize: 12 + size * 3 }}
          value={textAt.value}
          placeholder="Type a note…"
          rows={Math.max(1, textAt.value.split('\n').length)}
          onChange={(e) => setTextAt({ ...textAt, value: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
            if (e.key === 'Escape') setTextAt(null);
          }}
          onBlur={commitText}
        />
      )}
    </div>
  );
}
