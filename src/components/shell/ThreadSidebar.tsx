import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowRight, GitFork, SquareStack, XCircle, ClipboardCopy, ExternalLink, TerminalSquare, Keyboard, Moon, Sun, ChevronRight, Command, DotsThree, Download, Folder, FolderOpen, Pencil, Pin, Loader2, NewWindow, PanelLeft, Plus, Search, Settings as SettingsIcon, SquarePen, Trash2, Users, X } from '../ui/icons';
import { PullIcon } from '../git/PullIcon';
import { Logo } from './Logo';
import type { ChatMeta, GitPull, OtherChat } from '../../types';
import { useDismiss } from '../../lib/hooks';
import { agoLong, agoShort } from '../../lib/time';


export interface SubChat { id: string; kind: 'side' | 'task'; title: string; parent: string | null; running: boolean; failed?: boolean; on: boolean; hint: string }

interface Props {
  subChats: SubChat[];
  onOpenSub(s: SubChat): void;
  mod: string;
  projectDir: string;
  recentProjects: string[];
  chatId: string | null;
  currentTitle: string;
  currentRunning: boolean;
  currentNeedsInput: boolean;
  others: OtherChat[];
  pulls: Record<string, GitPull>;
  refreshKey: unknown;
  disabled: boolean;
  onOpen(id: string): void;
  onDelete(id: string): void;
  onNew(): void;
  onPickProject(dir?: string): void;
  onOpenIn(dir: string, chatId: string): void;
  onForgetProject(dir: string): void;
  pinnedProjects: string[];
  onPinProject(dir: string, pinned: boolean): void;
  onSettings(): void;
  onPalette(): void;
  onTheme(): void;
  onShortcuts(): void;
  onTerminal(): void;
  light: boolean;
  onHide(): void;
  onResizeStart(e: React.PointerEvent): void;
  onResizeReset(): void;
  resizing: boolean;
}

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;

const fullDate = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// Each project lists this many chats before "Show more".
const SHOWN = 6;

// Which project folders are open in the tree, kept across restarts.
const OPEN_KEY = 'pinpoint.sidebar.open';
function readOpen(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {}; } catch { return {}; }
}

