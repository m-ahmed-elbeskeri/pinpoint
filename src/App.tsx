import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, Bug, Check, FolderOpen, Globe, Loader2, Monitor, MousePointer2, MousePointerClick,
  PenTool, Plus, RotateCw, Send, Settings as SettingsIcon, Smartphone, Square, SquarePen, Tablet,
  TerminalSquare, Trash2, X, PanelLeft, PanelRight, Paperclip, Palette, ImagePlus, Zap, CornerDownRight,
  AppWindow, Blend, Boxes, Brain, CircleDot, ClipboardCopy, Columns3, Download, Snowflake, SquareStack,
} from 'lucide-react';
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
import { CompareView, diffOverlay, type CompareTarget } from './components/CompareView';
import { ElementTools, type ToolSection } from './components/ElementTools';
import { ConditionsMenu, HandoffMenu, MAX_VARIANTS, NO_CONDITIONS, PinsChip, VariantsMenu, describeConditions, type Conditions } from './components/PageTools';
import { MultiView } from './components/MultiView';
import { BackgroundRuns, ComponentsPanel, EnginesView, ProfileMenu } from './components/Workbench';
import { MockupOverlay, fitMockup, type Overlay } from './components/MockupOverlay';
import { DeviceBar, DEVICE_OFF, type Breakpoint, type Device } from './components/DeviceBar';
import { ANNOTATION_COLORS, composite, samplePoints, thumbnail, uid, unionBounds } from './lib/draw';
import type {
  OtherChat,
  A11yIssue, AgentEvent, AgentId, Annotation, BgRun, ChatItem, Profile, UpdateState, ConsoleEntry, DesignDoc, DesignSystem, DevDetection, FlowStep, ForcedState, Handoff, MemoryItem, Mode, ModelCatalog, NetworkFailure,
  GitStatus, PageEnv, Rect, RevertResult, RouteInfo, Settings, Shape, SourceInfo, Tool,
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
  url: string; title: string; viewport: { width: number; height: number; responsive?: boolean };
  breakpoints?: Breakpoint[];
  instruction: string; overview?: string;
  annotations: Omit<Annotation, 'id' | 'color'>[];
  diagnostics?: { console: ConsoleEntry[]; network: NetworkFailure[]; devLog: string; a11y?: A11yIssue[] };
  route?: { path: string; file: string; framework: string };
  env?: PageEnv & { frozen: boolean; states?: string[]; profile?: { name: string; detail: string } };
  variant?: { index: number; total: number };
  verify?: { before?: string; after: string; same?: boolean };
  note?: string; // something Pinpoint did that the agent should know (e.g. which variant was picked)
}

// What kind of run an id is: a normal request, one of several variants, or the automatic check.
// frame: what the "before" screenshot was aimed at, so the "after" one shows the same place.
interface RunMeta { variant?: { index: number; total: number }; verify?: boolean; startedAt?: number; frame?: { targets: FrameTarget[]; y: number } }

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

