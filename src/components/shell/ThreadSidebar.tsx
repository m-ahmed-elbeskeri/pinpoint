import { memo, useEffect, useEffectEvent, useRef, useState } from 'react';
import { Archive, ArrowRight, GitFork, SquareStack, XCircle, ClipboardCopy, ExternalLink, TerminalSquare, Keyboard, Moon, Sun, ChevronRight, Command, DotsThree, Download, Folder, FolderOpen, Pencil, Pin, Loader2, NewWindow, PanelLeft, Plus, Search, Settings as SettingsIcon, SquarePen, Trash2, Users, X } from '../ui/icons';
import { PullIcon } from '../git/PullIcon';
import { Logo } from './Logo';
import type { ChatMeta, GitPull, OtherChat } from '../../types';
import { Menu } from '../ui/Menu';
import { useDismiss, useNow, useStableActions } from '../../lib/hooks';
import { agoLong, agoShort, fullDate } from '../../lib/time';


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

type Patch = Parameters<typeof window.pinpoint.patchChat>[1];
interface ChatState { on: boolean; running: boolean; finished: boolean; waiting: boolean }

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;
const parentOf = (dir: string) => base(dir.slice(0, dir.length - base(dir).length).replace(/[\\/]+$/, ''));
const titleOf = (c: ChatMeta) => (c.title || 'Untitled').trim();
const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');

const fileManager = () => window.pinpoint.platform === 'darwin' ? 'Finder' : window.pinpoint.platform === 'win32' ? 'File Explorer' : 'file manager';

// Keyboard support leans on the DOM, so the shapes it looks for are named here once.
const ROW = '.thread, .proj-row'; // a clickable row: a chat, side chat, task or project folder
const CHAT_NAME = '.history-item > .thread-title[tabindex]'; // the focusable name of a chat (not a side chat) in this project

// Rows are divs that hold their own buttons, so each is reached through its name: Enter or Space there clicks the row.
// A mouse click lets go of the focus again, so clicking a row leaves focus as it did before rows could take it.
const pressRow = (e: React.KeyboardEvent<HTMLElement>) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  e.currentTarget.closest<HTMLElement>(ROW)?.click();
};
// After a keyboard delete, focus goes to the next chat in the list (or the one before) instead of falling to the page.
// Side chats are skipped: the deleted chat's own move to the top of the list, so their rows are rebuilt.
// Deferred past React's commit, so the deleted row and its menu are gone first.
const focusNeighbour = (row: Element | null) => {
  const names = [...(row?.parentElement?.querySelectorAll<HTMLElement>(CHAT_NAME) ?? [])];
  const at = names.findIndex((n) => row?.contains(n));
  const next = names[at + 1] ?? names[at - 1];
  setTimeout(() => next?.focus());
};
const releaseIfMouse = (e: React.MouseEvent<HTMLElement>) => { if (e.detail) e.currentTarget.blur(); };
const rowName = { role: 'button', tabIndex: 0, onKeyDown: pressRow, onClick: releaseIfMouse } as const;

// Each project lists this many chats before "Show more".
const SHOWN = 6;

// Which project folders are open in the tree, kept across restarts.
const OPEN_KEY = 'pinpoint.sidebar.open';
function readOpen(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {}; } catch { return {}; }
}

