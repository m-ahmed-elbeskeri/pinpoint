export type Mode = 'browse' | 'select' | 'draw' | 'sketch';
export type Tool = 'pen' | 'highlighter' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'eraser';
export type AgentId = 'claude' | 'codex';

export interface Shape {
  id: string;
  tool: Exclude<Tool, 'eraser'>;
  color: string;
  size: number;
  points: [number, number][];
  text?: string;
}

export interface SourceInfo {
  file?: string;
  line?: number;
  column?: number;
  components?: string[];
  framework?: string;
  frame?: { url: string; line: number; column: number }; // compiled-code position, for source maps
  owner?: string;                 // nearest component that renders the element
  props?: Record<string, string>; // that component's props, summarized
}

// The component behind a picked element, and how widely it is used in the project.
export interface ComponentInfo { name: string; props?: Record<string, string>; uses?: number; fileCount?: number; files?: string[] }

// Pseudo-states that can be forced on a picked element.
export type ForcedState = 'hover' | 'focus' | 'focus-visible' | 'active' | 'disabled';

// What the page is being shown as: emulated media features and a frozen page.
export interface PageEnv { colorScheme: 'light' | 'dark' | null; reducedMotion: boolean }

export interface A11yIssue {
  id: string; impact: string | null; help: string; count: number;
  nodes: { target: string; html: string; summary: string }[];
}

export interface DesignSystem {
  tailwind: { version: string | null; config: string | null; entry?: string | null; configFile?: string | null } | null;
  libraries: string[];
  styling: string[];
  componentsConfig: string | null;
  tokenFiles: { file: string; count: number }[];
  tokens: { name: string; value: string }[];
}

export interface RouteCheckResult {
  route: string; key: string; pct: number; changed: boolean;
  current?: boolean;  // the page that was open during the run
  areas?: string[];   // what changed on it, named by element (on the open page: besides what was asked for)
  asked?: string[];   // on the open page: the changed areas the user had pointed at
}

// A CSS rule that styles a picked element, and where it lives.
export interface CssRuleInfo {
  selector: string; media?: string; file?: string; line?: number;
  approx?: boolean;  // the line was found by searching the file, not from a source map
  utility?: boolean; // generated utility class (Tailwind etc.): edit the class list instead
  declarations: { name: string; value: string; important: boolean }[];
  wins: string[]; // tracked properties this rule currently decides
}

// One step of a recorded interaction.
export interface FlowStep { type: 'click' | 'fill' | 'check' | 'key' | 'navigate'; selector?: string; tag?: string; text?: string; value?: string; key?: string; url?: string; secret?: boolean }

// Load cost of a page (measured in a hidden window before and after a run).
export interface PerfMetrics { js: number; css: number; requests: number; nodes: number; lcp: number; cls: number }

// Size of the production build's JS and CSS.
export interface BuildSize { js: number; css: number; jsGzip: number; cssGzip: number; files: number; at: number }

export interface Pin { id: string; url: string; label: string; pinnedAt: number; checkedAt?: number; pct?: number; changed?: boolean; error?: string; areas?: string[] }

// A component found in the project, for the workspace.
export interface ComponentProp { name: string; required: boolean; type: 'string' | 'number' | 'boolean' | 'enum' | 'node' | 'other'; options?: string[]; default?: string | number | boolean }
export interface ComponentEntry { name: string; file: string; isDefault: boolean; props: ComponentProp[] }

// A "view as" profile: its own browser storage (so its own login), plus settings applied to pages shown under it.
export interface Profile { id: string; name: string; locale?: string; timezone?: string; flags?: string; headers?: string }

// A request being handled in a separate copy of the project.
export interface BgRun { id: string; title: string; status: 'running' | 'done' | 'failed'; step?: string; summary?: string; files?: FileChange[]; shot?: boolean }

