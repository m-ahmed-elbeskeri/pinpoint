export function layoutReport(): string {
  const box = (el: Element, depth: number) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const name = el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
    return `${'  '.repeat(depth)}${name} top=${Math.round(r.top)} bottom=${Math.round(r.bottom)} h=${Math.round(r.height)} flex=${cs.flexGrow}/${cs.flexShrink}/${cs.flexBasis}${el instanceof HTMLElement && el.style.cssText ? ` style="${el.style.cssText.slice(0, 120)}"` : ''}`;
  };
  const out = [`window ${innerWidth}x${innerHeight} dpr=${devicePixelRatio} zoom=${Math.round((outerWidth / innerWidth) * 100)}%`];
  const app = document.querySelector('.app');
  if (app) {
    const cs = getComputedStyle(app);
    out.push(box(app, 0), `  grid rows: ${cs.gridTemplateRows} | columns: ${cs.gridTemplateColumns} | areas: ${cs.gridTemplateAreas}`);
  }
  const walk = (el: Element, depth: number, limit: number) => {
    out.push(box(el, depth));
    if (depth < limit) for (const c of el.children) walk(c, depth + 1, limit);
  };
  const panel = document.querySelector('.panel');
  if (panel) for (const c of [panel]) walk(c, 1, 3);
  const drawer = document.querySelector('.drawer-wrap');
  if (drawer) walk(drawer, 1, 2);
  const ta = document.querySelector<HTMLTextAreaElement>('.composer-box textarea');
  if (ta) out.push(`composer text: ${ta.value.length} characters, ${ta.value.split('\n').length} lines; placeholder "${ta.placeholder.slice(0, 60)}"`);
  out.push(`open overlays: ${[...document.querySelectorAll('.modal-backdrop, .sheet-backdrop, .diag-pop, .dd-menu, .drop-zone, .toast')].map((e) => e.className).join(', ') || 'none'}`);
  return out.join('\n');
}
