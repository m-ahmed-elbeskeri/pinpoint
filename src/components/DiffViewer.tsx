import { useEffect, useMemo, useState } from 'react';
import { structuredPatch } from 'diff';
import { ExternalLink, FileMinus2, FilePen, FilePlus2, Loader2, Undo2, X } from 'lucide-react';
import type { DiffFile, RevertResult } from '../lib/types';

interface Props {
  runId: string;
  initialPath?: string;
  onClose(): void;
  onReverted(result: RevertResult): void;
  onOpen(path: string): void;
}

const ICON = { add: FilePlus2, modify: FilePen, delete: FileMinus2 };

function stats(f: DiffFile) {
  if (f.before == null || f.after == null || f.binary) return null;
  const p = structuredPatch('a', 'b', f.before, f.after, '', '', { context: 0 });
  let add = 0, del = 0;
  for (const h of p.hunks) for (const l of h.lines) { if (l[0] === '+') add++; else if (l[0] === '-') del++; }
  return { add, del };
}

// Review what a run changed, file by file, and revert any of it.
export function DiffViewer({ runId, initialPath, onClose, onReverted, onOpen }: Props) {
  const [files, setFiles] = useState<DiffFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | undefined>(initialPath);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => window.pinpoint.runDiff(runId)
    .then((f) => { setFiles(f); setSel((s) => s && f.some((x) => x.path === s) ? s : f[0]?.path); })
    .catch((e) => setError(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')));
  useEffect(() => { load(); }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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

  const hunks = useMemo(() => {
    if (!file || file.before == null || file.after == null || file.binary) return null;
    return structuredPatch(file.path, file.path, file.before, file.after, '', '', { context: 3 }).hunks;
  }, [file]);

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

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="diff-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="diff-head">
          <h3>Review changes</h3>
          <span className="hint">{files ? `${files.length} file${files.length === 1 ? '' : 's'}` : ''}</span>
          <div className="spacer" />
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
                        : (
                          <div className="diff-code">
                            {hunks?.map((h, hi) => {
                              let o = h.oldStart, n = h.newStart;
                              return (
                                <div key={hi} className="hunk">
                                  <div className="hunk-head">@@ −{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@</div>
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
                                </div>
                              );
                            })}
                          </div>
                        )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
