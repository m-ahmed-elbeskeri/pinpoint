import { api, rememberPrompt } from './shared';
import { sleep, type FrameTarget } from '../components/page/BrowserView';
import { invalidateDiff } from '../components/chat';
import { MAX_VARIANTS, describeConditions } from '../components/page/PageTools';
import { conversationText, mergeRequests, type AgentRequest, type RunMeta } from '../lib/chat';
import { thumbnail, uid } from '../lib/draw';
import { looksSame } from '../lib/pixeldiff';
import type { AgentEvent, ConsoleEntry, FlowResult, RevertResult } from '../types';
import { pairs, partitionOf } from '../lib/urls';
import { errText, stripAnsi } from '../lib/util';
import { useEffect, useRef, useState } from 'react';
import type { AppContext } from './context';

export function useRuns(app: AppContext) {
  const settings = app.settings;
  const runMetaRef = useRef<Record<string, RunMeta>>({});
  const beforeShotRef = useRef<{ id: string; shot: string } | null>(null);
  const verifyPending = useRef<string | null>(null);
  const pendingNote = useRef<string | null>(null);
  const runPageRef = useRef<Record<string, string>>({});
  const locateConsole = async (entries: ConsoleEntry[]): Promise<ConsoleEntry[]> => {
    const located = Promise.all(entries.map(async (c, i) => {
      if (c.level !== 'error' || !c.line || !/^https?:/.test(c.source || '') || i < entries.length - 12) return c;
      const r = await api.resolveSourceMap({ url: c.source!, line: c.line, column: 1 }).catch(() => null);
      return r?.file ? { ...c, file: r.file, fileLine: r.line } : c;
    }));
    return Promise.race([located, sleep(2000).then(() => entries)]);
  };
  const measureBuild = async (runId: string) => {
    app.setBusy('Building the project to measure it…');
    try {
      const build = await api.measureBuild(app.nav.url);
      app.setChat((c) => c.map((it) => (it.kind === 'done' && it.runId === runId ? { ...it, build } : it)));
      if (build.restarted) app.flash('Measured. The dev server was stopped for the build and is starting again.');
    } catch (e) { app.flash(errText(e)); } finally { app.setBusy(null); }
  };
  // Messages waiting for the current run to end, each with the chat message that shows it.
  const queuedRef = useRef<{ itemId: string; request: AgentRequest }[]>([]);
  const [flushTick, setFlushTick] = useState(0);
  const otherRoutes = (url: string, targets: string[] = []) => {
    if (!/^https?:/.test(url)) return undefined;
    let origin = '';
    try { origin = new URL(url).origin; } catch { return undefined; }
    let here = '/';
    try { here = new URL(url).pathname; } catch { /* keep "/" */ }
    const list = [
      { route: app.currentRoute?.route || here, url, current: true },
      ...app.routes.filter((r) => !r.dynamic && r.route !== app.currentRoute?.route).slice(0, 8).map((r) => ({ route: r.route, url: origin + r.route })),
    ];
    const partition = partitionOf(app.tabs.find((t) => t.id === app.activeTab)?.profile || '');
    return { routes: list, currentFile: app.currentRoute?.file, perfUrl: app.settings?.perfCheck === false ? undefined : url, targets, partition };
  };
  const startRun = async (request: AgentRequest, before?: string | null, meta: RunMeta = {}) => {
    if (!settings) return;
    const id = uid();
    runMetaRef.current[id] = { ...meta, startedAt: Date.now(), ...(request.site && { site: request.site.kind }) };
    const asked = request.annotations.flatMap((a) => (a.kind === 'request' && a.request ? [a.request] : []));
    if (!meta.verify && !meta.variant) {
      const mine = runMetaRef.current[id];
      if (asked.length) mine.requests = asked;
      mine.devAnchor = stripAnsi(app.devLog).slice(-200);
      api.serverLogMark().then((n) => { mine.logMark = n; }).catch(() => {});
    }
    const flow = request.annotations.find((a) => a.kind === 'flow' && a.steps?.length);
    if (flow && !meta.verify) app.runFlowRef.current[id] = { steps: flow.steps!, startUrl: flow.startUrl || request.url, seen: flow.seen };
    runPageRef.current[id] = request.url;
    if (before) { beforeShotRef.current = { id, shot: before }; api.saveShot(id, 'before', before).catch(() => {}); }
    app.setAgentLog('');
    app.setRunId(id);
    app.runRef.current = id;
    const sess = app.session;
    const resume = sess && sess.agent === settings.agent ? sess.id : null;
    if (!resume) app.setDesignAtStart(settings.useDesign && app.design?.exists ? app.design.content : '');
    // A forked or handed-over chat, a change of agent, or an agent that can't resume: the new session is told what was said.
    if (!resume && !meta.variant && !meta.verify) {
      const items = app.chat;
      let cut = items.length - 1;
      while (cut >= 0 && items[cut].kind !== 'user') cut--;
      const earlier = conversationText(items.slice(0, Math.max(0, cut)), 6000);
      if (earlier) request = { ...request, carried: earlier };
    }
    try {
      await api.runAgent({ runId: id, request, sessionId: resume, check: meta.variant || meta.verify || request.site ? undefined : otherRoutes(request.url, request.annotations.flatMap((a) => (a.kind === 'element' && a.element ? [a.element.selector] : (a.hits || []).map((h) => h.selector)))) });
    } catch (e) {
      app.setChat((c) => [...c, { kind: 'error', id: uid(), text: errText(e) }]);
      app.setRunId(null);
      app.runRef.current = null;
      app.variantJob.current = null;
      app.setJob(null);
    }
  };
  useEffect(() => {
    if (app.runId || app.variantJob.current || !queuedRef.current.length) return;
    const merged = mergeRequests(queuedRef.current.map((q) => q.request));
    queuedRef.current = [];
    startRun(merged);
  }, [app.runId, flushTick]);
  const unqueue = (itemId: string, edit: boolean) => {
    const q = queuedRef.current.find((x) => x.itemId === itemId);
    if (!q) return;
    queuedRef.current = queuedRef.current.filter((x) => x.itemId !== itemId);
    app.setChat((c) => c.filter((it) => it.id !== itemId));
    if (edit) { app.setInstruction(q.request.instruction); app.focusComposer(); }
    setFlushTick((t) => t + 1);
  };
  // Quick replies and Retry send a fixed text without touching what's typed in the composer.
  const sendOverride = useRef<string | null>(null);
  const sendText = (text: string) => { sendOverride.current = text; send(); };
  const send = async (mode: 'queue' | 'now' | 'bg' = 'queue') => {
    const pasted = sendOverride.current == null ? app.pastes.map((p) => `Pasted text:\n\`\`\`\n${p.text}\n\`\`\``).join('\n\n') : '';
    const typed = [sendOverride.current ?? app.instruction, pasted].filter((x) => x.trim()).join('\n\n');
    const fromBox = sendOverride.current == null;
    sendOverride.current = null;
    if (!settings || app.busy || (mode !== 'bg' && app.job && !app.runRef.current)) return;
    verifyPending.current = null;
    if (mode !== 'bg') app.matchRef.current = null;
    if (!settings.projectDir) {
      app.flash('Pick the project folder the agent should edit.');
      const dir = await api.pickFolder();
      if (!dir) return;
      app.setSettings(await api.getSettings());
    }
    app.setBusy('Preparing request…');
    try {
      let anns = [...app.annotations];
      let n = app.nextN();
      const d = await app.makeDrawing(n);
      if (d) { anns.push(d); n++; app.page.reset(); }
      const s = await app.makeSketch(n);
      if (s) { anns.push(s); app.sketch.reset(); }
      if (!typed.trim() && !anns.length) { app.flash('Pick an element, draw, or type what you want first.'); return; }

      const b = app.browser.current!;
      const hasPage = !!app.nav.url && app.nav.url !== 'about:blank';
      const targets: FrameTarget[] = anns.flatMap((a) => (a.kind === 'element' && a.element && (!a.pageUrl || a.pageUrl === app.nav.url) ? [{ uid: a.element.uid, selector: a.element.selector }] : []));
      let frame: RunMeta['frame'];
      if (hasPage) {
        const at = await b.frame(targets);
        frame = { targets, y: at.y };
        if (targets.length) await sleep(140);
      }
      let overview: string | undefined;
      if (hasPage && (anns.some((a) => a.kind === 'element') || (anns.length === 0 && !app.runRef.current))) {
        b.send('clean');
        await sleep(80);
        try { overview = await b.capture(); } catch { /* the request goes without the overview */ }
      }
      if (app.isolated) app.isolate(null);
      if (anns.some((a) => a.tweaks || a.states?.length || a.textEdit || a.classEdit || a.propEdits)) {
        await Promise.all(anns.map(app.releaseElement));
        await sleep(120);
      }

      const before = hasPage && !app.runRef.current ? await cleanCapture() : null;

      const devTail = stripAnsi(app.devLog).split('\n').slice(-40).join('\n');
      const devHasErrors = app.devRunning && /error|failed|exception/i.test(devTail);
      const hasDiag = app.includeDiag && (app.consoleLog.length || app.netFails.length || devHasErrors);
      const a11yIssues = app.includeA11y && app.a11y.length ? app.a11y : undefined;
      const diagnostics = hasDiag || a11yIssues
        ? { console: hasDiag ? await locateConsole(app.consoleLog) : [], network: hasDiag ? await app.withHandlers(app.withBodies(app.netFails)) : [], devLog: hasDiag && devHasErrors ? devTail : '', a11y: a11yIssues, overlay: (hasDiag && hasPage && await b.errorOverlay()) || undefined }
        : undefined;
      const request: AgentRequest = {
        url: app.nav.url, title: app.nav.title, viewport: { ...b.size(), responsive: app.device.on || undefined },
        breakpoints: app.device.on && app.breakpoints.length ? app.breakpoints : undefined,
        instruction: typed.trim(),
        overview,
        annotations: anns.map(({ id: _i, color: _c, ...a }) => a),
        diagnostics,
        route: app.currentRoute ? { path: app.currentRoute.route, file: app.currentRoute.file, framework: app.currentRoute.framework } : undefined,
        env: app.env.colorScheme || app.env.reducedMotion || app.frozen || describeConditions(app.cond).length || app.mocks.some((m) => m.on) || app.viewAs
          ? { ...app.env, frozen: app.frozen, states: [...describeConditions(app.cond), ...app.mocks.filter((m) => m.on).map((m) => `${m.method} ${m.path} is answered by a mock the user wrote (status ${m.status}), not by the real server`)], ...(app.viewAs && { profile: { name: app.viewAs.name, detail: [app.viewAs.locale, app.viewAs.timezone, app.viewAs.flags?.trim() && `flags: ${pairs(app.viewAs.flags, '=').map(([k, v]) => `${k}=${v}`).join(', ')}`].filter(Boolean).join(', ') } }) }
          : undefined,
        note: pendingNote.current || undefined,
        site: app.kind === 'live' || app.kind === 'built' ? { kind: app.kind, local: app.localTwin || undefined } : undefined,
      };
      pendingNote.current = null;
      if (!app.chatId) { app.setChatId(uid()); app.setChatCreated(Date.now()); }
      const thumbs = await Promise.all(anns.map(async (a) => ({ ...a, image: a.image ? await thumbnail(a.image) : undefined })));

      if (fromBox) { rememberPrompt(app.instruction); app.setInstruction(''); app.setPastes([]); app.setPasteOpen(null); app.historyAt.current = -1; }
      app.setAnnotations([]);
      app.setActiveId(null);
      app.setPopover(null);
      for (const h of Object.values(app.handles.current)) h?.send('clear');
      if (hasDiag) app.clearDiagnostics();
      if (a11yIssues) app.setIncludeA11y(false);

      if (mode === 'bg') {
        const id = uid();
        const title = (request.instruction || anns.map((a) => a.note).find(Boolean) || 'Background request').split('\n')[0].slice(0, 80);
        app.setBgRuns((list) => [...list, { id, title, status: 'running', parent: app.chatId, items: [{ kind: 'user', id: uid(), text: request.instruction || title }] }]);
        try { await api.bgStart({ id, request }); }
        catch (e) { app.setBgRuns((list) => list.filter((r) => r.id !== id)); app.flash(errText(e)); }
        return;
      }

      const running = app.runRef.current;
      if (running) {
        const r = await api.steerAgent({ runId: running, steerId: uid(), request, mode }).catch(() => ({ delivered: false }));
        const itemId = uid();
        app.setChat((c) => [...c, { kind: 'user', id: itemId, text: request.instruction, annotations: thumbs, agent: settings.agent, steer: r.delivered ? mode : 'later' }]);
        if (!r.delivered) {
          queuedRef.current.push({ itemId, request });
          if (mode === 'now') api.cancelAgent(running);
          setFlushTick((t) => t + 1);
        }
        return;
      }

      const total = settings.variants >= 2 ? Math.min(MAX_VARIANTS, settings.variants) : 0;
      app.setChat((c) => [...c, { kind: 'user', id: uid(), text: request.instruction, annotations: thumbs, agent: settings.agent, ...(total && { variants: total }) }]);
      if (total) {
        app.variantJob.current = { base: request, total, index: 1, done: [] };
        await startRun({ ...request, variant: { index: 1, total } }, before, { variant: { index: 1, total }, frame });
      } else await startRun(request, before, { frame });
    } catch (e) {
      app.setChat((c) => [...c, { kind: 'error', id: uid(), text: errText(e) }]);
    } finally { app.setBusy(null); }
  };
  const cancel = () => { app.matchRef.current = null; if (app.runId) api.cancelAgent(app.runId); };
  const forceSteer = async (itemId: string) => {
    const running = app.runRef.current;
    const item = app.chat.find((it) => it.id === itemId);
    if (!running || !item || item.kind !== 'user') return;
    if (item.steer === 'later') api.cancelAgent(running);
    else if (!(await api.nudgeAgent(running).catch(() => false))) { app.flash("The agent couldn't be interrupted just now."); return; }
    app.setChat((c) => c.map((it) => (it.id === itemId && it.kind === 'user' ? { ...it, steer: 'now' as const } : it)));
  };
  const applyRevert = (id: string, r: RevertResult) => {
    invalidateDiff(id);
    app.setChat((c) => c.map((it) => (it.kind === 'done' && it.runId === id
      ? { ...it, undone: r.allReverted, changes: it.changes.map((ch) => (r.restored.includes(ch.path) ? { ...ch, reverted: true } : ch)) }
      : it)));
    if (r.restored.length && /^file:/.test(app.nav.url)) app.browser.current?.reload();
  };
  const revertFile = async (id: string, path: string, force = false) => {
    try {
      const r = await api.revertRun(id, [path], force);
      applyRevert(id, r);
      if (r.conflicts.length) app.flash(`${path} changed after that run. Click revert again to overwrite those later edits too.`);
      else if (r.failed.length) app.flash(`Couldn't restore ${path}`);
      return r;
    } catch (e) { app.flash(errText(e)); return null; }
  };
  const cleanCapture = async (): Promise<string | null> => {
    const b = app.browser.current;
    if (!b) return null;
    await b.hideMarks();
    try { return await b.capture(undefined, true); } catch { return null; } finally { b.send('hide', false); }
  };
  const captureAfter = async (id: string) => {
    const url = runPageRef.current[id];
    if (!url) return;
    await sleep(/^file:/.test(url) ? 500 : 1800);
    for (let i = 0; i < 40 && app.loading; i++) await sleep(200);
    await sleep(400);
    if (app.nav.url !== url) return;
    const frame = runMetaRef.current[id]?.frame;
    const aim = async () => { if (frame) { await app.browser.current?.frame(frame.targets, frame.y); await sleep(150); } };
    await aim();
    let shot = await cleanCapture();
    if (!shot) return;
    const before = beforeShotRef.current?.id === id ? beforeShotRef.current.shot : null;
    const judge = async (after: string): Promise<'none' | 'changed' | undefined> => {
      if (!before) return undefined;
      try { return (await looksSame(before, after)) ? 'none' : 'changed'; } catch { return undefined; }
    };
    let visual = await judge(shot);
    if (visual === 'none' && /^https?:/.test(url) && !(await app.browser.current?.hasHmr())) {
      app.browser.current?.reload();
      await sleep(500);
      for (let i = 0; i < 40 && app.loading; i++) await sleep(200);
      await sleep(700);
      if (app.nav.url === url) await aim();
      const again = app.nav.url === url ? await cleanCapture() : null;
      if (again) { shot = again; visual = await judge(again); }
    }
    await api.saveShot(id, 'after', shot);
    app.setChat((c) => c.map((it) => (it.kind === 'done' && it.runId === id ? { ...it, shots: true, visual } : it)));
  };
  const afterRun = async (e: Extract<AgentEvent, { type: 'done' }>) => {
    const meta = runMetaRef.current[e.runId] || {};
    if (meta.variant) return app.nextVariant(e);
    if (meta.match && app.matchRef.current && (!e.changes?.length || meta.site)) {
      app.matchRef.current = null;
      if (e.ok) app.setChat((c) => [...c, { kind: 'status', id: uid(), text: 'Stopped matching the mockup: the last round changed nothing that can be compared here.' }]);
    }
    if (!e.changes?.length || meta.site) return;
    await captureAfter(e.runId);
    app.runA11y();
    const flow = app.runFlowRef.current[e.runId];
    let replayed: FlowResult | null = null;
    let flowShot: string | null = null;
    if (flow && e.ok && !meta.verify && verifyPending.current === e.runId && !app.runRef.current && !queuedRef.current.length) {
      app.setJob('Replaying the steps you recorded…');
      try {
        replayed = await app.replayFlow(flow);
        flowShot = await cleanCapture();
      } finally { app.setJob(null); }
      if (replayed) {
        const result = { ...replayed, ...(flow.seen && { before: { errors: flow.seen.errors.length, failed: flow.seen.failed.length } }) };
        app.setChat((c) => c.map((it) => (it.kind === 'done' && it.runId === e.runId ? { ...it, flow: result } : it)));
      }
    }
    if (meta.match) return app.nextMatch(e);
    if (meta.verify || !e.ok || !app.settings?.autoVerify) return;
    if (verifyPending.current !== e.runId || app.runRef.current || queuedRef.current.length) return;
    verifyPending.current = null;
    const shots = await api.runShots(e.runId, ['before', 'after']).catch(() => ({} as Record<string, string>));
    if (!shots.after) return;
    if (flowShot) shots.after = flowShot;
    let same = false;
    if (shots.before) { try { same = await looksSame(shots.before, shots.after); } catch { /* different sizes or an unreadable image: counts as not the same */ } }
    const since = meta.startedAt || 0;
    const cons = app.consoleRef.current.filter((c) => c.at >= since);
    const net = app.netRef.current.filter((n) => n.at >= since);
    const again: NonNullable<NonNullable<AgentRequest['verify']>['requests']> = [];
    for (const r of meta.requests || []) {
      const res = await app.browser.current?.sendRequest({ method: r.method, url: r.url, body: r.reqBody });
      if (res) again.push({ method: r.method, url: r.url, before: { status: r.status }, after: { status: res.status, body: res.body, error: res.error } });
    }
    const devNow = stripAnsi(app.devLog);
    const at = meta.devAnchor ? devNow.lastIndexOf(meta.devAnchor) : -1;
    const devSince = (at >= 0 ? devNow.slice(at + meta.devAnchor!.length) : '').split('\n').slice(-60).join('\n').trim();
    const serverSince = meta.logMark != null ? (await api.serverLogSince(meta.logMark).catch(() => '')).split('\n').slice(-60).join('\n').trim() : '';
    const request: AgentRequest = {
      url: app.nav.url, title: app.nav.title, viewport: app.browser.current!.size(),
      instruction: 'Fix what the automatic check of the result found', annotations: [],
      verify: { before: shots.before, after: shots.after, same, ...(again.length && { requests: again }), ...(replayed && { flow: replayed }) },
      diagnostics: cons.length || net.length || devSince || serverSince ? { console: cons, network: app.withBodies(net), devLog: devSince, serverLog: serverSince } : undefined,
    };
    app.setChat((c) => [...c, { kind: 'status', id: uid(), text: 'Checking the result…' }]);
    startRun(request, shots.after, { verify: true });
  };
  const undoRun = async (_doneId: string, id: string) => {
    try {
      const r = await api.revertRun(id, null, false);
      applyRevert(id, r);
      if (r.conflicts.length) {
        app.flash(`${r.conflicts.length} file(s) changed since that run. Review them to revert anyway.`);
        app.setDiffView({ runId: id, path: r.conflicts[0] });
      } else app.flash(r.failed.length ? `Reverted ${r.restored.length}; couldn't restore ${r.failed.join(', ')}` : `Reverted ${r.restored.length} file(s)`);
    } catch (e) { app.flash(errText(e)); }
  };
  const askToFix = () => {
    app.setIncludeDiag(true);
    const cons = app.consoleRef.current, errors = cons.filter((c) => c.level === 'error');
    const list = [
      ...(errors.length ? errors : cons).slice(-4).map((c) => `- ${c.message.split('\n')[0].slice(0, 160)}${c.source ? ` (${c.source.split('/').pop()!.split('?')[0]}${c.line ? `:${c.line}` : ''})` : ''}`),
      ...app.netRef.current.slice(-3).map((n) => `- ${n.method} ${n.url.replace(/^https?:\/\/[^/]+/, '')} failed (${n.status || n.error})`),
    ];
    const ask = `Fix what is breaking this page:\n${list.join('\n')}\n\nThe full errors are attached. Find the cause in the code and fix that, not just the symptom, then tell me what was wrong.`;
    app.setInstruction((t) => (t.trim() ? t : list.length ? ask : 'Fix the errors the dev server is reporting (its output is attached).'));
    app.focusComposer(50);
  };

  Object.assign(app, { afterRun, applyRevert, askToFix, cancel, captureAfter, cleanCapture, forceSteer, measureBuild, otherRoutes, pendingNote, queuedRef, revertFile, runMetaRef, runPageRef, send, sendText, setFlushTick, startRun, undoRun, unqueue, verifyPending });
}
