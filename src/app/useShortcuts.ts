import { TOOL_KEYS } from '../components/page/DrawToolbar';
import { layoutReport } from '../lib/layoutReport';
import { useCallback, useEffect } from 'react';
import type { AppContext } from './context';

export function useShortcuts(app: AppContext) {
  const handleKey = useCallback((key: string, e?: KeyboardEvent) => {
    const m = app.mode;
    if (key === 'Escape') { app.setPopover(null); if (m !== 'browse') app.setMode('browse'); return; }
    const k = key.toLowerCase();
    if (k === 'v') app.setMode('browse');
    else if (k === 's') app.setMode('select');
    else if (k === 'd') app.setMode('draw');
    else if (k === 'k') app.setMode('sketch');
    else if (k === 'f' && m !== 'draw' && m !== 'sketch') app.setFrozen(!app.frozen);
    else if ((m === 'draw' || m === 'sketch') && TOOL_KEYS[k]) app.setTool(TOOL_KEYS[k]);
    else return;
    e?.preventDefault();
  }, [app.setMode, app.setFrozen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable;
      const m = app.mode;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { if (e.shiftKey) app.toggleThreads(); else app.togglePanel(); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') { app.setSettingsOpen(true); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === '.') { app.toggleZen(); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') { app.openTool('files'); e.preventDefault(); return; }
      if (!typing && !e.ctrlKey && !e.metaKey && e.key === '?') { app.setShortcutsOpen((o) => !o); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'k') { app.setPaletteOpen((o) => !o); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'j') { app.setDrawerOpen((o) => !o); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') { app.newChat(); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') { app.newSide(); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') { navigator.clipboard?.writeText(layoutReport()); app.flash('Layout report copied. Paste it wherever you report the problem.'); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') { app.newTab(); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing && (m === 'draw' || m === 'sketch')) {
        const target = m === 'sketch' ? app.sketch : app.page;
        e.shiftKey ? target.redo() : target.undo();
        e.preventDefault();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) { if (e.key === 'Escape') (t as HTMLElement).blur?.(); return; }
      handleKey(e.key, e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleKey, app.page, app.sketch]);

  Object.assign(app, { handleKey });
}
