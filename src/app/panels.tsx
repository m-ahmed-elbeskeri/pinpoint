import { lazy, Suspense, useState, type ComponentType } from 'react';

// Panels opened now and then load when first opened, so they cost nothing at startup.
// Once the window has settled they load anyway: React 19 holds back newly loaded Suspense content for up to 300ms,
// so a panel whose code is already here is drawn straight away instead.
// `any` because each panel has its own props; the cast below hands them back to its callers.
function deferred<T extends ComponentType<any>>(load: () => Promise<T>) {
  let loaded: T | null = null;
  let pending: Promise<{ default: T }> | null = null;
  const get = () => (pending ??= load().then((c) => { loaded = c; return { default: c }; }));
  const Inner = lazy(get);
  whenIdle(() => get().catch(() => { pending = null; })); // a failed preload is tried again on open
  return function Panel(p: any) {
    // Chosen once per mount: a panel that opened before its code arrived stays as it was, so it never remounts.
    const [Shown] = useState<ComponentType<any>>(() => loaded ?? Inner);
    return <Suspense fallback={null}><Shown {...p} /></Suspense>;
  } as unknown as T;
}
const whenIdle = (fn: () => void) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => fn(), { timeout: 5000 }) : setTimeout(fn, 2000));
export const FilesPanel = deferred(() => import('../components/tools/FilesPanel').then((m) => m.FilesPanel));
export const LayoutsSheet = deferred(() => import('../components/shell/LayoutsSheet').then((m) => m.LayoutsSheet));
export const FlowMapView = deferred(() => import('../components/page/FlowMapView').then((m) => m.FlowMapView));
export const SweepView = deferred(() => import('../components/page/SweepView').then((m) => m.SweepView));
export const ReviewPanel = deferred(() => import('../components/tools/ReviewPanel').then((m) => m.ReviewPanel));
export const VariantsLive = deferred(() => import('../components/page/VariantsLive').then((m) => m.VariantsLive));
export const SettingsModal = deferred(() => import('../components/shell/SettingsModal').then((m) => m.SettingsModal));
export const DiffViewer = deferred(() => import('../components/tools/DiffViewer').then((m) => m.DiffViewer));
export const BranchCompare = deferred(() => import('../components/git/BranchCompare').then((m) => m.BranchCompare));
export const Timeline = deferred(() => import('../components/page/Timeline').then((m) => m.Timeline));
export const MultiView = deferred(() => import('../components/page/MultiView').then((m) => m.MultiView));
export const ContextSheet = deferred(() => import('../components/agent/ContextSheet').then((m) => m.ContextSheet));
export const CompareView = deferred(() => import('../components/page/CompareView').then((m) => m.CompareView));
