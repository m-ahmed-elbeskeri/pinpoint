import { useEffect, useState } from 'react';
import { structuredPatch } from 'diff';
import {
  AlertTriangle, Brain, CheckCircle2, ChevronRight, FileText, Globe, Loader2, Pencil, RotateCw,
  Search, Terminal, Wrench, XCircle, FilePlus2, Undo2, FileMinus2, FilePen, GitCompareArrows, Lightbulb, Check,
  ExternalLink, CornerDownRight, Zap, Clock,
} from 'lucide-react';
import type { ChatItem, DiffFile, FileChange, RevertResult } from '../lib/types';

// Diffs per run are fetched once and shared by every file row of that run.
const diffCache = new Map<string, Promise<DiffFile[]>>();
const loadDiff = (runId: string) => {
  if (!diffCache.has(runId)) diffCache.set(runId, window.pinpoint.runDiff(runId).catch((e) => { diffCache.delete(runId); throw e; }));
  return diffCache.get(runId)!;
};
export const invalidateDiff = (runId: string) => diffCache.delete(runId);

// Compact inline diff for one file, shown inside the chat.
function InlineDiff({ runId, path, onFirstLine }: { runId: string; path: string; onFirstLine(line: number): void }) {
  const [file, setFile] = useState<DiffFile | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadDiff(runId).then((all) => { if (live) setFile(all.find((f) => f.path === path) || null); }).catch(() => live && setFile(null));
    return () => { live = false; };
  }, [runId, path]);

  if (file === undefined) return <div className="idiff-empty"><Loader2 size={12} className="spin" /> Loading diff…</div>;
  if (!file) return <div className="idiff-empty">Diff not available (older runs are pruned).</div>;
  if (file.binary) return <div className="idiff-empty">Binary file</div>;
  if (file.before == null || file.after == null) return <div className="idiff-empty">File too large to show</div>;
  const hunks = structuredPatch(path, path, file.before, file.after, '', '', { context: 2 }).hunks;
  if (!hunks.length) return <div className="idiff-empty">Only whitespace or metadata changed</div>;
  return (
    <div className="idiff">
      {hunks.map((h, hi) => {
        let o = h.oldStart, n = h.newStart;
        return (
          <div key={hi} className="idiff-hunk">
            <button className="idiff-head" onClick={() => onFirstLine(h.newStart)} title="Open at this line">@@ line {h.newStart}</button>
            {h.lines.map((l, li) => {
              const t = l[0];
              if (t === '\\') return null;
              const row = (
                <div key={li} className={`dl ${t === '+' ? 'add' : t === '-' ? 'del' : ''}`}>
                  <span className="ln">{t === '+' ? '' : o}</span>
                  <span className="ln">{t === '-' ? '' : n}</span>
                  <code>{l.slice(1) || ' '}</code>
                </div>
              );
              if (t !== '+') o++;
              if (t !== '-') n++;
              return row;
            })}
          </div>
        );
      })}
    </div>
  );
}

