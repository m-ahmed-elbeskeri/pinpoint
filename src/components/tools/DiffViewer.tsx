import { useEffect, useMemo, useState } from 'react';
import { structuredPatch } from 'diff';
import { Check, ExternalLink, FileMinus2, FilePen, FilePlus2, Loader2, MessageSquare, Pencil, Undo2, X } from '../ui/icons';
import type { DiffFile, RevertResult } from '../../types';
import { errText } from '../../lib/util';

interface Props {
  runId: string;
  initialPath?: string;
  onClose(): void;
  onReverted(result: RevertResult): void;
  onOpen(path: string): void;
  onExplain(text: string): void;
  onSendComments(text: string): void;
}

type Hunks = NonNullable<ReturnType<typeof fileHunks>>;
const hunkText = (h: Hunks[number]) => h.lines.filter((l) => l[0] !== '\\').join('\n');

export const ICON = { add: FilePlus2, modify: FilePen, delete: FileMinus2 };

export function stats(f: DiffFile) {
  if (f.before == null || f.after == null || f.binary) return null;
  const p = structuredPatch('a', 'b', f.before, f.after, '', '', { context: 0 });
  let add = 0, del = 0;
  for (const h of p.hunks) for (const l of h.lines) { if (l[0] === '+') add++; else if (l[0] === '-') del++; }
  return { add, del };
}

export function fileHunks(file: DiffFile | undefined) {
  if (!file || file.before == null || file.after == null || file.binary) return null;
  return structuredPatch(file.path, file.path, file.before, file.after, '', '', { context: 3 }).hunks;
}

