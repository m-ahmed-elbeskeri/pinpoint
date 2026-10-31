import { addSpend, api } from './shared';
import { applyPlan, chatTitle, expireApprovals, finalizeItems, mergeDeltas, splitMemory } from '../lib/chat';
import { uid } from '../lib/draw';
import type { AgentEvent, ChatItem } from '../types';
import { useCallback, useEffect, useRef } from 'react';
import type { AppContext } from './context';

export function useAgentEvents(app: AppContext) {
  const deltaBuf = useRef<{ kind: 'text' | 'thinking'; text: string }[]>([]);
  const deltaTimer = useRef(0);
  const flushDeltas = useCallback(() => {
    deltaTimer.current = 0;
    const buf = deltaBuf.current;
    deltaBuf.current = [];
    if (!buf.length) return;
    app.setChat((c) => mergeDeltas(c, buf));
  }, []);
  const finalizeBlock = (kind: 'text' | 'thinking', text: string, extra: ChatItem[] = []) => {
    if (deltaTimer.current) { clearTimeout(deltaTimer.current); flushDeltas(); }
    app.setChat((c) => finalizeItems(c, kind, text, extra));
  };
  useEffect(() => api.onAgentEvent((e: AgentEvent) => {
    if (e.type === 'routes') {
      const fresh = e.results.find((r) => r.current);
      app.setChat((c) => c.map((it) => {
        if (it.kind !== 'done' || it.runId !== e.runId) return it;
        if (fresh?.changed && it.visual === 'none' && app.nav.url === app.runPageRef.current[e.runId]) {
          app.browser.current?.hasHmr().then((hot) => { if (!hot) app.browser.current?.reload(); });
        }
        return { ...it, ...(e.results.length && { routeCheck: e.results }), ...(e.perf && { perf: e.perf }) };
      }));
      return;
    }
    if (e.runId !== app.runRef.current) {
      const p = [...app.parked.current.values()].find((x) => x.runId === e.runId);
      if (p) app.parkedEvent(p, e);
      return;
    }
    if (e.type === 'done' && e.cost) addSpend(e.cost);
    if (e.type === 'done') { app.setChat(expireApprovals); app.notify(`${e.ok ? 'Finished' : 'Stopped'}: ${chatTitle(app.chat)}`); }
    const push = (item: ChatItem) => app.setChat((c) => {
      const last = c[c.length - 1];
      if (item.kind === 'error' && last?.kind === 'error' && last.text === item.text) return c;
      return [...c, item];
    });
    switch (e.type) {
      case 'text_delta':
      case 'thinking_delta':
        deltaBuf.current.push({ kind: e.type === 'text_delta' ? 'text' : 'thinking', text: e.text });
        if (!deltaTimer.current) deltaTimer.current = window.setTimeout(flushDeltas, 50);
        break;
      case 'status': push({ kind: 'status', id: uid(), text: e.text }); break;
      case 'session': app.setSession({ id: e.sessionId, agent: (app.settings?.agent || 'claude') }); break;
      case 'git': if (app.chatId) app.branchOf.current.set(app.chatId, e.branch); app.refreshGit(); break;
      case 'text': {
        const m = splitMemory(e.text);
        finalizeBlock('text', m.text, m.extra);
        break;
      }
      case 'thinking': finalizeBlock('thinking', e.text); break;
      case 'tool': push({ kind: 'tool', id: uid(), toolId: e.id, name: e.name, detail: e.detail, status: 'running', edits: e.edits, at: Date.now(), parent: e.parent }); break;
      case 'plan': app.setChat((c) => applyPlan(c, e.steps)); break;
      case 'usage': app.setUsage({ used: e.used, window: e.window }); break;
      case 'limits': app.setLimits(e.status === 'ok' ? null : e); break;
      case 'mcp': app.setMcp(e.servers); break;
      case 'approval':
        push({ kind: 'approval', id: uid(), runId: e.runId, approvalId: e.approvalId, tool: e.tool, detail: e.detail, status: 'pending' });
        app.notify(`Waiting for your OK: ${e.tool}`);
        break;
      case 'tool_result':
        app.setChat((c) => c.map((it) => (it.kind === 'tool' && it.toolId === e.id ? { ...it, status: e.ok ? 'ok' : 'error', output: e.text || it.output, ms: it.at ? Date.now() - it.at : undefined } : it)));
        break;
      case 'log': app.addLog('agent', e.text + '\n'); break;
      case 'error': push({ kind: 'error', id: uid(), text: e.text }); break;
      case 'done':
        if (deltaTimer.current) { clearTimeout(deltaTimer.current); flushDeltas(); }
        app.setChat((c) => [
          ...c.map((it) => (it.kind === 'tool' && it.status === 'running' ? { ...it, status: 'ok' as const }
            : (it.kind === 'text' || it.kind === 'thinking') && it.streaming ? { ...it, streaming: false } : it)),
          {
            kind: 'done', id: uid(), runId: e.runId, ok: e.ok, cost: e.cost, durationMs: e.durationMs, changes: e.changes || [], commit: e.commit || null,
            ...(app.runMetaRef.current[e.runId]?.verify && { verify: true }),
            ...(app.runMetaRef.current[e.runId]?.variant && { variant: app.runMetaRef.current[e.runId].variant }),
            ...(app.runMetaRef.current[e.runId]?.site && e.changes?.length && { unseen: app.runMetaRef.current[e.runId].site }),
          },
        ]);
        app.setRunId(null);
        app.runRef.current = null;
        if (e.changes?.length && /^file:/.test(app.nav.url)) app.browser.current?.reload();
        app.refreshGit();
        app.verifyPending.current = e.runId;
        app.afterRun(e);
        if (e.changes?.length) {
          app.refreshRoutes();
          if (e.changes.some((c) => /^DESIGN\.md$/i.test(c.path))) api.readDesign().then(app.setDesign);
        }
        break;
    }
  }), []);

  Object.assign(app, { deltaBuf, deltaTimer });
}