function FileRow({ runId, change, disabled, onReview, onRevert, onOpen }: {
  runId: string; change: FileChange; disabled: boolean;
  onReview(): void; onRevert(force: boolean): Promise<RevertResult | null>; onOpen(line?: number): void;
}) {
  const [open, setOpen] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [working, setWorking] = useState(false);
  const Icon = CHANGE_ICON[change.kind];
  const name = change.path.split('/').pop();
  const dir = change.path.split('/').slice(0, -1).join('/');

  const revert = async () => {
    setWorking(true);
    const r = await onRevert(conflict);
    setWorking(false);
    if (r?.conflicts.includes(change.path)) setConflict(true);
    else { setConflict(false); invalidateDiff(runId); }
  };

  return (
    <li className={`file-row ${change.kind} ${change.reverted ? 'reverted' : ''} ${open ? 'open' : ''}`}>
      <div className="file-line">
        <Icon size={12} className="file-icon" />
        <button className="file-name" onClick={onReview} title="Review this file">
          <b>{name}</b>{dir && <small>{dir}</small>}
        </button>
        {change.reverted ? <span className="df-tag">reverted</span>
          : change.add != null ? <span className="df-stat"><i className="add">+{change.add}</i><i className="del">−{change.del}</i></span> : null}
        <div className="file-actions">
          {change.kind !== 'delete' && <button className="mini-btn" onClick={() => onOpen()} title="Open in editor"><ExternalLink size={11} /></button>}
          {!change.reverted && (
            <button className={`mini-btn ${conflict ? 'warn' : ''}`} onClick={revert} disabled={disabled || working} title={conflict ? 'Changed since this run. Click again to revert anyway.' : 'Revert this file'}>
              {working ? <Loader2 size={11} className="spin" /> : <Undo2 size={11} />}
            </button>
          )}
        </div>
        <button className={`mini-btn toggle-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title={open ? 'Hide changes' : 'Show changes'}>
          <ChevronRight size={12} className={`chev ${open ? 'open' : ''}`} />
        </button>
      </div>
      {conflict && !change.reverted && <div className="file-warn">Edited after this run. Revert again to overwrite those later edits.</div>}
      {open && <InlineDiff runId={runId} path={change.path} onFirstLine={(l) => onOpen(l)} />}
    </li>
  );
}

const HEX = /(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b)/;

// Hex colors get a little swatch, which helps when reading design rules.
function WithSwatches({ text }: { text: string }) {
  const parts = text.split(HEX);
  if (parts.length === 1) return <>{text}</>;
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} className="hex"><i style={{ background: p }} />{p}</span> : p))}</>;
}

// Minimal, safe markdown: fenced code, inline code, bold, headings, bullets.
function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') ? <code key={i}><WithSwatches text={p.slice(1, -1)} /></code>
          : p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong>
            : <span key={i}><WithSwatches text={p} /></span>,
      )}
    </>
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/```/);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        if (i % 2 === 1) {
          const nl = b.indexOf('\n');
          return <pre key={i}><code>{nl >= 0 ? b.slice(nl + 1) : b}</code></pre>;
        }
        return b.split(/\n{2,}/).filter((para) => para.trim()).map((para, j) => {
          const lines = para.split('\n');
          if (lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l))) {
            return (
              <ul key={`${i}-${j}`}>
                {lines.map((l, k) => {
                  const depth = Math.min(3, Math.floor((l.match(/^\s*/)?.[0].length || 0) / 2));
                  return <li key={k} style={depth ? { marginLeft: depth * 14 } : undefined}><Inline text={l.replace(/^\s*([-*]|\d+\.)\s/, '')} /></li>;
                })}
              </ul>
            );
          }
          const h = para.match(/^#{1,4}\s+(.*)$/);
          if (h && lines.length === 1) return <h4 key={`${i}-${j}`}><Inline text={h[1]} /></h4>;
          if (lines.every((l) => l.startsWith('>'))) return <blockquote key={`${i}-${j}`}><Inline text={lines.map((l) => l.replace(/^>\s?/, '')).join(' ')} /></blockquote>;
          // A heading followed by a list/paragraph without a blank line between them.
          if (/^#{1,4}\s/.test(lines[0]) && lines.length > 1) {
            return <div key={`${i}-${j}`}><h4><Inline text={lines[0].replace(/^#{1,4}\s+/, '')} /></h4><Markdown text={lines.slice(1).join('\n')} /></div>;
          }
          return <p key={`${i}-${j}`}>{lines.map((l, k) => <span key={k}>{k > 0 && <br />}<Inline text={l} /></span>)}</p>;
        });
      })}
    </div>
  );
}

const toolIcon = (name: string) => {
  if (/^(Edit|MultiEdit|NotebookEdit)$/.test(name)) return Pencil;
  if (/^Write$/.test(name)) return FilePlus2;
  if (/^(Read)$/.test(name)) return FileText;
  if (/^(Bash|Shell|PowerShell)$/.test(name)) return Terminal;
  if (/^(Grep|Glob|LS|Search)$/.test(name)) return Search;
  if (/Web/.test(name)) return Globe;
  return Wrench;
};

export function shortPath(p: string, root: string) {
  if (!p) return p;
  const norm = (s: string) => s.replace(/\\/g, '/');
  const r = norm(root).replace(/\/$/, '');
  const n = norm(p);
  return r && n.toLowerCase().startsWith(r.toLowerCase() + '/') ? n.slice(r.length + 1) : n;
}

function ToolRow({ item, root }: { item: Extract<ChatItem, { kind: 'tool' }>; root: string }) {
  const [open, setOpen] = useState(false);
  const Icon = toolIcon(item.name);
  return (
    <div className={`tool-row ${item.status}`}>
      <button className="tool-head" onClick={() => item.output && setOpen(!open)}>
        <Icon size={13} className="tool-icon" />
        <span className="tool-name">{item.name}</span>
        <span className="tool-detail">{shortPath(item.detail, root)}</span>
        {item.status === 'running' ? <Loader2 size={13} className="spin" />
          : item.status === 'error' ? <XCircle size={13} className="err" /> : null}
        {item.output ? <ChevronRight size={13} className={`chev ${open ? 'open' : ''}`} /> : null}
      </button>
      {open && item.output && <pre className="tool-output">{item.output}</pre>}
    </div>
  );
}

function Thinking({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`thinking ${streaming ? 'live' : ''}`}>
      <button onClick={() => setOpen(!open)}><Brain size={13} /> {streaming ? 'Thinking…' : 'Thought'} <ChevronRight size={12} className={`chev ${open ? 'open' : ''}`} /></button>
      {open && <div className="thinking-body">{text}</div>}
    </div>
  );
}

