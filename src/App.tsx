import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Bug, FolderOpen, Globe, Loader2, Monitor, MousePointer2, MousePointerClick,
  PenTool, Plus, RotateCw, Send, Settings as SettingsIcon, Smartphone, Square, SquarePen, Tablet,
  TerminalSquare, Trash2, X, PanelLeft, PanelRight, Paperclip, Palette, ImagePlus, Zap, CornerDownRight,
} from 'lucide-react';
import { BrowserView, sleep, type BrowserHandle, type PickedElement } from './components/BrowserView';
import { DrawSurface } from './components/DrawSurface';
import { DrawToolbar, TOOL_KEYS } from './components/DrawToolbar';
import { ChatItemView, invalidateDiff, shortPath } from './components/Chat';
import { SettingsModal } from './components/SettingsModal';
import { Drawer } from './components/Drawer';
import { AgentControls } from './components/AgentControls';
import { Logo } from './components/Logo';
import { Welcome } from './components/Welcome';
import { ContextSheet, type ContextTab } from './components/ContextSheet';
import { ContextBar } from './components/ContextBar';
import { DiffViewer } from './components/DiffViewer';
import { RoutePicker } from './components/RoutePicker';
import { ChatHistory } from './components/ChatHistory';
import { GitPanel } from './components/GitPanel';
import { CompareView } from './components/CompareView';
import { ANNOTATION_COLORS, composite, samplePoints, thumbnail, uid, unionBounds } from './lib/draw';
import type {
  AgentEvent, AgentId, Annotation, ChatItem, ConsoleEntry, DesignDoc, MemoryItem, Mode, ModelCatalog, NetworkFailure,
  GitStatus, Rect, RevertResult, RouteInfo, Settings, Shape, SourceInfo, Tool,
} from './lib/types';

const api = window.pinpoint;
export const isMac = api.platform === 'darwin';
export const MOD = isMac ? '⌘' : 'Ctrl';
document.documentElement.classList.add(`platform-${api.platform}`);
api.onFullscreen((fs) => document.documentElement.classList.toggle('fullscreen', fs));

// ---------- helpers ----------
function normalizeUrl(input: string) {
  const s = input.trim();
  if (!s) return '';
  if (/^[a-zA-Z]:[\\/]/.test(s)) return 'file:///' + s.replace(/\\/g, '/');
  if (/^(https?|file|about|data):/i.test(s)) return s;
  if (s.startsWith('/')) return 'file://' + s; // macOS / Linux absolute path
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?/.test(s) || /^:\d+/.test(s)) return 'http://' + s.replace(/^:/, 'localhost:');
  if (/^\d+$/.test(s)) return `http://localhost:${s}`;
  return 'https://' + s;
}

const errText = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// Route patterns ([id], :id, [...slug], *) -> regex, to find which route renders a URL.
function routeRegex(route: string) {
  const body = route.split('/').map((seg) => {
    if (/^\[\[?\.\.\./.test(seg) || seg === '*') return '.*';
    if (/^\[.+\]$/.test(seg) || /^[:$]/.test(seg)) return '[^/]+';
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return new RegExp(`^${body || '/'}/?$`);
}

function matchRoute(routes: RouteInfo[], url: string, root: string): RouteInfo | null {
  if (!url || !routes.length) return null;
  let path = '';
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') {
      const file = decodeURIComponent(u.pathname).replace(/^\/([a-zA-Z]:)/, '$1');
      const r = root.replace(/\\/g, '/').replace(/\/$/, '');
      if (!file.toLowerCase().startsWith(r.toLowerCase() + '/')) return null;
      path = '/' + file.slice(r.length + 1);
      if (path === '/index.html') path = '/';
    } else path = u.pathname.replace(/\/$/, '') || '/';
  } catch { return null; }
  return routes.find((r) => !r.dynamic && r.route === path) || routes.find((r) => r.dynamic && routeRegex(r.route).test(path)) || null;
}

// Reads an image file, shrinking big ones so requests stay light.
function readImage(file: File, maxEdge = 1800): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const s = Math.min(1, maxEdge / Math.max(img.width, img.height));
        if (s === 1 && file.size < 1.5e6) return resolve(fr.result as string);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL(file.type === 'image/png' && file.size < 4e6 ? 'image/png' : 'image/jpeg', 0.9));
      };
      img.src = fr.result as string;
    };
    fr.readAsDataURL(file);
  });
}

interface AgentRequest {
  url: string; title: string; viewport: { width: number; height: number };
  instruction: string; overview?: string;
  annotations: Omit<Annotation, 'id' | 'color'>[];
  diagnostics?: { console: ConsoleEntry[]; network: NetworkFailure[]; devLog: string };
  route?: { path: string; file: string; framework: string };
}

// Several queued messages become one follow-up, renumbering their annotations.
function mergeRequests(reqs: AgentRequest[]): AgentRequest {
  const last = reqs[reqs.length - 1];
  let n = 0;
  return {
    ...last,
    instruction: reqs.map((r) => r.instruction).filter(Boolean).join('\n\n'),
    annotations: reqs.flatMap((r) => r.annotations.map((a) => ({ ...a, n: ++n }))),
    overview: last.overview ?? reqs.find((r) => r.overview)?.overview,
  };
}

