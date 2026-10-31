import { THREADS_W } from './shared';
import type { CompareTarget } from '../components/page/CompareView';
import type { ContextTab } from '../components/agent/ContextSheet';
import type { DrawerTab } from '../components/tools/Drawer';
import type { SavedLayout } from '../types';
import { useEffect, useRef, useState } from 'react';
import type { AppContext } from './context';

export function useLayout(app: AppContext) {
  const settings = app.settings;
  const frame = useRef<HTMLDivElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  // Terminal, dev server, network and logs open as tabs beside the page tabs.
  const [toolTabs, setToolTabs] = useState<DrawerTab[]>([]);
  const [resizing, setResizing] = useState<'panel' | 'drawer' | 'device' | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('term');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [zen, setZen] = useState(false);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  useEffect(() => { if (drawerOpen) setToolTabs((l) => (l.includes(drawerTab) ? l : [...l, drawerTab])); }, [drawerOpen, drawerTab]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sheet, setSheet] = useState<ContextTab | null>(null);
  const [diffView, setDiffView] = useState<{ runId: string; path?: string } | null>(null);
  const [compare, setCompare] = useState<CompareTarget | null>(null);
  const [wsOpen, setWsOpen] = useState(false);
  const [enginesOpen, setEnginesOpen] = useState(false);
  const [patchView, setPatchView] = useState<{ title: string; text: string } | null>(null);
  const startResize = (which: 'panel') => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setResizing(which);
    app.dragging.current = true;
    const grid = (e.currentTarget as HTMLElement).closest('.app') as HTMLElement | null;
    const left = app.settings?.panelSide === 'left';
    const tw = app.settings?.threadsHidden ? 0 : THREADS_W;
    let last = 0, frame = 0;
    const paint = () => {
      frame = 0;
      if (!grid || !last) return;
      if (which === 'panel') grid.style.gridTemplateColumns = left ? `${tw}px ${last}px 1fr` : `${tw}px 1fr ${last}px`;
    };
    const move = (ev: PointerEvent) => {
      if (which === 'panel') {
        const w = left ? ev.clientX - tw : window.innerWidth - ev.clientX;
        last = Math.round(Math.min(Math.max(300, w), Math.min(820, window.innerWidth - tw - 480)));
      } else {
        last = Math.round(Math.min(Math.max(120, window.innerHeight - ev.clientY), window.innerHeight * 0.65));
      }
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (frame) cancelAnimationFrame(frame);
      app.dragging.current = false;
      if (last) setPanelWidth(last);
      const a = app.area.current;
      if (a) app.setAvail({ w: Math.floor(a.clientWidth), h: Math.floor(a.clientHeight) });
      setResizing(null);
      if (last) app.saveSettings({ panelWidth: last });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const openTool = (t: DrawerTab) => { setDrawerTab(t); setDrawerOpen(true); };
  const togglePanel = () => app.saveSettings({ panelHidden: !app.settings?.panelHidden });
  const toggleThreads = () => { if (app.zen) setZen(false); else app.saveSettings({ threadsHidden: !app.settings?.threadsHidden }); };
  const toggleZen = () => { if (!app.zen) setDrawerOpen(false); setZen(!app.zen); };
  const saveLayout = (name: string) => {
    const s = app.settings;
    if (!s) return;
    const l: SavedLayout = { name, threadsHidden: !!s.threadsHidden, panelHidden: !!s.panelHidden, panelSide: s.panelSide === 'left' ? 'left' : 'right', panelWidth: panelWidth ?? s.panelWidth ?? 400, statusBar: !!s.statusBar, split: !!s.split };
    app.saveSettings({ layouts: [...(s.layouts || []).filter((x) => x.name !== name), l] });
    app.flash(`Layout saved: ${name}`);
  };
  const applyLayout = ({ name, ...l }: SavedLayout) => {
    setZen(false);
    setPanelWidth(l.panelWidth);
    app.saveSettings(l);
    app.flash(`Layout: ${name}`);
  };
  const left = settings?.panelSide === 'left';
  const threadsOn = !settings?.threadsHidden && !zen;
  const tw = threadsOn ? THREADS_W : 0;
  const pw = settings?.panelHidden ? 0 : panelWidth ?? settings?.panelWidth ?? 400;
  const row2 = left ? "'threads panel stage'" : "'threads stage panel'";
  const statusOn = settings?.statusBar === true && !zen;
  const split = settings?.split === true && drawerOpen;
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: left ? `${tw}px ${pw}px 1fr` : `${tw}px 1fr ${pw}px`,
    gridTemplateRows: `52px 1fr${statusOn ? ' 24px' : ''}`,
    gridTemplateAreas: `'threads top top' ${row2}${statusOn ? " 'threads status status'" : ''}`,
  };

  Object.assign(app, { applyLayout, compare, diffView, drawerOpen, drawerTab, enginesOpen, frame, gridStyle, historyOpen, layoutsOpen, left, openTool, paletteOpen, patchView, resizing, saveLayout, setCompare, setDiffView, setDrawerOpen, setDrawerTab, setEnginesOpen, setHistoryOpen, setLayoutsOpen, setPaletteOpen, setPanelWidth, setPatchView, setResizing, setSettingsOpen, setSheet, setShortcutsOpen, setTimelineOpen, setToolTabs, setWsOpen, settingsOpen, sheet, shortcutsOpen, split, startResize, statusOn, threadsOn, timelineOpen, togglePanel, toggleThreads, toggleZen, toolTabs, wsOpen, zen });
}
