import { api } from './shared';
import { sleep } from '../components/page/BrowserView';
import { pathOf } from '../components/tools/NetworkPanel';
import { uid } from '../lib/draw';
import { probeScript } from '../lib/probes';
import type { Annotation, ChatItem, FlowResult, FlowStep } from '../types';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppContext } from './context';

export function useFlows(app: AppContext) {
  const [rec, setRec] = useState<{ steps: FlowStep[]; startUrl: string } | null>(null);
  const runFlowRef = useRef<Record<string, { steps: FlowStep[]; startUrl: string; seen?: { errors: string[]; failed: string[] } }>>({});
  const tapRef = useRef<{ errors: string[]; failed: string[] } | null>(null);
  // While recording: what the page did after each step, gathered when the next step arrives.
  const trail = useRef<{ step: FlowStep | null; since: number; errorsAt: number; chain: Promise<void>; afters: Map<FlowStep, NonNullable<FlowStep['after']>> } | null>(null);
  const settleStep = (until: number) => {
    const t = trail.current;
    if (!t) return;
    const step = t.step, since = t.since, errorsAt = t.errorsAt;
    t.since = until;
    t.errorsAt = tapRef.current?.errors.length ?? 0;
    t.chain = t.chain.then(async () => {
      const b = app.browser.current;
      const drained = b ? await b.evaluate<string[] | null>(probeScript('tap:drain')).catch(() => null) : null;
      // A full page load drops the probe: switch it back on for the steps still to come.
      if (drained == null && b) await b.evaluate(probeScript('tap:on')).catch(() => {});
      const state = drained || [];
      if (!step) return;
      const requests = app.requests.filter((r) => r.at >= since && r.at < until).slice(0, 8)
        .map((r) => `${r.method} ${pathOf(r.url)} → ${r.status || r.error || 'no answer'}${r.ms != null ? ` (${r.ms} ms)` : ''}`);
      const errors = (tapRef.current?.errors || []).slice(errorsAt).slice(0, 4);
      if (!state.length && !requests.length && !errors.length) return;
      t.afters.set(step, { ...(state.length && { state }), ...(requests.length && { requests }), ...(errors.length && { errors }) });
    });
  };
  useEffect(() => api.onNetworkError((n) => { tapRef.current?.failed.push(`${n.method} ${pathOf(n.url)} (${n.status || n.error})`); }), []);
  const onStep = useCallback((s: FlowStep) => {
    // A navigation is the result of the step before it, so what follows still belongs to that step.
    if (trail.current && s.type !== 'navigate') { settleStep(Date.now()); trail.current.step = s; }
    setRec((r) => {
      if (!r) return r;
      const last = r.steps[r.steps.length - 1];
      if (s.type === 'navigate' && (s.url === r.startUrl && !r.steps.length || last?.url === s.url)) return r;
      return { ...r, steps: [...r.steps, s].slice(-80) };
    });
  }, []);
  const toggleRecording = async () => {
    const b = app.browser.current;
    if (!rec) {
      app.setMode('browse');
      setRec({ steps: [], startUrl: app.nav.url });
      tapRef.current = { errors: [], failed: [] };
      trail.current = { step: null, since: Date.now(), errorsAt: 0, chain: Promise.resolve(), afters: new Map() };
      b?.send('record', true);
      b?.evaluate(probeScript('tap:on')).catch(() => {});
      return;
    }
    b?.send('record', false);
    const t = trail.current;
    trail.current = null;
    const steps = rec.steps;
    setRec(null);
    const seen = tapRef.current;
    tapRef.current = null;
    if (!steps.length) { app.flash('Nothing was recorded.'); return; }
    const n = app.nextN();
    const ann: Annotation = { id: uid(), n, kind: 'flow', note: '', color: app.colorFor(n), steps, startUrl: rec.startUrl, ...(seen && (seen.errors.length || seen.failed.length) && { seen: { errors: seen.errors.slice(-6), failed: seen.failed.slice(-6) } }) };
    app.setAnnotations((prev) => [...prev, ann]);
    app.setActiveId(ann.id);
    app.focusNote(ann.id);
    if (!t) return;
    // Stop is instant; what the page did after the last steps is filled in once it settles.
    await sleep(500);
    trail.current = t;
    settleStep(Date.now());
    trail.current = null;
    await t.chain;
    b?.evaluate(probeScript('tap:off')).catch(() => {});
    if (!t.afters.size) return;
    const withAfter = steps.map((s) => { const after = t.afters.get(s); return after ? { ...s, after } : s; });
    app.setAnnotations((prev) => prev.map((x) => (x.id === ann.id ? { ...x, steps: withAfter } : x)));
  };
  const replayFlow = async (flow: { steps: FlowStep[]; startUrl: string }): Promise<FlowResult | null> => {
    const b = app.browser.current;
    if (!b) return null;
    app.setMode('browse');
    const tap = { errors: [] as string[], failed: [] as string[] };
    tapRef.current = tap;
    try {
      if (app.nav.url === flow.startUrl) b.reload(); else b.load(flow.startUrl);
      await sleep(600);
      for (let i = 0; i < 50 && app.loading; i++) await sleep(200);
      await sleep(900);
      const id = b.id();
      const ran = id != null ? await api.replay(id, flow.steps).catch(() => null) : null;
      await sleep(700);
      return ran ? { done: ran.done, total: ran.total, errors: [...new Set(tap.errors)].slice(0, 6), failed: [...new Set(tap.failed)].slice(0, 6) } : null;
    } finally { if (tapRef.current === tap) tapRef.current = null; }
  };
  const flowFix = (id: string) => {
    const item = app.chat.find((c) => c.kind === 'done' && c.runId === id) as Extract<ChatItem, { kind: 'done' }> | undefined;
    const f = item?.flow;
    if (!f) return;
    const found = [
      f.done < f.total ? `- It stopped at step ${f.done + 1} of ${f.total}: the element that step clicks or types into was not on the page.` : `- All ${f.total} steps ran.`,
      ...f.errors.map((x) => `- Console error: ${x}`),
      ...f.failed.map((x) => `- Failed request: ${x}`),
    ];
    app.setInstruction(`I replayed the steps I recorded after your change and it still isn't right:\n${found.join('\n')}\n\nFind why and fix it.`);
    app.focusComposer(50);
  };

  Object.assign(app, { flowFix, onStep, rec, replayFlow, runFlowRef, tapRef, toggleRecording });
}
