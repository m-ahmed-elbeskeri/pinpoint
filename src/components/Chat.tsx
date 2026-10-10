import { memo, useEffect, useState, type ReactNode } from 'react';
import { structuredPatch } from 'diff';
import {
  AlertTriangle, Brain, CheckCircle2, ChevronRight, FileText, Globe, Loader2, Pencil, RotateCw,
  Search, Terminal, Wrench, XCircle, FilePlus2, Undo2, FileMinus2, FilePen, GitCompareArrows, Lightbulb, Check,
  ExternalLink, CornerDownRight, Zap, Clock, GitCommitHorizontal, SplitSquareHorizontal, Layers, Route, SealCheck, Gauge, Timer, EyeOff,
} from './icons';
import type { BuildSize, ChatItem, DiffFile, FileChange, PerfMetrics, RevertResult } from '../lib/types';

// Diffs per run are fetched once and shared by every file row of that run.
const diffCache = new Map<string, Promise<DiffFile[]>>();
const loadDiff = (runId: string) => {
  if (!diffCache.has(runId)) diffCache.set(runId, window.pinpoint.runDiff(runId).catch((e) => { diffCache.delete(runId); throw e; }));
  return diffCache.get(runId)!;
};
export const invalidateDiff = (runId: string) => diffCache.delete(runId);

// Before/after thumbnails under a run; click opens the compare view.
const shotCache = new Map<string, Promise<Record<string, string>>>();
function ShotStrip({ runId, onOpen }: { runId: string; onOpen(): void }) {
  const [shots, setShots] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let live = true;
    if (!shotCache.has(runId)) shotCache.set(runId, window.pinpoint.runShots(runId).catch(() => ({})));
    shotCache.get(runId)!.then((s) => { if (live) setShots(s); });
    return () => { live = false; };
  }, [runId]);
  if (!shots?.before || !shots?.after) return null;
  return (
    <button className="shot-strip" onClick={onOpen} title="Compare before and after">
      <figure><img src={shots.before} alt="Before" /><figcaption>Before</figcaption></figure>
      <figure><img src={shots.after} alt="After" /><figcaption>After</figcaption></figure>
      <span className="shot-cta"><SplitSquareHorizontal size={12} /> Compare</span>
    </button>
  );
}

