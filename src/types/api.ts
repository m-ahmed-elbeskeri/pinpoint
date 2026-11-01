import type { TranscriptEvent } from '../components/agent/Transcript';
import type { AgentEvent, AgentId, DevDetection, HarnessInfo, ModelCatalog, SideEvent } from './agent';
import type { ApprovalDecision, Chat, ChatMeta, DiffFile, FileChange, Handoff, MemoryItem, RevertResult } from './chat';
import type { BranchCompare, GitBranchInfo, GitCommit, GitPull, GitStatus } from './git';
import type { ApiHandler, BuildSize, ComponentEntry, CssRuleInfo, DesignSystem, FlowStep, NetworkFailure, NetworkMode, PageEnv, Pin, Profile, Rect, ReviewComment, ReviewState, RouteInfo, SweepEvent } from './page';
import type { DesignDoc, Settings, UpdateState } from './settings';
import type { AgentExtensions, InstructionFile } from './agent';

interface GitWorktree { path: string; open: string; branch: string | null; main: boolean; current: boolean }
interface GitSwitchResult { branch?: string; worktree?: string; parked?: number; restored?: boolean; conflict?: string | null }

export interface TermShell { id: string; name: string; path: string; args: string[] }
export interface TermSession { id: string; shell: string; name: string; exited: boolean; cols: number; rows: number }

type DevEvent =
  | { type: 'log'; text: string }
  | { type: 'url'; url: string }
  | { type: 'started'; pid: number }
  | { type: 'exit'; code: number | null }
  | { type: 'service'; command: string; running: boolean };