// Memoised because App isn't compiled and re-renders on every streamed token; React Compiler handles everything inside.
export const ThreadSidebar = memo(function ThreadSidebar(p: Props) {
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  useDismiss(!!menuFor, () => { setMenuFor(null); setConfirm(null); }, { ignore: '.thread-menu, .thread-more, .thread-more-free' });
  // The sidebar only re-renders when its props change, so its "5m" labels run off their own clock.
  const now = useNow();

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

  const pinned = new Set(p.pinnedProjects);
  // Pinned projects lead, in the order they were pinned; the rest follow most recent first.
  const otherProjects = [
    ...p.pinnedProjects.filter((d) => d !== p.projectDir && p.recentProjects.includes(d)),
    ...p.recentProjects.filter((d) => d !== p.projectDir && !pinned.has(d)),
  ];
  // Folders left open last time fill in on start, and again after a project switch.
  const reloadOpen = useEffectEvent(() => {
    setLists({});
    const open = readOpen();
    for (const d of otherProjects) if (open[d]) load(d);
  });
  useEffect(() => { reloadOpen(); }, [p.projectDir]);
  // Searching looks through every project, so fetch the ones never opened.
  const loadUnopened = useEffectEvent(() => { for (const d of otherProjects) if (lists[d] === undefined) load(d); });
  useEffect(() => { if (searching) loadUnopened(); }, [searching]);

  const q = query.trim().toLowerCase();
  const matches = (c: ChatMeta) => !q || (c.title || 'Untitled').toLowerCase().includes(q);

  // This window's chats, with the open one titled live before it's saved.
  const rows = chats.map((c) => (c.id === p.chatId && !c.renamed ? { ...c, title: p.currentTitle || c.title } : c));
  if (p.chatId && p.currentTitle && !rows.some((c) => c.id === p.chatId)) rows.unshift({ id: p.chatId, title: p.currentTitle, createdAt: Date.now(), updatedAt: Date.now(), count: 0 });
  const list = rows.filter(matches).sort((a, b) => b.updatedAt - a.updatedAt);

  // Pinned chats lead, archived ones trail and stay hidden until asked for.
  const lead: ChatMeta[] = [], rest: ChatMeta[] = [], archived: ChatMeta[] = [];
  for (const c of list) (c.archived ? archived : c.pinned ? lead : rest).push(c);
  const ordered = showArchived ? [...lead, ...rest, ...archived] : [...lead, ...rest];

  const othersById = new Map(p.others.map((o) => [o.id, o]));
  const stateOf = (c: ChatMeta): ChatState => {
    const other = othersById.get(c.id);
    const on = c.id === p.chatId;
    return { on, running: on ? p.currentRunning : !!other?.running, finished: !on && !!other && !other.running, waiting: on ? p.currentNeedsInput : !!other?.needsInput };
  };

  // Side chats and background tasks sit under the chat that started them.
  // While searching, a side chat shows only if its own title matches.
  const parents = new Set(chats.filter((c) => !c.archived || showArchived).map((c) => c.id));
  const shownIds = new Set(ordered.map((c) => c.id));
  const subsOf = new Map<string, SubChat[]>();
  const loose: SubChat[] = [];
  for (const s of p.subChats) {
    if (q && !s.title.toLowerCase().includes(q)) continue;
    if (!s.parent || !parents.has(s.parent) || (q && !shownIds.has(s.parent))) loose.push(s);
    if (!s.parent) continue;
    const siblings = subsOf.get(s.parent);
    if (siblings) siblings.push(s); else subsOf.set(s.parent, [s]);
  }

  // Two folders both called "web" get their parent folder alongside, so they can be told apart.
  const dirsByName = new Map<string, Set<string>>();
  for (const d of p.projectDir ? [p.projectDir, ...otherProjects] : otherProjects) {
    const name = base(d).toLowerCase();
    dirsByName.set(name, (dirsByName.get(name) || new Set()).add(d));
  }
  const twins = new Set([...dirsByName.values()].filter((dirs) => dirs.size > 1).flatMap((dirs) => [...dirs]));

  const patch = (id: string, change: Patch) => {
    setChats((cs) => cs.map((c) => (c.id !== id ? c : {
      ...c,
      ...('pinned' in change && { pinned: !!change.pinned }),
      ...('archived' in change && { archived: !!change.archived }),
      ...('renamed' in change && { renamed: !!change.renamed, title: change.renamed || c.title }),
    })));
    window.pinpoint.patchChat(id, change).catch(() => {});
  };

  // One stable object, so a chat row's compiled output is reused unless its own chat or flags change.
  const rowActs = useStableActions<RowActions>({
    open: (id) => { if (id !== p.chatId && !p.disabled) p.onOpen(id); },
    toggleMenu: (id) => { setConfirm(null); setMenuFor((m) => (m === id ? null : id)); },
    closeMenu: () => setMenuFor(null),
    startRename: (id, title) => { setMenuFor(null); setRenaming({ id, value: title }); },
    editRename: (id, value) => setRenaming({ id, value }),
    commitRename: () => {
      if (!renaming) return;
      patch(renaming.id, { renamed: renaming.value.trim() || null });
      setRenaming(null);
    },
    cancelRename: () => setRenaming(null),
    patch,
    // The first click arms it; the second, on the same chat, deletes.
    delete: (id, from) => {
      if (confirm !== id) { setConfirm(id); return; }
      if (from.matches(':focus-visible')) focusNeighbour(from.closest('.thread'));
      setMenuFor(null);
      setConfirm(null);
      p.onDelete(id);
      setChats((cs) => cs.filter((c) => c.id !== id));
    },
  });

  const subRows = (subs: SubChat[] | undefined) => subs?.map((s) => <SubRow key={s.id} s={s} onOpen={p.onOpenSub} />);

  const projectRow = (dir: string, current: boolean) => {
    const open = isOpen(dir);
    const menuKey = `proj:${dir}`;
    return (
      <div className={cx('proj-row', open && 'open', current && 'current', menuFor === menuKey && 'menu-open')} onClick={() => toggleProject(dir)} title={dir}>
        <i className="proj-icon">
          {open ? <FolderOpen size={15} /> : <Folder size={15} />}
          <ChevronRight size={11} className="proj-chev" />
        </i>
        <span className="proj-name" {...rowName} aria-expanded={open}>{base(dir)}{twins.has(dir) && <small> · {parentOf(dir)}</small>}</span>
        {pinned.has(dir) && <Pin size={10} className="proj-pin" />}
        {current && !open && <ProjectStatus states={list.filter((c) => !c.archived).map(stateOf)} />}
        <span className="proj-tools">
          <button className="thread-more-free" onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === menuKey ? null : menuKey); }} title="More" aria-label={`More for ${base(dir)}`} aria-haspopup="menu" aria-expanded={menuFor === menuKey}><DotsThree size={14} /></button>
          {current
            ? <button onClick={(e) => { e.stopPropagation(); p.onNew(); }} disabled={p.disabled} title={`New chat in ${base(dir)}`} aria-label={`New chat in ${base(dir)}`}><SquarePen size={13} /></button>
            : <button onClick={(e) => { e.stopPropagation(); window.pinpoint.openProjectWindow(dir).catch(() => {}); }} title="Open in a new window, so both projects run side by side" aria-label={`Open ${base(dir)} in a new window`}><NewWindow size={13} /></button>}
        </span>
      </div>
    );
  };

  // Every item closes the menu, then does its thing.
  const projectMenu = (dir: string, current: boolean) => {
    if (menuFor !== `proj:${dir}`) return null;
    const run = (fn: () => void) => () => { setMenuFor(null); fn(); };
    return (
      <Menu className="thread-menu proj-menu" label={`${base(dir)} actions`}>
        {!current && <button role="menuitem" onClick={run(() => window.pinpoint.openProjectWindow(dir).catch(() => {}))}><NewWindow size={13} /> Open in a new window</button>}
        <button role="menuitem" onClick={run(() => window.pinpoint.openPath(dir))}><FolderOpen size={13} /> Show in {fileManager()}</button>
        {current && <button role="menuitem" onClick={run(() => window.pinpoint.openFile('.').catch(() => {}))}><ExternalLink size={13} /> Open in your editor</button>}
        {current && <button role="menuitem" onClick={run(p.onTerminal)}><TerminalSquare size={13} /> Open a terminal here</button>}
        <button role="menuitem" onClick={run(() => navigator.clipboard?.writeText(dir))}><ClipboardCopy size={13} /> Copy path</button>
        <button role="menuitem" onClick={run(() => p.onPinProject(dir, !pinned.has(dir)))}><Pin size={13} /> {pinned.has(dir) ? 'Unpin' : 'Pin to top'}</button>
        {!current && <>
          <div className="dd-sep" role="separator" />
          <button role="menuitem" disabled={p.disabled} onClick={run(() => p.onPickProject(dir))}><ArrowRight size={13} /> Switch this window to it</button>
          <button role="menuitem" onClick={run(() => p.onForgetProject(dir))} title="Take it off this list. The folder and its chats stay on disk."><X size={13} /> Remove from sidebar</button>
        </>}
      </Menu>
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
        <button className="icon-btn xs" onClick={p.onHide} title={`Hide sidebar (${p.mod}+Shift+B)`} aria-label="Hide sidebar"><PanelLeft size={15} /></button>
      </div>

      <div className="threads-actions">
        <button className="threads-new" onClick={p.onNew} disabled={p.disabled || !p.projectDir} title={`New chat (${p.mod}+Shift+O)`}>
          <SquarePen size={15} /><span>New chat</span><kbd>{p.mod}⇧O</kbd>
        </button>
        <label className="threads-search">
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" spellCheck={false} onKeyDown={walk} title="Search chats in every project. ↑ ↓ to move, Enter to open" aria-label="Search chats" />
          {query && <button onClick={() => setQuery('')} title="Clear" aria-label="Clear search"><X size={12} /></button>}
        </label>
      </div>

      <div className="threads-scroll" ref={scroller}>
        <div className="threads-label">
          <span>Projects</span>
          <button onClick={() => p.onPickProject()} disabled={p.disabled} title="Open a project folder" aria-label="Open a project folder"><Plus size={13} /></button>
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
                {subRows(loose)}
                {currentChats.flatMap((c) => {
                  const s = stateOf(c);
                  return [
                    <ChatRow
                      key={c.id} c={c} {...s} now={now} pull={c.branch ? p.pulls[c.branch] : undefined}
                      menuOpen={menuFor === c.id} confirming={confirm === c.id} renaming={renaming?.id === c.id ? renaming.value : null} act={rowActs}
                    />,
                    ...(subRows(subsOf.get(c.id)) || []),
                  ];
                })}
                {showMore(p.projectDir, ordered.length)}
                {archived.length > 0 && !q && (
                  <button className="threads-more" onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Hide archived' : `Show archived (${archived.length})`}</button>
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
                      <span className="thread-title" {...rowName}>{c.title || 'Untitled'}</span>
                      <span className="thread-time" title={fullDate(c.updatedAt)}>{agoShort(c.updatedAt, now)}</span>
                    </div>
                  ))}
                  {showMore(d, shown.length)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div role="separator" aria-orientation="vertical" aria-label="Sidebar edge" className={cx('resizer col threads-resizer', p.resizing && 'on')} onPointerDown={p.onResizeStart} onDoubleClick={p.onResizeReset} title="Drag to resize. Double-click to reset." />

      <div className="threads-foot">
        <button onClick={p.onPalette} title={`Commands (${p.mod}+K)`} aria-label="Commands"><Command size={15} /></button>
        <button onClick={p.onTheme} title={p.light ? 'Switch to dark' : 'Switch to light'} aria-label={p.light ? 'Switch to dark' : 'Switch to light'}>{p.light ? <Moon size={15} /> : <Sun size={15} />}</button>
        <button onClick={p.onShortcuts} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"><Keyboard size={15} /></button>
        <div className="spacer" />
        <button onClick={p.onSettings} title={`Settings (${p.mod}+,)`} aria-label="Settings"><SettingsIcon size={15} /></button>
      </div>
    </aside>
  );
});