interface ItemProps {
  item: ChatItem;
  root: string;
  busy: boolean;
  onReload(): void;
  onUndo(doneId: string, runId: string): void;
  onReview(runId: string, path?: string): void;
  onMemory(id: string, action: 'save' | 'dismiss'): void;
  onRevertFile(runId: string, path: string, force?: boolean): Promise<RevertResult | null>;
  onOpenFile(path: string, line?: number): void;
}

const CHANGE_ICON = { add: FilePlus2, modify: FilePen, delete: FileMinus2 };

const STEER_TAG = {
  queue: { icon: CornerDownRight, text: 'Steered after the current step' },
  now: { icon: Zap, text: 'Interrupted and sent' },
  later: { icon: Clock, text: 'Queued: sends when the agent finishes' },
};

export function ChatItemView({ item, root, busy, onReload, onUndo, onReview, onMemory, onRevertFile, onOpenFile }: ItemProps) {
  switch (item.kind) {
    case 'user': {
      const tag = item.steer ? STEER_TAG[item.steer] : null;
      return (
        <div className={`msg user ${item.steer ? 'steer' : ''}`}>
          {tag && <div className="steer-tag"><tag.icon size={11} /> {tag.text}</div>}
          {item.annotations.length > 0 && (
            <div className="msg-attachments">
              {item.annotations.map((a) => (
                <div key={a.id} className="msg-att" title={a.note}>
                  {a.image ? <img src={a.image} alt="" /> : <div className="msg-att-empty" />}
                  <span className="badge" style={{ background: a.color }}>{a.n}</span>
                </div>
              ))}
            </div>
          )}
          {item.text && <div className="msg-text">{item.text}</div>}
          {item.annotations.filter((a) => a.note.trim()).map((a) => (
            <div key={a.id} className="msg-note"><span className="badge sm" style={{ background: a.color }}>{a.n}</span>{a.note}</div>
          ))}
        </div>
      );
    }
    case 'text':
      return <div className={`msg agent ${item.streaming ? 'streaming' : ''}`}><Markdown text={item.text} /></div>;
    case 'thinking':
      return <Thinking text={item.text} streaming={item.streaming} />;
    case 'tool':
      return <ToolRow item={item} root={root} />;
    case 'status':
      return <div className="msg status">{item.text}</div>;
    case 'error':
      return <div className="msg error"><AlertTriangle size={14} /> <span>{item.text}</span></div>;
    case 'memory':
      return (
        <div className={`memory-card ${item.status}`}>
          <Lightbulb size={14} />
          <div className="memory-text">
            <small>{item.status === 'saved' ? 'Saved to project memory' : item.status === 'dismissed' ? 'Not remembered' : 'Remember for this project?'}</small>
            <span>{item.text}</span>
          </div>
          {item.status === 'pending' ? (
            <>
              <button className="btn xs primary" onClick={() => onMemory(item.id, 'save')}><Check size={12} /> Save</button>
              <button className="btn xs ghost" onClick={() => onMemory(item.id, 'dismiss')}>Dismiss</button>
            </>
          ) : null}
        </div>
      );
    case 'done': {
      const n = item.changes.length;
      return (
        <div className={`done-card ${item.ok ? 'ok' : 'fail'} ${item.undone ? 'undone' : ''}`}>
          <div className="done-head">
            {item.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            <span>
              {item.undone ? 'Reverted' : n ? `Changed ${n} file${n > 1 ? 's' : ''}` : item.ok ? 'Done, no file changes' : 'Stopped'}
            </span>
            <span className="done-meta">
              {item.durationMs ? `${Math.round(item.durationMs / 1000)}s` : ''}
              {item.cost ? ` · $${item.cost.toFixed(2)}` : ''}
            </span>
          </div>
          {n > 0 && (
            <ul className="done-files">
              {item.changes.map((c) => (
                <FileRow
                  key={c.path}
                  runId={item.runId}
                  change={item.undone ? { ...c, reverted: true } : c}
                  disabled={busy}
                  onReview={() => onReview(item.runId, c.path)}
                  onRevert={(force) => onRevertFile(item.runId, c.path, force)}
                  onOpen={(line) => onOpenFile(c.path, line)}
                />
              ))}
            </ul>
          )}
          <div className="done-actions">
            {n > 0 && (
              <button className="btn xs" onClick={() => onReview(item.runId)} title="See exactly what changed and revert individual files">
                <GitCompareArrows size={12} /> Review changes
              </button>
            )}
            {n > 0 && !item.undone && (
              <button className="btn ghost xs" disabled={busy} onClick={() => onUndo(item.id, item.runId)} title="Restore these files to how they were before this run">
                <Undo2 size={12} /> Undo
              </button>
            )}
            <div className="spacer" />
            <button className="btn ghost xs" onClick={onReload} title="Reload the page"><RotateCw size={12} /> Reload page</button>
          </div>
        </div>
      );
    }
  }
}
