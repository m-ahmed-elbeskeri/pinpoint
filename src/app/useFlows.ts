import { api } from './shared';
import { sleep } from '../components/page/BrowserView';
import { pathOf } from '../components/tools/NetworkPanel';
import { uid } from '../lib/draw';
import type { Annotation, ChatItem, FlowResult, FlowStep } from '../types';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppContext } from './context';

export function useFlows(app: AppContext) {
  const [rec, setRec] = useState<{ steps: FlowStep[]; startUrl: string } | null>(null);
  const runFlowRef = useRef<Record<string, { steps: FlowStep[]; startUrl: string; seen?: { errors: string[]; failed: string[] } }>>({});
  const tapRef = useRef<{ errors: string[]; failed: string[] } | null>(null);
  useEffect(() => api.onNetworkError((n) => { tapRef.current?.failed.push(`${n.method} ${pathOf(n.url)} (${n.status || n.error})`); }), []);
  const onStep = useCallback((s: FlowStep) => {
    setRec((r) => {
      if (!r) return r;
      const last = r.steps[r.steps.length - 1];
      if (s.type === 'navigate' && (s.url === r.startUrl && !r.steps.length || last?.url === s.url)) return r;
      return { ...r, steps: [...r.steps, s].slice(-80) };
    });
  }, []);
  const toggleRecording = () => {
    const b = app.browser.current;
    if (!rec) {
      app.setMode('browse');
      setRec({ steps: [], startUrl: app.nav.url });
      tapRef.current = { errors: [], failed: [] };
      b?.send('record', true);
      return;
    }
    b?.send('record', false);
    setRec(null);
    const seen = tapRef.current;
    tapRef.current = null;
    if (!rec.steps.length) { app.flash('Nothing was recorded.'); return; }
    const n = app.nextN();
    const ann: Annotation = { id: uid(), n, kind: 'flow', note: '', color: app.colorFor(n), steps: rec.steps, startUrl: rec.startUrl, ...(seen && (seen.errors.length || seen.failed.length) && { seen: { errors: seen.errors.slice(-6), failed: seen.failed.slice(-6) } }) };
    app.setAnnotations((prev) => [...prev, ann]);
    app.setActiveId(ann.id);
    app.focusNote(ann.id);
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
