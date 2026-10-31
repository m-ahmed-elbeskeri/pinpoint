import { useEffect, useState, type ReactNode } from 'react';
import { structuredPatch } from 'diff';
import { ChevronRight, ExternalLink, FileMinus2, FilePen, FilePlus2, Loader2, Undo2 } from '../ui/icons';
import type { DiffFile, FileChange, RevertResult } from '../../types';

const diffCache = new Map<string, Promise<DiffFile[]>>();
const loadDiff = (runId: string) => {
  if (!diffCache.has(runId)) diffCache.set(runId, window.pinpoint.runDiff(runId).catch((e) => { diffCache.delete(runId); throw e; }));
  return diffCache.get(runId)!;
};
export const invalidateDiff = (runId: string) => diffCache.delete(runId);

const CHANGE_ICON = { add: FilePlus2, modify: FilePen, delete: FileMinus2 };

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

const FILES_SHOWN = 5;
export function FileList({ count, children }: { count: number; children: ReactNode[] }) {
  const [all, setAll] = useState(false);
  const fold = count > FILES_SHOWN + 1;
  return (
    <ul className="done-files">
      {fold && !all ? children.slice(0, FILES_SHOWN) : children}
      {fold && (
        <li><button className="files-more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show ${count - FILES_SHOWN} more files`}</button></li>
      )}
    </ul>
  );
}

export function FileRow({ runId, change, disabled, onReview, onRevert, onOpen }: {
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
