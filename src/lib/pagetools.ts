// Small scripts that run in the page's main world (via webview.executeJavaScript).

// Changes one prop of the component that renders [data-pinpoint=uid], live: React
// through the renderer's dev-only overrideProps, Vue 3 through its reactive props.
// Returns false when it can't (production build, another framework, or the hook
// wasn't in place before React loaded).
function setProp(uid: string, owner: string, name: string, value: unknown) {
  const el = document.querySelector(`[data-pinpoint="${uid}"]`) as any;
  const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!el || !hook?.renderers) return false;
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  if (!key) {
    // Vue 3: a component's props object is reactive, so assigning re-renders it.
    let inst = el.__vueParentComponent;
    if (!inst) for (let c = el.parentElement; c && !inst; c = c.parentElement) inst = c.__vueParentComponent;
    const vueName = (i: any) => i.type?.name || i.type?.__name || (i.type?.__file || '').split('/').pop()?.replace(/\.vue$/, '');
    while (inst && vueName(inst) !== owner) inst = inst.parent;
    if (!inst?.props || !(name in inst.props)) return false;
    try { inst.props[name] = value; return true; } catch { return false; }
  }
  const nameOf = (t: any) => t && typeof t !== 'string' && (t.displayName || t.name || t.render?.displayName || t.render?.name || t.type?.displayName || t.type?.name);
  let fiber = el[key];
  while (fiber && nameOf(fiber.type) !== owner) fiber = fiber.return;
  if (!fiber) return false;
  // A DOM node can point at either copy of its fiber. Overriding the stale one
  // would start from old props, so use the copy that belongs to the current tree.
  const isCurrent = (f: any) => { let r = f; while (r.return) r = r.return; return r.stateNode?.current === r; };
  if (!isCurrent(fiber) && fiber.alternate && isCurrent(fiber.alternate)) fiber = fiber.alternate;
  for (const r of hook.renderers.values()) {
    if (typeof r.overrideProps !== 'function') continue;
    try { r.overrideProps(fiber, [name], value); return true; } catch { /* another renderer owns it */ }
  }
  return false;
}
export const setPropScript = (uid: string, owner: string, name: string, value: unknown) =>
  `(${setProp.toString()})(${JSON.stringify(uid)}, ${JSON.stringify(owner)}, ${JSON.stringify(name)}, ${JSON.stringify(value)})`;

// Every class name the page's stylesheets know, for autocomplete in the class editor.
function classNames() {
  const names = new Set<string>();
  const visit = (rules: CSSRuleList, depth: number) => {
    for (const rule of [...rules]) {
      if (names.size >= 6000) return;
      const sel = (rule as CSSStyleRule).selectorText;
      if (sel) for (const m of sel.matchAll(/\.((?:\\.|[\w-])+)/g)) names.add(m[1].replace(/\\(.)/g, '$1'));
      const nested = (rule as CSSGroupingRule).cssRules;
      if (nested && depth < 4) visit(nested, depth + 1);
    }
  };
  for (const sheet of [...document.styleSheets]) {
    try { visit(sheet.cssRules, 0); } catch { /* cross-origin sheet */ }
  }
  return [...names].sort();
}
export const classNamesScript = `(${classNames.toString()})()`;

// Runs in the page: the text of the dev server's error overlay (Vite, Next.js, webpack), if one is showing.
// It names the file, the line and the code around it, which the console message often does not.
function errorOverlay(): string | null {
  const text = (n: Element | null | undefined) => ((n as HTMLElement | null)?.innerText || n?.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  const vite = document.querySelector('vite-error-overlay')?.shadowRoot;
  if (vite) {
    const part = (sel: string) => text(vite.querySelector(sel));
    return [part('.plugin'), part('.message-body') || part('.message'), part('.file'), part('.frame'), part('.stack')].filter(Boolean).join('\n').slice(0, 4000) || null;
  }
  const next = document.querySelector('nextjs-portal')?.shadowRoot?.querySelector('[role="dialog"], [data-nextjs-dialog]');
  if (next) return text(next).slice(0, 4000) || null;
  const frame = document.querySelector<HTMLIFrameElement>('#webpack-dev-server-client-overlay');
  try { if (frame?.contentDocument) return text(frame.contentDocument.body).slice(0, 4000) || null; } catch { /* not ours to read */ }
  return null;
}
export const errorOverlayScript = `(${errorOverlay.toString()})()`;
