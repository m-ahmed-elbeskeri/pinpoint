import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Globe, Loader2, Monitor,
  Plus, RotateCw, Smartphone, Square, Tablet,
  Bug, Brain, AlertTriangle, History, Search, Keyboard, DotsThree, Pencil, Pin, FileText, FolderOpen, MousePointer2, MousePointerClick, Palette, PanelLeft, PenTool, Settings as SettingsIcon, SquarePen, TerminalSquare, MessageSquare,
  Trash2, X, Paperclip, ImagePlus, Zap, CornerDownRight, ClipboardCopy,
  AppWindow, Boxes, GitCompareArrows, CircleDot, Columns2, Columns3, ShieldCheck, Snowflake, SquareStack, FileTree, GitPullRequestArrow, LayoutGrid, Maximize, NewWindow, Users,
} from './components/icons';
import { FilesPanel } from './components/FilesPanel';
import { Onboarding } from './components/Onboarding';
import { LayoutsSheet } from './components/LayoutsSheet';
import { SweepView } from './components/SweepView';
import { ReviewPanel } from './components/ReviewPanel';
import { VariantsLive } from './components/VariantsLive';
import { sweepInstruction, worstShots } from './lib/sweep';
import { BrowserView, sleep, type BrowserHandle, type FrameTarget, type PickedElement } from './components/BrowserView';
import { DrawSurface } from './components/DrawSurface';
import { DrawToolbar, TOOL_KEYS } from './components/DrawToolbar';
import { ChatList, invalidateDiff, shortPath, type ChatActions } from './components/Chat';
import { SettingsModal } from './components/SettingsModal';
import { Drawer, TOOLS, type DrawerTab } from './components/Drawer';
import { AgentControls } from './components/AgentControls';
import { Welcome } from './components/Welcome';
import { ContextSheet, type ContextTab } from './components/ContextSheet';
import { ContextBar } from './components/ContextBar';
import { DiffViewer } from './components/DiffViewer';
import { BranchCompare } from './components/BranchCompare';
import { RoutePicker } from './components/RoutePicker';
import { ChatHistory } from './components/ChatHistory';
import { ThreadSidebar } from './components/ThreadSidebar';
import { SideChat } from './components/SideChat';
import { ShortcutsSheet, StatusBar } from './components/StatusBar';
import { ContextMeter, ReadingStrip } from './components/AgentStatus';
import { Timeline } from './components/Timeline';
import { PullIcon } from './components/PullIcon';
import { useComposerAssist, type SlashCommand } from './components/ComposerAssist';
import { AgentPicker } from './components/AgentPicker';
import { CommandPalette, type Command } from './components/CommandPalette';
import { GitPanel } from './components/GitPanel';
import { CompareView, type CompareTarget } from './components/CompareView';
import { diffOverlay, looksSame } from './lib/pixeldiff';
import { ElementTools, type ToolSection } from './components/ElementTools';
import { ConditionsMenu, HandoffMenu, MAX_VARIANTS, NO_CONDITIONS, PinsChip, VariantsMenu, describeConditions, type Conditions } from './components/PageTools';
import { MultiView } from './components/MultiView';
import { BackgroundRuns, ComponentsPanel, EnginesView, ProfileMenu } from './components/Workbench';
import { MockupOverlay, fitMockup, type Overlay } from './components/MockupOverlay';
import { DeviceBar, DEVICE_OFF, type Breakpoint, type Device } from './components/DeviceBar';
import { ANNOTATION_COLORS, composite, samplePoints, thumbnail, uid, unionBounds } from './lib/draw';
import type {
  OtherChat, ChatMeta, HarnessInfo, GitPull, ApprovalDecision, SavedLayout,
  A11yIssue, ApiHandler, Mock, NetRequest, NetworkFailure, AgentEvent, AgentId, Annotation, BgRun, ChatItem, Profile, UpdateState, ConsoleEntry, DesignDoc, DesignSystem, DevDetection, FlowResult, FlowStep, ForcedState, Handoff, MemoryItem, Mode, ModelCatalog,
  GitStatus, PageEnv, Rect, RevertResult, ReviewComment, RouteInfo, Settings, SourceInfo, SweepPage, Tool,
} from './lib/types';

import { makeTab, matchRoute, normalizeUrl, pairs, partitionOf, tabLabel, type Tab } from './lib/urls';
import { applyPlan, chatTitle, conversationText, expireApprovals, finalizeItems, healChat, mergeDeltas, mergeRequests, needsInput, splitMemory, type AgentRequest, type ParkedChat, type RunMeta } from './lib/chat';
import { describe, handoffMarkdown, toPlaywright } from './lib/handoff';
import { clampRect, errText, readImage, stripAnsi } from './lib/util';
import { useShapes } from './lib/useShapes';
import { layoutReport } from './lib/layoutReport';
import { useChatScroll, useLogs, usePageProblems, useRequests, useStableActions } from './lib/hooks';
import { NetworkPanel, failed as requestFailed, pathOf } from './components/NetworkPanel';
import { TopBar } from './components/TopBar';
import { SiteChip } from './components/SiteChip';
import { originOf, siteKind, twinUrl, type BuildKind } from './lib/site';
import { EmptyChat } from './components/EmptyChat';
import { AnnotationList, ImageChips } from './components/AnnotationList';

const api = window.pinpoint;
export const isMac = api.platform === 'darwin';
export const MOD = isMac ? '⌘' : 'Ctrl';
document.documentElement.classList.add(`platform-${api.platform}`);
api.onFullscreen((fs) => document.documentElement.classList.toggle('fullscreen', fs));

const THREADS_W = 248;
const SPEND_KEY = 'pp.spend';
const today = () => new Date().toISOString().slice(0, 10);
const spentToday = () => { try { const s = JSON.parse(localStorage.getItem(SPEND_KEY) || '{}'); return s.day === today() ? s.total || 0 : 0; } catch { return 0; } };
const addSpend = (cost: number) => { try { localStorage.setItem(SPEND_KEY, JSON.stringify({ day: today(), total: spentToday() + cost })); } catch { /* storage off */ } };
const HISTORY_KEY = 'pp.promptHistory';
const readHistory = (): string[] => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } };
const rememberPrompt = (text: string) => {
  const t = text.trim();
  if (!t || t.startsWith('/')) return;
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify([t, ...readHistory().filter((x) => x !== t)].slice(0, 200))); } catch { /* storage off */ }
};
const snippetName = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).slice(0, 3).join('-') || 'snippet';
export const combo = (k: string, shift = false) => isMac ? `⌘${shift ? '⇧' : ''}${k}` : `Ctrl+${shift ? 'Shift+' : ''}${k}`;

