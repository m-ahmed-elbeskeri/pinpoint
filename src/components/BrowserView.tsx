import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ElementInfo, Rect } from '../lib/types';
import { locateSourceScript } from '../lib/inspect';
import { extractDesignScript } from '../lib/extractDesign';

// Electron's <webview> element (subset of its API we use).
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

export interface BrowserHandle {
  load(url: string): void;
  back(): void;
  forward(): void;
  reload(): void;
  devtools(): void;
  send(channel: string, ...args: unknown[]): void;
  capture(rect?: Rect): Promise<string>;
  hitTest(points: [number, number][]): Promise<ElementInfo[]>;
  locateSource(uid: string): Promise<ElementInfo['source']>;
  size(): { width: number; height: number };
  links(): Promise<{ href: string; text: string }[]>;
  extractDesign(): Promise<string | null>;
  url(): string;
  title(): string;
}

interface Props {
  initialUrl: string;
  onPicked(el: PickedElement): void;
  onNavigate(state: { url: string; title: string; canBack: boolean; canForward: boolean }): void;
  onLoading(loading: boolean): void;
  onReady(): void;
  onKey(key: string): void;
  onError(msg: string | null): void;
  onConsole(entry: { level: 'error' | 'warning'; message: string; source?: string; line?: number }): void;
  onPageChange(): void; // a full (non in-page) navigation or reload started a new document
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const BrowserView = forwardRef<BrowserHandle, Props>(function BrowserView(props, ref) {
  const wv = useRef<WebviewEl>(null);
  const ready = useRef(false);
  const pending = useRef(new Map<string, (hits: ElementInfo[]) => void>());
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
    async capture(rect) {
      const id = wv.current!.getWebContentsId();
      return window.pinpoint.capture(id, rect);
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
      const r = wv.current?.getBoundingClientRect();
      return { width: Math.round(r?.width || 0), height: Math.round(r?.height || 0) };
    },
    async links() {
      const code = `[...document.querySelectorAll('a[href]')].filter(a => a.origin === location.origin && !a.href.startsWith('javascript:')).map(a => ({ href: a.href.split('#')[0], text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 60) })).filter((l, i, arr) => arr.findIndex(x => x.href === l.href) === i).slice(0, 80)`;
      try { return await wv.current!.executeJavaScript(code); } catch { return []; }
    },
    async extractDesign() {
      try { return await wv.current!.executeJavaScript(extractDesignScript); } catch { return null; }
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
      'did-navigate': (e) => { nav(); if (e) cb.current.onPageChange(); },
      'console-message': (e) => {
        // Electron ≥ 35 reports level as a string; older versions used 0-3.
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
        else if (e.channel === 'hits') {
          const res = pending.current.get(data.reqId);
          if (res) { pending.current.delete(data.reqId); res(data.hits); }
        }
      },
    };
    for (const [k, fn] of Object.entries(handlers)) el.addEventListener(k, fn);
    return () => { for (const [k, fn] of Object.entries(handlers)) el.removeEventListener(k, fn); };
  }, []);

  return <webview ref={wv as any} src={src} partition="persist:pinpoint" className="webview" />;
});

export { sleep };
