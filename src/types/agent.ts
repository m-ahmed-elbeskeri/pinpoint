import type { FileChange, PlanStep, RouteCheckResult, ToolEdit } from './chat';
import type { GitCommit } from './git';
import type { PerfMetrics } from './page';

export type AgentId = 'claude' | 'codex' | (string & {});

interface AccessOption { value: string; label: string; desc?: string }
export interface HarnessInfo { id: AgentId; name: string; bin: string; custom?: boolean; steerable?: boolean; resumes?: boolean; access?: AccessOption[]; defaultAccess?: string }
export interface CustomAgent { id: string; name: string; command: string; args: string }

interface ModelOption { id: string; label: string; desc?: string; efforts: string[]; defaultEffort?: string }
export type ModelCatalog = Partial<Record<AgentId, { models: ModelOption[]; defaultLabel: string; defaultModel?: string; defaultEffort?: string }>>;

export type AgentEvent =
  | { runId: string; type: 'status'; text: string }
  | { runId: string; type: 'session'; sessionId: string; model?: string }
  | { runId: string; type: 'text'; text: string }
  | { runId: string; type: 'text_delta'; text: string }
  | { runId: string; type: 'thinking_delta'; text: string }
  | { runId: string; type: 'thinking'; text: string }
  | { runId: string; type: 'tool'; id: string; name: string; detail: string; edits?: ToolEdit[]; parent?: string }
  | { runId: string; type: 'plan'; steps: PlanStep[] }
  | { runId: string; type: 'usage'; used: number; window?: number }
  | { runId: string; type: 'limits'; status: 'ok' | 'warning' | 'rejected'; used?: number; resetsAt?: number; window?: string }
  | { runId: string; type: 'mcp'; servers: { name: string; status: string }[] }
  | { runId: string; type: 'approval'; approvalId: string; tool: string; detail: string }
  | { runId: string; type: 'tool_result'; id: string; ok: boolean; text: string }
  | { runId: string; type: 'file'; path: string; kind: string }
  | { runId: string; type: 'log'; text: string }
  | { runId: string; type: 'error'; text: string }
  | { runId: string; type: 'done'; ok: boolean; cost?: number; durationMs?: number; changes: FileChange[]; commit?: GitCommit | null }
  | { runId: string; type: 'git'; branch: string }
  | { runId: string; type: 'routes'; results: RouteCheckResult[]; perf?: { before: PerfMetrics; after: PerfMetrics } | null };

export type SideEvent = DistributiveOmit<AgentEvent, 'runId'> & { sideId: string; sessionId?: string };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface DevCandidate { command: string; label: string; dir: string; script?: string; port: number | null; kind?: 'web' | 'api' | 'worker' | 'stack' | 'other' }
export interface DevDetection { command: string; candidates: DevCandidate[]; runningUrl: string | null }

export interface AgentExtension { id: string; name: string; description?: string; status?: string; scope: 'project' | 'user' | 'connector' | 'plugin'; enabled: boolean }
export interface AgentExtensions { supported: boolean; mcp: AgentExtension[]; skills: AgentExtension[] }
export interface InstructionFile { key: string; label: string; scope: string; path: string; exists: boolean; content: string }
