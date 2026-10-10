type Overlay = { url: string; pct: number };
type Reply = { id: number; result?: unknown; error?: string };

let worker: Worker | null | undefined;
let seq = 0;
const jobs = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();

function drop(reason: string) {
  worker = null;
  for (const job of jobs.values()) job.reject(new Error(reason));
  jobs.clear();
}

function ask<T>(kind: 'same' | 'overlay', before: string, after: string): Promise<T> {
  if (worker === undefined) {
    try {
      worker = new Worker(new URL('./pixeldiff.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<Reply>) => {
        const job = jobs.get(e.data.id);
        if (!job) return;
        jobs.delete(e.data.id);
        if (e.data.error) job.reject(new Error(e.data.error)); else job.resolve(e.data.result);
      };
      worker.onerror = () => drop('worker failed');
    } catch { worker = null; }
  }
  if (!worker) return Promise.reject(new Error('no worker'));
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    jobs.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker!.postMessage({ id, kind, before, after });
  });
}

const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

function pixels(img: HTMLImageElement, w: number, h: number) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, ctx, image: ctx.getImageData(0, 0, w, h) };
}

async function overlayHere(before: string, after: string): Promise<Overlay> {
  const [a, b] = await Promise.all([load(before), load(after)]);
  const w = b.width, h = b.height;
  const da = pixels(a, w, h).image.data;
  const sb = pixels(b, w, h);
  const px = sb.image.data;
  let changed = 0;
  for (let i = 0; i < px.length; i += 4) {
    const d = Math.abs(px[i] - da[i]) + Math.abs(px[i + 1] - da[i + 1]) + Math.abs(px[i + 2] - da[i + 2]);
    if (d > 60) { changed++; px[i] = 255; px[i + 1] = Math.round(px[i + 1] * .25 + 50); px[i + 2] = 40; }
    else { const g = (px[i] + px[i + 1] + px[i + 2]) / 3; px[i] = px[i + 1] = px[i + 2] = g * .45 + 120; }
  }
  sb.ctx.putImageData(sb.image, 0, 0);
  return { url: sb.canvas.toDataURL('image/jpeg', .85), pct: (changed / (w * h)) * 100 };
}

async function sameHere(before: string, after: string): Promise<boolean> {
  const [a, b] = await Promise.all([load(before), load(after)]);
  const w = b.width, h = b.height;
  const limit = w * h * 0.0001;
  const da = pixels(a, w, h).image.data, db = pixels(b, w, h).image.data;
  let changed = 0;
  for (let i = 0; i < db.length; i += 4) {
    if (Math.abs(db[i] - da[i]) + Math.abs(db[i + 1] - da[i + 1]) + Math.abs(db[i + 2] - da[i + 2]) > 60 && ++changed >= limit) return false;
  }
  return true;
}

export const diffOverlay = (before: string, after: string): Promise<Overlay> => ask<Overlay>('overlay', before, after).catch(() => overlayHere(before, after));
export const looksSame = (before: string, after: string): Promise<boolean> => ask<boolean>('same', before, after).catch(() => sameHere(before, after));
