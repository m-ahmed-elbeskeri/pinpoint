import { createContext, useContext, useMemo, useState } from 'react';
import { structuredPatch } from 'diff';
import { ChevronRight, FilePlus2, FileText, Globe, Loader2, Pencil, Search, Terminal, Wrench, XCircle } from '../ui/icons';
import { secs } from '../../lib/time';
import { shortPath } from '../../lib/util';
import type { ToolEdit } from '../../types';
import type { ItemOf } from './types';

const toolIcon = (name: string) => {
  if (/^(Edit|MultiEdit|NotebookEdit)$/.test(name)) return Pencil;
  if (/^Write$/.test(name)) return FilePlus2;
  if (/^(Read)$/.test(name)) return FileText;
  if (/^(Bash|Shell|PowerShell)$/.test(name)) return Terminal;
  if (/^(Grep|Glob|LS|Search)$/.test(name)) return Search;
  if (/Web/.test(name)) return Globe;
  return Wrench;
};

// Lines of a step's change, as unified-diff lines: from the edit itself (Claude) or the diff it printed (Codex).
function stepDiff(item: ItemOf<'tool'>): string[] | null {
  if (item.edits?.length) {
    return item.edits.flatMap((e: ToolEdit, i) => [
      ...(i ? ['@@'] : []),
      ...structuredPatch('a', 'b', e.old, e.new, '', '', { context: 2 }).hunks.flatMap((h) => h.lines).filter((l) => !l.startsWith('\\')),
    ]);
  }
  if (item.output && /^(@@ |diff --git|--- |\+\+\+ )/m.test(item.output)) return item.output.split('\n');
  return null;
}

// Steps a subagent took, keyed by the Task step that started it.
export const SubSteps = createContext<Map<string, ItemOf<'tool'>[]>>(new Map());
// Answers to permission questions, shown on the step they were about.
export const Approved = createContext<Map<string, string>>(new Map());

export function ToolRow({ item, root }: { item: ItemOf<'tool'>; root: string }) {
  const [open, setOpen] = useState(false);
  const subs = useContext(SubSteps).get(item.toolId) || [];
  const approved = useContext(Approved).get(item.id);
  const Icon = toolIcon(item.name);
  const diff = useMemo(() => stepDiff(item), [item.edits, item.output]);
  const added = diff?.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length ?? 0;
  const removed = diff?.filter((l) => l.startsWith('-') && !l.startsWith('---')).length ?? 0;
  return (
    <div className={`tool-row ${item.status}`}>
      <button className="tool-head" onClick={() => (item.output || diff || subs.length) && setOpen(!open)}>
        <Icon size={13} className="tool-icon" />
        <span className="tool-name">{item.name}</span>
        <span className="tool-detail">{shortPath(item.detail, root)}</span>
        {approved && <span className="tool-approved">{approved}</span>}
        {subs.length > 0 && <span className="tool-ms">{subs.length} step{subs.length === 1 ? '' : 's'}</span>}
        {item.ms != null && item.ms >= 1500 && <span className="tool-ms">{secs(item.ms)}</span>}
        {diff && (added > 0 || removed > 0) && <span className="df-stat"><i className="add">+{added}</i><i className="del">−{removed}</i></span>}
        {item.status === 'running' ? <Loader2 size={13} className="spin" />
          : item.status === 'error' ? <XCircle size={13} className="err" /> : null}
        {item.output || diff || subs.length ? <ChevronRight size={13} className={`chev ${open ? 'open' : ''}`} /> : null}
      </button>
      {open && subs.length > 0 && <div className="lane">{subs.map((x) => <ToolRow key={x.id} item={x} root={root} />)}</div>}
      {open && diff && (
        <pre className="tool-output step-diff">{diff.map((l, i) => <span key={i} className={l.startsWith('@@') ? 'meta' : l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : ''}>{l + '\n'}</span>)}</pre>
      )}
      {open && !diff && item.output && !subs.length && <pre className="tool-output">{item.output}</pre>}
    </div>
  );
}
