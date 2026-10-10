// URLs, routes and browser tabs: small pure helpers used by the app shell.
import { uid } from './draw';
import type { RouteInfo } from './types';

export function normalizeUrl(input: string) {
  const s = input.trim();
  if (!s) return '';
  if (/^[a-zA-Z]:[\\/]/.test(s)) return 'file:///' + s.replace(/\\/g, '/');
  if (/^(https?|file|about|data):/i.test(s)) return s;
  if (s.startsWith('/')) return 'file://' + s; // macOS / Linux absolute path
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?/.test(s) || /^:\d+/.test(s)) return 'http://' + s.replace(/^:/, 'localhost:');
  if (/^\d+$/.test(s)) return `http://localhost:${s}`;
  return 'https://' + s;
}

// Route patterns ([id], :id, [...slug], *) -> regex, to find which route renders a URL.
export function routeRegex(route: string) {
  const body = route.split('/').map((seg) => {
    if (/^\[\[?\.\.\./.test(seg) || seg === '*') return '.*';
    if (/^\[.+\]$/.test(seg) || /^[:$]/.test(seg)) return '[^/]+';
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return new RegExp(`^${body || '/'}/?$`);
}

export function matchRoute(routes: RouteInfo[], url: string, root: string): RouteInfo | null {
  if (!url || !routes.length) return null;
  let path = '';
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') {
      const file = decodeURIComponent(u.pathname).replace(/^\/([a-zA-Z]:)/, '$1');
      const r = root.replace(/\\/g, '/').replace(/\/$/, '');
      if (!file.toLowerCase().startsWith(r.toLowerCase() + '/')) return null;
      path = '/' + file.slice(r.length + 1);
      if (path === '/index.html') path = '/';
    } else path = u.pathname.replace(/\/$/, '') || '/';
  } catch { return null; }
  return routes.find((r) => !r.dynamic && r.route === path) || routes.find((r) => r.dynamic && routeRegex(r.route).test(path)) || null;
}

// One page open in Pinpoint's browser.
export interface Tab { id: string; url: string; title: string; canBack: boolean; canForward: boolean; loading: boolean; error: string | null; initialUrl: string; profile: string }
export const makeTab = (url: string, profile = ''): Tab => ({ id: uid(), url: '', title: '', canBack: false, canForward: false, loading: false, error: null, initialUrl: url, profile });
// A "view as" profile is a separate browser storage partition.
export const partitionOf = (profile: string) => (profile ? `persist:pinpoint-${profile}` : 'persist:pinpoint');
// "key=value" / "Name: value" lines from a profile's settings.
export const pairs = (text: string | undefined, sep: string): [string, string][] => (text || '').split('\n').map((l) => l.trim()).filter((l) => l && l.includes(sep))
  .map((l) => [l.slice(0, l.indexOf(sep)).trim(), l.slice(l.indexOf(sep) + 1).trim()] as [string, string]).filter(([k]) => k);
export const tabLabel = (t: Tab) => {
  if (t.title && t.title !== 'about:blank' && !/^https?:\/\//.test(t.title)) return t.title;
  const u = t.url || t.initialUrl;
  if (!u || u === 'about:blank') return 'New tab';
  try { const x = new URL(u); return x.protocol === 'file:' ? decodeURIComponent(x.pathname.split('/').pop() || u) : x.host + (x.pathname === '/' ? '' : x.pathname); } catch { return u; }
};
