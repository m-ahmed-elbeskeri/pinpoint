// Component workspace, page side (runs via webview.executeJavaScript). Renders a
// component from the project on its own, over the page, using the page's own
// React and the dev server's own modules: no Storybook, nothing to configure.
// Needs a dev server that serves source files as modules (Vite).

export interface WorkspaceSpec {
  file: string;            // project-relative path of the component's file
  name: string;
  isDefault: boolean;
  cells: { label: string; props: Record<string, unknown> }[];
  abs?: string;            // the same file as an absolute path, for dev servers whose root is elsewhere
  left?: number;           // page pixels covered by Pinpoint's own panel on the left
}

// Kept as source text, not as a function: it uses dynamic import(), which the
// app's own bundler would rewrite into helpers that don't exist inside the page.
const RENDER = String.raw`async function render(spec) {
  const w = window;
  if (w.__pinpointWorkspace) w.__pinpointWorkspace.close();

  // The component's module, as the dev server serves it. Projects whose dev
  // server root is a subfolder serve it under a shorter path.
  // Vite adds its client script to every page it serves; where that script lives
  // is the base path everything else is served under.
  const client = [...document.scripts].map((s) => s.getAttribute('src') || '').find((s) => s.indexOf('@vite/client') >= 0)
    || ((await fetch('/@vite/client').then((r) => r.ok && /javascript/.test(r.headers.get('content-type') || '')).catch(() => false)) ? '/@vite/client' : '');
  if (!client) {
    const next = w.__NEXT_DATA__ || w.next || document.querySelector('script[src*="/_next/"]');
    const what = next ? 'This page is served by Next.js.'
      : document.querySelector('script[src*="/_nuxt/"]') ? 'This page is served by Nuxt.'
        : w.webpackHotUpdate || Object.keys(w).some((k) => k.indexOf('webpackChunk') === 0) ? 'This page is served by webpack.'
          : "This page isn't served by a Vite dev server.";
    return { ok: false, error: what + ' The component workspace only works with Vite dev servers so far. To work on one component here, pick it on the page and press Isolate in its note.' };
  }
  const base = new URL(client, location.href).pathname.replace(/@vite\/client.*$/, '');
  const parts = spec.file.split('/');
  const candidates = parts.map((_, i) => base + parts.slice(i).join('/'));
  // Files outside the server's root (a monorepo package, a linked folder) are served by absolute path.
  if (spec.abs) candidates.push(base + '@fs/' + spec.abs.replace(/^\//, ''));
  let url = '';
  let source = '';
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate);
      const text = res.ok ? await res.text() : '';
      if (text && !/^\s*<!doctype/i.test(text) && /import|export/.test(text)) { url = candidate; source = text; break; }
    } catch (e) { /* try the next place */ }
  }
  if (!url) return { ok: false, error: "The dev server didn't serve " + spec.file + '. If it is outside the folder the dev server runs in, add that folder to server.fs.allow in the Vite config.' };

  // React must be the very copy the app uses (same URL, same version tag), or hooks break.
  // A dev server that has only just started may still be optimising dependencies and
  // change that tag, so a failed attempt reads the module again and tries once more.
  let React, createRoot, problem = "";
  for (let attempt = 0; attempt < 2 && !createRoot; attempt++) {
    if (attempt) {
      await new Promise((r) => setTimeout(r, 1200));
      try { source = await (await fetch(url)).text(); } catch (e) { /* keep the first copy */ }
    }
    const dep = source.match(/["'](\/[^"']*\/deps\/)[\w.-]+\.js\?v=(\w+)["']/);
    if (!dep) { problem = "Couldn't find the project's React in the served module. The workspace supports React on Vite."; continue; }
    try {
      const r = await import(dep[1] + "react.js?v=" + dep[2]);
      React = r.default || r;
      const d = await import(dep[1] + "react-dom_client.js?v=" + dep[2]);
      createRoot = d.createRoot || (d.default && d.default.createRoot);
      if (!React || !React.createElement || !createRoot) { createRoot = null; problem = "This project's React couldn't be used (the workspace needs React 18 or newer)."; }
    } catch (e) { problem = "Couldn't load React from the dev server: " + e.message; }
  }
  if (!createRoot) return { ok: false, error: problem };

  let Component;
  try {
    const mod = await import(url);
    Component = spec.isDefault ? mod.default : mod[spec.name];
  } catch (e) { return { ok: false, error: "The component's file failed to load: " + e.message }; }
  if (!Component) return { ok: false, error: spec.name + " isn't exported from " + spec.file + ' any more.' };

  // A component that throws shows its error in its own cell instead of taking the page down.
  class Boundary extends React.Component {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error: error }; }
    render() {
      const error = this.state.error;
      if (!error) return this.props.children;
      return React.createElement('pre', { style: { margin: 0, padding: 12, color: '#b00020', background: '#fff5f5', font: '12px/1.5 ui-monospace, monospace', whiteSpace: 'pre-wrap', borderRadius: 8 } },
        spec.name + ' threw while rendering:\n' + error.message + '\n\nIt may need a provider (theme, router, store) that wraps it in the app.');
    }
  }

  const many = spec.cells.length > 1;
  const host = document.createElement('div');
  host.id = 'pinpoint-workspace';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;overflow:auto;background:#fff;padding:28px;box-sizing:border-box;'
    + 'padding-left:' + (28 + (spec.left || 0)) + 'px;'
    + 'display:grid;gap:22px;align-content:start;grid-template-columns:repeat(' + (many ? 'auto-fill' : 1) + ', minmax(' + (many ? '220px' : '0') + ', 1fr));';
  document.body.appendChild(host);
  const roots = [];
  for (const cell of spec.cells) {
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-width:0;';
    if (many) {
      const label = document.createElement('div');
      label.textContent = cell.label;
      label.style.cssText = 'font:600 11px/1 ui-monospace,monospace;color:#6b7280;letter-spacing:.02em;';
      box.appendChild(label);
    }
    const mount = document.createElement('div');
    mount.style.cssText = 'display:flex;align-items:flex-start;justify-content:flex-start;min-width:0;';
    box.appendChild(mount);
    host.appendChild(box);
    const props = Object.assign({}, cell.props);
    const children = props.children;
    delete props.children;
    const root = createRoot(mount);
    root.render(React.createElement(Boundary, null, React.createElement(Component, props, children)));
    roots.push(root);
  }
  const html = document.documentElement;
  const overflow = html.style.overflow;
  html.style.overflow = 'hidden';
  w.__pinpointWorkspace = {
    close() {
      for (const r of roots) { try { r.unmount(); } catch (e) { /* already gone */ } }
      host.remove();
      html.style.overflow = overflow;
      w.__pinpointWorkspace = null;
    },
  };
  return { ok: true };
}`;

export const workspaceScript = (spec: WorkspaceSpec) => `(${RENDER})(${JSON.stringify(spec)})`;
export const closeWorkspaceScript = 'window.__pinpointWorkspace ? (window.__pinpointWorkspace.close(), true) : false';

// Feature flags and other per-profile storage values: set them and say whether anything changed
// (the page is reloaded once when it did, so the app reads them at startup like a real visit).
function setStorage(entries: [string, string][]) {
  let changed = false;
  for (const [key, value] of entries) {
    try { if (localStorage.getItem(key) !== value) { localStorage.setItem(key, value); changed = true; } } catch { /* storage blocked */ }
  }
  return changed;
}
export const storageScript = (entries: [string, string][]) => `(${setStorage.toString()})(${JSON.stringify(entries)})`;
