import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ElementInfo, Rect } from '../lib/types';
import { locateSourceScript } from '../lib/inspect';
import { extractDesignScript } from '../lib/extractDesign';
import { tokenMatchScript } from '../lib/tokens';
import { a11yScript } from '../lib/a11y';
import { breakpointsScript, type Breakpoint } from './DeviceBar';
import { classNamesScript, errorOverlayScript, setPropScript } from '../lib/pagetools';
import { buildKindScript, type BuildKind } from '../lib/site';
import { closeWorkspaceScript, storageScript, workspaceScript, type WorkspaceSpec } from '../lib/workspace';
import type { FlowStep } from '../lib/types';
import type { A11yIssue, NetRequest } from '../lib/types';

interface WebviewEl extends HTMLElement {
  loadURL(url: string): Promise<void>;
  goBack(): void; goForward(): void; reload(): void; stop(): void;
  canGoBack(): boolean; canGoForward(): boolean;
  send(channel: string, ...args: unknown[]): void;
  executeJavaScript<T = unknown>(code: string): Promise<T>;
  getWebContentsId(): number;
  getURL(): string; getTitle(): string;
  openDevTools(): void;
}

export interface PickedElement extends ElementInfo {
  dpr: number;
  viewport: { width: number; height: number };
  shift: boolean;
}

export interface FrameTarget { uid: string; selector: string }

function framePage(targets: FrameTarget[], fallbackY: number | null) {
  const els = targets.map((t) => {
    const marked = document.querySelector(`[data-pinpoint="${t.uid}"]`);
    if (marked) return marked;
    try { return document.querySelector(t.selector); } catch { return null; }
  }).filter((el): el is Element => !!el);
  const box = () => {
    let top = Infinity, bottom = -Infinity;
    for (const el of els) { const r = el.getBoundingClientRect(); top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom); }
    return { top, bottom };
  };
  if (!els.length) {
    if (fallbackY != null) window.scrollTo({ top: fallbackY, behavior: 'instant' as ScrollBehavior });
    return { found: false, y: Math.round(window.scrollY) };
  }
  let b = box();
  if (b.top < 0 || b.bottom > innerHeight) {
    els[0].scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
    b = box();
    if (els.length > 1 && (b.top < 0 || b.bottom > innerHeight)) {
      const h = b.bottom - b.top;
      window.scrollBy({ top: h <= innerHeight ? b.top - (innerHeight - h) / 2 : b.top - 40, behavior: 'instant' as ScrollBehavior });
    }
  }
  return { found: true, y: Math.round(window.scrollY) };
}

export interface BrowserHandle {
  load(url: string): void;
  back(): void;
  forward(): void;
  reload(): void;
  devtools(): void;
  send(channel: string, ...args: unknown[]): void;
  capture(rect?: Rect, jpeg?: boolean): Promise<string>;
  hitTest(points: [number, number][]): Promise<ElementInfo[]>;
  locateSource(uid: string): Promise<ElementInfo['source']>;
  size(): { width: number; height: number };
  links(): Promise<{ href: string; text: string }[]>;
  extractDesign(): Promise<string | null>;
  id(): number | null;
  inspect(uid: string): Promise<ElementInfo | null>;
  tokens(uid: string): Promise<Record<string, string> | null>;
  a11y(axeSource: string): Promise<A11yIssue[] | null>;
  reveal(selector: string): void;
  breakpoints(): Promise<Breakpoint[]>;
  classNames(): Promise<string[]>;
  errorOverlay(): Promise<string | null>;
  sendRequest(r: { method: string; url: string; body?: string }): Promise<{ status: number; body: string; ms: number; error?: string } | null>;
  hasHmr(): Promise<boolean>;
  buildKind(): Promise<BuildKind>;
  frame(targets: FrameTarget[], fallbackY?: number): Promise<{ found: boolean; y: number }>;
  workspace(spec: WorkspaceSpec): Promise<{ ok: boolean; error?: string } | null>;
  closeWorkspace(): void;
  setStorage(entries: [string, string][]): Promise<boolean>;
  setProp(uid: string, owner: string, name: string, value: unknown): Promise<boolean>;

  url(): string;
  title(): string;
}

