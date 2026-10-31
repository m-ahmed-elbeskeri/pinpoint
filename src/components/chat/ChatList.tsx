import { memo, useMemo, type ReactNode } from 'react';
import type { ChatItem } from '../../types';
import { ChatRow } from './items/ChatRow';
import { Approved, SubSteps } from './ToolRow';
import type { ChatActions, ItemOf } from './types';
import { WorkLog, isStep } from './WorkLog';

// Under a request: what the turn changed, with a jump to its result.
function TurnSummary({ done, onReview }: { done: ItemOf<'done'>; onReview(runId: string, path?: string): void }) {
  const n = done.changes.length;
  const add = done.changes.reduce((s, c) => s + (c.add || 0), 0), del = done.changes.reduce((s, c) => s + (c.del || 0), 0);
  return (
    <div className="turn-summary">
      <button onClick={() => document.getElementById(`done-${done.id}`)?.scrollIntoView({ block: 'center' })} title="Jump to the result">{n} file{n > 1 ? 's' : ''} changed <i className="add">+{add}</i> <i className="del">−{del}</i> ↓</button>
      {done.changes.slice(0, 3).map((c) => <button key={c.path} className="mono" onClick={() => onReview(done.runId, c.path)} title={`Review ${c.path}`}>{c.path.split('/').pop()}</button>)}
      {n > 3 && <span>+{n - 3}</span>}
    </div>
  );
}

// After a finished run: one-click follow-ups.
function QuickReplies({ ok, onSend }: { ok: boolean; onSend(text: string): void }) {
  const replies = ok
    ? ['Continue', 'Make it more subtle', 'Explain what you changed']
    : ['Try again', 'What went wrong?', 'Try a different approach'];
  return (
    <div className="quick-replies">
      {replies.map((r) => <button key={r} onClick={() => onSend(r)}>{r}</button>)}
    </div>
  );
}

export const ChatList = memo(function ChatList({ items, actions, root, busy, gitRepo }: {
  items: ChatItem[]; actions: ChatActions; root: string; busy: boolean; gitRepo: boolean;
}) {
  const subs = useMemo(() => {
    const m = new Map<string, ItemOf<'tool'>[]>();
    for (const it of items) if (it.kind === 'tool' && it.parent) m.set(it.parent, [...(m.get(it.parent) || []), it]);
    return m;
  }, [items]);
  if (subs.size) items = items.filter((it) => !(it.kind === 'tool' && it.parent));
  const approved = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach((it, i) => {
      if (it.kind !== 'approval' || it.status === 'pending') return;
      const step = items.slice(i + 1, i + 6).find((x) => x.kind === 'tool' && x.name === it.tool);
      if (step) m.set(step.id, it.status === 'allow' ? 'allowed once' : it.status === 'always' ? 'always allowed' : it.status === 'deny' ? 'denied' : 'not answered');
    });
    return m;
  }, [items]);
  // The approval card itself is folded into that step once answered.
  if (approved.size) items = items.filter((it, i) => !(it.kind === 'approval' && it.status !== 'pending' && items.slice(i + 1, i + 6).some((x) => x.kind === 'tool' && approved.has(x.id) && x.name === it.tool)));
  let lastDone = -1;
  if (busy) items.forEach((it, i) => { if (it.kind === 'done') lastDone = i; });
  const out: ReactNode[] = [];
  for (let i = 0; i < items.length;) {
    if (isStep(items[i])) {
      let j = i;
      while (j < items.length && isStep(items[j])) j++;
      const steps = items.slice(i, j);
      if (steps.filter((s) => s.kind === 'tool').length >= 3) {
        out.push(<WorkLog key={`log-${steps[0].id}`} steps={steps} live={busy && j === items.length} root={root} actions={actions} busy={busy} gitRepo={gitRepo} />);
        i = j;
        continue;
      }
    }
    const item = items[i];
    out.push(<ChatRow key={item.id} item={item} live={busy && i > lastDone && (item.kind === 'user' || item.kind === 'plan')} root={root} busy={busy} gitRepo={gitRepo} actions={actions} />);
    if (item.kind === 'user') {
      const rest = items.slice(i + 1);
      const end = rest.findIndex((x) => x.kind === 'user');
      const turn = end < 0 ? rest : rest.slice(0, end);
      const done = turn.find((x): x is ItemOf<'done'> => x.kind === 'done' && x.changes.length > 0 && !x.undone);
      // Only worth it when the result is a scroll away.
      if (done && turn.length >= 4) out.push(<TurnSummary key={`sum-${item.id}`} done={done} onReview={actions.onReview} />);
    }
    i++;
  }
  const last = items[items.length - 1];
  if (!busy && last?.kind === 'done' && !last.undone && !last.variant) out.push(<QuickReplies key="quick" ok={last.ok} onSend={actions.onSendText} />);
  return <SubSteps.Provider value={subs}><Approved.Provider value={approved}>{out}</Approved.Provider></SubSteps.Provider>;
});
