import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, Check, Globe, Loader2, Monitor,
  Plus, RotateCw, Send, Smartphone, Square, Tablet,
  Trash2, X, Paperclip, ImagePlus, Zap, CornerDownRight,
  AppWindow, Boxes, CircleDot, Columns3, Snowflake, SquareStack,
} from './components/icons';
import { BrowserView, sleep, type BrowserHandle, type FrameTarget, type PickedElement } from './components/BrowserView';
import { DrawSurface } from './components/DrawSurface';
import { DrawToolbar, TOOL_KEYS } from './components/DrawToolbar';
import { ChatList, invalidateDiff, shortPath, type ChatActions } from './components/Chat';
import { SettingsModal } from './components/SettingsModal';
import { Drawer, type DrawerTab } from './components/Drawer';
import { AgentControls } from './components/AgentControls';
import { Welcome } from './components/Welcome';
import { ContextSheet, type ContextTab } from './components/ContextSheet';
import { ContextBar } from './components/ContextBar';
import { DiffViewer } from './components/DiffViewer';
import { RoutePicker } from './components/RoutePicker';
import { ChatHistory } from './components/ChatHistory';
import { GitPanel } from './components/GitPanel';
import { CompareView, type CompareTarget } from './components/CompareView';
import { looksSame } from './lib/pixeldiff';
import { ElementTools, type ToolSection } from './components/ElementTools';
import { ConditionsMenu, HandoffMenu, MAX_VARIANTS, NO_CONDITIONS, PinsChip, VariantsMenu, describeConditions, type Conditions } from './components/PageTools';
import { MultiView } from './components/MultiView';
import { BackgroundRuns, ComponentsPanel, EnginesView, ProfileMenu } from './components/Workbench';
import { MockupOverlay, fitMockup, type Overlay } from './components/MockupOverlay';
import { DeviceBar, DEVICE_OFF, type Breakpoint, type Device } from './components/DeviceBar';
import { ANNOTATION_COLORS, composite, samplePoints, thumbnail, uid, unionBounds } from './lib/draw';
import type {
  OtherChat,
  A11yIssue, ApiHandler, Mock, NetRequest, NetworkFailure, AgentEvent, AgentId, Annotation, BgRun, ChatItem, Profile, UpdateState, ConsoleEntry, DesignDoc, DesignSystem, DevDetection, FlowStep, ForcedState, Handoff, MemoryItem, Mode, ModelCatalog,
  GitStatus, PageEnv, Rect, RevertResult, RouteInfo, Settings, SourceInfo, Tool,
} from './lib/types';

import { makeTab, matchRoute, normalizeUrl, pairs, partitionOf, tabLabel, type Tab } from './lib/urls';
import { chatTitle, finalizeItems, healChat, mergeDeltas, mergeRequests, splitMemory, type AgentRequest, type ParkedChat, type RunMeta } from './lib/chat';
import { describe, handoffMarkdown, toPlaywright } from './lib/handoff';
import { clampRect, errText, readImage, stripAnsi } from './lib/util';
import { useShapes } from './lib/useShapes';
import { layoutReport } from './lib/layoutReport';
import { useChatScroll, useLogs, usePageProblems, useRequests, useStableActions } from './lib/hooks';
import { NetworkPanel, failed as requestFailed, pathOf } from './components/NetworkPanel';
import { TopBar } from './components/TopBar';
import { EmptyChat } from './components/EmptyChat';
import { AnnotationList } from './components/AnnotationList';

const api = window.pinpoint;
export const isMac = api.platform === 'darwin';
export const MOD = isMac ? '⌘' : 'Ctrl';
document.documentElement.classList.add(`platform-${api.platform}`);
api.onFullscreen((fs) => document.documentElement.classList.toggle('fullscreen', fs));

const QUICK_SIZES = [
  { icon: Monitor, label: 'Fill the window', w: 0, h: 0 },
  { icon: Tablet, label: 'Tablet 820 × 1180 (responsive mode)', w: 820, h: 1180 },
  { icon: Smartphone, label: 'Phone 390 × 844 (responsive mode)', w: 390, h: 844 },
];