interface Props {
  initialUrl: string;
  hidden?: boolean;
  partition?: string;
  onManip(m: { uid: string; kind: 'resize' | 'reorder'; width?: string | null; height?: string | null; from?: number; to?: number; count?: number; before?: string | null }): void;
  onPicked(el: PickedElement): void;
  onNavigate(state: { url: string; title: string; canBack: boolean; canForward: boolean }): void;
  onLoading(loading: boolean): void;
  onReady(): void;
  onKey(key: string): void;
  onError(msg: string | null): void;
  onConsole(entry: { level: 'error' | 'warning'; message: string; source?: string; line?: number }): void;
  onPageChange(): void;
  onFrozen(on: boolean): void;
  onStep(step: FlowStep): void;
  onRequest(r: NetRequest): void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const BrowserView = forwardRef<BrowserHandle, Props>(function BrowserView(props, ref) {
  const wv = useRef<WebviewEl>(null);
  const ready = useRef(false);
  const pending = useRef(new Map<string, (data: any) => void>());
  const cb = useRef(props);
  cb.current = props;
  const [src] = useState(props.initialUrl || 'about:blank');

  useImperativeHandle(ref, () => ({
    load(url) { wv.current?.loadURL(url).catch(() => {}); },
    back() { wv.current?.canGoBack() && wv.current.goBack(); },
    forward() { wv.current?.canGoForward() && wv.current.goForward(); },
    reload() { wv.current?.reload(); },
    devtools() { wv.current?.openDevTools(); },
    send(channel, ...args) { if (ready.current) wv.current?.send(channel, ...args); },
    async capture(rect, jpeg) {
      const id = wv.current!.getWebContentsId();
      return window.pinpoint.capture(id, rect, jpeg);
    },
    hitTest(points) {
      return new Promise((resolve) => {
        const reqId = Math.random().toString(36).slice(2);
        pending.current.set(reqId, resolve);
        wv.current?.send('hitTest', { reqId, points });
        setTimeout(() => { if (pending.current.delete(reqId)) resolve([]); }, 1500);
      });
    },
    async locateSource(uid) {
      try { return await wv.current!.executeJavaScript(locateSourceScript(uid)); }
      catch { return null; }
    },
    size() {
      return { width: wv.current?.offsetWidth || 0, height: wv.current?.offsetHeight || 0 };
    },
    async links() {
      const code = `[...document.querySelectorAll('a[href]')].filter(a => a.origin === location.origin && !a.href.startsWith('javascript:')).map(a => ({ href: a.href.split('#')[0], text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 60) })).filter((l, i, arr) => arr.findIndex(x => x.href === l.href) === i).slice(0, 80)`;
      try { return await wv.current!.executeJavaScript(code); } catch { return []; }
    },
    async extractDesign() {
      try { return await wv.current!.executeJavaScript(extractDesignScript); } catch { return null; }
    },
    id() { try { return ready.current ? wv.current!.getWebContentsId() : null; } catch { return null; } },
    inspect(uid) {
      return new Promise((resolve) => {
        const reqId = Math.random().toString(36).slice(2);
        pending.current.set(reqId, resolve);
        wv.current?.send('inspect', { reqId, uid });
        setTimeout(() => { if (pending.current.delete(reqId)) resolve(null); }, 1500);
      });
    },
    async tokens(uid) {
      try { return await wv.current!.executeJavaScript(tokenMatchScript(uid)); } catch { return null; }
    },
    reveal(selector) {
      wv.current?.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ behavior: 'smooth', block: 'center' })`).catch(() => {});
    },
    async workspace(spec) {
      try { return await wv.current!.executeJavaScript(workspaceScript(spec)); } catch (e) { return { ok: false, error: String((e as Error).message || e) }; }
    },
    closeWorkspace() { wv.current?.executeJavaScript(closeWorkspaceScript).catch(() => {}); },
    async setStorage(entries) {
      try { return !!(await wv.current!.executeJavaScript(storageScript(entries))); } catch { return false; }
    },
    async frame(targets, fallbackY) {
      try { return await wv.current!.executeJavaScript(`(${framePage.toString()})(${JSON.stringify(targets)}, ${fallbackY == null ? 'null' : fallbackY})`); } catch { return { found: false, y: 0 }; }
    },
    async hasHmr() {
      const code = `!!(document.querySelector('script[src*="@vite/client"],style[data-vite-dev-id],script[src*="webpack-hmr"],script[src*="hot-update"],script[src*="/_next/static/chunks/"],script[src*="livereload"],script[src*="browser-sync"]') || window.__vite_plugin_react_preamble_installed__ || window.$RefreshReg$ || window.__NUXT__ || window.__sveltekit_dev || Object.keys(window).some((k) => /^(webpackHotUpdate|webpackChunk|__webpack_hmr|__turbopack|__NEXT_HMR|__next_f$|__remixContext|__reactRouterContext)/.test(k)))`;
      try { return !!(await wv.current!.executeJavaScript(code)); } catch { return false; }
    },
    async buildKind() {
      try { return (await wv.current!.executeJavaScript<BuildKind>(buildKindScript)) || 'unknown'; } catch { return 'unknown'; }
    },
    async sendRequest(r) {
      const code = `(async () => {
        const r = ${JSON.stringify(r)};
        const json = (s) => { try { JSON.parse(s); return true; } catch (e) { return false; } };
        const t = performance.now();
        try {
          const res = await fetch(r.url, { method: r.method, credentials: 'include', ...(r.body && r.method !== 'GET' && r.method !== 'HEAD' ? { body: r.body, headers: json(r.body) ? { 'content-type': 'application/json' } : undefined } : {}) });
          const body = (await res.text()).slice(0, 16000);
          return { status: res.status, body, ms: Math.round(performance.now() - t) };
        } catch (e) { return { status: 0, body: '', ms: Math.round(performance.now() - t), error: String((e && e.message) || e) }; }
      })()`;
      try { return await wv.current!.executeJavaScript(code); } catch { return null; }
    },
    async errorOverlay() {
      try { return (await wv.current!.executeJavaScript<string | null>(errorOverlayScript)) || null; } catch { return null; }
    },
    async classNames() {
      try { return await wv.current!.executeJavaScript(classNamesScript); } catch { return []; }
    },
    async setProp(uid, owner, name, value) {
      try { return await wv.current!.executeJavaScript(setPropScript(uid, owner, name, value)); } catch { return false; }
    },
    async breakpoints() {
      try { return await wv.current!.executeJavaScript(breakpointsScript); } catch { return []; }
    },
    async a11y(axeSource) {
      try { return await wv.current!.executeJavaScript(a11yScript(axeSource)); } catch { return null; }
    },
    url() { return ready.current ? wv.current?.getURL() || '' : ''; },
    title() { return ready.current ? wv.current?.getTitle() || '' : ''; },
  }), []);

  useEffect(() => {
    const el = wv.current!;
    const nav = () => {
      if (!ready.current) return;
      cb.current.onNavigate({ url: el.getURL(), title: el.getTitle(), canBack: el.canGoBack(), canForward: el.canGoForward() });
    };
    const handlers: Record<string, (e: any) => void> = {
      'dom-ready': () => { ready.current = true; nav(); cb.current.onReady(); },
      'did-navigate': (e) => { nav(); if (e) { cb.current.onPageChange(); cb.current.onStep({ type: 'navigate', url: e.url }); } },
      'console-message': (e) => {
        const level = typeof e.level === 'number' ? ['verbose', 'info', 'warning', 'error'][e.level] : e.level;
        if (level !== 'error' && level !== 'warning') return;
        if (/Electron Security Warning/.test(e.message)) return;
        cb.current.onConsole({ level, message: String(e.message).slice(0, 600), source: e.sourceId || undefined, line: e.lineNumber || e.line || undefined });
      },
      'did-navigate-in-page': (e) => { if (e.isMainFrame) nav(); },
      'page-title-updated': nav,
      'did-start-loading': () => { cb.current.onLoading(true); cb.current.onError(null); },
      'did-stop-loading': () => { cb.current.onLoading(false); nav(); },
      'did-fail-load': (e) => {
        if (e.isMainFrame && e.errorCode !== -3) cb.current.onError(`${e.errorDescription || 'Failed to load'}: ${e.validatedURL}`);
      },
      'ipc-message': (e) => {
        const data = e.args?.[0];
        if (e.channel === 'picked') cb.current.onPicked(data);
        else if (e.channel === 'key') cb.current.onKey(data);
        else if (e.channel === 'ready') cb.current.onReady();
        else if (e.channel === 'frozen') cb.current.onFrozen(!!data);
        else if (e.channel === 'step') cb.current.onStep(data);
        else if (e.channel === 'manip') cb.current.onManip(data);
        else if (e.channel === 'net') cb.current.onRequest(data);
        else if (e.channel === 'pointer') el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        else if (e.channel === 'hits' || e.channel === 'reply') {
          const res = pending.current.get(data.reqId);
          if (res) { pending.current.delete(data.reqId); res(e.channel === 'hits' ? data.hits : data.data); }
        }
      },
    };
    for (const [k, fn] of Object.entries(handlers)) el.addEventListener(k, fn);
    return () => { for (const [k, fn] of Object.entries(handlers)) el.removeEventListener(k, fn); };
  }, []);

  return <webview ref={wv as any} src={src} partition={props.partition || 'persist:pinpoint'} className={`webview ${props.hidden ? 'bg-tab' : ''}`} {...({ allowpopups: 'true' } as object)} />;
});

export { sleep };
