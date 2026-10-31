import { lazy, Suspense, type ComponentType } from 'react';

// Panels opened now and then load when first opened, so they cost nothing at startup.
// `any` because each panel has its own props; the cast below hands them back to its callers.
function deferred<T extends ComponentType<any>>(load: () => Promise<T>) {
  const Inner = lazy(() => load().then((c) => ({ default: c })));
  return ((p: any) => <Suspense fallback={null}><Inner {...p} /></Suspense>) as unknown as T;
}
export const FilesPanel = deferred(() => import('../components/tools/FilesPanel').then((m) => m.FilesPanel));
export const LayoutsSheet = deferred(() => import('../components/shell/LayoutsSheet').then((m) => m.LayoutsSheet));
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