const MATCH_ROUNDS = 3;
const MATCH_GOAL = 3;

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
  const [harnesses, setHarnesses] = useState<HarnessInfo[]>([]);
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
  // Terminal, dev server, network and logs open as tabs beside the page tabs.
  const [toolTabs, setToolTabs] = useState<DrawerTab[]>([]);
  const [plusOpen, setPlusOpen] = useState(false);
  const plusTimer = useRef(0);
  const [resizing, setResizing] = useState<'panel' | 'drawer' | 'device' | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('term');
  const { devLog, agentLog, setDevLog, setAgentLog, addLog } = useLogs();
  const [devRunning, setDevRunning] = useState(false);
  const [devInfo, setDevInfo] = useState<DevDetection | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [zen, setZen] = useState(false);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  // Rarely used controls stay folded behind a ⋯ until asked for.
  const [pageToolsOpen, setPageToolsOpen] = useState(false);
  const [composerMore, setComposerMore] = useState(false);
  const [usage, setUsage] = useState<{ used: number; window?: number } | null>(null);
  const [limits, setLimits] = useState<{ status: 'ok' | 'warning' | 'rejected'; used?: number; resetsAt?: number; window?: string } | null>(null);
  const [mcp, setMcp] = useState<{ name: string; status: string }[]>([]);
  const [pastes, setPastes] = useState<{ id: string; text: string }[]>([]);
  const [pasteOpen, setPasteOpen] = useState<string | null>(null);
  const historyAt = useRef(-1);
  useEffect(() => { if (drawerOpen) setToolTabs((l) => (l.includes(drawerTab) ? l : [...l, drawerTab])); }, [drawerOpen, drawerTab]);
  const plusLeft = Math.max(8, (document.querySelector('.tab-new-wrap') as HTMLElement | null)?.offsetLeft ?? 8);
  const chatBox = useRef<HTMLDivElement>(null);
  const markBelow = () => {
    const c = chatBox.current;
    if (c) c.parentElement?.classList.toggle('more-below', c.scrollHeight - c.scrollTop - c.clientHeight > 6);
  };
  useEffect(() => {
    if (!composerMore) return;
    const away = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.composer-tray-wrap')) setComposerMore(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setComposerMore(false); };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [composerMore]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toolsHover, setToolsHover] = useState(false);
  const toolsTimer = useRef(0);
  const [sides, setSides] = useState<{ id: string; title: string; seed: string | null; running: boolean }[]>([]);
  const [activeSide, setActiveSide] = useState<string | null>(null);
  const [askAside, setAskAside] = useState<{ text: string; x: number; y: number } | null>(null);
  const [paletteChats, setPaletteChats] = useState<ChatMeta[]>([]);
  const [paletteHits, setPaletteHits] = useState<{ id: string; title: string; snippet: string }[]>([]);
  const searchTimer = useRef(0);
  const searchChats = (q: string) => {
    clearTimeout(searchTimer.current);
    if (q.length < 2) { setPaletteHits([]); return; }
    searchTimer.current = window.setTimeout(() => api.searchChats(q).then(setPaletteHits).catch(() => setPaletteHits([])), 180);
  };
  const [toast, setToast] = useState<string | null>(null);

  const [chatId, setChatId] = useState<string | null>(null);
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  // The branch each chat worked on, and the pull requests by branch.
  const branchOf = useRef(new Map<string, string>());
  const [pulls, setPulls] = useState<Record<string, GitPull>>({});
  const [chatCreated, setChatCreated] = useState(0);
  const [designAtStart, setDesignAtStart] = useState<string | null>(null);
  const [design, setDesign] = useState<DesignDoc | null>(null);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [sheet, setSheet] = useState<ContextTab | null>(null);
  const [diffView, setDiffView] = useState<{ runId: string; path?: string } | null>(null);
  const [branchCompare, setBranchCompare] = useState<{ base?: string; remote?: boolean; pr?: boolean } | null>(null);
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
  const runFlowRef = useRef<Record<string, { steps: FlowStep[]; startUrl: string; seen?: { errors: string[]; failed: string[] } }>>({});
  const tapRef = useRef<{ errors: string[]; failed: string[] } | null>(null);
  useEffect(() => api.onNetworkError((n) => { tapRef.current?.failed.push(`${n.method} ${pathOf(n.url)} (${n.status || n.error})`); }), []);
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
  const [sweepOpen, setSweepOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [liveVariants, setLiveVariants] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [bgRuns, setBgRuns] = useState<BgRun[]>([]);
  const [bgBlocked, setBgBlocked] = useState<string | null>(null);
  const [patchView, setPatchView] = useState<{ title: string; text: string } | null>(null);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const runMetaRef = useRef<Record<string, RunMeta>>({});
  const beforeShotRef = useRef<{ id: string; shot: string } | null>(null);
  const variantJob = useRef<{ base: AgentRequest; total: number; index: number; done: { runId: string; index: number; files: number }[] } | null>(null);
  const verifyPending = useRef<string | null>(null);
  const matchRef = useRef<{ image: string; x: number; y: number; round: number; last: number } | null>(null);
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
  const flashRef = useRef(flash);
  flashRef.current = flash;

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
    api.listAgents().then(setHarnesses);
  }, []);

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await api.setSettings(patch);
    setSettings(next);
    if ('claudePath' in patch || 'codexPath' in patch || 'agentPaths' in patch || 'customAgents' in patch) {
      api.detectAgents().then(setAgents);
      api.listAgents().then(setHarnesses);
    }
  }, []);

  const projectDir = settings?.projectDir || '';
  const theme = settings?.theme || 'dark';
  useEffect(() => {
    document.documentElement.dataset.textSize = settings?.textSize || 'normal';
    document.documentElement.dataset.density = settings?.density || 'comfortable';
  }, [settings?.textSize, settings?.density]);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const light = theme === 'light' || (theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = light ? 'light' : 'dark';
      api.setWindowTheme(light).catch(() => {});
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  const wantChat = useRef<string | null>(null);
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
      const want = wantChat.current;
      wantChat.current = null;
      const pick = (want && list.find((c) => c.id === want)) || list[0];
      const last = pick ? await api.loadChat(pick.id) : null;
      if (last?.branch) branchOf.current.set(last.id, last.branch);
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
      if (!branchOf.current.has(chatId) && gitStatus?.branch) branchOf.current.set(chatId, gitStatus.branch);
      api.saveChat({ id: chatId, branch: branchOf.current.get(chatId), title, createdAt: chatCreated || Date.now(), updatedAt: Date.now(), agent: settingsRef.current?.agent || 'claude', session, designAtStart, items: chat }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [chat, session, chatId, projectDir, designAtStart]);

  const parked = useRef(new Map<string, ParkedChat>());
  // A desktop notification, only when the window isn't the one you're looking at.
  // A short, quiet tone for "done" and "needs you", if switched on in Settings.
  const chime = (kind: 'done' | 'ask') => {
    if (!settingsRef.current?.sounds) return;
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = kind === 'ask' ? 660 : 520;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.36);
      o.onended = () => ctx.close();
    } catch { /* audio unavailable */ }
  };
  const notify = (body: string) => {
    chime(/needs your OK|Waiting for your OK/.test(body) ? 'ask' : 'done');
    if (document.hasFocus()) return;
    api.notify('Pinpoint', body).catch(() => {});
  };
  const [others, setOthers] = useState<OtherChat[]>([]);
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const syncOthers = (finished?: ParkedChat, seen?: string) => setOthers((o) => [
    ...[...parked.current.values()].map((p) => ({ id: p.id, title: chatTitle(p.items), running: true, needsInput: needsInput(p.items) })),
    ...o.filter((x) => !x.running && !parked.current.has(x.id) && x.id !== seen && x.id !== finished?.id),
    ...(finished ? [{ id: finished.id, title: chatTitle(finished.items), running: false }] : []),
  ]);
  const saveParked = (p: ParkedChat) => api.saveChat({
    branch: branchOf.current.get(p.id),
    id: p.id, title: chatTitle(p.items), createdAt: p.createdAt, updatedAt: Date.now(), agent: p.agent, session: p.session, designAtStart: p.designAtStart, items: p.items,
  }).catch(() => {});

  // Unsent annotations belong to the chat they were made in: put aside on switching away, back on return.
  const annByChat = useRef(new Map<string, Annotation[]>());
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
    const key = chatId || 'new';
    if (annRef.current.length) annByChat.current.set(key, annRef.current); else annByChat.current.delete(key);
    setAnnotations([]);
    setPopover(null);
    return true;
  };
  const restoreAnnotations = (id: string | null) => {
    const back = annByChat.current.get(id || 'new') || [];
    annByChat.current.delete(id || 'new');
    setAnnotations(back);
  };
  const showChatReset = () => setUsage(null);
  const showChat = (c: { id: string; createdAt: number; items: ChatItem[]; session: ParkedChat['session']; designAtStart?: string | null }, running: string | null) => {
    showChatReset();
    restoreAnnotations(c.id);
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
      if (c?.branch) branchOf.current.set(c.id, c.branch);
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
      case 'git': branchOf.current.set(p.id, e.branch); refreshGit(); break;
      case 'text': { const m = splitMemory(e.text); p.items = finalizeItems(p.items, 'text', m.text, m.extra); break; }
      case 'thinking': p.items = finalizeItems(p.items, 'thinking', e.text); break;
      case 'tool': add({ kind: 'tool', id: uid(), toolId: e.id, name: e.name, detail: e.detail, status: 'running', edits: e.edits, at: Date.now(), parent: e.parent }); break;
      case 'plan': p.items = applyPlan(p.items, e.steps); break;
      case 'limits': setLimits(e.status === 'ok' ? null : e); break;
      case 'mcp': setMcp(e.servers); break;
      case 'approval':
        add({ kind: 'approval', id: uid(), runId: e.runId, approvalId: e.approvalId, tool: e.tool, detail: e.detail, status: 'pending' });
        syncOthers();
        notify(`${chatTitle(p.items)} needs your OK: ${e.tool}`);
        flash(`Another chat is waiting for your OK: ${chatTitle(p.items)}`);
        break;
      case 'tool_result':
        p.items = p.items.map((it) => (it.kind === 'tool' && it.toolId === e.id ? { ...it, status: e.ok ? 'ok' : 'error', output: e.text || it.output, ms: it.at ? Date.now() - it.at : undefined } : it));
        break;
      case 'error': add({ kind: 'error', id: uid(), text: e.text }); break;
      case 'done':
        notify(`${e.ok ? 'Finished' : 'Stopped'}: ${chatTitle(p.items)}`);
        p.items = [
          ...expireApprovals(p.items).map((it) => (it.kind === 'tool' && it.status === 'running' ? { ...it, status: 'ok' as const }
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
      tapRef.current = { errors: [], failed: [] };
      b?.send('record', true);
      return;
    }
    b?.send('record', false);
    setRec(null);
    const seen = tapRef.current;
    tapRef.current = null;
    if (!rec.steps.length) { flash('Nothing was recorded.'); return; }
    const n = nextN();
    const ann: Annotation = { id: uid(), n, kind: 'flow', note: '', color: colorFor(n), steps: rec.steps, startUrl: rec.startUrl, ...(seen && (seen.errors.length || seen.failed.length) && { seen: { errors: seen.errors.slice(-6), failed: seen.failed.slice(-6) } }) };
    setAnnotations((prev) => [...prev, ann]);
    setActiveId(ann.id);
    setTimeout(() => document.querySelector<HTMLTextAreaElement>(`[data-note="${ann.id}"]`)?.focus({ preventScroll: true }), 50);
  };
  const replayFlow = async (flow: { steps: FlowStep[]; startUrl: string }): Promise<FlowResult | null> => {
    const b = browser.current;
    if (!b) return null;
    setMode('browse');
    const tap = { errors: [] as string[], failed: [] as string[] };
    tapRef.current = tap;
    try {
      if (navRef.current.url === flow.startUrl) b.reload(); else b.load(flow.startUrl);
      await sleep(600);
      for (let i = 0; i < 50 && loadingRef.current; i++) await sleep(200);
      await sleep(900);
      const id = b.id();
      const ran = id != null ? await api.replay(id, flow.steps).catch(() => null) : null;
      await sleep(700);
      return ran ? { done: ran.done, total: ran.total, errors: [...new Set(tap.errors)].slice(0, 6), failed: [...new Set(tap.failed)].slice(0, 6) } : null;
    } finally { if (tapRef.current === tap) tapRef.current = null; }
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
    setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 50);
  };

  const [measured, setMeasured] = useState<{ origin: string; tab: string; build: BuildKind } | null>(null);
  const [twins, setTwins] = useState({ local: '', live: '', homepage: '' });
  const siteOrigin = originOf(nav.url);
  const build = measured && measured.origin === siteOrigin && measured.tab === activeTab ? measured.build : null;
  const kind = siteKind(nav.url, build);
  useEffect(() => {
    if (loading || !siteOrigin) return;
    let live = true;
    const t = setTimeout(() => { browser.current?.buildKind().then((b) => { if (live) setMeasured({ origin: siteOrigin, tab: activeTab, build: b }); }); }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [nav.url, loading, siteOrigin, activeTab]);
  useEffect(() => {
    if (!projectDir) return;
    api.siteHints().then((h) => setTwins((t) => ({ ...t, homepage: h.homepage || '' }))).catch(() => {});
  }, [projectDir]);
  const ownSite = !routes.length || !!matchRoute(routes, nav.url, projectDir) || siteOrigin === twins.homepage;
  useEffect(() => {
    if (!siteOrigin || build === null) return;
    if (kind === 'dev') setTwins((t) => (t.local === siteOrigin ? t : { ...t, local: siteOrigin }));
    else if (kind === 'live' && ownSite) {
      setTwins((t) => (t.live === siteOrigin ? t : { ...t, live: siteOrigin }));
      if (settingsRef.current?.liveUrl !== siteOrigin) saveSettings({ liveUrl: siteOrigin });
    }
  }, [kind, siteOrigin, build, ownSite]);
  const localOrigin = [twins.local, devInfo?.runningUrl || ''].find((o) => o && o !== siteOrigin) || '';
  const liveOrigin = [twins.live, settings?.liveUrl || '', twins.homepage].find((o) => o && o !== siteOrigin) || '';
  const localTwin = kind === 'live' || kind === 'built' ? twinUrl(nav.url, localOrigin) : '';
  const siteRef = useRef({ kind, localTwin });
  siteRef.current = { kind, localTwin };

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
    await b.hideMarks();
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
      setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 50);
    } catch (e) { flash(errText(e)); }
  };

  const releaseElement = async (a: Annotation) => {
    const b = (a.tabId && handles.current[a.tabId]) || browser.current;
    const wc = b?.id();
    if (!a.element?.uid || !b) return;
    b.send('untweak', a.element.uid);
    const comp = a.element.component;
    for (const [name, edit] of Object.entries(a.propEdits || {})) b.setProp(a.element.uid, comp?.name || '', name, JSON.parse(edit.from));
    if (a.states?.length && wc != null) await api.forceState(wc, `[data-pinpoint="${a.element.uid}"]`, []).catch(() => {});
  };

  const makeDrawing = async (n: number): Promise<Annotation | null> => {
    const b = browser.current;
    if (!b || !page.shapes.length) return null;
    const { width, height } = b.size();
    await b.hideMarks();
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
      setTimeout(() => document.querySelector<HTMLTextAreaElement>(`[data-note="${ann.id}"]`)?.focus({ preventScroll: true }), 50);
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
    setTimeout(() => document.querySelector<HTMLTextAreaElement>(`[data-note="${added[0].id}"]`)?.focus({ preventScroll: true }), 50);
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addReferences(files); return; }
    // A long paste becomes a chip that goes with the message, instead of a wall of text in the box.
    const text = e.clipboardData.getData('text/plain');
    if ((e.target as HTMLElement).closest('.composer-box') && (text.length > 2000 || text.split('\n').length > 30)) {
      e.preventDefault();
      setPastes((list) => [...list, { id: uid(), text }]);
    }
  };
  // Files dropped from the computer: images become references, anything else is mentioned by path.
  const dropFiles = (files: FileList) => {
    const all = [...files];
    const images = all.filter((f) => f.type.startsWith('image/'));
    if (images.length) addReferences(images);
    const root = (settingsRef.current?.projectDir || '').replace(/\\/g, '/').replace(/\/$/, '');
    const refs = all.filter((f) => !f.type.startsWith('image/')).map((f) => api.pathForFile(f).replace(/\\/g, '/')).filter(Boolean)
      .map((p) => (root && p.toLowerCase().startsWith(root.toLowerCase() + '/') ? `@${p.slice(root.length + 1)}` : /\s/.test(p) ? `"${p}"` : p));
    if (refs.length) {
      setInstruction((v) => `${v}${v && !/\s$/.test(v) ? ' ' : ''}${refs.join(' ')} `);
      setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 30);
    }
  };

  // Messages waiting for the current run to end, each with the chat message that shows it.
  const queuedRef = useRef<{ itemId: string; request: AgentRequest }[]>([]);
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
    runMetaRef.current[id] = { ...meta, startedAt: Date.now(), ...(request.site && { site: request.site.kind }) };
    const asked = request.annotations.flatMap((a) => (a.kind === 'request' && a.request ? [a.request] : []));
    if (!meta.verify && !meta.variant) {
      const mine = runMetaRef.current[id];
      if (asked.length) mine.requests = asked;
      mine.devAnchor = stripAnsi(devLogRef.current).slice(-200);
      api.serverLogMark().then((n) => { mine.logMark = n; }).catch(() => {});
    }
    const flow = request.annotations.find((a) => a.kind === 'flow' && a.steps?.length);
    if (flow && !meta.verify) runFlowRef.current[id] = { steps: flow.steps!, startUrl: flow.startUrl || request.url, seen: flow.seen };
    runPageRef.current[id] = request.url;
    if (before) { beforeShotRef.current = { id, shot: before }; api.saveShot(id, 'before', before).catch(() => {}); }
    setAgentLog('');
    setRunId(id);
    runRef.current = id;
    const sess = sessionRef.current;
    const resume = sess && sess.agent === settings.agent ? sess.id : null;
    if (!resume) setDesignAtStart(settings.useDesign && design?.exists ? design.content : '');
    // A forked or handed-over chat, a change of agent, or an agent that can't resume: the new session is told what was said.
    if (!resume && !meta.variant && !meta.verify) {
      const items = chatRef.current;
      let cut = items.length - 1;
      while (cut >= 0 && items[cut].kind !== 'user') cut--;
      const earlier = conversationText(items.slice(0, Math.max(0, cut)), 6000);
      if (earlier) request = { ...request, carried: earlier };
    }
    try {
      await api.runAgent({ runId: id, request, sessionId: resume, check: meta.variant || meta.verify || request.site ? undefined : otherRoutes(request.url, request.annotations.flatMap((a) => (a.kind === 'element' && a.element ? [a.element.selector] : (a.hits || []).map((h) => h.selector)))) });
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
    const merged = mergeRequests(queuedRef.current.map((q) => q.request));
    queuedRef.current = [];
    startRun(merged);
  }, [runId, flushTick]);

  const unqueue = (itemId: string, edit: boolean) => {
    const q = queuedRef.current.find((x) => x.itemId === itemId);
    if (!q) return;
    queuedRef.current = queuedRef.current.filter((x) => x.itemId !== itemId);
    setChat((c) => c.filter((it) => it.id !== itemId));
    if (edit) { setInstruction(q.request.instruction); setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 30); }
    setFlushTick((t) => t + 1);
  };

  // Quick replies and Retry send a fixed text without touching what's typed in the composer.
  const sendOverride = useRef<string | null>(null);
  const sendText = (text: string) => { sendOverride.current = text; send(); };
  const send = async (mode: 'queue' | 'now' | 'bg' = 'queue') => {
    const pasted = sendOverride.current == null ? pastes.map((p) => `Pasted text:\n\`\`\`\n${p.text}\n\`\`\``).join('\n\n') : '';
    const typed = [sendOverride.current ?? instruction, pasted].filter((x) => x.trim()).join('\n\n');
    const fromBox = sendOverride.current == null;
    sendOverride.current = null;
    if (!settings || busy || (mode !== 'bg' && job && !runRef.current)) return;
    verifyPending.current = null;
    if (mode !== 'bg') matchRef.current = null;
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
      if (!typed.trim() && !anns.length) { flash('Pick an element, draw, or type what you want first.'); return; }

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
        instruction: typed.trim(),
        overview,
        annotations: anns.map(({ id: _i, color: _c, ...a }) => a),
        diagnostics,
        route: currentRoute ? { path: currentRoute.route, file: currentRoute.file, framework: currentRoute.framework } : undefined,
        env: env.colorScheme || env.reducedMotion || frozen || describeConditions(cond).length || mocks.some((m) => m.on) || viewAs
          ? { ...env, frozen, states: [...describeConditions(cond), ...mocks.filter((m) => m.on).map((m) => `${m.method} ${m.path} is answered by a mock the user wrote (status ${m.status}), not by the real server`)], ...(viewAs && { profile: { name: viewAs.name, detail: [viewAs.locale, viewAs.timezone, viewAs.flags?.trim() && `flags: ${pairs(viewAs.flags, '=').map(([k, v]) => `${k}=${v}`).join(', ')}`].filter(Boolean).join(', ') } }) }
          : undefined,
        note: pendingNote.current || undefined,
        site: siteRef.current.kind === 'live' || siteRef.current.kind === 'built' ? { kind: siteRef.current.kind, local: siteRef.current.localTwin || undefined } : undefined,
      };
      pendingNote.current = null;
      if (!chatId) { setChatId(uid()); setChatCreated(Date.now()); }
      const thumbs = await Promise.all(anns.map(async (a) => ({ ...a, image: a.image ? await thumbnail(a.image) : undefined })));

      if (fromBox) { rememberPrompt(instruction); setInstruction(''); setPastes([]); setPasteOpen(null); historyAt.current = -1; }
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
        const itemId = uid();
        setChat((c) => [...c, { kind: 'user', id: itemId, text: request.instruction, annotations: thumbs, agent: settings.agent, steer: r.delivered ? mode : 'later' }]);
        if (!r.delivered) {
          queuedRef.current.push({ itemId, request });
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

  const cancel = () => { matchRef.current = null; if (runId) api.cancelAgent(runId); };

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
    await b.hideMarks();
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
    if (meta.match && matchRef.current && (!e.changes?.length || meta.site)) {
      matchRef.current = null;
      if (e.ok) setChat((c) => [...c, { kind: 'status', id: uid(), text: 'Stopped matching the mockup: the last round changed nothing that can be compared here.' }]);
    }
    if (!e.changes?.length || meta.site) return;
    await captureAfter(e.runId);
    runA11y();
    const flow = runFlowRef.current[e.runId];
    let replayed: FlowResult | null = null;
    let flowShot: string | null = null;
    if (flow && e.ok && !meta.verify && verifyPending.current === e.runId && !runRef.current && !queuedRef.current.length) {
      setJob('Replaying the steps you recorded…');
      try {
        replayed = await replayFlow(flow);
        flowShot = await cleanCapture();
      } finally { setJob(null); }
      if (replayed) {
        const result = { ...replayed, ...(flow.seen && { before: { errors: flow.seen.errors.length, failed: flow.seen.failed.length } }) };
        setChat((c) => c.map((it) => (it.kind === 'done' && it.runId === e.runId ? { ...it, flow: result } : it)));
      }
    }
    if (meta.match) return nextMatchRef.current(e);
    if (meta.verify || !e.ok || !settingsRef.current?.autoVerify) return;
    if (verifyPending.current !== e.runId || runRef.current || queuedRef.current.length) return;
    verifyPending.current = null;
    const shots = await api.runShots(e.runId, ['before', 'after']).catch(() => ({} as Record<string, string>));
    if (!shots.after) return;
    if (flowShot) shots.after = flowShot;
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
      verify: { before: shots.before, after: shots.after, same, ...(again.length && { requests: again }), ...(replayed && { flow: replayed }) },
      diagnostics: cons.length || net.length || devSince || serverSince ? { console: cons, network: withBodies(net), devLog: devSince, serverLog: serverSince } : undefined,
    };
    setChat((c) => [...c, { kind: 'status', id: uid(), text: 'Checking the result…' }]);
    startRun(request, shots.after, { verify: true });
  };
  const afterRunRef = useRef(afterRun);
  afterRunRef.current = afterRun;
  const nextMatchRef = useRef<(e: Extract<AgentEvent, { type: 'done' }>) => Promise<void>>(async () => {});

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

  const mockupGap = async (m: { image: string; x: number; y: number }) => {
    const b = browser.current;
    const shot = b && await cleanCapture();
    if (!b || !shot) return null;
    try {
      const fitted = await fitMockup(m.image, shot, { x: m.x, y: m.y }, b.size().width);
      const d = await diffOverlay(fitted, shot);
      return { shot, fitted, diff: d.url, pct: d.pct };
    } catch { return null; }
  };
  const matchRequest = (gap: NonNullable<Awaited<ReturnType<typeof mockupGap>>>, round: number, was: number): AgentRequest => ({
    url: navRef.current.url, title: navRef.current.title, viewport: browser.current!.size(),
    instruction: round === 1
      ? `Make this page match the mockup (reference 1). Reference 2 is the page as it renders now, and reference 3 marks in red where the two differ (${gap.pct.toFixed(1)}% of the page). Match the layout, spacing, sizes, colors and type. Keep the page's real content and components where the mockup only has placeholder copy or images, and use the project's design tokens. When you finish, Pinpoint compares the page with the mockup again and sends you what still differs.`
      : `The page was compared with the mockup again after your last change: ${gap.pct.toFixed(1)}% of it still differs (it was ${was.toFixed(1)}%). Reference 3 shows where, in red. Fix the largest remaining differences in layout, spacing, size and color. Leave differences that are only font rendering, real content in place of placeholder content, or images.`,
    annotations: [
      { n: 1, kind: 'reference', note: 'The mockup to match, scaled to the width of the page.', image: gap.fitted, name: 'mockup' },
      { n: 2, kind: 'reference', note: 'The page as it renders now.', image: gap.shot, name: 'page now' },
      { n: 3, kind: 'reference', note: 'Where the page and the mockup differ: differing pixels are red, the rest is greyed out.', image: gap.diff, name: 'differences' },
    ],
    route: currentRoute ? { path: currentRoute.route, file: currentRoute.file, framework: currentRoute.framework } : undefined,
  });
  const matchMockup = async () => {
    if (!overlay || !settings || runRef.current || job || busy) return;
    if (siteRef.current.kind === 'live' || siteRef.current.kind === 'built') { flash('Matching a mockup needs the local dev server, so Pinpoint can see each change. Open the page locally first.'); return; }
    if (!settings.projectDir) { flash('Pick the project folder the agent should edit.'); return; }
    setBusy('Comparing the page with the mockup…');
    try {
      const gap = await mockupGap(overlay);
      if (!gap) { flash("Couldn't compare the page with the mockup."); return; }
      if (gap.pct <= MATCH_GOAL) { flash(`The page already matches the mockup closely (${gap.pct.toFixed(1)}% differs).`); return; }
      matchRef.current = { image: overlay.image, x: overlay.x, y: overlay.y, round: 1, last: gap.pct };
      if (!chatId) { setChatId(uid()); setChatCreated(Date.now()); }
      const thumb = await thumbnail(gap.fitted);
      setChat((c) => [...c, { kind: 'user', id: uid(), text: `Match the mockup (${gap.pct.toFixed(1)}% of the page differs now)`, annotations: [{ id: uid(), n: 1, kind: 'reference', note: '', color: colorFor(1), image: thumb, name: overlay.name }], agent: settings.agent }]);
      setOverlay(null);
      await startRun(matchRequest(gap, 1, gap.pct), gap.shot, { match: 1 });
    } finally { setBusy(null); }
  };
  const nextMatch = async (e: Extract<AgentEvent, { type: 'done' }>) => {
    const m = matchRef.current;
    if (!m) return;
    const stop = (text: string) => { matchRef.current = null; setChat((c) => [...c, { kind: 'status', id: uid(), text }]); };
    if (!e.ok) { matchRef.current = null; return; }
    if (runRef.current || queuedRef.current.length || verifyPending.current !== e.runId) { matchRef.current = null; return; }
    const gap = await mockupGap(m);
    if (!gap || matchRef.current !== m) { matchRef.current = null; return; }
    const now = `${gap.pct.toFixed(1)}% of the page differs from the mockup (it was ${m.last.toFixed(1)}%)`;
    if (gap.pct <= MATCH_GOAL) return stop(`Matched after ${m.round} round${m.round > 1 ? 's' : ''}: ${now}. What is left is mostly font rendering and content.`);
    if (m.round >= MATCH_ROUNDS) return stop(`Stopped after ${m.round} rounds: ${now}. Lay the mockup over the page to see what is left, or point at it and ask.`);
    if (m.last - gap.pct < 0.3) return stop(`Stopped: it is no longer getting closer. ${now[0].toUpperCase()}${now.slice(1)}.`);
    setChat((c) => [...c, { kind: 'status', id: uid(), text: `Round ${m.round} done: ${now}. Sending what still differs…` }]);
    const was = m.last;
    m.round++;
    m.last = gap.pct;
    startRun(matchRequest(gap, m.round, was), gap.shot, { match: m.round });
  };

  nextMatchRef.current = nextMatch;

  const openVariantsLive = (itemId: string) => {
    const why = bgBlocked ? bgBlocked.replace(/^Background runs/, 'Live variants')
      : siteRef.current.kind !== 'dev' ? 'Live variants need the page to be on your local dev server.'
        : !settingsRef.current?.devCommand ? 'Start the dev server from Pinpoint once (the terminal button), so it knows the command to preview each variant with.' : null;
    if (why) { flash(why); return; }
    setLiveVariants(itemId);
  };
  const liveItem = liveVariants ? chat.find((c) => c.id === liveVariants && c.kind === 'variants') as Extract<ChatItem, { kind: 'variants' }> | undefined : undefined;
  const livePage = (() => { try { const u = new URL(nav.url); return u.pathname + u.search; } catch { return '/'; } })();

  const sweepPlan = () => {
    const origin = originOf(nav.url);
    if (!origin) return { pages: [], crawl: false };
    let here = '/';
    try { const u = new URL(nav.url); here = u.pathname + u.search; } catch {  }
    const fixed = routes.filter((r) => !r.dynamic && r.route !== currentRoute?.route);
    return {
      pages: [{ route: currentRoute?.route || here, url: nav.url }, ...fixed.slice(0, 11).map((r) => ({ route: r.route, url: origin + r.route }))],
      crawl: !fixed.length,
    };
  };
  const sweepOpenPage = (url: string, width: number) => {
    setSweepOpen(false);
    setMulti(false);
    setDevice(width ? { on: true, w: width, h: width < 600 ? 844 : 1180, zoom: 'fit', touch: device.touch } : DEVICE_OFF);
    go(url);
  };
  const sweepFix = async (pages: SweepPage[]) => {
    setSweepOpen(false);
    setInstruction(sweepInstruction(pages, (p) => routes.find((r) => r.route === p.route)?.file));
    const worst = worstShots(pages);
    const shots = await api.runShots('sweep', worst.map((w) => `${w.page.key}-${w.shot.size}`)).catch(() => ({} as Record<string, string>));
    let n = nextN();
    const added: Annotation[] = [];
    for (const w of worst) {
      const image = shots[`${w.page.key}-${w.shot.size}`];
      if (!image) continue;
      added.push({ id: uid(), n, kind: 'reference', color: colorFor(n), image, name: `${w.page.route} · ${w.shot.label}`, note: `${w.page.route} as it renders now at ${w.shot.width}px wide. ${w.shot.issues.slice(0, 2).map((i) => i.text).join('. ')}` });
      n++;
    }
    if (added.length) setAnnotations((prev) => [...prev, ...added]);
    if (settingsRef.current?.panelHidden) saveSettings({ panelHidden: false });
    setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 50);
  };

  useEffect(() => {
    api.reviewState().then((s) => { setReviewing(s.running); setReviewComments(s.comments); }).catch(() => {});
    return api.onReviewComment((c) => {
      setReviewComments((list) => [...list, c]);
      flashRef.current(`${c.name || 'Someone'} left a comment on ${c.path}`);
    });
  }, []);
  const addReviewComments = (list: ReviewComment[]) => {
    const base = originOf(navRef.current.url);
    let n = nextN();
    const added: Annotation[] = list.map((c) => {
      const note = `${c.text}${c.name ? ` (comment from ${c.name})` : ' (review comment)'}`;
      const pageUrl = base ? base + c.path : undefined;
      const ann: Annotation = c.selector
        ? {
          id: uid(), n, kind: 'element', color: colorFor(n), note, pageUrl, viewport: c.viewport.width ? c.viewport : undefined,
          element: { uid: '', selector: c.selector, tag: c.tag || 'div', classes: c.classes, text: c.elText || '', html: c.html, rect: c.rect || { x: 0, y: 0, width: 0, height: 0 } },
        }
        : { id: uid(), n, kind: 'note', color: colorFor(n), note, pageUrl, viewport: c.viewport.width ? c.viewport : undefined };
      n++;
      return ann;
    });
    setAnnotations((prev) => [...prev, ...added]);
    const ids = new Set(list.map((c) => c.id));
    setReviewComments((cs) => cs.filter((c) => !ids.has(c.id)));
    setReviewOpen(false);
    if (settingsRef.current?.panelHidden) saveSettings({ panelHidden: false });
    setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 50);
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
    const shots: { runId: string; label: string }[] = [];
    let asked = '';
    for (const it of chat) {
      if (it.kind === 'user') asked = (it.text || it.annotations.map((a) => a.note).find(Boolean) || '').split('\n')[0].slice(0, 80);
      if (it.kind === 'done' && it.shots && !it.undone && !it.variant && it.visual !== 'none') shots.push({ runId: it.runId, label: asked });
      if (it.kind === 'user') {
        const asks = [it.text, ...it.annotations.map((a) => a.note)].filter((t) => t && t.trim());
        if (asks.length) lines.push(`- **Asked:** ${asks.map((t) => t.trim().split('\n')[0]).join('; ')}`);
      } else if (it.kind === 'done' && it.changes.length && !it.undone) {
        const files = it.changes.filter((c) => !c.reverted).map((c) => `\`${c.path}\``).join(', ');
        if (files) lines.push(`  - Changed ${files}${it.commit ? ` (${it.commit.hash})` : ''}`);
      }
    }
    lines.push('', '---', 'Made with [Pinpoint](https://github.com/m-ahmed-elbeskeri/pinpoint).');
    return { title, body: lines.join('\n'), shots };
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
    setTimeout(() => document.querySelector<HTMLTextAreaElement>(`[data-note="${ann.id}"]`)?.focus({ preventScroll: true }), 50);
  };
  const replayRequest = async (r: NetRequest) => {
    const res = await browser.current?.sendRequest({ method: r.method, url: r.url, body: r.reqBody });
    flash(!res ? 'The page could not send it.' : res.error && !res.status ? `${r.method} ${pathOf(r.url)} failed: ${res.error}` : `${r.method} ${pathOf(r.url)} answered ${res.status} in ${res.ms} ms`);
  };
  const buildMock = (m: Mock) => {
    setInstruction(`Build the endpoint ${m.method === 'ANY' ? 'GET' : m.method} ${m.path} in this project's backend. It should answer with status ${m.status} and a body shaped like this (the page is being developed against it as a mock):\n\n${m.body}\n\nFollow how the existing endpoints are written and registered, use real data where the project has it, and tell me when I can switch the mock off.`);
    if (settingsRef.current?.panelHidden) saveSettings({ panelHidden: false });
    setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 50);
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
    if (job || !chatRef.current.length) return;
    if (!leaveChat()) return;
    setChat([]); setSession(null); setChatId(null); setDesignAtStart(null); setUsage(null);
    restoreAnnotations(null);
    syncOthers();
    setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 30);
  };
  const newChatRef = useRef(newChat);
  newChatRef.current = newChat;
  useEffect(() => {
    if (paletteOpen && projectDir) api.listChats().then(setPaletteChats).catch(() => setPaletteChats([]));
  }, [paletteOpen, projectDir]);
  // What the side chat gets to know about the main conversation: the last few requests and replies.
  const sideContext = () => {
    const page = navRef.current.url ? `Page open in the browser: ${navRef.current.url}\n` : '';
    return (page + conversationText(chatRef.current.slice(-24), 4000)).slice(-4000);
  };
  // A new chat with everything before this message; the message waits in the composer to be changed.
  const forkFrom = async (itemId: string) => {
    if (job) { flash('Wait for the variants to finish before forking.'); return; }
    const all = mergeDeltas(chatRef.current, deltaBuf.current);
    const at = all.findIndex((it) => it.id === itemId);
    const msg = all[at];
    if (msg?.kind !== 'user' || !leaveChat()) return;
    const items = healChat(all.slice(0, at));
    const now = Date.now();
    const id = items.length ? uid() : null;
    const gitBranch = chatId ? branchOf.current.get(chatId) : undefined;
    if (id) {
      if (gitBranch) branchOf.current.set(id, gitBranch);
      await api.saveChat({ id, branch: gitBranch, title: chatTitle(items), createdAt: now, updatedAt: now, agent: settingsRef.current?.agent || 'claude', session: null, designAtStart: null, items });
      showChat({ id, createdAt: now, items, session: null, designAtStart: null }, null);
    } else {
      setChat([]); setSession(null); setChatId(null); setDesignAtStart(null); setUsage(null);
      setRunId(null); runRef.current = null;
      restoreAnnotations(null);
    }
    syncOthers();
    setInstruction(msg.text);
    setActiveSide(null);
    flash('Forked. The original chat is still in the sidebar.');
    setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 30);
  };
  const receiveChat = async () => {
    try {
      const id = await api.receiveChat();
      if (id) { await openChat(id); flash('Chat received. The agent gets the conversation with your next message.'); }
    } catch (e) { flash(errText(e)); }
  };
  const onChatMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() || '';
    if (!text || !sel?.rangeCount) { setAskAside(null); return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    setAskAside({ text: text.slice(0, 1500), x: Math.round(r.left + r.width / 2), y: Math.round(r.top) });
  };
  const newSide = (seed?: string) => {
    if (!settingsRef.current?.projectDir) return;
    const id = `side-${uid()}`;
    setSides((list) => [...list, { id, title: 'Side chat', seed: seed ?? null, running: false }]);
    setActiveSide(id);
    if (settingsRef.current?.panelHidden) saveSettings({ panelHidden: false });
  };
  const newSideRef = useRef(newSide);
  // Fade the tab strip's edges only where more tabs are hidden.
  const tabsStrip = useRef<HTMLDivElement>(null);
  const fadeTabs = () => {
    const el = tabsStrip.current;
    if (!el) return;
    el.classList.toggle('fade-l', el.scrollLeft > 2);
    el.classList.toggle('fade-r', el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };
  useEffect(() => {
    const el = tabsStrip.current;
    if (!el) return;
    fadeTabs();
    const ro = new ResizeObserver(fadeTabs);
    ro.observe(el);
    return () => ro.disconnect();
  });
  useEffect(() => { tabsStrip.current?.querySelector('.ptab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [activeSide, sides.length]);
  newSideRef.current = newSide;
  const patchSide = (id: string, p: Partial<(typeof sides)[number]>) => setSides((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const closeSide = (id: string) => {
    api.sideCancel(id).catch(() => {});
    setSides((list) => list.filter((x) => x.id !== id));
    if (activeSide === id) setActiveSide(null);
  };
  // Selected text in the chat: start a side chat about it, or quote it into a reply.
  const fromSelection = (how: 'side' | 'reply') => {
    const text = askAside?.text || '';
    setAskAside(null);
    window.getSelection()?.removeAllRanges();
    if (!text) return;
    if (how === 'side') { newSide(text); return; }
    const quote = text.split('\n').map((l) => `> ${l}`).join('\n');
    setInstruction((v) => `${v ? v.trimEnd() + '\n\n' : ''}${quote}\n\n`);
    setActiveSide(null);
    setTimeout(() => { const c = composerRef.current; if (c) { c.focus({ preventScroll: true }); c.selectionStart = c.selectionEnd = c.value.length; } }, 30);
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
    setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 50);
  };
  const flowFix = (id: string) => {
    const item = chatRef.current.find((c) => c.kind === 'done' && c.runId === id) as Extract<ChatItem, { kind: 'done' }> | undefined;
    const f = item?.flow;
    if (!f) return;
    const found = [
      f.done < f.total ? `- It stopped at step ${f.done + 1} of ${f.total}: the element that step clicks or types into was not on the page.` : `- All ${f.total} steps ran.`,
      ...f.errors.map((x) => `- Console error: ${x}`),
      ...f.failed.map((x) => `- Failed request: ${x}`),
    ];
    setInstruction(`I replayed the steps I recorded after your change and it still isn't right:\n${found.join('\n')}\n\nFind why and fix it.`);
    setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 50);
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
    setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 50);
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
    if (e.type === 'done' && e.cost) addSpend(e.cost);
    if (e.type === 'done') { setChat(expireApprovals); notify(`${e.ok ? 'Finished' : 'Stopped'}: ${chatTitle(chatRef.current)}`); }
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
      case 'git': if (chatIdRef.current) branchOf.current.set(chatIdRef.current, e.branch); refreshGitRef.current(); break;
      case 'text': {
        const m = splitMemory(e.text);
        finalizeBlock('text', m.text, m.extra);
        break;
      }
      case 'thinking': finalizeBlock('thinking', e.text); break;
      case 'tool': push({ kind: 'tool', id: uid(), toolId: e.id, name: e.name, detail: e.detail, status: 'running', edits: e.edits, at: Date.now(), parent: e.parent }); break;
      case 'plan': setChat((c) => applyPlan(c, e.steps)); break;
      case 'usage': setUsage({ used: e.used, window: e.window }); break;
      case 'limits': setLimits(e.status === 'ok' ? null : e); break;
      case 'mcp': setMcp(e.servers); break;
      case 'approval':
        push({ kind: 'approval', id: uid(), runId: e.runId, approvalId: e.approvalId, tool: e.tool, detail: e.detail, status: 'pending' });
        notify(`Waiting for your OK: ${e.tool}`);
        break;
      case 'tool_result':
        setChat((c) => c.map((it) => (it.kind === 'tool' && it.toolId === e.id ? { ...it, status: e.ok ? 'ok' : 'error', output: e.text || it.output, ms: it.at ? Date.now() - it.at : undefined } : it)));
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
            ...(runMetaRef.current[e.runId]?.site && e.changes?.length && { unseen: runMetaRef.current[e.runId].site }),
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

  // Undo every run that came after a message, newest first.
  const rewindTo = async (itemId: string) => {
    if (runRef.current || job) { flash('Wait for the agent to finish before rewinding.'); return; }
    const at = chatRef.current.findIndex((it) => it.id === itemId);
    const runs = chatRef.current.slice(at).filter((it): it is Extract<ChatItem, { kind: 'done' }> => it.kind === 'done' && !it.undone && it.changes.length > 0).reverse();
    if (!runs.length) { flash('Nothing to rewind: no files were changed after this message.'); return; }
    for (const r of runs) await undoRun(r.id, r.runId);
    flash(`Rewound ${runs.length} run${runs.length > 1 ? 's' : ''}.`);
  };
  const approve = (id: string, decision: ApprovalDecision) => {
    const item = chatRef.current.find((it) => it.id === id);
    if (item?.kind !== 'approval' || item.status !== 'pending') return;
    api.approve(item.runId, item.approvalId, decision).catch(() => {});
    setChat((c) => c.map((it) => (it.id === id && it.kind === 'approval' ? { ...it, status: decision } : it)));
  };
  const chatHandlers = {
    onApprove: approve,
    onRewind: (itemId: string) => rewindTo(itemId),
    onFork: (itemId: string) => { forkFrom(itemId); },
    onEditMessage: (text: string) => {
      setInstruction(text);
      setActiveSide(null);
      setTimeout(() => { const c = composerRef.current; if (c) { c.focus({ preventScroll: true }); c.selectionStart = c.selectionEnd = c.value.length; } }, 30);
    },
    onSendText: (text: string) => sendText(text),
    onSaveSnippet: (text: string) => saveSnippet(text),
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
    onFlowFix: flowFix,
    onVariantsLive: openVariantsLive,
    onOpenLocal: () => { if (siteRef.current.localTwin) go(siteRef.current.localTwin); else quickStartDev(); },
  };
  const chatActions = useStableActions<ChatActions>(chatHandlers);

  useEffect(() => api.onDevEvent((e) => {
    if (e.type === 'log') addLog('dev', e.text);
    else if (e.type === 'started') { setDevRunning(true); setDevLog(''); }
    else if (e.type === 'exit') { setDevRunning(false); setDevLog((l) => l + `\n[process exited with code ${e.code}]\n`); }
    else if (e.type === 'url') {
      const started = originOf(e.url);
      if (started) setTwins((t) => ({ ...t, local: started }));
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

  const pickProject = async (known?: string) => {
    const prev = settings?.projectDir;
    if (known && known === prev) return;
    if (known && !leaveChat()) return;
    const dir = await api.pickFolder(known);
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

  // Another worktree of the same repository: keeps the dev command and tabs, the dev server restarts there.
  const openWorktree = async (dir: string) => {
    if (dir === settings?.projectDir) return false;
    if (!leaveChat()) return false;
    const r = await api.gitOpenWorktree(dir);
    setSettings(await api.getSettings()); setSession(null);
    setAnnotations([]);
    setDevLog('');
    refreshGit();
    flash(`Worktree: ${r.branch || r.dir}${r.restarted ? ' · dev server restarting there' : ''}`);
    return true;
  };

  const startResize = (which: 'panel') => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setResizing(which);
    dragging.current = true;
    const grid = (e.currentTarget as HTMLElement).closest('.app') as HTMLElement | null;
    const left = settingsRef.current?.panelSide === 'left';
    const tw = settingsRef.current?.threadsHidden ? 0 : THREADS_W;
    let last = 0, frame = 0;
    const paint = () => {
      frame = 0;
      if (!grid || !last) return;
      if (which === 'panel') grid.style.gridTemplateColumns = left ? `${tw}px ${last}px 1fr` : `${tw}px 1fr ${last}px`;
    };
    const move = (ev: PointerEvent) => {
      if (which === 'panel') {
        const w = left ? ev.clientX - tw : window.innerWidth - ev.clientX;
        last = Math.round(Math.min(Math.max(300, w), Math.min(820, window.innerWidth - tw - 480)));
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
      if (last) setPanelWidth(last);
      const a = area.current;
      if (a) setAvail({ w: Math.floor(a.clientWidth), h: Math.floor(a.clientHeight) });
      setResizing(null);
      if (last) saveSettings({ panelWidth: last });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const addScribble = (points: [number, number][]) => {
    if (points.length < 2) return;
    page.set([...page.shapes, { id: uid(), tool: 'pen', color, size, points }]);
    if (!page.shapes.length) flash(`Mark added. It goes with your next message (press D for arrows, boxes and text).`);
  };
  const openTool = (t: DrawerTab) => { setPlusOpen(false); setDrawerTab(t); setDrawerOpen(true); };
  const togglePanel = () => saveSettings({ panelHidden: !settingsRef.current?.panelHidden });
  const zenRef = useRef(zen);
  zenRef.current = zen;
  const toggleThreads = () => { if (zenRef.current) setZen(false); else saveSettings({ threadsHidden: !settingsRef.current?.threadsHidden }); };
  const toggleZen = () => { if (!zenRef.current) setDrawerOpen(false); setZen(!zenRef.current); };
  const saveLayout = (name: string) => {
    const s = settingsRef.current;
    if (!s) return;
    const l: SavedLayout = { name, threadsHidden: !!s.threadsHidden, panelHidden: !!s.panelHidden, panelSide: s.panelSide === 'left' ? 'left' : 'right', panelWidth: panelWidth ?? s.panelWidth ?? 400, statusBar: !!s.statusBar, split: !!s.split };
    saveSettings({ layouts: [...(s.layouts || []).filter((x) => x.name !== name), l] });
    flash(`Layout saved: ${name}`);
  };
  const applyLayout = ({ name, ...l }: SavedLayout) => {
    setZen(false);
    setPanelWidth(l.panelWidth);
    saveSettings(l);
    flash(`Layout: ${name}`);
  };
  const mention = (path: string) => {
    setInstruction((t) => `${t}${t && !/\s$/.test(t) ? ' ' : ''}@${path} `);
    if (settingsRef.current?.panelHidden) saveSettings({ panelHidden: false });
    setActiveSide(null);
    setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 30);
  };

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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { if (e.shiftKey) toggleThreads(); else togglePanel(); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') { setSettingsOpen(true); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === '.') { toggleZen(); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') { openTool('files'); e.preventDefault(); return; }
      if (!typing && !e.ctrlKey && !e.metaKey && e.key === '?') { setShortcutsOpen((o) => !o); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'k') { setPaletteOpen((o) => !o); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'j') { setDrawerOpen((o) => !o); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') { newChatRef.current(); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') { newSideRef.current(); e.preventDefault(); return; }
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
    if (a.kind === 'element' && a.element?.uid) (a.tabId ? handles.current[a.tabId] : browser.current)?.send('scrollTo', a.element.uid);
    else if (a.kind === 'element' && a.element && (!a.pageUrl || a.pageUrl === navRef.current.url)) browser.current?.reveal(a.element.selector);
  };

  const agentReady = settings && agents ? agents[settings.agent]?.ok : true;
  const agentName = harnesses.find((h) => h.id === settings?.agent)?.name || (settings?.agent === 'codex' ? 'Codex' : 'Claude Code');
  const deviceScale = !device.on || !avail.w ? 1
    : device.zoom === 'fit' ? Math.min(1, avail.w / device.w, device.h ? avail.h / device.h : 1) : device.zoom;
  const deviceH = device.h || avail.h / deviceScale;
  const drawShapes = mode === 'sketch' ? sketch : page;
  const pendingMarks = page.shapes.length + sketch.shapes.length;
  const canSend = !busy && !!(instruction.trim() || pastes.length || annotations.length || pendingMarks);
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

  const planMode = settings?.agent === 'codex' ? settings.codexSandbox === 'read-only' : settings?.agent === 'claude' ? settings.claudePermission === 'plan' : false;
  const setPlanMode = (on: boolean) => saveSettings(settingsRef.current?.agent === 'codex' ? { codexSandbox: on ? 'read-only' : 'workspace-write' } : { claudePermission: on ? 'plan' : 'acceptEdits' });
  const slashCommands: SlashCommand[] = [
    { name: 'new', hint: 'Start a new chat', icon: SquarePen, run: newChat },
    { name: 'timeline', hint: 'The page after each run in this chat', icon: History, run: () => setTimelineOpen(true) },
    { name: 'side', hint: 'Ask something in a side chat', icon: MessageSquare, run: (rest) => newSide(rest || undefined) },
    { name: 'annotate', hint: 'Click or draw on the page (S)', icon: MousePointerClick, run: () => setMode('select') },
    { name: 'draw', hint: 'Arrows, boxes and text on the page (D)', icon: PenTool, run: () => setMode('draw') },
    { name: 'sketch', hint: 'Sketch on a blank board (K)', icon: SquarePen, run: () => setMode('sketch') },
    { name: 'browse', hint: 'Use the page normally (V)', icon: MousePointer2, run: () => setMode('browse') },
    ...(settings?.agent === 'claude' || settings?.agent === 'codex' ? [
      { name: 'plan', hint: planMode ? 'Plan only is on' : 'Plan only: the agent proposes, changes nothing', icon: Brain, run: () => { setPlanMode(true); flash('Plan only: the agent will propose changes without making them. /edit to switch back.'); } },
      { name: 'edit', hint: planMode ? 'Let the agent edit files again' : 'Edit files is on', icon: PenTool, run: () => { setPlanMode(false); flash('The agent can edit files again.'); } },
    ] : []),
    { name: 'terminal', hint: 'Show the terminal (Ctrl+J)', icon: TerminalSquare, run: () => setDrawerOpen(true) },
    { name: 'files', hint: 'Browse and read the project', icon: FileTree, run: () => openTool('files') },
    { name: 'pr', hint: 'Open a pull request from this chat', icon: GitPullRequestArrow, run: () => setBranchCompare({ pr: true }) },
    { name: 'zen', hint: 'Just the page and the chat', icon: Maximize, run: toggleZen },
    { name: 'theme', hint: 'Switch light / dark', icon: Palette, run: () => saveSettings({ theme: document.documentElement.dataset.theme === 'light' ? 'dark' : 'light' }) },
    { name: 'settings', hint: 'Open settings', icon: SettingsIcon, run: () => setSettingsOpen(true) },
    { name: 'save', hint: 'Save the text after /save as a snippet', icon: Pin, run: (rest) => saveSnippet(rest) },
    ...(settings?.snippets || []).map((sn) => ({ name: sn.name, hint: sn.text.slice(0, 80), icon: Pin, run: () => { setInstruction(sn.text); setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 0); } })),
  ];
  const saveSnippet = (text: string) => {
    const t = text.trim();
    if (!t) { flash('Type the text after /save, e.g. /save make it responsive'); return; }
    const list = settingsRef.current?.snippets || [];
    let name = snippetName(t);
    for (let i = 2; list.some((x) => x.name === name); i++) name = `${snippetName(t)}-${i}`;
    saveSettings({ snippets: [...list, { name, text: t }] });
    flash(`Saved as /${name}`);
  };
  const assist = useComposerAssist(composerRef, instruction, setInstruction, slashCommands);

  const waitingCount = others.filter((o) => o.needsInput || !o.running).length + (needsInput(chat) ? 1 : 0);
  useEffect(() => { api.badge(waitingCount).catch(() => {}); }, [waitingCount]);
  const trayChats = [
    ...(chatId && chat.length && (runId || needsInput(chat)) ? [{ id: chatId, title: chatTitle(chat), state: needsInput(chat) ? 'needs you' : 'working' }] : []),
    ...others.map((o) => ({ id: o.id, title: o.title, state: o.needsInput ? 'needs you' : o.running ? 'working' : 'done' })),
  ];
  const trayKey = JSON.stringify(trayChats) + settings?.tray;
  useEffect(() => {
    if (!settings) return;
    api.tray({ working: trayChats.filter((c) => c.state === 'working').length, waiting: trayChats.filter((c) => c.state === 'needs you').length, chats: trayChats }).catch(() => {});
  }, [trayKey]);
  const openChatRef = useRef<(id: string) => void>(() => {});
  useEffect(() => api.onTrayChat((id) => openChatRef.current(id)), []);
  useEffect(() => { if (sheet === 'memory' && projectDir) api.readMemory().then(setMemory).catch(() => {}); }, [sheet, projectDir]);

  useEffect(() => {
    if (!projectDir) { setPulls({}); return; }
    const get = () => api.gitPulls().then(setPulls).catch(() => {});
    get();
    const t = setInterval(get, 60000);
    window.addEventListener('focus', get);
    return () => { clearInterval(t); window.removeEventListener('focus', get); };
  }, [projectDir, gitStatus?.branch]);
  useEffect(() => { markBelow(); });
  openChatRef.current = openChat;

  const commands: Command[] = !settings ? [] : [
    { id: 'chat:timeline', group: 'Chat', label: 'Timeline of this chat', hint: 'the page after each run', icon: History, disabled: !chat.some((it) => it.kind === 'done' && it.shots), run: () => setTimelineOpen(true) },
    { id: 'chat:aside', group: 'Chat', label: 'New side chat', hint: 'ask without touching this chat', icon: MessageSquare, keys: combo('A', true), disabled: !projectDir, run: () => newSide() },
    ...sides.map((x) => ({ id: `chat:${x.id}`, group: 'Chat', label: x.title, hint: 'side chat', icon: MessageSquare, run: () => setActiveSide(x.id) })),
    { id: 'chat:new', group: 'Chat', label: 'New chat', icon: SquarePen, keys: combo('O', true), disabled: !!job || !chat.length, run: newChat },
    { id: 'chat:pr', group: 'Chat', label: 'Open a pull request from this chat', hint: 'description and screenshots', icon: GitPullRequestArrow, disabled: !gitStatus?.repo || !chat.length, run: () => setBranchCompare({ pr: true }) },
    { id: 'chat:share', group: 'Chat', label: 'Hand this chat to a teammate…', hint: 'saves a file they can open', icon: Users, disabled: !chatId, run: () => { if (chatId) api.shareChat(chatId).then((f) => { if (f) flash(`Saved ${f}. Push your branch so they can pick up the code too.`); }).catch((e) => flash(errText(e))); } },
    { id: 'chat:receive', group: 'Chat', label: 'Open a chat from a teammate…', icon: Users, disabled: !projectDir || !!job, run: receiveChat },
    { id: 'view:files', group: 'View', label: 'Files', hint: 'tree and code viewer', icon: FileTree, keys: combo('E', true), disabled: !projectDir, run: () => openTool('files') },
    { id: 'view:zen', group: 'View', label: zen ? 'Leave zen mode' : 'Zen mode', hint: 'just the page and the chat', icon: Maximize, keys: `${MOD} .`, run: toggleZen },
    { id: 'view:split', group: 'View', label: settings.split ? 'Show tools over the page' : 'Show tools beside the page', icon: Columns2, run: () => saveSettings({ split: !settings.split }) },
    { id: 'view:layouts', group: 'View', label: 'Save or delete layouts…', icon: LayoutGrid, run: () => setLayoutsOpen(true) },
    ...(settings.layouts || []).map((l) => ({ id: `layout:${l.name}`, group: 'View', label: `Layout: ${l.name}`, icon: LayoutGrid, run: () => applyLayout(l) })),
    ...paletteHits.filter((h) => h.id !== chatId).map((h) => ({ id: `hit:${h.id}`, group: 'In chats', label: h.title || 'Untitled', hint: h.snippet, icon: Search, disabled: !!job, run: () => openChat(h.id) })),
    ...paletteChats.filter((c) => c.id !== chatId).map((c) => ({ id: `chat:${c.id}`, group: 'Chat', label: c.title || 'Untitled', hint: others.find((o) => o.id === c.id)?.running ? 'working' : 'open chat', icon: MessageSquare, disabled: !!job, run: () => openChat(c.id) })),
    { id: 'view:threads', group: 'View', label: settings.threadsHidden ? 'Show chats sidebar' : 'Hide chats sidebar', icon: PanelLeft, keys: combo('B', true), run: toggleThreads },
    { id: 'view:panel', group: 'View', label: settings.panelHidden ? 'Show agent panel' : 'Hide agent panel', icon: PanelLeft, keys: combo('B'), run: togglePanel },
    { id: 'view:term', group: 'View', label: drawerOpen ? 'Hide terminal and logs' : 'Show terminal and logs', icon: TerminalSquare, keys: combo('J'), run: () => setDrawerOpen(!drawerOpen) },
    { id: 'mode:browse', group: 'Mode', label: 'Browse the page', icon: MousePointer2, keys: 'V', run: () => setMode('browse') },
    { id: 'mode:select', group: 'Mode', label: 'Annotate: click an element or drag to draw', icon: MousePointerClick, keys: 'S', run: () => setMode('select') },
    { id: 'mode:draw', group: 'Mode', label: 'Draw on the page', icon: PenTool, keys: 'D', run: () => setMode('draw') },
    { id: 'mode:sketch', group: 'Mode', label: 'Sketch on a blank board', icon: SquarePen, keys: 'K', run: () => setMode('sketch') },
    { id: 'mode:rec', group: 'Mode', label: rec ? 'Stop recording' : 'Record an interaction', icon: CircleDot, disabled: !/^(https?|file):/.test(nav.url), run: toggleRecording },
    { id: 'page:tab', group: 'Page', label: 'New tab', icon: Plus, keys: combo('T'), run: () => newTab() },
    { id: 'page:reload', group: 'Page', label: 'Reload page', icon: RotateCw, run: () => browser.current?.reload() },
    ...QUICK_SIZES.map((q) => ({ id: `page:size:${q.w}`, group: 'Page', label: q.w ? `Preview at ${q.label.split(' (')[0]}` : 'Preview at full window size', icon: q.icon, run: () => { setMulti(false); setDevice(q.w ? { on: true, w: q.w, h: q.h, zoom: device.zoom, touch: device.touch } : DEVICE_OFF); } })),
    { id: 'page:multi', group: 'Page', label: 'Phone, tablet and desktop side by side', icon: Columns3, disabled: !/^(https?|file):/.test(nav.url), run: () => setMulti(true) },
    { id: 'page:freeze', group: 'Page', label: frozen ? 'Unfreeze the page' : 'Freeze the page', icon: Snowflake, keys: 'F', run: () => setFrozen(!frozen) },
    { id: 'page:sweep', group: 'Page', label: 'Check every page for problems', icon: ShieldCheck, disabled: !projectDir || !/^https?:/.test(nav.url), run: () => setSweepOpen(true) },
    { id: 'page:engines', group: 'Page', label: 'See this page in WebKit and Firefox', icon: AppWindow, disabled: !/^https?:/.test(nav.url), run: () => setEnginesOpen(true) },
    { id: 'page:components', group: 'Page', label: 'Components workspace', icon: Boxes, disabled: !projectDir || !/^https?:/.test(nav.url), run: () => setWsOpen(true) },
    { id: 'page:devtools', group: 'Page', label: 'Page DevTools', icon: Bug, run: () => browser.current?.devtools() },
    ...harnesses.map((h) => ({ id: `agent:${h.id}`, group: 'Agent', label: `Use ${h.name}`, hint: agents && !agents[h.id]?.ok ? 'not installed' : agents?.[h.id]?.version, icon: Zap, disabled: settings.agent === h.id || !!runId, run: () => saveSettings({ agent: h.id }) })),
    { id: 'git:changes', group: 'Project', label: 'Branch changes and PR preview', hint: 'compare with any base branch', icon: GitCompareArrows, disabled: !gitStatus?.repo, run: () => setBranchCompare({}) },
    { id: 'proj:design', group: 'Project', label: 'Design rules', icon: Palette, disabled: !projectDir, run: () => setSheet('design') },
    { id: 'proj:memory', group: 'Project', label: 'Project memory', icon: Brain, disabled: !projectDir, run: () => setSheet('memory') },
    { id: 'proj:open', group: 'Project', label: 'Open project folder…', icon: FolderOpen, run: () => pickProject() },
    ...(settings.recentProjects || []).filter((d) => d !== projectDir).map((d) => ({ id: `proj:${d}`, group: 'Project', label: `Switch to ${d.split(/[\\/]/).pop()}`, hint: d, icon: FolderOpen, disabled: !!job, run: () => pickProject(d) })),
    ...(settings.recentProjects || []).filter((d) => d !== projectDir).map((d) => ({ id: `win:${d}`, group: 'Project', label: `Open ${d.split(/[\\/]/).pop()} in a new window`, hint: d, icon: NewWindow, run: () => { api.openProjectWindow(d).catch((e) => flash(errText(e))); } })),
    ...(['system', 'light', 'dark'] as const).map((t) => ({ id: `app:theme:${t}`, group: 'App', label: `Theme: ${t === 'system' ? 'match the system' : t}`, icon: Palette, disabled: theme === t, run: () => saveSettings({ theme: t }) })),
    { id: 'app:shortcuts', group: 'App', label: 'Keyboard shortcuts', icon: Keyboard, keys: '?', run: () => setShortcutsOpen(true) },
    { id: 'app:statusbar', group: 'View', label: settings.statusBar ? 'Hide status bar' : 'Show status bar', icon: PanelLeft, run: () => saveSettings({ statusBar: !settings.statusBar }) },
    { id: 'app:settings', group: 'App', label: 'Settings', icon: SettingsIcon, run: () => setSettingsOpen(true) },
    { id: 'app:layout', group: 'App', label: 'Copy layout report', icon: ClipboardCopy, keys: combo('L', true), run: () => { navigator.clipboard?.writeText(layoutReport()); flash('Layout report copied.'); } },
  ];

  if (!settings) return <div className="boot"><Loader2 className="spin" /></div>;

  const left = settings.panelSide === 'left';
  const threadsOn = !settings.threadsHidden && !zen;
  const tw = threadsOn ? THREADS_W : 0;
  const pw = settings.panelHidden ? 0 : panelWidth ?? settings.panelWidth ?? 400;
  const row2 = left ? "'threads panel stage'" : "'threads stage panel'";
  const statusOn = settings.statusBar === true && !zen;
  const split = settings.split === true && drawerOpen;
  const recentFiles = [...new Set(chat.flatMap((it) => (it.kind === 'done' && !it.undone ? it.changes.filter((c) => !c.reverted).map((c) => c.path) : [])))];
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: left ? `${tw}px ${pw}px 1fr` : `${tw}px 1fr ${pw}px`,
    gridTemplateRows: `52px 1fr${statusOn ? ' 24px' : ''}`,
    gridTemplateAreas: `'threads top top' ${row2}${statusOn ? " 'threads status status'" : ''}`,
  };
  const chatCost = chat.reduce((sum, it) => sum + (it.kind === 'done' && it.cost ? it.cost : 0), 0);
  const modelName = settings.agent === 'claude' ? settings.claudeModel : settings.agent === 'codex' ? settings.codexModel : settings.agentModels?.[settings.agent];

  return (
    <div className={`app ${resizing ? 'resizing' : ''} ${threadsOn ? 'threads-on' : ''} ${zen ? 'zen' : ''}`} style={gridStyle}>
      {threadsOn && (
        <ThreadSidebar
          mod={MOD} projectDir={projectDir} recentProjects={settings.recentProjects || []}
          chatId={chatId} currentTitle={chat.length ? chatTitle(chat) : ''} currentRunning={!!runId} currentNeedsInput={needsInput(chat)}
          others={others} pulls={pulls} refreshKey={`${chatId}:${chat.length}:${others.map((o) => o.id + o.running).join()}`} disabled={!!job}
          onOpen={openChat} onDelete={deleteChat} onNew={newChat} onPickProject={pickProject}
          onOpenIn={(dir, id) => { wantChat.current = id; pickProject(dir); }}
          onSettings={() => setSettingsOpen(true)} onPalette={() => setPaletteOpen(true)} onHide={toggleThreads}
          onTheme={() => saveSettings({ theme: document.documentElement.dataset.theme === 'light' ? 'dark' : 'light' })} onShortcuts={() => setShortcutsOpen(true)} onTerminal={() => openTool('term')} light={theme === 'light' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches)}
        />
      )}
      <TopBar
        threadsHidden={!threadsOn} onToggleThreads={toggleThreads} onPalette={() => setPaletteOpen(true)}
        chatTools={!threadsOn && projectDir ? (
          <>
            <button className="icon-btn" onClick={newChat} disabled={!!job || !chat.length} title={`New chat (${combo('O', true)})`}><SquarePen size={16} /></button>
            <ChatHistory currentId={chatId} disabled={!!job} others={others} onOpen={openChat} onDelete={deleteChat} />
          </>
        ) : null}
        mod={MOD} projectDir={settings.projectDir} onPickProject={() => pickProject()}
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

      <main className={`stage ${split ? 'split' : ''}`}>
        <div className="tabbar">
          <div className="tabstrip">
            {tabs.map((t) => (
              <div
                key={t.id} className={`tab ${t.id === activeTab && (!drawerOpen || split) ? 'on' : ''}`} title={t.url || 'New tab'}
                onClick={() => { if (!split) setDrawerOpen(false); switchTab(t.id); }}
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } }}
              >
                {t.loading ? <Loader2 size={11} className="spin" /> : <Globe size={11} />}
                <span>{tabLabel(t)}</span>
                {annotations.some((a) => a.tabId === t.id) && <i className="tab-pin" title="Has annotations for the next request" />}
                <button className="tab-x" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} title="Close tab"><X size={11} /></button>
              </div>
            ))}
            {toolTabs.map((t) => {
              const tool = TOOLS.find((x) => x.id === t)!;
              return (
                <div key={t} className={`tab tool-tab ${drawerOpen && drawerTab === t ? 'on' : ''}`} title={tool.label} onClick={() => { setDrawerTab(t); setDrawerOpen(true); }}>
                  <tool.icon size={11} />
                  <span>{tool.label}</span>
                  {t === 'dev' && devRunning && <i className="live-dot" />}
                  {t === 'net' && requests.filter(requestFailed).length > 0 && <i className="tool-count">{requests.filter(requestFailed).length}</i>}
                  <button className="tab-x" onClick={(e) => { e.stopPropagation(); setToolTabs((l) => l.filter((x) => x !== t)); if (drawerTab === t) setDrawerOpen(false); }} title="Close tab"><X size={11} /></button>
                </div>
              );
            })}
            <div
              className="tab-new-wrap"
              onMouseEnter={() => { clearTimeout(plusTimer.current); setPlusOpen(true); }}
              onMouseLeave={() => { plusTimer.current = window.setTimeout(() => setPlusOpen(false), 200); }}
            >
              <button className="tab-new" onClick={() => { setPlusOpen(false); setDrawerOpen(false); newTab('about:blank'); }} title="New tab: choose what to open"><Plus size={13} /></button>
            </div>
          </div>
        </div>
        {plusOpen && (
          <div className="plus-menu" onMouseEnter={() => { clearTimeout(plusTimer.current); setPlusOpen(true); }} onMouseLeave={() => { plusTimer.current = window.setTimeout(() => setPlusOpen(false), 200); }} style={{ left: plusLeft }}>
            <button onClick={() => { setPlusOpen(false); setDrawerOpen(false); newTab(); }}><Globe size={14} /><span>New page</span><kbd>{combo('T')}</kbd></button>
            {TOOLS.map((t) => <button key={t.id} onClick={() => openTool(t.id)}><t.icon size={14} /><span>{t.label}</span></button>)}
          </div>
        )}
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
            {projectDir && !loadError && (
              <SiteChip
                kind={kind} host={siteOrigin.replace(/^https?:\/\//, '')}
                localUrl={localTwin} liveUrl={kind === 'dev' || kind === 'built' ? twinUrl(nav.url, liveOrigin) : ''}
                canStartDev={!!devCommand && !devRunning} onGo={go} onStartDev={quickStartDev}
              />
            )}
          </form>
          {projectDir && (
            <div className="nav-pins">
              <PinsChip projectDir={projectDir} url={nav.url} title={nav.title} flash={flash} onCompare={(images, title) => setCompare({ images, labels: ['Pinned', 'Now'], title })} />
            </div>
          )}
          <ProfileMenu profiles={profiles} current={tab?.profile || ''} onPick={(p) => tab && setTabProfile(tab.id, p)} onSave={saveProfiles} />
          {/* Page tools: one button that shows what's on, and opens a labelled menu on hover (click pins it). */}
          <div className={`vp-tools ${pageToolsOpen ? 'pinned' : ''}`} onMouseEnter={(e) => { if ((e.target as HTMLElement).closest?.('.cond-pop')) return; clearTimeout(toolsTimer.current); setToolsHover(true); }} onMouseLeave={() => { toolsTimer.current = window.setTimeout(() => setToolsHover(false), 220); }}>
            <button type="button" className={`vp-more ${pageToolsOpen || toolsHover ? 'on' : ''}`} onClick={() => setPageToolsOpen(!pageToolsOpen)} title="Page tools: sizes, side by side, components, other browsers, page check, freeze, conditions">
              {device.on && !multi && (() => { const I = device.w < 600 ? Smartphone : device.w < 1000 ? Tablet : Monitor; return <I size={14} className="vp-state" />; })()}
              {multi && <Columns3 size={14} className="vp-state" />}
              {wsOpen && <Boxes size={14} className="vp-state" />}
              {frozen && <Snowflake size={14} className="vp-state" />}
              {(cond.stress.length > 0 || cond.network !== 'normal' || cond.anim !== 1) && <span className="vp-state-dot" title="Test conditions are on" />}
              <DotsThree size={15} />
            </button>
            <div className={`vp-toggles ${pageToolsOpen || toolsHover ? 'open' : ''}`}>
              <button type="button" className={wsOpen ? 'on' : ''} onClick={() => { if (wsOpen) browser.current?.closeWorkspace(); setWsOpen(!wsOpen); }} disabled={!projectDir || !/^https?:/.test(nav.url)} title="Components: render any component from the project on its own, with its props and variants"><Boxes size={14} /><span className="vp-label">Components</span></button>
              <button type="button" onClick={() => setEnginesOpen(true)} disabled={!/^https?:/.test(nav.url)} title="Other browsers: see this page in Safari's engine (WebKit) and Firefox"><AppWindow size={14} /><span className="vp-label">Other browsers</span></button>
              <button type="button" className={sweepOpen ? 'on' : ''} onClick={() => setSweepOpen(true)} disabled={!projectDir || !/^https?:/.test(nav.url)} title="Check every page at phone, tablet and desktop widths for layout, loading and accessibility problems"><ShieldCheck size={14} /><span className="vp-label">Check every page</span></button>
              <span className="vp-sep" />
              {QUICK_SIZES.map((q) => {
                const on = q.w ? device.on && device.w === q.w : !device.on;
                return <button type="button" key={q.label} className={on && !multi ? 'on' : ''} onClick={() => { setMulti(false); setDevice(q.w ? { on: true, w: q.w, h: q.h, zoom: device.zoom, touch: device.touch } : DEVICE_OFF); }} title={q.label}><q.icon size={14} /><span className="vp-label">{q.label.split(' (')[0].replace(' × ', '×')}</span></button>;
              })}
              <button type="button" className={multi ? 'on' : ''} onClick={() => setMulti(!multi)} disabled={!/^(https?|file):/.test(nav.url)} title="Phone, tablet and desktop side by side"><Columns3 size={14} /><span className="vp-label">Side by side</span></button>
              <span className="vp-sep" />
              <button type="button" className={frozen ? 'on' : ''} onClick={() => setFrozen(!frozen)} title="Freeze the page so open menus, tooltips and popovers stay put. Press F while pointing at the page to keep its hover state (F8 while typing)."><Snowflake size={14} /><span className="vp-label">Freeze</span></button>
              <ConditionsMenu
                value={cond} set={changeConditions} onStep={stepAnimation}
                env={env} setEnv={setEnv}
                layout={settings.layoutOverlay !== false}
                setLayout={(on) => { saveSettings({ layoutOverlay: on }); browser.current?.send('layout', on); }}
              />
            </div>
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
                  onScribble={(points) => { if (here()) addScribble(points); }}
                  onPicked={(el) => { if (here()) onPicked(el); }}
                  onNavigate={(s) => {
                    patchTab(t.id, s);
                    if (here() && document.activeElement?.closest('.urlbar') == null) setUrlInput(s.url === 'about:blank' ? '' : s.url);
                  }}
                  onLoading={(l) => patchTab(t.id, { loading: l })}
                  onReady={() => { applyTabProfile(t); if (here()) syncPage(); }}
                  onKey={(k) => { if (here()) handleKey(k); }}
                  onError={(msg) => patchTab(t.id, { error: msg })}
                  onConsole={(c) => { if (!here()) return; onConsole(c); if (c.level === 'error') tapRef.current?.errors.push(c.message.split('\n')[0].slice(0, 200)); }}
                  onPageChange={() => { if (here()) { clearDiagnostics(); setFrozenState(false); setA11y([]); } }}
                  onFrozen={(on) => { if (here()) onFrozen(on); }}
                  onStep={(s) => { if (here()) onStep(s); }}
                  onRequest={(r) => { if (here()) onRequest(r); }}
                />
              );
            })}

            {overlay && mode !== 'sketch' && <MockupOverlay overlay={overlay} onChange={setOverlay} onDiff={diffMockup} onMatch={matchMockup} canMatch={!runId && !job && !busy} onClose={() => setOverlay(null)} />}
            {frozen && <div className="frozen-tag"><Snowflake size={12} /> Page frozen · press F to release</div>}
            {rec && <div className="frozen-tag rec"><CircleDot size={12} /> Recording · {rec.steps.length} step{rec.steps.length === 1 ? '' : 's'} <button onClick={toggleRecording}>Stop</button></div>}
            {isolated && <div className="frozen-tag iso">Showing one element on its own <button onClick={() => isolate(null)}>Show page</button></div>}

            {mode === 'select' && page.shapes.length > 0 && (
              <DrawSurface shapes={page.shapes} onChange={page.set} tool={tool} color={color} size={size} passive />
            )}
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

            {mode === 'select' && !popover && <div className="mode-hint">Click to annotate · drag to draw · Esc to exit</div>}

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
                onTool={openTool}
                setup={!settings.onboarded && agents && (!projectDir || !agentReady) ? (
                  <Onboarding
                    agents={agents} harnesses={harnesses} current={settings.agent} projectDir={projectDir}
                    onPick={(agent) => saveSettings({ agent })} onRecheck={() => api.detectAgents().then(setAgents).catch(() => {})}
                    onTerminal={() => openTool('term')} onOpenProject={() => pickProject()} onSettings={() => setSettingsOpen(true)}
                    onDone={() => saveSettings({ onboarded: true })}
                  />
                ) : null}
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
      {drawerOpen && (
        <div className="tool-view">
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
          files={<FilesPanel recent={recentFiles} refreshKey={`${projectDir}:${recentFiles.length}:${runId || ''}`} onMention={mention} onOpen={openFile} />}
          split={!!settings.split} onSplit={() => saveSettings({ split: !settings.split })}
          cwd={projectDir} shell={settings.terminalShell} onShell={(terminalShell) => { if (terminalShell !== settingsRef.current?.terminalShell) saveSettings({ terminalShell }); }}
          devRunning={devRunning} devCommand={devCommand} devCandidates={devInfo?.candidates}
          onStartDev={startDev} onStopDev={() => api.stopDev()} onClose={() => setDrawerOpen(false)}
        />
        </div>
      )}
      {diffView && (
        <DiffViewer
          runId={diffView.runId} initialPath={diffView.path}
          onClose={() => setDiffView(null)}
          onReverted={(r) => applyRevert(diffView.runId, r)}
          onOpen={openFile}
          onExplain={(text) => newSide(text)}
          onSendComments={(text) => sendText(text)}
        />
      )}
      </main>
      {askAside && (
        <div className="ask-aside" style={{ left: askAside.x, top: askAside.y }} onMouseDown={(e) => e.preventDefault()}>
          <button onClick={() => fromSelection('side')} title="Start a side chat about this"><MessageSquare size={12} /> Side chat</button>
          <button onClick={() => fromSelection('reply')} title="Quote this in your next message"><CornerDownRight size={12} /> Reply</button>
        </div>
      )}

      <aside
        className={`panel ${left ? 'left' : 'right'} ${activeSide ? 'side-active' : ''}`}
        style={settings.panelHidden ? { display: 'none' } : undefined}
        onDragOver={(e) => { if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); dropFiles(e.dataTransfer.files); }}
      >
        {dragOver && <div className="drop-zone"><ImagePlus size={26} /><b>Drop files here</b><span>Images become references; other files are mentioned by path</span></div>}
        <div
          className={`resizer col ${resizing === 'panel' ? 'on' : ''}`}
          onPointerDown={startResize('panel')}
          onDoubleClick={() => { setPanelWidth(null); saveSettings({ panelWidth: 400 }); }}
          title="Drag to resize · double-click to reset"
        />
        <div className="panel-head">
          <div className="panel-tabs" ref={tabsStrip} onScroll={fadeTabs} onWheel={(e) => { if (e.deltaY && !e.deltaX) e.currentTarget.scrollLeft += e.deltaY; }}>
            <button className={`ptab ${activeSide ? '' : 'on'}`} onClick={() => setActiveSide(null)} title={chatTitle(chat) || 'This chat'}>
              {runId ? <Loader2 size={12} className="spin" /> : <MessageSquare size={12} />}<span>Chat</span>
            </button>
            {chatId && <PullIcon pull={pulls[branchOf.current.get(chatId) || '']} branch={branchOf.current.get(chatId)} />}
            {chatId && gitStatus?.repo && gitStatus.remote && gitStatus.branch && gitStatus.branch !== gitStatus.defaultBranch && !pulls[gitStatus.branch] && recentFiles.length > 0 && (
              <button className="ptab-new" onClick={() => setBranchCompare({ pr: true })} title="Open a pull request from this chat"><GitPullRequestArrow size={13} /></button>
            )}
            {sides.map((x) => (
              <div key={x.id} className={`ptab side ${activeSide === x.id ? 'on' : ''}`} onClick={() => setActiveSide(x.id)} title={x.title}>
                {x.running ? <Loader2 size={12} className="spin" /> : <CornerDownRight size={12} />}<span>{x.title}</span>
                <button className="ptab-x" onClick={(e) => { e.stopPropagation(); closeSide(x.id); }} title="Close side chat"><X size={11} /></button>
              </div>
            ))}
            {chat.some((it) => it.kind === 'done' && it.shots) && <button className="ptab-new ptab-timeline" onClick={() => setTimelineOpen(true)} title="Timeline: the page after each run in this chat"><History size={13} /></button>}
            <button className="ptab-new" onClick={() => newSide()} disabled={!projectDir} title={`New side chat: ask without touching this chat (${combo('A', true)})`}><Plus size={13} /></button>
          </div>
          <div className="spacer" />
          <button className="btn ghost xs panel-new quiet" onClick={newChat} disabled={!!job || !chat.length} title={`${runId ? 'Start another chat. This one keeps working.' : session ? 'Continuing the same agent session. Click to start fresh.' : 'Start a fresh agent session'} (${combo('O', true)})`}><SquarePen size={13} /><span className="btn-text">New chat</span></button>
        </div>
        {sides.map((x) => (
          <SideChat
            key={x.id} sideId={x.id} active={activeSide === x.id} agentName={agentName}
            seed={x.seed} onSeedUsed={() => patchSide(x.id, { seed: null })} getContext={sideContext}
            onTitle={(title) => patchSide(x.id, { title })} onRunning={(running) => patchSide(x.id, { running })}
          />
        ))}
        {others.length > 0 && !threadsOn && (
          <div className="other-chats">
            {others.map((o) => (
              <button key={o.id} className={o.running ? 'running' : 'finished'} onClick={() => openChat(o.id)} title={o.running ? 'Still working. Click to look.' : 'Finished. Click to see the result.'}>
                {o.running ? <Loader2 size={11} className="spin" /> : <Check size={11} />}
                <span>{o.title || 'Untitled'}</span>
              </button>
            ))}
          </div>
        )}

        <div className={`chat-wrap ${away ? 'away' : ''}`}>
        <div className="chat" ref={chatBox} onScroll={(e) => { onChatScroll(e); markBelow(); if (askAside) setAskAside(null); }} onWheel={onChatWheel} onMouseUp={onChatMouseUp}>
          {chat.length === 0 ? (
            <EmptyChat agentName={agentName} cliMissing={!!agents && !agentReady} />
          ) : <ChatList items={chat} actions={chatActions} root={root} gitRepo={!!gitStatus?.repo} busy={!!runId || !!job} />}
          {(runId || job) && (
            <div className="working">
              <Loader2 size={14} className="spin" />{' '}
              <span className="shimmer">{job || `${runMeta?.variant ? `Variant ${runMeta.variant.index} of ${runMeta.variant.total}: ` : ''}${agentName} is ${runMeta?.verify ? 'checking the result' : runMeta?.match ? `matching the mockup, round ${runMeta.match} of ${MATCH_ROUNDS}` : 'working'}…`}</span>
            </div>
          )}
          <div ref={chatEnd} />
        </div>
        {away && chat.length > 0 && (
            <div className="to-latest">
              <button className={away.fresh ? 'fresh' : ''} onClick={toLatest} title="Go to the latest message">
                <ArrowDown size={13} /> {away.fresh ? 'New messages' : 'Latest'}
              </button>
            </div>
          )}
        </div>

        <div className={`composer ${composerMore ? 'more' : ''}`}>
          <BackgroundRuns
            runs={bgRuns} onApply={applyBg} onDiscard={discardBg}
            onDiff={(r) => api.bgDiff(r.id).then((text) => setPatchView({ title: r.title, text }))}
          />
          {projectDir && (
            <ContextBar
              lead={<>
                <GitPanel status={gitStatus} refresh={refreshGit} settings={settings} saveSettings={saveSettings} busy={!!runId} prDefaults={prDefaults} flash={flash} onOpenWorktree={openWorktree} onCompare={(base, remote) => setBranchCompare({ base, remote })} onSwitched={() => { if (/^file:/.test(navRef.current.url)) browser.current?.reload(); }} />
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
            annotations={annotations} root={root} activeId={activeId} overlayImage={overlay?.image ?? null} editingId={popover?.id ?? null}
            pageMarks={page.shapes.length} sketchMarks={sketch.shapes.length}
            onFocus={focusAnn} onActive={setActiveId} onNote={updateNote} onPaste={onPaste} onSend={() => send()}
            onCopyTest={(a) => { navigator.clipboard?.writeText(toPlaywright(a)); flash('Playwright test copied.'); }}
            onOverlay={(a) => setOverlay(overlay?.image === a.image ? null : { image: a.image!, name: a.name || 'mockup', opacity: 0.5, x: 0, y: 0, moving: false })}
            onRemove={removeAnn}
          />

          {limits && (
            <div className={`limit-banner ${limits.status}`}>
              <AlertTriangle size={13} />
              <span>
                {limits.status === 'rejected' ? 'Usage limit reached' : 'Close to your usage limit'}
                {limits.used != null ? ` · ${limits.used}% used` : ''}{limits.window ? ` (${limits.window})` : ''}
                {limits.resetsAt ? ` · resets ${new Date(limits.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
              </span>
              <button className="icon-btn xs" onClick={() => setLimits(null)} title="Dismiss"><X size={12} /></button>
            </div>
          )}
          {runId && <ReadingStrip items={chat} root={root} />}
          {queuedRef.current.length > 0 && (
            <div className="queue-tray">
              <div className="queue-title">Waiting to send when this run ends</div>
              {queuedRef.current.map((q) => (
                <div key={q.itemId} className="queue-item">
                  <span>{q.request.instruction || `${q.request.annotations.length} annotation${q.request.annotations.length === 1 ? '' : 's'}`}</span>
                  <button className="icon-btn xs" onClick={() => unqueue(q.itemId, true)} title="Take it back to edit"><Pencil size={12} /></button>
                  <button className="icon-btn xs" onClick={() => unqueue(q.itemId, false)} title="Don't send it"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="composer-box">
            {assist.popover}
            {pastes.length > 0 && (
              <div className="paste-chips">
                {pastes.map((p) => (
                  <span key={p.id} className={`paste-chip ${pasteOpen === p.id ? 'on' : ''}`}>
                    <button onClick={() => setPasteOpen(pasteOpen === p.id ? null : p.id)} title="Show what was pasted"><FileText size={12} /> Pasted text · {p.text.split('\n').length} lines</button>
                    <button onClick={() => setPastes((list) => list.filter((x) => x.id !== p.id))} title="Remove"><X size={11} /></button>
                  </span>
                ))}
              </div>
            )}
            <ImageChips
              annotations={annotations} overlayImage={overlay?.image ?? null} onActive={setActiveId} onRemove={removeAnn}
              onOverlay={(a) => setOverlay(overlay?.image === a.image ? null : { image: a.image!, name: a.name || 'mockup', opacity: 0.5, x: 0, y: 0, moving: false })}
            />
            {pasteOpen && <pre className="paste-preview">{pastes.find((p) => p.id === pasteOpen)?.text}</pre>}
            {planMode && !runId && <button className="plan-pill" onClick={() => setPlanMode(false)} title="The agent proposes changes without making them. Click to let it edit files.">Plan only ×</button>}
            <textarea
              ref={composerRef}
              value={instruction}
              onChange={(e) => { setInstruction(e.target.value); assist.track(); }}
              onSelect={assist.track}
              placeholder={runId
                ? `Steer the agent: Enter adds it after the current step · ${MOD}+Enter interrupts now`
                : annotations.length ? 'Anything else? (optional)' : chat.length ? 'Follow up' : 'Describe a change  ·  @ files  ·  / commands'}
              onKeyDown={(e) => {
                if (assist.onKeyDown(e)) return;
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); setHistoryOpen(true); return; }
                if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
                  // ↑ / ↓ walk through what you've sent, when the box is empty or you're already browsing it.
                  const t = e.currentTarget;
                  const browsing = historyAt.current >= 0;
                  const atEdge = e.key === 'ArrowUp' ? t.selectionStart === 0 : t.selectionStart === t.value.length;
                  if ((browsing || !t.value) && atEdge) {
                    const list = readHistory();
                    const next = e.key === 'ArrowUp' ? Math.min(list.length - 1, historyAt.current + 1) : historyAt.current - 1;
                    if (next !== historyAt.current && (next >= 0 || browsing)) {
                      e.preventDefault();
                      historyAt.current = next;
                      setInstruction(next >= 0 ? list[next] : '');
                      return;
                    }
                  }
                }
                if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
                e.preventDefault();
                send(runId && (e.ctrlKey || e.metaKey) ? 'now' : 'queue');
              }}
              onPaste={onPaste}
              rows={3}
            />
            <div className="composer-foot">
              <button className="icon-btn attach-btn" onClick={() => fileInput.current?.click()} title="Attach reference images (or paste / drop them)"><Paperclip size={15} /></button>
              {!runId && (
                <div className={`composer-tray-wrap ${composerMore ? 'open' : ''}`}>
                  <button className={`icon-btn composer-more ${composerMore ? 'on' : ''}`} onClick={() => setComposerMore(!composerMore)} title="More: share, variants, run in the background"><DotsThree size={15} />{(reviewComments.length > 0 || (settings.variants || 0) > 1) && <i className="more-dot" />}</button>
                  <div className="composer-tray">
                    <HandoffMenu hasRequest={!!(instruction.trim() || annotations.length)} canIssue={!!gitStatus?.gh.authed && !!gitStatus?.remote} onExport={exportHandoff} onCopy={copyHandoff} onIssue={issueHandoff} onImport={importHandoff} onReview={() => setReviewOpen(true)} reviewCount={reviewComments.length} reviewing={reviewing} />
                    <VariantsMenu value={settings.variants || 0} set={(n) => saveSettings({ variants: n })} />
                    <button className="icon-btn bg-btn" disabled={!canSend || !!bgBlocked} onClick={() => { setComposerMore(false); send('bg'); }} title={bgBlocked || 'Run in the background: in a separate copy of the project, so you can keep working and send more'}><SquareStack size={15} /></button>
                  </div>
                </div>
              )}
              <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) addReferences(e.target.files); e.target.value = ''; }} />
              {runId
                ? <span className="steer-hint"><kbd>↵</kbd> after this step <kbd>{MOD}↵</kbd> now</span>
                : <>
                  <AgentPicker
                    value={settings.agent} harnesses={harnesses} agents={agents} disabled={!!runId} mcp={mcp}
                    onPick={(agent) => saveSettings({ agent })} onSetup={() => setSettingsOpen(true)}
                  />
                  <AgentControls settings={settings} catalog={catalog} onChange={saveSettings} harness={harnesses.find((h) => h.id === settings.agent)} />
                </>}
              {usage && <ContextMeter used={usage.used} window={usage.window} />}
              {runId ? (
                <div className="run-actions">
                  <button className="icon-btn stop-btn" onClick={cancel} title="Stop the agent"><Square size={11} weight="fill" /></button>
                  <button className="btn sm ghost send-btn" disabled={!canSend} onClick={() => send('now')} title={`Interrupt the current step and send now (${MOD}+Enter)`}><Zap size={13} /><span className="btn-text">Now</span></button>
                  <button className="btn primary sm send-btn" disabled={!canSend} onClick={() => send('queue')} title="Send after the agent's current step (Enter)"><CornerDownRight size={13} /><span className="btn-text">Steer</span></button>
                </div>
              ) : (
                <div className="run-actions">
                  <button className="btn primary sm send-btn round" disabled={!canSend} onClick={() => send()} title="Send (Enter)"><ArrowUp size={15} /><span className="sr-only">Send</span></button>
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>

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
      {sweepOpen && (
        <SweepView
          {...sweepPlan()} partition={partitionOf(tab?.profile || '')}
          onOpen={sweepOpenPage} onFix={sweepFix} onClose={() => setSweepOpen(false)}
        />
      )}
      {liveItem && (
        <VariantsLive
          options={liveItem.options} chosen={liveItem.chosen} page={livePage} busy={!!runId || !!job}
          onPick={(id) => { setLiveVariants(null); pickVariant(liveItem.id, id); }}
          onClose={() => setLiveVariants(null)}
        />
      )}
      {reviewOpen && (
        <ReviewPanel
          url={nav.url} canShare={kind === 'dev' || kind === 'built'}
          whyNot={kind === 'live' ? 'This is the live site: send people its normal address. Open the page locally to share your working copy.' : 'Open a page from your dev server first.'}
          comments={reviewComments} onAdd={addReviewComments}
          onDismiss={(id) => setReviewComments((cs) => cs.filter((c) => c.id !== id))}
          onState={(s) => setReviewing(s.running)} flash={flash} onClose={() => setReviewOpen(false)}
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
      {branchCompare && gitStatus?.repo && (
        <BranchCompare status={gitStatus} initialBase={branchCompare.base} initialRemote={branchCompare.remote} initialPr={branchCompare.pr} prDefaults={prDefaults} flash={flash} onOpen={openFile} onClose={() => { setBranchCompare(null); refreshGit(); }} />
      )}
      {settingsOpen && <SettingsModal settings={settings} agents={agents} harnesses={harnesses} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}
      {statusOn && (
        <StatusBar
          branch={gitStatus?.repo ? gitStatus.branch : undefined} dirty={gitStatus?.dirty}
          devRunning={devRunning} devCommand={devCommand}
          errors={consoleLog.filter((c) => c.level === 'error').length}
          agent={agentName} model={modelName || ''} cost={chatCost} today={spentToday()}
          // The git panel keeps its own open state; its chip in the composer is the way in.
          onBranch={() => (document.querySelector('.composer .git-wrap > .chip') as HTMLElement | null)?.click()}
          onDev={() => { setDrawerOpen(true); setDrawerTab('dev'); }}
          onErrors={() => browser.current?.devtools()}
        />
      )}
      {historyOpen && (
        <CommandPalette
          placeholder="Search what you've sent…"
          commands={readHistory().map((t, i) => ({ id: `h${i}`, group: 'Sent before', label: t.split('\n')[0].slice(0, 120), hint: t.includes('\n') ? `${t.split('\n').length} lines` : undefined, run: () => { setInstruction(t); setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 30); } }))}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {timelineOpen && <Timeline items={chat} onClose={() => setTimelineOpen(false)} onCompare={(images, labels, title) => { setTimelineOpen(false); setCompare({ images, labels, title }); }} />}
      {shortcutsOpen && <ShortcutsSheet onClose={() => setShortcutsOpen(false)} />}
      {layoutsOpen && <LayoutsSheet layouts={settings.layouts || []} onSave={saveLayout} onApply={(l) => { applyLayout(l); setLayoutsOpen(false); }} onRemove={(name) => saveSettings({ layouts: (settings.layouts || []).filter((x) => x.name !== name) })} onClose={() => setLayoutsOpen(false)} />}
      {paletteOpen && <CommandPalette commands={commands} onQuery={searchChats} onClose={() => { setPaletteOpen(false); setPaletteHits([]); }} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function markerList(anns: Annotation[], activeId: string | null) {
  return anns
    .filter((a) => a.kind === 'element' && a.element?.uid)
    .map((a) => ({ uid: a.element!.uid, selector: a.element!.selector, n: a.n, color: a.color, active: a.id === activeId }));
}
