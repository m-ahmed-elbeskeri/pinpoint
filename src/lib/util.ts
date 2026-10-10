// Odds and ends with no better home.
import type { Rect } from './types';

export const errText = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// Reads an image file, shrinking big ones so requests stay light.
export function readImage(file: File, maxEdge = 1800): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const s = Math.min(1, maxEdge / Math.max(img.width, img.height));
        if (s === 1 && file.size < 1.5e6) return resolve(fr.result as string);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL(file.type === 'image/png' && file.size < 4e6 ? 'image/png' : 'image/jpeg', 0.9));
      };
      img.src = fr.result as string;
    };
    fr.readAsDataURL(file);
  });
}

export const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '');

export function clampRect(r: Rect, vp: { width: number; height: number }): Rect {
  const x = Math.max(0, r.x), y = Math.max(0, r.y);
  return { x, y, width: Math.max(0, Math.min(vp.width, r.x + r.width) - x), height: Math.max(0, Math.min(vp.height, r.y + r.height) - y) };
}
