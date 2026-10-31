import { api } from './shared';
import type { AgentId, HarnessInfo, ModelCatalog, Settings, UpdateState } from '../types';
import { makeTab, normalizeUrl } from '../lib/urls';
import { useCallback, useEffect, useState } from 'react';
import type { AppContext } from './context';

export function useSettings(app: AppContext) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [agents, setAgents] = useState<Record<AgentId, { ok: boolean; version?: string }> | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [harnesses, setHarnesses] = useState<HarnessInfo[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500); };
  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      app.setUrlInput(s.projectDir ? s.url : '');
      const urls = !s.projectDir ? [''] : s.tabs?.length ? s.tabs : [s.url || ''];
      const list = urls.map((u, i) => makeTab(u ? normalizeUrl(u) : '', s.tabProfiles?.[i] || ''));
      app.setTabs(list);
      app.setActiveTab(list[Math.min(s.activeTab || 0, list.length - 1)].id);
    });
    // What was found last time shows at once; the real check waits until the window has settled.
    api.knownAgents().then((known) => { if (known) setAgents((now) => now || known); }).catch(() => {});
    const later = window.setTimeout(() => api.detectAgents().then(setAgents), 1500);
    api.modelCatalog().then(setCatalog);
    api.listAgents().then(setHarnesses);
    return () => clearTimeout(later);
  }, []);
  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await api.setSettings(patch);
    setSettings(next);
    if ('claudePath' in patch || 'codexPath' in patch || 'agentPaths' in patch || 'customAgents' in patch) {
      api.detectAgents().then(setAgents);
      api.listAgents().then(setHarnesses);
    }
  }, []);
  const projectDir = settings?.projectDir || '';
  const theme = settings?.theme || 'dark';
  useEffect(() => {
    document.documentElement.dataset.textSize = settings?.textSize || 'normal';
    document.documentElement.dataset.density = settings?.density || 'comfortable';
  }, [settings?.textSize, settings?.density]);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const light = theme === 'light' || (theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = light ? 'light' : 'dark';
      api.setWindowTheme(light).catch(() => {});
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  // A desktop notification, only when the window isn't the one you're looking at.
  // A short, quiet tone for "done" and "needs you", if switched on in Settings.
  const chime = (kind: 'done' | 'ask') => {
    if (!app.settings?.sounds) return;
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = kind === 'ask' ? 660 : 520;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.36);
      o.onended = () => ctx.close();
    } catch { /* audio unavailable */ }
  };
  const notify = (body: string) => {
    chime(/needs your OK|Waiting for your OK/.test(body) ? 'ask' : 'done');
    if (document.hasFocus()) return;
    api.notify('Pinpoint', body).catch(() => {});
  };
  useEffect(() => { api.updateState().then(setUpdate).catch(() => {}); return api.onUpdateState(setUpdate); }, []);

  Object.assign(app, { agents, catalog, flash, harnesses, notify, projectDir, saveSettings, setAgents, setSettings, settings, theme, toast, update });
}