export interface UpdateState { status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error'; version?: string; percent?: number; url?: string; manual?: boolean }

export type NetworkMode = 'normal' | 'slow' | 'hang' | 'error' | 'offline';

// A request someone annotated for a developer to run, saved as one file.
export interface Handoff {
  pinpointHandoff: 1; createdAt: number; url: string; title: string; viewport?: { width: number; height: number };
  instruction: string; annotations: Annotation[];
}

export interface Rect { x: number; y: number; width: number; height: number }

export interface ElementInfo {
  uid: string;
  selector: string;
  tag: string;
  id?: string;
  classes?: string[];
  text: string;
  html?: string;
  styles?: Record<string, string>;
  path?: string;
  rect: Rect;
  source?: SourceInfo | null;
  tokens?: Record<string, string>; // css property -> the design token its value comes from
  component?: ComponentInfo | null;
  rules?: CssRuleInfo[];
  leaf?: boolean; // contains only text, so its copy can be edited in place
}

export interface Annotation {
  id: string;
  n: number;
  kind: 'element' | 'drawing' | 'sketch' | 'reference' | 'flow';
  steps?: FlowStep[];   // a recorded interaction
  startUrl?: string;
  name?: string; // reference image file name
  note: string;
  color: string;
  image?: string; // PNG data URL
  element?: ElementInfo;
  region?: Rect;
  hits?: ElementInfo[];
  viewport?: { width: number; height: number };
  tabId?: string;                   // the browser tab it was made in
  pageUrl?: string;                 // the page it was made on (a request can span several tabs)
  tweaks?: Record<string, string>;  // live style edits applied in the page: css property -> value
  states?: ForcedState[];           // states forced on the element while it was inspected
  scope?: 'instance' | 'component'; // change just this one, or the component everywhere
  textEdit?: { from: string; to: string };                    // copy edited in place
  classEdit?: { from: string; to: string };                   // class list edited in place
  propEdits?: Record<string, { from: string; to: string }>;   // component props changed live
  reorder?: { from: number; to: number; count: number; before?: string | null }; // dragged to a new place among its siblings
}

export type ChatItem =
  | { kind: 'user'; id: string; text: string; annotations: Annotation[]; agent: AgentId; steer?: 'queue' | 'now' | 'later'; variants?: number; background?: boolean }
  | { kind: 'text'; id: string; text: string; streaming?: boolean }
  | { kind: 'thinking'; id: string; text: string; streaming?: boolean }
  | { kind: 'tool'; id: string; toolId: string; name: string; detail: string; status: 'running' | 'ok' | 'error'; output?: string }
  | { kind: 'error'; id: string; text: string }
  | { kind: 'status'; id: string; text: string }
  | {
    kind: 'done'; id: string; runId: string; ok: boolean; cost?: number; durationMs?: number; changes: FileChange[]; undone?: boolean; commit?: GitCommit | null; shots?: boolean;
    verify?: boolean;                           // the automatic check of the previous run
    variant?: { index: number; total: number }; // one of several takes on the same request
    routeCheck?: RouteCheckResult[];            // other pages, compared before and after
    perf?: { before: PerfMetrics; after: PerfMetrics }; // the open page's load cost
    build?: { now: BuildSize; previous: BuildSize | null }; // production build size, measured on request
    visual?: 'none' | 'changed'; // whether the page on screen looked any different afterwards
    instant?: boolean;           // written straight to the source, no agent
    background?: boolean;        // came from a background run
  }
  | { kind: 'variants'; id: string; options: { runId: string; index: number; files: number }[]; chosen?: string | null }
  | { kind: 'memory'; id: string; text: string; status: 'pending' | 'saved' | 'dismissed' };

export interface ModelOption { id: string; label: string; desc?: string; efforts: string[]; defaultEffort?: string }
export type ModelCatalog = Record<AgentId, { models: ModelOption[]; defaultLabel: string; defaultModel?: string; defaultEffort?: string }>;

export interface GitCommit { hash: string; subject: string }
export interface GitStatus {
  repo: boolean; root?: string; branch?: string; defaultBranch?: string; remote?: string | null; hasCommits?: boolean;
  dirty?: number; ahead?: number; behind?: number; upstream?: boolean;
  gh: { installed: boolean; authed: boolean; user: string | null };
}

// A shell installed on this computer, and a terminal running one.
export interface TermShell { id: string; name: string; path: string; args: string[] }
export interface TermSession { id: string; shell: string; name: string; exited: boolean; cols: number; rows: number }

// A chat of this project that isn't the one on screen but is working, or finished unseen.
export interface OtherChat { id: string; title: string; running: boolean }

export interface FileChange { path: string; kind: 'add' | 'modify' | 'delete'; reverted?: boolean; add?: number; del?: number }

export interface DiffFile {
  path: string;
  kind: FileChange['kind'];
  reverted: boolean;
  binary: boolean;
  tooLarge: boolean;
  before: string | null;
  after: string | null;
}
export interface RevertResult { restored: string[]; conflicts: string[]; failed: string[]; allReverted: boolean }

export interface ChatMeta { id: string; title: string; createdAt: number; updatedAt: number; count: number; agent?: AgentId }
export interface Chat {
  id: string; title: string; createdAt: number; updatedAt: number; agent: AgentId;
  session: { id: string; agent: AgentId } | null;
  designAtStart?: string | null; // DESIGN.md as sent at the start of the agent session
  items: ChatItem[];
}

export interface MemoryItem { id: string; text: string; enabled: boolean; createdAt: number }
export interface DesignDoc { path: string; exists: boolean; content: string }
export interface RouteInfo { route: string; file: string; framework: string; dynamic: boolean }

export interface ConsoleEntry { level: 'error' | 'warning'; message: string; source?: string; line?: number; count: number; at: number; file?: string; fileLine?: number } // file: the project file the source maps back to
export interface NetworkFailure { url: string; method: string; status?: number; error?: string; resourceType?: string; at: number }

export interface Settings {
  agent: AgentId;
  claudePath: string;
  codexPath: string;
  claudePermission: 'plan' | 'acceptEdits' | 'bypassPermissions';
  codexSandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  claudeModel: string;
  claudeEffort: string;
  codexModel: string;
  codexEffort: string;
  projectDir: string;
  url: string;
  devCommand: string;
  recentProjects: string[];
  panelSide: 'left' | 'right';
  panelWidth: number;
  terminalShell?: string;        // the shell new terminals start in
  panelHidden: boolean;
  drawerHeight: number;
  useDesign: boolean;
  useMemory: boolean;
  editorCommand: string;
  gitBranchPerChat: boolean;
  gitAutoCommit: boolean;
  tabs?: string[];
  tabProfiles?: string[];
  activeTab?: number;
  autoVerify: boolean;
  variants: number;
  routeCheck: boolean;
  a11yCheck: boolean;
  perfCheck: boolean;
  layoutOverlay: boolean;
}

export type AgentEvent =
  | { runId: string; type: 'status'; text: string }
  | { runId: string; type: 'session'; sessionId: string; model?: string }
  | { runId: string; type: 'text'; text: string }
  | { runId: string; type: 'text_delta'; text: string }
  | { runId: string; type: 'thinking_delta'; text: string }
  | { runId: string; type: 'thinking'; text: string }
  | { runId: string; type: 'tool'; id: string; name: string; detail: string }
  | { runId: string; type: 'tool_result'; id: string; ok: boolean; text: string }
  | { runId: string; type: 'file'; path: string; kind: string }
  | { runId: string; type: 'log'; text: string }
  | { runId: string; type: 'error'; text: string }
  | { runId: string; type: 'done'; ok: boolean; cost?: number; durationMs?: number; changes: FileChange[]; commit?: GitCommit | null }
  | { runId: string; type: 'git'; branch: string }
  | { runId: string; type: 'routes'; results: RouteCheckResult[]; perf?: { before: PerfMetrics; after: PerfMetrics } | null };

export type DevEvent =
  | { type: 'log'; text: string }
  | { type: 'url'; url: string }
  | { type: 'started'; pid: number }
  | { type: 'exit'; code: number | null };

export interface DevCandidate { command: string; label: string; dir: string; script?: string; port: number | null }
export interface DevDetection { command: string; candidates: DevCandidate[]; runningUrl: string | null }

export interface PinpointAPI {
  platform: 'darwin' | 'win32' | 'linux' | string;
  onFullscreen(cb: (fs: boolean) => void): () => void;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  detectAgents(): Promise<Record<AgentId, { ok: boolean; version?: string }>>;
  modelCatalog(): Promise<ModelCatalog>;
  pickFolder(): Promise<string | null>;
  openPath(p: string): Promise<string>;
  capture(webContentsId: number, rect?: Rect, jpeg?: boolean): Promise<string>;
  runAgent(args: { runId: string; request: unknown; sessionId?: string | null; check?: { routes: { route: string; url: string; current?: boolean }[]; currentFile?: string; perfUrl?: string; targets?: string[]; partition?: string } }): Promise<{ requestDir: string }>;
  cancelAgent(runId: string): Promise<boolean>;
  steerAgent(args: { runId: string; steerId: string; request: unknown; mode: 'queue' | 'now' }): Promise<{ delivered: boolean }>;
  openFile(rel: string, line?: number): Promise<{ via: string }>;
  runDiff(runId: string): Promise<DiffFile[]>;
  revertRun(runId: string, paths?: string[] | null, force?: boolean): Promise<RevertResult>;
  applyRun(runId: string): Promise<RevertResult>;
  forceState(webContentsId: number, selector: string, classes: string[]): Promise<number>;
  emulate(webContentsId: number, env: PageEnv & { focus: boolean; touch?: boolean }): Promise<boolean>;
  designSystem(): Promise<DesignSystem | null>;
  componentUsage(name: string): Promise<{ count: number; files: string[]; fileCount?: number }>;
  a11ySource(): Promise<string>;
  matchedRules(webContentsId: number, uid: string): Promise<CssRuleInfo[]>;
  setAnimationRate(webContentsId: number, rate: number): Promise<boolean>;
  setNetwork(webContentsId: number, mode: NetworkMode): Promise<boolean>;
  findStory(name: string): Promise<{ file: string | null; storybook: boolean; url: string | null; canStart: boolean }>;
  startStorybook(name: string): Promise<string | null>;
  replay(webContentsId: number, steps: FlowStep[]): Promise<{ done: number; total: number }>;
  tailwindCss(classes: string[]): Promise<string | null>;
  measureBuild(pageUrl?: string): Promise<{ now: BuildSize; previous: BuildSize | null; restarted?: boolean }>;
  prewarmRoutes(list: { route: string; url: string; current?: boolean }[], partition?: string): Promise<boolean>;
  instantPlan(annotation: unknown): Promise<{ ok: boolean; summary?: string[]; files?: string[]; reason?: string }>;
  instantApply(runId: string, annotation: unknown): Promise<{ changes: FileChange[]; summary: string[] }>;
  listComponents(): Promise<ComponentEntry[]>;
  readProfiles(): Promise<Profile[]>;
  writeProfiles(list: Profile[]): Promise<Profile[]>;
  applyProfile(webContentsId: number, settings: { locale: string; timezone: string; headers: Record<string, string> }): Promise<boolean>;
  enginesStatus(): Promise<{ ready: boolean; installed: string[] }>;
  enginesInstall(): Promise<{ ready: boolean; installed: string[] }>;
  onEnginesProgress(cb: (text: string) => void): () => void;
  enginesShoot(args: { webContentsId: number; url: string; width: number; height: number }): Promise<Record<string, string | { error: string }>>;
  bgBlocker(): Promise<string | null>;
  bgStart(args: { id: string; request: unknown }): Promise<boolean>;
  bgDiff(id: string): Promise<string>;
  bgShot(id: string): Promise<string | null>;
  bgApply(args: { id: string; runId: string; instruction: string }): Promise<{ changes: FileChange[] }>;
  bgDiscard(id: string): Promise<boolean>;
  onBgEvent(cb: (e: { id: string; type: 'step' | 'done'; text?: string; ok?: boolean; files?: FileChange[]; summary?: string; shot?: boolean }) => void): () => void;
  updateState(): Promise<UpdateState>;
  updateInstall(): Promise<boolean>;
  nudgeAgent(runId: string): Promise<boolean>;
  termShells(): Promise<TermShell[]>;
  termList(): Promise<TermSession[]>;
  termOpen(opts: { shell?: string; cwd?: string; cols: number; rows: number }): Promise<TermSession>;
  termAttach(id: string): Promise<(TermSession & { buffer: string }) | null>;
  termWrite(id: string, data: string): void;
  termResize(id: string, cols: number, rows: number): void;
  termClose(id: string): void;
  onTermData(cb: (e: { id: string; data: string }) => void): () => void;
  onTermExit(cb: (e: { id: string; code: number }) => void): () => void;
  onUpdateState(cb: (s: UpdateState) => void): () => void;
  listPins(): Promise<Pin[]>;
  addPin(pin: { url: string; label: string }): Promise<Pin[]>;
  checkPins(): Promise<Pin[]>;
  pinImages(id: string): Promise<{ before: string | null; after: string | null }>;
  acceptPin(id: string): Promise<Pin[]>;
  removePin(id: string): Promise<Pin[]>;
  saveHandoff(name: string, data: Handoff): Promise<string | null>;
  openHandoff(): Promise<Handoff | null>;
  handoffIssue(args: { title: string; body: string; attach?: { name: string; data: Handoff } }): Promise<{ url: string; gist: string | null }>;
  listChats(): Promise<ChatMeta[]>;
  loadChat(id: string): Promise<Chat | null>;
  saveChat(chat: Chat): Promise<boolean>;
  deleteChat(id: string): Promise<boolean>;
  readDesign(): Promise<DesignDoc>;
  writeDesign(content: string): Promise<DesignDoc>;
  readMemory(): Promise<MemoryItem[]>;
  writeMemory(items: MemoryItem[]): Promise<MemoryItem[]>;
  listRoutes(): Promise<RouteInfo[]>;
  resolveSourceMap(frame: { url: string; line: number; column: number }): Promise<{ file: string; line?: number; column?: number } | null>;
  onNetworkError(cb: (e: NetworkFailure) => void): () => void;
  onNewTab(cb: (url: string) => void): () => void;
  gitStatus(): Promise<GitStatus>;
  gitInit(): Promise<GitStatus>;
  gitBranch(hint?: string): Promise<{ branch: string }>;
  gitCommitRun(runId: string): Promise<GitCommit>;
  gitCommitAll(message: string): Promise<GitCommit>;
  gitOpenPR(args: { title: string; body: string; draft?: boolean }): Promise<{ url: string; existed: boolean }>;
  saveShot(runId: string, name: string, dataUrl: string): Promise<boolean>;
  runShots(runId: string): Promise<Record<string, string>>;
  onAgentEvent(cb: (e: AgentEvent) => void): () => void;
  startDev(command: string): Promise<boolean>;
  detectDev(): Promise<DevDetection>;
  stopDev(): Promise<boolean>;
  onDevEvent(cb: (e: DevEvent) => void): () => void;
}

declare global {
  interface Window { pinpoint: PinpointAPI }
}
