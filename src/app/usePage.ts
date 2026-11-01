import { api, markerList } from './shared';
import { sleep } from '../components/page/BrowserView';
import { DEVICE_OFF, type Breakpoint, type Device } from '../components/page/DeviceBar';
import { NO_CONDITIONS, type Conditions } from '../components/page/PageTools';
import type { A11yIssue, Mock, Mode, PageEnv } from '../types';
import { errText } from '../lib/util';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppContext } from './context';

export function usePage(app: AppContext) {
  const settings = app.settings;
  const [mode, setModeState] = useState<Mode>('browse');
  // Each tab keeps its own preview size.
  const [deviceByTab, setDeviceByTab] = useState<Record<string, Device>>({});
  const device = deviceByTab[app.activeTab] ?? DEVICE_OFF;
  const setDevice = (next: Device | ((d: Device) => Device)) => setDeviceByTab((all) => {
    const tab = app.activeTab;
    const now = all[tab] ?? DEVICE_OFF;
    return { ...all, [tab]: typeof next === 'function' ? next(now) : next };
  });
  const [avail, setAvail] = useState({ w: 0, h: 0 });
  const dragging = useRef(false);
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>([]);
  const area = useRef<HTMLDivElement>(null);
  const [mocks, setMocks] = useState<Mock[]>([]);
  const [includeDiag, setIncludeDiag] = useState(true);
  const [env, setEnv] = useState<PageEnv>({ colorScheme: null, reducedMotion: false });
  const [frozen, setFrozenState] = useState(false);
  const [cond, setCond] = useState<Conditions>(NO_CONDITIONS);
  const [multi, setMulti] = useState(false);
  const [a11y, setA11y] = useState<A11yIssue[]>([]);
  const [includeA11y, setIncludeA11y] = useState(false);
  const axeRef = useRef<string | null>(null);
  const applyEnv = useCallback(async (e: PageEnv, isFrozen: boolean) => {
    const id = app.browser.current?.id();
    if (id == null) return;
    app.browser.current?.send('scheme', e.colorScheme);
    const touch = app.device.on && app.device.touch && app.mode === 'browse';
    try { await api.emulate(id, { ...e, focus: isFrozen, touch }); } catch (err) { app.flash(errText(err)); }
  }, []);
  useEffect(() => { applyEnv(env, frozen); }, [env, frozen, applyEnv, device.on, device.touch, mode]);
  const onFrozen = useCallback(async (on: boolean) => {
    setFrozenState(on);
    const b = app.browser.current;
    const id = b?.id();
    if (!b || id == null) return;
    try {
      await api.forceState(id, '[data-pinpoint-hover]', on ? ['hover'] : []);
      await api.setAnimationRate(id, on ? 0 : app.cond.anim);
    } catch (err) { app.flash(errText(err)); }
    if (!on) b.send('thaw');
  }, []);
  const setFrozen = useCallback((on: boolean) => { app.browser.current?.send('freeze', on); onFrozen(on); }, [onFrozen]);
  const runA11y = useCallback(async () => {
    if (app.settings?.a11yCheck === false || !/^(https?|file):/.test(app.nav.url)) { setA11y([]); return; }
    try {
      axeRef.current ??= await api.a11ySource();
      const res = await app.browser.current?.a11y(axeRef.current);
      if (res) setA11y(res);
    } catch { /* the page navigated mid-audit */ }
  }, []);
  useEffect(() => {
    if (app.loading) return;
    const t = setTimeout(() => {
      app.browser.current?.breakpoints().then(setBreakpoints);
      app.browser.current?.classNames().then(app.setClassNames);
      if (app.cond.stress.length) app.browser.current?.send('stress', app.cond.stress);
    }, 1500);
    const audit = setTimeout(runA11y, 2500);
    const warmup = setTimeout(() => {
      const warm = app.otherRoutes(app.nav.url);
      if (warm?.routes.length && !app.runRef.current) api.prewarmRoutes(warm.routes, warm.partition).catch(() => {});
    }, 5000);
    return () => { clearTimeout(t); clearTimeout(audit); clearTimeout(warmup); };
  }, [app.nav.url, app.loading, settings?.a11yCheck, runA11y]);
  const changeConditions = async (next: Conditions) => {
    const prev = app.cond;
    setCond(next);
    const b = app.browser.current;
    const id = b?.id();
    if (!b || id == null) return;
    try {
      if (next.stress.join() !== prev.stress.join()) b.send('stress', next.stress);
      if (next.anim !== prev.anim) await api.setAnimationRate(id, next.anim);
      if (next.network !== prev.network) { await api.setNetwork(id, next.network); b.reload(); }
    } catch (e) { app.flash(errText(e)); }
  };
  const stepAnimation = async () => {
    const id = app.browser.current?.id();
    if (id == null) return;
    try { await api.setAnimationRate(id, 1); await sleep(100); await api.setAnimationRate(id, 0); } catch (e) { app.flash(errText(e)); }
  };
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (dragging.current && !app.device.on) return;
      const w = Math.floor(e.contentRect.width), h = Math.floor(e.contentRect.height);
      setAvail((a) => (a.w === w && a.h === h ? a : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!settings]);
  const startDeviceResize = (axis: 'x' | 'y' | 'xy') => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as Element;
    el.setPointerCapture(e.pointerId);
    app.setResizing('device');
    const sx = e.clientX, sy = e.clientY, k = deviceScale;
    const w0 = device.w, h0 = device.h || Math.round(deviceH);
    const move = (ev: PointerEvent) => {
      const w = axis === 'y' ? w0 : Math.min(3840, Math.max(240, Math.round(w0 + ((ev.clientX - sx) * 2) / k)));
      const h = axis === 'x' ? device.h : Math.min(3840, Math.max(240, Math.round(h0 + (ev.clientY - sy) / k)));
      setDevice((d) => ({ ...d, w, h }));
    };
    const up = () => { el.removeEventListener('pointermove', move as EventListener); el.removeEventListener('pointerup', up); app.setResizing(null); };
    el.addEventListener('pointermove', move as EventListener);
    el.addEventListener('pointerup', up);
  };
  const askA11y = () => {
    setIncludeA11y(true);
    app.setInstruction((t) => (t.trim() ? t : 'Fix the accessibility problems listed in the diagnostics.'));
    app.focusComposer(50);
  };
  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    app.setPopover(null);
    app.browser.current?.send('mode', m === 'select' ? 'select' : 'browse');
  }, []);
  const applyMocks = useCallback(() => {
    const id = app.browser.current?.id();
    if (id == null) return;
    api.setMocks(id, app.mocks.filter((m) => m.on)).catch((err) => app.flash(errText(err)));
  }, []);
  useEffect(() => { applyMocks(); }, [mocks, applyMocks]);
  const syncPage = useCallback(() => {
    app.browser.current?.send('mode', app.mode === 'select' ? 'select' : 'browse');
    app.browser.current?.send('markers', markerList(app.annotations, null));
    applyEnv(app.env, app.frozen);
    applyMocks();
    app.browser.current?.send('layout', app.settings?.layoutOverlay !== false);
    app.browser.current?.send('record', !!app.rec);
    if (app.cond.stress.length) app.browser.current?.send('stress', app.cond.stress);
  }, [applyEnv]);
  const deviceScale = !device.on || !avail.w ? 1
    : device.zoom === 'fit' ? Math.min(1, avail.w / device.w, device.h ? avail.h / device.h : 1) : device.zoom;
  const deviceH = device.h || avail.h / deviceScale;

  Object.assign(app, { a11y, area, askA11y, breakpoints, changeConditions, cond, device, deviceH, deviceScale, dragging, env, frozen, includeA11y, includeDiag, mocks, mode, multi, onFrozen, runA11y, setA11y, setAvail, setDevice, setEnv, setFrozen, setFrozenState, setIncludeA11y, setIncludeDiag, setMocks, setMode, setMulti, startDeviceResize, stepAnimation, syncPage });
}
