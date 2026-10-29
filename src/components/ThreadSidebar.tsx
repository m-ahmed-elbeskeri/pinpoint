import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Command, FolderOpen, Loader2, PanelLeft, Plus, Search, Settings as SettingsIcon, Square, SquarePen, Trash2, X } from './icons';
import { Logo } from './Logo';
import type { ChatMeta, OtherChat } from '../lib/types';

export interface RunningTask {
  id: string;
  kind: 'chat' | 'bg' | 'dev' | 'term' | 'side';
  label: string;
  detail?: string;
  status: 'running' | 'done' | 'failed';
  onOpen?(): void;
  onStop?(): void;
}

interface Props {
  mod: string;
  projectDir: string;
  recentProjects: string[];
  chatId: string | null;
  currentTitle: string;
  currentRunning: boolean;
  currentNeedsInput: boolean;
  others: OtherChat[];
  tasks: RunningTask[];
  refreshKey: unknown;
  disabled: boolean;
  onOpen(id: string): void;
  onDelete(id: string): void;
  onNew(): void;
  onPickProject(dir?: string): void;
  onOpenIn(dir: string, chatId: string): void;
  onSettings(): void;
  onPalette(): void;
  onHide(): void;
}

const KIND: Record<RunningTask['kind'], string> = { chat: 'chat', bg: 'background', dev: 'dev server', term: 'terminal', side: 'side chat' };

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;

export function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function group(t: number) {
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const d = day.getTime();
  if (t >= d) return 'Today';
  if (t >= d - 86400000) return 'Yesterday';
  if (t >= d - 86400000 * 7) return 'This week';
  return 'Older';
}

