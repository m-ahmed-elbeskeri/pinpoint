import { api } from './shared';
import { failed as requestFailed, pathOf } from '../components/tools/NetworkPanel';
import { uid } from '../lib/draw';
import { usePageProblems, useRequests } from '../lib/hooks';
import type { Annotation, ApiHandler, Mock, NetRequest, NetworkFailure } from '../types';
import type { AppContext } from './context';

export function useNetwork(app: AppContext) {
  const { consoleLog, netFails, consoleRef, netRef, onConsole, clearDiagnostics } = usePageProblems();
  const { requests, requestsRef, onRequest, clearRequests } = useRequests();
  const withBodies = (fails: NetworkFailure[]): NetworkFailure[] => fails.map((n) => {
    const hit = [...requestsRef.current].reverse().find((r) => r.url === n.url && r.method === n.method && requestFailed(r));
    return hit?.resBody ? { ...n, body: hit.resBody } : n;
  });
  const withHandlers = (fails: NetworkFailure[]) => Promise.all(fails.map(async (n, i) => {
    if (i < fails.length - 8 || !/^https?:/.test(n.url)) return n;
    const h = await api.findHandler(n.url, n.method).catch(() => null);
    return h ? { ...n, handler: `${h.file}:${h.line}` } : n;
  }));
  const addRequest = (r: NetRequest, handler: ApiHandler | null) => {
    const n = app.nextN();
    const ann: Annotation = {
      id: uid(), n, kind: 'request', note: '', color: app.colorFor(n), pageUrl: app.nav.url,
      request: { method: r.method, url: r.url, status: r.status, ms: r.ms, error: r.error, reqBody: r.reqBody, resBody: r.resBody, handler: handler ? { file: handler.file, line: handler.line, sure: handler.sure } : undefined },
    };
    app.setAnnotations((prev) => [...prev, ann]);
    app.setActiveId(ann.id);
    if (app.settings?.panelHidden) app.saveSettings({ panelHidden: false });
    app.focusNote(ann.id);
  };
  const replayRequest = async (r: NetRequest) => {
    const res = await app.browser.current?.sendRequest({ method: r.method, url: r.url, body: r.reqBody });
    app.flash(!res ? 'The page could not send it.' : res.error && !res.status ? `${r.method} ${pathOf(r.url)} failed: ${res.error}` : `${r.method} ${pathOf(r.url)} answered ${res.status} in ${res.ms} ms`);
  };
  const buildMock = (m: Mock) => {
    app.setInstruction(`Build the endpoint ${m.method === 'ANY' ? 'GET' : m.method} ${m.path} in this project's backend. It should answer with status ${m.status} and a body shaped like this (the page is being developed against it as a mock):\n\n${m.body}\n\nFollow how the existing endpoints are written and registered, use real data where the project has it, and tell me when I can switch the mock off.`);
    if (app.settings?.panelHidden) app.saveSettings({ panelHidden: false });
    app.focusComposer(50);
  };

  Object.assign(app, { addRequest, buildMock, clearDiagnostics, clearRequests, consoleLog, consoleRef, netFails, netRef, onConsole, onRequest, replayRequest, requests, withBodies, withHandlers });
}
