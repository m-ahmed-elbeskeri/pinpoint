import { api } from './shared';
import type { BrowserHandle } from '../components/page/BrowserView';
import type { Profile } from '../types';
import { makeTab, normalizeUrl, pairs, type Tab } from '../lib/urls';
import { errText } from '../lib/util';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppContext } from './context';

export function useTabs(app: AppContext) {
  const browser = useRef<BrowserHandle | null>(null);
  const handles = useRef<Record<string, BrowserHandle | null>>({});
  const [urlInput, setUrlInput] = useState('');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState('');
  const tab = tabs.find((t) => t.id === activeTab);
  const nav = useMemo(
    () => ({ url: tab?.url || '', title: tab?.title || '', canBack: !!tab?.canBack, canForward: !!tab?.canForward }),
    [tab?.url, tab?.title, tab?.canBack, tab?.canForward],
  );
  const loading = !!tab?.loading;
  const loadError = tab?.error ?? null;
  browser.current = handles.current[activeTab] ?? null;
  const patchTab = (id: string, patch: Partial<Tab>) => setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const viewAs = profiles.find((p) => p.id === tab?.profile);
  const profileApplied = useRef<Record<string, string>>({});
  const go = (raw: string) => {
    const url = normalizeUrl(raw);
    if (!url) return;
    setUrlInput(url);
    browser.current?.load(url);
    app.saveSettings({ url });
  };
  const switchTab = (id: string) => {
    if (id === app.activeTab) return;
    browser.current?.send('mode', 'browse');
    if (app.frozen) app.setFrozen(false);
    if (app.isolated) app.isolate(null);
    app.setPopover(null);
    app.setMulti(false);
    setActiveTab(id);
  };
  const newTab = (url?: string) => {
    let start = url || '';
    if (!start) { try { const u = new URL(app.nav.url); if (/^https?:$/.test(u.protocol)) start = u.origin + '/'; } catch { /* a blank tab */ } }
    const t = makeTab(start, app.tabs.find((x) => x.id === app.activeTab)?.profile || '');
    setTabs((ts) => [...ts, t]);
    switchTab(t.id);
  };
  const closeTab = (id: string) => {
    const list = app.tabs;
    const i = list.findIndex((t) => t.id === id);
    if (i < 0) return;
    const rest = list.filter((t) => t.id !== id);
    const next = rest.length ? rest : [makeTab('')];
    if (id === app.activeTab) switchTab(next[Math.min(i, next.length - 1)].id);
    setTabs(next);
    delete handles.current[id];
    app.setAnnotations((prev) => prev.filter((a) => a.tabId !== id));
  };
  const applyTabProfile = async (t: Tab) => {
    const h = handles.current[t.id];
    const id = h?.id();
    if (!h || id == null) return;
    const p = app.profiles.find((x) => x.id === t.profile);
    const headers = Object.fromEntries(pairs(p?.headers, ':'));
    try { await api.applyProfile(id, { locale: p?.locale?.trim() || '', timezone: p?.timezone?.trim() || '', headers }); } catch (e) { app.flash(errText(e)); return; }
    const flags = pairs(p?.flags, '=');
    const changed = flags.length ? await h.setStorage(flags) : false;
    const sig = JSON.stringify([p?.locale || '', p?.timezone || '', p?.headers || '']);
    const was = profileApplied.current[`${t.id}:${id}`];
    profileApplied.current[`${t.id}:${id}`] = sig;
    if (changed || (was !== sig && (was !== undefined || sig !== '["","",""]'))) h.reload();
  };
  const setTabProfile = (id: string, profile: string) => {
    const t = app.tabs.find((x) => x.id === id);
    if (!t || t.profile === profile) return;
    app.setPopover(null);
    app.setAnnotations((prev) => prev.filter((a) => a.tabId !== id));
    patchTab(id, { profile, initialUrl: t.url && t.url !== 'about:blank' ? t.url : t.initialUrl });
  };
  const saveProfiles = (list: Profile[]) => {
    setProfiles(list);
    app.profiles = list;
    api.writeProfiles(list).catch((e) => app.flash(errText(e)));
    for (const t of app.tabs) if (t.profile) applyTabProfile(t);
  };
  useEffect(() => {
    if (!activeTab) return;
    app.syncPage();
    app.clearDiagnostics();
    app.setA11y([]);
    const url = app.tabs.find((t) => t.id === activeTab)?.url || '';
    setUrlInput(url === 'about:blank' ? '' : url);
    const id = browser.current?.id();
    if (id != null && (app.cond.anim !== 1 || app.cond.network !== 'normal')) {
      api.setAnimationRate(id, app.cond.anim).catch(() => {});
      api.setNetwork(id, app.cond.network).catch(() => {});
    }
  }, [activeTab]);
  useEffect(() => api.onNewTab((url) => newTab(url)), []);
  const tabUrls = tabs.map((t) => (t.url && t.url !== 'about:blank' ? t.url : t.initialUrl)).join('\n');
  useEffect(() => {
    if (!app.projectDir || !tabs.length) return;
    const t = setTimeout(() => {
      const open = app.tabs.filter((t) => (t.url && t.url !== 'about:blank') || t.initialUrl);
      app.saveSettings({ tabs: tabUrls.split('\n').filter(Boolean), tabProfiles: open.map((t) => t.profile), activeTab: Math.max(0, app.tabs.findIndex((x) => x.id === app.activeTab)) });
    }, 800);
    return () => clearTimeout(t);
  }, [tabUrls, activeTab, app.projectDir]);

  Object.assign(app, { activeTab, applyTabProfile, browser, closeTab, go, handles, loadError, loading, nav, newTab, patchTab, profiles, saveProfiles, setActiveTab, setProfiles, setTabProfile, setTabs, setUrlInput, switchTab, tab, tabs, urlInput, viewAs });
}