// What the run did to how the open page loads, in plain words: a verdict first, then
// only the differences worth a look. Nothing is shown when nothing moved.
function PerfLine({ perf }: { perf: { before: PerfMetrics; after: PerfMetrics } }) {
  const { before: b, after: a } = perf;
  const kb = (n: number) => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB`;
  const items: { text: string; worse: boolean }[] = [];
  const bytes = (label: string, x: number, y: number) => {
    const d = y - x;
    if (Math.abs(d) >= 1024 && Math.abs(d) >= x * 0.01) items.push({ text: `${kb(Math.abs(d))} ${d > 0 ? 'more' : 'less'} ${label}`, worse: d > 0 });
  };
  bytes('JavaScript', b.js, a.js);
  bytes('CSS', b.css, a.css);
  const req = a.requests - b.requests;
  if (req) items.push({ text: `${Math.abs(req)} ${req > 0 ? 'more' : 'fewer'} file${Math.abs(req) > 1 ? 's' : ''} to download`, worse: req > 0 });
  const nodes = a.nodes - b.nodes;
  if (Math.abs(nodes) >= 5) items.push({ text: `${Math.abs(nodes)} ${nodes > 0 ? 'more' : 'fewer'} elements on the page`, worse: nodes > 50 });
  if (Math.abs(a.cls - b.cls) >= 0.01) items.push({ text: a.cls > b.cls ? 'content jumps around more while loading' : 'content jumps around less while loading', worse: a.cls > b.cls });
  if (b.lcp && a.lcp && Math.abs(a.lcp - b.lcp) >= 150) items.push({ text: `main content appears ${Math.abs(a.lcp - b.lcp)} ms ${a.lcp > b.lcp ? 'later' : 'sooner'}`, worse: a.lcp > b.lcp });
  const worse = items.some((i) => i.worse), better = items.some((i) => !i.worse);
  if (!items.length) return null; // nothing moved: the numbers are behind "Load stats"
  return (
    <div className={`route-check ${worse ? 'moved' : ''}`}>
      <Timer size={12} />
      <span>{worse && better ? 'Loading changed' : worse ? 'Loads a little heavier' : 'Loads a little lighter'}:</span>
      {items.map((i) => <span key={i.text} className={i.worse ? 'worse' : 'better'}>{i.text}</span>)}
    </div>
  );
}

// Every load number, before and after, shown when asked for.
function PerfStats({ perf }: { perf: { before: PerfMetrics; after: PerfMetrics } }) {
  const { before: b, after: a } = perf;
  const kb = (n: number) => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB`;
  const rows: [string, string, string, string?][] = [
    ['JavaScript downloaded', kb(b.js), kb(a.js)],
    ['CSS downloaded', kb(b.css), kb(a.css)],
    ['Files requested', String(b.requests), String(a.requests)],
    ['Elements on the page', String(b.nodes), String(a.nodes)],
    ['Content jumping while loading', String(b.cls), String(a.cls), '0 is none, under 0.1 is good'],
    ['Time until the main content shows', b.lcp ? `${b.lcp} ms` : '?', a.lcp ? `${a.lcp} ms` : '?'],
  ];
  return (
    <div className="load-stats">
      <div className="load-stats-head"><span>How this page loads</span><span>Before</span><span>After</span></div>
      {rows.map(([label, before, after, hint]) => (
        <div key={label} className={before === after ? '' : 'diff'} title={hint}>
          <span>{label}{hint && <small> ({hint})</small>}</span><span>{before}</span><span>{after}</span>
        </div>
      ))}
      <p>Measured on a fresh load of the dev build, so sizes are bigger than in production.</p>
    </div>
  );
}