export default function App() {
  const browser = useRef<BrowserHandle | null>(null);
  const handles = useRef<Record<string, BrowserHandle | null>>({});
  const frame = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [agents, setAgents] = useState<Record<AgentId, { ok: boolean; version?: string }> | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState('');
  const tab = tabs.find((t) => t.id === activeTab);
  const nav = useMemo(
    () => ({ url: tab?.url || '', title: tab?.title || '', canBack: !!tab?.canBack, canForward: !!tab?.canForward }),
    [tab?.url, tab?.title, tab?.canBack, tab?.canForward],
  );
  const loading = !!tab?.loading;
  const loadError = tab?.error ?? null;
  browser.current = handles.current[activeTab] ?? null;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const patchTab = (id: string, patch: Partial<Tab>) => setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const [mode, setModeState] = useState<Mode>('browse');
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#ff4f3a');
  const [size, setSize] = useState(4);
  const page = useShapes();
  const sketch = useShapes();

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [popover, setPopover] = useState<{ id: string; rect: Rect } | null>(null);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const [chat, setChat] = useState<ChatItem[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [session, setSession] = useState<{ id: string; agent: AgentId } | null>(null);
  const [device, setDevice] = useState<Device>(DEVICE_OFF);
  const [avail, setAvail] = useState({ w: 0, h: 0 });
  const dragging = useRef(false);
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>([]);
  const area = useRef<HTMLDivElement>(null);
  const deviceRef = useRef(device);
  deviceRef.current = device;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [drawerHeight, setDrawerHeight] = useState<number | null>(null);
  const [resizing, setResizing] = useState<'panel' | 'drawer' | 'device' | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('term');
  const { devLog, agentLog, setDevLog, setAgentLog, addLog } = useLogs();
  const [devRunning, setDevRunning] = useState(false);
  const [devInfo, setDevInfo] = useState<DevDetection | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [chatId, setChatId] = useState<string | null>(null);
  const [chatCreated, setChatCreated] = useState(0);
  const [designAtStart, setDesignAtStart] = useState<string | null>(null);
  const [design, setDesign] = useState<DesignDoc | null>(null);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [sheet, setSheet] = useState<ContextTab | null>(null);
  const [diffView, setDiffView] = useState<{ runId: string; path?: string } | null>(null);
  const { consoleLog, netFails, consoleRef, netRef, onConsole, clearDiagnostics } = usePageProblems();
  const { requests, requestsRef, onRequest, clearRequests } = useRequests();
  const [mocks, setMocks] = useState<Mock[]>([]);
  const mocksRef = useRef(mocks);
  mocksRef.current = mocks;
  const devLogRef = useRef(devLog);
  devLogRef.current = devLog;
  const [includeDiag, setIncludeDiag] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [compare, setCompare] = useState<CompareTarget | null>(null);
  const [env, setEnv] = useState<PageEnv>({ colorScheme: null, reducedMotion: false });
  const [frozen, setFrozenState] = useState(false);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [toolSection, setToolSection] = useState<ToolSection | null>(null);
  const [classNames, setClassNames] = useState<string[]>([]);
  const [generated, setGenerated] = useState<string[]>([]);
  const twTimer = useRef<ReturnType<typeof setTimeout>>();
  const [isolated, setIsolated] = useState<string | null>(null);
  const [cond, setCond] = useState<Conditions>(NO_CONDITIONS);
  const [multi, setMulti] = useState(false);
  const [rec, setRec] = useState<{ steps: FlowStep[]; startUrl: string } | null>(null);
  const recRef = useRef(rec);
  recRef.current = rec;
  const condRef = useRef(cond);
  condRef.current = cond;
  const runFlowRef = useRef<Record<string, { steps: FlowStep[]; startUrl: string }>>({});
  const [designSystem, setDesignSystem] = useState<DesignSystem | null>(null);
  const [a11y, setA11y] = useState<A11yIssue[]>([]);
  const [includeA11y, setIncludeA11y] = useState(false);
  const [job, setJob] = useState<string | null>(null);
  const { chatEnd, away, onChatScroll, onChatWheel, toLatest, follow } = useChatScroll(chat, runId, job);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const viewAs = profiles.find((p) => p.id === tab?.profile);
  const profileApplied = useRef<Record<string, string>>({});
  const [plan, setPlan] = useState<{ ok: boolean; summary?: string[]; reason?: string } | null>(null);
  const [wsOpen, setWsOpen] = useState(false);
  const [enginesOpen, setEnginesOpen] = useState(false);
  const [bgRuns, setBgRuns] = useState<BgRun[]>([]);
  const [bgBlocked, setBgBlocked] = useState<string | null>(null);
  const [patchView, setPatchView] = useState<{ title: string; text: string } | null>(null);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const runMetaRef = useRef<Record<string, RunMeta>>({});
  const beforeShotRef = useRef<{ id: string; shot: string } | null>(null);
  const variantJob = useRef<{ base: AgentRequest; total: number; index: number; done: { runId: string; index: number; files: number }[] } | null>(null);
  const verifyPending = useRef<string | null>(null);
  const pendingNote = useRef<string | null>(null);
  const axeRef = useRef<string | null>(null);
  const runPageRef = useRef<Record<string, string>>({});
  const loadingRef = useRef(false);
  loadingRef.current = loading;
  const fileInput = useRef<HTMLInputElement>(null);

  const runRef = useRef<string | null>(null);
  runRef.current = runId;
  const navRef = useRef(nav);
  navRef.current = nav;
  const annRef = useRef(annotations);
  annRef.current = annotations;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const envRef = useRef(env);
  envRef.current = env;
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500); };

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setUrlInput(s.projectDir ? s.url : '');
      const urls = !s.projectDir ? [''] : s.tabs?.length ? s.tabs : [s.url || ''];
      const list = urls.map((u, i) => makeTab(u ? normalizeUrl(u) : '', s.tabProfiles?.[i] || ''));
      setTabs(list);
      setActiveTab(list[Math.min(s.activeTab || 0, list.length - 1)].id);
    });
    api.detectAgents().then(setAgents);
    api.modelCatalog().then(setCatalog);
  }, []);

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await api.setSettings(patch);
    setSettings(next);
    if ('claudePath' in patch || 'codexPath' in patch) api.detectAgents().then(setAgents);
  }, []);

  const projectDir = settings?.projectDir || '';
  const refreshRoutes = useCallback(() => { api.listRoutes().then(setRoutes).catch(() => setRoutes([])); }, []);
  const refreshGit = useCallback(async () => { await api.gitStatus().then(setGitStatus).catch(() => setGitStatus(null)); }, []);

  useEffect(() => {
    if (!projectDir) return;
    api.readDesign().then(setDesign).catch(() => setDesign(null));
    api.readMemory().then(setMemory).catch(() => setMemory([]));
    api.readProfiles().then(setProfiles).catch(() => setProfiles([]));
    api.designSystem().then(setDesignSystem).catch(() => setDesignSystem(null));
    refreshRoutes();
    refreshGit();
    api.listChats().then(async (list) => {
      const last = list[0] ? await api.loadChat(list[0].id) : null;
      if (last) {
        setChatId(last.id); setChatCreated(last.createdAt); setChat(healChat(last.items)); setSession(last.session); setDesignAtStart(last.designAtStart ?? null);
      } else {
        setChatId(null); setChat([]); setSession(null); setDesignAtStart(null);
      }
    }).catch(() => {});
  }, [projectDir, refreshRoutes]);

  useEffect(() => {
    if (!projectDir || !chatId || !chat.length) return;
    const t = setTimeout(() => {
      const title = chatTitle(chat);
      api.saveChat({ id: chatId, title, createdAt: chatCreated || Date.now(), updatedAt: Date.now(), agent: settingsRef.current?.agent || 'claude', session, designAtStart, items: chat }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [chat, session, chatId, projectDir, designAtStart]);

  const parked = useRef(new Map<string, ParkedChat>());
  const [others, setOthers] = useState<OtherChat[]>([]);
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const syncOthers = (finished?: ParkedChat, seen?: string) => setOthers((o) => [
    ...[...parked.current.values()].map((p) => ({ id: p.id, title: chatTitle(p.items), running: true })),
    ...o.filter((x) => !x.running && !parked.current.has(x.id) && x.id !== seen && x.id !== finished?.id),
    ...(finished ? [{ id: finished.id, title: chatTitle(finished.items), running: false }] : []),
  ]);
  const saveParked = (p: ParkedChat) => api.saveChat({
    id: p.id, title: chatTitle(p.items), createdAt: p.createdAt, updatedAt: Date.now(), agent: p.agent, session: p.session, designAtStart: p.designAtStart, items: p.items,
  }).catch(() => {});

  const leaveChat = () => {
    if (job || variantJob.current) { flash('Variants are being made in this chat. Wait for them before switching.'); return false; }
    if (queuedRef.current.length) { flash('A message is waiting to be sent in this chat. Switch once it has gone out.'); return false; }
    if (deltaTimer.current) { clearTimeout(deltaTimer.current); deltaTimer.current = 0; }
    const items = mergeDeltas(chatRef.current, deltaBuf.current);
    deltaBuf.current = [];
    if (chatId && items.length) {
      const p: ParkedChat = { id: chatId, createdAt: chatCreated || Date.now(), items, session: sessionRef.current, designAtStart, runId: runRef.current, agent: settingsRef.current?.agent || 'claude' };
      saveParked(p);
      if (p.runId) parked.current.set(p.id, p);
    }
    setRunId(null);
    runRef.current = null;
    verifyPending.current = null;
    return true;
  };
  const showChat = (c: { id: string; createdAt: number; items: ChatItem[]; session: ParkedChat['session']; designAtStart?: string | null }, running: string | null) => {
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
      case 'git': refreshGit(); break;
      case 'text': { const m = splitMemory(e.text); p.items = finalizeItems(p.items, 'text', m.text, m.extra); break; }
      case 'thinking': p.items = finalizeItems(p.items, 'thinking', e.text); break;
      case 'tool': add({ kind: 'tool', id: uid(), toolId: e.id, name: e.name, detail: e.detail, status: 'running' }); break;
      case 'tool_result':
        p.items = p.items.map((it) => (it.kind === 'tool' && it.toolId === e.id ? { ...it, status: e.ok ? 'ok' : 'error', output: e.text || it.output } : it));
        break;
      case 'error': add({ kind: 'error', id: uid(), text: e.text }); break;
      case 'done':
        p.items = [
          ...p.items.map((it) => (it.kind === 'tool' && it.status === 'running' ? { ...it, status: 'ok' as const }
            : (it.kind === 'text' || it.kind === 'thinking') && it.streaming ? { ...it, streaming: false } : it)),
          { kind: 'done', id: uid(), runId: e.runId, ok: e.ok, cost: e.cost, durationMs: e.durationMs, changes: e.changes || [], commit: e.commit || null },
        ];
        p.runId = null;
        parked.current.delete(p.id);
        saveParked(p);
        syncOthers(p);
        flash(`${e.ok ? 'Finished' : 'Stopped'} in another chat: ${chatTitle(p.items)}`);
        refreshGit();
        if (e.changes?.length) {
          refreshRoutes();
          if (/^file:/.test(navRef.current.url)) browser.current?.reload();
        }
        return;
    }
  };
  const parkedEventRef = useRef(parkedEvent);
  parkedEventRef.current = parkedEvent;

  const applyEnv = useCallback(async (e: PageEnv, isFrozen: boolean) => {
    const id = browser.current?.id();
    if (id == null) return;
    browser.current?.send('scheme', e.colorScheme);
    const touch = deviceRef.current.on && deviceRef.current.touch && modeRef.current === 'browse';
    try { await api.emulate(id, { ...e, focus: isFrozen, touch }); } catch (err) { flash(errText(err)); }
  }, []);
  useEffect(() => { applyEnv(env, frozen); }, [env, frozen, applyEnv, device.on, device.touch, mode]);

  const onFrozen = useCallback(async (on: boolean) => {
    setFrozenState(on);
    const b = browser.current;
    const id = b?.id();
    if (!b || id == null) return;
    try {
      await api.forceState(id, '[data-pinpoint-hover]', on ? ['hover'] : []);
      await api.setAnimationRate(id, on ? 0 : condRef.current.anim);
    } catch (err) { flash(errText(err)); }
    if (!on) b.send('thaw');
  }, []);
  const setFrozen = useCallback((on: boolean) => { browser.current?.send('freeze', on); onFrozen(on); }, [onFrozen]);

  const runA11y = useCallback(async () => {
    if (settingsRef.current?.a11yCheck === false || !/^(https?|file):/.test(navRef.current.url)) { setA11y([]); return; }
    try {
      axeRef.current ??= await api.a11ySource();
      const res = await browser.current?.a11y(axeRef.current);
      if (res) setA11y(res);
    } catch {  }
  }, []);
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => {
      browser.current?.breakpoints().then(setBreakpoints);
      browser.current?.classNames().then(setClassNames);
      if (condRef.current.stress.length) browser.current?.send('stress', condRef.current.stress);
    }, 1500);
    const audit = setTimeout(runA11y, 2500);
    const warmup = setTimeout(() => {
      const warm = otherRoutes(navRef.current.url);
      if (warm?.routes.length && !runRef.current) api.prewarmRoutes(warm.routes, warm.partition).catch(() => {});
    }, 5000);
    return () => { clearTimeout(t); clearTimeout(audit); clearTimeout(warmup); };
  }, [nav.url, loading, settings?.a11yCheck, runA11y]);

  const changeConditions = async (next: Conditions) => {
    const prev = condRef.current;
    setCond(next);
    const b = browser.current;
    const id = b?.id();
    if (!b || id == null) return;
    try {
      if (next.stress.join() !== prev.stress.join()) b.send('stress', next.stress);
      if (next.anim !== prev.anim) await api.setAnimationRate(id, next.anim);
      if (next.network !== prev.network) { await api.setNetwork(id, next.network); b.reload(); }
    } catch (e) { flash(errText(e)); }
  };
  const stepAnimation = async () => {
    const id = browser.current?.id();
    if (id == null) return;
    try { await api.setAnimationRate(id, 1); await sleep(100); await api.setAnimationRate(id, 0); } catch (e) { flash(errText(e)); }
  };

  const onStep = useCallback((s: FlowStep) => {
    setRec((r) => {
      if (!r) return r;
      const last = r.steps[r.steps.length - 1];
      if (s.type === 'navigate' && (s.url === r.startUrl && !r.steps.length || last?.url === s.url)) return r;
      return { ...r, steps: [...r.steps, s].slice(-80) };
    });
  }, []);
  const toggleRecording = () => {
    const b = browser.current;
    if (!rec) {
      setMode('browse');
      setRec({ steps: [], startUrl: navRef.current.url });
      b?.send('record', true);
      return;
    }
    b?.send('record', false);
    setRec(null);
    if (!rec.steps.length) { flash('Nothing was recorded.'); return; }
    const n = nextN();
    const ann: Annotation = { id: uid(), n, kind: 'flow', note: '', color: colorFor(n), steps: rec.steps, startUrl: rec.startUrl };
    setAnnotations((prev) => [...prev, ann]);
    setActiveId(ann.id);
    setTimeout(() => document.querySelector<HTMLTextAreaElement>(`[data-note="${ann.id}"]`)?.focus(), 50);
  };
  const replayFlow = async (flow: { steps: FlowStep[]; startUrl: string }) => {
    const b = browser.current;
    if (!b) return;
    setMode('browse');
    if (navRef.current.url === flow.startUrl) b.reload(); else b.load(flow.startUrl);
    await sleep(600);
    for (let i = 0; i < 50 && loadingRef.current; i++) await sleep(200);
    await sleep(900);
    const id = b.id();
    if (id != null) await api.replay(id, flow.steps).catch(() => null);
    await sleep(500);
  };

  const buildHandoff = (): Handoff => ({
    pinpointHandoff: 1, createdAt: Date.now(), url: navRef.current.url, title: navRef.current.title,
    viewport: browser.current?.size(), instruction: instruction.trim(), annotations: annRef.current,
  });
  const exportHandoff = async () => {
    const h = buildHandoff();
    const name = (h.instruction || h.annotations.map((a) => a.note).find(Boolean) || 'request').split('\n')[0].replace(/[^\w -]+/g, '').trim().slice(0, 40) || 'request';
    try {
      const file = await api.saveHandoff(name, h);
      if (file) flash(`Saved ${file.split(/[\\/]/).pop()}. Send it to whoever will run it.`);
    } catch (e) { flash(errText(e)); }
  };
  const copyHandoff = () => { navigator.clipboard?.writeText(handoffMarkdown(buildHandoff(), root)); flash('Request copied as Markdown.'); };
  const issueHandoff = async () => {
    const h = buildHandoff();
    const title = (h.instruction || h.annotations.map((a) => a.note).find(Boolean) || 'Visual change request').split('\n')[0].slice(0, 80);
    const attach = h.annotations.some((a) => a.image) ? { name: title, data: h } : undefined;
    try {
      const r = await api.handoffIssue({ title, body: handoffMarkdown(h, root), attach });
      flash(attach && !r.gist ? "Issue created, but the screenshots couldn't be uploaded. Send the hand-off file separately." : 'Issue created and opened in your browser.');
    } catch (e) { flash(errText(e)); }
  };
  const importHandoff = async () => {
    try {
      const h = await api.openHandoff();
      if (!h) return;
      let n = nextN();
      const added = h.annotations.map((a) => ({ ...a, id: uid(), n: n++, color: colorFor(n - 1) }));
      setAnnotations((prev) => [...prev, ...added]);
      if (h.instruction) setInstruction((t) => (t.trim() ? `${t}\n\n${h.instruction}` : h.instruction));
      flash(`Loaded ${added.length} annotation${added.length === 1 ? '' : 's'} made on ${h.url}. Review, then send.`);
    } catch (e) { flash(errText(e)); }
  };

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (dragging.current && !deviceRef.current.on) return;
      const w = Math.floor(e.contentRect.width), h = Math.floor(e.contentRect.height);
      setAvail((a) => (a.w === w && a.h === h ? a : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!settings]);

  const startDeviceResize = (axis: 'x' | 'y' | 'xy') => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as Element;
    el.setPointerCapture(e.pointerId);
    setResizing('device');
    const sx = e.clientX, sy = e.clientY, k = deviceScale;
    const w0 = device.w, h0 = device.h || Math.round(deviceH);
    const move = (ev: PointerEvent) => {
      const w = axis === 'y' ? w0 : Math.min(3840, Math.max(240, Math.round(w0 + ((ev.clientX - sx) * 2) / k)));
      const h = axis === 'x' ? device.h : Math.min(3840, Math.max(240, Math.round(h0 + (ev.clientY - sy) / k)));
      setDevice((d) => ({ ...d, w, h }));
    };
    const up = () => { el.removeEventListener('pointermove', move as EventListener); el.removeEventListener('pointerup', up); setResizing(null); };
    el.addEventListener('pointermove', move as EventListener);
    el.addEventListener('pointerup', up);
  };
  const askA11y = () => {
    setIncludeA11y(true);
    setInstruction((t) => (t.trim() ? t : 'Fix the accessibility problems listed in the diagnostics.'));
    setTimeout(() => composerRef.current?.focus(), 50);
  };

  const designChanged = !!session && designAtStart !== null && (settings?.useDesign && design?.exists ? design.content : '') !== designAtStart;

  const currentRoute = useMemo(() => matchRoute(routes, nav.url, projectDir), [routes, nav.url, projectDir]);

  const enrichSource = async (src: SourceInfo | null | undefined): Promise<SourceInfo | null> => {
    if (!src) return null;
    if (src.frame) {
      const r = await api.resolveSourceMap(src.frame).catch(() => null);
      if (r?.file) return { ...src, file: r.file, line: r.line, column: r.column };
    }
    return src;
  };

  const locateConsole = async (entries: ConsoleEntry[]): Promise<ConsoleEntry[]> => {
    const located = Promise.all(entries.map(async (c, i) => {
      if (c.level !== 'error' || !c.line || !/^https?:/.test(c.source || '') || i < entries.length - 12) return c;
      const r = await api.resolveSourceMap({ url: c.source!, line: c.line, column: 1 }).catch(() => null);
      return r?.file ? { ...c, file: r.file, fileLine: r.line } : c;
    }));
    return Promise.race([located, sleep(2000).then(() => entries)]);
  };

  const go = (raw: string) => {
    const url = normalizeUrl(raw);
    if (!url) return;
    setUrlInput(url);
    browser.current?.load(url);
    saveSettings({ url });
  };

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    setPopover(null);
    browser.current?.send('mode', m === 'select' ? 'select' : 'browse');
  }, []);

  const applyMocks = useCallback(() => {
    const id = browser.current?.id();
    if (id == null) return;
    api.setMocks(id, mocksRef.current.filter((m) => m.on)).catch((err) => flash(errText(err)));
  }, []);
  useEffect(() => { applyMocks(); }, [mocks, applyMocks]);

  const syncPage = useCallback(() => {
    browser.current?.send('mode', modeRef.current === 'select' ? 'select' : 'browse');
    browser.current?.send('markers', markerList(annRef.current, null));
    applyEnv(envRef.current, frozenRef.current);
    applyMocks();
    browser.current?.send('layout', settingsRef.current?.layoutOverlay !== false);
    browser.current?.send('record', !!recRef.current);
    if (condRef.current.stress.length) browser.current?.send('stress', condRef.current.stress);
  }, [applyEnv]);

  useEffect(() => {
    browser.current?.send('markers', markerList(annotations.filter((a) => !a.tabId || a.tabId === activeTab), activeId));
  }, [annotations, activeId, activeTab]);

  const switchTab = (id: string) => {
    if (id === activeTabRef.current) return;
    browser.current?.send('mode', 'browse');
    if (frozenRef.current) setFrozen(false);
    if (isolated) isolate(null);
    setPopover(null);
    setMulti(false);
    setActiveTab(id);
  };
  const newTab = (url?: string) => {
    let start = url || '';
    if (!start) { try { const u = new URL(navRef.current.url); if (/^https?:$/.test(u.protocol)) start = u.origin + '/'; } catch {  } }
    const t = makeTab(start, tabsRef.current.find((x) => x.id === activeTabRef.current)?.profile || '');
    setTabs((ts) => [...ts, t]);
    switchTab(t.id);
  };
  const closeTab = (id: string) => {
    const list = tabsRef.current;
    const i = list.findIndex((t) => t.id === id);
    if (i < 0) return;
    const rest = list.filter((t) => t.id !== id);
    const next = rest.length ? rest : [makeTab('')];
    if (id === activeTabRef.current) switchTab(next[Math.min(i, next.length - 1)].id);
    setTabs(next);
    delete handles.current[id];
    setAnnotations((prev) => prev.filter((a) => a.tabId !== id));
  };
  const applyTabProfile = async (t: Tab) => {
    const h = handles.current[t.id];
    const id = h?.id();
    if (!h || id == null) return;
    const p = profilesRef.current.find((x) => x.id === t.profile);
    const headers = Object.fromEntries(pairs(p?.headers, ':'));
    try { await api.applyProfile(id, { locale: p?.locale?.trim() || '', timezone: p?.timezone?.trim() || '', headers }); } catch (e) { flash(errText(e)); return; }
    const flags = pairs(p?.flags, '=');
    const changed = flags.length ? await h.setStorage(flags) : false;
    const sig = JSON.stringify([p?.locale || '', p?.timezone || '', p?.headers || '']);
    const was = profileApplied.current[`${t.id}:${id}`];
    profileApplied.current[`${t.id}:${id}`] = sig;
    if (changed || (was !== sig && (was !== undefined || sig !== '["","",""]'))) h.reload();
  };
  const setTabProfile = (id: string, profile: string) => {
    const t = tabsRef.current.find((x) => x.id === id);
    if (!t || t.profile === profile) return;
    setPopover(null);
    setAnnotations((prev) => prev.filter((a) => a.tabId !== id));
    patchTab(id, { profile, initialUrl: t.url && t.url !== 'about:blank' ? t.url : t.initialUrl });
  };
  const saveProfiles = (list: Profile[]) => {
    setProfiles(list);
    profilesRef.current = list;
    api.writeProfiles(list).catch((e) => flash(errText(e)));
    for (const t of tabsRef.current) if (t.profile) applyTabProfile(t);
  };

  const editKey = popover ? JSON.stringify((({ tweaks, textEdit, classEdit, reorder, propEdits, states, element }) => [tweaks, textEdit, classEdit, reorder, propEdits, states, element?.source, element?.rules?.length])(annotations.find((a) => a.id === popover.id) || ({} as Annotation))) : '';
  useEffect(() => {
    const a = popover && annRef.current.find((x) => x.id === popover.id);
    if (!a || a.kind !== 'element' || !(a.tweaks || a.textEdit || a.classEdit || a.reorder)) { setPlan(null); return; }
    let live = true;
    const t = setTimeout(() => {
      const { image: _i, ...bare } = a;
      api.instantPlan(bare).then((p) => { if (live) setPlan(p); }).catch(() => { if (live) setPlan(null); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [editKey]);

  const applyInstant = async (id: string) => {
    const a = annRef.current.find((x) => x.id === id);
    if (!a) return;
    const { image: _i, ...bare } = a;
    const runId = uid();
    try {
      const res = await api.instantApply(runId, bare);
      await releaseElement(a);
      (a.tabId ? handles.current[a.tabId] : browser.current)?.send('clear');
      setAnnotations((prev) => prev.filter((x) => x.id !== id));
      setPopover(null);
      if (!chatId) { setChatId(uid()); setChatCreated(Date.now()); }
      setChat((c) => [...c,
        { kind: 'status', id: uid(), text: `Instant edit: ${res.summary.join('; ')}` },
        { kind: 'done', id: uid(), runId, ok: true, changes: res.changes, instant: true },
      ]);
      if (/^file:/.test(navRef.current.url)) browser.current?.reload();
      refreshGit();
    } catch (e) { flash(errText(e)); }
  };

  const onManip = (m: { uid: string; kind: 'resize' | 'reorder'; width?: string | null; height?: string | null; from?: number; to?: number; count?: number; before?: string | null }) => {
    const a = annRef.current.find((x) => x.element?.uid === m.uid);
    if (!a) return;
    if (m.kind === 'resize') {
      if (m.width) tweak(a.id, 'width', m.width);
      if (m.height) tweak(a.id, 'height', m.height);
    } else if (m.from != null && m.to != null) {
      patchAnn(a.id, (x) => ({ ...x, reorder: m.from === m.to ? undefined : { from: m.from!, to: m.to!, count: m.count || 0, before: m.before } }));
    }
    setActiveId(a.id);
  };

  useEffect(() => api.onBgEvent((e) => {
    setBgRuns((list) => list.map((r) => (r.id !== e.id ? r
      : e.type === 'step' ? { ...r, step: e.text }
        : { ...r, status: e.ok && e.files?.length ? 'done' : e.ok ? 'done' : 'failed', files: e.files, summary: e.summary || (e.ok ? 'Finished without changing any files.' : 'The run did not finish.'), shot: e.shot, step: undefined })));
  }), []);
  useEffect(() => { if (projectDir) api.bgBlocker().then(setBgBlocked).catch(() => setBgBlocked('unavailable')); }, [projectDir, gitStatus?.repo, gitStatus?.hasCommits]);
  const applyBg = async (r: BgRun) => {
    const runId = uid();
    try {
      const { changes } = await api.bgApply({ id: r.id, runId, instruction: r.title });
      setBgRuns((list) => list.filter((x) => x.id !== r.id));
      if (!chatId) { setChatId(uid()); setChatCreated(Date.now()); }
      setChat((c) => [...c,
        ...(r.summary ? [{ kind: 'text' as const, id: uid(), text: r.summary }] : []),
        { kind: 'done', id: uid(), runId, ok: true, changes, background: true },
      ]);
      if (/^file:/.test(navRef.current.url)) browser.current?.reload();
      refreshGit();
    } catch (e) { flash(errText(e)); }
  };
  const discardBg = (r: BgRun) => { api.bgDiscard(r.id).catch(() => {}); setBgRuns((list) => list.filter((x) => x.id !== r.id)); };

  useEffect(() => { api.updateState().then(setUpdate).catch(() => {}); return api.onUpdateState(setUpdate); }, []);

  useEffect(() => {
    if (!activeTab) return;
    syncPage();
    clearDiagnostics();
    setA11y([]);
    const url = tabsRef.current.find((t) => t.id === activeTab)?.url || '';
    setUrlInput(url === 'about:blank' ? '' : url);
    const id = browser.current?.id();
    if (id != null && (condRef.current.anim !== 1 || condRef.current.network !== 'normal')) {
      api.setAnimationRate(id, condRef.current.anim).catch(() => {});
      api.setNetwork(id, condRef.current.network).catch(() => {});
    }
  }, [activeTab]);
  useEffect(() => api.onNewTab((url) => newTab(url)), []);
  const tabUrls = tabs.map((t) => (t.url && t.url !== 'about:blank' ? t.url : t.initialUrl)).join('\n');
  useEffect(() => {
    if (!projectDir || !tabs.length) return;
    const t = setTimeout(() => {
      const open = tabsRef.current.filter((t) => (t.url && t.url !== 'about:blank') || t.initialUrl);
      saveSettings({ tabs: tabUrls.split('\n').filter(Boolean), tabProfiles: open.map((t) => t.profile), activeTab: Math.max(0, tabsRef.current.findIndex((x) => x.id === activeTabRef.current)) });
    }, 800);
    return () => clearTimeout(t);
  }, [tabUrls, activeTab, projectDir]);

  const nextN = () => (annRef.current.length ? Math.max(...annRef.current.map((a) => a.n)) + 1 : 1);
  const colorFor = (n: number) => ANNOTATION_COLORS[(n - 1) % ANNOTATION_COLORS.length];

  const onPicked = useCallback(async (el: PickedElement) => {
    const n = nextN();
    const vp = el.viewport;
    const pad = 20;
    const crop = clampRect({ x: el.rect.x - pad, y: el.rect.y - pad, width: el.rect.width + pad * 2, height: el.rect.height + pad * 2 }, vp);
    const { dpr: _d, viewport: _v, shift: _s, ...element } = el;
    const ann: Annotation = { id: uid(), n, kind: 'element', note: '', color: colorFor(n), element, viewport: vp, tabId: activeTabRef.current, pageUrl: navRef.current.url };
    setAnnotations((prev) => [...prev, ann]);
    setActiveId(ann.id);
    setToolSection(null);
    setPopover({ id: ann.id, rect: el.rect });
    try {
      if (crop.width > 2 && crop.height > 2) {
        const image = await browser.current!.capture(crop);
        setAnnotations((prev) => prev.map((a) => (a.id === ann.id ? { ...a, image } : a)));
      }
    } catch {  } finally { browser.current?.send('hide', false); }

    const source = await enrichSource(await browser.current!.locateSource(el.uid));
    const wc = browser.current!.id();
    const [tokens, usage, rules] = await Promise.all([
      browser.current!.tokens(el.uid),
      source?.owner ? api.componentUsage(source.owner).catch(() => null) : null,
      wc != null ? api.matchedRules(wc, el.uid).catch(() => []) : [],
    ]);
    const component = source?.owner ? { name: source.owner, props: source.props, uses: usage?.count, fileCount: usage?.fileCount, files: usage?.files } : null;
    if (source || tokens || rules.length) {
      setAnnotations((prev) => prev.map((a) => (a.id === ann.id ? { ...a, element: { ...a.element!, source, tokens: tokens || undefined, component, rules: rules.length ? rules : undefined } } : a)));
    }
  }, []);

  const patchAnn = (id: string, fn: (a: Annotation) => Annotation) => setAnnotations((prev) => prev.map((a) => (a.id === id ? fn(a) : a)));

  const tweak = (id: string, prop: string, value: string) => {
    const a = annRef.current.find((x) => x.id === id);
    if (!a?.element) return;
    browser.current?.send('tweak', { uid: a.element.uid, prop, value });
    patchAnn(id, (x) => {
      const t = { ...x.tweaks };
      if (value) t[prop] = value; else delete t[prop];
      return { ...x, tweaks: Object.keys(t).length ? t : undefined };
    });
  };
  const resetTweaks = (id: string) => {
    const a = annRef.current.find((x) => x.id === id);
    if (!a?.element) return;
    for (const prop of Object.keys(a.tweaks || {})) browser.current?.send('tweak', { uid: a.element.uid, prop, value: '' });
    patchAnn(id, (x) => ({ ...x, tweaks: undefined }));
  };

  const setStates = async (id: string, states: ForcedState[]) => {
    const a = annRef.current.find((x) => x.id === id);
    const b = browser.current;
    const wc = b?.id();
    if (!a?.element || !b || wc == null) return;
    const uid = a.element.uid;
    const classes = states.flatMap((s) => (s === 'disabled' ? [] : s === 'focus' ? ['focus', 'focus-visible'] : [s]));
    try { await api.forceState(wc, `[data-pinpoint="${uid}"]`, classes); } catch (e) { flash(errText(e)); return; }
    if (states.includes('disabled') !== !!a.states?.includes('disabled')) b.send('setDisabled', { uid, on: states.includes('disabled') });
    patchAnn(id, (x) => ({ ...x, states: states.length ? states : undefined }));
    await sleep(150);
    const fresh = await b.inspect(uid);
    if (!fresh) return;
    const pad = 20;
    const crop = clampRect({ x: fresh.rect.x - pad, y: fresh.rect.y - pad, width: fresh.rect.width + pad * 2, height: fresh.rect.height + pad * 2 }, b.size());
    let image: string | undefined;
    b.send('hide', true);
    await sleep(90);
    try { if (crop.width > 2 && crop.height > 2) image = await b.capture(crop); } catch {  } finally { b.send('hide', false); }
    patchAnn(id, (x) => (x.element ? { ...x, image: image ?? x.image, element: { ...x.element, styles: fresh.styles, html: fresh.html, rect: fresh.rect } } : x));
  };

  const editText = (id: string, text: string) => {
    const a = annRef.current.find((x) => x.id === id);
    if (!a?.element) return;
    browser.current?.send('setText', { uid: a.element.uid, text });
    patchAnn(id, (x) => ({ ...x, textEdit: text === x.element!.text ? undefined : { from: x.element!.text, to: text } }));
  };
  const editClasses = (id: string, value: string) => {
    const a = annRef.current.find((x) => x.id === id);
    if (!a?.element) return;
    const from = (a.element.classes || []).join(' ');
    browser.current?.send('setClass', { uid: a.element.uid, value });
    patchAnn(id, (x) => ({ ...x, classEdit: value === from ? undefined : { from, to: value } }));
    const missing = value.split(/\s+/).filter((c) => c && !classNames.includes(c));
    if (!designSystem?.tailwind || !missing.length) return;
    clearTimeout(twTimer.current);
    twTimer.current = setTimeout(async () => {
      const want = [...new Set([...generated, ...missing])];
      try {
        const css = await api.tailwindCss(want);
        if (css == null) return;
        browser.current?.send('injectCss', css);
        setGenerated(want.filter((c) => css.includes(c.replace(/[^\w-]/g, (ch) => '\\' + ch))));
      } catch {  }
    }, 350);
  };

  const measureBuild = async (runId: string) => {
    setBusy('Building the project to measure it…');
    try {
      const build = await api.measureBuild(navRef.current.url);
      setChat((c) => c.map((it) => (it.kind === 'done' && it.runId === runId ? { ...it, build } : it)));
      if (build.restarted) flash('Measured. The dev server was stopped for the build and is starting again.');
    } catch (e) { flash(errText(e)); } finally { setBusy(null); }
  };

  const typed = (summary: string, raw: string) => (summary.startsWith('"') ? raw : summary === 'true' || summary === 'false' ? raw === 'true' : Number(raw));
  const editProp = async (id: string, name: string, raw: string) => {
    const a = annRef.current.find((x) => x.id === id);
    const comp = a?.element?.component;
    const from = comp?.props?.[name];
    if (!a?.element || !comp || from == null) return;
    const value = typed(from, raw);
    if (typeof value === 'number' && Number.isNaN(value)) { flash(`${name} is a number.`); return; }
    const ok = await browser.current?.setProp(a.element.uid, comp.name, name, value);
    if (!ok) { flash("Couldn't change that prop live. It needs a React development build; reload the page and try again."); return; }
    const to = JSON.stringify(value);
    patchAnn(id, (x) => {
      const edits = { ...x.propEdits };
      if (to === from) delete edits[name]; else edits[name] = { from, to };
      return { ...x, propEdits: Object.keys(edits).length ? edits : undefined };
    });
  };

  const isolate = (id: string | null) => {
    const a = id ? annRef.current.find((x) => x.id === id) : null;
    browser.current?.send('isolate', a?.element?.uid || null);
    setIsolated(a ? id : null);
  };

  const openStory = async (id: string) => {
    const a = annRef.current.find((x) => x.id === id);
    const comp = a?.element?.component;
    if (!comp) return;
    try {
      const s = await api.findStory(comp.name);
      if (s.url) { setPopover(null); go(s.url); return; }
      if (s.file && s.canStart) {
        setPopover(null);
        setBusy('Starting Storybook…');
        try { const url = await api.startStorybook(comp.name); if (url) go(url); } finally { setBusy(null); }
        return;
      }
      if (s.file) { flash(`${s.file} exists, but Storybook isn't running and there's no "storybook" script to start it.`); return; }
      const args = Object.entries(comp.props || {}).filter(([, v]) => v !== 'ƒ').map(([k, v]) => `${k}=${v}`).join(', ');
      setInstruction(
        `Write a Storybook story for <${comp.name}>${a?.element?.source?.file ? ` (${shortPath(a.element.source.file, root)})` : ''}: a default story${args ? ` with these args: ${args}` : ''}, plus one story per meaningful variant and state. `
        + (s.storybook ? 'Follow the conventions of the existing stories.' : "Storybook isn't set up in this project: say what installing it would add and ask before doing it."),
      );
      setPopover(null);
      setTimeout(() => composerRef.current?.focus(), 50);
    } catch (e) { flash(errText(e)); }
  };

  const releaseElement = async (a: Annotation) => {
    const b = (a.tabId && handles.current[a.tabId]) || browser.current;
    const wc = b?.id();
    if (!a.element || !b) return;
    b.send('untweak', a.element.uid);
    const comp = a.element.component;
    for (const [name, edit] of Object.entries(a.propEdits || {})) b.setProp(a.element.uid, comp?.name || '', name, JSON.parse(edit.from));
    if (a.states?.length && wc != null) await api.forceState(wc, `[data-pinpoint="${a.element.uid}"]`, []).catch(() => {});
  };

  const makeDrawing = async (n: number): Promise<Annotation | null> => {
    const b = browser.current;
    if (!b || !page.shapes.length) return null;
    const { width, height } = b.size();
    b.send('hide', true);
    await sleep(90);
    let bg: string | null = null;
    try { bg = await b.capture(); } finally { b.send('hide', false); }
    const image = await composite({ background: bg, width, height, shapes: page.shapes });
    const hits = await b.hitTest(samplePoints(page.shapes));
    const withSource = await Promise.all(hits.map(async (h) => ({ ...h, source: await enrichSource(await b.locateSource(h.uid)) })));
    return { id: uid(), n, kind: 'drawing', note: '', color: colorFor(n), image, region: unionBounds(page.shapes) || undefined, hits: withSource, viewport: { width, height } };
  };

  const makeSketch = async (n: number): Promise<Annotation | null> => {
    if (!sketch.shapes.length || !frame.current) return null;
    const width = frame.current.clientWidth, height = frame.current.clientHeight;
    const image = await composite({ background: null, width, height, shapes: sketch.shapes, board: true });
    return { id: uid(), n, kind: 'sketch', note: '', color: colorFor(n), image, viewport: { width: Math.round(width), height: Math.round(height) } };
  };

  const commitCurrent = async () => {
    setBusy('Capturing…');
    try {
      const ann = mode === 'sketch' ? await makeSketch(nextN()) : await makeDrawing(nextN());
      if (!ann) return;
      setAnnotations((prev) => [...prev, ann]);
      setActiveId(ann.id);
      (mode === 'sketch' ? sketch : page).reset();
      setTimeout(() => document.querySelector<HTMLTextAreaElement>(`[data-note="${ann.id}"]`)?.focus(), 50);
    } finally { setBusy(null); }
  };

  const addReferences = async (files: File[] | FileList) => {
    const imgs = [...files].filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    let n = nextN();
    const added: Annotation[] = [];
    for (const f of imgs) {
      try {
        const image = await readImage(f);
        added.push({ id: uid(), n, kind: 'reference', note: '', color: colorFor(n), image, name: f.name && f.name !== 'image.png' ? f.name : 'pasted image' });
        n++;
      } catch { flash(`Couldn't read ${f.name}`); }
    }
    if (!added.length) return;
    setAnnotations((prev) => [...prev, ...added]);
    setActiveId(added[added.length - 1].id);
    setTimeout(() => document.querySelector<HTMLTextAreaElement>(`[data-note="${added[0].id}"]`)?.focus(), 50);
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addReferences(files); }
  };

  const queuedRef = useRef<AgentRequest[]>([]);
  const [flushTick, setFlushTick] = useState(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const otherRoutes = (url: string, targets: string[] = []) => {
    if (!/^https?:/.test(url)) return undefined;
    let origin = '';
    try { origin = new URL(url).origin; } catch { return undefined; }
    let here = '/';
    try { here = new URL(url).pathname; } catch {  }
    const list = [
      { route: currentRoute?.route || here, url, current: true },
      ...routes.filter((r) => !r.dynamic && r.route !== currentRoute?.route).slice(0, 8).map((r) => ({ route: r.route, url: origin + r.route })),
    ];
    const partition = partitionOf(tabsRef.current.find((t) => t.id === activeTabRef.current)?.profile || '');
    return { routes: list, currentFile: currentRoute?.file, perfUrl: settingsRef.current?.perfCheck === false ? undefined : url, targets, partition };
  };

  const startRun = async (request: AgentRequest, before?: string | null, meta: RunMeta = {}) => {
    if (!settings) return;
    const id = uid();
    runMetaRef.current[id] = { ...meta, startedAt: Date.now() };
    const asked = request.annotations.flatMap((a) => (a.kind === 'request' && a.request ? [a.request] : []));
    if (!meta.verify && !meta.variant) {
      const mine = runMetaRef.current[id];
      if (asked.length) mine.requests = asked;
      mine.devAnchor = stripAnsi(devLogRef.current).slice(-200);
      api.serverLogMark().then((n) => { mine.logMark = n; }).catch(() => {});
    }
    const flow = request.annotations.find((a) => a.kind === 'flow' && a.steps?.length);
    if (flow && !meta.verify) runFlowRef.current[id] = { steps: flow.steps!, startUrl: flow.startUrl || request.url };
    runPageRef.current[id] = request.url;
    if (before) { beforeShotRef.current = { id, shot: before }; api.saveShot(id, 'before', before).catch(() => {}); }
    setAgentLog('');
    setRunId(id);
    runRef.current = id;
    const sess = sessionRef.current;
    const resume = sess && sess.agent === settings.agent ? sess.id : null;
    if (!resume) setDesignAtStart(settings.useDesign && design?.exists ? design.content : '');
    try {
      await api.runAgent({ runId: id, request, sessionId: resume, check: meta.variant || meta.verify ? undefined : otherRoutes(request.url, request.annotations.flatMap((a) => (a.kind === 'element' && a.element ? [a.element.selector] : (a.hits || []).map((h) => h.selector)))) });
    } catch (e) {
      setChat((c) => [...c, { kind: 'error', id: uid(), text: errText(e) }]);
      setRunId(null);
      runRef.current = null;
      variantJob.current = null;
      setJob(null);
    }
  };

  useEffect(() => {
    if (runId || variantJob.current || !queuedRef.current.length) return;
    const merged = mergeRequests(queuedRef.current);
    queuedRef.current = [];
    startRun(merged);
  }, [runId, flushTick]);

  const send = async (mode: 'queue' | 'now' | 'bg' = 'queue') => {
    if (!settings || busy || (mode !== 'bg' && job && !runRef.current)) return;
    verifyPending.current = null;
    if (!settings.projectDir) {
      flash('Pick the project folder the agent should edit.');
      const dir = await api.pickFolder();
      if (!dir) return;
      setSettings(await api.getSettings());
    }
    setBusy('Preparing request…');
    try {
      let anns = [...annRef.current];
      let n = nextN();
      const d = await makeDrawing(n);
      if (d) { anns.push(d); n++; page.reset(); }
      const s = await makeSketch(n);
      if (s) { anns.push(s); sketch.reset(); }
      if (!instruction.trim() && !anns.length) { flash('Pick an element, draw, or type what you want first.'); return; }

      const b = browser.current!;
      const hasPage = !!navRef.current.url && navRef.current.url !== 'about:blank';
      const targets: FrameTarget[] = anns.flatMap((a) => (a.kind === 'element' && a.element && (!a.pageUrl || a.pageUrl === navRef.current.url) ? [{ uid: a.element.uid, selector: a.element.selector }] : []));
      let frame: RunMeta['frame'];
      if (hasPage) {
        const at = await b.frame(targets);
        frame = { targets, y: at.y };
        if (targets.length) await sleep(140);
      }
      let overview: string | undefined;
      if (hasPage && (anns.some((a) => a.kind === 'element') || (anns.length === 0 && !runRef.current))) {
        b.send('clean');
        await sleep(80);
        try { overview = await b.capture(); } catch {  }
      }
      if (isolated) isolate(null);
      if (anns.some((a) => a.tweaks || a.states?.length || a.textEdit || a.classEdit || a.propEdits)) {
        await Promise.all(anns.map(releaseElement));
        await sleep(120);
      }

      const before = hasPage && !runRef.current ? await cleanCapture() : null;

      const devTail = stripAnsi(devLog).split('\n').slice(-40).join('\n');
      const devHasErrors = devRunning && /error|failed|exception/i.test(devTail);
      const hasDiag = includeDiag && (consoleLog.length || netFails.length || devHasErrors);
      const a11yIssues = includeA11y && a11y.length ? a11y : undefined;
      const diagnostics = hasDiag || a11yIssues
        ? { console: hasDiag ? await locateConsole(consoleLog) : [], network: hasDiag ? await withHandlers(withBodies(netFails)) : [], devLog: hasDiag && devHasErrors ? devTail : '', a11y: a11yIssues, overlay: (hasDiag && hasPage && await b.errorOverlay()) || undefined }
        : undefined;
      const request: AgentRequest = {
        url: navRef.current.url, title: navRef.current.title, viewport: { ...b.size(), responsive: device.on || undefined },
        breakpoints: device.on && breakpoints.length ? breakpoints : undefined,
        instruction: instruction.trim(),
        overview,
        annotations: anns.map(({ id: _i, color: _c, ...a }) => a),
        diagnostics,
        route: currentRoute ? { path: currentRoute.route, file: currentRoute.file, framework: currentRoute.framework } : undefined,
        env: env.colorScheme || env.reducedMotion || frozen || describeConditions(cond).length || mocks.some((m) => m.on) || viewAs
          ? { ...env, frozen, states: [...describeConditions(cond), ...mocks.filter((m) => m.on).map((m) => `${m.method} ${m.path} is answered by a mock the user wrote (status ${m.status}), not by the real server`)], ...(viewAs && { profile: { name: viewAs.name, detail: [viewAs.locale, viewAs.timezone, viewAs.flags?.trim() && `flags: ${pairs(viewAs.flags, '=').map(([k, v]) => `${k}=${v}`).join(', ')}`].filter(Boolean).join(', ') } }) }
          : undefined,
        note: pendingNote.current || undefined,
      };
      pendingNote.current = null;
      if (!chatId) { setChatId(uid()); setChatCreated(Date.now()); }
      const thumbs = await Promise.all(anns.map(async (a) => ({ ...a, image: a.image ? await thumbnail(a.image) : undefined })));

      setInstruction('');
      setAnnotations([]);
      setActiveId(null);
      setPopover(null);
      for (const h of Object.values(handles.current)) h?.send('clear');
      if (hasDiag) clearDiagnostics();
      if (a11yIssues) setIncludeA11y(false);

      if (mode === 'bg') {
        const id = uid();
        const title = (request.instruction || anns.map((a) => a.note).find(Boolean) || 'Background request').split('\n')[0].slice(0, 80);
        setBgRuns((list) => [...list, { id, title, status: 'running' }]);
        try { await api.bgStart({ id, request }); }
        catch (e) { setBgRuns((list) => list.filter((r) => r.id !== id)); flash(errText(e)); }
        return;
      }

      const running = runRef.current;
      if (running) {
        const r = await api.steerAgent({ runId: running, steerId: uid(), request, mode }).catch(() => ({ delivered: false }));
        setChat((c) => [...c, { kind: 'user', id: uid(), text: request.instruction, annotations: thumbs, agent: settings.agent, steer: r.delivered ? mode : 'later' }]);
        if (!r.delivered) {
          queuedRef.current.push(request);
          if (mode === 'now') api.cancelAgent(running);
          setFlushTick((t) => t + 1);
        }
        return;
      }

      const total = settings.variants >= 2 ? Math.min(MAX_VARIANTS, settings.variants) : 0;
      setChat((c) => [...c, { kind: 'user', id: uid(), text: request.instruction, annotations: thumbs, agent: settings.agent, ...(total && { variants: total }) }]);
      if (total) {
        variantJob.current = { base: request, total, index: 1, done: [] };
        await startRun({ ...request, variant: { index: 1, total } }, before, { variant: { index: 1, total }, frame });
      } else await startRun(request, before, { frame });
    } catch (e) {
      setChat((c) => [...c, { kind: 'error', id: uid(), text: errText(e) }]);
    } finally { setBusy(null); }
  };

  const cancel = () => { if (runId) api.cancelAgent(runId); };

  const forceSteer = async (itemId: string) => {
    const running = runRef.current;
    const item = chatRef.current.find((it) => it.id === itemId);
    if (!running || !item || item.kind !== 'user') return;
    if (item.steer === 'later') api.cancelAgent(running);
    else if (!(await api.nudgeAgent(running).catch(() => false))) { flash("The agent couldn't be interrupted just now."); return; }
    setChat((c) => c.map((it) => (it.id === itemId && it.kind === 'user' ? { ...it, steer: 'now' as const } : it)));
  };

  const applyRevert = (id: string, r: RevertResult) => {
    invalidateDiff(id);
    setChat((c) => c.map((it) => (it.kind === 'done' && it.runId === id
      ? { ...it, undone: r.allReverted, changes: it.changes.map((ch) => (r.restored.includes(ch.path) ? { ...ch, reverted: true } : ch)) }
      : it)));
    if (r.restored.length && /^file:/.test(navRef.current.url)) browser.current?.reload();
  };

  const revertFile = async (id: string, path: string, force = false) => {
    try {
      const r = await api.revertRun(id, [path], force);
      applyRevert(id, r);
      if (r.conflicts.length) flash(`${path} changed after that run. Click revert again to overwrite those later edits too.`);
      else if (r.failed.length) flash(`Couldn't restore ${path}`);
      return r;
    } catch (e) { flash(errText(e)); return null; }
  };
  const cleanCapture = async (): Promise<string | null> => {
    const b = browser.current;
    if (!b) return null;
    b.send('hide', true);
    await sleep(90);
    try { return await b.capture(undefined, true); } catch { return null; } finally { b.send('hide', false); }
  };

  const captureAfter = async (id: string) => {
    const url = runPageRef.current[id];
    if (!url) return;
    await sleep(/^file:/.test(url) ? 500 : 1800);
    for (let i = 0; i < 40 && loadingRef.current; i++) await sleep(200);
    await sleep(400);
    if (navRef.current.url !== url) return;
    const frame = runMetaRef.current[id]?.frame;
    const aim = async () => { if (frame) { await browser.current?.frame(frame.targets, frame.y); await sleep(150); } };
    await aim();
    let shot = await cleanCapture();
    if (!shot) return;
    const before = beforeShotRef.current?.id === id ? beforeShotRef.current.shot : null;
    const judge = async (after: string): Promise<'none' | 'changed' | undefined> => {
      if (!before) return undefined;
      try { return (await looksSame(before, after)) ? 'none' : 'changed'; } catch { return undefined; }
    };
    let visual = await judge(shot);
    if (visual === 'none' && /^https?:/.test(url) && !(await browser.current?.hasHmr())) {
      browser.current?.reload();
      await sleep(500);
      for (let i = 0; i < 40 && loadingRef.current; i++) await sleep(200);
      await sleep(700);
      if (navRef.current.url === url) await aim();
      const again = navRef.current.url === url ? await cleanCapture() : null;
      if (again) { shot = again; visual = await judge(again); }
    }
    await api.saveShot(id, 'after', shot);
    setChat((c) => c.map((it) => (it.kind === 'done' && it.runId === id ? { ...it, shots: true, visual } : it)));
  };
  const nextVariant = async (e: Extract<AgentEvent, { type: 'done' }>) => {
    const j = variantJob.current;
    if (!j) return;
    const n = e.changes?.length || 0;
    if (n) {
      setJob(`Saving variant ${j.index} of ${j.total}…`);
      await captureAfter(e.runId);
      const r = await api.revertRun(e.runId, null, true).catch(() => null);
      if (r) applyRevert(e.runId, r);
      if (e.ok) j.done.push({ runId: e.runId, index: j.index, files: n });
    }
    if (!e.ok || j.index >= j.total) {
      variantJob.current = null;
      setJob(null);
      if (j.done.length) setChat((c) => [...c, { kind: 'variants', id: uid(), options: j.done, chosen: null }]);
      else if (e.ok) flash('None of the variants changed any files.');
      setFlushTick((t) => t + 1);
      return;
    }
    setJob(`Starting variant ${j.index + 1} of ${j.total}…`);
    await sleep(1500);
    const before = await cleanCapture();
    j.index++;
    setJob(null);
    const slim = !!sessionRef.current;
    const variant = { index: j.index, total: j.total };
    startRun({ ...j.base, ...(slim && { instruction: '', annotations: [], overview: undefined }), diagnostics: undefined, note: undefined, variant }, before, { variant, frame: runMetaRef.current[e.runId]?.frame });
  };

  const withBodies = (fails: NetworkFailure[]): NetworkFailure[] => fails.map((n) => {
    const hit = [...requestsRef.current].reverse().find((r) => r.url === n.url && r.method === n.method && requestFailed(r));
    return hit?.resBody ? { ...n, body: hit.resBody } : n;
  });
  const withHandlers = (fails: NetworkFailure[]) => Promise.all(fails.map(async (n, i) => {
    if (i < fails.length - 8 || !/^https?:/.test(n.url)) return n;
    const h = await api.findHandler(n.url, n.method).catch(() => null);
    return h ? { ...n, handler: `${h.file}:${h.line}` } : n;
  }));

  const afterRun = async (e: Extract<AgentEvent, { type: 'done' }>) => {
    const meta = runMetaRef.current[e.runId] || {};
    if (meta.variant) return nextVariant(e);
    if (!e.changes?.length) return;
    await captureAfter(e.runId);
    runA11y();
    if (meta.verify || !e.ok || !settingsRef.current?.autoVerify) return;
    if (verifyPending.current !== e.runId || runRef.current || queuedRef.current.length) return;
    verifyPending.current = null;
    const shots = await api.runShots(e.runId, ['before', 'after']).catch(() => ({} as Record<string, string>));
    if (!shots.after) return;
    const flow = runFlowRef.current[e.runId];
    if (flow) {
      setChat((c) => [...c, { kind: 'status', id: uid(), text: 'Replaying the recorded interaction…' }]);
      await replayFlow(flow);
      const shot = await cleanCapture();
      if (shot) shots.after = shot;
      if (runRef.current || queuedRef.current.length) return;
    }
    let same = false;
    if (shots.before) { try { same = await looksSame(shots.before, shots.after); } catch {  } }
    const since = meta.startedAt || 0;
    const cons = consoleRef.current.filter((c) => c.at >= since);
    const net = netRef.current.filter((n) => n.at >= since);
    const again: NonNullable<NonNullable<AgentRequest['verify']>['requests']> = [];
    for (const r of meta.requests || []) {
      const res = await browser.current?.sendRequest({ method: r.method, url: r.url, body: r.reqBody });
      if (res) again.push({ method: r.method, url: r.url, before: { status: r.status }, after: { status: res.status, body: res.body, error: res.error } });
    }
    const devNow = stripAnsi(devLogRef.current);
    const at = meta.devAnchor ? devNow.lastIndexOf(meta.devAnchor) : -1;
    const devSince = (at >= 0 ? devNow.slice(at + meta.devAnchor!.length) : '').split('\n').slice(-60).join('\n').trim();
    const serverSince = meta.logMark != null ? (await api.serverLogSince(meta.logMark).catch(() => '')).split('\n').slice(-60).join('\n').trim() : '';
    const request: AgentRequest = {
      url: navRef.current.url, title: navRef.current.title, viewport: browser.current!.size(),
      instruction: 'Fix what the automatic check of the result found', annotations: [],
      verify: { before: shots.before, after: shots.after, same, ...(again.length && { requests: again }) },
      diagnostics: cons.length || net.length || devSince || serverSince ? { console: cons, network: withBodies(net), devLog: devSince, serverLog: serverSince } : undefined,
    };
    setChat((c) => [...c, { kind: 'status', id: uid(), text: 'Checking the result…' }]);
    startRun(request, shots.after, { verify: true });
  };
  const afterRunRef = useRef(afterRun);
  afterRunRef.current = afterRun;

  const pickVariant = async (itemId: string, id: string) => {
    const item = chat.find((c) => c.id === itemId && c.kind === 'variants') as Extract<ChatItem, { kind: 'variants' }> | undefined;
    if (!item || runRef.current) return;
    try {
      if (item.chosen && item.chosen !== id) applyRevert(item.chosen, await api.revertRun(item.chosen, null, true));
      const r = await api.applyRun(id);
      invalidateDiff(id);
      setChat((c) => c.map((it) => (it.id === itemId && it.kind === 'variants' ? { ...it, chosen: id }
        : it.kind === 'done' && it.runId === id ? { ...it, undone: false, changes: it.changes.map((ch) => ({ ...ch, reverted: false })) } : it)));
      browser.current?.reload();
      const opt = item.options.find((o) => o.runId === id);
      pendingNote.current = `[Pinpoint: the user picked variant ${opt?.index} of the ${item.options.length} you made. Its files are on disk now; the other variants were discarded. Re-read files before editing them.]`;
      refreshGit();
      flash(r.failed.length ? `Applied, but couldn't restore ${r.failed.join(', ')}` : `Variant ${opt?.index} applied`);
    } catch (e) { flash(errText(e)); }
  };

  const diffMockup = async () => {
    const b = browser.current;
    if (!overlay || !b) return;
    const shot = await cleanCapture();
    if (!shot) { flash("Couldn't capture the page."); return; }
    try {
      const fitted = await fitMockup(overlay.image, shot, { x: overlay.x, y: overlay.y }, b.size().width);
      setCompare({ images: { before: fitted, after: shot }, labels: ['Mockup', 'Page'], title: 'Mockup vs page' });
    } catch { flash("Couldn't read the mockup image."); }
  };

  const captureSizes = async (id: string) => {
    const original = device;
    const plan: Device[] = [{ on: true, w: 390, h: 844, zoom: 'fit', touch: false }, { on: true, w: 820, h: 1180, zoom: 'fit', touch: false }, DEVICE_OFF];
    try {
      for (const d of plan) {
        setDevice(d);
        await sleep(1200);
        const shot = await cleanCapture();
        if (shot) await api.saveShot(id, `size-${d.w}`, shot);
      }
    } finally { setDevice(original); }
  };

  const commitRun = async (id: string) => {
    try {
      const c = await api.gitCommitRun(id);
      setChat((cs) => cs.map((it) => (it.kind === 'done' && it.runId === id ? { ...it, commit: c } : it)));
      flash(`Committed ${c.hash}`);
      refreshGit();
    } catch (e) { flash(errText(e)); }
  };

  const prDefaults = () => {
    const users = chat.filter((c) => c.kind === 'user') as Extract<ChatItem, { kind: 'user' }>[];
    const first = users[0];
    const title = (first?.text || first?.annotations.map((a) => a.note).find(Boolean) || 'Visual edits').split('\n')[0].slice(0, 72);
    const lines = ['## What changed', ''];
    for (const it of chat) {
      if (it.kind === 'user') {
        const asks = [it.text, ...it.annotations.map((a) => a.note)].filter((t) => t && t.trim());
        if (asks.length) lines.push(`- **Asked:** ${asks.map((t) => t.trim().split('\n')[0]).join('; ')}`);
      } else if (it.kind === 'done' && it.changes.length && !it.undone) {
        const files = it.changes.filter((c) => !c.reverted).map((c) => `\`${c.path}\``).join(', ');
        if (files) lines.push(`  - Changed ${files}${it.commit ? ` (${it.commit.hash})` : ''}`);
      }
    }
    lines.push('', '---', 'Made with [Pinpoint](https://github.com/m-ahmed-elbeskeri/pinpoint).');
    return { title, body: lines.join('\n') };
  };

  const addRequest = (r: NetRequest, handler: ApiHandler | null) => {
    const n = nextN();
    const ann: Annotation = {
      id: uid(), n, kind: 'request', note: '', color: colorFor(n), pageUrl: navRef.current.url,
      request: { method: r.method, url: r.url, status: r.status, ms: r.ms, error: r.error, reqBody: r.reqBody, resBody: r.resBody, handler: handler ? { file: handler.file, line: handler.line, sure: handler.sure } : undefined },
    };
    setAnnotations((prev) => [...prev, ann]);
    setActiveId(ann.id);
    if (settingsRef.current?.panelHidden) saveSettings({ panelHidden: false });
    setTimeout(() => document.querySelector<HTMLTextAreaElement>(`[data-note="${ann.id}"]`)?.focus(), 50);
  };
  const replayRequest = async (r: NetRequest) => {
    const res = await browser.current?.sendRequest({ method: r.method, url: r.url, body: r.reqBody });
    flash(!res ? 'The page could not send it.' : res.error && !res.status ? `${r.method} ${pathOf(r.url)} failed: ${res.error}` : `${r.method} ${pathOf(r.url)} answered ${res.status} in ${res.ms} ms`);
  };
  const buildMock = (m: Mock) => {
    setInstruction(`Build the endpoint ${m.method === 'ANY' ? 'GET' : m.method} ${m.path} in this project's backend. It should answer with status ${m.status} and a body shaped like this (the page is being developed against it as a mock):\n\n${m.body}\n\nFollow how the existing endpoints are written and registered, use real data where the project has it, and tell me when I can switch the mock off.`);
    if (settingsRef.current?.panelHidden) saveSettings({ panelHidden: false });
    setTimeout(() => composerRef.current?.focus(), 50);
  };

  const openFile = (path: string, line?: number) => {
    api.openFile(path, line)
      .then((r) => flash(r.via === 'folder' ? `No editor found, so ${path} is shown in its folder` : `Opened ${path}${r.via !== 'system' ? ` in ${r.via}` : ''}`))
      .catch((e) => flash(errText(e)));
  };

  const undoRun = async (_doneId: string, id: string) => {
    try {
      const r = await api.revertRun(id, null, false);
      applyRevert(id, r);
      if (r.conflicts.length) {
        flash(`${r.conflicts.length} file(s) changed since that run. Review them to revert anyway.`);
        setDiffView({ runId: id, path: r.conflicts[0] });
      } else flash(r.failed.length ? `Reverted ${r.restored.length}; couldn't restore ${r.failed.join(', ')}` : `Reverted ${r.restored.length} file(s)`);
    } catch (e) { flash(errText(e)); }
  };
  const newChat = () => {
    if (!leaveChat()) return;
    setChat([]); setSession(null); setChatId(null); setDesignAtStart(null);
    syncOthers();
  };

  const onMemoryAction = (id: string, action: 'save' | 'dismiss') => {
    const item = chat.find((c) => c.id === id && c.kind === 'memory') as Extract<ChatItem, { kind: 'memory' }> | undefined;
    if (!item) return;
    if (action === 'save' && !memory.some((m) => m.text.toLowerCase() === item.text.toLowerCase())) {
      const next = [{ id: uid(), text: item.text, enabled: true, createdAt: Date.now() }, ...memory];
      setMemory(next);
      api.writeMemory(next);
    }
    setChat((c) => c.map((it) => (it.id === id && it.kind === 'memory' ? { ...it, status: action === 'save' ? 'saved' : 'dismissed' } : it)));
  };

  const askAgentForDesign = (draft: string | null) => {
    setSheet(null);
    setInstruction(
      `${design?.exists ? 'Improve' : 'Create'} DESIGN.md at the project root: a concise design system for this project (colors, typography, spacing, radii, shadows, key components and usage rules). ` +
      'Base it on the code (theme / Tailwind config, CSS variables, shared components)' + (draft ? ' and this draft extracted from the rendered page:\n\n' + draft : '.'),
    );
    setTimeout(() => composerRef.current?.focus(), 50);
  };
  const askToFix = () => {
    setIncludeDiag(true);
    const cons = consoleRef.current, errors = cons.filter((c) => c.level === 'error');
    const list = [
      ...(errors.length ? errors : cons).slice(-4).map((c) => `- ${c.message.split('\n')[0].slice(0, 160)}${c.source ? ` (${c.source.split('/').pop()!.split('?')[0]}${c.line ? `:${c.line}` : ''})` : ''}`),
      ...netRef.current.slice(-3).map((n) => `- ${n.method} ${n.url.replace(/^https?:\/\/[^/]+/, '')} failed (${n.status || n.error})`),
    ];
    const ask = `Fix what is breaking this page:\n${list.join('\n')}\n\nThe full errors are attached. Find the cause in the code and fix that, not just the symptom, then tell me what was wrong.`;
    setInstruction((t) => (t.trim() ? t : list.length ? ask : 'Fix the errors the dev server is reporting (its output is attached).'));
    setTimeout(() => composerRef.current?.focus(), 50);
  };

  const deltaBuf = useRef<{ kind: 'text' | 'thinking'; text: string }[]>([]);
  const deltaTimer = useRef(0);
  const flushDeltas = useCallback(() => {
    deltaTimer.current = 0;
    const buf = deltaBuf.current;
    deltaBuf.current = [];
    if (!buf.length) return;
    setChat((c) => mergeDeltas(c, buf));
  }, []);
  const finalizeBlock = (kind: 'text' | 'thinking', text: string, extra: ChatItem[] = []) => {
    if (deltaTimer.current) { clearTimeout(deltaTimer.current); flushDeltas(); }
    setChat((c) => finalizeItems(c, kind, text, extra));
  };

  useEffect(() => api.onAgentEvent((e: AgentEvent) => {
    if (e.type === 'routes') {
      const fresh = e.results.find((r) => r.current);
      setChat((c) => c.map((it) => {
        if (it.kind !== 'done' || it.runId !== e.runId) return it;
        if (fresh?.changed && it.visual === 'none' && navRef.current.url === runPageRef.current[e.runId]) {
          browser.current?.hasHmr().then((hot) => { if (!hot) browser.current?.reload(); });
        }
        return { ...it, ...(e.results.length && { routeCheck: e.results }), ...(e.perf && { perf: e.perf }) };
      }));
      return;
    }
    if (e.runId !== runRef.current) {
      const p = [...parked.current.values()].find((x) => x.runId === e.runId);
      if (p) parkedEventRef.current(p, e);
      return;
    }
    const push = (item: ChatItem) => setChat((c) => {
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
      case 'session': setSession({ id: e.sessionId, agent: (settingsRef.current?.agent || 'claude') }); break;
      case 'git': refreshGitRef.current(); break;
      case 'text': {
        const m = splitMemory(e.text);
        finalizeBlock('text', m.text, m.extra);
        break;
      }
      case 'thinking': finalizeBlock('thinking', e.text); break;
      case 'tool': push({ kind: 'tool', id: uid(), toolId: e.id, name: e.name, detail: e.detail, status: 'running' }); break;
      case 'tool_result':
        setChat((c) => c.map((it) => (it.kind === 'tool' && it.toolId === e.id ? { ...it, status: e.ok ? 'ok' : 'error', output: e.text || it.output } : it)));
        break;
      case 'log': addLog('agent', e.text + '\n'); break;
      case 'error': push({ kind: 'error', id: uid(), text: e.text }); break;
      case 'done':
        if (deltaTimer.current) { clearTimeout(deltaTimer.current); flushDeltas(); }
        setChat((c) => [
          ...c.map((it) => (it.kind === 'tool' && it.status === 'running' ? { ...it, status: 'ok' as const }
            : (it.kind === 'text' || it.kind === 'thinking') && it.streaming ? { ...it, streaming: false } : it)),
          {
            kind: 'done', id: uid(), runId: e.runId, ok: e.ok, cost: e.cost, durationMs: e.durationMs, changes: e.changes || [], commit: e.commit || null,
            ...(runMetaRef.current[e.runId]?.verify && { verify: true }),
            ...(runMetaRef.current[e.runId]?.variant && { variant: runMetaRef.current[e.runId].variant }),
          },
        ]);
        setRunId(null);
        runRef.current = null;
        if (e.changes?.length && /^file:/.test(navRef.current.url)) browser.current?.reload();
        refreshGitRef.current();
        verifyPending.current = e.runId;
        afterRunRef.current(e);
        if (e.changes?.length) {
          refreshRoutes();
          if (e.changes.some((c) => /^DESIGN\.md$/i.test(c.path))) api.readDesign().then(setDesign);
        }
        break;
    }
  }), []);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const refreshGitRef = useRef(refreshGit);
  refreshGitRef.current = refreshGit;

  const chatHandlers = {
    onReload: () => browser.current?.reload(),
    onUndo: undoRun,
    onReview: (id: string, path?: string) => setDiffView({ runId: id, path }),
    onMemory: onMemoryAction,
    onRevertFile: revertFile,
    onOpenFile: openFile,
    onCommit: commitRun,
    onCompare: (id: string, pair?: string) => setCompare({ runId: id, pair, ...(pair && { title: `Other page: /${pair.replace(/^route-/, '').replace(/^home$/, '')}` }) }),
    onPickVariant: pickVariant,
    onMeasureBuild: measureBuild,
    onForceSteer: forceSteer,
  };
  const chatActions = useStableActions<ChatActions>(chatHandlers);

  useEffect(() => api.onDevEvent((e) => {
    if (e.type === 'log') addLog('dev', e.text);
    else if (e.type === 'started') { setDevRunning(true); setDevLog(''); }
    else if (e.type === 'exit') { setDevRunning(false); setDevLog((l) => l + `\n[process exited with code ${e.code}]\n`); }
    else if (e.type === 'url') {
      const cur = navRef.current.url;
      if (!cur || cur === 'about:blank' || /^chrome-error:/.test(cur) || loadErrorRef.current) {
        setTimeout(() => go(e.url), 400);
      }
    }
  }), []);
  const loadErrorRef = useRef(loadError);
  loadErrorRef.current = loadError;

  useEffect(() => {
    setDevInfo(null);
    if (!projectDir) return;
    let live = true;
    api.detectDev().then((d) => { if (live) setDevInfo(d); }).catch(() => {});
    return () => { live = false; };
  }, [projectDir]);
  const devCommand = settings?.devCommand || devInfo?.command || '';

  const startDev = async (cmd: string) => {
    try { await api.startDev(cmd); saveSettings({ devCommand: cmd }); }
    catch (e) { flash((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  };
  const quickStartDev = () => {
    setDrawerOpen(true); setDrawerTab('dev');
    if (devCommand && !devRunning) startDev(devCommand);
  };

  const pickProject = async () => {
    const prev = settings?.projectDir;
    const dir = await api.pickFolder();
    if (!dir) return;
    setSettings(await api.getSettings()); setSession(null); flash(`Project: ${dir}`);
    if (dir !== prev) {
      const blank = makeTab('');
      handles.current = {};
      setTabs([blank]);
      setActiveTab(blank.id);
      setAnnotations([]);
      setUrlInput('');
      setDevLog('');
    }
  };

  const startResize = (which: 'panel' | 'drawer') => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setResizing(which);
    dragging.current = true;
    const grid = (e.currentTarget as HTMLElement).closest('.app') as HTMLElement | null;
    const left = settingsRef.current?.panelSide === 'left';
    let last = 0, frame = 0;
    const paint = () => {
      frame = 0;
      if (!grid || !last) return;
      if (which === 'panel') grid.style.gridTemplateColumns = left ? `${last}px 1fr` : `1fr ${last}px`;
      else grid.style.gridTemplateRows = `52px 1fr ${last}px`;
    };
    const move = (ev: PointerEvent) => {
      if (which === 'panel') {
        const w = left ? ev.clientX : window.innerWidth - ev.clientX;
        last = Math.round(Math.min(Math.max(300, w), Math.min(820, window.innerWidth - 480)));
      } else {
        last = Math.round(Math.min(Math.max(120, window.innerHeight - ev.clientY), window.innerHeight * 0.65));
      }
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (frame) cancelAnimationFrame(frame);
      dragging.current = false;
      if (last) { if (which === 'panel') setPanelWidth(last); else setDrawerHeight(last); }
      const a = area.current;
      if (a) setAvail({ w: Math.floor(a.clientWidth), h: Math.floor(a.clientHeight) });
      setResizing(null);
      if (last) saveSettings(which === 'panel' ? { panelWidth: last } : { drawerHeight: last });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const togglePanel = () => saveSettings({ panelHidden: !settingsRef.current?.panelHidden });

  const handleKey = useCallback((key: string, e?: KeyboardEvent) => {
    const m = modeRef.current;
    if (key === 'Escape') { setPopover(null); if (m !== 'browse') setMode('browse'); return; }
    const k = key.toLowerCase();
    if (k === 'v') setMode('browse');
    else if (k === 's') setMode('select');
    else if (k === 'd') setMode('draw');
    else if (k === 'k') setMode('sketch');
    else if (k === 'f' && m !== 'draw' && m !== 'sketch') setFrozen(!frozenRef.current);
    else if ((m === 'draw' || m === 'sketch') && TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
    else return;
    e?.preventDefault();
  }, [setMode, setFrozen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable;
      const m = modeRef.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { togglePanel(); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') { navigator.clipboard?.writeText(layoutReport()); flash('Layout report copied. Paste it wherever you report the problem.'); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') { newTab(); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing && (m === 'draw' || m === 'sketch')) {
        const target = m === 'sketch' ? sketch : page;
        e.shiftKey ? target.redo() : target.undo();
        e.preventDefault();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) { if (e.key === 'Escape') (t as HTMLElement).blur?.(); return; }
      handleKey(e.key, e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleKey, page, sketch]);

  const updateNote = (id: string, note: string) => setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, note } : a)));
  const removeAnn = (id: string) => {
    const a = annRef.current.find((x) => x.id === id);
    if (a) releaseElement(a);
    if (isolated === id) isolate(null);
    setAnnotations((prev) => prev.filter((x) => x.id !== id));
    if (popover?.id === id) setPopover(null);
  };
  const focusAnn = (a: Annotation) => {
    setActiveId(a.id);
    if (a.tabId && a.tabId !== activeTabRef.current && tabsRef.current.some((t) => t.id === a.tabId)) switchTab(a.tabId);
    if (a.kind === 'element' && a.element) (a.tabId ? handles.current[a.tabId] : browser.current)?.send('scrollTo', a.element.uid);
  };

  const agentReady = settings && agents ? agents[settings.agent]?.ok : true;
  const deviceScale = !device.on || !avail.w ? 1
    : device.zoom === 'fit' ? Math.min(1, avail.w / device.w, device.h ? avail.h / device.h : 1) : device.zoom;
  const deviceH = device.h || avail.h / deviceScale;
  const drawShapes = mode === 'sketch' ? sketch : page;
  const pendingMarks = page.shapes.length + sketch.shapes.length;
  const canSend = !busy && !!(instruction.trim() || annotations.length || pendingMarks);
  const popAnn = popover && annotations.find((a) => a.id === popover.id);
  const root = settings?.projectDir || '';
  const runMeta = runId ? runMetaRef.current[runId] : undefined;
  const memoryOn = settings?.useMemory ? memory.filter((m) => m.enabled).length : 0;

  const popoverStyle = useMemo(() => {
    if (!popover || !frame.current) return {};
    const fw = frame.current.clientWidth, fh = frame.current.clientHeight;
    const w = 320;
    const isEl = popAnn?.kind === 'element';
    const h = 130 + (isEl ? 94 + ((popAnn?.element?.component?.uses ?? 0) > 1 ? 30 : 0) + (toolSection ? 200 : 0) : 0);
    const below = popover.rect.y + popover.rect.height + 10;
    const top = below + h < fh ? below : Math.max(8, Math.min(popover.rect.y - h - 10, fh - h - 8));
    return { left: Math.min(Math.max(8, popover.rect.x), fw - w - 8), top, width: w };
  }, [popover, toolSection, popAnn?.kind, popAnn?.element?.component?.uses]);

  if (!settings) return <div className="boot"><Loader2 className="spin" /></div>;

  const left = settings.panelSide === 'left';
  const pw = settings.panelHidden ? 0 : panelWidth ?? settings.panelWidth ?? 400;
  const dh = drawerHeight ?? settings.drawerHeight ?? 240;
  const row2 = left ? "'panel stage'" : "'stage panel'";
  const row3 = left ? "'panel drawer'" : "'drawer panel'";
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: left ? `${pw}px 1fr` : `1fr ${pw}px`,
    gridTemplateRows: drawerOpen ? `52px 1fr ${dh}px` : '52px 1fr',
    gridTemplateAreas: `'top top' ${row2}${drawerOpen ? ' ' + row3 : ''}`,
  };

  return (
    <div className={`app ${resizing ? 'resizing' : ''}`} style={gridStyle}>
      <TopBar
        mod={MOD} projectDir={settings.projectDir} onPickProject={pickProject}
        mode={mode} setMode={setMode}
        recording={!!rec} canRecord={/^(https?|file):/.test(nav.url)} onToggleRecording={toggleRecording}
        update={update} onInstallUpdate={() => api.updateInstall()}
        drawerOpen={drawerOpen} devRunning={devRunning} onToggleDrawer={() => setDrawerOpen(!drawerOpen)}
        sheet={sheet} setSheet={setSheet}
        design={design?.exists ? (settings.useDesign ? 'on' : 'off') : 'none'} designChanged={designChanged} memoryOn={memoryOn}
        onDevtools={() => browser.current?.devtools()}
        panelSide={left ? 'left' : 'right'} panelHidden={!!settings.panelHidden} onTogglePanel={togglePanel}
        onSettings={() => setSettingsOpen(true)}
      />

      <main className="stage">
        <div className="tabbar">
          <div className="tabstrip">
            {tabs.map((t) => (
              <div
                key={t.id} className={`tab ${t.id === activeTab ? 'on' : ''}`} title={t.url || 'New tab'}
                onClick={() => switchTab(t.id)}
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } }}
              >
                {t.loading ? <Loader2 size={11} className="spin" /> : <Globe size={11} />}
                <span>{tabLabel(t)}</span>
                {annotations.some((a) => a.tabId === t.id) && <i className="tab-pin" title="Has annotations for the next request" />}
                <button className="tab-x" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} title="Close tab"><X size={11} /></button>
              </div>
            ))}
            <button className="tab-new" onClick={() => newTab()} title={`New tab (${MOD}+T)`}><Plus size={13} /></button>
          </div>
        </div>
        <div className="navbar">
          <div className="nav-btns">
            <button className="icon-btn" disabled={!nav.canBack} onClick={() => browser.current?.back()} title="Back"><ArrowLeft size={16} /></button>
            <button className="icon-btn" disabled={!nav.canForward} onClick={() => browser.current?.forward()} title="Forward"><ArrowRight size={16} /></button>
            <button className="icon-btn" onClick={() => browser.current?.reload()} title="Reload">{loading ? <Loader2 size={16} className="spin" /> : <RotateCw size={15} />}</button>
          </div>

          <form className="urlbar" onSubmit={(e) => { e.preventDefault(); go(urlInput); }}>
            {projectDir && /^(https?|file):/.test(nav.url) ? (
              <RoutePicker
                routes={routes}
                current={currentRoute}
                baseUrl={/^file:/.test(nav.url) ? 'file:///' + projectDir.replace(/\\/g, '/').replace(/^\//, '') : (() => { try { return new URL(nav.url).origin; } catch { return ''; } })()}
                getLinks={() => browser.current?.links() ?? Promise.resolve([])}
                onGo={go}
                onEdit={(u) => { setUrlInput(u); setTimeout(() => (document.querySelector('.urlbar input') as HTMLInputElement | null)?.focus(), 30); }}
              />
            ) : <Globe size={14} className="url-icon" />}
            <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onFocus={(e) => e.target.select()} placeholder="localhost:3000, a URL, or a path to an .html file" spellCheck={false} />
          </form>
          <ProfileMenu profiles={profiles} current={tab?.profile || ''} onPick={(p) => tab && setTabProfile(tab.id, p)} onSave={saveProfiles} />
          <div className="vp-toggles">
            <button type="button" className={wsOpen ? 'on' : ''} onClick={() => { if (wsOpen) browser.current?.closeWorkspace(); setWsOpen(!wsOpen); }} disabled={!projectDir || !/^https?:/.test(nav.url)} title="Components: render any component from the project on its own, with its props and variants"><Boxes size={14} /></button>
            <button type="button" onClick={() => setEnginesOpen(true)} disabled={!/^https?:/.test(nav.url)} title="Other browsers: see this page in Safari's engine (WebKit) and Firefox"><AppWindow size={14} /></button>
            <span className="vp-sep" />
            {QUICK_SIZES.map((q) => {
              const on = q.w ? device.on && device.w === q.w : !device.on;
              return <button type="button" key={q.label} className={on && !multi ? 'on' : ''} onClick={() => { setMulti(false); setDevice(q.w ? { on: true, w: q.w, h: q.h, zoom: device.zoom, touch: device.touch } : DEVICE_OFF); }} title={q.label}><q.icon size={14} /></button>;
            })}
            <button type="button" className={multi ? 'on' : ''} onClick={() => setMulti(!multi)} disabled={!/^(https?|file):/.test(nav.url)} title="Phone, tablet and desktop side by side"><Columns3 size={14} /></button>
            <span className="vp-sep" />
            <button type="button" className={frozen ? 'on' : ''} onClick={() => setFrozen(!frozen)} title="Freeze the page so open menus, tooltips and popovers stay put. Press F while pointing at the page to keep its hover state (F8 while typing)."><Snowflake size={14} /></button>
            <ConditionsMenu
              value={cond} set={changeConditions} onStep={stepAnimation}
              env={env} setEnv={setEnv}
              layout={settings.layoutOverlay !== false}
              setLayout={(on) => { saveSettings({ layoutOverlay: on }); browser.current?.send('layout', on); }}
            />
          </div>
        </div>
        <div className={`frame-wrap ${device.on ? 'device' : ''}`}>
          {device.on && <DeviceBar device={device} set={setDevice} scale={deviceScale} height={deviceH} breakpoints={breakpoints} />}
          <div className="device-area" ref={area}>
          <div className="device-box" style={device.on ? { width: device.w * deviceScale, height: deviceH * deviceScale } : undefined}>
          <div ref={frame} className={`frame mode-${mode}`} style={device.on ? { width: device.w, height: deviceH, transform: `scale(${deviceScale})` } : undefined}>
            {tabs.map((t) => {
              const here = () => t.id === activeTabRef.current;
              return (
                <BrowserView
                  key={`${t.id}:${t.profile}`}
                  ref={(h) => { handles.current[t.id] = h; if (here()) browser.current = h; }}
                  hidden={t.id !== activeTab}
                  partition={partitionOf(t.profile)}
                  initialUrl={t.initialUrl}
                  onManip={(m) => { if (here()) onManip(m); }}
                  onPicked={(el) => { if (here()) onPicked(el); }}
                  onNavigate={(s) => {
                    patchTab(t.id, s);
                    if (here() && document.activeElement?.closest('.urlbar') == null) setUrlInput(s.url === 'about:blank' ? '' : s.url);
                  }}
                  onLoading={(l) => patchTab(t.id, { loading: l })}
                  onReady={() => { applyTabProfile(t); if (here()) syncPage(); }}
                  onKey={(k) => { if (here()) handleKey(k); }}
                  onError={(msg) => patchTab(t.id, { error: msg })}
                  onConsole={(c) => { if (here()) onConsole(c); }}
                  onPageChange={() => { if (here()) { clearDiagnostics(); setFrozenState(false); setA11y([]); } }}
                  onFrozen={(on) => { if (here()) onFrozen(on); }}
                  onStep={(s) => { if (here()) onStep(s); }}
                  onRequest={(r) => { if (here()) onRequest(r); }}
                />
              );
            })}

            {overlay && mode !== 'sketch' && <MockupOverlay overlay={overlay} onChange={setOverlay} onDiff={diffMockup} onClose={() => setOverlay(null)} />}
            {frozen && <div className="frozen-tag"><Snowflake size={12} /> Page frozen · press F to release</div>}
            {rec && <div className="frozen-tag rec"><CircleDot size={12} /> Recording · {rec.steps.length} step{rec.steps.length === 1 ? '' : 's'} <button onClick={toggleRecording}>Stop</button></div>}
            {isolated && <div className="frozen-tag iso">Showing one element on its own <button onClick={() => isolate(null)}>Show page</button></div>}

            {mode === 'draw' && (
              <DrawSurface shapes={page.shapes} onChange={page.set} tool={tool} color={color} size={size} />
            )}
            {mode === 'sketch' && (
              <DrawSurface shapes={sketch.shapes} onChange={sketch.set} tool={tool} color={color === '#ffffff' ? '#111318' : color} size={size} board />
            )}

            {popover && popAnn && mode !== 'draw' && mode !== 'sketch' && (
              <div className="note-pop" style={popoverStyle}>
                <div className="note-pop-head">
                  <span className="badge" style={{ background: popAnn.color }}>{popAnn.n}</span>
                  <span className="note-pop-title">{describe(popAnn, root).title}</span>
                  <button className="icon-btn xs" onClick={() => setPopover(null)}><X size={13} /></button>
                </div>
                <textarea
                  autoFocus
                  placeholder="What should change here? (Enter to save)"
                  value={popAnn.note}
                  onChange={(e) => updateNote(popAnn.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); setPopover(null); }
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setPopover(null); send(); }
                    if (e.key === 'Escape') setPopover(null);
                  }}
                />
                {popAnn.kind === 'element' && popAnn.element && (
                  <ElementTools
                    key={popAnn.id} ann={popAnn} section={toolSection} setSection={setToolSection}
                    classNames={classNames} generated={generated} isolated={isolated === popAnn.id}
                    onStates={(s) => setStates(popAnn.id, s)}
                    onScope={(scope) => patchAnn(popAnn.id, (a) => ({ ...a, scope }))}
                    onTweak={(prop, value) => tweak(popAnn.id, prop, value)}
                    onResetTweaks={() => resetTweaks(popAnn.id)}
                    onText={(t) => editText(popAnn.id, t)}
                    onClasses={(v) => editClasses(popAnn.id, v)}
                    onProp={(name, v) => editProp(popAnn.id, name, v)}
                    onIsolate={(on) => isolate(on ? popAnn.id : null)}
                    onStory={() => openStory(popAnn.id)}
                    onOpenFile={openFile}
                  />
                )}
                <div className="note-pop-foot">
                  <button className="btn ghost xs" onClick={() => removeAnn(popAnn.id)}><Trash2 size={12} /> Remove</button>
                  {plan
                    ? <button className="btn xs primary" disabled={!plan.ok} onClick={() => applyInstant(popAnn.id)} title={plan.ok ? `Write it straight into the source, no agent:\n${plan.summary?.join('\n')}` : `Can't be written directly: ${plan.reason}\nSend it and the agent will do it.`}><Zap size={12} /> Apply now</button>
                    : <span className="hint">Enter to save · {MOD}+Enter to send</span>}
                </div>
                {plan && !plan.ok && <p className="hint plan-why">Needs the agent: {plan.reason}</p>}
              </div>
            )}

            {(mode === 'draw' || mode === 'sketch') && (
              <DrawToolbar
                tool={tool} setTool={setTool} color={color} setColor={setColor} size={size} setSize={setSize}
                canUndo={drawShapes.canUndo} canRedo={drawShapes.canRedo}
                onUndo={drawShapes.undo} onRedo={drawShapes.redo} onClear={() => drawShapes.set([])}
                onCommit={commitCurrent} commitLabel={mode === 'sketch' ? 'Add sketch' : 'Add drawing'} count={drawShapes.shapes.length}
              />
            )}

            {mode === 'select' && !popover && <div className="mode-hint">Click any element to annotate it · ↑/↓ pick parent/child · Alt measures from the selected one · F freezes open menus · Esc to exit</div>}

            {(!nav.url || nav.url === 'about:blank') && mode !== 'sketch' && (
              <Welcome
                projectDir={settings.projectDir}
                onOpenProject={pickProject}
                devCommand={devCommand}
                devLabel={devInfo?.candidates.find((c) => c.command === devCommand)?.label}
                devRunning={devRunning}
                runningUrl={devRunning ? null : devInfo?.runningUrl}
                onOpenUrl={go}
                onStartDev={quickStartDev}
                onSketch={() => setMode('sketch')}
              />
            )}
            {loadError && nav.url !== 'about:blank' && (
              <div className="load-error">
                <b>Couldn't load the page</b><span>{loadError}</span>
                <div>
                  <button className="btn xs" onClick={() => browser.current?.reload()}>Retry</button>
                  <button className="btn xs ghost" onClick={quickStartDev} title={devCommand || undefined}>Start dev server</button>
                </div>
              </div>
            )}
            {busy && <div className="busy"><Loader2 size={14} className="spin" /> {busy}</div>}
          </div>
          {device.on && (
            <>
              <div className="device-grip x" onPointerDown={startDeviceResize('x')} title="Drag to change the width" />
              <div className="device-grip y" onPointerDown={startDeviceResize('y')} title="Drag to change the height" />
              <div className="device-grip xy" onPointerDown={startDeviceResize('xy')} title="Drag to resize" />
              <span className="device-size">{device.w} × {Math.round(deviceH)}{deviceScale !== 1 ? ` · ${Math.round(deviceScale * 100)}%` : ''}</span>
            </>
          )}
          </div>
          </div>
          {wsOpen && (
            <ComponentsPanel
              render={(spec) => browser.current?.workspace({ ...spec, abs: `${projectDir}/${spec.file}`.split('\\').join('/'), left: Math.round(270 / deviceScale) }) ?? Promise.resolve(null)}
              close={() => browser.current?.closeWorkspace()}
              onClose={() => setWsOpen(false)}
            />
          )}
          {multi && <MultiView url={nav.url} onNavigate={go} onPick={(w, h) => { setMulti(false); setDevice({ on: true, w, h, zoom: 'fit', touch: device.touch }); }} onClose={() => setMulti(false)} />}
        </div>
      </main>

      <aside
        className={`panel ${left ? 'left' : 'right'}`}
        style={settings.panelHidden ? { display: 'none' } : undefined}
        onDragOver={(e) => { if ([...e.dataTransfer.items].some((i) => i.type.startsWith('image/'))) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addReferences(e.dataTransfer.files); }}
      >
        {dragOver && <div className="drop-zone"><ImagePlus size={26} /><b>Drop images as references</b><span>Mockups, screenshots, inspiration</span></div>}
        <div
          className={`resizer col ${resizing === 'panel' ? 'on' : ''}`}
          onPointerDown={startResize('panel')}
          onDoubleClick={() => { setPanelWidth(null); saveSettings({ panelWidth: 400 }); }}
          title="Drag to resize · double-click to reset"
        />
        <div className="panel-head">
          <div className="seg agent-seg">
            {(['claude', 'codex'] as AgentId[]).map((a) => (
              <button
                key={a} className={`${settings.agent === a ? 'on' : ''} ${agents && !agents[a]?.ok ? 'missing' : ''}`}
                onClick={() => saveSettings({ agent: a })} disabled={!!runId}
                title={agents && !agents[a]?.ok ? "Its CLI wasn't found. Install it or set its path in Settings." : agents?.[a]?.version}
              >
                {a === 'claude' ? 'Claude Code' : 'Codex'}
              </button>
            ))}
          </div>
          <div className="spacer" />
          {projectDir && <ChatHistory currentId={chatId} disabled={!!job} others={others} onOpen={openChat} onDelete={deleteChat} />}
          <button className="btn ghost xs" onClick={newChat} disabled={!!job || !chat.length} title={runId ? 'Start another chat. This one keeps working.' : session ? 'Continuing the same agent session. Click to start fresh.' : 'Start a fresh agent session'}><Plus size={13} /><span className="btn-text">New chat</span></button>
        </div>
        {others.length > 0 && (
          <div className="other-chats">
            {others.map((o) => (
              <button key={o.id} className={o.running ? 'running' : 'finished'} onClick={() => openChat(o.id)} title={o.running ? 'Still working. Click to look.' : 'Finished. Click to see the result.'}>
                {o.running ? <Loader2 size={11} className="spin" /> : <Check size={11} />}
                <span>{o.title || 'Untitled'}</span>
              </button>
            ))}
          </div>
        )}

        <div className="chat" onScroll={onChatScroll} onWheel={onChatWheel}>
          {chat.length === 0 ? (
            <EmptyChat agentName={settings.agent === 'claude' ? 'Claude Code' : 'Codex'} cliMissing={!!agents && !agentReady} setMode={setMode} />
          ) : <ChatList items={chat} actions={chatActions} root={root} gitRepo={!!gitStatus?.repo} busy={!!runId || !!job} />}
          {(runId || job) && (
            <div className="working">
              <Loader2 size={14} className="spin" />{' '}
              {job || `${runMeta?.variant ? `Variant ${runMeta.variant.index} of ${runMeta.variant.total}: ` : ''}${settings.agent === 'claude' ? 'Claude Code' : 'Codex'} is ${runMeta?.verify ? 'checking the result' : 'working'}…`}
            </div>
          )}
          {away && chat.length > 0 && (
            <div className="to-latest">
              <button className={away.fresh ? 'fresh' : ''} onClick={toLatest} title="Go to the latest message">
                <ArrowDown size={13} /> {away.fresh ? 'New messages' : 'Latest'}
              </button>
            </div>
          )}
          <div ref={chatEnd} />
        </div>

        <div className="composer">
          <BackgroundRuns
            runs={bgRuns} onApply={applyBg} onDiscard={discardBg}
            onDiff={(r) => api.bgDiff(r.id).then((text) => setPatchView({ title: r.title, text }))}
          />
          {projectDir && (
            <ContextBar
              lead={<>
                <GitPanel status={gitStatus} refresh={refreshGit} settings={settings} saveSettings={saveSettings} busy={!!runId} prDefaults={prDefaults} flash={flash} />
                <PinsChip projectDir={projectDir} url={nav.url} title={nav.title} flash={flash} onCompare={(images, title) => setCompare({ images, labels: ['Pinned', 'Now'], title })} />
              </>}
              route={currentRoute}
              console={consoleLog} network={netFails}
              includeDiag={includeDiag} setIncludeDiag={setIncludeDiag}
              onClearDiag={clearDiagnostics} onAskFix={askToFix}
              designSystem={designSystem}
              a11y={a11y} includeA11y={includeA11y} setIncludeA11y={setIncludeA11y} onAskA11y={askA11y}
              onShowNode={(sel) => browser.current?.reveal(sel)}
            />
          )}
          <AnnotationList
            annotations={annotations} root={root} activeId={activeId} overlayImage={overlay?.image ?? null}
            pageMarks={page.shapes.length} sketchMarks={sketch.shapes.length}
            onFocus={focusAnn} onActive={setActiveId} onNote={updateNote} onPaste={onPaste} onSend={() => send()}
            onCopyTest={(a) => { navigator.clipboard?.writeText(toPlaywright(a)); flash('Playwright test copied.'); }}
            onOverlay={(a) => setOverlay(overlay?.image === a.image ? null : { image: a.image!, name: a.name || 'mockup', opacity: 0.5, x: 0, y: 0, moving: false })}
            onRemove={removeAnn}
          />

          <div className="composer-box">
            <textarea
              ref={composerRef}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={runId
                ? `Steer the agent: Enter adds it after the current step · ${MOD}+Enter interrupts now`
                : annotations.length ? 'Anything else? (optional)' : chat.length ? 'Follow up…' : 'Describe the change, or select/draw on the page first…'}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
                e.preventDefault();
                send(runId && (e.ctrlKey || e.metaKey) ? 'now' : 'queue');
              }}
              onPaste={onPaste}
              rows={3}
            />
            <div className="composer-foot">
              <button className="icon-btn attach-btn" onClick={() => fileInput.current?.click()} title="Attach reference images (or paste / drop them)"><Paperclip size={15} /></button>
              {!runId && <HandoffMenu hasRequest={!!(instruction.trim() || annotations.length)} canIssue={!!gitStatus?.gh.authed && !!gitStatus?.remote} onExport={exportHandoff} onCopy={copyHandoff} onIssue={issueHandoff} onImport={importHandoff} />}
              <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) addReferences(e.target.files); e.target.value = ''; }} />
              {!runId && <VariantsMenu value={settings.variants || 0} set={(n) => saveSettings({ variants: n })} />}
              {runId
                ? <span className="steer-hint"><kbd>↵</kbd> after this step <kbd>{MOD}↵</kbd> now</span>
                : <AgentControls settings={settings} catalog={catalog} onChange={saveSettings} />}
              {runId ? (
                <div className="run-actions">
                  <button className="icon-btn stop-btn" onClick={cancel} title="Stop the agent"><Square size={13} /></button>
                  <button className="btn sm ghost send-btn" disabled={!canSend} onClick={() => send('now')} title={`Interrupt the current step and send now (${MOD}+Enter)`}><Zap size={13} /><span className="btn-text">Now</span></button>
                  <button className="btn primary sm send-btn" disabled={!canSend} onClick={() => send('queue')} title="Send after the agent's current step (Enter)"><CornerDownRight size={13} /><span className="btn-text">Steer</span></button>
                </div>
              ) : (
                <div className="run-actions">
                  <button className="icon-btn bg-btn" disabled={!canSend || !!bgBlocked} onClick={() => send('bg')} title={bgBlocked || 'Run in the background: in a separate copy of the project, so you can keep working and send more'}><SquareStack size={15} /></button>
                  <button className="btn primary sm send-btn" disabled={!canSend} onClick={() => send()} title="Send (Enter)"><Send size={13} /><span className="btn-text">Send</span></button>
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>

      {drawerOpen && (
        <div className="drawer-wrap">
        <div className={`resizer row ${resizing === 'drawer' ? 'on' : ''}`} onPointerDown={startResize('drawer')} />
        <Drawer
          tab={drawerTab} setTab={setDrawerTab} devLog={devLog} agentLog={agentLog}
          netFailed={requests.filter(requestFailed).length}
          network={
            <NetworkPanel
              requests={requests} mocks={mocks} setMocks={setMocks}
              findHandler={(url, method) => api.findHandler(url, method)}
              onAdd={addRequest} onReplay={replayRequest} onOpenFile={openFile} onBuild={buildMock} onClear={clearRequests}
            />
          }
          cwd={projectDir} shell={settings.terminalShell} onShell={(terminalShell) => { if (terminalShell !== settingsRef.current?.terminalShell) saveSettings({ terminalShell }); }}
          devRunning={devRunning} devCommand={devCommand} devCandidates={devInfo?.candidates}
          onStartDev={startDev} onStopDev={() => api.stopDev()} onClose={() => setDrawerOpen(false)}
        />
        </div>
      )}
      {resizing && <div className={`drag-shield ${resizing}`} />}

      {sheet && (
        <ContextSheet
          tab={sheet} setTab={setSheet} onClose={() => setSheet(null)}
          settings={settings} saveSettings={saveSettings}
          design={design} setDesign={setDesign}
          memory={memory} setMemory={setMemory}
          canExtract={/^(https?|file):/.test(nav.url)}
          extract={() => browser.current?.extractDesign() ?? Promise.resolve(null)}
          askAgent={askAgentForDesign}
          root={root}
          designChanged={designChanged}
          onNewChat={() => { newChat(); setSheet(null); flash('New chat: the next request sends the updated design rules.'); }}
          chatBusy={!!runId}
        />
      )}
      {enginesOpen && (
        <EnginesView
          url={nav.url}
          capture={cleanCapture}
          shoot={() => api.enginesShoot({ webContentsId: browser.current!.id()!, url: navRef.current.url, ...browser.current!.size() })}
          onCompare={(images, labels, title) => setCompare({ images, labels, title })}
          onClose={() => setEnginesOpen(false)}
        />
      )}
      {patchView && (
        <div className="modal-backdrop" onMouseDown={() => setPatchView(null)}>
          <div className="compare-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="diff-head"><h3>{patchView.title}</h3><div className="spacer" /><button className="icon-btn" onClick={() => setPatchView(null)}><X size={16} /></button></div>
            <pre className="patch-view">{patchView.text.split('\n').map((l, i) => <span key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') || l.startsWith('diff ') ? 'meta' : ''}>{l + '\n'}</span>)}</pre>
          </div>
        </div>
      )}
      {compare && <CompareView {...compare} onClose={() => setCompare(null)} captureSizes={captureSizes} />}
      {diffView && (
        <DiffViewer
          runId={diffView.runId} initialPath={diffView.path}
          onClose={() => setDiffView(null)}
          onReverted={(r) => applyRevert(diffView.runId, r)}
          onOpen={openFile}
        />
      )}
      {settingsOpen && <SettingsModal settings={settings} agents={agents} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function markerList(anns: Annotation[], activeId: string | null) {
  return anns
    .filter((a) => a.kind === 'element' && a.element)
    .map((a) => ({ uid: a.element!.uid, n: a.n, color: a.color, active: a.id === activeId }));
}