type RowActions = {
  open(id: string): void;
  toggleMenu(id: string): void;
  closeMenu(): void;
  startRename(id: string, title: string): void;
  editRename(id: string, value: string): void;
  commitRename(): void;
  cancelRename(): void;
  patch(id: string, change: Patch): void;
  delete(id: string, from: HTMLElement): void;
};

// A chat in this window's project, with its "More" menu.
function ChatRow({ c, on, running, finished, waiting, now, pull, menuOpen, confirming, renaming, act }: ChatState & {
  c: ChatMeta; now: number; pull?: GitPull; menuOpen: boolean; confirming: boolean; renaming: string | null; act: RowActions;
}) {
  const title = titleOf(c);
  const status = waiting ? 'Waiting on you' : running ? 'Working' : finished ? 'Finished. Click to see the result' : c.failed ? 'The last run failed' : 'Last active';
  const run = (fn: () => void) => () => { act.closeMenu(); fn(); };
  return (
    <div
      className={cx('thread history-item', on && 'on', running && 'running', finished && 'finished', waiting && 'waiting', c.archived && 'archived')}
      onClick={() => act.open(c.id)}
      title={`${title}\n${status} · ${agoLong(c.updatedAt, now)}`}
    >
      {running && <i className="thread-shine" aria-hidden />}
      <i className="thread-state">{waiting || finished ? <b className="thread-dot" /> : running ? <Loader2 size={12} className="spin" /> : c.failed ? <XCircle size={12} className="thread-failed" /> : c.pinned ? <Pin size={11} className="thread-pinned" /> : null}</i>
      {/* The dot and colour say it on screen; this says it to screen readers. */}
      {(running || waiting || finished || c.failed) && <span className="sr-only">{waiting ? 'needs you' : running ? 'working' : finished ? 'finished' : 'failed'}</span>}
      {renaming !== null ? (
        <input
          className="thread-rename" autoFocus value={renaming} onClick={(e) => e.stopPropagation()} aria-label="Chat name"
          onChange={(e) => act.editRename(c.id, e.target.value)} onBlur={act.commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') act.commitRename(); if (e.key === 'Escape') act.cancelRename(); }}
        />
      ) : <span className="thread-title" {...rowName} aria-current={on || undefined}>{title}</span>}
      <PullIcon pull={pull} branch={c.branch} />
      <span className={cx('thread-time', c.failed && !running && 'failed')} title={fullDate(c.updatedAt)}>{agoShort(c.updatedAt, now)}</span>
      <button
        className={cx('thread-x thread-more', menuOpen && 'open')} onClick={(e) => { e.stopPropagation(); act.toggleMenu(c.id); }}
        title="More" aria-label={`More for ${title}`} aria-haspopup="menu" aria-expanded={menuOpen}
      >
        <DotsThree size={14} />
      </button>
      {menuOpen && (
        <Menu className="thread-menu" label={`${title} actions`}>
          <button role="menuitem" data-keeps-focus onClick={() => act.startRename(c.id, c.title || '')}><Pencil size={13} /> Rename</button>
          <button role="menuitem" onClick={run(() => act.patch(c.id, { pinned: !c.pinned }))}><Pin size={13} /> {c.pinned ? 'Unpin' : 'Pin to top'}</button>
          <button role="menuitem" onClick={run(() => act.patch(c.id, { archived: !c.archived }))}><Archive size={13} /> {c.archived ? 'Unarchive' : 'Archive'}</button>
          <button role="menuitem" onClick={run(() => window.pinpoint.exportChat(c.id).catch(() => null))}><Download size={13} /> Export as Markdown…</button>
          <button role="menuitem" onClick={run(() => window.pinpoint.shareChat(c.id).catch(() => null))} title="Save this chat as a file a teammate can open in Pinpoint and carry on from"><Users size={13} /> Hand to a teammate…</button>
          <button role="menuitem" className="danger" onClick={(e) => act.delete(c.id, e.currentTarget)}>
            <Trash2 size={13} /> <span aria-live="polite">{confirming ? 'Click again to delete' : 'Delete'}</span>
          </button>
        </Menu>
      )}
    </div>
  );
}

// A side chat or background task, one step in under the chat that started it.
function SubRow({ s, onOpen }: { s: SubChat; onOpen(s: SubChat): void }) {
  return (
    <div className={cx('thread sub-chat', s.kind, s.on && 'on', s.running && 'running', s.failed && 'failed')} onClick={() => onOpen(s)} title={`${s.title}\n${s.kind === 'side' ? 'Side chat' : 'Background task'}${s.running ? ', working' : s.failed ? ', stopped' : ''}`}>
      <i className="thread-state">{s.running ? <Loader2 size={11} className="spin" /> : s.failed ? <XCircle size={11} /> : s.kind === 'task' ? <SquareStack size={11} /> : <GitFork size={11} />}</i>
      {s.running && <i className="thread-shine" aria-hidden />}
      <span className="thread-title" {...rowName} aria-current={s.on || undefined}>{s.title}</span>
      {/file/.test(s.hint) && <span className="thread-time">{s.hint}</span>}
    </div>
  );
}

// What a folded-away project is doing, so collapsing it doesn't hide work that wants you.
function ProjectStatus({ states }: { states: ChatState[] }) {
  let running = 0, waiting = 0, finished = 0;
  for (const s of states) {
    if (s.running) running++;
    if (s.waiting) waiting++;
    else if (s.finished) finished++;
  }
  if (!running && !waiting && !finished) return null;
  const say = [running && `${running} working`, waiting && `${waiting} waiting for you`, finished && `${finished} finished`].filter(Boolean).join(', ');
  // One signal, the most urgent: waiting on you, then working, then finished.
  return (
    <span className="proj-status" title={say}>
      {waiting > 0 ? <b className="proj-count">{waiting}</b> : running > 0 ? <Loader2 size={11} className="spin" /> : <b className="thread-dot" />}
    </span>
  );
}
