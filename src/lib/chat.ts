import type { Breakpoint } from '../components/DeviceBar';
import type { FrameTarget } from '../components/BrowserView';
import { uid } from './draw';
import type { A11yIssue, AgentId, Annotation, ChatItem, ConsoleEntry, FlowResult, NetworkFailure, PageEnv, PlanStep, RequestNote } from './types';

export interface AgentRequest {
  url: string; title: string; viewport: { width: number; height: number; responsive?: boolean };
  breakpoints?: Breakpoint[];
  instruction: string; overview?: string;
  annotations: Omit<Annotation, 'id' | 'color'>[];
  diagnostics?: { console: ConsoleEntry[]; network: NetworkFailure[]; devLog: string; a11y?: A11yIssue[]; overlay?: string; serverLog?: string };
  route?: { path: string; file: string; framework: string };
  env?: PageEnv & { frozen: boolean; states?: string[]; profile?: { name: string; detail: string } };
  variant?: { index: number; total: number };
  verify?: { before?: string; after: string; same?: boolean; requests?: { method: string; url: string; before?: { status?: number }; after: { status: number; body: string; error?: string } }[]; flow?: FlowResult };
  note?: string;
  site?: { kind: 'live' | 'built'; local?: string };
  carried?: string;
}

// The conversation as plain text, for an agent session that wasn't part of it. Keeps the end when it's too long.
export function conversationText(items: ChatItem[], limit: number) {
  const lines: string[] = [];
  for (const it of items) {
    if (it.kind === 'user') lines.push(`User: ${[it.text, ...it.annotations.map((a) => a.note)].filter(Boolean).join(' / ')}`);
    else if (it.kind === 'text') lines.push(`Agent: ${it.text}`);
    else if (it.kind === 'done') lines.push(`(Run ${it.ok ? 'finished' : 'failed'}; changed ${it.changes.map((c) => c.path).join(', ') || 'nothing'})`);
    else if (it.kind === 'status' && /^(Run |Handed over)/.test(it.text)) lines.push(`(${it.text})`);
  }
  return lines.join('\n').slice(-limit);
}

export interface RunMeta { site?: 'live' | 'built'; match?: number; variant?: { index: number; total: number }; verify?: boolean; startedAt?: number; frame?: { targets: FrameTarget[]; y: number }; requests?: RequestNote[]; devAnchor?: string; logMark?: number }

export function mergeRequests(reqs: AgentRequest[]): AgentRequest {
  const last = reqs[reqs.length - 1];
  let n = 0;
  return {
    ...last,
    instruction: reqs.map((r) => r.instruction).filter(Boolean).join('\n\n'),
    annotations: reqs.flatMap((r) => r.annotations.map((a) => ({ ...a, n: ++n }))),
    overview: last.overview ?? reqs.find((r) => r.overview)?.overview,
  };
}

export type Delta = { kind: 'text' | 'thinking'; text: string };
export function mergeDeltas(items: ChatItem[], buf: Delta[]): ChatItem[] {
  if (!buf.length) return items;
  const next = [...items];
  for (const d of buf) {
    const last = next[next.length - 1];
    if (last && last.kind === d.kind && last.streaming) next[next.length - 1] = { ...last, text: last.text + d.text };
    else next.push({ kind: d.kind, id: uid(), text: d.text, streaming: true, ...(d.kind === 'thinking' && { at: Date.now() }) });
  }
  return next;
}
export function finalizeItems(c: ChatItem[], kind: 'text' | 'thinking', text: string, extra: ChatItem[] = []): ChatItem[] {
  let i = -1;
  for (let j = c.length - 1; j >= 0; j--) { const it = c[j]; if (it.kind === kind && it.streaming) { i = j; break; } }
  const prev = i >= 0 ? c[i] : null;
  const at = prev?.kind === 'thinking' ? prev.at : undefined;
  const done: ChatItem[] = text ? [kind === 'thinking' ? { kind, id: prev?.id ?? uid(), text, at, ms: at ? Date.now() - at : undefined } : { kind, id: prev?.id ?? uid(), text }] : [];
  if (i >= 0) return [...c.slice(0, i), ...done, ...c.slice(i + 1), ...extra];
  return [...c, ...done, ...extra];
}
export function splitMemory(text: string): { text: string; extra: ChatItem[] } {
  const m = text.match(/^\s*`?REMEMBER:\s*(.+?)`?\s*$/m);
  return m ? { text: text.replace(m[0], '').trim(), extra: [{ kind: 'memory', id: uid(), text: m[1].trim(), status: 'pending' }] } : { text, extra: [] };
}
export function chatTitle(items: ChatItem[]) {
  const first = items.find((c) => c.kind === 'user') as Extract<ChatItem, { kind: 'user' }> | undefined;
  return (first?.text || first?.annotations.map((a) => a.note).find(Boolean) || `${first?.annotations.length || 0} annotation(s)`).slice(0, 80);
}
export interface ParkedChat {
  id: string; createdAt: number; items: ChatItem[]; session: { id: string; agent: AgentId } | null;
  designAtStart: string | null; runId: string | null; agent: AgentId;
}

export const INTERRUPTED = 'This run was interrupted: Pinpoint closed before it finished. Files it already edited stay edited.';

export function healChat(items: ChatItem[]): ChatItem[] {
  const noted = (it: ChatItem) => it.kind === 'error' && it.text === INTERRUPTED;
  let seen = false;
  const once = items.filter((it) => { if (!noted(it)) { seen = false; return true; } const keep = !seen; seen = true; return keep; });
  const list = once.length === items.length ? items : once;
  let lastUser = -1;
  list.forEach((it, i) => { if (it.kind === 'user') lastUser = i; });
  if (lastUser < 0 || list.slice(lastUser).some((it) => it.kind === 'done' || noted(it))) return expireApprovals(list);
  return [
    ...expireApprovals(list).map((it) => (it.kind === 'tool' && it.status === 'running' ? { ...it, status: 'error' as const } : it)),
    { kind: 'error', id: uid(), text: INTERRUPTED },
  ];
}

// The agent's to-do list belongs to the current turn: update that turn's plan card, or add one.
export function applyPlan(items: ChatItem[], steps: PlanStep[]): ChatItem[] {
  let start = 0;
  items.forEach((it, i) => { if (it.kind === 'user') start = i; });
  const at = items.findIndex((it, i) => i >= start && it.kind === 'plan');
  if (at >= 0) return items.map((it, i) => (i === at ? { ...it, steps } : it));
  return [...items, { kind: 'plan', id: uid(), steps }];
}

// Questions the agent asked but never got an answer to (the run ended first).
export function expireApprovals(items: ChatItem[]): ChatItem[] {
  return items.some((it) => it.kind === 'approval' && it.status === 'pending')
    ? items.map((it) => (it.kind === 'approval' && it.status === 'pending' ? { ...it, status: 'expired' as const } : it))
    : items;
}

export const needsInput = (items: ChatItem[]) => items.some((it) => it.kind === 'approval' && it.status === 'pending');