export function ThreadSidebar(p: Props) {
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, ChatMeta[] | null>>({});
  const toggleProject = (dir: string) => {
    if (expanded[dir] !== undefined) { setExpanded(({ [dir]: _, ...rest }) => rest); return; }
    setExpanded((e) => ({ ...e, [dir]: null }));
    window.pinpoint.listChatsFor(dir).then((list) => setExpanded((e) => (dir in e ? { ...e, [dir]: list.sort((a, b) => b.updatedAt - a.updatedAt) } : e))).catch(() => setExpanded((e) => ({ ...e, [dir]: [] })));
  };
  const confirmTimer = useRef(0);

  useEffect(() => {
    if (!p.projectDir) { setChats([]); return; }
    const t = setTimeout(() => { window.pinpoint.listChats().then(setChats).catch(() => setChats([])); }, 250);
    return () => clearTimeout(t);
  }, [p.projectDir, p.refreshKey]);

  const list = useMemo(() => {
    const rows = chats.map((c) => (c.id === p.chatId ? { ...c, title: p.currentTitle || c.title } : c));
    if (p.chatId && p.currentTitle && !rows.some((c) => c.id === p.chatId)) rows.unshift({ id: p.chatId, title: p.currentTitle, createdAt: Date.now(), updatedAt: Date.now(), count: 0 });
    const q = query.trim().toLowerCase();
    return rows.filter((c) => !q || (c.title || 'Untitled').toLowerCase().includes(q)).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [chats, p.chatId, p.currentTitle, query]);

  const groups = useMemo(() => {
    const out: { label: string; items: ChatMeta[] }[] = [];
    for (const c of list) {
      const label = group(c.updatedAt);
      const g = out.find((x) => x.label === label);
      if (g) g.items.push(c); else out.push({ label, items: [c] });
    }
    return out;
  }, [list]);

  const askDelete = (id: string) => {
    if (confirm === id) {
      clearTimeout(confirmTimer.current);
      setConfirm(null);
      p.onDelete(id);
      setChats((cs) => cs.filter((c) => c.id !== id));
      return;
    }
    setConfirm(id);
    clearTimeout(confirmTimer.current);
    confirmTimer.current = window.setTimeout(() => setConfirm(null), 2500);
  };

  const otherProjects = p.recentProjects.filter((d) => d !== p.projectDir);

  return (
    <aside className="threads">
      <div className="threads-head">
        <span className="threads-brand"><Logo size={18} /> Pinpoint</span>
        <div className="spacer" />
        <button className="icon-btn xs" onClick={p.onHide} title={`Hide chats (${p.mod}+Shift+B)`}><PanelLeft size={15} /></button>
      </div>

      <div className="threads-actions">
        <button className="threads-new" onClick={p.onNew} disabled={p.disabled || !p.projectDir} title={`New chat (${p.mod}+Shift+O)`}>
          <SquarePen size={15} /><span>New chat</span><kbd>{p.mod}⇧O</kbd>
        </button>
        <label className="threads-search">
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" spellCheck={false} onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }} />
          {query && <button onClick={() => setQuery('')} title="Clear"><X size={12} /></button>}
        </label>
      </div>

      <div className="threads-scroll">
        <button className="proj-row current" onClick={() => p.onPickProject()} title={p.projectDir || 'Choose the project folder the agent edits'}>
          <FolderOpen size={14} /><span>{p.projectDir ? base(p.projectDir) : 'Open a project'}</span>
        </button>

        {p.tasks.length > 0 && (
          <div className="thread-group tasks">
            <div className="threads-label">Running</div>
            {p.tasks.map((t) => (
              <div key={t.id} className={`task ${t.status}`} onClick={t.onOpen} title={t.detail || t.label}>
                <i className="thread-state">{t.status === 'running' ? <Loader2 size={12} className="spin" /> : t.status === 'done' ? <Check size={12} /> : <X size={12} />}</i>
                <span className="thread-title">{t.label}</span>
                <span className="task-kind">{t.detail || KIND[t.kind]}</span>
                {t.onStop && (
                  <button className="thread-x" onClick={(e) => { e.stopPropagation(); t.onStop!(); }} title="Stop"><Square size={10} weight="fill" /></button>
                )}
              </div>
            ))}
          </div>
        )}

        {p.projectDir && list.length === 0 && (
          <div className="threads-empty">{query ? 'No chats match.' : 'No chats yet. Point at something on the page and send it.'}</div>
        )}
        {groups.map((g) => (
          <div key={g.label} className="thread-group">
            <div className="threads-label">{g.label}</div>
            {g.items.map((c) => {
              const other = p.others.find((o) => o.id === c.id);
              const on = c.id === p.chatId;
              const running = on ? p.currentRunning : !!other?.running;
              const finished = !on && other && !other.running;
              const waiting = on ? p.currentNeedsInput : !!other?.needsInput;
              return (
                <div
                  key={c.id}
                  className={`thread history-item ${on ? 'on' : ''} ${running ? 'running' : ''} ${finished ? 'finished' : ''} ${waiting ? 'waiting' : ''}`}
                  onClick={() => !on && !p.disabled && p.onOpen(c.id)}
                  title={running ? 'Working…' : finished ? 'Finished. Click to see the result.' : c.title || 'Untitled'}
                >
                  <i className="thread-state">{running ? <Loader2 size={12} className="spin" /> : null}</i>
                  <span className="thread-title">{c.title || 'Untitled'}</span>
                  <span className="thread-time">{waiting ? 'needs you' : running ? 'working' : finished ? 'done' : ago(c.updatedAt)}</span>
                  <button
                    className={`thread-x ${confirm === c.id ? 'confirm' : ''}`}
                    onClick={(e) => { e.stopPropagation(); askDelete(c.id); }}
                    title={confirm === c.id ? 'Click again to delete' : 'Delete chat'}
                  >
                    {confirm === c.id ? <Check size={12} /> : <Trash2 size={12} />}
                  </button>
                </div>
              );
            })}
          </div>
        ))}

        <div className="threads-label projects">Projects</div>
        {otherProjects.map((d) => {
          const kids = expanded[d];
          return (
            <div key={d} className="proj-node">
              <div className={`proj-row ${kids !== undefined ? 'open' : ''}`} onClick={() => toggleProject(d)} title={d}>
                <ChevronRight size={12} className="proj-chev" /><FolderOpen size={14} /><span>{base(d)}</span>
                <button className="proj-go" onClick={(e) => { e.stopPropagation(); p.onPickProject(d); }} disabled={p.disabled} title="Switch to this project">Open</button>
              </div>
              {kids === null && <div className="threads-empty nested">Loading…</div>}
              {kids && kids.length === 0 && <div className="threads-empty nested">No chats yet</div>}
              {kids && kids.slice(0, 8).map((c) => (
                <div key={c.id} className="thread nested" onClick={() => !p.disabled && p.onOpenIn(d, c.id)} title={c.title || 'Untitled'}>
                  <i className="thread-state" />
                  <span className="thread-title">{c.title || 'Untitled'}</span>
                  <span className="thread-time">{ago(c.updatedAt)}</span>
                </div>
              ))}
            </div>
          );
        })}
        <button className="proj-row add" onClick={() => p.onPickProject()} disabled={p.disabled}><Plus size={14} /><span>Open folder…</span></button>
      </div>

      <div className="threads-foot">
        <button onClick={p.onPalette} title={`Commands (${p.mod}+K)`}><Command size={14} /><span>Commands</span><kbd>{p.mod}K</kbd></button>
        <button onClick={p.onSettings} title="Settings"><SettingsIcon size={14} /><span>Settings</span></button>
      </div>
    </aside>
  );
}
