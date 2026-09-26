// Runs in the page (via webview.executeJavaScript) and drafts a DESIGN.md from
// what is actually rendered: colors, type, radii, shadows, spacing and CSS tokens.
function extract() {
  const hex = (c: string) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return c.startsWith('#') ? c.toLowerCase() : null;
    const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parseFloat(a) < 0.35) return null;
    return '#' + [r, g, b].map((v) => Math.round(parseFloat(v)).toString(16).padStart(2, '0')).join('');
  };
  const tally = () => new Map<string, number>();
  const bump = (m: Map<string, number>, k: string | null | undefined, w = 1) => { if (k) m.set(k, (m.get(k) || 0) + w); };
  const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

  const text = tally(), bg = tally(), border = tally(), accent = tally();
  const fonts = tally(), sizes = tally(), weights = tally(), radii = tally(), shadows = tally(), space = tally();

  const els = [...document.body.querySelectorAll('*')].slice(0, 4000) as HTMLElement[];
  for (const el of els) {
    if (el.closest('pinpoint-overlay')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const area = Math.min(20, (r.width * r.height) / 20000) + 1;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
    if (hasText) {
      bump(text, hex(cs.color));
      bump(fonts, cs.fontFamily.split(',')[0].replace(/["']/g, '').trim());
      bump(sizes, cs.fontSize);
      bump(weights, cs.fontWeight);
    }
    bump(bg, hex(cs.backgroundColor), area);
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') bump(border, hex(cs.borderTopColor));
    if (el.matches('button, a, [role=button], input[type=submit]')) {
      bump(accent, hex(cs.backgroundColor), 3);
      if (el.tagName === 'A') bump(accent, hex(cs.color));
    }
    if (cs.borderRadius && cs.borderRadius !== '0px') bump(radii, cs.borderRadius.split(' ')[0]);
    if (cs.boxShadow && cs.boxShadow !== 'none') bump(shadows, cs.boxShadow.length > 90 ? cs.boxShadow.slice(0, 90) + '…' : cs.boxShadow);
    for (const k of ['paddingTop', 'paddingLeft', 'marginBottom', 'rowGap', 'columnGap'] as const) {
      const v = cs[k];
      if (v && v !== '0px' && v !== 'normal' && parseFloat(v) <= 128) bump(space, `${Math.round(parseFloat(v))}px`);
    }
  }

  // CSS custom properties declared on :root / html (design tokens)
  const tokens: [string, string][] = [];
  const rootStyle = getComputedStyle(document.documentElement);
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of [...rules]) {
      const sr = rule as CSSStyleRule;
      if (!sr.selectorText || !/^(:root|html)\b/.test(sr.selectorText)) continue;
      for (const prop of [...sr.style]) {
        if (prop.startsWith('--') && !tokens.some(([k]) => k === prop) && tokens.length < 60) {
          tokens.push([prop, rootStyle.getPropertyValue(prop).trim() || sr.style.getPropertyValue(prop).trim()]);
        }
      }
    }
  }

  const px = (l: string[]) => l.map((v) => parseFloat(v)).sort((a, b) => a - b).map((v) => `${v}px`).join(', ');
  const list = (l: string[]) => l.map((c) => `\`${c}\``).join(', ');
  const md = [
    '# Design rules',
    '',
    `> Drafted by Pinpoint from ${location.href} on ${new Date().toLocaleDateString()}. Edit freely: the agent reads this at the start of each chat.`,
    '',
    '## Colors',
    `- Text: ${list(top(text, 4))}`,
    `- Backgrounds / surfaces: ${list(top(bg, 5))}`,
    accent.size ? `- Accent (buttons, links): ${list(top(accent, 3))}` : '',
    border.size ? `- Borders: ${list(top(border, 3))}` : '',
    '',
    '## Typography',
    `- Font families: ${top(fonts, 3).join(', ')}`,
    `- Sizes in use: ${px(top(sizes, 8))}`,
    `- Weights: ${top(weights, 4).sort().join(', ')}`,
    '',
    '## Shape & depth',
    radii.size ? `- Corner radii: ${px(top(radii, 5))}` : '- Corner radii: square corners',
    shadows.size ? `- Shadows: ${top(shadows, 3).map((s) => `\`${s}\``).join('; ')}` : '- Shadows: none',
    '',
    '## Spacing',
    `- Common values: ${px(top(space, 8))}`,
    '',
    tokens.length ? '## Design tokens (CSS variables)' : '',
    ...tokens.map(([k, v]) => `- \`${k}\`: \`${v}\``),
    tokens.length ? '' : '',
    '## Rules',
    '- Reuse the colors, fonts, radii and spacing above (or their tokens). Ask before introducing new ones.',
    '- Match existing components before creating new ones.',
    '',
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  return md;
}

export const extractDesignScript = `(${extract.toString()})()`;