export interface PinpointAPI {
  platform: 'darwin' | 'win32' | 'linux' | string;
  onFullscreen(cb: (fs: boolean) => void): () => void;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  detectAgents(): Promise<Record<AgentId, { ok: boolean; version?: string }>>;
  knownAgents(): Promise<Record<AgentId, { ok: boolean; version?: string }> | null>;
  modelCatalog(): Promise<ModelCatalog>;
  listAgents(): Promise<HarnessInfo[]>;
  pathForFile(file: File): string;
  notify(title: string, body: string): Promise<boolean>;
  badge(count: number): Promise<boolean>;
  projectFiles(): Promise<string[]>;
  setWindowTheme(light: boolean): Promise<boolean>;
  pickFolder(known?: string): Promise<string | null>;
  openPath(p: string): Promise<string>;
  siteHints(): Promise<{ homepage: string | null }>;
  capture(webContentsId: number, rect?: Rect, jpeg?: boolean): Promise<string>;
  runAgent(args: { runId: string; request: unknown; sessionId?: string | null; check?: { routes: { route: string; url: string; current?: boolean }[]; currentFile?: string; perfUrl?: string; targets?: string[]; partition?: string } }): Promise<{ requestDir: string }>;
  cancelAgent(runId: string): Promise<boolean>;
  steerAgent(args: { runId: string; steerId: string; request: unknown; mode: 'queue' | 'now' }): Promise<{ delivered: boolean }>;
  openFile(rel: string, line?: number): Promise<{ via: string }>;
  runDiff(runId: string): Promise<DiffFile[]>;
  revertRun(runId: string, paths?: string[] | null, force?: boolean): Promise<RevertResult>;
  revertHunk(runId: string, path: string, index: number): Promise<RevertResult>;
  applyRun(runId: string): Promise<RevertResult>;
  forceState(webContentsId: number, selector: string, classes: string[]): Promise<number>;
  emulate(webContentsId: number, env: PageEnv & { focus: boolean; touch?: boolean }): Promise<boolean>;
  designSystem(): Promise<DesignSystem | null>;
  componentUsage(name: string): Promise<{ count: number; files: string[]; fileCount?: number }>;
  a11ySource(): Promise<string>;
  matchedRules(webContentsId: number, uid: string): Promise<CssRuleInfo[]>;
  setAnimationRate(webContentsId: number, rate: number): Promise<boolean>;
  setNetwork(webContentsId: number, mode: NetworkMode): Promise<boolean>;
  setMocks(webContentsId: number, mocks: { method: string; path: string; status: number; body: string }[]): Promise<boolean>;
  findHandler(url: string, method: string): Promise<ApiHandler | null>;
  serverLogMark(): Promise<number>;
  serverLogSince(offset: number): Promise<string>;
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
  onBgEvent(cb: (e: { id: string; type: 'step' | 'done' | 'agent'; text?: string; ok?: boolean; files?: FileChange[]; summary?: string; shot?: boolean; event?: TranscriptEvent }) => void): () => void;
  bgAsk(args: { id: string; text: string; context: string }): Promise<boolean>;
  bgStop(id: string): Promise<boolean>;
  reviewStart(url: string): Promise<ReviewState>;
  reviewStop(): Promise<ReviewState>;
  reviewState(): Promise<ReviewState>;
  onReviewComment(cb: (c: ReviewComment) => void): () => void;
  variantsLive(args: { runIds: string[]; page: string }): Promise<{ runId: string; url: string | null }[]>;
  variantsClose(): Promise<boolean>;
  onVariantsProgress(cb: (text: string) => void): () => void;
  sweepStart(args: { pages: { route: string; url: string }[]; partition?: string; crawl?: boolean }): Promise<boolean>;
  sweepStop(): Promise<boolean>;
  onSweepEvent(cb: (e: SweepEvent) => void): () => void;
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
  listChatsFor(dir: string): Promise<ChatMeta[]>;
  patchChat(id: string, patch: { renamed?: string | null; pinned?: boolean; archived?: boolean }): Promise<boolean>;
  searchChats(q: string): Promise<{ id: string; title: string; updatedAt: number; snippet: string }[]>;
  exportChat(id: string): Promise<string | null>;
  shareChat(id: string): Promise<string | null>;
  receiveChat(): Promise<string | null>;
  readProjectFile(rel: string): Promise<{ binary: boolean; size: number; text: string; truncated: boolean }>;
  projectChanges(): Promise<Record<string, 'M' | 'A' | 'D'>>;
  openProjectWindow(dir: string): Promise<boolean>;
  tray(state: { working: number; waiting: number; chats: { id: string; title: string; state: string }[] }): Promise<boolean>;
  onTrayChat(cb: (id: string) => void): () => void;
  draftPR(args: { draft: string; base?: string }): Promise<string>;
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
  gitStatus(opts?: { fast?: boolean }): Promise<GitStatus>;
  gitInit(): Promise<GitStatus>;
  gitBranch(hint?: string): Promise<{ branch: string }>;
  gitCommitRun(runId: string): Promise<GitCommit>;
  gitCommitAll(message: string): Promise<GitCommit>;
  gitOpenPR(args: { title: string; body: string; draft?: boolean; base?: string; shots?: { runId: string; label: string }[] }): Promise<{ url: string; existed: boolean; shots?: number }>;
  gitBranches(): Promise<{ branches: GitBranchInfo[]; worktrees: GitWorktree[] }>;
  gitPulls(): Promise<Record<string, GitPull>>;
  gitCompare(args: { base: string; working?: boolean; remote?: boolean }): Promise<BranchCompare>;
  gitFetch(): Promise<GitStatus>;
  gitPull(): Promise<GitStatus>;
  gitPush(): Promise<GitStatus>;
  gitOpenUrl(url: string): Promise<boolean>;
  gitSwitch(name: string): Promise<GitSwitchResult>;
  gitNewBranch(name: string): Promise<{ branch: string }>;
  gitWorktreeAdd(args: { branch: string; create?: boolean }): Promise<{ open: string; existed: boolean }>;
  gitWorktreeRemove(dir: string): Promise<{ branch: string | null }>;
  gitOpenWorktree(dir: string): Promise<{ dir: string; branch: string | null; restarted: boolean }>;
  saveShot(runId: string, name: string, dataUrl: string): Promise<boolean>;
  runShots(runId: string, names?: string[]): Promise<Record<string, string>>;
  onAgentEvent(cb: (e: AgentEvent) => void): () => void;
  approve(runId: string, approvalId: string, decision: ApprovalDecision): Promise<boolean>;
  sideAsk(args: { sideId: string; question: string; context: string; sessionId: string | null }): Promise<boolean>;
  sideCancel(sideId: string): Promise<boolean>;
  onSideEvent(cb: (e: SideEvent) => void): () => void;
  startDev(command: string): Promise<boolean>;
  detectDev(): Promise<DevDetection>;
  stopDev(): Promise<boolean>;
  cachedExtensions(): Promise<AgentExtensions | null>;
  listExtensions(): Promise<AgentExtensions>;
  readInstructions(): Promise<InstructionFile[]>;
  writeInstructions(key: string, content: string): Promise<boolean>;
  startService(command: string, label: string): Promise<boolean>;
  stopService(command: string): Promise<boolean>;
  onDevEvent(cb: (e: DevEvent) => void): () => void;
}

declare global {
  interface Window { pinpoint: PinpointAPI }
}
