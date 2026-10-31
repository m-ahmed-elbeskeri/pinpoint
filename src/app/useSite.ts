import { originOf, siteKind, twinUrl, type BuildKind } from '../lib/site';
import { matchRoute } from '../lib/urls';
import { useEffect, useState } from 'react';
import type { AppContext } from './context';

export function useSite(app: AppContext) {
  const settings = app.settings;
  const [measured, setMeasured] = useState<{ origin: string; tab: string; build: BuildKind } | null>(null);
  const [twins, setTwins] = useState({ local: '', live: '', homepage: '' });
  const siteOrigin = originOf(app.nav.url);
  const build = measured && measured.origin === siteOrigin && measured.tab === app.activeTab ? measured.build : null;
  const kind = siteKind(app.nav.url, build);
  useEffect(() => {
    if (app.loading || !siteOrigin) return;
    let live = true;
    const t = setTimeout(() => { app.browser.current?.buildKind().then((b) => { if (live) setMeasured({ origin: siteOrigin, tab: app.activeTab, build: b }); }); }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [app.nav.url, app.loading, siteOrigin, app.activeTab]);
  const ownSite = !app.routes.length || !!matchRoute(app.routes, app.nav.url, app.projectDir) || siteOrigin === twins.homepage;
  useEffect(() => {
    if (!siteOrigin || build === null) return;
    if (kind === 'dev') setTwins((t) => (t.local === siteOrigin ? t : { ...t, local: siteOrigin }));
    else if (kind === 'live' && ownSite) {
      setTwins((t) => (t.live === siteOrigin ? t : { ...t, live: siteOrigin }));
      if (app.settings?.liveUrl !== siteOrigin) app.saveSettings({ liveUrl: siteOrigin });
    }
  }, [kind, siteOrigin, build, ownSite]);
  const localOrigin = [twins.local, app.devInfo?.runningUrl || ''].find((o) => o && o !== siteOrigin) || '';
  const liveOrigin = [twins.live, settings?.liveUrl || '', twins.homepage].find((o) => o && o !== siteOrigin) || '';
  const localTwin = kind === 'live' || kind === 'built' ? twinUrl(app.nav.url, localOrigin) : '';

  Object.assign(app, { kind, liveOrigin, localTwin, setTwins, siteOrigin });
}
