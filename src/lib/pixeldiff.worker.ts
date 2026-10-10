type Job = { id: number; kind: 'same' | 'overlay'; before: string; after: string };

async function decode(dataUrl: string): Promise<ImageBitmap> {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  if (!meta.startsWith('data:') || !meta.includes(';base64')) throw new Error('not a base64 data URL');
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return createImageBitmap(new Blob([bytes], { type: meta.slice(5).split(';')[0] }));
}

function surface(img: ImageBitmap, w: number, h: number) {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, ctx, image: ctx.getImageData(0, 0, w, h) };
}

async function run(job: Job) {
  const [a, b] = await Promise.all([decode(job.before), decode(job.after)]);
  const w = b.width, h = b.height;
  const da = surface(a, w, h).image.data;
  const sb = surface(b, w, h);
  const px = sb.image.data;
  if (job.kind === 'same') {
    const limit = w * h * 0.0001;
    let changed = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (Math.abs(px[i] - da[i]) + Math.abs(px[i + 1] - da[i + 1]) + Math.abs(px[i + 2] - da[i + 2]) > 60 && ++changed >= limit) return false;
    }
    return true;
  }
  let changed = 0;
  for (let i = 0; i < px.length; i += 4) {
    const d = Math.abs(px[i] - da[i]) + Math.abs(px[i + 1] - da[i + 1]) + Math.abs(px[i + 2] - da[i + 2]);
    if (d > 60) { changed++; px[i] = 255; px[i + 1] = Math.round(px[i + 1] * .25 + 50); px[i + 2] = 40; }
    else { const g = (px[i] + px[i + 1] + px[i + 2]) / 3; px[i] = px[i + 1] = px[i + 2] = g * .45 + 120; }
  }
  sb.ctx.putImageData(sb.image, 0, 0);
  const blob = await sb.canvas.convertToBlob({ type: 'image/jpeg', quality: .85 });
  const url = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
  return { url, pct: (changed / (w * h)) * 100 };
}

self.onmessage = (e: MessageEvent<Job>) => {
  run(e.data).then(
    (result) => self.postMessage({ id: e.data.id, result }),
    (err) => self.postMessage({ id: e.data.id, error: String(err) }),
  );
};
