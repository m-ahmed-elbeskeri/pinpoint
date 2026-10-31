import { api } from './shared';
import { DEVICE_OFF } from '../components/page/DeviceBar';
import { uid } from '../lib/draw';
import { originOf } from '../lib/site';
import { sweepInstruction, worstShots } from '../lib/sweep';
import type { Annotation, ReviewComment, SweepPage } from '../types';
import { useEffect, useState } from 'react';
import type { AppContext } from './context';

export function useReviewAndSweep(app: AppContext) {
  const [sweepOpen, setSweepOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const sweepPlan = () => {
    const origin = originOf(app.nav.url);
    if (!origin) return { pages: [], crawl: false };
    let here = '/';
    try { const u = new URL(app.nav.url); here = u.pathname + u.search; } catch { /* not a URL yet: keep "/" */ }
    const fixed = app.routes.filter((r) => !r.dynamic && r.route !== app.currentRoute?.route);
    return {
      pages: [{ route: app.currentRoute?.route || here, url: app.nav.url }, ...fixed.slice(0, 11).map((r) => ({ route: r.route, url: origin + r.route }))],
      crawl: !fixed.length,
    };
  };
  const sweepOpenPage = (url: string, width: number) => {
    setSweepOpen(false);
    app.setMulti(false);
    app.setDevice(width ? { on: true, w: width, h: width < 600 ? 844 : 1180, zoom: 'fit', touch: app.device.touch } : DEVICE_OFF);
    app.go(url);
  };
  const sweepFix = async (pages: SweepPage[]) => {
    setSweepOpen(false);
    app.setInstruction(sweepInstruction(pages, (p) => app.routes.find((r) => r.route === p.route)?.file));
    const worst = worstShots(pages);
    const shots = await api.runShots('sweep', worst.map((w) => `${w.page.key}-${w.shot.size}`)).catch(() => ({} as Record<string, string>));
    let n = app.nextN();
    const added: Annotation[] = [];
    for (const w of worst) {
      const image = shots[`${w.page.key}-${w.shot.size}`];
      if (!image) continue;
      added.push({ id: uid(), n, kind: 'reference', color: app.colorFor(n), image, name: `${w.page.route} · ${w.shot.label}`, note: `${w.page.route} as it renders now at ${w.shot.width}px wide. ${w.shot.issues.slice(0, 2).map((i) => i.text).join('. ')}` });
      n++;
    }
    if (added.length) app.setAnnotations((prev) => [...prev, ...added]);
    if (app.settings?.panelHidden) app.saveSettings({ panelHidden: false });
    app.focusComposer(50);
  };
  useEffect(() => {
    api.reviewState().then((s) => { setReviewing(s.running); setReviewComments(s.comments); }).catch(() => {});
    return api.onReviewComment((c) => {
      setReviewComments((list) => [...list, c]);
      app.flash(`${c.name || 'Someone'} left a comment on ${c.path}`);
    });
  }, []);
  const addReviewComments = (list: ReviewComment[]) => {
    const base = originOf(app.nav.url);
    let n = app.nextN();
    const added: Annotation[] = list.map((c) => {
      const note = `${c.text}${c.name ? ` (comment from ${c.name})` : ' (review comment)'}`;
      const pageUrl = base ? base + c.path : undefined;
      const ann: Annotation = c.selector
        ? {
          id: uid(), n, kind: 'element', color: app.colorFor(n), note, pageUrl, viewport: c.viewport.width ? c.viewport : undefined,
          element: { uid: '', selector: c.selector, tag: c.tag || 'div', classes: c.classes, text: c.elText || '', html: c.html, rect: c.rect || { x: 0, y: 0, width: 0, height: 0 } },
        }
        : { id: uid(), n, kind: 'note', color: app.colorFor(n), note, pageUrl, viewport: c.viewport.width ? c.viewport : undefined };
      n++;
      return ann;
    });
    app.setAnnotations((prev) => [...prev, ...added]);
    const ids = new Set(list.map((c) => c.id));
    setReviewComments((cs) => cs.filter((c) => !ids.has(c.id)));
    setReviewOpen(false);
    if (app.settings?.panelHidden) app.saveSettings({ panelHidden: false });
    app.focusComposer(50);
  };

  Object.assign(app, { addReviewComments, reviewComments, reviewOpen, reviewing, setReviewComments, setReviewOpen, setReviewing, setSweepOpen, sweepFix, sweepOpen, sweepOpenPage, sweepPlan });
}
