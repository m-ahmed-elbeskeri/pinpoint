import { useState } from 'react';
import { ChevronRight, Loader2, Wrench, XCircle } from '../ui/icons';
import { secs } from '../../lib/time';
import { shortPath } from '../../lib/util';
import type { ChatItem } from '../../types';
import { ChatRow } from './items/ChatRow';
import type { ChatActions } from './types';

export const isStep = (it: ChatItem) => it.kind === 'tool' || it.kind === 'thinking';
const STEP_KINDS: [RegExp, string, string][] = [
  [/^(Edit|MultiEdit|NotebookEdit|Write)$/, 'edit', 'edits'],
  [/^Read$/, 'read', 'reads'],
  [/^(Grep|Glob|LS|Search)$/, 'search', 'searches'],
  [/^(Bash|Shell|PowerShell)$/, 'command', 'commands'],
];

function stepSummary(steps: ChatItem[]) {
  const counts = new Map<string, number>();
  for (const s of steps) {
    if (s.kind !== 'tool') continue;
    const k = STEP_KINDS.find(([re]) => re.test(s.name));
    const key = k ? k[1] : 'other';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const parts = [...counts].filter(([k]) => k !== 'other').map(([k, n]) => {
    const kind = STEP_KINDS.find((x) => x[1] === k)!;
    return `${n} ${n === 1 ? kind[1] : kind[2]}`;
  });
  return parts.length > 3 ? `${parts.slice(0, 3).join(' · ')} +${parts.length - 3}` : parts.join(' · ');
}

export function WorkLog({ steps, live, root, actions, busy, gitRepo }: { steps: ChatItem[]; live: boolean; root: string; actions: ChatActions; busy: boolean; gitRepo: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = open ?? live;
  const tools = steps.filter((s) => s.kind === 'tool');
  const failed = tools.some((t) => t.kind === 'tool' && t.status === 'error');
  const last = [...tools].reverse()[0];
  const summary = stepSummary(steps);
  const first = steps.find((s) => s.kind === 'tool' && s.at);
  const ends = steps.map((s) => (s.kind === 'tool' && s.at ? s.at + (s.ms || 0) : 0));
  const took = !live && first?.kind === 'tool' && first.at ? Math.max(...ends) - first.at : 0;
  return (
    <div className={`work-log ${shown ? 'open' : ''} ${live ? 'live' : ''}`}>
      <button className="work-head" onClick={() => setOpen(!shown)}>
        {live ? <Loader2 size={13} className="spin" /> : <Wrench size={13} className="work-icon" />}
        <span className={`work-title ${live ? 'shimmer' : ''}`}>{live ? 'Working' : took >= 1000 ? `Worked ${secs(took)}` : 'Worked'} · {tools.length} step{tools.length === 1 ? '' : 's'}</span>
        <span className="work-sum">{live && !shown && last?.kind === 'tool' ? `${last.name} ${shortPath(last.detail, root)}` : summary}</span>
        {failed && <XCircle size={13} className="err" />}
        <ChevronRight size={13} className={`chev ${shown ? 'open' : ''}`} />
      </button>
      {shown && <div className="work-body">{steps.map((s) => <ChatRow key={s.id} item={s} live={false} root={root} busy={busy} gitRepo={gitRepo} actions={actions} />)}</div>}
    </div>
  );
}
