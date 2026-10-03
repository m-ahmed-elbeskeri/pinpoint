// Runs in the page (via webview.executeJavaScript). For a picked element, works
// out which CSS custom properties (design tokens) its computed colors, spacing,
// radius and type size come from, so the agent edits with tokens, not raw values.
// Returns { 'background-color': '--primary', 'border-radius': '--radius-md', … }.
function matchTokens(uid: string) {
  const el = document.querySelector(`[data-pinpoint="${uid}"]`);
  if (!el) return null;

  // Every custom property declared anywhere in the page's own stylesheets.
  const names = new Set<string>();
  const visit = (rules: CSSRuleList, depth: number) => {
    for (const rule of [...rules]) {
      if (names.size >= 900) return;
      const style = (rule as CSSStyleRule).style;
      if (style) for (const prop of [...style]) if (prop.startsWith('--')) names.add(prop);
      const nested = (rule as CSSGroupingRule).cssRules;
      if (nested && depth < 4) visit(nested, depth + 1);
    }
  };
  for (const sheet of [...document.styleSheets]) {
    try { visit(sheet.cssRules, 0); } catch { /* cross-origin sheet */ }
  }
  if (!names.size) return null;

  const cs = getComputedStyle(el);
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.documentElement.appendChild(probe);
  // The browser's own normal form for a color, or null when the value isn't one.
  const color = (v: string) => {
    for (const candidate of [v, `hsl(${v})`, `rgb(${v})`]) { // "222 47% 11%"-style tokens hold only the channels
      if (!CSS.supports('color', candidate)) continue;
      probe.style.color = candidate;
      return getComputedStyle(probe).color;
    }
    return null;
  };

  const colors = new Map<string, string[]>();
  const lengths = new Map<number, string[]>();
  const add = <K,>(m: Map<K, string[]>, k: K, name: string) => { const l = m.get(k); if (l) l.push(name); else m.set(k, [name]); };
  for (const name of names) {
    const v = cs.getPropertyValue(name).trim(); // resolved where the element is, so scoped themes count
    if (!v || v.length > 80) continue;
    const len = v.match(/^(-?\d*\.?\d+)(px|rem)$/);
    if (len) { add(lengths, Math.round(parseFloat(len[1]) * (len[2] === 'rem' ? rootPx : 1) * 100) / 100, name); continue; }
    const c = color(v);
    if (c && c !== 'rgba(0, 0, 0, 0)') add(colors, c, name);
  }
  probe.remove();

  const out: Record<string, string> = {};
  const shortest = (l: string[]) => [...l].sort((a, b) => a.length - b.length)[0];
  for (const prop of ['color', 'background-color', 'border-top-color']) {
    const hit = colors.get(cs.getPropertyValue(prop));
    if (hit && (prop !== 'border-top-color' || parseFloat(cs.borderTopWidth) > 0)) out[prop === 'border-top-color' ? 'border-color' : prop] = shortest(hit);
  }
  // Lengths collide (16px is a space, a radius and a font size), so the token's name has to fit the property.
  const kinds: [string, string, RegExp][] = [
    ['font-size', 'font-size', /text|font|size|fs/i],
    ['border-top-left-radius', 'border-radius', /radius|round|corner/i],
    ['padding-top', 'padding', /spac|pad|gap|size|inset/i],
    ['padding-left', 'padding-inline', /spac|pad|gap|size|inset/i],
    ['margin-top', 'margin', /spac|margin|gap|size/i],
    ['row-gap', 'gap', /spac|gap|size/i],
  ];
  for (const [prop, label, fits] of kinds) {
    const px = parseFloat(cs.getPropertyValue(prop));
    if (!px) continue;
    const hit = (lengths.get(Math.round(px * 100) / 100) || []).filter((n) => fits.test(n));
    if (hit.length && !(label === 'padding-inline' && out.padding === shortest(hit))) out[label] = shortest(hit);
  }
  return Object.keys(out).length ? out : null;
}

export const tokenMatchScript = (uid: string) => `(${matchTokens.toString()})(${JSON.stringify(uid)})`;
