import { api } from './shared';
import type { ChatActions } from '../components/chat';
import { applyPlan, chatTitle, expireApprovals, finalizeItems, healChat, mergeDeltas, needsInput, splitMemory, type ParkedChat } from '../lib/chat';
import { uid } from '../lib/draw';
import { useChatScroll, useStableActions } from '../lib/hooks';
import type { AgentEvent, AgentId, Annotation, ApprovalDecision, ChatItem, OtherChat } from '../types';
import { errText } from '../lib/util';
import { useEffect, useRef, useState } from 'react';
import type { AppContext } from './context';

export function useChats(app: AppContext) {
  const settings = app.settings;
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [session, setSession] = useState<{ id: string; agent: AgentId } | null>(null);
  const [usage, setUsage] = useState<{ used: number; window?: number } | null>(null);
  const [limits, setLimits] = useState<{ status: 'ok' | 'warning' | 'rejected'; used?: number; resetsAt?: number; window?: string } | null>(null);
  const [mcp, setMcp] = useState<{ name: string; status: string }[]>([]);
  const chatBox = useRef<HTMLDivElement>(null);
  const markBelow = () => {
    const c = chatBox.current;
    if (c) c.parentElement?.classList.toggle('more-below', c.scrollHeight - c.scrollTop - c.clientHeight > 6);
  };
  const [chatId, setChatId] = useState<string | null>(null);
  const openedItems = useRef<ChatItem[] | null>(null);
  const [chatCreated, setChatCreated] = useState(0);
  const [designAtStart, setDesignAtStart] = useState<string | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const { chatEnd, away, onChatScroll, onChatWheel, toLatest, follow } = useChatScroll(chat, runId, job);
  const runRef = useRef<string | null>(null);
  runRef.current = runId;
  useEffect(() => {
    if (!app.projectDir) return;
    api.readDesign().then(app.setDesign).catch(() => app.setDesign(null));
    api.readMemory().then(app.setMemory).catch(() => app.setMemory([]));
    api.readProfiles().then(app.setProfiles).catch(() => app.setProfiles([]));
    api.designSystem().then(app.setDesignSystem).catch(() => app.setDesignSystem(null));
    app.refreshRoutes();
    app.refreshGit();
    api.listChats().then(async (list) => {
      const want = app.wantChat.current;
      app.wantChat.current = null;
      const pick = (want && list.find((c) => c.id === want)) || list[0];
      const last = pick ? await api.loadChat(pick.id) : null;
      if (last?.branch) app.branchOf.current.set(last.id, last.branch);
      if (last) {
        const healed = healChat(last.items);
        openedItems.current = healed === last.items || healed.length === last.items.length ? healed : null;
        setChatId(last.id); setChatCreated(last.createdAt); setChat(healed); setSession(last.session); setDesignAtStart(last.designAtStart ?? null);
      } else {
        setChatId(null); setChat([]); setSession(null); setDesignAtStart(null);
      }
    }).catch(() => {});
  }, [app.projectDir, app.refreshRoutes]);
  useEffect(() => {
    if (!app.projectDir || !chatId || !chat.length) return;
    // Opening a chat changes nothing in it: no write, and it keeps its place in the list.
    if (openedItems.current === chat) return;
    const t = setTimeout(() => {
      const title = chatTitle(chat);
      if (!app.branchOf.current.has(chatId) && app.gitStatus?.branch) app.branchOf.current.set(chatId, app.gitStatus.branch);
      api.saveChat({ id: chatId, branch: app.branchOf.current.get(chatId), title, createdAt: chatCreated || Date.now(), updatedAt: Date.now(), agent: app.settings?.agent || 'claude', session, designAtStart, items: chat }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [chat, session, chatId, app.projectDir, designAtStart]);
  const parked = useRef(new Map<string, ParkedChat>());
  const [others, setOthers] = useState<OtherChat[]>([]);
  const syncOthers = (finished?: ParkedChat, seen?: string) => setOthers((o) => [
    ...[...parked.current.values()].map((p) => ({ id: p.id, title: chatTitle(p.items), running: true, needsInput: needsInput(p.items) })),
    ...o.filter((x) => !x.running && !parked.current.has(x.id) && x.id !== seen && x.id !== finished?.id),
    ...(finished ? [{ id: finished.id, title: chatTitle(finished.items), running: false }] : []),
  ]);
  const saveParked = (p: ParkedChat) => api.saveChat({
    branch: app.branchOf.current.get(p.id),
    id: p.id, title: chatTitle(p.items), createdAt: p.createdAt, updatedAt: Date.now(), agent: p.agent, session: p.session, designAtStart: p.designAtStart, items: p.items,
  }).catch(() => {});
  // Unsent annotations belong to the chat they were made in: put aside on switching away, back on return.
  const annByChat = useRef(new Map<string, Annotation[]>());
  const leaveChat = () => {
    if (job || app.variantJob.current) { app.flash('Variants are being made in this chat. Wait for them before switching.'); return false; }
    if (app.queuedRef.current.length) { app.flash('A message is waiting to be sent in this chat. Switch once it has gone out.'); return false; }
    if (app.deltaTimer.current) { clearTimeout(app.deltaTimer.current); app.deltaTimer.current = 0; }
    const items = mergeDeltas(app.chat, app.deltaBuf.current);
    app.deltaBuf.current = [];
    if (chatId && items.length) {
      const p: ParkedChat = { id: chatId, createdAt: chatCreated || Date.now(), items, session: app.session, designAtStart, runId: runRef.current, agent: app.settings?.agent || 'claude' };
      saveParked(p);
      if (p.runId) parked.current.set(p.id, p);
    }
    setRunId(null);
    runRef.current = null;
    app.verifyPending.current = null;
    const key = chatId || 'new';
    if (app.annotations.length) annByChat.current.set(key, app.annotations); else annByChat.current.delete(key);
    app.setAnnotations([]);
    app.setPopover(null);
    return true;
  };
  const restoreAnnotations = (id: string | null) => {
    const back = annByChat.current.get(id || 'new') || [];
    annByChat.current.delete(id || 'new');
    app.setAnnotations(back);
  };
  const showChatReset = () => setUsage(null);
  const showChat = (c: { id: string; createdAt: number; items: ChatItem[]; session: ParkedChat['session']; designAtStart?: string | null }, running: string | null) => {
    showChatReset();
    restoreAnnotations(c.id);
    if (!running) openedItems.current = c.items;
    setChatId(c.id); setChatCreated(c.createdAt); setChat(c.items); setSession(c.session); setDesignAtStart(c.designAtStart ?? null);
    setRunId(running);
    runRef.current = running;
    follow();
  };
  const openChat = async (id: string) => {
    if (id === chatId || !leaveChat()) return;
    const p = parked.current.get(id);
    if (p) {
      parked.current.delete(id);
      showChat(p, p.runId);
    } else {
      const c = await api.loadChat(id);
      if (c?.branch) app.branchOf.current.set(c.id, c.branch);
      if (c) showChat({ ...c, items: healChat(c.items) }, null);
      else { setChatId(null); setChat([]); setSession(null); setDesignAtStart(null); }
    }
    syncOthers(undefined, id);
  };
  const deleteChat = async (id: string) => {
    const p = parked.current.get(id);
    if (p) { if (p.runId) api.cancelAgent(p.runId).catch(() => {}); parked.current.delete(id); }
    await api.deleteChat(id);
    if (id === chatId) {
      if (runRef.current) api.cancelAgent(runRef.current).catch(() => {});
      setRunId(null); runRef.current = null;
      setChatId(null); setChat([]); setSession(null); setDesignAtStart(null);
    }
    syncOthers(undefined, id);
  };
  const parkedEvent = (p: ParkedChat, e: AgentEvent) => {
    const add = (item: ChatItem) => { p.items = [...p.items, item]; };
    switch (e.type) {
      case 'text_delta': p.items = mergeDeltas(p.items, [{ kind: 'text', text: e.text }]); break;
      case 'thinking_delta': p.items = mergeDeltas(p.items, [{ kind: 'thinking', text: e.text }]); break;
      case 'status': add({ kind: 'status', id: uid(), text: e.text }); break;
      case 'session': p.session = { id: e.sessionId, agent: p.agent }; break;
      case 'git': app.branchOf.current.set(p.id, e.branch); app.refreshGit(); break;
      case 'text': { const m = splitMemory(e.text); p.items = finalizeItems(p.items, 'text', m.text, m.extra); break; }
      case 'thinking': p.items = finalizeItems(p.items, 'thinking', e.text); break;
      case 'tool': add({ kind: 'tool', id: uid(), toolId: e.id, name: e.name, detail: e.detail, status: 'running', edits: e.edits, at: Date.now(), parent: e.parent }); break;
      case 'plan': p.items = applyPlan(p.items, e.steps); break;
      case 'limits': setLimits(e.status === 'ok' ? null : e); break;
      case 'mcp': setMcp(e.servers); break;
      case 'approval':
        add({ kind: 'approval', id: uid(), runId: e.runId, approvalId: e.approvalId, tool: e.tool, detail: e.detail, status: 'pending' });
        syncOthers();
        app.notify(`${chatTitle(p.items)} needs your OK: ${e.tool}`);
        app.flash(`Another chat is waiting for your OK: ${chatTitle(p.items)}`);
        break;
      case 'tool_result':
        p.items = p.items.map((it) => (it.kind === 'tool' && it.toolId === e.id ? { ...it, status: e.ok ? 'ok' : 'error', output: e.text || it.output, ms: it.at ? Date.now() - it.at : undefined } : it));
        break;
      case 'error': add({ kind: 'error', id: uid(), text: e.text }); break;
      case 'done':
        app.notify(`${e.ok ? 'Finished' : 'Stopped'}: ${chatTitle(p.items)}`);
        p.items = [
          ...expireApprovals(p.items).map((it) => (it.kind === 'tool' && it.status === 'running' ? { ...it, status: 'ok' as const }
            : (it.kind === 'text' || it.kind === 'thinking') && it.streaming ? { ...it, streaming: false } : it)),
          { kind: 'done', id: uid(), runId: e.runId, ok: e.ok, cost: e.cost, durationMs: e.durationMs, changes: e.changes || [], commit: e.commit || null },
        ];
        p.runId = null;
        parked.current.delete(p.id);
        saveParked(p);
        syncOthers(p);
        app.flash(`${e.ok ? 'Finished' : 'Stopped'} in another chat: ${chatTitle(p.items)}`);
        app.refreshGit();
        if (e.changes?.length) {
          app.refreshRoutes();
          if (/^file:/.test(app.nav.url)) app.browser.current?.reload();
        }
        return;
    }
  };
  const newChat = () => {
    if (job || !app.chat.length) return;
    if (!leaveChat()) return;
    setChat([]); setSession(null); setChatId(null); setDesignAtStart(null); setUsage(null);
    restoreAnnotations(null);
    syncOthers();
    app.focusComposer();
  };
  // A new chat with everything before this message; the message waits in the composer to be changed.
  const forkFrom = async (itemId: string) => {
    if (job) { app.flash('Wait for the variants to finish before forking.'); return; }
    const all = mergeDeltas(app.chat, app.deltaBuf.current);
    const at = all.findIndex((it) => it.id === itemId);
    const msg = all[at];
    if (msg?.kind !== 'user' || !leaveChat()) return;
    const items = healChat(all.slice(0, at));
    const now = Date.now();
    const id = items.length ? uid() : null;
    const gitBranch = chatId ? app.branchOf.current.get(chatId) : undefined;
    if (id) {
      if (gitBranch) app.branchOf.current.set(id, gitBranch);
      await api.saveChat({ id, branch: gitBranch, title: chatTitle(items), createdAt: now, updatedAt: now, agent: app.settings?.agent || 'claude', session: null, designAtStart: null, items });
      showChat({ id, createdAt: now, items, session: null, designAtStart: null }, null);
    } else {
      setChat([]); setSession(null); setChatId(null); setDesignAtStart(null); setUsage(null);
      setRunId(null); runRef.current = null;
      restoreAnnotations(null);
    }
    syncOthers();
    app.setInstruction(msg.text);
    app.setActiveSide(null);
    app.flash('Forked. The original chat is still in the sidebar.');
    app.focusComposer();
  };
  const receiveChat = async () => {
    try {
      const id = await api.receiveChat();
      if (id) { await openChat(id); app.flash('Chat received. The agent gets the conversation with your next message.'); }
    } catch (e) { app.flash(errText(e)); }
  };
  // Undo every run that came after a message, newest first.
  const rewindTo = async (itemId: string) => {
    if (runRef.current || job) { app.flash('Wait for the agent to finish before rewinding.'); return; }
    const at = app.chat.findIndex((it) => it.id === itemId);
    const runs = app.chat.slice(at).filter((it): it is Extract<ChatItem, { kind: 'done' }> => it.kind === 'done' && !it.undone && it.changes.length > 0).reverse();
    if (!runs.length) { app.flash('Nothing to rewind: no files were changed after this message.'); return; }
    for (const r of runs) await app.undoRun(r.id, r.runId);
    app.flash(`Rewound ${runs.length} run${runs.length > 1 ? 's' : ''}.`);
  };
  const approve = (id: string, decision: ApprovalDecision) => {
    const item = app.chat.find((it) => it.id === id);
    if (item?.kind !== 'approval' || item.status !== 'pending') return;
    api.approve(item.runId, item.approvalId, decision).catch(() => {});
    setChat((c) => c.map((it) => (it.id === id && it.kind === 'approval' ? { ...it, status: decision } : it)));
  };
  const chatHandlers = {
    onApprove: approve,
    onRewind: (itemId: string) => rewindTo(itemId),
    onFork: (itemId: string) => { forkFrom(itemId); },
    onEditMessage: (text: string) => {
      app.setInstruction(text);
      app.setActiveSide(null);
      app.focusComposer(30, true);
    },
    onSendText: (text: string) => app.sendText(text),
    onSaveSnippet: (text: string) => app.saveSnippet(text),
    onReload: () => app.browser.current?.reload(),
    onUndo: app.undoRun,
    onReview: (id: string, path?: string) => app.setDiffView({ runId: id, path }),
    onMemory: app.onMemoryAction,
    onRevertFile: app.revertFile,
    onOpenFile: app.openFile,
    onCommit: app.commitRun,
    onCompare: (id: string, pair?: string) => app.setCompare({ runId: id, pair, ...(pair && { title: `Other page: /${pair.replace(/^route-/, '').replace(/^home$/, '')}` }) }),
    onPickVariant: app.pickVariant,
    onMeasureBuild: app.measureBuild,
    onForceSteer: app.forceSteer,
    onFlowFix: app.flowFix,
    onVariantsLive: app.openVariantsLive,
    onOpenLocal: () => { if (app.localTwin) app.go(app.localTwin); else app.quickStartDev(); },
  };
  const chatActions = useStableActions<ChatActions>(chatHandlers);
  const agentReady = settings && app.agents ? app.agents[settings.agent]?.ok : true;
  const agentName = app.harnesses.find((h) => h.id === settings?.agent)?.name || (settings?.agent === 'codex' ? 'Codex' : 'Claude Code');
  const runMeta = runId ? app.runMetaRef.current[runId] : undefined;
  useEffect(() => { markBelow(); });
  const recentFiles = [...new Set(chat.flatMap((it) => (it.kind === 'done' && !it.undone ? it.changes.filter((c) => !c.reverted).map((c) => c.path) : [])))];
  const chatCost = chat.reduce((sum, it) => sum + (it.kind === 'done' && it.cost ? it.cost : 0), 0);
  const modelName = settings?.agent === 'claude' ? settings.claudeModel : settings?.agent === 'codex' ? settings.codexModel : settings?.agentModels?.[settings.agent];

  Object.assign(app, { agentName, agentReady, away, chat, chatActions, chatBox, chatCost, chatEnd, chatId, deleteChat, designAtStart, job, leaveChat, limits, markBelow, mcp, modelName, newChat, onChatScroll, onChatWheel, openChat, others, parked, parkedEvent, receiveChat, recentFiles, runId, runMeta, runRef, session, setChat, setChatCreated, setChatId, setDesignAtStart, setJob, setLimits, setMcp, setRunId, setSession, setUsage, toLatest, usage });
}