// Size of the real production build, measured when asked.
function BuildLine({ build }: { build: { now: BuildSize; previous: BuildSize | null } }) {
  const { now, previous } = build;
  const kb = (n: number) => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB`;
  const delta = (a: number, b: number) => { const d = a - b; return Math.abs(d) < 100 ? 'no change' : `${d > 0 ? '+' : '−'}${kb(Math.abs(d))}`; };
  const worse = !!previous && (now.jsGzip - previous.jsGzip > 100 || now.cssGzip - previous.cssGzip > 100);
  return (
    <div className={`route-check ${worse ? 'moved' : ''}`} title={`Production build, ${now.files} files\nJS ${kb(now.js)} (${kb(now.jsGzip)} gzipped)\nCSS ${kb(now.css)} (${kb(now.cssGzip)} gzipped)`}>
      <Gauge size={12} />
      <span>Production build: JS {kb(now.jsGzip)}, CSS {kb(now.cssGzip)} gzipped</span>
      {previous
        ? <span className={worse ? 'worse' : ''}>since last measured: JS {delta(now.jsGzip, previous.jsGzip)}, CSS {delta(now.cssGzip, previous.cssGzip)}</span>
        : <span>first measurement; the next one will show the difference</span>}
    </div>
  );
}

// The takes on one request, side by side: look, compare, pick.
function VariantPicker({ item, busy, onPick, onCompare }: {
  item: Extract<ChatItem, { kind: 'variants' }>; busy: boolean;
  onPick(runId: string): void; onCompare(runId: string): void;
}) {
  const [shots, setShots] = useState<Record<string, string | undefined>>({});
  useEffect(() => {
    let live = true;
    for (const o of item.options) {
      window.pinpoint.runShots(o.runId).then((s) => { if (live) setShots((prev) => ({ ...prev, [o.runId]: s.after })); }).catch(() => {});
    }
    return () => { live = false; };
  }, [item.options]);
  return (
    <div className="variants-card">
      <div className="variants-head"><Layers size={14} /> {item.chosen ? 'Variant applied' : `Pick one of ${item.options.length} variants`}<span className="hint">{item.chosen ? 'You can still switch.' : 'Nothing is applied until you choose.'}</span></div>
      <div className="variants-grid">
        {item.options.map((o) => (
          <figure key={o.runId} className={item.chosen === o.runId ? 'chosen' : ''}>
            <button className="variant-shot" onClick={() => onCompare(o.runId)} title="Compare with before">
              {shots[o.runId] ? <img src={shots[o.runId]} alt={`Variant ${o.index}`} /> : <span className="hint">No screenshot</span>}
            </button>
            <figcaption>
              <b>Variant {o.index}</b><small>{o.files} file{o.files > 1 ? 's' : ''}</small>
              <div className="spacer" />
              {item.chosen === o.runId
                ? <span className="df-tag"><Check size={11} /> Applied</span>
                : <button className="btn xs primary" disabled={busy} onClick={() => onPick(o.runId)}>Use this</button>}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

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

// The files of a run. A long list starts folded to its first few, so the card stays a glance.
const FILES_SHOWN = 5;
function FileList({ count, children }: { count: number; children: ReactNode[] }) {
  const [all, setAll] = useState(false);
  const fold = count > FILES_SHOWN + 1; // never hide just one
  return (
    <ul className="done-files">
      {fold && !all ? children.slice(0, FILES_SHOWN) : children}
      {fold && (
        <li><button className="files-more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show ${count - FILES_SHOWN} more files`}</button></li>
      )}
    </ul>
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
  live?: boolean;                 // part of the run that is going on right now
  onForceSteer(id: string): void; // push a waiting message in now
  root: string;
  busy: boolean;
  onReload(): void;
  onUndo(doneId: string, runId: string): void;
  onReview(runId: string, path?: string): void;
  onMemory(id: string, action: 'save' | 'dismiss'): void;
  onRevertFile(runId: string, path: string, force?: boolean): Promise<RevertResult | null>;
  onOpenFile(path: string, line?: number): void;
  onCommit(runId: string): void;
  onCompare(runId: string, pair?: string): void;
  onPickVariant(itemId: string, runId: string): void;
  onMeasureBuild(runId: string): void;
  gitRepo: boolean;
}

const CHANGE_ICON = { add: FilePlus2, modify: FilePen, delete: FileMinus2 };

const STEER_TAG = {
  queue: { icon: CornerDownRight, text: 'Steered after the current step' },
  now: { icon: Zap, text: 'Interrupted and sent' },
  later: { icon: Clock, text: 'Queued: sends when the agent finishes' },
};

