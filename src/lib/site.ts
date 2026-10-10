export type SiteKind = 'none' | 'file' | 'dev' | 'built' | 'live';
export type BuildKind = 'dev' | 'built' | 'unknown';

const PRIVATE_V4 = /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$)/;

export function isLocalHost(host: string) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || PRIVATE_V4.test(h)) return true;
  if (/\.(localhost|local|test|internal|lan|home\.arpa)$/.test(h)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
  return !h.includes('.') && !h.includes(':') && h !== '';
}

export function siteKind(url: string, build: BuildKind | null): SiteKind {
  let u: URL;
  try { u = new URL(url); } catch { return 'none'; }
  if (u.protocol === 'file:') return 'file';
  if (!/^https?:$/.test(u.protocol)) return 'none';
  if (build === 'dev') return 'dev';
  if (!isLocalHost(u.hostname)) return 'live';
  return build === 'built' ? 'built' : 'dev';
}

export function originOf(url: string) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; }
}

export function twinUrl(url: string, origin: string) {
  try {
    const u = new URL(url), o = new URL(origin);
    return o.origin + u.pathname + u.search + u.hash;
  } catch { return ''; }
}

export const SITE_LABEL: Record<SiteKind, string> = { none: '', file: 'File', dev: 'Local', built: 'Local build', live: 'Live' };

export const buildKindScript = `(() => {
  const has = (s) => !!document.querySelector(s);
  const dev = () => {
    if (has('script[src*="@vite/client"],style[data-vite-dev-id],script[src*="/@id/"],script[src*="/@fs/"],vite-error-overlay,nextjs-portal,script[src*="webpack-hmr"],script[src*="hot-update"],script[src*="livereload"],script[src*="browser-sync"],script[src$="/_next/static/chunks/webpack.js"]')) return true;
    if (window.__vite_plugin_react_preamble_installed__ || window.$RefreshReg$ || window.__sveltekit_dev) return true;
    try { if (window.__NEXT_DATA__ && window.__NEXT_DATA__.buildId === 'development') return true; } catch (e) {}
    try { if (window.__NUXT__ && window.__NUXT__.config && window.__NUXT__.config.app && window.__NUXT__.config.app.buildId === 'dev') return true; } catch (e) {}
    if (Object.keys(window).some((k) => /^(webpackHotUpdate|__webpack_hmr|__turbopack|TURBOPACK|__NEXT_HMR)/.test(k))) return true;
    try {
      const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook && hook.renderers) for (const r of hook.renderers.values()) if (r && r.bundleType === 1) return true;
    } catch (e) {}
    return false;
  };
  if (dev()) return 'dev';
  const srcs = [...document.querySelectorAll('script[src],link[rel="modulepreload"][href],link[rel="stylesheet"][href]')].map((n) => n.getAttribute('src') || n.getAttribute('href') || '');
  const hashed = [
    /\\/_next\\/static\\/chunks\\/[\\w.-]+-[0-9a-f]{12,}\\.js/,
    /\\/_next\\/static\\/[\\w-]{16,}\\/_buildManifest\\.js/,
    /\\/assets\\/[\\w.~-]+-[\\w-]{8,}\\.(m?js|css)(\\?|$)/,
    /\\/static\\/(js|css)\\/[\\w.~-]+\\.[0-9a-f]{8}\\.(chunk\\.)?(js|css)(\\?|$)/,
    /\\/_app\\/immutable\\//,
    /\\/_astro\\/[\\w.~-]+\\.[\\w-]{8,}\\.(js|css)/,
    /\\/_nuxt\\/[\\w.~-]+\\.[0-9a-f]{8}\\.(js|css)|\\/_nuxt\\/[\\w-]{8}\\.js/,
  ];
  if (srcs.some((s) => hashed.some((re) => re.test(s)))) return 'built';
  try { if (window.__NEXT_DATA__ && window.__NEXT_DATA__.buildId) return 'built'; } catch (e) {}
  return 'unknown';
})()`;
