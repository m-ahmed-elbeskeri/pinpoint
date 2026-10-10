import type { Rect, Shape } from './types';

export const COLORS = ['#ff4f3a', '#ffd60a', '#2f7bff', '#12b76a', '#ff8a00', '#111318', '#ffffff'];
export const ANNOTATION_COLORS = ['#ff4f3a', '#2f7bff', '#12b76a', '#ff8a00', '#111318', '#e0368a', '#0fb5c9'];

export const uid = () => Math.random().toString(36).slice(2, 10);

const fontFor = (size: number) => `600 ${Math.round(12 + size * 3)}px Inter, ui-sans-serif, system-ui, sans-serif`;

function smoothPath(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  if (pts.length < 3) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1] + 0.1);
    return;
  }
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
}

export function drawShape(ctx: CanvasRenderingContext2D, s: Shape) {
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s.size;
  const [a, b] = [s.points[0], s.points[s.points.length - 1]];

  switch (s.tool) {
    case 'pen':
      ctx.beginPath(); smoothPath(ctx, s.points); ctx.stroke();
      break;
    case 'highlighter':
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = s.size * 4;
      ctx.lineCap = 'butt';
      ctx.beginPath(); smoothPath(ctx, s.points); ctx.stroke();
      break;
    case 'rect': {
      ctx.beginPath();
      const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
      ctx.roundRect(x, y, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 6);
      ctx.stroke();
      break;
    }
    case 'ellipse': {
      ctx.beginPath();
      ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'arrow': {
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const head = 10 + s.size * 2.5;
      ctx.beginPath();
      ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - head * Math.cos(ang - 0.45), b[1] - head * Math.sin(ang - 0.45));
      ctx.lineTo(b[0] - head * Math.cos(ang + 0.45), b[1] - head * Math.sin(ang + 0.45));
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'text': {
      if (!s.text) break;
      ctx.font = fontFor(s.size);
      ctx.textBaseline = 'top';
      const lh = 14 + s.size * 3.6;
      s.text.split('\n').forEach((line, i) => {
        ctx.lineWidth = 4;
        ctx.strokeStyle = isLight(s.color) ? 'rgba(0,0,0,.7)' : 'rgba(255,255,255,.9)';
        ctx.strokeText(line, a[0], a[1] + i * lh);
        ctx.fillText(line, a[0], a[1] + i * lh);
      });
      break;
    }
  }
  ctx.restore();
}

function isLight(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return r * 0.299 + g * 0.587 + b * 0.114 > 186;
}

export function renderShapes(ctx: CanvasRenderingContext2D, shapes: Shape[]) {
  for (const s of shapes) drawShape(ctx, s);
}

export function shapeBounds(s: Shape): Rect {
  if (s.tool === 'text') {
    const lines = (s.text || '').split('\n');
    const w = Math.max(...lines.map((l) => l.length)) * (7 + s.size * 1.9);
    const h = lines.length * (14 + s.size * 3.6);
    return { x: s.points[0][0], y: s.points[0][1], width: w, height: h };
  }
  const xs = s.points.map((p) => p[0]);
  const ys = s.points.map((p) => p[1]);
  const pad = s.tool === 'highlighter' ? s.size * 2 : s.size;
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
  return { x, y, width: Math.max(...xs) - x + pad, height: Math.max(...ys) - y + pad };
}

export function unionBounds(shapes: Shape[]): Rect | null {
  if (!shapes.length) return null;
  const bs = shapes.map(shapeBounds);
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  const r = Math.max(...bs.map((b) => b.x + b.width)), btm = Math.max(...bs.map((b) => b.y + b.height));
  return { x: Math.round(x), y: Math.round(y), width: Math.round(r - x), height: Math.round(btm - y) };
}

export function samplePoints(shapes: Shape[]): [number, number][] {
  const out: [number, number][] = [];
  for (const s of shapes) {
    const [a, b] = [s.points[0], s.points[s.points.length - 1]];
    if (s.tool === 'pen' || s.tool === 'highlighter') {
      const step = Math.max(1, Math.floor(s.points.length / 12));
      for (let i = 0; i < s.points.length; i += step) out.push(s.points[i]);
    } else if (s.tool === 'arrow') {
      out.push(b, a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    } else if (s.tool === 'rect' || s.tool === 'ellipse') {
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      const w = Math.abs(b[0] - a[0]) / 4, h = Math.abs(b[1] - a[1]) / 4;
      out.push([cx, cy], [cx - w, cy - h], [cx + w, cy - h], [cx - w, cy + h], [cx + w, cy + h]);
    } else if (s.tool === 'text') {
      const bb = shapeBounds(s);
      out.push([bb.x + bb.width / 2, bb.y + bb.height / 2]);
    }
  }
  return out;
}

export function hitShape(s: Shape, x: number, y: number, tol = 8): boolean {
  const b = shapeBounds(s);
  if (x < b.x - tol || y < b.y - tol || x > b.x + b.width + tol || y > b.y + b.height + tol) return false;
  if (s.tool === 'pen' || s.tool === 'highlighter') {
    return s.points.some((p) => Math.hypot(p[0] - x, p[1] - y) < tol + s.size);
  }
  return true;
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = rej;
  img.src = src;
});

export async function composite(opts: { background: string | null; width: number; height: number; shapes: Shape[]; board?: boolean }) {
  const bg = opts.background ? await loadImage(opts.background) : null;
  const scale = bg ? bg.width / opts.width : 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(opts.width * scale);
  canvas.height = Math.round(opts.height * scale);
  const ctx = canvas.getContext('2d')!;
  if (bg) ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
  else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.scale(scale, scale);
  renderShapes(ctx, opts.shapes);
  return canvas.toDataURL('image/png');
}

export async function thumbnail(src: string, maxW = 320) {
  const img = await loadImage(src);
  const s = Math.min(1, maxW / img.width);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}
