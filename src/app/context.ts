// What the app's hooks and views share: a generated list of the members that cross slices. A member only one view needs is local state instead.
// Each slice is written by its hook on every render, so reads always see the latest values.
import type { CSSProperties, Dispatch, JSX, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { BrowserHandle, PickedElement } from '../components/page/BrowserView';
import type { A11yIssue, AgentEvent, AgentId, Annotation, ApiHandler, BgRun, ChatItem, ConsoleEntry, DesignDoc, DesignSystem, DevDetection, FlowResult, FlowStep, ForcedState, GitPull, GitStatus, HarnessInfo, MemoryItem, Mock, Mode, ModelCatalog, NetRequest, NetworkFailure, OtherChat, PageEnv, Profile, Rect, RevertResult, ReviewComment, RouteInfo, SavedLayout, Settings, Shape, SweepPage, Tool, UpdateState } from '../types';
import type { Tab } from '../lib/urls';
import type { Breakpoint, Device } from '../components/page/DeviceBar';
import type { DrawerTab } from '../components/tools/Drawer';
import type { ContextTab } from '../components/agent/ContextSheet';
import type { CompareTarget } from '../components/page/CompareView';
import type { Overlay } from '../components/page/MockupOverlay';
import type { ToolSection } from '../components/page/ElementTools';
import type { Conditions } from '../components/page/PageTools';
import type { AgentRequest, ParkedChat, RunMeta } from '../lib/chat';
import type { SiteKind } from '../lib/site';
import type { ChatActions } from '../components/chat';
import type { Command } from '../components/shell/CommandPalette';

export interface SettingsSlice {
  agents: Record<AgentId, { ok: boolean; version?: string; }> | null;
  catalog: ModelCatalog | null;
  flash: (msg: string) => void;
  harnesses: HarnessInfo[];
  notify: (body: string) => void;
  projectDir: string;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  setAgents: Dispatch<SetStateAction<Record<AgentId, { ok: boolean; version?: string; }> | null>>;
  setSettings: Dispatch<SetStateAction<Settings | null>>;
  settings: Settings | null;
  theme: "light" | "dark" | "system";
  toast: string | null;
  update: UpdateState | null;
}

export interface TabsSlice {
  activeTab: string;
  applyTabProfile: (t: Tab) => Promise<void>;
  browser: MutableRefObject<BrowserHandle | null>;
  closeTab: (id: string) => void;
  go: (raw: string) => void;
  handles: MutableRefObject<Record<string, BrowserHandle | null>>;
  loadError: string | null;
  loading: boolean;
  nav: { url: string; title: string; canBack: boolean; canForward: boolean; };
  newTab: (url?: string) => void;
  patchTab: (id: string, patch: Partial<Tab>) => void;
  profiles: Profile[];
  saveProfiles: (list: Profile[]) => void;
  setActiveTab: Dispatch<SetStateAction<string>>;
  setProfiles: Dispatch<SetStateAction<Profile[]>>;
  setTabProfile: (id: string, profile: string) => void;
  setTabs: Dispatch<SetStateAction<Tab[]>>;
  setUrlInput: Dispatch<SetStateAction<string>>;
  switchTab: (id: string) => void;
  tab: Tab | undefined;
  tabs: Tab[];
  urlInput: string;
  viewAs: Profile | undefined;
}

export interface LayoutSlice {
  applyLayout: ({ name, ...l }: SavedLayout) => void;
  compare: CompareTarget | null;
  diffView: { runId: string; path?: string; } | null;
  drawerOpen: boolean;
  drawerTab: DrawerTab;
  enginesOpen: boolean;
  frame: RefObject<HTMLDivElement>;
  gridStyle: CSSProperties;
  historyOpen: boolean;
  layoutsOpen: boolean;
  left: boolean;
  openTool: (t: DrawerTab) => void;
  paletteOpen: boolean;
  patchView: { title: string; text: string; } | null;
  resizing: "panel" | "drawer" | "device" | null;
  saveLayout: (name: string) => void;
  setCompare: Dispatch<SetStateAction<CompareTarget | null>>;
  setDiffView: Dispatch<SetStateAction<{ runId: string; path?: string; } | null>>;
  setDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setDrawerTab: Dispatch<SetStateAction<DrawerTab>>;
  setEnginesOpen: Dispatch<SetStateAction<boolean>>;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  setLayoutsOpen: Dispatch<SetStateAction<boolean>>;
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  setPanelWidth: Dispatch<SetStateAction<number | null>>;
  setPatchView: Dispatch<SetStateAction<{ title: string; text: string; } | null>>;
  setResizing: Dispatch<SetStateAction<"panel" | "drawer" | "device" | null>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setSheet: Dispatch<SetStateAction<ContextTab | null>>;
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  setTimelineOpen: Dispatch<SetStateAction<boolean>>;
  settingsOpen: boolean;
  setToolTabs: Dispatch<SetStateAction<DrawerTab[]>>;
  setWsOpen: Dispatch<SetStateAction<boolean>>;
  sheet: ContextTab | null;
  shortcutsOpen: boolean;
  split: boolean;
  startResize: (which: "panel") => (e: React.PointerEvent) => void;
  statusOn: boolean;
  threadsOn: boolean;
  timelineOpen: boolean;
  togglePanel: () => Promise<void>;
  toggleThreads: () => void;
  toggleZen: () => void;
  toolTabs: DrawerTab[];
  wsOpen: boolean;
  zen: boolean;
}

export interface DevserverSlice {
  servicesRunning: string[];
  addLog: (which: "dev" | "agent", text: string) => void;
  agentLog: string;
  devCommand: string;
  devInfo: DevDetection | null;
  devLog: string;
  devRunning: boolean;
  quickStartDev: () => void;
  setAgentLog: Dispatch<SetStateAction<string>>;
  setDevLog: Dispatch<SetStateAction<string>>;
  startDev: (cmd: string) => Promise<void>;
}

export interface NetworkSlice {
  addRequest: (r: NetRequest, handler: ApiHandler | null) => void;
  buildMock: (m: Mock) => void;
  clearDiagnostics: () => void;
  clearRequests: () => void;
  consoleLog: ConsoleEntry[];
  consoleRef: MutableRefObject<ConsoleEntry[]>;
  netFails: NetworkFailure[];
  netRef: MutableRefObject<NetworkFailure[]>;
  onConsole: (c: { level: "error" | "warning"; message: string; source?: string | undefined; line?: number | undefined; file?: string | undefined; fileLine?: number | undefined; }) => void;
  onRequest: (r: NetRequest) => void;
  replayRequest: (r: NetRequest) => Promise<void>;
  requests: NetRequest[];
  withBodies: (fails: NetworkFailure[]) => NetworkFailure[];
  withHandlers: (fails: NetworkFailure[]) => Promise<NetworkFailure[]>;
}

export interface ProjectSlice {
  askAgentForDesign: (draft: string | null) => void;
  currentRoute: RouteInfo | null;
  design: DesignDoc | null;
  designChanged: boolean;
  designSystem: DesignSystem | null;
  memory: MemoryItem[];
  memoryOn: number;
  onMemoryAction: (id: string, action: "save" | "dismiss") => void;
  refreshRoutes: () => void;
  routes: RouteInfo[];
  setDesign: Dispatch<SetStateAction<DesignDoc | null>>;
  setDesignSystem: Dispatch<SetStateAction<DesignSystem | null>>;
  setMemory: Dispatch<SetStateAction<MemoryItem[]>>;
}

export interface GitSlice {
  branchCompare: { base?: string; remote?: boolean; pr?: boolean; } | null;
  branchOf: MutableRefObject<Map<string, string>>;
  commitRun: (id: string) => Promise<void>;
  gitStatus: GitStatus | null;
  openFile: (path: string, line?: number) => void;
  openWorktree: (dir: string) => Promise<boolean>;
  pickProject: (known?: string) => Promise<void>;
  prDefaults: () => { title: string; body: string; shots: { runId: string; label: string; }[]; };
  pulls: Record<string, GitPull>;
  refreshGit: () => Promise<void>;
  setBranchCompare: Dispatch<SetStateAction<{ base?: string; remote?: boolean; pr?: boolean; } | null>>;
  wantChat: MutableRefObject<string | null>;
}

export interface PageSlice {
  a11y: A11yIssue[];
  area: RefObject<HTMLDivElement>;
  askA11y: () => void;
  breakpoints: Breakpoint[];
  changeConditions: (next: Conditions) => Promise<void>;
  cond: Conditions;
  device: Device;
  deviceH: number;
  deviceScale: number;
  dragging: MutableRefObject<boolean>;
  env: PageEnv;
  frozen: boolean;
  includeA11y: boolean;
  includeDiag: boolean;
  mocks: Mock[];
  mode: Mode;
  multi: boolean;
  onFrozen: (on: boolean) => Promise<void>;
  runA11y: () => Promise<void>;
  setA11y: Dispatch<SetStateAction<A11yIssue[]>>;
  setAvail: Dispatch<SetStateAction<{ w: number; h: number; }>>;
  setDevice: Dispatch<SetStateAction<Device>>;
  setEnv: Dispatch<SetStateAction<PageEnv>>;
  setFrozen: (on: boolean) => void;
  setFrozenState: Dispatch<SetStateAction<boolean>>;
  setIncludeA11y: Dispatch<SetStateAction<boolean>>;
  setIncludeDiag: Dispatch<SetStateAction<boolean>>;
  setMocks: Dispatch<SetStateAction<Mock[]>>;
  setMode: (m: Mode) => void;
  setMulti: Dispatch<SetStateAction<boolean>>;
  startDeviceResize: (axis: "x" | "y" | "xy") => (e: React.PointerEvent) => void;
  stepAnimation: () => Promise<void>;
  syncPage: () => void;
}

export interface SiteSlice {
  kind: SiteKind;
  liveOrigin: string;
  localTwin: string;
  setTwins: Dispatch<SetStateAction<{ local: string; live: string; homepage: string; }>>;
  siteOrigin: string;
}

export interface ChatsSlice {
  agentName: string;
  agentReady: boolean;
  away: { fresh: boolean; } | null;
  chat: ChatItem[];
  chatActions: ChatActions;
  chatBox: RefObject<HTMLDivElement>;
  chatCost: number;
  chatEnd: RefObject<HTMLDivElement>;
  chatId: string | null;
  deleteChat: (id: string) => Promise<void>;
  designAtStart: string | null;
  job: string | null;
  leaveChat: () => boolean;
  limits: { status: "ok" | "warning" | "rejected"; used?: number; resetsAt?: number; window?: string; } | null;
  markBelow: () => void;
  mcp: { name: string; status: string; }[];
  modelName: string | undefined;
  newChat: () => void;
  onChatScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  onChatWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  openChat: (id: string) => Promise<void>;
  others: OtherChat[];
  parked: MutableRefObject<Map<string, ParkedChat>>;
  parkedEvent: (p: ParkedChat, e: AgentEvent) => void;
  receiveChat: () => Promise<void>;
  recentFiles: string[];
  runId: string | null;
  runMeta: RunMeta | undefined;
  runRef: MutableRefObject<string | null>;
  session: { id: string; agent: AgentId; } | null;
  setChat: Dispatch<SetStateAction<ChatItem[]>>;
  setChatCreated: Dispatch<SetStateAction<number>>;
  setChatId: Dispatch<SetStateAction<string | null>>;
  setDesignAtStart: Dispatch<SetStateAction<string | null>>;
  setJob: Dispatch<SetStateAction<string | null>>;
  setLimits: Dispatch<SetStateAction<{ status: "ok" | "warning" | "rejected"; used?: number; resetsAt?: number; window?: string; } | null>>;
  setMcp: Dispatch<SetStateAction<{ name: string; status: string; }[]>>;
  setRunId: Dispatch<SetStateAction<string | null>>;
  setSession: Dispatch<SetStateAction<{ id: string; agent: AgentId; } | null>>;
  setUsage: Dispatch<SetStateAction<{ used: number; window?: number; } | null>>;
  toLatest: () => void;
  usage: { used: number; window?: number; } | null;
}

export interface AnnotationsSlice {
  focusNote: (id: string) => void;
  activeId: string | null;
  addReferences: (files: File[] | FileList) => Promise<void>;
  addScribble: (points: [number, number][]) => void;
  annotations: Annotation[];
  applyInstant: (id: string) => Promise<void>;
  captureSizes: (id: string) => Promise<void>;
  classNames: string[];
  color: string;
  colorFor: (n: number) => string;
  commitCurrent: () => Promise<void>;
  diffMockup: () => Promise<void>;
  drawShapes: { shapes: Shape[]; set(next: Shape[]): void; undo(): void; redo(): void; reset(): void; canUndo: boolean; canRedo: boolean; };
  editClasses: (id: string, value: string) => void;
  editProp: (id: string, name: string, raw: string) => Promise<void>;
  editText: (id: string, text: string) => void;
  focusAnn: (a: Annotation) => void;
  generated: string[];
  isolate: (id: string | null) => void;
  isolated: string | null;
  makeDrawing: (n: number) => Promise<Annotation | null>;
  makeSketch: (n: number) => Promise<Annotation | null>;
  nextN: () => number;
  onManip: (m: { uid: string; kind: "resize" | "reorder"; width?: string | null; height?: string | null; from?: number; to?: number; count?: number; before?: string | null; }) => void;
  onPicked: (el: PickedElement) => Promise<void>;
  openStory: (id: string) => Promise<void>;
  overlay: Overlay | null;
  page: { shapes: Shape[]; set(next: Shape[]): void; undo(): void; redo(): void; reset(): void; canUndo: boolean; canRedo: boolean; };
  patchAnn: (id: string, fn: (a: Annotation) => Annotation) => void;
  pendingMarks: number;
  plan: { ok: boolean; summary?: string[]; reason?: string; } | null;
  popAnn: Annotation | null | undefined;
  popover: { id: string; rect: Rect; } | null;
  popoverStyle: { left?: undefined; top?: undefined; width?: undefined; } | { left: number; top: number; width: number; };
  releaseElement: (a: Annotation) => Promise<void>;
  removeAnn: (id: string) => void;
  resetTweaks: (id: string) => void;
  setActiveId: Dispatch<SetStateAction<string | null>>;
  setAnnotations: Dispatch<SetStateAction<Annotation[]>>;
  setClassNames: Dispatch<SetStateAction<string[]>>;
  setColor: Dispatch<SetStateAction<string>>;
  setOverlay: Dispatch<SetStateAction<Overlay | null>>;
  setPopover: Dispatch<SetStateAction<{ id: string; rect: Rect; } | null>>;
  setSize: Dispatch<SetStateAction<number>>;
  setStates: (id: string, states: ForcedState[]) => Promise<void>;
  setTool: Dispatch<SetStateAction<Tool>>;
  setToolSection: Dispatch<SetStateAction<ToolSection | null>>;
  size: number;
  sketch: { shapes: Shape[]; set(next: Shape[]): void; undo(): void; redo(): void; reset(): void; canUndo: boolean; canRedo: boolean; };
  tool: Tool;
  toolSection: ToolSection | null;
  tweak: (id: string, prop: string, value: string) => void;
  updateNote: (id: string, note: string) => void;
}

export interface ComposerSlice {
  busy: string | null;
  canSend: boolean;
  composerRef: RefObject<HTMLTextAreaElement>;
  focusComposer: (delay?: number, atEnd?: boolean) => void;
  dropFiles: (files: FileList) => void;
  fileInput: RefObject<HTMLInputElement>;
  historyAt: MutableRefObject<number>;
  instruction: string;
  mention: (path: string) => void;
  onPaste: (e: React.ClipboardEvent) => void;
  pasteOpen: string | null;
  pastes: { id: string; text: string; }[];
  planMode: boolean;
  root: string;
  saveSnippet: (text: string) => void;
  setBusy: Dispatch<SetStateAction<string | null>>;
  setInstruction: Dispatch<SetStateAction<string>>;
  setPasteOpen: Dispatch<SetStateAction<string | null>>;
  setPastes: Dispatch<SetStateAction<{ id: string; text: string; }[]>>;
  setPlanMode: (on: boolean) => Promise<void>;
}

export interface FlowsSlice {
  flowFix: (id: string) => void;
  onStep: (s: FlowStep) => void;
  rec: { steps: FlowStep[]; startUrl: string; } | null;
  replayFlow: (flow: { steps: FlowStep[]; startUrl: string; }) => Promise<FlowResult | null>;
  runFlowRef: MutableRefObject<Record<string, { steps: FlowStep[]; startUrl: string; seen?: { errors: string[]; failed: string[]; }; }>>;
  tapRef: MutableRefObject<{ errors: string[]; failed: string[]; } | null>;
  toggleRecording: () => void;
}

export interface RunsSlice {
  afterRun: (e: Extract<AgentEvent, { type: "done"; }>) => Promise<void>;
  applyRevert: (id: string, r: RevertResult) => void;
  askToFix: () => void;
  cancel: () => void;
  captureAfter: (id: string) => Promise<void>;
  cleanCapture: () => Promise<string | null>;
  forceSteer: (itemId: string) => Promise<void>;
  measureBuild: (runId: string) => Promise<void>;
  otherRoutes: (url: string, targets?: string[]) => { routes: ({ route: string; url: string; } | { route: string; url: string; current: boolean; })[]; currentFile: string | undefined; perfUrl: string | undefined; targets: string[]; partition: string; } | undefined;
  pendingNote: MutableRefObject<string | null>;
  queuedRef: MutableRefObject<{ itemId: string; request: AgentRequest; }[]>;
  revertFile: (id: string, path: string, force?: boolean) => Promise<RevertResult | null>;
  runMetaRef: MutableRefObject<Record<string, RunMeta>>;
  runPageRef: MutableRefObject<Record<string, string>>;
  send: (mode?: "queue" | "now" | "bg") => Promise<void>;
  sendText: (text: string) => void;
  setFlushTick: Dispatch<SetStateAction<number>>;
  startRun: (request: AgentRequest, before?: string | null, meta?: RunMeta) => Promise<void>;
  undoRun: (_doneId: string, id: string) => Promise<void>;
  unqueue: (itemId: string, edit: boolean) => void;
  verifyPending: MutableRefObject<string | null>;
}

export interface AgentEventsSlice {
  deltaBuf: MutableRefObject<{ kind: "text" | "thinking"; text: string; }[]>;
  deltaTimer: MutableRefObject<number>;
}

export interface VariantsSlice {
  liveItem: { kind: "variants"; id: string; options: { runId: string; index: number; files: number; }[]; chosen?: string | null; } | undefined;
  livePage: string;
  matchMockup: () => Promise<void>;
  matchRef: MutableRefObject<{ image: string; x: number; y: number; round: number; last: number; } | null>;
  nextMatch: (e: Extract<AgentEvent, { type: "done"; }>) => Promise<void>;
  nextVariant: (e: Extract<AgentEvent, { type: "done"; }>) => Promise<void>;
  openVariantsLive: (itemId: string) => void;
  pickVariant: (itemId: string, id: string) => Promise<void>;
  setLiveVariants: Dispatch<SetStateAction<string | null>>;
  variantJob: MutableRefObject<{ base: AgentRequest; total: number; index: number; done: { runId: string; index: number; files: number; }[]; } | null>;
}

export interface ReviewSlice {
  addReviewComments: (list: ReviewComment[]) => void;
  reviewComments: ReviewComment[];
  reviewing: boolean;
  reviewOpen: boolean;
  setReviewComments: Dispatch<SetStateAction<ReviewComment[]>>;
  setReviewing: Dispatch<SetStateAction<boolean>>;
  setReviewOpen: Dispatch<SetStateAction<boolean>>;
  setSweepOpen: Dispatch<SetStateAction<boolean>>;
  sweepFix: (pages: SweepPage[]) => Promise<void>;
  sweepOpen: boolean;
  sweepOpenPage: (url: string, width: number) => void;
  sweepPlan: () => { pages: { route: string; url: string; }[]; crawl: boolean; };
}

export interface HandoffSlice {
  copyHandoff: () => void;
  exportHandoff: () => Promise<void>;
  importHandoff: () => Promise<void>;
  issueHandoff: () => Promise<void>;
}

export interface BackgroundSlice {
  applyBg: (r: BgRun) => Promise<void>;
  bgBlocked: string | null;
  bgRuns: BgRun[];
  discardBg: (r: BgRun) => void;
  setBgRuns: Dispatch<SetStateAction<BgRun[]>>;
}

export interface SideSlice {
  activeSide: string | null;
  askAside: { text: string; x: number; y: number; } | null;
  closeSide: (id: string) => void;
  fadeTabs: () => void;
  fromSelection: (how: "side" | "reply") => void;
  newSide: (seed?: string) => void;
  onChatMouseUp: () => void;
  patchSide: (id: string, p: Partial<{ id: string; title: string; seed: string | null; running: boolean; }>) => void;
  setActiveSide: Dispatch<SetStateAction<string | null>>;
  setAskAside: Dispatch<SetStateAction<{ text: string; x: number; y: number; } | null>>;
  sideContext: () => string;
  sides: { id: string; title: string; seed: string | null; running: boolean; }[];
  tabsStrip: RefObject<HTMLDivElement>;
}

export interface CommandsSlice {
  assist: { popover: JSX.Element | null; onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean; track: () => void; };
  commands: Command[];
  searchChats: (q: string) => void;
  setPaletteHits: Dispatch<SetStateAction<{ id: string; title: string; snippet: string; }[]>>;
}

export interface ShortcutsSlice {
  handleKey: (key: string, e?: KeyboardEvent) => void;
}

export interface StatusSlice {

}

export type AppContext = SettingsSlice
  & TabsSlice
  & LayoutSlice
  & DevserverSlice
  & NetworkSlice
  & ProjectSlice
  & GitSlice
  & PageSlice
  & SiteSlice
  & ChatsSlice
  & AnnotationsSlice
  & ComposerSlice
  & FlowsSlice
  & RunsSlice
  & AgentEventsSlice
  & VariantsSlice
  & ReviewSlice
  & HandoffSlice
  & BackgroundSlice
  & SideSlice
  & CommandsSlice
  & ShortcutsSlice
  & StatusSlice;
