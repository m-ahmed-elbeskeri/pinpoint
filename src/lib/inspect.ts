// Runs in the page's main world (via webview.executeJavaScript) so it can read
// the framework's dev-only metadata that the isolated preload cannot see.
// Returns { file, line, column, components, framework } for [data-pinpoint=uid].
function locate(uid: string) {
  const el = document.querySelector(`[data-pinpoint="${uid}"]`) as any;
  if (!el) return null;
  const out: { file?: string; line?: number; column?: number; components: string[]; framework?: string; frame?: { url: string; line: number; column: number } } = { components: [] };

  const cleanFile = (raw: string) => {
    let f = raw.trim();
    const wp = f.indexOf('/./');
    if (f.startsWith('webpack-internal:') && wp >= 0) return f.slice(wp + 3);
    try {
      if (/^https?:/.test(f)) {
        f = decodeURIComponent(new URL(f).pathname);
        f = f.replace(/^\/@fs\//, '').replace(/^\/_next\/static\/chunks\//, '');
      }
    } catch { /* keep raw */ }
    return f.replace(/[?#].*$/, '');
  };
  const vendor = /node_modules|react-dom|react-server|scheduler|\/chunks\/|jsx-dev-runtime|\.vite\/deps/;

  // Attributes some toolchains add in dev (Astro, react-dev-inspector, babel plugins).
  for (let c = el; c && c.nodeType === 1 && !out.file; c = c.parentElement) {
    const astroFile = c.getAttribute('data-astro-source-file');
    if (astroFile) {
      out.file = astroFile;
      const loc = (c.getAttribute('data-astro-source-loc') || '').split(':');
      out.line = +loc[0] || undefined; out.column = +loc[1] || undefined;
      out.framework = 'Astro';
      break;
    }
    const insp = c.getAttribute('data-inspector-relative-path') || c.getAttribute('data-source-file');
    if (insp) {
      out.file = insp;
      out.line = +(c.getAttribute('data-inspector-line') || c.getAttribute('data-source-line') || 0) || undefined;
      break;
    }
    const loc = c.getAttribute('data-loc') || c.getAttribute('data-source');
    if (loc && /\.\w+:\d+/.test(loc)) {
      const m = loc.match(/^(.*?):(\d+)(?::(\d+))?$/);
      if (m) { out.file = m[1]; out.line = +m[2]; out.column = m[3] ? +m[3] : undefined; }
      break;
    }
  }

  // React (fiber). React ≤18 has _debugSource; React 19 only has _debugStack.
  const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  if (fiberKey) {
    out.framework = out.framework || 'React';
    const names: string[] = [];
    for (let f = el[fiberKey], depth = 0; f && depth < 80; f = f.return, depth++) {
      if (!out.file && f._debugSource?.fileName) {
        out.file = f._debugSource.fileName; out.line = f._debugSource.lineNumber; out.column = f._debugSource.columnNumber;
      }
      if (!out.file && f._debugStack?.stack) {
        const frames = String(f._debugStack.stack).split('\n').slice(1);
        for (const fr of frames) {
          const m = fr.match(/\(?((?:https?|webpack-internal|file):\/\/?[^\s)]+?):(\d+):(\d+)\)?\s*$/);
          if (m && !vendor.test(m[1])) {
            // Line numbers here are in compiled code; the host resolves them via source maps.
            out.file = cleanFile(m[1]);
            out.frame = { url: m[1], line: +m[2], column: +m[3] };
            break;
          }
        }
      }
      const t = f.type;
      if (t && typeof t !== 'string') {
        const n = t.displayName || t.name || t.render?.displayName || t.render?.name || t.type?.displayName || t.type?.name;
        if (n && !/^(Anonymous|_c\d*|Fragment)$/.test(n) && !names.includes(n) && !/(Provider|Context|Boundary|Router|Layout(Router)?|Suspense|Root|HotReload|AppRouter|InnerLayoutRouter|RedirectBoundary|ScrollAndFocusHandler|RenderFromTemplateContext|OuterLayoutRouter)$/.test(n)) {
          names.push(n);
        }
      }
    }
    out.components = names.slice(0, 6).reverse();
  }

  // Vue 3 / Vue 2
  if (!fiberKey) {
    let inst = el.__vueParentComponent;
    if (!inst) for (let c = el; c && !inst; c = c.parentElement) inst = c.__vueParentComponent;
    if (inst) {
      out.framework = 'Vue';
      for (let i = inst; i && out.components.length < 6; i = i.parent) {
        const n = i.type?.name || i.type?.__name || (i.type?.__file || '').split('/').pop()?.replace(/\.vue$/, '');
        if (n) out.components.unshift(n);
        if (!out.file && i.type?.__file) out.file = i.type.__file;
      }
    } else {
      let v = null;
      for (let c = el; c && !v; c = c.parentElement) v = c.__vue__;
      if (v) {
        out.framework = 'Vue 2';
        if (v.$options?.__file) out.file = v.$options.__file;
        for (let i = v; i && out.components.length < 6; i = i.$parent) if (i.$options?.name) out.components.unshift(i.$options.name);
      }
    }
  }

  // Svelte (dev builds attach __svelte_meta)
  for (let c = el; c && !out.file; c = c.parentElement) {
    const meta = c.__svelte_meta;
    if (meta?.loc) { out.file = meta.loc.file; out.line = meta.loc.line + (meta.loc.line === 0 ? 1 : 0); out.column = meta.loc.column; out.framework = 'Svelte'; }
  }

  // Angular (dev mode exposes window.ng)
  const ng = (window as any).ng;
  if (ng?.getOwningComponent) {
    try {
      const comp = ng.getOwningComponent(el) || ng.getComponent(el);
      if (comp) { out.framework = 'Angular'; out.components = [comp.constructor.name.replace(/^_/, '')]; }
    } catch { /* not in dev mode */ }
  }

  if (out.file) out.file = cleanFile(out.file);
  return out.file || out.components.length || out.framework ? out : null;
}

export const locateSourceScript = (uid: string) => `(${locate.toString()})(${JSON.stringify(uid)})`;
