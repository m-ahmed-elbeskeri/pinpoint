// Design quality: reads the rendered page for the signs of a design that has drifted from its system
// (too many sizes, colors that aren't tokens, spacing off the scale) and the tells of generic AI-made UI.
// Runs in the page, like the scripts in pagetools.ts.

export interface DesignIssue {
  id: string;
  level: 'warn' | 'info';
  text: string;
  examples: { label: string; selector: string }[];
}

function designCheck(tokenValues: string[]): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const selectorFor = (el: Element) => {
    const parts: string[] = [];
    for (let e: Element | null = el; e && e !== document.body && parts.length < 8; e = e.parentElement) {
      if (e.id && /^[A-Za-z][\w-]*$/.test(e.id)) { parts.unshift('#' + e.id); break; }
      const same = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e!.tagName) : [];
      parts.unshift(e.tagName.toLowerCase() + (same.length > 1 ? `:nth-of-type(${same.indexOf(e) + 1})` : ''));
    }
    return parts.join(' > ');
  };
  const label = (el: Element, extra = '') => {
    const t = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
    return `${el.tagName.toLowerCase()}${t ? ` "${t.length > 28 ? t.slice(0, 28) + '…' : t}"` : ''}${extra ? ` (${extra})` : ''}`;
  };
  const ex = (el: Element, extra = '') => ({ label: label(el, extra), selector: selectorFor(el) });

  const shown = [...document.body.querySelectorAll('*')].filter((el) => {
    if (el.closest('[data-pinpoint-ui],svg,script,style,noscript,template')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }).slice(0, 3000);
  const styles = new Map(shown.map((el) => [el, getComputedStyle(el)]));
  const hasText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 1);
  const texts = shown.filter(hasText);

  // Colors, resolved through a probe element so tokens written as hex, hsl or oklch compare as rgb.
  const probe = document.createElement('i');
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const rgb = (v: string): number[] | null => {
    probe.style.color = '';
    probe.style.color = v;
    if (!probe.style.color) return null;
    const m = getComputedStyle(probe).color.match(/[\d.]+/g);
    return m && m.length >= 3 ? m.slice(0, 4).map(Number) : null;
  };
  const rootVars: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of [...rules]) {
      const st = (r as CSSStyleRule).style;
      if (!st || !/:root|html|\[data-theme/.test((r as CSSStyleRule).selectorText || '')) continue;
      for (let i = 0; i < st.length; i++) if (st[i].startsWith('--')) rootVars.push(st.getPropertyValue(st[i]).trim());
    }
  }
  const palette = [...tokenValues, ...rootVars].map(rgb).filter((c): c is number[] => !!c && (c[3] ?? 1) > 0);
  probe.remove();
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const parse = (v: string) => { const m = v.match(/[\d.]+/g); return m && m.length >= 3 ? m.slice(0, 4).map(Number) : null; };
  const colorUse = new Map<string, { c: number[]; els: Element[] }>();
  for (const [el, cs] of styles) {
    for (const v of [hasText(el) ? cs.color : '', cs.backgroundColor, cs.borderTopWidth !== '0px' ? cs.borderTopColor : '']) {
      const c = v && parse(v);
      if (!c || (c[3] ?? 1) === 0) continue;
      const key = c.slice(0, 3).join(',');
      const u = colorUse.get(key) || { c, els: [] };
      u.els.push(el);
      colorUse.set(key, u);
    }
  }
  const neutral = (c: number[]) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) < 8 && (c[0] < 12 || c[0] > 245);
  if (palette.length >= 4) {
    const off = [...colorUse.values()].filter((u) => !neutral(u.c) && !palette.some((p) => dist(p, u.c) < 6)).sort((a, b) => b.els.length - a.els.length);
    if (off.length) issues.push({ id: 'off-token-color', level: 'warn', text: `${off.length} color${off.length > 1 ? 's are' : ' is'} not one of the project's ${palette.length} color tokens`, examples: off.slice(0, 4).map((u) => ex(u.els[0], `rgb(${u.c.slice(0, 3).join(', ')}), ${u.els.length} use${u.els.length > 1 ? 's' : ''}`)) });
  } else {
    const list = [...colorUse.values()];
    const near: { a: typeof list[0]; b: typeof list[0] }[] = [];
    for (let i = 0; i < list.length && near.length < 6; i++) for (let j = i + 1; j < list.length; j++) {
      const d = dist(list[i].c, list[j].c);
      if (d > 0 && d < 10) { near.push({ a: list[i], b: list[j] }); break; }
    }
    if (near.length) issues.push({ id: 'near-colors', level: 'warn', text: `${near.length} pair${near.length > 1 ? 's' : ''} of colors are almost the same but not quite, usually one color typed two ways`, examples: near.slice(0, 4).map((n) => ex(n.b.els[0], `rgb(${n.a.c.slice(0, 3).join(', ')}) vs rgb(${n.b.c.slice(0, 3).join(', ')})`)) });
    if (colorUse.size > 24) issues.push({ id: 'many-colors', level: 'info', text: `${colorUse.size} different colors on one page; a palette is usually far smaller`, examples: [] });
  }

  // Type: how many sizes and families.
  const sizes = new Map<string, Element[]>();
  const families = new Map<string, Element[]>();
  for (const el of texts) {
    const cs = styles.get(el)!;
    sizes.set(cs.fontSize, [...(sizes.get(cs.fontSize) || []), el]);
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    families.set(fam, [...(families.get(fam) || []), el]);
  }
  if (sizes.size > 8) {
    const rare = [...sizes].filter(([, els]) => els.length <= 2).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
    issues.push({ id: 'type-scale', level: 'warn', text: `${sizes.size} different font sizes (${[...sizes.keys()].map(parseFloat).sort((a, b) => a - b).join(', ')} px); a type scale usually has 5 to 7`, examples: rare.slice(0, 4).map(([s, els]) => ex(els[0], s)) });
  }
  if (families.size > 3) issues.push({ id: 'font-families', level: 'warn', text: `${families.size} font families: ${[...families.keys()].join(', ')}`, examples: [...families].slice(3, 6).map(([f, els]) => ex(els[0], f)) });

  // Spacing on a 4px grid, and a handful of radii and shadows.
  const offGrid: { el: Element; v: string }[] = [];
  const radii = new Map<string, Element>(), shadows = new Map<string, Element>();
  for (const [el, cs] of styles) {
    // Unstyled form controls keep the browser's own small padding; that isn't the project's spacing.
    const control = /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
    for (const prop of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'rowGap', 'columnGap'] as const) {
      const n = parseFloat(cs[prop]);
      if (n > (control ? 7 : 3) && Math.abs(n - Math.round(n / 4) * 4) > 0.6 && offGrid.length < 60) { offGrid.push({ el, v: `${prop.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}: ${cs[prop]}` }); break; }
    }
    if (cs.borderTopLeftRadius !== '0px' && !cs.borderTopLeftRadius.includes('%') && parseFloat(cs.borderTopLeftRadius) < 100) radii.set(cs.borderTopLeftRadius, radii.get(cs.borderTopLeftRadius) || el);
    if (cs.boxShadow !== 'none') shadows.set(cs.boxShadow, shadows.get(cs.boxShadow) || el);
  }
  if (offGrid.length >= 3) issues.push({ id: 'spacing', level: 'warn', text: `${offGrid.length}${offGrid.length >= 60 ? '+' : ''} elements use spacing off the 4px grid`, examples: offGrid.slice(0, 4).map((o) => ex(o.el, o.v)) });
  if (radii.size > 5) issues.push({ id: 'radius', level: 'info', text: `${radii.size} different corner radii (${[...radii.keys()].join(', ')})`, examples: [...radii].slice(0, 3).map(([r, el]) => ex(el, r)) });
  if (shadows.size > 4) issues.push({ id: 'shadows', level: 'info', text: `${shadows.size} different shadows; two or three elevation levels are usually enough`, examples: [...shadows].slice(0, 3).map(([, el]) => ex(el)) });

  // Hierarchy and reading.
  const h1 = [...document.querySelectorAll('h1')].filter((h) => styles.has(h));
  if (h1.length > 1) issues.push({ id: 'h1', level: 'info', text: `${h1.length} top-level headings (h1) on one page`, examples: h1.slice(0, 3).map((h) => ex(h)) });
  const levels = [1, 2, 3, 4].map((n) => [...document.querySelectorAll(`h${n}`)].filter((h) => styles.has(h)).map((h) => parseFloat(styles.get(h)!.fontSize)));
  for (let n = 1; n < 4; n++) {
    if (!levels[n - 1].length || !levels[n].length) continue;
    if (Math.max(...levels[n]) >= Math.min(...levels[n - 1])) {
      const el = [...document.querySelectorAll(`h${n + 1}`)].find((h) => parseFloat(styles.get(h)?.fontSize || '0') >= Math.min(...levels[n - 1]));
      if (el) issues.push({ id: `heading-${n + 1}`, level: 'warn', text: `An h${n + 1} is as big as or bigger than an h${n}, so the hierarchy reads backwards`, examples: [ex(el, styles.get(el)!.fontSize)] });
    }
  }
  const long = texts.filter((el) => {
    const cs = styles.get(el)!;
    const chars = el.getBoundingClientRect().width / (parseFloat(cs.fontSize) * 0.5);
    return chars > 95 && ((el as HTMLElement).innerText || '').length > 200;
  });
  if (long.length) issues.push({ id: 'measure', level: 'warn', text: `${long.length} block${long.length > 1 ? 's' : ''} of text run over 90 characters a line, which is hard to read`, examples: long.slice(0, 3).map((el) => ex(el, `${Math.round(el.getBoundingClientRect().width)}px wide`)) });
  const centered = texts.filter((el) => styles.get(el)!.textAlign === 'center' && el.getBoundingClientRect().height > parseFloat(styles.get(el)!.lineHeight || '20') * 3.5 && ((el as HTMLElement).innerText || '').length > 180);
  if (centered.length) issues.push({ id: 'centered', level: 'info', text: `${centered.length} long paragraph${centered.length > 1 ? 's are' : ' is'} centered; long text reads better left-aligned`, examples: centered.slice(0, 3).map((el) => ex(el)) });

  // Tells of generic AI-made UI.
  const gradientText = shown.filter((el) => { const cs = styles.get(el)! as CSSStyleDeclaration & { webkitBackgroundClip?: string }; return (cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') && cs.backgroundImage.includes('gradient'); });
  if (gradientText.length) issues.push({ id: 'gradient-text', level: 'info', text: `Gradient-filled text in ${gradientText.length} place${gradientText.length > 1 ? 's' : ''}, a common tell of generated UI`, examples: gradientText.slice(0, 3).map((el) => ex(el)) });
  const hueOf = (c: number[]) => {
    const [r, g, b] = c.map((x) => x / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d < 0.15) return -1;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const purple = shown.filter((el) => {
    const bg = styles.get(el)!.backgroundImage;
    if (!bg.includes('gradient')) return false;
    const hues = (bg.match(/rgba?\([^)]+\)/g) || []).map((v) => hueOf(parse(v) || [0, 0, 0])).filter((h) => h >= 0);
    return hues.length >= 2 && hues.every((h) => h >= 220 && h <= 320);
  });
  if (purple.length) issues.push({ id: 'purple-gradient', level: 'info', text: `Blue-to-purple gradient background${purple.length > 1 ? `s in ${purple.length} places` : ''}, the default look of generated sites`, examples: purple.slice(0, 3).map((el) => ex(el)) });
  const emoji = /\p{Extended_Pictographic}/u;
  const emojiIcons = shown.filter((el) => /^(H[1-6]|BUTTON|A|LI)$/.test(el.tagName) && emoji.test(((el as HTMLElement).innerText || '').slice(0, 3)));
  if (emojiIcons.length >= 3) issues.push({ id: 'emoji-icons', level: 'info', text: `Emoji used as icons in ${emojiIcons.length} headings, buttons or list items`, examples: emojiIcons.slice(0, 3).map((el) => ex(el)) });

  return issues;
}

export const designCheckScript = (tokens: string[]) => `(${designCheck.toString()})(${JSON.stringify(tokens.slice(0, 400))})`;

export function designInstruction(issues: DesignIssue[], hasDesignDoc: boolean) {
  const lines = issues.flatMap((i) => [`- ${i.text}`, ...i.examples.map((e) => `  - ${e.label} \`${e.selector}\``)]);
  return `Pinpoint's design check found these problems on this page:\n${lines.join('\n')}\n\nBring them back into the design system${hasDesignDoc ? ' described in DESIGN.md' : ''}: use the project's tokens and type scale instead of one-off values, keep spacing on the scale, and keep the hierarchy clear. Change shared components and tokens rather than patching single elements where the same problem repeats.`;
}
