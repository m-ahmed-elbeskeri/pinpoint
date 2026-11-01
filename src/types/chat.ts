import type { TranscriptItem } from '../components/agent/Transcript';
import type { AgentId } from './agent';
import type { GitCommit } from './git';
import type { BuildSize, ElementInfo, FlowResult, FlowStep, ForcedState, PerfMetrics, Rect, RequestNote } from './page';

export interface RouteCheckResult {
  route: string; key: string; pct: number; changed: boolean;
  current?: boolean;
  areas?: string[];
  asked?: string[];
}

export interface BgRun { id: string; title: string; status: 'running' | 'done' | 'failed'; step?: string; summary?: string; files?: FileChange[]; shot?: boolean; parent: string | null; items: TranscriptItem[] }

export interface Handoff {
  pinpointHandoff: 1; createdAt: number; url: string; title: string; viewport?: { width: number; height: number };
  instruction: string; annotations: Annotation[];
}

export interface Annotation {
  id: string;
  n: number;
  kind: 'element' | 'drawing' | 'sketch' | 'reference' | 'flow' | 'request' | 'note';
  request?: RequestNote;
  steps?: FlowStep[];
  seen?: { errors: string[]; failed: string[] };
  startUrl?: string;
  name?: string;
  note: string;
  color: string;
  image?: string;
  element?: ElementInfo;
  region?: Rect;
  hits?: ElementInfo[];
  viewport?: { width: number; height: number };
  tabId?: string;
  pageUrl?: string;
  tweaks?: Record<string, string>;
  states?: ForcedState[];
  scope?: 'instance' | 'component';
  textEdit?: { from: string; to: string };
  classEdit?: { from: string; to: string };
  propEdits?: Record<string, { from: string; to: string }>;
  reorder?: { from: number; to: number; count: number; before?: string | null };
}

export interface PlanStep { text: string; status: 'pending' | 'in_progress' | 'completed' }
export interface ToolEdit { old: string; new: string }
export type ApprovalDecision = 'allow' | 'always' | 'deny';

export type ChatItem =
  | { kind: 'user'; id: string; text: string; annotations: Annotation[]; agent: AgentId; steer?: 'queue' | 'now' | 'later'; variants?: number; background?: boolean }
  | { kind: 'text'; id: string; text: string; streaming?: boolean }
  | { kind: 'thinking'; id: string; text: string; streaming?: boolean; at?: number; ms?: number }
  | { kind: 'tool'; id: string; toolId: string; name: string; detail: string; status: 'running' | 'ok' | 'error'; output?: string; edits?: ToolEdit[]; at?: number; ms?: number; parent?: string }
  | { kind: 'plan'; id: string; steps: PlanStep[] }
  | { kind: 'approval'; id: string; runId: string; approvalId: string; tool: string; detail: string; status: 'pending' | ApprovalDecision | 'expired' }
  | { kind: 'error'; id: string; text: string }
  | { kind: 'status'; id: string; text: string }
  | {
    kind: 'done'; id: string; runId: string; ok: boolean; cost?: number; durationMs?: number; changes: FileChange[]; undone?: boolean; commit?: GitCommit | null; shots?: boolean;
    verify?: boolean;
    variant?: { index: number; total: number };
    routeCheck?: RouteCheckResult[];
    perf?: { before: PerfMetrics; after: PerfMetrics };
    build?: { now: BuildSize; previous: BuildSize | null };
    visual?: 'none' | 'changed';
    instant?: boolean;
    background?: boolean;
    unseen?: 'live' | 'built';
    flow?: FlowResult;
  }
  | { kind: 'variants'; id: string; options: { runId: string; index: number; files: number }[]; chosen?: string | null }
  | { kind: 'memory'; id: string; text: string; status: 'pending' | 'saved' | 'dismissed' };

export interface OtherChat { id: string; title: string; running: boolean; needsInput?: boolean }

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

export interface ChatMeta { id: string; title: string; createdAt: number; updatedAt: number; count: number; agent?: AgentId; renamed?: boolean; pinned?: boolean; archived?: boolean; failed?: boolean; branch?: string }
export interface Chat {
  id: string; title: string; createdAt: number; updatedAt: number; agent: AgentId; branch?: string;
  session: { id: string; agent: AgentId } | null;
  designAtStart?: string | null;
  items: ChatItem[];
}

export interface MemoryItem { id: string; text: string; enabled: boolean; createdAt: number; shared?: boolean }