// A saved chat whose last request never finished (app closed mid-run) gets an
// explicit note instead of hanging on "Starting…" forever.
function healChat(items: ChatItem[]): ChatItem[] {
  let lastUser = -1;
  items.forEach((it, i) => { if (it.kind === 'user') lastUser = i; });
  if (lastUser < 0 || items.slice(lastUser).some((it) => it.kind === 'done')) return items;
  return [
    ...items.map((it) => (it.kind === 'tool' && it.status === 'running' ? { ...it, status: 'error' as const } : it)),
    { kind: 'error', id: uid(), text: 'This run was interrupted: Pinpoint closed before it finished. Files it already edited stay edited.' },
  ];
}

// Screenshots for before/after are stored as JPEG to keep run folders small.
function toJpeg(dataUrl: string, quality = 0.86): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d')!.drawImage(img, 0, 0);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '');

function clampRect(r: Rect, vp: { width: number; height: number }): Rect {
  const x = Math.max(0, r.x), y = Math.max(0, r.y);
  return { x, y, width: Math.max(0, Math.min(vp.width, r.x + r.width) - x), height: Math.max(0, Math.min(vp.height, r.y + r.height) - y) };
}

function useShapes() {
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [undoStack, setUndo] = useState<Shape[][]>([]);
  const [redoStack, setRedo] = useState<Shape[][]>([]);
  return {
    shapes,
    set(next: Shape[]) { setUndo((u) => [...u.slice(-100), shapes]); setRedo([]); setShapes(next); },
    undo() { if (!undoStack.length) return; setRedo((r) => [...r, shapes]); setShapes(undoStack[undoStack.length - 1]); setUndo(undoStack.slice(0, -1)); },
    redo() { if (!redoStack.length) return; setUndo((u) => [...u, shapes]); setShapes(redoStack[redoStack.length - 1]); setRedo(redoStack.slice(0, -1)); },
    reset() { setShapes([]); setUndo([]); setRedo([]); },
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}

const MODES: { id: Mode; label: string; icon: typeof MousePointer2; key: string; hint: string }[] = [
  { id: 'browse', label: 'Browse', icon: MousePointer2, key: 'V', hint: 'Use the site normally' },
  { id: 'select', label: 'Select', icon: MousePointerClick, key: 'S', hint: 'Click elements to annotate them' },
  { id: 'draw', label: 'Draw', icon: PenTool, key: 'D', hint: 'Draw on top of the page' },
  { id: 'sketch', label: 'Sketch', icon: SquarePen, key: 'K', hint: 'Sketch a new idea on a blank board' },
];

const VIEWPORTS = { full: { w: 0, icon: Monitor, label: 'Responsive' }, tablet: { w: 820, icon: Tablet, label: 'Tablet 820' }, mobile: { w: 390, icon: Smartphone, label: 'Mobile 390' } };
type Viewport = keyof typeof VIEWPORTS;

const describe = (a: Annotation, root: string) => {
  if (a.kind === 'element' && a.element) {
    const el = a.element;
    const cls = el.classes?.filter((c) => c.length < 24).slice(0, 2).join('.') || '';
    return {
      title: `<${el.tag}${el.id ? '#' + el.id : ''}${cls ? '.' + cls : ''}>`,
      sub: el.source?.file ? shortPath(el.source.file, root) + (el.source.line ? `:${el.source.line}` : '')
        : el.source?.components?.length ? el.source.components.slice(-2).join(' › ') : el.text || el.selector,
    };
  }
  if (a.kind === 'drawing') return { title: 'Drawing on page', sub: a.hits?.length ? `over ${a.hits.length} element${a.hits.length > 1 ? 's' : ''}` : 'markup' };
  if (a.kind === 'reference') return { title: 'Reference image', sub: a.name || 'image' };
  return { title: 'Sketch', sub: 'wireframe' };
};

// ---------- app ----------
export default function App() {
  const browser = useRef<BrowserHandle>(null);
  const frame = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [agents, setAgents] = useState<Record<AgentId, { ok: boolean; version?: string }> | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [nav, setNav] = useState({ url: '', title: '', canBack: false, canForward: false });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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
  const [viewport, setViewport] = useState<Viewport>('full');

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Live sizes while dragging a splitter; persisted to settings on release.
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [drawerHeight, setDrawerHeight] = useState<number | null>(null);
  const [resizing, setResizing] = useState<'panel' | 'drawer' | null>(null);
  const [drawerTab, setDrawerTab] = useState<'dev' | 'agent'>('dev');
  const [devLog, setDevLog] = useState('');
  const [agentLog, setAgentLog] = useState('');
  const [devRunning, setDevRunning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Project context
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatCreated, setChatCreated] = useState(0);
  // DESIGN.md is sent once, when an agent session starts. We keep what was sent
  // so we can tell the user when edits won't reach the current chat.
  const [designAtStart, setDesignAtStart] = useState<string | null>(null);
  const [design, setDesign] = useState<DesignDoc | null>(null);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [sheet, setSheet] = useState<ContextTab | null>(null);
  const [diffView, setDiffView] = useState<{ runId: string; path?: string } | null>(null);
  const [consoleLog, setConsoleLog] = useState<ConsoleEntry[]>([]);
  const [netFails, setNetFails] = useState<NetworkFailure[]>([]);
  const [includeDiag, setIncludeDiag] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [compare, setCompare] = useState<string | null>(null); // runId shown in the before/after view
  const runPageRef = useRef<Record<string, string>>({});       // runId -> page URL when it started
  const loadingRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Refs mirror state for async handlers and IPC subscriptions.
  const runRef = useRef<string | null>(null);
  runRef.current = runId;
  const navRef = useRef(nav);
  navRef.current = nav;
  const annRef = useRef(annotations);
  annRef.current = annotations;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500); };

  // ---------- boot ----------
  useEffect(() => {
    api.getSettings().then((s) => { setSettings(s); setUrlInput(s.url); });
    api.detectAgents().then(setAgents);
    api.modelCatalog().then(setCatalog);
  }, []);

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await api.setSettings(patch);
    setSettings(next);
    if ('claudePath' in patch || 'codexPath' in patch) api.detectAgents().then(setAgents);
  }, []);

  // ---------- project context ----------
  const projectDir = settings?.projectDir || '';
  const refreshRoutes = useCallback(() => { api.listRoutes().then(setRoutes).catch(() => setRoutes([])); }, []);
  const refreshGit = useCallback(async () => { await api.gitStatus().then(setGitStatus).catch(() => setGitStatus(null)); }, []);

  useEffect(() => {
    if (!projectDir) return;
    api.readDesign().then(setDesign).catch(() => setDesign(null));
    api.readMemory().then(setMemory).catch(() => setMemory([]));
    refreshRoutes();
    refreshGit();
    // Reopen the most recent conversation for this project.
    api.listChats().then(async (list) => {
      const last = list[0] ? await api.loadChat(list[0].id) : null;
      if (last) {
        setChatId(last.id); setChatCreated(last.createdAt); setChat(healChat(last.items)); setSession(last.session); setDesignAtStart(last.designAtStart ?? null);
      } else {
        setChatId(null); setChat([]); setSession(null); setDesignAtStart(null);
      }
    }).catch(() => {});
  }, [projectDir, refreshRoutes]);

  // Autosave the conversation (debounced).
  useEffect(() => {
    if (!projectDir || !chatId || !chat.length) return;
    const t = setTimeout(() => {
      const first = chat.find((c) => c.kind === 'user') as Extract<ChatItem, { kind: 'user' }> | undefined;
      const title = (first?.text || first?.annotations.map((a) => a.note).find(Boolean) || `${first?.annotations.length || 0} annotation(s)`).slice(0, 80);
      api.saveChat({ id: chatId, title, createdAt: chatCreated || Date.now(), updatedAt: Date.now(), agent: settingsRef.current?.agent || 'claude', session, designAtStart, items: chat }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [chat, session, chatId, projectDir, designAtStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const openChat = async (id: string) => {
    const c = await api.loadChat(id);
    if (!c) return;
    setChatId(c.id); setChatCreated(c.createdAt); setChat(healChat(c.items)); setSession(c.session); setDesignAtStart(c.designAtStart ?? null);
  };
  const deleteChat = async (id: string) => {
    await api.deleteChat(id);
    if (id === chatId) { setChatId(null); setChat([]); setSession(null); setDesignAtStart(null); }
  };

  // Failed network requests from the page.
  useEffect(() => api.onNetworkError((n) => {
    setNetFails((l) => (l.some((x) => x.url === n.url && x.status === n.status && x.error === n.error) ? l : [...l, n].slice(-30)));
  }), []);

  const onConsole = useCallback((c: { level: 'error' | 'warning'; message: string; source?: string; line?: number }) => {
    setConsoleLog((l) => {
      const i = l.findIndex((x) => x.message === c.message && x.level === c.level);
      if (i >= 0) return l.map((x, j) => (j === i ? { ...x, count: x.count + 1, at: Date.now() } : x));
      return [...l, { ...c, count: 1, at: Date.now() }].slice(-40);
    });
  }, []);
  const clearDiagnostics = () => { setConsoleLog([]); setNetFails([]); };

  // True when DESIGN.md was edited after the current agent session received it.
  const designChanged = !!session && designAtStart !== null && (settings?.useDesign && design?.exists ? design.content : '') !== designAtStart;

  const currentRoute = useMemo(() => matchRoute(routes, nav.url, projectDir), [routes, nav.url, projectDir]);

  // Maps React 19 stack positions through the dev server's source maps.
  const enrichSource = async (src: SourceInfo | null | undefined): Promise<SourceInfo | null> => {
    if (!src) return null;
    if (src.frame) {
      const r = await api.resolveSourceMap(src.frame).catch(() => null);
      if (r?.file) return { ...src, file: r.file, line: r.line, column: r.column };
    }
    return src;
  };

  // ---------- navigation ----------
  const go = (raw: string) => {
    const url = normalizeUrl(raw);
    if (!url) return;
    setUrlInput(url);
    browser.current?.load(url);
    saveSettings({ url });
  };

  // ---------- mode ----------
  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    setPopover(null);
    browser.current?.send('mode', m === 'select' ? 'select' : 'browse');
  }, []);

  const syncPage = useCallback(() => {
    browser.current?.send('mode', modeRef.current === 'select' ? 'select' : 'browse');
    browser.current?.send('markers', markerList(annRef.current, null));
  }, []);

  // Numbered markers for element annotations, drawn inside the page.
  useEffect(() => {
    browser.current?.send('markers', markerList(annotations, activeId));
  }, [annotations, activeId]);

  const nextN = () => (annRef.current.length ? Math.max(...annRef.current.map((a) => a.n)) + 1 : 1);
  const colorFor = (n: number) => ANNOTATION_COLORS[(n - 1) % ANNOTATION_COLORS.length];

  // ---------- select mode: element picked in page ----------
  const onPicked = useCallback(async (el: PickedElement) => {
    const n = nextN();
    const vp = el.viewport;
    const pad = 20;
    const crop = clampRect({ x: el.rect.x - pad, y: el.rect.y - pad, width: el.rect.width + pad * 2, height: el.rect.height + pad * 2 }, vp);
    let image: string | undefined;
    try { if (crop.width > 2 && crop.height > 2) image = await browser.current!.capture(crop); } catch { /* page may have navigated */ }
    const { dpr: _d, viewport: _v, shift: _s, ...element } = el;
    const ann: Annotation = { id: uid(), n, kind: 'element', note: '', color: colorFor(n), image, element, viewport: vp };
    setAnnotations((prev) => [...prev, ann]);
    setActiveId(ann.id);
    setPopover({ id: ann.id, rect: el.rect });

    const source = await enrichSource(await browser.current!.locateSource(el.uid));
    if (source) {
      setAnnotations((prev) => prev.map((a) => (a.id === ann.id ? { ...a, element: { ...a.element!, source } } : a)));
    }
  }, []);

  // ---------- draw & sketch ----------
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
    const { width, height } = frame.current.getBoundingClientRect();
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

  // ---------- reference images ----------
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

  // ---------- send to agent ----------
  // Messages sent while the agent works are steering: "queue" lands after its
  // current step, "now" interrupts it. If the run can't take live input, they
  // wait here and go out as one follow-up when it finishes.
  const queuedRef = useRef<AgentRequest[]>([]);
  const [flushTick, setFlushTick] = useState(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const startRun = async (request: AgentRequest, before?: string | null) => {
    if (!settings) return;
    const id = uid();
    runPageRef.current[id] = request.url;
    if (before) api.saveShot(id, 'before', before).catch(() => {});
    setAgentLog('');
    setRunId(id);
    runRef.current = id;
    const sess = sessionRef.current;
    const resume = sess && sess.agent === settings.agent ? sess.id : null;
    if (!resume) setDesignAtStart(settings.useDesign && design?.exists ? design.content : '');
    try {
      await api.runAgent({ runId: id, request, sessionId: resume });
    } catch (e) {
      setChat((c) => [...c, { kind: 'error', id: uid(), text: errText(e) }]);
      setRunId(null);
      runRef.current = null;
    }
  };

  // Send whatever piled up while a non-steerable run was going.
  useEffect(() => {
    if (runId || !queuedRef.current.length) return;
    const merged = mergeRequests(queuedRef.current);
    queuedRef.current = [];
    startRun(merged);
  }, [runId, flushTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (mode: 'queue' | 'now' = 'queue') => {
    if (!settings || busy) return;
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
      let overview: string | undefined;
      if (hasPage && (anns.some((a) => a.kind === 'element') || (anns.length === 0 && !runRef.current))) {
        b.send('clean');
        await sleep(80);
        try { overview = await b.capture(); } catch { /* ignore */ }
      }

      // A clean "before" screenshot for the before/after compare (new runs only).
      const before = hasPage && !runRef.current ? await cleanCapture() : null;

      const devTail = stripAnsi(devLog).split('\n').slice(-40).join('\n');
      const devHasErrors = devRunning && /error|failed|exception/i.test(devTail);
      const diagnostics = includeDiag && (consoleLog.length || netFails.length || devHasErrors)
        ? { console: consoleLog, network: netFails, devLog: devHasErrors ? devTail : '' }
        : undefined;
      const request: AgentRequest = {
        url: navRef.current.url, title: navRef.current.title, viewport: b.size(),
        instruction: instruction.trim(),
        overview,
        annotations: anns.map(({ id: _i, color: _c, ...a }) => a),
        diagnostics,
        route: currentRoute ? { path: currentRoute.route, file: currentRoute.file, framework: currentRoute.framework } : undefined,
      };
      if (!chatId) { setChatId(uid()); setChatCreated(Date.now()); }
      const thumbs = await Promise.all(anns.map(async (a) => ({ ...a, image: a.image ? await thumbnail(a.image) : undefined })));

      setInstruction('');
      setAnnotations([]);
      setActiveId(null);
      setPopover(null);
      b.send('clear');
      if (diagnostics) clearDiagnostics();

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

      setChat((c) => [...c, { kind: 'user', id: uid(), text: request.instruction, annotations: thumbs, agent: settings.agent }]);
      await startRun(request, before);
    } catch (e) {
      setChat((c) => [...c, { kind: 'error', id: uid(), text: errText(e) }]);
    } finally { setBusy(null); }
  };

  const cancel = () => { if (runId) api.cancelAgent(runId); };

  // Marks reverted files on the run's card after an undo or a per-file revert.
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
  // Page screenshot without Pinpoint's hover box or pins.
  const cleanCapture = async (): Promise<string | null> => {
    const b = browser.current;
    if (!b) return null;
    b.send('hide', true);
    await sleep(90);
    try { return await toJpeg(await b.capture()); } catch { return null; } finally { b.send('hide', false); }
  };

  // After a run, wait for hot reload (or our own reload for file:// pages) to settle, then shoot.
  const captureAfter = async (id: string) => {
    const url = runPageRef.current[id];
    if (!url) return;
    await sleep(/^file:/.test(url) ? 500 : 1800);
    for (let i = 0; i < 40 && loadingRef.current; i++) await sleep(200);
    await sleep(400);
    if (navRef.current.url !== url) return; // user moved to another page meanwhile
    const shot = await cleanCapture();
    if (!shot) return;
    await api.saveShot(id, 'after', shot);
    setChat((c) => c.map((it) => (it.kind === 'done' && it.runId === id ? { ...it, shots: true } : it)));
  };
  const captureAfterRef = useRef(captureAfter);
  captureAfterRef.current = captureAfter;

  // Screenshot the current page at phone, tablet and desktop widths for a run.
  const captureSizes = async (id: string) => {
    const original = viewport;
    const plan: [Viewport, number][] = [['mobile', 390], ['tablet', 820], ['full', 0]];
    try {
      for (const [v, w] of plan) {
        setViewport(v);
        await sleep(1200);
        const shot = await cleanCapture();
        if (shot) await api.saveShot(id, `size-${w}`, shot);
      }
    } finally { setViewport(original); }
  };

  const commitRun = async (id: string) => {
    try {
      const c = await api.gitCommitRun(id);
      setChat((cs) => cs.map((it) => (it.kind === 'done' && it.runId === id ? { ...it, commit: c } : it)));
      flash(`Committed ${c.hash}`);
      refreshGit();
    } catch (e) { flash(errText(e)); }
  };

  // Pull request title/description drafted from this chat.
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
  const newChat = () => { if (!runId) { setChat([]); setSession(null); setChatId(null); setDesignAtStart(null); } };

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
    setInstruction((t) => (t.trim() ? t : 'Fix the problems listed in the runtime diagnostics (console errors / failed requests).'));
    setTimeout(() => composerRef.current?.focus(), 50);
  };

  // ---------- agent events ----------
  // Token deltas arrive fast; batch them into one state update per frame.
  const deltaBuf = useRef<{ kind: 'text' | 'thinking'; text: string }[]>([]);
  const deltaRaf = useRef(0);
  const flushDeltas = useCallback(() => {
    deltaRaf.current = 0;
    const buf = deltaBuf.current;
    deltaBuf.current = [];
    if (!buf.length) return;
    setChat((c) => {
      const next = [...c];
      for (const d of buf) {
        const last = next[next.length - 1];
        if (last && last.kind === d.kind && last.streaming) next[next.length - 1] = { ...last, text: last.text + d.text };
        else next.push({ kind: d.kind, id: uid(), text: d.text, streaming: true });
      }
      return next;
    });
  }, []);
  // A complete block replaces the streamed draft of the same kind (or is added).
  const finalizeBlock = (kind: 'text' | 'thinking', text: string, extra: ChatItem[] = []) => {
    if (deltaRaf.current) { cancelAnimationFrame(deltaRaf.current); flushDeltas(); }
    setChat((c) => {
      let i = -1;
      for (let j = c.length - 1; j >= 0; j--) { const it = c[j]; if (it.kind === kind && it.streaming) { i = j; break; } }
      const done: ChatItem[] = text ? [{ kind, id: i >= 0 ? c[i].id : uid(), text }] : [];
      if (i >= 0) return [...c.slice(0, i), ...done, ...c.slice(i + 1), ...extra];
      return [...c, ...done, ...extra];
    });
  };

  useEffect(() => api.onAgentEvent((e: AgentEvent) => {
    if (e.runId !== runRef.current) return;
    const push = (item: ChatItem) => setChat((c) => {
      const last = c[c.length - 1];
      if (item.kind === 'error' && last?.kind === 'error' && last.text === item.text) return c; // same error twice
      return [...c, item];
    });
    switch (e.type) {
      case 'text_delta':
      case 'thinking_delta':
        deltaBuf.current.push({ kind: e.type === 'text_delta' ? 'text' : 'thinking', text: e.text });
        if (!deltaRaf.current) deltaRaf.current = requestAnimationFrame(flushDeltas);
        break;
      case 'status': push({ kind: 'status', id: uid(), text: e.text }); break;
      case 'session': setSession({ id: e.sessionId, agent: (settingsRef.current?.agent || 'claude') }); break;
      case 'git': refreshGitRef.current(); break;
      case 'text': {
        // The agent proposes memories with a trailing "REMEMBER: …" line.
        const m = e.text.match(/^\s*`?REMEMBER:\s*(.+?)`?\s*$/m);
        const text = m ? e.text.replace(m[0], '').trim() : e.text;
        finalizeBlock('text', text, m ? [{ kind: 'memory', id: uid(), text: m[1].trim(), status: 'pending' }] : []);
        break;
      }
      case 'thinking': finalizeBlock('thinking', e.text); break;
      case 'tool': push({ kind: 'tool', id: uid(), toolId: e.id, name: e.name, detail: e.detail, status: 'running' }); break;
      case 'tool_result':
        setChat((c) => c.map((it) => (it.kind === 'tool' && it.toolId === e.id ? { ...it, status: e.ok ? 'ok' : 'error', output: e.text || it.output } : it)));
        break;
      case 'log': setAgentLog((l) => (l + e.text + '\n').slice(-200_000)); break;
      case 'error': push({ kind: 'error', id: uid(), text: e.text }); break;
      case 'done':
        if (deltaRaf.current) { cancelAnimationFrame(deltaRaf.current); flushDeltas(); }
        setChat((c) => [
          ...c.map((it) => (it.kind === 'tool' && it.status === 'running' ? { ...it, status: 'ok' as const }
            : (it.kind === 'text' || it.kind === 'thinking') && it.streaming ? { ...it, streaming: false } : it)),
          { kind: 'done', id: uid(), runId: e.runId, ok: e.ok, cost: e.cost, durationMs: e.durationMs, changes: e.changes || [], commit: e.commit || null },
        ]);
        setRunId(null);
        runRef.current = null;
        // Static files have no hot reload, so refresh them ourselves.
        if (e.changes?.length && /^file:/.test(navRef.current.url)) browser.current?.reload();
        refreshGitRef.current();
        if (e.changes?.length) {
          captureAfterRef.current(e.runId);
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

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat]);

  // ---------- dev server ----------
  useEffect(() => api.onDevEvent((e) => {
    if (e.type === 'log') setDevLog((l) => (l + e.text).slice(-200_000));
    else if (e.type === 'started') { setDevRunning(true); setDevLog(''); }
    else if (e.type === 'exit') { setDevRunning(false); setDevLog((l) => l + `\n[process exited with code ${e.code}]\n`); }
    else if (e.type === 'url') {
      const cur = navRef.current.url;
      if (!cur || cur === 'about:blank' || /^chrome-error:/.test(cur) || loadErrorRef.current) {
        setTimeout(() => go(e.url), 400);
      }
    }
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const loadErrorRef = useRef(loadError);
  loadErrorRef.current = loadError;

  const startDev = async (cmd: string) => {
    try { await api.startDev(cmd); saveSettings({ devCommand: cmd }); }
    catch (e) { flash((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  };

  const pickProject = async () => {
    const dir = await api.pickFolder();
    if (dir) { setSettings(await api.getSettings()); setSession(null); flash(`Project: ${dir}`); }
  };

  // ---------- layout ----------
  const startResize = (which: 'panel' | 'drawer') => (e: React.PointerEvent) => {
    e.preventDefault();
    // Capture the pointer so moves over the <webview> (a separate process) still reach us.
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setResizing(which);
    let last = 0;
    const move = (ev: PointerEvent) => {
      if (which === 'panel') {
        const w = settingsRef.current?.panelSide === 'left' ? ev.clientX : window.innerWidth - ev.clientX;
        last = Math.round(Math.min(Math.max(300, w), Math.min(820, window.innerWidth - 480)));
        setPanelWidth(last);
      } else {
        last = Math.round(Math.min(Math.max(120, window.innerHeight - ev.clientY), window.innerHeight * 0.65));
        setDrawerHeight(last);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setResizing(null);
      if (last) saveSettings(which === 'panel' ? { panelWidth: last } : { drawerHeight: last });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const togglePanel = () => saveSettings({ panelHidden: !settingsRef.current?.panelHidden });

  // ---------- keyboard ----------
  const handleKey = useCallback((key: string, e?: KeyboardEvent) => {
    const m = modeRef.current;
    if (key === 'Escape') { setPopover(null); if (m !== 'browse') setMode('browse'); return; }
    const k = key.toLowerCase();
    if (k === 'v') setMode('browse');
    else if (k === 's') setMode('select');
    else if (k === 'd') setMode('draw');
    else if (k === 'k') setMode('sketch');
    else if ((m === 'draw' || m === 'sketch') && TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
    else return;
    e?.preventDefault();
  }, [setMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable;
      const m = modeRef.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { togglePanel(); e.preventDefault(); return; }
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

  // ---------- annotations ----------
  const updateNote = (id: string, note: string) => setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, note } : a)));
  const removeAnn = (id: string) => { setAnnotations((prev) => prev.filter((a) => a.id !== id)); if (popover?.id === id) setPopover(null); };
  const focusAnn = (a: Annotation) => {
    setActiveId(a.id);
    if (a.kind === 'element' && a.element) browser.current?.send('scrollTo', a.element.uid);
  };

  const agentReady = settings && agents ? agents[settings.agent]?.ok : true;
  const vpWidth = VIEWPORTS[viewport].w;
  const drawShapes = mode === 'sketch' ? sketch : page;
  const pendingMarks = page.shapes.length + sketch.shapes.length;
  const canSend = !busy && !!(instruction.trim() || annotations.length || pendingMarks);
  const popAnn = popover && annotations.find((a) => a.id === popover.id);
  const root = settings?.projectDir || '';

  const popoverStyle = useMemo(() => {
    if (!popover || !frame.current) return {};
    const fw = frame.current.clientWidth, fh = frame.current.clientHeight;
    const w = 300;
    const below = popover.rect.y + popover.rect.height + 10;
    const top = below + 130 < fh ? below : Math.max(8, popover.rect.y - 140);
    return { left: Math.min(Math.max(8, popover.rect.x), fw - w - 8), top, width: w };
  }, [popover]);

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
  const PanelIcon = left ? PanelLeft : PanelRight;

  return (
    <div className={`app ${resizing ? 'resizing' : ''}`} style={gridStyle}>
      {/* ---------- top bar ---------- */}
      <header className="topbar">
        <div className="brand" title="Pinpoint"><Logo size={24} /></div>

        <button className="project-btn" onClick={pickProject} title={settings.projectDir || 'Choose the project folder the agent edits'}>
          <FolderOpen size={14} />
          <span>{settings.projectDir ? settings.projectDir.split(/[\\/]/).pop() : 'Open project'}</span>
        </button>

        <div className="tb-div" />

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
          <div className="vp-toggles">
            {(Object.keys(VIEWPORTS) as Viewport[]).map((v) => {
              const V = VIEWPORTS[v];
              return <button type="button" key={v} className={viewport === v ? 'on' : ''} onClick={() => setViewport(v)} title={V.label}><V.icon size={14} /></button>;
            })}
          </div>
        </form>

        <div className="tb-div" />

        <div className="seg mode-seg">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? 'on' : ''} onClick={() => setMode(m.id)} title={`${m.hint} (${m.key})`}>
              <m.icon size={15} /><span>{m.label}</span><kbd>{m.key}</kbd>
            </button>
          ))}
        </div>

        <div className="tb-div" />

        <div className="top-right">
          <button className={`icon-btn ${drawerOpen ? 'on' : ''}`} onClick={() => setDrawerOpen(!drawerOpen)} title="Dev server & logs">
            <TerminalSquare size={16} />{devRunning && <span className="live-dot abs" />}
          </button>
          <button className={`icon-btn ${sheet ? 'on' : ''}`} onClick={() => setSheet(sheet ? null : 'design')} title="Design rules & memory" disabled={!projectDir}>
            <Palette size={16} />{(design?.exists || memory.length > 0) && <span className="ctx-dot" />}
          </button>
          <button className="icon-btn" onClick={() => browser.current?.devtools()} title="Page DevTools"><Bug size={16} /></button>
          <button className={`icon-btn ${settings.panelHidden ? '' : 'on'}`} onClick={togglePanel} title={`Toggle sidebar (${MOD}+B)`}><PanelIcon size={16} /></button>
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} title="Settings"><SettingsIcon size={16} /></button>
        </div>
      </header>

      {/* ---------- browser ---------- */}
      <main className="stage">
        <div className={`frame-wrap ${vpWidth ? 'device' : ''}`}>
          <div ref={frame} className={`frame mode-${mode}`} style={vpWidth ? { width: vpWidth } : undefined}>
            <BrowserView
              ref={browser}
              initialUrl={settings.url ? normalizeUrl(settings.url) : ''}
              onPicked={onPicked}
              onNavigate={(s) => { setNav(s); if (document.activeElement?.closest('.urlbar') == null) setUrlInput(s.url === 'about:blank' ? '' : s.url); }}
              onLoading={(l) => { loadingRef.current = l; setLoading(l); }}
              onReady={syncPage}
              onKey={(k) => handleKey(k)}
              onError={setLoadError}
              onConsole={onConsole}
              onPageChange={clearDiagnostics}
            />

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
                <div className="note-pop-foot">
                  <button className="btn ghost xs" onClick={() => removeAnn(popAnn.id)}><Trash2 size={12} /> Remove</button>
                  <span className="hint">Enter to save · {MOD}+Enter to send</span>
                </div>
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

            {mode === 'select' && !popover && <div className="mode-hint">Click any element to annotate it · ↑/↓ pick parent/child · Esc to exit</div>}

            {(!nav.url || nav.url === 'about:blank') && mode !== 'sketch' && (
              <Welcome
                projectDir={settings.projectDir}
                onOpenProject={pickProject}
                onStartDev={() => { setDrawerOpen(true); setDrawerTab('dev'); }}
                onSketch={() => setMode('sketch')}
              />
            )}
            {loadError && nav.url !== 'about:blank' && (
              <div className="load-error">
                <b>Couldn't load the page</b><span>{loadError}</span>
                <div>
                  <button className="btn xs" onClick={() => browser.current?.reload()}>Retry</button>
                  <button className="btn xs ghost" onClick={() => { setDrawerOpen(true); setDrawerTab('dev'); }}>Start dev server</button>
                </div>
              </div>
            )}
            {busy && <div className="busy"><Loader2 size={14} className="spin" /> {busy}</div>}
          </div>
        </div>
      </main>

      {/* ---------- side panel ---------- */}
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
              <button key={a} className={settings.agent === a ? 'on' : ''} onClick={() => saveSettings({ agent: a })} disabled={!!runId}>
                <span className={`status-dot ${agents ? (agents[a]?.ok ? 'ok' : 'bad') : ''}`} />
                {a === 'claude' ? 'Claude Code' : 'Codex'}
              </button>
            ))}
          </div>
          <div className="spacer" />
          {projectDir && <ChatHistory currentId={chatId} disabled={!!runId} onOpen={openChat} onDelete={deleteChat} />}
          <button className="btn ghost xs" onClick={newChat} disabled={!!runId || !chat.length} title={session ? 'Continuing the same agent session. Click to start fresh.' : 'Start a fresh agent session'}><Plus size={13} /><span className="btn-text">New chat</span></button>
        </div>

        <div className="chat">
          {chat.length === 0 ? (
            <div className="chat-empty">
              <h3>How it works</h3>
              <ol>
                <li><MousePointerClick size={15} /><div><b>Select</b> <kbd>S</kbd><span>Click elements and write what should change. Pinpoint sends the element, its styles, a screenshot and the source file it came from.</span></div></li>
                <li><PenTool size={15} /><div><b>Draw</b> <kbd>D</kbd><span>Circle, arrow, cross out or scribble notes right on the page.</span></div></li>
                <li><SquarePen size={15} /><div><b>Sketch</b> <kbd>K</kbd><span>Draw a wireframe of something new on a blank board.</span></div></li>
                <li><Send size={15} /><div><b>Send</b> <kbd>↵</kbd><span>{settings.agent === 'claude' ? 'Claude Code' : 'Codex'} edits your project. Hot reload shows the result.</span></div></li>
              </ol>
              {agents && !agentReady && (
                <div className="warn-box">{settings.agent === 'claude' ? 'Claude Code' : 'Codex'} CLI wasn't found. Install it or set its path in Settings.</div>
              )}
            </div>
          ) : chat.map((item) => <ChatItemView key={item.id} item={item} root={root} onReload={() => browser.current?.reload()} onUndo={undoRun} onReview={(runId, path) => setDiffView({ runId, path })} onMemory={onMemoryAction} onRevertFile={revertFile} onOpenFile={openFile} onCommit={commitRun} onCompare={setCompare} gitRepo={!!gitStatus?.repo} busy={!!runId} />)}
          {runId && <div className="working"><Loader2 size={14} className="spin" /> {settings.agent === 'claude' ? 'Claude Code' : 'Codex'} is working…</div>}
          <div ref={chatEnd} />
        </div>

        <div className="composer">
          {projectDir && (
            <ContextBar
              lead={<GitPanel status={gitStatus} refresh={refreshGit} settings={settings} saveSettings={saveSettings} busy={!!runId} prDefaults={prDefaults} flash={flash} />}
              designOn={settings.useDesign} designExists={!!design?.exists} designChanged={designChanged}
              memoryCount={settings.useMemory ? memory.filter((m) => m.enabled).length : 0}
              route={currentRoute}
              console={consoleLog} network={netFails}
              includeDiag={includeDiag} setIncludeDiag={setIncludeDiag}
              onOpenDesign={() => setSheet('design')} onOpenMemory={() => setSheet('memory')}
              onClearDiag={clearDiagnostics} onAskFix={askToFix}
            />
          )}
          {(annotations.length > 0 || pendingMarks > 0) && (
            <div className="ann-list">
              {annotations.map((a) => {
                const d = describe(a, root);
                return (
                  <div key={a.id} className={`ann ${activeId === a.id ? 'active' : ''}`} onClick={() => focusAnn(a)}>
                    <div className="ann-thumb">
                      {a.image ? <img src={a.image} alt="" /> : <Square size={16} />}
                      <span className="badge" style={{ background: a.color }}>{a.n}</span>
                    </div>
                    <div className="ann-body">
                      <div className="ann-title"><span className="mono">{d.title}</span><span className="ann-sub">{d.sub}</span></div>
                      <textarea
                        data-note={a.id}
                        rows={1}
                        placeholder={a.kind === 'element' ? 'What should change here?' : a.kind === 'sketch' ? 'What is this sketch? Where should it go?' : a.kind === 'reference' ? 'What should we take from this image?' : 'Explain your drawing…'}
                        onPaste={onPaste}
                        value={a.note}
                        onFocus={() => setActiveId(a.id)}
                        onChange={(e) => updateNote(a.id, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
                      />
                    </div>
                    <button className="icon-btn xs ann-x" onClick={(e) => { e.stopPropagation(); removeAnn(a.id); }} title="Remove"><X size={13} /></button>
                  </div>
                );
              })}
              {pendingMarks > 0 && (
                <div className="ann pending">
                  <PenTool size={14} /> {page.shapes.length ? `${page.shapes.length} mark${page.shapes.length > 1 ? 's' : ''} on page` : ''}
                  {page.shapes.length && sketch.shapes.length ? ' · ' : ''}
                  {sketch.shapes.length ? `${sketch.shapes.length} in sketch` : ''} will be attached
                </div>
              )}
            </div>
          )}

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
              <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) addReferences(e.target.files); e.target.value = ''; }} />
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
                <button className="btn primary sm send-btn" disabled={!canSend} onClick={() => send()} title="Send (Enter)"><Send size={13} /><span className="btn-text">Send</span></button>
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
          devRunning={devRunning} devCommand={settings.devCommand}
          onStartDev={startDev} onStopDev={() => api.stopDev()} onClose={() => setDrawerOpen(false)}
        />
        </div>
      )}
      {/* The webview swallows pointer events; a shield keeps splitter drags smooth. */}
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
      {compare && <CompareView runId={compare} onClose={() => setCompare(null)} captureSizes={captureSizes} />}
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
