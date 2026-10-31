import { useEffect, useRef, useState } from 'react';
import { QUICK_SIZES, combo } from '../shared';
import { DEVICE_OFF } from '../../components/page/DeviceBar';
import { TOOLS } from '../../components/tools/Drawer';
import { AppWindow, ArrowLeft, ArrowRight, Boxes, Columns3, DotsThree, Globe, Loader2, Monitor, Plus, RotateCw, ShieldCheck, Smartphone, Snowflake, Tablet, X } from '../../components/ui/icons';
import { failed as requestFailed } from '../../components/tools/NetworkPanel';
import { ConditionsMenu, PinsChip } from '../../components/page/PageTools';
import { RoutePicker } from '../../components/page/RoutePicker';
import { SiteChip } from '../../components/page/SiteChip';
import { ProfileMenu } from '../../components/page/Workbench';
import { twinUrl } from '../../lib/site';
import { tabLabel } from '../../lib/urls';
import type { AppContext } from '../context';

export function PageBar({ app }: { app: AppContext }) {
  const settings = app.settings!;
  const [plusOpen, setPlusOpen] = useState(false);
  const plusTimer = useRef(0);
  const plusLeft = Math.max(8, (document.querySelector('.tab-new-wrap') as HTMLElement | null)?.offsetLeft ?? 8);
  // A tool opened from anywhere (palette, shortcut) closes this menu.
  useEffect(() => { if (app.drawerOpen) setPlusOpen(false); }, [app.drawerOpen, app.drawerTab]);
  // Rarely used controls stay folded behind a ⋯ until asked for.
  const [pageToolsOpen, setPageToolsOpen] = useState(false);
  const [toolsHover, setToolsHover] = useState(false);
  const toolsTimer = useRef(0);
  return (
    <>
      <div className="tabbar">
        <div className="tabstrip">
          {app.tabs.map((t) => (
            <div
              key={t.id} className={`tab ${t.id === app.activeTab && (!app.drawerOpen || app.split) ? 'on' : ''}`} title={t.url || 'New tab'}
              onClick={() => { if (!app.split) app.setDrawerOpen(false); app.switchTab(t.id); }}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); app.closeTab(t.id); } }}
            >
              {t.loading ? <Loader2 size={11} className="spin" /> : <Globe size={11} />}
              <span>{tabLabel(t)}</span>
              {app.annotations.some((a) => a.tabId === t.id) && <i className="tab-pin" title="Has annotations for the next request" />}
              <button className="tab-x" onClick={(e) => { e.stopPropagation(); app.closeTab(t.id); }} title="Close tab"><X size={11} /></button>
            </div>
          ))}
          {app.toolTabs.map((t) => {
            const tool = TOOLS.find((x) => x.id === t)!;
            return (
              <div key={t} className={`tab tool-tab ${app.drawerOpen && app.drawerTab === t ? 'on' : ''}`} title={tool.label} onClick={() => { app.setDrawerTab(t); app.setDrawerOpen(true); }}>
                <tool.icon size={11} />
                <span>{tool.label}</span>
                {t === 'dev' && app.devRunning && <i className="live-dot" />}
                {t === 'net' && app.requests.filter(requestFailed).length > 0 && <i className="tool-count">{app.requests.filter(requestFailed).length}</i>}
                <button className="tab-x" onClick={(e) => { e.stopPropagation(); app.setToolTabs((l) => l.filter((x) => x !== t)); if (app.drawerTab === t) app.setDrawerOpen(false); }} title="Close tab"><X size={11} /></button>
              </div>
            );
          })}
          <div
            className="tab-new-wrap"
            onMouseEnter={() => { clearTimeout(plusTimer.current); setPlusOpen(true); }}
            onMouseLeave={() => { plusTimer.current = window.setTimeout(() => setPlusOpen(false), 200); }}
          >
            <button className="tab-new" onClick={() => { setPlusOpen(false); app.setDrawerOpen(false); app.newTab('about:blank'); }} title="New tab: choose what to open"><Plus size={13} /></button>
          </div>
        </div>
      </div>
      {plusOpen && (
        <div className="plus-menu" onMouseEnter={() => { clearTimeout(plusTimer.current); setPlusOpen(true); }} onMouseLeave={() => { plusTimer.current = window.setTimeout(() => setPlusOpen(false), 200); }} style={{ left: plusLeft }}>
          <button onClick={() => { setPlusOpen(false); app.setDrawerOpen(false); app.newTab(); }}><Globe size={14} /><span>New page</span><kbd>{combo('T')}</kbd></button>
          {TOOLS.map((t) => <button key={t.id} onClick={() => { setPlusOpen(false); app.openTool(t.id); }}><t.icon size={14} /><span>{t.label}</span></button>)}
        </div>
      )}
      <div className="navbar">
        <div className="nav-btns">
          <button className="icon-btn" disabled={!app.nav.canBack} onClick={() => app.browser.current?.back()} title="Back"><ArrowLeft size={16} /></button>
          <button className="icon-btn" disabled={!app.nav.canForward} onClick={() => app.browser.current?.forward()} title="Forward"><ArrowRight size={16} /></button>
          <button className="icon-btn" onClick={() => app.browser.current?.reload()} title="Reload">{app.loading ? <Loader2 size={16} className="spin" /> : <RotateCw size={15} />}</button>
        </div>

        <form className="urlbar" onSubmit={(e) => { e.preventDefault(); app.go(app.urlInput); }}>
          {app.projectDir && /^(https?|file):/.test(app.nav.url) ? (
            <RoutePicker
              routes={app.routes}
              current={app.currentRoute}
              baseUrl={/^file:/.test(app.nav.url) ? 'file:///' + app.projectDir.replace(/\\/g, '/').replace(/^\//, '') : (() => { try { return new URL(app.nav.url).origin; } catch { return ''; } })()}
              getLinks={() => app.browser.current?.links() ?? Promise.resolve([])}
              onGo={app.go}
              onEdit={(u) => { app.setUrlInput(u); setTimeout(() => (document.querySelector('.urlbar input') as HTMLInputElement | null)?.focus(), 30); }}
            />
          ) : <Globe size={14} className="url-icon" />}
          <input value={app.urlInput} onChange={(e) => app.setUrlInput(e.target.value)} onFocus={(e) => e.target.select()} placeholder="localhost:3000, a URL, or a path to an .html file" spellCheck={false} />
          {app.projectDir && !app.loadError && (
            <SiteChip
              kind={app.kind} host={app.siteOrigin.replace(/^https?:\/\//, '')}
              localUrl={app.localTwin} liveUrl={app.kind === 'dev' || app.kind === 'built' ? twinUrl(app.nav.url, app.liveOrigin) : ''}
              canStartDev={!!app.devCommand && !app.devRunning} onGo={app.go} onStartDev={app.quickStartDev}
            />
          )}
        </form>
        {app.projectDir && (
          <div className="nav-pins">
            <PinsChip projectDir={app.projectDir} url={app.nav.url} title={app.nav.title} flash={app.flash} onCompare={(images, title) => app.setCompare({ images, labels: ['Pinned', 'Now'], title })} />
          </div>
        )}
        <ProfileMenu profiles={app.profiles} current={app.tab?.profile || ''} onPick={(p) => app.tab && app.setTabProfile(app.tab.id, p)} onSave={app.saveProfiles} />
        {/* Page tools: one button that shows what's on, and opens a labelled menu on hover (click pins it). */}
        <div className={`vp-tools ${pageToolsOpen ? 'pinned' : ''}`} onMouseEnter={(e) => { if ((e.target as HTMLElement).closest?.('.cond-pop')) return; clearTimeout(toolsTimer.current); setToolsHover(true); }} onMouseLeave={() => { toolsTimer.current = window.setTimeout(() => setToolsHover(false), 220); }}>
          <button type="button" className={`vp-more ${pageToolsOpen || toolsHover ? 'on' : ''}`} onClick={() => setPageToolsOpen(!pageToolsOpen)} title="Page tools: sizes, side by side, components, other browsers, page check, freeze, conditions">
            {app.device.on && !app.multi && (() => { const I = app.device.w < 600 ? Smartphone : app.device.w < 1000 ? Tablet : Monitor; return <I size={14} className="vp-state" />; })()}
            {app.multi && <Columns3 size={14} className="vp-state" />}
            {app.wsOpen && <Boxes size={14} className="vp-state" />}
            {app.frozen && <Snowflake size={14} className="vp-state" />}
            {(app.cond.stress.length > 0 || app.cond.network !== 'normal' || app.cond.anim !== 1) && <span className="vp-state-dot" title="Test conditions are on" />}
            <DotsThree size={15} />
          </button>
          <div className={`vp-toggles ${pageToolsOpen || toolsHover ? 'open' : ''}`}>
            <button type="button" className={app.wsOpen ? 'on' : ''} onClick={() => { if (app.wsOpen) app.browser.current?.closeWorkspace(); app.setWsOpen(!app.wsOpen); }} disabled={!app.projectDir || !/^https?:/.test(app.nav.url)} title="Components: render any component from the project on its own, with its props and variants"><Boxes size={14} /><span className="vp-label">Components</span></button>
            <button type="button" onClick={() => app.setEnginesOpen(true)} disabled={!/^https?:/.test(app.nav.url)} title="Other browsers: see this page in Safari's engine (WebKit) and Firefox"><AppWindow size={14} /><span className="vp-label">Other browsers</span></button>
            <button type="button" className={app.sweepOpen ? 'on' : ''} onClick={() => app.setSweepOpen(true)} disabled={!app.projectDir || !/^https?:/.test(app.nav.url)} title="Check every page at phone, tablet and desktop widths for layout, loading and accessibility problems"><ShieldCheck size={14} /><span className="vp-label">Check every page</span></button>
            <span className="vp-sep" />
            {QUICK_SIZES.map((q) => {
              const on = q.w ? app.device.on && app.device.w === q.w : !app.device.on;
              return <button type="button" key={q.label} className={on && !app.multi ? 'on' : ''} onClick={() => { app.setMulti(false); app.setDevice(q.w ? { on: true, w: q.w, h: q.h, zoom: app.device.zoom, touch: app.device.touch } : DEVICE_OFF); }} title={q.label}><q.icon size={14} /><span className="vp-label">{q.label.split(' (')[0].replace(' × ', '×')}</span></button>;
            })}
            <button type="button" className={app.multi ? 'on' : ''} onClick={() => app.setMulti(!app.multi)} disabled={!/^(https?|file):/.test(app.nav.url)} title="Phone, tablet and desktop side by side"><Columns3 size={14} /><span className="vp-label">Side by side</span></button>
            <span className="vp-sep" />
            <button type="button" className={app.frozen ? 'on' : ''} onClick={() => app.setFrozen(!app.frozen)} title="Freeze the page so open menus, tooltips and popovers stay put. Press F while pointing at the page to keep its hover state (F8 while typing)."><Snowflake size={14} /><span className="vp-label">Freeze</span></button>
            <ConditionsMenu
              value={app.cond} set={app.changeConditions} onStep={app.stepAnimation}
              env={app.env} setEnv={app.setEnv}
              layout={settings.layoutOverlay !== false}
              setLayout={(on) => { app.saveSettings({ layoutOverlay: on }); app.browser.current?.send('layout', on); }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