export function DiffHunks({ hunks, actions, below, dim }: { hunks: ReturnType<typeof fileHunks>; actions?(hi: number): React.ReactNode; below?(hi: number): React.ReactNode; dim?(hi: number): boolean }) {
  return (
    <div className="diff-code">
      {hunks?.map((h, hi) => {
        let o = h.oldStart, n = h.newStart;
        return (
          <div key={hi} className={`hunk ${dim?.(hi) ? 'kept' : ''}`}>
            <div className="hunk-head"><span>@@ −{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@</span>{actions && <span className="hunk-actions">{actions(hi)}</span>}</div>
            {h.lines.map((l, li) => {
              const t = l[0];
              if (t === '\\') return null;
              const row = (
                <div key={li} className={`dl ${t === '+' ? 'add' : t === '-' ? 'del' : ''}`}>
                  <span className="ln">{t === '+' ? '' : o}</span>
                  <span className="ln">{t === '-' ? '' : n}</span>
                  <span className="sign">{t === ' ' ? '' : t === '-' ? '−' : '+'}</span>
                  <code>{l.slice(1) || ' '}</code>
                </div>
              );
              if (t !== '+') o++;
              if (t !== '-') n++;
              return row;
            })}
            {below?.(hi)}
          </div>
        );
      })}
    </div>
  );
}

export function DiffViewer({ runId, initialPath, onClose, onReverted, onOpen, onExplain, onSendComments }: Props) {
  const [files, setFiles] = useState<DiffFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | undefined>(initialPath);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [commenting, setCommenting] = useState<{ key: string; text: string } | null>(null);
  const [comments, setComments] = useState<{ key: string; path: string; line: number; text: string; hunk: string }[]>([]);

  const load = () => window.pinpoint.runDiff(runId)
    .then((f) => { setFiles(f); setSel((s) => s && f.some((x) => x.path === s) ? s : f[0]?.path); })
    .catch((e) => setError(errText(e)));
  useEffect(() => { load(); }, [runId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // It's docked beside the chat: keys typed elsewhere aren't for it.
      if (/INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName)) return;
      if (e.key === 'Escape') onClose();
      if (!files?.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      const i = files.findIndex((f) => f.path === sel);
      const next = files[Math.min(files.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) { setSel(next.path); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [files, sel, onClose]);

  const allStats = useMemo(() => new Map((files || []).map((f) => [f.path, stats(f)])), [files]);
  const file = files?.find((f) => f.path === sel);

  const hunks = useMemo(() => fileHunks(file), [file]);

  const revert = async (paths: string[] | null, force = false) => {
    setBusy(true);
    try {
      const r = await window.pinpoint.revertRun(runId, paths, force);
      setConflicts(r.conflicts);
      onReverted(r);
      await load();
    } finally { setBusy(false); }
  };

  const pending = files?.filter((f) => !f.reverted) || [];

  const keyOf = (hi: number) => `${file?.path}:${hunks ? hunkText(hunks[hi]) : hi}`;
  const rejectHunk = async (hi: number) => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await window.pinpoint.revertHunk(runId, file.path, hi);
      setConflicts(r.conflicts);
      onReverted(r);
      await load();
    } finally { setBusy(false); }
  };
  const addComment = (hi: number) => {
    if (!file || !hunks || !commenting?.text.trim()) { setCommenting(null); return; }
    setComments((list) => [...list, { key: commenting.key, path: file.path, line: hunks[hi].newStart, text: commenting.text.trim(), hunk: hunkText(hunks[hi]) }]);
    setCommenting(null);
  };
  const sendComments = () => {
    onSendComments(['Review comments on your changes:', ...comments.map((c) => `\n${c.path} (around line ${c.line}): ${c.text}\n\`\`\`diff\n${c.hunk}\n\`\`\``)].join('\n'));
    setComments([]);
  };

  return (
    <div className="diff-dock">
      <div className="diff-dock-inner">
        <div className="diff-head">
          <h3>Review changes</h3>
          <span className="hint">{files ? `${files.length} file${files.length === 1 ? '' : 's'}` : ''}</span>
          <div className="spacer" />
          {comments.length > 0 && <button className="btn xs primary send-comments" onClick={sendComments}>Send {comments.length} comment{comments.length === 1 ? '' : 's'} to the agent</button>}
          {pending.length > 0 && (
            <button className="btn xs" disabled={busy} onClick={() => revert(null)}><Undo2 size={12} /> Undo all</button>
          )}
          <button className="icon-btn" onClick={onClose} title="Close (Esc)"><X size={16} /></button>
        </div>

        {error ? <div className="diff-empty">{error}</div> : !files ? <div className="diff-empty"><Loader2 className="spin" size={18} /></div> : (
          <div className="diff-body">
            <ul className="diff-files">
              {files.map((f) => {
                const Icon = ICON[f.kind];
                const st = allStats.get(f.path);
                return (
                  <li key={f.path}>
                    <button className={`${f.path === sel ? 'on' : ''} ${f.reverted ? 'reverted' : ''} ${f.kind}`} onClick={() => setSel(f.path)} title={f.path}>
                      <Icon size={13} />
                      <span className="df-name"><b>{f.path.split('/').pop()}</b><small>{f.path.split('/').slice(0, -1).join('/')}</small></span>
                      {f.reverted ? <span className="df-tag">reverted</span>
                        : st ? <span className="df-stat"><i className="add">+{st.add}</i><i className="del">−{st.del}</i></span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="diff-view">
              {file && (
                <>
                  <div className="diff-file-head">
                    <span className="mono">{file.path}</span>
                    <div className="spacer" />
                    {file.kind !== 'delete' && <button className="btn ghost xs" onClick={() => onOpen(file.path)}><ExternalLink size={12} /> Open</button>}
                    {!file.reverted && (conflicts.includes(file.path)
                      ? <button className="btn xs danger" disabled={busy} onClick={() => revert([file.path], true)} title="This file changed after the run. Reverting discards those later edits too.">Revert anyway</button>
                      : <button className="btn xs" disabled={busy} onClick={() => revert([file.path])}><Undo2 size={12} /> Revert file</button>)}
                  </div>
                  {conflicts.includes(file.path) && !file.reverted && (
                    <div className="diff-warn">This file was edited after the run (by you or a later run). “Revert anyway” restores the version from before this run.</div>
                  )}
                  {file.binary ? <div className="diff-empty">Binary file: no text diff.</div>
                    : file.tooLarge && !hunks ? <div className="diff-empty">File too large to show a diff.</div>
                      : hunks && hunks.length === 0 ? <div className="diff-empty">No text changes (whitespace or metadata only).</div>
                        : <DiffHunks
                          hunks={hunks}
                          dim={(hi) => kept.has(keyOf(hi))}
                          actions={file.reverted ? undefined : (hi) => (
                            <>
                              <button className={kept.has(keyOf(hi)) ? 'on' : ''} title="Keep: mark this change as reviewed" onClick={() => setKept((k) => { const n = new Set(k); const key = keyOf(hi); if (n.has(key)) n.delete(key); else n.add(key); return n; })}><Check size={12} /></button>
                              <button disabled={busy} title="Revert just this change" onClick={() => rejectHunk(hi)}><Undo2 size={12} /></button>
                              <button title="Comment: send a note about this change to the agent" onClick={() => setCommenting({ key: keyOf(hi), text: '' })}><Pencil size={12} /></button>
                              <button title="Explain this change in a side chat" onClick={() => hunks && onExplain(`Explain this change in ${file.path}:\n${hunkText(hunks[hi])}`)}><MessageSquare size={12} /></button>
                            </>
                          )}
                          below={(hi) => {
                            const key = keyOf(hi);
                            const mine = comments.filter((c) => c.key === key);
                            return (
                              <>
                                {mine.map((c, i) => (
                                  <div key={i} className="hunk-comment"><span>{c.text}</span><button title="Remove" onClick={() => setComments((l) => l.filter((x) => x !== c))}><X size={11} /></button></div>
                                ))}
                                {commenting?.key === key && (
                                  <textarea
                                    className="hunk-input" autoFocus rows={2} placeholder="What should change here? Enter to add" value={commenting.text}
                                    onChange={(e) => setCommenting({ key, text: e.target.value })}
                                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addComment(hi); } if (e.key === 'Escape') setCommenting(null); }}
                                  />
                                )}
                              </>
                            );
                          }}
                        />}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
