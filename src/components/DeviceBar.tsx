import { Hand, RotateCw, X } from 'lucide-react';

// Responsive mode: the page is shown at an exact size, scaled to fit the stage.
export interface Device { on: boolean; w: number; h: number; zoom: 'fit' | number; touch: boolean } // h 0 = fill the height
export interface Breakpoint { px: number; kind: 'min' | 'max'; uses: number }

export const DEVICE_OFF: Device = { on: false, w: 0, h: 0, zoom: 'fit', touch: false };
export const PRESETS: { name: string; w: number; h: number }[] = [
  { name: 'iPhone SE', w: 375, h: 667 },
  { name: 'iPhone 15', w: 393, h: 852 },
  { name: 'Pixel 8', w: 412, h: 915 },
  { name: 'Galaxy S20', w: 360, h: 800 },
  { name: 'iPad Mini', w: 768, h: 1024 },
  { name: 'iPad Air', w: 820, h: 1180 },
  { name: 'iPad Pro 12.9', w: 1024, h: 1366 },
  { name: 'Laptop', w: 1280, h: 800 },
  { name: 'Desktop', w: 1440, h: 900 },
  { name: 'Full HD', w: 1920, h: 1080 },
];
const ZOOMS = [0.5, 0.75, 1, 1.25];
const clamp = (n: number) => Math.min(3840, Math.max(240, Math.round(n) || 0));

interface Props {
  device: Device;
  set(next: Device): void;
  scale: number;         // the zoom actually applied (what "fit" worked out to)
  height: number;        // the height actually shown, for when it fills the stage
  breakpoints: Breakpoint[];
}

// Runs in the page: the widths its CSS switches layout at, most used first.
function collect() {
  const seen = new Map<string, { px: number; kind: 'min' | 'max'; uses: number }>();
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const visit = (rules: CSSRuleList, depth: number) => {
    for (const rule of [...rules]) {
      const media = (rule as CSSMediaRule).media?.mediaText;
      if (media && rule.constructor.name === 'CSSMediaRule') {
        // Both "(min-width: 768px)" and range syntax "(width >= 48rem)".
        for (const m of media.matchAll(/(min|max)-width:\s*([\d.]+)(px|em|rem)|width\s*(>=|<=|>|<)\s*([\d.]+)(px|em|rem)/g)) {
          const kind = m[1] ? (m[1] as 'min' | 'max') : m[4].startsWith('>') ? 'min' : 'max';
          const px = Math.round(parseFloat(m[2] || m[5]) * ((m[3] || m[6]) === 'px' ? 1 : rootPx));
          if (px < 200 || px > 4000) continue;
          const k = `${kind}${px}`;
          const hit = seen.get(k);
          if (hit) hit.uses++; else seen.set(k, { px, kind, uses: 1 });
        }
      }
      const nested = (rule as CSSGroupingRule).cssRules;
      if (nested && depth < 4) visit(nested, depth + 1);
    }
  };
  for (const sheet of [...document.styleSheets]) {
    try { visit(sheet.cssRules, 0); } catch { /* cross-origin sheet */ }
  }
  return [...seen.values()].sort((a, b) => b.uses - a.uses).slice(0, 8).sort((a, b) => a.px - b.px);
}
export const breakpointsScript = `(${collect.toString()})()`;

export function DeviceBar({ device, set, scale, height, breakpoints }: Props) {
  const preset = PRESETS.find((p) => (p.w === device.w && p.h === device.h) || (p.w === device.h && p.h === device.w));
  // A width that sits just inside a breakpoint: on it for min-width, at it for max-width.
  const active = (b: Breakpoint) => (b.kind === 'min' ? device.w >= b.px : device.w <= b.px);

  return (
    <div className="device-bar">
      <select
        value={preset?.name || ''} title="Device size"
        onChange={(e) => { const p = PRESETS.find((x) => x.name === e.target.value); set(p ? { ...device, w: p.w, h: p.h } : { ...device, h: 0 }); }}
      >
        <option value="">Responsive</option>
        {PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name} · {p.w}×{p.h}</option>)}
      </select>

      <div className="device-dims">
        <input type="number" value={device.w} min={240} max={3840} title="Width (CSS px)" onChange={(e) => set({ ...device, w: clamp(+e.target.value) })} />
        <span>×</span>
        <input type="number" value={device.h || Math.round(height)} min={240} max={3840} title="Height (CSS px)" className={device.h ? '' : 'auto'} onChange={(e) => set({ ...device, h: clamp(+e.target.value) })} />
      </div>
      <button className="icon-btn xs" onClick={() => set({ ...device, w: device.h || Math.round(height), h: device.w })} title="Rotate"><RotateCw size={13} /></button>
      <button className={`icon-btn xs ${device.touch ? 'on' : ''}`} onClick={() => set({ ...device, touch: !device.touch })} title="Touch device: taps instead of clicks, no hover, coarse pointer. Applies while browsing; picking and drawing still use the mouse."><Hand size={13} /></button>

      <select value={String(device.zoom)} title="Zoom" onChange={(e) => set({ ...device, zoom: e.target.value === 'fit' ? 'fit' : +e.target.value })}>
        <option value="fit">Fit ({Math.round(scale * 100)}%)</option>
        {ZOOMS.map((z) => <option key={z} value={z}>{z * 100}%</option>)}
      </select>

      {breakpoints.length > 0 && (
        <div className="device-bps" title="Widths where this page's CSS changes layout. Click one to jump just past it.">
          {breakpoints.map((b) => (
            <button key={b.kind + b.px} className={`chip mono ${active(b) ? 'on' : ''}`} onClick={() => set({ ...device, w: b.px })} title={`@media (${b.kind}-width: ${b.px}px), used ${b.uses}×`}>
              {b.kind === 'min' ? '≥' : '≤'}{b.px}
            </button>
          ))}
        </div>
      )}

      <div className="spacer" />
      <button className="icon-btn xs" onClick={() => set(DEVICE_OFF)} title="Leave responsive mode"><X size={13} /></button>
    </div>
  );
}