type Delta = { kind: 'text' | 'thinking'; text: string };
// Streamed tokens are appended to the draft block of the same kind, or start one.
function mergeDeltas(items: ChatItem[], buf: Delta[]): ChatItem[] {
  if (!buf.length) return items;
  const next = [...items];
  for (const d of buf) {
    const last = next[next.length - 1];
    if (last && last.kind === d.kind && last.streaming) next[next.length - 1] = { ...last, text: last.text + d.text };
    else next.push({ kind: d.kind, id: uid(), text: d.text, streaming: true });
  }
  return next;
}
// A complete block replaces the streamed draft of the same kind (or is added).
function finalizeItems(c: ChatItem[], kind: 'text' | 'thinking', text: string, extra: ChatItem[] = []): ChatItem[] {
  let i = -1;
  for (let j = c.length - 1; j >= 0; j--) { const it = c[j]; if (it.kind === kind && it.streaming) { i = j; break; } }
  const done: ChatItem[] = text ? [{ kind, id: i >= 0 ? c[i].id : uid(), text }] : [];
  if (i >= 0) return [...c.slice(0, i), ...done, ...c.slice(i + 1), ...extra];
  return [...c, ...done, ...extra];
}
// The agent proposes memories with a trailing "REMEMBER: …" line.
function splitMemory(text: string): { text: string; extra: ChatItem[] } {
  const m = text.match(/^\s*`?REMEMBER:\s*(.+?)`?\s*$/m);
  return m ? { text: text.replace(m[0], '').trim(), extra: [{ kind: 'memory', id: uid(), text: m[1].trim(), status: 'pending' }] } : { text, extra: [] };
}
function chatTitle(items: ChatItem[]) {
  const first = items.find((c) => c.kind === 'user') as Extract<ChatItem, { kind: 'user' }> | undefined;
  return (first?.text || first?.annotations.map((a) => a.note).find(Boolean) || `${first?.annotations.length || 0} annotation(s)`).slice(0, 80);
}
// A chat that isn't on screen but is still alive: its agent is working, and its messages keep arriving.
interface ParkedChat {
  id: string; createdAt: number; items: ChatItem[]; session: { id: string; agent: AgentId } | null;
  designAtStart: string | null; runId: string | null; agent: AgentId;
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

// Quick sizes in the URL bar; responsive mode's own bar has the rest.
const QUICK_SIZES = [
  { icon: Monitor, label: 'Fill the window', w: 0, h: 0 },
  { icon: Tablet, label: 'Tablet 820 × 1180 (responsive mode)', w: 820, h: 1180 },
  { icon: Smartphone, label: 'Phone 390 × 844 (responsive mode)', w: 390, h: 844 },
];

const describe = (a: Annotation, root: string) => {
  if (a.kind === 'element' && a.element) {
    const el = a.element;
    const cls = el.classes?.filter((c) => c.length < 24).slice(0, 2).join('.') || '';
    const extras = [a.reorder ? `moved to ${a.reorder.to + 1}` : '', ...(a.states || []).map((s) => (s === 'disabled' ? s : ':' + s)), a.tweaks ? `${Object.keys(a.tweaks).length} tweak${Object.keys(a.tweaks).length > 1 ? 's' : ''}` : ''].filter(Boolean);
    return {
      title: `<${el.tag}${el.id ? '#' + el.id : ''}${cls ? '.' + cls : ''}>`,
      sub: (el.source?.file ? shortPath(el.source.file, root) + (el.source.line ? `:${el.source.line}` : '')
        : el.source?.components?.length ? el.source.components.slice(-2).join(' › ') : el.text || el.selector) + (extras.length ? ` · ${extras.join(' · ')}` : ''),
    };
  }
  if (a.kind === 'drawing') return { title: 'Drawing on page', sub: a.hits?.length ? `over ${a.hits.length} element${a.hits.length > 1 ? 's' : ''}` : 'markup' };
  if (a.kind === 'reference') return { title: 'Reference image', sub: a.name || 'image' };
  if (a.kind === 'flow') return { title: 'Recorded interaction', sub: `${a.steps?.length || 0} step${a.steps?.length === 1 ? '' : 's'}` };
  return { title: 'Sketch', sub: 'wireframe' };
};

// A recorded interaction as a Playwright test.
function toPlaywright(a: Annotation) {
  const q = (s: string) => JSON.stringify(s);
  const lines = ["import { test } from '@playwright/test';", '', `test(${q(a.note.trim() || 'recorded interaction')}, async ({ page }) => {`];
  if (a.startUrl) lines.push(`  await page.goto(${q(a.startUrl)});`);
  for (const s of a.steps || []) {
    const loc = `page.locator(${q(s.selector || '')})`;
    if (s.type === 'click') lines.push(`  await ${loc}.click();${s.text ? ` // ${s.text}` : ''}`);
    else if (s.type === 'fill') lines.push(`  await ${loc}.fill(${s.secret ? "process.env.TEST_PASSWORD ?? ''" : q(s.value || '')});`);
    else if (s.type === 'check') lines.push(`  await ${loc}.setChecked(${s.value === 'true'});`);
    else if (s.type === 'key') lines.push(`  await page.keyboard.press(${q(s.key || '')});`);
    else if (s.type === 'navigate') lines.push(`  await page.waitForURL(${q(s.url || '')});`);
  }
  lines.push('  // TODO: assert what should be true here', '});', '');
  return lines.join('\n');
}

// A request written out for a person: what an issue or ticket needs.
function handoffMarkdown(h: Handoff, root: string) {
  const out = ['## Request', '', h.instruction || '_(see the notes below)_', '', `- Page: ${h.url}${h.viewport ? ` (${h.viewport.width}×${h.viewport.height})` : ''}`, ''];
  for (const a of h.annotations) {
    const d = describe(a, root);
    out.push(`### ${a.n}. ${d.title}${a.note.trim() ? `: ${a.note.trim()}` : ''}`);
    const el = a.element;
    if (el) {
      out.push(`- Selector: \`${el.selector}\``);
      if (el.source?.file) out.push(`- Source: \`${shortPath(el.source.file, root)}${el.source.line ? `:${el.source.line}` : ''}\``);
      if (el.component?.name) out.push(`- Component: \`<${el.component.name}>\`${a.scope ? ` (${a.scope === 'instance' ? 'this instance only' : 'all uses'})` : ''}`);
      if (a.states?.length) out.push(`- State: ${a.states.join(', ')}`);
      for (const [k, v] of Object.entries(a.tweaks || {})) out.push(`- \`${k}\`: ${el.styles?.[k] ? `${el.styles[k]} → ` : ''}${v}`);
      if (a.textEdit) out.push(`- Text: "${a.textEdit.from}" → "${a.textEdit.to}"`);
      if (a.classEdit) out.push(`- Classes: \`${a.classEdit.from}\` → \`${a.classEdit.to}\``);
    }
    (a.steps || []).forEach((s, i) => out.push(`${i + 1}. ${s.type}${s.selector ? ` \`${s.selector}\`` : ''}${s.text ? ` "${s.text}"` : ''}${s.value && !s.secret ? ` = ${s.value}` : ''}${s.key || s.url ? ` ${s.key || s.url}` : ''}`));
    if (a.image) out.push('- _Screenshot in the hand-off file_');
    out.push('');
  }
  out.push('---', 'Made with [Pinpoint](https://github.com/m-ahmed-elbeskeri/pinpoint). Open the hand-off file in Pinpoint (share menu → Open hand-off file) to run this request with its screenshots.');
  return out.join('\n');
}

// One page open in Pinpoint's browser.
interface Tab { id: string; url: string; title: string; canBack: boolean; canForward: boolean; loading: boolean; error: string | null; initialUrl: string; profile: string }
const makeTab = (url: string, profile = ''): Tab => ({ id: uid(), url: '', title: '', canBack: false, canForward: false, loading: false, error: null, initialUrl: url, profile });
// A "view as" profile is a separate browser storage partition.
const partitionOf = (profile: string) => (profile ? `persist:pinpoint-${profile}` : 'persist:pinpoint');
// "key=value" / "Name: value" lines from a profile's settings.
const pairs = (text: string | undefined, sep: string): [string, string][] => (text || '').split('\n').map((l) => l.trim()).filter((l) => l && l.includes(sep))
  .map((l) => [l.slice(0, l.indexOf(sep)).trim(), l.slice(l.indexOf(sep) + 1).trim()] as [string, string]).filter(([k]) => k);
const tabLabel = (t: Tab) => {
  if (t.title && t.title !== 'about:blank' && !/^https?:\/\//.test(t.title)) return t.title;
  const u = t.url || t.initialUrl;
  if (!u || u === 'about:blank') return 'New tab';
  try { const x = new URL(u); return x.protocol === 'file:' ? decodeURIComponent(x.pathname.split('/').pop() || u) : x.host + (x.pathname === '/' ? '' : x.pathname); } catch { return u; }
};

// ---------- app ----------
export default function App() {
  const browser = useRef<BrowserHandle | null>(null); // the active tab's page
  const handles = useRef<Record<string, BrowserHandle | null>>({});
  const frame = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [agents, setAgents] = useState<Record<AgentId, { ok: boolean; version?: string }> | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [urlInput, setUrlInput] = useState('');
  // Browser tabs. Everything below that talks about "the page" means the active one.
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
  const [avail, setAvail] = useState({ w: 0, h: 0 }); // room for the page inside the stage
  const dragging = useRef(false);                     // a panel divider is being dragged
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>([]);
  const area = useRef<HTMLDivElement>(null);
  const deviceRef = useRef(device);
  deviceRef.current = device;

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Live sizes while dragging a splitter; persisted to settings on release.
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [drawerHeight, setDrawerHeight] = useState<number | null>(null);
  const [resizing, setResizing] = useState<'panel' | 'drawer' | 'device' | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('term');
  const [devLog, setDevLog] = useState('');
  const [agentLog, setAgentLog] = useState('');
  const [devRunning, setDevRunning] = useState(false);
  const [devInfo, setDevInfo] = useState<DevDetection | null>(null);
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
  const [compare, setCompare] = useState<CompareTarget | null>(null); // what the before/after view is showing
  // Page state: emulated media features, a frozen page, a mockup laid over it.
  const [env, setEnv] = useState<PageEnv>({ colorScheme: null, reducedMotion: false });
  const [frozen, setFrozenState] = useState(false);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [toolSection, setToolSection] = useState<ToolSection | null>(null);
  const [classNames, setClassNames] = useState<string[]>([]);
  const [generated, setGenerated] = useState<string[]>([]);       // classes Pinpoint generated CSS for (new Tailwind utilities)
  const twTimer = useRef<ReturnType<typeof setTimeout>>();
  const [isolated, setIsolated] = useState<string | null>(null);  // annotation shown on its own
  const [cond, setCond] = useState<Conditions>(NO_CONDITIONS);     // stress tests, data states, animation speed
  const [multi, setMulti] = useState(false);                       // phone / tablet / desktop side by side
  const [rec, setRec] = useState<{ steps: FlowStep[]; startUrl: string } | null>(null);
  const recRef = useRef(rec);
  recRef.current = rec;
  const condRef = useRef(cond);
  condRef.current = cond;
  const runFlowRef = useRef<Record<string, { steps: FlowStep[]; startUrl: string }>>({}); // runId -> interaction to replay before checking
  const [designSystem, setDesignSystem] = useState<DesignSystem | null>(null);
  const [a11y, setA11y] = useState<A11yIssue[]>([]);
  const [includeA11y, setIncludeA11y] = useState(false);
  const [job, setJob] = useState<string | null>(null);         // label shown between the runs of a variants job
  const [profiles, setProfiles] = useState<Profile[]>([]);     // "view as" profiles of this project
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const viewAs = profiles.find((p) => p.id === tab?.profile); // who the active tab is being viewed as
  const profileApplied = useRef<Record<string, string>>({});   // page -> the profile settings it was loaded with
  const [plan, setPlan] = useState<{ ok: boolean; summary?: string[]; reason?: string } | null>(null); // can the open note be applied without the agent
  const [wsOpen, setWsOpen] = useState(false);                 // component workspace
  const [enginesOpen, setEnginesOpen] = useState(false);       // other browser engines
  const [bgRuns, setBgRuns] = useState<BgRun[]>([]);
  const [bgBlocked, setBgBlocked] = useState<string | null>(null);
  const [patchView, setPatchView] = useState<{ title: string; text: string } | null>(null);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const runMetaRef = useRef<Record<string, RunMeta>>({});
  const beforeShotRef = useRef<{ id: string; shot: string } | null>(null); // the current run's "before" screenshot
  const variantJob = useRef<{ base: AgentRequest; total: number; index: number; done: { runId: string; index: number; files: number }[] } | null>(null);
  const verifyPending = useRef<string | null>(null);           // run waiting for its automatic check
  const pendingNote = useRef<string | null>(null);
  const axeRef = useRef<string | null>(null);
  const runPageRef = useRef<Record<string, string>>({});       // runId -> page URL when it started
  const loadingRef = useRef(false);
  loadingRef.current = loading;
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
  const envRef = useRef(env);
  envRef.current = env;
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;
  const consoleRef = useRef(consoleLog);
  consoleRef.current = consoleLog;
  const netRef = useRef(netFails);
  netRef.current = netFails;

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500); };

  // ---------- boot ----------
  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setUrlInput(s.projectDir ? s.url : '');
      // Reopen the tabs the project had (or its last page).
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

  // ---------- project context ----------
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
      const title = chatTitle(chat);
      api.saveChat({ id: chatId, title, createdAt: chatCreated || Date.now(), updatedAt: Date.now(), agent: settingsRef.current?.agent || 'claude', session, designAtStart, items: chat }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [chat, session, chatId, projectDir, designAtStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- several chats at once ----------
  // Leaving a chat doesn't stop it. A chat whose agent is still working is parked here:
  // its messages keep being collected, and it is put back on screen as it is when reopened.
  const parked = useRef(new Map<string, ParkedChat>());
  const [others, setOthers] = useState<OtherChat[]>([]); // chats working, or finished and not looked at yet
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

  // Puts the chat on screen away. False when it can't be left right now.
  const leaveChat = () => {
    if (job || variantJob.current) { flash('Variants are being made in this chat. Wait for them before switching.'); return false; }
    if (queuedRef.current.length) { flash('A message is waiting to be sent in this chat. Switch once it has gone out.'); return false; }
    if (deltaRaf.current) { cancelAnimationFrame(deltaRaf.current); deltaRaf.current = 0; }
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
    stick.current = true;
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

  // What an agent event does to a chat that isn't on screen.
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

  // ---------- page state ----------
  // Emulated media (and focus, while frozen) are re-applied when they change and on every new page.
  const applyEnv = useCallback(async (e: PageEnv, isFrozen: boolean) => {
    const id = browser.current?.id();
    if (id == null) return;
    browser.current?.send('scheme', e.colorScheme); // sites that switch theme with a class or attribute
    // Touch input replaces the mouse, which picking and drawing need, so it is only on while browsing.
    const touch = deviceRef.current.on && deviceRef.current.touch && modeRef.current === 'browse';
    try { await api.emulate(id, { ...e, focus: isFrozen, touch }); } catch (err) { flash(errText(err)); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { applyEnv(env, frozen); }, [env, frozen, applyEnv, device.on, device.touch, mode]);

  // The page froze or unfroze: hold :hover on whatever was under the pointer, or let it go.
  const onFrozen = useCallback(async (on: boolean) => {
    setFrozenState(on);
    const b = browser.current;
    const id = b?.id();
    if (!b || id == null) return;
    try {
      await api.forceState(id, '[data-pinpoint-hover]', on ? ['hover'] : []);
      // Animations stop with the page, and pick up at the speed that was set.
      await api.setAnimationRate(id, on ? 0 : condRef.current.anim);
    } catch (err) { flash(errText(err)); }
    if (!on) b.send('thaw');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setFrozen = useCallback((on: boolean) => { browser.current?.send('freeze', on); onFrozen(on); }, [onFrozen]);

  // Accessibility audit of the open page (axe-core), refreshed when the page settles.
  const runA11y = useCallback(async () => {
    if (settingsRef.current?.a11yCheck === false || !/^(https?|file):/.test(navRef.current.url)) { setA11y([]); return; }
    try {
      axeRef.current ??= await api.a11ySource();
      const res = await browser.current?.a11y(axeRef.current);
      if (res) setA11y(res);
    } catch { /* the page navigated mid-audit */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => {
      browser.current?.breakpoints().then(setBreakpoints);
      browser.current?.classNames().then(setClassNames);
      // Client-rendered content arrives after load, so stress tests are applied again once it has.
      if (condRef.current.stress.length) browser.current?.send('stress', condRef.current.stress);
    }, 1500);
    // The heavier checks wait until the page has been open a moment, so clicking through
    // pages isn't slowed by an audit and background screenshots of each one.
    const audit = setTimeout(runA11y, 2500);
    const warmup = setTimeout(() => {
      // Baseline screenshots for the unintended-change check, taken now so a run doesn't wait for them.
      const warm = otherRoutes(navRef.current.url);
      if (warm?.routes.length && !runRef.current) api.prewarmRoutes(warm.routes, warm.partition).catch(() => {});
    }, 5000);
    return () => { clearTimeout(t); clearTimeout(audit); clearTimeout(warmup); };
  }, [nav.url, loading, settings?.a11yCheck, runA11y]);

  // ---------- test conditions ----------
  const changeConditions = async (next: Conditions) => {
    const prev = condRef.current;
    setCond(next);
    const b = browser.current;
    const id = b?.id();
    if (!b || id == null) return;
    try {
      if (next.stress.join() !== prev.stress.join()) b.send('stress', next.stress);
      if (next.anim !== prev.anim) await api.setAnimationRate(id, next.anim);
      if (next.network !== prev.network) { await api.setNetwork(id, next.network); b.reload(); } // data states show on the next load
    } catch (e) { flash(errText(e)); }
  };
  const stepAnimation = async () => {
    const id = browser.current?.id();
    if (id == null) return;
    try { await api.setAnimationRate(id, 1); await sleep(100); await api.setAnimationRate(id, 0); } catch (e) { flash(errText(e)); }
  };

  // ---------- interaction recording ----------
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
  // Start from the page the recording started on and do the steps again.
  const replayFlow = async (flow: { steps: FlowStep[]; startUrl: string }) => {
    const b = browser.current;
    if (!b) return;
    setMode('browse'); // select mode would swallow the replayed clicks
    if (navRef.current.url === flow.startUrl) b.reload(); else b.load(flow.startUrl);
    await sleep(600);
    for (let i = 0; i < 50 && loadingRef.current; i++) await sleep(200);
    await sleep(900);
    const id = b.id();
    if (id != null) await api.replay(id, flow.steps).catch(() => null);
    await sleep(500);
  };

  // ---------- hand-off ----------
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

  // ---------- responsive mode ----------
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      // While a divider is dragged the room changes every frame; it is read once when the drag ends
      // (unless a device size is on, where the page is rescaled to fit as you drag).
      if (dragging.current && !deviceRef.current.on) return;
      const w = Math.floor(e.contentRect.width), h = Math.floor(e.contentRect.height);
      setAvail((a) => (a.w === w && a.h === h ? a : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!settings]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dragging an edge of the page resizes it, like the handles in browser dev tools.
  const startDeviceResize = (axis: 'x' | 'y' | 'xy') => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as Element;
    el.setPointerCapture(e.pointerId);
    setResizing('device');
    const sx = e.clientX, sy = e.clientY, k = deviceScale;
    const w0 = device.w, h0 = device.h || Math.round(deviceH);
    const move = (ev: PointerEvent) => {
      // The page is centered, so its right edge moves half as fast as its width grows.
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
    applyEnv(envRef.current, frozenRef.current);
    browser.current?.send('layout', settingsRef.current?.layoutOverlay !== false);
    browser.current?.send('record', !!recRef.current);
    if (condRef.current.stress.length) browser.current?.send('stress', condRef.current.stress);
  }, [applyEnv]);

  // Numbered markers for element annotations, drawn inside the page they belong to.
  useEffect(() => {
    browser.current?.send('markers', markerList(annotations.filter((a) => !a.tabId || a.tabId === activeTab), activeId));
  }, [annotations, activeId, activeTab]);

  // ---------- tabs ----------
  const switchTab = (id: string) => {
    if (id === activeTabRef.current) return;
    // The tab being left goes back to plain browsing: no picking, no frozen page.
    browser.current?.send('mode', 'browse');
    if (frozenRef.current) setFrozen(false);
    if (isolated) isolate(null);
    setPopover(null);
    setMulti(false);
    setActiveTab(id);
  };
  const newTab = (url?: string) => {
    let start = url || '';
    if (!start) { try { const u = new URL(navRef.current.url); if (/^https?:$/.test(u.protocol)) start = u.origin + '/'; } catch { /* a blank tab */ } }
    const t = makeTab(start, tabsRef.current.find((x) => x.id === activeTabRef.current)?.profile || ''); // stays the same user
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
    setAnnotations((prev) => prev.filter((a) => a.tabId !== id)); // its pins pointed at elements that are gone
  };
  // ---------- "view as" profiles ----------
  // Language, time zone, headers and flags for a tab's page. They only take
  // effect on a fresh load, so the page is reloaded once when they change.
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
    setAnnotations((prev) => prev.filter((a) => a.tabId !== id)); // the page is loaded again as someone else
    patchTab(id, { profile, initialUrl: t.url && t.url !== 'about:blank' ? t.url : t.initialUrl });
  };
  const saveProfiles = (list: Profile[]) => {
    setProfiles(list);
    profilesRef.current = list;
    api.writeProfiles(list).catch((e) => flash(errText(e)));
    for (const t of tabsRef.current) if (t.profile) applyTabProfile(t);
  };

  // ---------- instant edits ----------
  // Whether the open note's changes can go straight into the source, and why not when they can't.
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
  }, [editKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyInstant = async (id: string) => {
    const a = annRef.current.find((x) => x.id === id);
    if (!a) return;
    const { image: _i, ...bare } = a;
    const runId = uid();
    try {
      const res = await api.instantApply(runId, bare);
      // The source says it now; the live preview of the same thing comes off so the real result shows.
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

  // Dragging on the page: an edge resizes the selected element, its body moves it among its siblings.
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

  // ---------- background runs ----------
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

  // ---------- updates ----------
  useEffect(() => { api.updateState().then(setUpdate).catch(() => {}); return api.onUpdateState(setUpdate); }, []);

  // The newly shown tab gets the current mode, markers and page settings; page problems start over.
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
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps
  // Links that would open a window open a tab.
  useEffect(() => api.onNewTab((url) => newTab(url)), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Remember the open tabs with the project.
  const tabUrls = tabs.map((t) => (t.url && t.url !== 'about:blank' ? t.url : t.initialUrl)).join('\n');
  useEffect(() => {
    if (!projectDir || !tabs.length) return;
    const t = setTimeout(() => {
      const open = tabsRef.current.filter((t) => (t.url && t.url !== 'about:blank') || t.initialUrl);
      saveSettings({ tabs: tabUrls.split('\n').filter(Boolean), tabProfiles: open.map((t) => t.profile), activeTab: Math.max(0, tabsRef.current.findIndex((x) => x.id === activeTabRef.current)) });
    }, 800);
    return () => clearTimeout(t);
  }, [tabUrls, activeTab, projectDir]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextN = () => (annRef.current.length ? Math.max(...annRef.current.map((a) => a.n)) + 1 : 1);
  const colorFor = (n: number) => ANNOTATION_COLORS[(n - 1) % ANNOTATION_COLORS.length];

  // ---------- select mode: element picked in page ----------
  const onPicked = useCallback(async (el: PickedElement) => {
    const n = nextN();
    const vp = el.viewport;
    const pad = 20;
    const crop = clampRect({ x: el.rect.x - pad, y: el.rect.y - pad, width: el.rect.width + pad * 2, height: el.rect.height + pad * 2 }, vp);
    const { dpr: _d, viewport: _v, shift: _s, ...element } = el;
    const ann: Annotation = { id: uid(), n, kind: 'element', note: '', color: colorFor(n), element, viewport: vp, tabId: activeTabRef.current, pageUrl: navRef.current.url };
    // The note opens on the click; the screenshot of the element is attached as soon as it is taken.
    setAnnotations((prev) => [...prev, ann]);
    setActiveId(ann.id);
    setToolSection(null);
    setPopover({ id: ann.id, rect: el.rect });
    try {
      if (crop.width > 2 && crop.height > 2) {
        const image = await browser.current!.capture(crop);
        setAnnotations((prev) => prev.map((a) => (a.id === ann.id ? { ...a, image } : a)));
      }
    } catch { /* page may have navigated */ } finally { browser.current?.send('hide', false); }

    // Where it comes from, which design tokens it uses, and how widely its component is used.
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

  // ---------- element tools: live tweaks, forced states, scope ----------
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
    // Re-read the element as it looks now: that's what the agent and the thumbnail should show.
    await sleep(150);
    const fresh = await b.inspect(uid);
    if (!fresh) return;
    const pad = 20;
    const crop = clampRect({ x: fresh.rect.x - pad, y: fresh.rect.y - pad, width: fresh.rect.width + pad * 2, height: fresh.rect.height + pad * 2 }, b.size());
    let image: string | undefined;
    b.send('hide', true);
    await sleep(90);
    try { if (crop.width > 2 && crop.height > 2) image = await b.capture(crop); } catch { /* keep the old close-up */ } finally { b.send('hide', false); }
    patchAnn(id, (x) => (x.element ? { ...x, image: image ?? x.image, element: { ...x.element, styles: fresh.styles, html: fresh.html, rect: fresh.rect } } : x));
  };

  // Copy and class edits: shown in the page, written to source by the agent.
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
    // Classes the page's CSS doesn't have yet: ask the project's Tailwind for them, so they show now.
    const missing = value.split(/\s+/).filter((c) => c && !classNames.includes(c));
    if (!designSystem?.tailwind || !missing.length) return;
    clearTimeout(twTimer.current);
    twTimer.current = setTimeout(async () => {
      const want = [...new Set([...generated, ...missing])];
      try {
        const css = await api.tailwindCss(want);
        if (css == null) return;
        browser.current?.send('injectCss', css);
        // Only the ones that actually produced a rule count as generated.
        setGenerated(want.filter((c) => css.includes(c.replace(/[^\w-]/g, (ch) => '\\' + ch))));
      } catch { /* Tailwind isn't installed or the class doesn't exist: it stays marked as pending */ }
    }, 350);
  };

  // Production build size for a run card (builds the project; slow but real).
  const measureBuild = async (runId: string) => {
    setBusy('Building the project to measure it…');
    try {
      const build = await api.measureBuild(navRef.current.url);
      setChat((c) => c.map((it) => (it.kind === 'done' && it.runId === runId ? { ...it, build } : it)));
      if (build.restarted) flash('Measured. The dev server was stopped for the build and is starting again.');
    } catch (e) { flash(errText(e)); } finally { setBusy(null); }
  };

  // A component prop changed live (React dev builds). Values keep the type they had.
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

  // Open the component's Storybook story, or set up a request for the agent to write one.
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

  // Puts an element back the way the page had it: no live tweaks, no forced state.
  const releaseElement = async (a: Annotation) => {
    const b = (a.tabId && handles.current[a.tabId]) || browser.current; // the tab it was picked in
    const wc = b?.id();
    if (!a.element || !b) return;
    b.send('untweak', a.element.uid);
    const comp = a.element.component;
    for (const [name, edit] of Object.entries(a.propEdits || {})) b.setProp(a.element.uid, comp?.name || '', name, JSON.parse(edit.from));
    if (a.states?.length && wc != null) await api.forceState(wc, `[data-pinpoint="${a.element.uid}"]`, []).catch(() => {});
  };

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

  // The other pages of the app, for the before/after check of pages the user isn't looking at.
  const otherRoutes = (url: string, targets: string[] = []) => {
    if (!/^https?:/.test(url)) return undefined;
    let origin = '';
    try { origin = new URL(url).origin; } catch { return undefined; }
    // The open page is checked too: a change can land somewhere on it you weren't looking.
    let here = '/';
    try { here = new URL(url).pathname; } catch { /* keep "/" */ }
    const list = [
      { route: currentRoute?.route || here, url, current: true },
      ...routes.filter((r) => !r.dynamic && r.route !== currentRoute?.route).slice(0, 8).map((r) => ({ route: r.route, url: origin + r.route })),
    ];
    // The pages are loaded the way the open tab sees them (its "view as" profile).
    const partition = partitionOf(tabsRef.current.find((t) => t.id === activeTabRef.current)?.profile || '');
    return { routes: list, currentFile: currentRoute?.file, perfUrl: settingsRef.current?.perfCheck === false ? undefined : url, targets, partition };
  };

  const startRun = async (request: AgentRequest, before?: string | null, meta: RunMeta = {}) => {
    if (!settings) return;
    const id = uid();
    runMetaRef.current[id] = { ...meta, startedAt: Date.now() };
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

  // Send whatever piled up while a non-steerable run was going.
  useEffect(() => {
    if (runId || variantJob.current || !queuedRef.current.length) return;
    const merged = mergeRequests(queuedRef.current);
    queuedRef.current = [];
    startRun(merged);
  }, [runId, flushTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (mode: 'queue' | 'now' | 'bg' = 'queue') => {
    if (!settings || busy || (mode !== 'bg' && job && !runRef.current)) return;
    verifyPending.current = null; // the user moved on; don't start a check on top of their message
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
      // The screenshots show where the change is asked for: the annotated elements are brought
      // into view first, wherever the page has been scrolled to since they were picked.
      const targets: FrameTarget[] = anns.flatMap((a) => (a.kind === 'element' && a.element && (!a.pageUrl || a.pageUrl === navRef.current.url) ? [{ uid: a.element.uid, selector: a.element.selector }] : []));
      let frame: RunMeta['frame'];
      if (hasPage) {
        const at = await b.frame(targets);
        frame = { targets, y: at.y };
        if (targets.length) await sleep(140); // the overlay's markers follow the scroll on the next frames
      }
      let overview: string | undefined;
      if (hasPage && (anns.some((a) => a.kind === 'element') || (anns.length === 0 && !runRef.current))) {
        b.send('clean');
        await sleep(80);
        try { overview = await b.capture(); } catch { /* ignore */ }
      }
      // The overview shows live tweaks and forced states; everything after it should see the real page.
      if (isolated) isolate(null);
      if (anns.some((a) => a.tweaks || a.states?.length || a.textEdit || a.classEdit || a.propEdits)) {
        await Promise.all(anns.map(releaseElement));
        await sleep(120);
      }

      // A clean "before" screenshot for the before/after compare (new runs only).
      const before = hasPage && !runRef.current ? await cleanCapture() : null;

      const devTail = stripAnsi(devLog).split('\n').slice(-40).join('\n');
      const devHasErrors = devRunning && /error|failed|exception/i.test(devTail);
      const hasDiag = includeDiag && (consoleLog.length || netFails.length || devHasErrors);
      const a11yIssues = includeA11y && a11y.length ? a11y : undefined;
      const diagnostics = hasDiag || a11yIssues
        ? { console: hasDiag ? consoleLog : [], network: hasDiag ? netFails : [], devLog: hasDiag && devHasErrors ? devTail : '', a11y: a11yIssues }
        : undefined;
      const request: AgentRequest = {
        url: navRef.current.url, title: navRef.current.title, viewport: { ...b.size(), responsive: device.on || undefined },
        breakpoints: device.on && breakpoints.length ? breakpoints : undefined,
        instruction: instruction.trim(),
        overview,
        annotations: anns.map(({ id: _i, color: _c, ...a }) => a),
        diagnostics,
        route: currentRoute ? { path: currentRoute.route, file: currentRoute.file, framework: currentRoute.framework } : undefined,
        env: env.colorScheme || env.reducedMotion || frozen || describeConditions(cond).length || viewAs
          ? { ...env, frozen, states: describeConditions(cond), ...(viewAs && { profile: { name: viewAs.name, detail: [viewAs.locale, viewAs.timezone, viewAs.flags?.trim() && `flags: ${pairs(viewAs.flags, '=').map(([k, v]) => `${k}=${v}`).join(', ')}`].filter(Boolean).join(', ') } }) }
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
      for (const h of Object.values(handles.current)) h?.send('clear'); // pins can be on several tabs
      if (hasDiag) clearDiagnostics();
      if (a11yIssues) setIncludeA11y(false);

      // Background: handled in a separate copy of the project while this chat stays free.
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

      // Variants: the same request, run several times from the same starting point.
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

  // A steering message that is waiting (behind the agent's current step, or for the run to end) goes in now.
  const forceSteer = async (itemId: string) => {
    const running = runRef.current;
    const item = chatRef.current.find((it) => it.id === itemId);
    if (!running || !item || item.kind !== 'user') return;
    if (item.steer === 'later') api.cancelAgent(running); // this run can't take messages: stopping it sends what is queued
    else if (!(await api.nudgeAgent(running).catch(() => false))) { flash("The agent couldn't be interrupted just now."); return; }
    setChat((c) => c.map((it) => (it.id === itemId && it.kind === 'user' ? { ...it, steer: 'now' as const } : it)));
  };

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
    // The same place as the "before" screenshot, even if the page was scrolled or reloaded since.
    const frame = runMetaRef.current[id]?.frame;
    const aim = async () => { if (frame) { await browser.current?.frame(frame.targets, frame.y); await sleep(150); } };
    await aim();
    let shot = await cleanCapture();
    if (!shot) return;
    // Did anything on screen actually change? Said plainly on the run's card when it didn't.
    const before = beforeShotRef.current?.id === id ? beforeShotRef.current.shot : null;
    const judge = async (after: string): Promise<'none' | 'changed' | undefined> => {
      if (!before) return undefined;
      try { return (await diffOverlay(before, after)).pct < 0.01 ? 'none' : 'changed'; } catch { return undefined; } // sizes differ or an image failed to load
    };
    let visual = await judge(shot);
    // Looks the same: maybe the page just wasn't hot-reloaded (a static server). Reload once and look again.
    // Pages with hot reload are trusted: they would have updated, and a reload would lose their state.
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
  // A variant finished: keep its screenshot, put the files back, then start the next one or offer the choice.
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
    await sleep(1500); // hot reload back to the starting point
    const before = await cleanCapture();
    j.index++;
    setJob(null);
    // The session already has the request and its screenshots; without one, send it all again.
    const slim = !!sessionRef.current;
    const variant = { index: j.index, total: j.total };
    startRun({ ...j.base, ...(slim && { instruction: '', annotations: [], overview: undefined }), diagnostics: undefined, note: undefined, variant }, before, { variant, frame: runMetaRef.current[e.runId]?.frame });
  };

  // Everything that follows a finished run: screenshots, the next variant, the automatic check.
  const afterRun = async (e: Extract<AgentEvent, { type: 'done' }>) => {
    const meta = runMetaRef.current[e.runId] || {};
    if (meta.variant) return nextVariant(e);
    if (!e.changes?.length) return;
    await captureAfter(e.runId);
    runA11y();
    if (meta.verify || !e.ok || !settingsRef.current?.autoVerify) return;
    if (verifyPending.current !== e.runId || runRef.current || queuedRef.current.length) return;
    verifyPending.current = null;
    const shots = await api.runShots(e.runId).catch(() => ({} as Record<string, string>));
    if (!shots.after) return; // the page wasn't open, so there is nothing to look at
    // The request was about an interaction: get the page back into that state before looking.
    const flow = runFlowRef.current[e.runId];
    if (flow) {
      setChat((c) => [...c, { kind: 'status', id: uid(), text: 'Replaying the recorded interaction…' }]);
      await replayFlow(flow);
      const shot = await cleanCapture();
      if (shot) shots.after = shot;
      if (runRef.current || queuedRef.current.length) return;
    }
    // Identical screenshots: the change didn't show. The check is told, so it looks for why.
    let same = false;
    if (shots.before) { try { same = (await diffOverlay(shots.before, shots.after)).pct < 0.01; } catch { /* different sizes */ } }
    const since = meta.startedAt || 0;
    const cons = consoleRef.current.filter((c) => c.at >= since);
    const net = netRef.current.filter((n) => n.at >= since);
    const request: AgentRequest = {
      url: navRef.current.url, title: navRef.current.title, viewport: browser.current!.size(),
      instruction: 'Fix what the automatic check of the result found', annotations: [],
      verify: { before: shots.before, after: shots.after, same },
      diagnostics: cons.length || net.length ? { console: cons, network: net, devLog: '' } : undefined,
    };
    setChat((c) => [...c, { kind: 'status', id: uid(), text: 'Checking the result…' }]);
    startRun(request, shots.after, { verify: true });
  };
  const afterRunRef = useRef(afterRun);
  afterRunRef.current = afterRun;

  // Apply one of the variants (switching away from another one if needed).
  const pickVariant = async (itemId: string, id: string) => {
    const item = chat.find((c) => c.id === itemId && c.kind === 'variants') as Extract<ChatItem, { kind: 'variants' }> | undefined;
    if (!item || runRef.current) return;
    try {
      if (item.chosen && item.chosen !== id) applyRevert(item.chosen, await api.revertRun(item.chosen, null, true));
      const r = await api.applyRun(id);
      invalidateDiff(id);
      setChat((c) => c.map((it) => (it.id === itemId && it.kind === 'variants' ? { ...it, chosen: id }
        : it.kind === 'done' && it.runId === id ? { ...it, undone: false, changes: it.changes.map((ch) => ({ ...ch, reverted: false })) } : it)));
      browser.current?.reload(); // show the chosen variant even when the dev server doesn't hot-reload a restore
      const opt = item.options.find((o) => o.runId === id);
      pendingNote.current = `[Pinpoint: the user picked variant ${opt?.index} of the ${item.options.length} you made. Its files are on disk now; the other variants were discarded. Re-read files before editing them.]`;
      refreshGit();
      flash(r.failed.length ? `Applied, but couldn't restore ${r.failed.join(', ')}` : `Variant ${opt?.index} applied`);
    } catch (e) { flash(errText(e)); }
  };

  // The mockup overlay against the page, pixel by pixel.
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

  // Screenshot the current page at phone, tablet and desktop widths for a run.
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
  // A chat that is still working keeps working; the new one starts beside it.
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
    setInstruction((t) => (t.trim() ? t : 'Fix the problems listed in the runtime diagnostics (console errors / failed requests).'));
    setTimeout(() => composerRef.current?.focus(), 50);
  };

  // Terminal output can arrive hundreds of lines a second: collect it and update a few times a second.
  const logBuf = useRef({ dev: '', agent: '' });
  const logTimer = useRef(0);
  const addLog = (which: 'dev' | 'agent', text: string) => {
    logBuf.current[which] += text;
    if (logTimer.current) return;
    logTimer.current = window.setTimeout(() => {
      logTimer.current = 0;
      const { dev, agent } = logBuf.current;
      logBuf.current = { dev: '', agent: '' };
      if (dev) setDevLog((l) => (l + dev).slice(-200_000));
      if (agent) setAgentLog((l) => (l + agent).slice(-200_000));
    }, 120);
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
    setChat((c) => mergeDeltas(c, buf));
  }, []);
  // A complete block replaces the streamed draft of the same kind (or is added).
  const finalizeBlock = (kind: 'text' | 'thinking', text: string, extra: ChatItem[] = []) => {
    if (deltaRaf.current) { cancelAnimationFrame(deltaRaf.current); flushDeltas(); }
    setChat((c) => finalizeItems(c, kind, text, extra));
  };