export function ThreadSidebar(p: Props) {
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  useDismiss(!!menuFor, () => { setMenuFor(null); setConfirm(null); }, { ignore: '.thread-menu, .thread-more, .thread-more-free' });

  // Every recent project is a folder in the tree; the one in this window opens by default.
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>(readOpen);
  const searching = !!query.trim();
  const isOpen = (dir: string) => searching || (openDirs[dir] ?? dir === p.projectDir);
  const [lists, setLists] = useState<Record<string, ChatMeta[] | null>>({});
  const load = (dir: string) => {
    setLists((l) => ({ ...l, [dir]: l[dir] ?? null }));
    window.pinpoint.listChatsFor(dir).then((list) => setLists((l) => ({ ...l, [dir]: list.sort((a, b) => b.updatedAt - a.updatedAt) }))).catch(() => setLists((l) => ({ ...l, [dir]: [] })));
  };
  const toggleProject = (dir: string) => {
    const opening = !isOpen(dir);
    setOpenDirs((o) => {
      const next = { ...o, [dir]: opening };
      try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* private window */ }
      return next;
    });
    if (opening && dir !== p.projectDir && lists[dir] === undefined) load(dir);
  };
  const confirmTimer = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const kb = useRef(-1);
  const walk = (e: React.KeyboardEvent) => {
    const rows = [...(scroller.current?.querySelectorAll<HTMLElement>('.thread') || [])];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      kb.current = Math.max(0, Math.min(rows.length - 1, kb.current + (e.key === 'ArrowDown' ? 1 : -1)));
      rows.forEach((r, i) => r.classList.toggle('kb', i === kb.current));
      rows[kb.current].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && rows[kb.current]) rows[kb.current].click();
    else if (e.key === 'Escape') setQuery('');
  };
  useEffect(() => { kb.current = -1; scroller.current?.querySelectorAll('.thread.kb').forEach((r) => r.classList.remove('kb')); }, [query]);

  useEffect(() => {
    if (!p.projectDir) { setChats([]); return; }
    const t = setTimeout(() => { window.pinpoint.listChats().then(setChats).catch(() => setChats([])); }, 250);
    return () => clearTimeout(t);
  }, [p.projectDir, p.refreshKey]);

  // Pinned projects lead, in the order they were pinned; the rest follow most recent first.
  const otherProjects = [...p.pinnedProjects.filter((d) => d !== p.projectDir && p.recentProjects.includes(d)), ...p.recentProjects.filter((d) => d !== p.projectDir && !p.pinnedProjects.includes(d))];
  useEffect(() => {
    // Folders left open last time fill in on start, and again after a project switch.
    setLists({});
    for (const d of otherProjects) if (readOpen()[d]) load(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.projectDir]);
  useEffect(() => {
    // Searching looks through every project, so fetch the ones never opened.
    if (searching) for (const d of otherProjects) if (lists[d] === undefined) load(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching]);

  const q = query.trim().toLowerCase();
  const matches = (c: ChatMeta) => !q || (c.title || 'Untitled').toLowerCase().includes(q);

  const list = useMemo(() => {
    const rows = chats.map((c) => (c.id === p.chatId && !c.renamed ? { ...c, title: p.currentTitle || c.title } : c));
    if (p.chatId && p.currentTitle && !rows.some((c) => c.id === p.chatId)) rows.unshift({ id: p.chatId, title: p.currentTitle, createdAt: Date.now(), updatedAt: Date.now(), count: 0 });
    return rows.filter(matches).sort((a, b) => b.updatedAt - a.updatedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats, p.chatId, p.currentTitle, q]);

  // Pinned chats lead, archived ones trail and stay hidden until asked for.
  const archivedCount = list.filter((c) => c.archived).length;
  const ordered = useMemo(() => [
    ...list.filter((c) => c.pinned && !c.archived),
    ...list.filter((c) => !c.pinned && !c.archived),
    ...(showArchived ? list.filter((c) => c.archived) : []),
  ], [list, showArchived]);

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

  const stateOf = (c: ChatMeta) => {
    const other = p.others.find((o) => o.id === c.id);
    const on = c.id === p.chatId;
    return { on, running: on ? p.currentRunning : !!other?.running, finished: !on && !!other && !other.running, waiting: on ? p.currentNeedsInput : !!other?.needsInput };
  };

  // Side chats and background tasks sit under the chat that started them.
  // While searching, a side chat shows only if its own title matches.
  const listed = new Set(chats.filter((c) => !c.archived || showArchived).map((c) => c.id));
  const subs = p.subChats.filter((s) => !q || s.title.toLowerCase().includes(q));
  const loose = subs.filter((s) => !s.parent || !listed.has(s.parent) || (q && !ordered.some((c) => c.id === s.parent)));
  const subRow = (s: SubChat) => (
    <div key={s.id} className={`thread sub-chat ${s.kind} ${s.on ? 'on' : ''} ${s.running ? 'running' : ''} ${s.failed ? 'failed' : ''}`} onClick={() => p.onOpenSub(s)} title={`${s.title}\n${s.kind === 'side' ? 'Side chat' : 'Background task'}${s.running ? ', working' : s.failed ? ', stopped' : ''}`}>
      <i className="thread-state">{s.running ? <Loader2 size={11} className="spin" /> : s.failed ? <XCircle size={11} /> : s.kind === 'task' ? <SquareStack size={11} /> : <GitFork size={11} />}</i>
      <span className="thread-title">{s.title}</span>
      {/file/.test(s.hint) && <span className="thread-time">{s.hint}</span>}
    </div>
  );

  const fileManager = window.pinpoint.platform === 'darwin' ? 'Finder' : window.pinpoint.platform === 'win32' ? 'File Explorer' : 'file manager';
  const projectMenu = (dir: string, current: boolean) => menuFor === `proj:${dir}` && (
    <div className="thread-menu proj-menu">
      {!current && <button onClick={() => { setMenuFor(null); window.pinpoint.openProjectWindow(dir).catch(() => {}); }}><NewWindow size={13} /> Open in a new window</button>}
      <button onClick={() => { setMenuFor(null); window.pinpoint.openPath(dir); }}><FolderOpen size={13} /> Show in {fileManager}</button>
      {current && <button onClick={() => { setMenuFor(null); window.pinpoint.openFile('.').catch(() => {}); }}><ExternalLink size={13} /> Open in your editor</button>}
      {current && <button onClick={() => { setMenuFor(null); p.onTerminal(); }}><TerminalSquare size={13} /> Open a terminal here</button>}
      <button onClick={() => { setMenuFor(null); navigator.clipboard?.writeText(dir); }}><ClipboardCopy size={13} /> Copy path</button>
      <button onClick={() => { setMenuFor(null); p.onPinProject(dir, !p.pinnedProjects.includes(dir)); }}><Pin size={13} /> {p.pinnedProjects.includes(dir) ? 'Unpin' : 'Pin to top'}</button>
      {!current && <>
        <div className="dd-sep" />
        <button disabled={p.disabled} onClick={() => { setMenuFor(null); p.onPickProject(dir); }}><ArrowRight size={13} /> Switch this window to it</button>
        <button onClick={() => { setMenuFor(null); p.onForgetProject(dir); }} title="Take it off this list. The folder and its chats stay on disk."><X size={13} /> Remove from sidebar</button>
      </>}
    </div>
  );

  // Two folders both called "web" get their parent folder alongside, so they can be told apart.
  const allDirs = p.projectDir ? [p.projectDir, ...otherProjects] : otherProjects;
  const parentOf = (dir: string) => base(dir.slice(0, dir.length - base(dir).length).replace(/[\\/]+$/, ''));
  const projectRow = (dir: string, current: boolean) => {
    const open = isOpen(dir);
    const twin = allDirs.some((d) => d !== dir && base(d).toLowerCase() === base(dir).toLowerCase());
    return (
      <div className={`proj-row ${open ? 'open' : ''} ${current ? 'current' : ''} ${menuFor === `proj:${dir}` ? 'menu-open' : ''}`} onClick={() => toggleProject(dir)} title={dir}>
        <i className="proj-icon">
          {open ? <FolderOpen size={15} /> : <Folder size={15} />}
          <ChevronRight size={11} className="proj-chev" />
        </i>
        <span className="proj-name">{base(dir)}{twin && <small> · {parentOf(dir)}</small>}</span>
        {p.pinnedProjects.includes(dir) && <Pin size={10} className="proj-pin" />}
        {current && !open && <ProjectStatus states={list.filter((c) => !c.archived).map(stateOf)} />}
        <span className="proj-tools">
          <button className="thread-more-free" onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === `proj:${dir}` ? null : `proj:${dir}`); }} title="More"><DotsThree size={14} /></button>
          {current
            ? <button onClick={(e) => { e.stopPropagation(); p.onNew(); }} disabled={p.disabled} title={`New chat in ${base(dir)}`}><SquarePen size={13} /></button>
            : <button onClick={(e) => { e.stopPropagation(); window.pinpoint.openProjectWindow(dir).catch(() => {}); }} title="Open in a new window, so both projects run side by side"><NewWindow size={13} /></button>}
        </span>
      </div>
    );
  };

  const showMore = (dir: string, total: number) => total > SHOWN && !q && (
    <button className="threads-more" onClick={() => setShowAll((s) => ({ ...s, [dir]: !s[dir] }))}>
      {showAll[dir] ? 'Show less' : `Show ${total - SHOWN} more`}
    </button>
  );

  const currentChats = showAll[p.projectDir] || q ? ordered : ordered.slice(0, SHOWN);

  return (
    <aside className="threads">
      <div className="threads-head">
        {/* macOS keeps its window buttons here; elsewhere they're on the right, so the app names itself. */}
        {window.pinpoint.platform !== 'darwin' && <span className="threads-brand"><Logo size={16} />Pinpoint</span>}
        <div className="spacer" />
        <button className="icon-btn xs" onClick={p.onHide} title={`Hide sidebar (${p.mod}+Shift+B)`}><PanelLeft size={15} /></button>
      </div>

      <div className="threads-actions">
        <button className="threads-new" onClick={p.onNew} disabled={p.disabled || !p.projectDir} title={`New chat (${p.mod}+Shift+O)`}>
          <SquarePen size={15} /><span>New chat</span><kbd>{p.mod}⇧O</kbd>
        </button>
        <label className="threads-search">
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" spellCheck={false} onKeyDown={walk} title="Search chats in every project. ↑ ↓ to move, Enter to open" />
          {query && <button onClick={() => setQuery('')} title="Clear"><X size={12} /></button>}
        </label>
      </div>

      <div className="threads-scroll" ref={scroller}>
        <div className="threads-label">
          <span>Projects</span>
          <button onClick={() => p.onPickProject()} disabled={p.disabled} title="Open a project folder"><Plus size={13} /></button>
        </div>

        {!p.projectDir && otherProjects.length === 0 && (
          <button className="threads-start" onClick={() => p.onPickProject()} disabled={p.disabled}>
            <FolderOpen size={18} />
            <b>Open a project</b>
            <span>Pick the folder of the web app you want to change.</span>
          </button>
        )}

        {p.projectDir && (
          <div className="proj-node here">
            {projectRow(p.projectDir, true)}
            {projectMenu(p.projectDir, true)}
            {isOpen(p.projectDir) && (
              <div className="proj-chats">
                {list.length === 0 && loose.length === 0 && (q
                  ? <div className="threads-empty">No chats match</div>
                  : <button className="threads-more" onClick={p.onNew} disabled={p.disabled}><Plus size={12} /> Start a chat</button>)}
                {loose.map(subRow)}
                {currentChats.flatMap((c) => {
                  const { on, running, finished, waiting } = stateOf(c);
                  return [
                    <div
                      key={c.id}
                      className={`thread history-item ${on ? 'on' : ''} ${running ? 'running' : ''} ${finished ? 'finished' : ''} ${waiting ? 'waiting' : ''} ${c.archived ? 'archived' : ''}`}
                      onClick={() => !on && !p.disabled && p.onOpen(c.id)}
                      title={`${(c.title || 'Untitled').trim()}\n${waiting ? 'Waiting on you' : running ? 'Working' : finished ? 'Finished. Click to see the result' : c.failed ? 'The last run failed' : 'Last active'} · ${agoLong(c.updatedAt)}`}
                    >
                      <i className="thread-state">{waiting ? <b className="thread-dot" /> : running ? <Loader2 size={12} className="spin" /> : finished ? <b className="thread-dot" /> : c.failed ? <XCircle size={12} className="thread-failed" /> : c.pinned ? <Pin size={11} className="thread-pinned" /> : null}</i>
                      {/* The dot and colour say it on screen; this says it to screen readers. */}
                      {(running || waiting || finished || c.failed) && <span className="sr-only">{waiting ? 'needs you' : running ? 'working' : finished ? 'finished' : 'failed'}</span>}
                      {renaming?.id === c.id ? (
                        <input
                          className="thread-rename" autoFocus value={renaming.value} onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenaming({ id: c.id, value: e.target.value })} onBlur={commitRename}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }}
                        />
                      ) : <span className="thread-title">{(c.title || 'Untitled').trim()}</span>}
                      <PullIcon pull={c.branch ? p.pulls[c.branch] : undefined} branch={c.branch} />
                      <span className={`thread-time ${c.failed && !running ? 'failed' : ''}`} title={fullDate(c.updatedAt)}>{agoShort(c.updatedAt)}</span>
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
                          <button onClick={() => { setMenuFor(null); window.pinpoint.shareChat(c.id).catch(() => null); }} title="Save this chat as a file a teammate can open in Pinpoint and carry on from"><Users size={13} /> Hand to a teammate…</button>
                          <button className="danger" onClick={() => { if (confirm === c.id) { setMenuFor(null); askDelete(c.id); } else setConfirm(c.id); }}>
                            <Trash2 size={13} /> {confirm === c.id ? 'Click again to delete' : 'Delete'}
                          </button>
                        </div>
                      )}
                    </div>,
                    ...subs.filter((s) => s.parent === c.id).map(subRow),
                  ];
                })}
                {showMore(p.projectDir, ordered.length)}
                {archivedCount > 0 && !q && (
                  <button className="threads-more" onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}</button>
                )}
              </div>
            )}
          </div>
        )}

        {otherProjects.map((d) => {
          const kids = lists[d];
          const shown = kids?.filter(matches) ?? [];
          if (searching && kids && !shown.length) return null;
          return (
            <div key={d} className="proj-node">
              {projectRow(d, false)}
              {projectMenu(d, false)}
              {isOpen(d) && (
                <div className="proj-chats">
                  {kids === null && <div className="threads-empty">Loading…</div>}
                  {kids && shown.length === 0 && (q
                    ? <div className="threads-empty">No chats match</div>
                    : <button className="threads-more" onClick={() => p.onPickProject(d)} disabled={p.disabled} title={`Switch this window to ${base(d)}`}><Plus size={12} /> Start a chat</button>)}
                  {(showAll[d] || q ? shown : shown.slice(0, SHOWN)).map((c) => (
                    <div key={c.id} className="thread" onClick={() => !p.disabled && p.onOpenIn(d, c.id)} title={`${c.title || 'Untitled'}\nOpens ${base(d)} in this window`}>
                      <i className="thread-state" />
                      <span className="thread-title">{c.title || 'Untitled'}</span>
                      <span className="thread-time" title={fullDate(c.updatedAt)}>{agoShort(c.updatedAt)}</span>
                    </div>
                  ))}
                  {showMore(d, shown.length)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={`resizer col threads-resizer ${p.resizing ? 'on' : ''}`} onPointerDown={p.onResizeStart} onDoubleClick={p.onResizeReset} title="Drag to resize. Double-click to reset." />

      <div className="threads-foot">
        <button onClick={p.onPalette} title={`Commands (${p.mod}+K)`}><Command size={15} /></button>
        <button onClick={p.onTheme} title={p.light ? 'Switch to dark' : 'Switch to light'}>{p.light ? <Moon size={15} /> : <Sun size={15} />}</button>
        <button onClick={p.onShortcuts} title="Keyboard shortcuts (?)"><Keyboard size={15} /></button>
        <div className="spacer" />
        <button onClick={p.onSettings} title={`Settings (${p.mod}+,)`}><SettingsIcon size={15} /></button>
      </div>
    </aside>
  );
}

// What a folded-away project is doing, so collapsing it doesn't hide work that wants you.
function ProjectStatus({ states }: { states: { running: boolean; waiting: boolean; finished: boolean }[] }) {
  const running = states.filter((s) => s.running).length;
  const waiting = states.filter((s) => s.waiting).length;
  const finished = states.filter((s) => s.finished && !s.waiting).length;
  if (!running && !waiting && !finished) return null;
  const say = [running && `${running} working`, waiting && `${waiting} waiting for you`, finished && `${finished} finished`].filter(Boolean).join(', ');
  // One signal, the most urgent: waiting on you, then working, then finished.
  return (
    <span className="proj-status" title={say}>
      {waiting > 0 ? <b className="proj-count">{waiting}</b> : running > 0 ? <Loader2 size={11} className="spin" /> : <b className="thread-dot" />}
    </span>
  );
}
