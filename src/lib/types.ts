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
}

export interface Annotation {
  id: string;
  n: number;
  kind: 'element' | 'drawing' | 'sketch' | 'reference';
  name?: string; // reference image file name
  note: string;
  color: string;
  image?: string; // PNG data URL
  element?: ElementInfo;
  region?: Rect;
  hits?: ElementInfo[];
  viewport?: { width: number; height: number };
}

export type ChatItem =
  | { kind: 'user'; id: string; text: string; annotations: Annotation[]; agent: AgentId; steer?: 'queue' | 'now' | 'later' }
  | { kind: 'text'; id: string; text: string; streaming?: boolean }
  | { kind: 'thinking'; id: string; text: string; streaming?: boolean }
  | { kind: 'tool'; id: string; toolId: string; name: string; detail: string; status: 'running' | 'ok' | 'error'; output?: string }
  | { kind: 'error'; id: string; text: string }
  | { kind: 'status'; id: string; text: string }
  | { kind: 'done'; id: string; runId: string; ok: boolean; cost?: number; durationMs?: number; changes: FileChange[]; undone?: boolean; commit?: GitCommit | null; shots?: boolean }
  | { kind: 'memory'; id: string; text: string; status: 'pending' | 'saved' | 'dismissed' };

export interface ModelOption { id: string; label: string; desc?: string; efforts: string[]; defaultEffort?: string }
export type ModelCatalog = Record<AgentId, { models: ModelOption[]; defaultLabel: string; defaultModel?: string; defaultEffort?: string }>;

export interface GitCommit { hash: string; subject: string }
export interface GitStatus {
  repo: boolean; root?: string; branch?: string; defaultBranch?: string; remote?: string | null; hasCommits?: boolean;
  dirty?: number; ahead?: number; behind?: number; upstream?: boolean;
  gh: { installed: boolean; authed: boolean; user: string | null };
}

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

export interface ConsoleEntry { level: 'error' | 'warning'; message: string; source?: string; line?: number; count: number; at: number }
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
  panelHidden: boolean;
  drawerHeight: number;
  useDesign: boolean;
  useMemory: boolean;
  editorCommand: string;
  gitBranchPerChat: boolean;
  gitAutoCommit: boolean;
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
  | { runId: string; type: 'git'; branch: string };

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
  capture(webContentsId: number, rect?: Rect): Promise<string>;
  runAgent(args: { runId: string; request: unknown; sessionId?: string | null }): Promise<{ requestDir: string }>;
  cancelAgent(runId: string): Promise<boolean>;
  steerAgent(args: { runId: string; steerId: string; request: unknown; mode: 'queue' | 'now' }): Promise<{ delivered: boolean }>;
  openFile(rel: string, line?: number): Promise<{ via: string }>;
  runDiff(runId: string): Promise<DiffFile[]>;
  revertRun(runId: string, paths?: string[] | null, force?: boolean): Promise<RevertResult>;
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