export function ChatItemView({ item, live, onForceSteer, root, busy, onReload, onUndo, onReview, onMemory, onRevertFile, onOpenFile, onCommit, onCompare, onPickVariant, onMeasureBuild, gitRepo }: ItemProps) {
  const [loadStats, setLoadStats] = useState(false);
  switch (item.kind) {
    case 'user': {
      const tag = item.steer ? STEER_TAG[item.steer] : null;
      return (
        <div className={`msg user ${item.steer ? 'steer' : ''}`}>
          {tag && (
            <div className="steer-tag">
              <tag.icon size={11} /> {tag.text}
              {live && item.steer !== 'now' && (
                <button className="steer-now" onClick={() => onForceSteer(item.id)} title={item.steer === 'later' ? 'Stop the agent and send this now' : "Interrupt the agent's current step so it reads this now"}>
                  <Zap size={10} /> Send now
                </button>
              )}
            </div>
          )}
          {item.background && <div className="steer-tag"><Layers size={11} /> Running in the background</div>}
          {item.variants && <div className="steer-tag"><Layers size={11} /> {item.variants} variants</div>}
          {item.annotations.length > 0 && (
            <div className="msg-attachments">
              {item.annotations.map((a) => (
                <div key={a.id} className="msg-att" title={a.note}>
                  {a.image ? <img src={a.image} alt="" /> : <div className="msg-att-empty">{a.kind === 'flow' ? `${a.steps?.length || 0} steps` : ''}</div>}
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
    case 'variants':
      return <VariantPicker item={item} busy={busy} onPick={(runId) => onPickVariant(item.id, runId)} onCompare={(runId) => onCompare(runId)} />;
    case 'done': {
      const n = item.changes.length;
      const files = `${n} file${n > 1 ? 's' : ''}`;
      const moved = item.routeCheck?.filter((r) => r.changed) || [];
      // Files changed but the page looks the same: worth saying loudly. A fresh load of the
      // page (the route check) is the better witness; the on-screen screenshots are the fallback.
      const here = item.routeCheck?.find((r) => r.current);
      const noVisual = n > 0 && item.ok && !item.undone && !item.variant && !item.verify && (here ? !here.changed : item.visual === 'none');
      const elsewhere = moved.filter((r) => !r.current); // pages the user wasn't looking at
      const sideEffects = moved.some((r) => r.current && r.asked?.length && r.areas?.length); // more changed here than was pointed at
      const others = (item.routeCheck?.filter((r) => !r.current) || []).length;
      const counted = item.changes.filter((c) => c.add != null);
      const added = counted.reduce((s, c) => s + (c.add || 0), 0), removed = counted.reduce((s, c) => s + (c.del || 0), 0);
      // A check that found nothing to fix is a footnote, not a result: one quiet line.
      const quiet = !!item.verify && n === 0;
      return (
        <div className={`done-card ${item.ok ? 'ok' : 'fail'} ${item.undone ? 'undone' : ''} ${quiet ? 'quiet' : ''}`}>
          <div className="done-head">
            <i className="done-icon">{item.verify && item.ok ? <SealCheck size={quiet ? 14 : 15} weight="fill" /> : item.ok ? <CheckCircle2 size={15} weight="fill" /> : <XCircle size={15} weight="fill" />}</i>
            <span>
              {item.instant && !item.undone ? `Applied instantly · ${files}`
                : item.background && !item.undone ? `Background run applied · ${files}`
                : item.variant ? `Variant ${item.variant.index} of ${item.variant.total}${n ? ` · ${files}` : ''}${item.ok ? '' : ' · stopped'}`
                : item.verify ? (n ? `Checked the result and fixed ${files}` : item.ok ? 'Checked the result: looks right' : 'Check stopped')
                  : item.undone ? 'Reverted' : n ? `Changed ${files}` : item.ok ? 'Done, no file changes' : 'Stopped'}
            </span>
            {counted.length > 0 && !item.undone && <span className="df-stat" title="Lines added and removed across these files"><i className="add">+{added}</i><i className="del">−{removed}</i></span>}
            <span className="done-meta">
              {item.durationMs ? `${Math.round(item.durationMs / 1000)}s` : ''}
              {item.cost ? ` · $${item.cost.toFixed(2)}` : ''}
            </span>
            {noVisual && <span className="no-visual-tag"><EyeOff size={11} /> No visible change</span>}
            {item.commit && (
              <span className="commit-chip" title={item.commit.subject} onClick={() => navigator.clipboard?.writeText(item.commit!.hash)}>
                <GitCommitHorizontal size={12} /> {item.commit.hash}
              </span>
            )}
          </div>
          {n > 0 && (
            <FileList count={n}>
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
            </FileList>
          )}
          {noVisual && (
            <div className="no-visual">
              <EyeOff size={14} />
              <div>
                <b>No visible change on this page</b>
                <span>The files were edited, but the page looks the same as before{moved.length ? ' (other pages did change, below)' : ''}. The change may not apply to what's on screen, may be overridden by another style, or may only show in another state or size.</span>
              </div>
            </div>
          )}
          {item.shots && !noVisual && <ShotStrip runId={item.runId} onOpen={() => onCompare(item.runId)} />}
          {item.routeCheck && (
            <div className={`where ${elsewhere.length || sideEffects ? 'moved' : ''}`}>
              <div className="where-head">
                <Route size={12} />
                {elsewhere.length
                  ? <span>Also changed {elsewhere.length} other page{elsewhere.length > 1 ? 's' : ''}. Check {elsewhere.length > 1 ? 'they were' : 'it was'} meant to:</span>
                  : sideEffects ? <span>More changed on this page than you pointed at:</span>
                  : moved.length ? <span>What changed visually ({others} other page{others === 1 ? '' : 's'} checked, none changed):</span>
                    : <span>{item.routeCheck.length} page{item.routeCheck.length > 1 ? 's' : ''} checked, none look different</span>}
              </div>
              {moved.map((r) => (
                <div key={r.key} className="where-row">
                  <button className={`chip mono ${r.current ? '' : 'warn'}`} onClick={() => onCompare(item.runId, `route-${r.key}`)} title="Compare this page before and after">{r.current ? 'this page' : r.route} · {r.pct}%</button>
                  {r.asked?.length
                    ? <span>{r.asked.join(', ')} <i>(what you pointed at)</i>{r.areas?.length ? <b> and also {r.areas.join(', ')}</b> : '; nothing else here'}</span>
                    : <span>{r.areas?.length ? r.areas.join(', ') : 'changed'}</span>}
                </div>
              ))}
            </div>
          )}
          {item.perf && <PerfLine perf={item.perf} />}
          {item.perf && loadStats && <PerfStats perf={item.perf} />}
          {item.build && <BuildLine build={item.build} />}
          {/* A check that changed nothing has nothing to review or undo. */}
          {!(item.verify && n === 0) && <div className="done-actions">
            {n > 0 && (
              <button className="btn xs" onClick={() => onReview(item.runId)} title="See exactly what changed and revert individual files">
                <GitCompareArrows size={12} /> Review
              </button>
            )}
            {n > 0 && !item.undone && (
              <button className="btn ghost xs" disabled={busy} onClick={() => onUndo(item.id, item.runId)} title="Restore these files to how they were before this run">
                <Undo2 size={12} /><span className="btn-text">Undo</span>
              </button>
            )}
            {gitRepo && n > 0 && !item.undone && !item.commit && item.ok && (
              <button className="btn ghost xs" disabled={busy} onClick={() => onCommit(item.runId)} title="Commit the files this run changed">
                <GitCommitHorizontal size={12} /><span className="btn-text">Commit</span>
              </button>
            )}
            {n > 0 && !item.undone && item.ok && (
              <button className="btn ghost xs" disabled={busy} onClick={() => onMeasureBuild(item.runId)} title="Run the project's build and measure the JS and CSS it produces (the per-run numbers come from the dev server)">
                <Gauge size={12} /><span className="btn-text">Build size</span>
              </button>
            )}
            {item.perf && (
              <button className={`btn ghost xs load-stats-btn ${loadStats ? 'on' : ''}`} onClick={() => setLoadStats(!loadStats)} title="How this page loads, before and after this change">
                <Timer size={12} /><span className="btn-text">Load stats</span>
              </button>
            )}
            <div className="spacer" />
            <button className="btn ghost xs" onClick={onReload} title="Reload the page"><RotateCw size={12} /><span className="btn-text">Reload</span></button>
          </div>}
        </div>
      );
    }
  }
}

export type ChatActions = Omit<ItemProps, 'item' | 'live' | 'root' | 'busy' | 'gitRepo'>;

// A message is rendered again only when it changes itself, so a long conversation
// costs nothing while you type, drag a divider, or the agent streams its next line.
const ChatRow = memo(ChatItemView);
export const ChatList = memo(function ChatList({ items, actions, root, busy, gitRepo }: {
  items: ChatItem[]; actions: ChatActions; root: string; busy: boolean; gitRepo: boolean;
}) {
  // Messages after the last finished run belong to the one going on now.
  let lastDone = -1;
  if (busy) items.forEach((it, i) => { if (it.kind === 'done') lastDone = i; });
  return <>{items.map((item, i) => <ChatRow key={item.id} item={item} live={busy && i > lastDone && item.kind === 'user'} root={root} busy={busy} gitRepo={gitRepo} {...actions} />)}</>;
});
