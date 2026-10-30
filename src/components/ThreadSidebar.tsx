import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Keyboard, Moon, Sun, ChevronRight, Command, DotsThree, Download, FolderOpen, Pencil, Pin, Loader2, PanelLeft, Plus, Search, Settings as SettingsIcon, SquarePen, Trash2, X } from './icons';
import { Logo } from './Logo';
import type { ChatMeta, OtherChat } from '../lib/types';


interface Props {
  mod: string;
  projectDir: string;
  recentProjects: string[];
  chatId: string | null;
  currentTitle: string;
  currentRunning: boolean;
  currentNeedsInput: boolean;
  others: OtherChat[];
  refreshKey: unknown;
  disabled: boolean;
  onOpen(id: string): void;
  onDelete(id: string): void;
  onNew(): void;
  onPickProject(dir?: string): void;
  onOpenIn(dir: string, chatId: string): void;
  onSettings(): void;
  onPalette(): void;
  onTheme(): void;
  onShortcuts(): void;
  light: boolean;
  onHide(): void;
}

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
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  useEffect(() => {
    if (!menuFor) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.thread-menu, .thread-more')) { setMenuFor(null); setConfirm(null); } };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuFor]);
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
    const rows = chats.map((c) => (c.id === p.chatId && !c.renamed ? { ...c, title: p.currentTitle || c.title } : c));
    if (p.chatId && p.currentTitle && !rows.some((c) => c.id === p.chatId)) rows.unshift({ id: p.chatId, title: p.currentTitle, createdAt: Date.now(), updatedAt: Date.now(), count: 0 });
    const q = query.trim().toLowerCase();
    return rows.filter((c) => !q || (c.title || 'Untitled').toLowerCase().includes(q)).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [chats, p.chatId, p.currentTitle, query]);

  const archivedCount = list.filter((c) => c.archived).length;
  const groups = useMemo(() => {
    const out: { label: string; items: ChatMeta[] }[] = [];
    const pinned = list.filter((c) => c.pinned && !c.archived);
    if (pinned.length) out.push({ label: 'Pinned', items: pinned });
    for (const c of list) {
      if ((c.pinned && !c.archived) || (c.archived && !showArchived)) continue;
      const label = c.archived ? 'Archived' : group(c.updatedAt);
      const g = out.find((x) => x.label === label);
      if (g) g.items.push(c); else out.push({ label, items: [c] });
    }
    return out;
  }, [list, showArchived]);

  const patch = (id: string, change: { renamed?: string | null; pinned?: boolean; archived?: boolean }) => {
    setChats((cs) => cs.map((c) => (c.id !== id ? c : {
      ...c,
      ...('pinned' in change && { pinned: !!change.pinned }),
      ...('archived' in change && { archived: !!change.archived }),
      ...('renamed' in change && { renamed: !!change.renamed, title: change.renamed || c.title }),
    })));
    window.pinpoint.patchChat(id, change).catch(() => {});
  };
  const commitRename = () => {
    if (!renaming) return;
    const name = renaming.value.trim();
    patch(renaming.id, { renamed: name || null });
    setRenaming(null);
  };

  const askDelete = (id: string) => {
    if (confirm === id || menuFor === null) {
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

        {p.projectDir && list.length === 0 && (
          <div className="threads-empty">{query ? 'No chats match' : 'No chats yet'}</div>
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
                  {renaming?.id === c.id ? (
                    <input
                      className="thread-rename" autoFocus value={renaming.value} onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenaming({ id: c.id, value: e.target.value })} onBlur={commitRename}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }}
                    />
                  ) : <span className="thread-title">{c.pinned && <Pin size={10} className="thread-pinned" />}{c.title || 'Untitled'}</span>}
                  <span className={`thread-time ${c.failed && !running ? 'failed' : ''}`}>{waiting ? 'needs you' : running ? 'working' : finished ? 'done' : c.failed ? 'failed' : ago(c.updatedAt)}</span>
                  <button
                    className={`thread-x thread-more ${menuFor === c.id ? 'open' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setConfirm(null); setMenuFor(menuFor === c.id ? null : c.id); }}
                    title="More"
                  >
                    <DotsThree size={14} />
                  </button>
                  {menuFor === c.id && (
                    <div className="thread-menu" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setMenuFor(null); setRenaming({ id: c.id, value: c.title || '' }); }}><Pencil size={13} /> Rename</button>
                      <button onClick={() => { setMenuFor(null); patch(c.id, { pinned: !c.pinned }); }}><Pin size={13} /> {c.pinned ? 'Unpin' : 'Pin to top'}</button>
                      <button onClick={() => { setMenuFor(null); patch(c.id, { archived: !c.archived }); }}><Archive size={13} /> {c.archived ? 'Unarchive' : 'Archive'}</button>
                      <button onClick={() => { setMenuFor(null); window.pinpoint.exportChat(c.id).catch(() => null); }}><Download size={13} /> Export as Markdown…</button>
                      <button className="danger" onClick={() => { if (confirm === c.id) { setMenuFor(null); askDelete(c.id); } else setConfirm(c.id); }}>
                        <Trash2 size={13} /> {confirm === c.id ? 'Click again to delete' : 'Delete'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {archivedCount > 0 && !query && (
          <button className="threads-more" onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}</button>
        )}

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
        <button onClick={p.onPalette} title={`Commands (${p.mod}+K)`}><Command size={15} /><span>Commands</span></button>
        <button onClick={p.onTheme} title={p.light ? 'Switch to dark' : 'Switch to light'}>{p.light ? <Moon size={15} /> : <Sun size={15} />}<span>Theme</span></button>
        <button onClick={p.onShortcuts} title="Keyboard shortcuts (?)"><Keyboard size={15} /><span>Shortcuts</span></button>
        <div className="spacer" />
        <button onClick={p.onSettings} title={`Settings (${p.mod}+,)`}><SettingsIcon size={15} /><span>Settings</span></button>
      </div>
    </aside>
  );
}