  useEffect(() => api.onAgentEvent((e: AgentEvent) => {
    // Other pages are compared after the run has already been reported as done.
    if (e.type === 'routes') {
      // A fresh load shows the change but the open page doesn't: it wasn't hot-reloaded, so reload it.
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
      // A chat that isn't on screen: its messages are collected for when it is opened again.
      const p = [...parked.current.values()].find((x) => x.runId === e.runId);
      if (p) parkedEventRef.current(p, e);
      return;
    }
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
        if (deltaRaf.current) { cancelAnimationFrame(deltaRaf.current); flushDeltas(); }
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
        // Static files have no hot reload, so refresh them ourselves.
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

  // The conversation follows new output only while the reader is at the bottom;
  // scrolling up to read leaves it where it is. A message you send jumps back down.
  const stick = useRef(true);
  const chatLen = useRef(0);
  // away: scrolled up from the end. fresh: something new arrived down there meanwhile.
  const [away, setAway] = useState<{ fresh: boolean } | null>(null);
  const awayRef = useRef(away);
  awayRef.current = away;
  const onChatScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    // Only being right at the end counts as following along: any scroll up, however small, is left alone.
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 12;
    if (stick.current ? awayRef.current : !awayRef.current) setAway(stick.current ? null : { fresh: false });
  }, []);
  // Scrolling up lets go at once, before the next line of output can pull the view back down.
  const onChatWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (e.deltaY < 0 && el.scrollHeight > el.clientHeight) { stick.current = false; if (!awayRef.current) setAway({ fresh: false }); }
  }, []);
  const toLatest = () => {
    const box = chatEnd.current?.parentElement;
    if (!box) return;
    stick.current = true;
    setAway(null);
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
  };
  useLayoutEffect(() => {
    const box = chatEnd.current?.parentElement;
    if (!box) return;
    const grew = chat.length > chatLen.current;
    chatLen.current = chat.length;
    if (grew && chat[chat.length - 1]?.kind === 'user') { stick.current = true; if (awayRef.current) setAway(null); }
    if (stick.current) box.scrollTop = box.scrollHeight;
    else if (awayRef.current && !awayRef.current.fresh) setAway({ fresh: true });
  }, [chat, runId, job]);

  // The conversation's buttons, as one object that never changes identity, so
  // finished messages aren't rendered again when anything else on screen changes.
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
  const chatHandlersRef = useRef(chatHandlers);
  chatHandlersRef.current = chatHandlers;
  const chatActions = useMemo<ChatActions>(() => ({
    onReload: () => chatHandlersRef.current.onReload(),
    onUndo: (...a) => chatHandlersRef.current.onUndo(...a),
    onReview: (...a) => chatHandlersRef.current.onReview(...a),
    onMemory: (...a) => chatHandlersRef.current.onMemory(...a),
    onRevertFile: (...a) => chatHandlersRef.current.onRevertFile(...a),
    onOpenFile: (...a) => chatHandlersRef.current.onOpenFile(...a),
    onCommit: (...a) => chatHandlersRef.current.onCommit(...a),
    onCompare: (...a) => chatHandlersRef.current.onCompare(...a),
    onPickVariant: (...a) => chatHandlersRef.current.onPickVariant(...a),
    onMeasureBuild: (...a) => chatHandlersRef.current.onMeasureBuild(...a),
    onForceSteer: (...a) => chatHandlersRef.current.onForceSteer(...a),
  }), []);

  // ---------- dev server ----------
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
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const loadErrorRef = useRef(loadError);
  loadErrorRef.current = loadError;

  // Work out the project's dev command, and whether its server is already up.
  // (We only offer that URL: another app could be on the same port.)
  useEffect(() => {
    setDevInfo(null);
    if (!projectDir) return;
    let live = true;
    api.detectDev().then((d) => { if (live) setDevInfo(d); }).catch(() => {});
    return () => { live = false; };
  }, [projectDir]); // eslint-disable-line react-hooks/exhaustive-deps
  const devCommand = settings?.devCommand || devInfo?.command || '';

  const startDev = async (cmd: string) => {
    try { await api.startDev(cmd); saveSettings({ devCommand: cmd }); }
    catch (e) { flash((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  };
  // One click from the welcome screen or a load error: run the detected command.
  const quickStartDev = () => {
    setDrawerOpen(true); setDrawerTab('dev');
    if (devCommand && !devRunning) startDev(devCommand);
  };

  const pickProject = async () => {
    const prev = settings?.projectDir;
    const dir = await api.pickFolder();
    if (!dir) return;
    setSettings(await api.getSettings()); setSession(null); flash(`Project: ${dir}`);
    // A different project starts from its welcome screen, not the old project's page.
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

  // ---------- layout ----------
  const startResize = (which: 'panel' | 'drawer') => (e: React.PointerEvent) => {
    e.preventDefault();
    // Capture the pointer so moves over the <webview> (a separate process) still reach us.
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setResizing(which);
    dragging.current = true;
    // The grid is resized directly, once per frame, and the new size goes into state
    // when the drag ends: re-rendering the whole window on every pointer move is what made this stutter.
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

  // ---------- keyboard ----------
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

  // ---------- annotations ----------
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
  // Responsive mode: the page gets its exact size and is scaled down to fit when it's bigger than the stage.
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
    // Element notes carry the state / scope / tweak tools, so they need more room.
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
  const PanelIcon = left ? PanelLeft : PanelRight;

  return (
    <div className={`app ${resizing ? 'resizing' : ''}`} style={gridStyle}>
      {/* ---------- top bar ---------- */}
      <header className="topbar">
        <button className="project-btn" onClick={pickProject} title={settings.projectDir || 'Choose the project folder the agent edits'}>
          <FolderOpen size={14} />
          <span>{settings.projectDir ? settings.projectDir.split(/[\\/]/).pop() : 'Open project'}</span>
        </button>

        <div className="tb-div" />

        <div className="seg mode-seg">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? 'on' : ''} onClick={() => setMode(m.id)} title={`${m.hint} (${m.key})`}>
              <m.icon size={15} /><span>{m.label}</span><kbd>{m.key}</kbd>
            </button>
          ))}
          <button className={rec ? 'rec' : ''} onClick={toggleRecording} disabled={!/^(https?|file):/.test(nav.url)} title={rec ? 'Stop recording and attach the steps' : 'Record an interaction (clicks and typing) to show the agent what you did'}>
            <CircleDot size={15} /><span>{rec ? 'Stop' : 'Record'}</span>
          </button>
        </div>

        <div className="spacer" />

        <div className="top-right">
          {update && (update.status === 'ready' || update.status === 'available' || update.status === 'downloading') && (
            <button className={`update-chip ${update.status}`} disabled={update.status === 'downloading'} onClick={() => api.updateInstall()} title={update.status === 'ready' ? `Version ${update.version} is downloaded. Click to restart into it.` : update.status === 'available' ? `Version ${update.version} is out. Click to open the download page.` : `Downloading version ${update.version}…`}>
              <Download size={13} /> {update.status === 'ready' ? 'Restart to update' : update.status === 'available' ? `Get ${update.version}` : `Updating${update.percent ? ` ${update.percent}%` : '…'}`}
            </button>
          )}
          <button className={`icon-btn ${drawerOpen ? 'on' : ''}`} onClick={() => setDrawerOpen(!drawerOpen)} title="Terminal, dev server and logs">
            <TerminalSquare size={16} />{devRunning && <span className="live-dot abs" />}
          </button>
          <button
            className={`icon-btn ${sheet === 'design' ? 'on' : ''} ${designChanged ? 'warn' : ''}`}
            onClick={() => setSheet(sheet === 'design' ? null : 'design')} disabled={!projectDir}
            title={designChanged ? 'Design rules changed during this chat. Start a new chat to use them.'
              : design?.exists ? (settings.useDesign ? 'Design rules: DESIGN.md is sent at the start of each chat' : 'Design rules: DESIGN.md exists but is switched off') : 'Design rules: set up your colors, type, spacing and components'}
          >
            <Palette size={16} />{design?.exists && settings.useDesign && <span className="ctx-dot" />}
          </button>
          <button
            className={`icon-btn ${sheet === 'memory' ? 'on' : ''}`}
            onClick={() => setSheet(sheet === 'memory' ? null : 'memory')} disabled={!projectDir}
            title={`Project memory: short rules sent with every request${memoryOn ? ` (${memoryOn} on)` : ''}`}
          >
            <Brain size={16} />{memoryOn > 0 && <b className="icon-count">{memoryOn}</b>}
          </button>
          <button className="icon-btn" onClick={() => browser.current?.devtools()} title="Page DevTools"><Bug size={16} /></button>
          <button className={`icon-btn ${settings.panelHidden ? '' : 'on'}`} onClick={togglePanel} title={`Toggle sidebar (${MOD}+B)`}><PanelIcon size={16} /></button>
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} title="Settings"><SettingsIcon size={16} /></button>
        </div>
      </header>

      {/* ---------- browser ---------- */}
      <main className="stage">
        {/* Tabs on the left, tools for the page being shown on the right. */}
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
        {/* Navigation for the active tab, and tools for the page it shows. */}
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
              const here = () => t.id === activeTabRef.current; // background tabs stay loaded but don't drive the UI
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
                        placeholder={a.kind === 'element' ? 'What should change here?' : a.kind === 'flow' ? 'What goes wrong (or should change) when you do this?' : a.kind === 'sketch' ? 'What is this sketch? Where should it go?' : a.kind === 'reference' ? 'What should we take from this image?' : 'Explain your drawing…'}
                        onPaste={onPaste}
                        value={a.note}
                        onFocus={() => setActiveId(a.id)}
                        onChange={(e) => updateNote(a.id, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
                      />
                    </div>
                    {a.kind === 'flow' && (
                      <button className="icon-btn xs ann-act" title="Copy these steps as a Playwright test" onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(toPlaywright(a)); flash('Playwright test copied.'); }}><ClipboardCopy size={13} /></button>
                    )}
                    {a.kind === 'reference' && a.image && (
                      <button
                        className={`icon-btn xs ann-act ${overlay?.image === a.image ? 'on' : ''}`} title="Lay this image over the page to compare"
                        onClick={(e) => { e.stopPropagation(); setOverlay(overlay?.image === a.image ? null : { image: a.image!, name: a.name || 'mockup', opacity: 0.5, x: 0, y: 0, moving: false }); }}
                      ><Blend size={13} /></button>
                    )}
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
          cwd={projectDir} shell={settings.terminalShell} onShell={(terminalShell) => { if (terminalShell !== settingsRef.current?.terminalShell) saveSettings({ terminalShell }); }}
          devRunning={devRunning} devCommand={devCommand} devCandidates={devInfo?.candidates}
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
