import { MATCH_GOAL, MATCH_ROUNDS, api } from './shared';
import { sleep } from '../components/page/BrowserView';
import { invalidateDiff } from '../components/chat';
import { fitMockup } from '../components/page/MockupOverlay';
import type { AgentRequest } from '../lib/chat';
import { thumbnail, uid } from '../lib/draw';
import { diffOverlay } from '../lib/pixeldiff';
import type { AgentEvent, ChatItem } from '../types';
import { errText } from '../lib/util';
import { useRef, useState } from 'react';
import type { AppContext } from './context';

export function useVariantsAndMockups(app: AppContext) {
  const settings = app.settings;
  const [liveVariants, setLiveVariants] = useState<string | null>(null);
  const variantJob = useRef<{ base: AgentRequest; total: number; index: number; done: { runId: string; index: number; files: number }[] } | null>(null);
  const matchRef = useRef<{ image: string; x: number; y: number; round: number; last: number } | null>(null);
  const nextVariant = async (e: Extract<AgentEvent, { type: 'done' }>) => {
    const j = variantJob.current;
    if (!j) return;
    const n = e.changes?.length || 0;
    if (n) {
      app.setJob(`Saving variant ${j.index} of ${j.total}…`);
      await app.captureAfter(e.runId);
      const r = await api.revertRun(e.runId, null, true).catch(() => null);
      if (r) app.applyRevert(e.runId, r);
      if (e.ok) j.done.push({ runId: e.runId, index: j.index, files: n });
    }
    if (!e.ok || j.index >= j.total) {
      variantJob.current = null;
      app.setJob(null);
      if (j.done.length) app.setChat((c) => [...c, { kind: 'variants', id: uid(), options: j.done, chosen: null }]);
      else if (e.ok) app.flash('None of the variants changed any files.');
      app.setFlushTick((t) => t + 1);
      return;
    }
    app.setJob(`Starting variant ${j.index + 1} of ${j.total}…`);
    await sleep(1500);
    const before = await app.cleanCapture();
    j.index++;
    app.setJob(null);
    const slim = !!app.session;
    const variant = { index: j.index, total: j.total };
    app.startRun({ ...j.base, ...(slim && { instruction: '', annotations: [], overview: undefined }), diagnostics: undefined, note: undefined, variant }, before, { variant, frame: app.runMetaRef.current[e.runId]?.frame });
  };
  const pickVariant = async (itemId: string, id: string) => {
    const item = app.chat.find((c) => c.id === itemId && c.kind === 'variants') as Extract<ChatItem, { kind: 'variants' }> | undefined;
    if (!item || app.runRef.current) return;
    try {
      if (item.chosen && item.chosen !== id) app.applyRevert(item.chosen, await api.revertRun(item.chosen, null, true));
      const r = await api.applyRun(id);
      invalidateDiff(id);
      app.setChat((c) => c.map((it) => (it.id === itemId && it.kind === 'variants' ? { ...it, chosen: id }
        : it.kind === 'done' && it.runId === id ? { ...it, undone: false, changes: it.changes.map((ch) => ({ ...ch, reverted: false })) } : it)));
      app.browser.current?.reload();
      const opt = item.options.find((o) => o.runId === id);
      app.pendingNote.current = `[Pinpoint: the user picked variant ${opt?.index} of the ${item.options.length} you made. Its files are on disk now; the other variants were discarded. Re-read files before editing them.]`;
      app.refreshGit();
      app.flash(r.failed.length ? `Applied, but couldn't restore ${r.failed.join(', ')}` : `Variant ${opt?.index} applied`);
    } catch (e) { app.flash(errText(e)); }
  };
  const mockupGap = async (m: { image: string; x: number; y: number }) => {
    const b = app.browser.current;
    const shot = b && await app.cleanCapture();
    if (!b || !shot) return null;
    try {
      const fitted = await fitMockup(m.image, shot, { x: m.x, y: m.y }, b.size().width);
      const d = await diffOverlay(fitted, shot);
      return { shot, fitted, diff: d.url, pct: d.pct };
    } catch { return null; }
  };
  const matchRequest = (gap: NonNullable<Awaited<ReturnType<typeof mockupGap>>>, round: number, was: number): AgentRequest => ({
    url: app.nav.url, title: app.nav.title, viewport: app.browser.current!.size(),
    instruction: round === 1
      ? `Make this page match the mockup (reference 1). Reference 2 is the page as it renders now, and reference 3 marks in red where the two differ (${gap.pct.toFixed(1)}% of the page). Match the layout, spacing, sizes, colors and type. Keep the page's real content and components where the mockup only has placeholder copy or images, and use the project's design tokens. When you finish, Pinpoint compares the page with the mockup again and sends you what still differs.`
      : `The page was compared with the mockup again after your last change: ${gap.pct.toFixed(1)}% of it still differs (it was ${was.toFixed(1)}%). Reference 3 shows where, in red. Fix the largest remaining differences in layout, spacing, size and color. Leave differences that are only font rendering, real content in place of placeholder content, or images.`,
    annotations: [
      { n: 1, kind: 'reference', note: 'The mockup to match, scaled to the width of the page.', image: gap.fitted, name: 'mockup' },
      { n: 2, kind: 'reference', note: 'The page as it renders now.', image: gap.shot, name: 'page now' },
      { n: 3, kind: 'reference', note: 'Where the page and the mockup differ: differing pixels are red, the rest is greyed out.', image: gap.diff, name: 'differences' },
    ],
    route: app.currentRoute ? { path: app.currentRoute.route, file: app.currentRoute.file, framework: app.currentRoute.framework } : undefined,
  });
  const matchMockup = async () => {
    if (!app.overlay || !settings || app.runRef.current || app.job || app.busy) return;
    if (app.kind === 'live' || app.kind === 'built') { app.flash('Matching a mockup needs the local dev server, so Pinpoint can see each change. Open the page locally first.'); return; }
    if (!settings.projectDir) { app.flash('Pick the project folder the agent should edit.'); return; }
    app.setBusy('Comparing the page with the mockup…');
    try {
      const gap = await mockupGap(app.overlay);
      if (!gap) { app.flash("Couldn't compare the page with the mockup."); return; }
      if (gap.pct <= MATCH_GOAL) { app.flash(`The page already matches the mockup closely (${gap.pct.toFixed(1)}% differs).`); return; }
      matchRef.current = { image: app.overlay.image, x: app.overlay.x, y: app.overlay.y, round: 1, last: gap.pct };
      if (!app.chatId) { app.setChatId(uid()); app.setChatCreated(Date.now()); }
      const thumb = await thumbnail(gap.fitted);
      app.setChat((c) => [...c, { kind: 'user', id: uid(), text: `Match the mockup (${gap.pct.toFixed(1)}% of the page differs now)`, annotations: [{ id: uid(), n: 1, kind: 'reference', note: '', color: app.colorFor(1), image: thumb, name: app.overlay!.name }], agent: settings.agent }]);
      app.setOverlay(null);
      await app.startRun(matchRequest(gap, 1, gap.pct), gap.shot, { match: 1 });
    } finally { app.setBusy(null); }
  };
  const nextMatch = async (e: Extract<AgentEvent, { type: 'done' }>) => {
    const m = matchRef.current;
    if (!m) return;
    const stop = (text: string) => { matchRef.current = null; app.setChat((c) => [...c, { kind: 'status', id: uid(), text }]); };
    if (!e.ok) { matchRef.current = null; return; }
    if (app.runRef.current || app.queuedRef.current.length || app.verifyPending.current !== e.runId) { matchRef.current = null; return; }
    const gap = await mockupGap(m);
    if (!gap || matchRef.current !== m) { matchRef.current = null; return; }
    const now = `${gap.pct.toFixed(1)}% of the page differs from the mockup (it was ${m.last.toFixed(1)}%)`;
    if (gap.pct <= MATCH_GOAL) return stop(`Matched after ${m.round} round${m.round > 1 ? 's' : ''}: ${now}. What is left is mostly font rendering and content.`);
    if (m.round >= MATCH_ROUNDS) return stop(`Stopped after ${m.round} rounds: ${now}. Lay the mockup over the page to see what is left, or point at it and ask.`);
    if (m.last - gap.pct < 0.3) return stop(`Stopped: it is no longer getting closer. ${now[0].toUpperCase()}${now.slice(1)}.`);
    app.setChat((c) => [...c, { kind: 'status', id: uid(), text: `Round ${m.round} done: ${now}. Sending what still differs…` }]);
    const was = m.last;
    m.round++;
    m.last = gap.pct;
    app.startRun(matchRequest(gap, m.round, was), gap.shot, { match: m.round });
  };
  const openVariantsLive = (itemId: string) => {
    const why = app.bgBlocked ? app.bgBlocked.replace(/^Background runs/, 'Live variants')
      : app.kind !== 'dev' ? 'Live variants need the page to be on your local dev server.'
        : !app.settings?.devCommand ? 'Start the dev server from Pinpoint once (the terminal button), so it knows the command to preview each variant with.' : null;
    if (why) { app.flash(why); return; }
    setLiveVariants(itemId);
  };
  const liveItem = liveVariants ? app.chat.find((c) => c.id === liveVariants && c.kind === 'variants') as Extract<ChatItem, { kind: 'variants' }> | undefined : undefined;
  const livePage = (() => { try { const u = new URL(app.nav.url); return u.pathname + u.search; } catch { return '/'; } })();

  Object.assign(app, { liveItem, livePage, matchMockup, matchRef, nextMatch, nextVariant, openVariantsLive, pickVariant, setLiveVariants, variantJob });
}
