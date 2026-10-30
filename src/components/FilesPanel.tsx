import { memo, useEffect, useMemo, useState } from 'react';
import { AtIcon } from '@phosphor-icons/react';
import { ChevronDown, ChevronRight, ExternalLink, File, FileTree, Folder, Loader2, RotateCw, Search, X } from './icons';

interface Props {
  // Files the agent changed in this chat, marked even once they are committed.
  recent: string[];
  refreshKey: unknown;
  onMention(path: string): void;
  onOpen(path: string, line?: number): void;
}

interface Node { name: string; path: string; dirs: Map<string, Node>; files: string[] }

function buildTree(paths: string[]) {
  const root: Node = { name: '', path: '', dirs: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split('/');
    let at = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let next = at.dirs.get(parts[i]);
      if (!next) { next = { name: parts[i], path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [] }; at.dirs.set(parts[i], next); }
      at = next;
    }
    at.files.push(p);
  }
  return root;
}

const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const KEYWORDS = 'async|await|break|case|catch|class|const|continue|def|default|delete|do|elif|else|enum|export|extends|false|fn|for|from|func|function|if|impl|import|in|instanceof|interface|let|new|null|package|private|public|pub|return|self|static|struct|super|switch|this|throw|true|try|type|typeof|undefined|use|var|void|while|with|yield';
const TOKEN = new RegExp(`(\\/\\/.*$|\\/\\*.*?\\*\\/|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)|\\b(${KEYWORDS})\\b|\\b(\\d[\\d_.]*)\\b`, 'g');
const HASH_COMMENTS = /\.(py|sh|bash|zsh|rb|ya?ml|toml|ps1)$/i;

// A quiet colouring, one line at a time: comments, strings, keywords and numbers. Enough to read by; the editor is a click away.
function tokens(line: string, hash: boolean): React.ReactNode[] {
  if (hash) {
    const at = line.search(/(^|\s)#/);
    if (at >= 0) return [...tokens(line.slice(0, at), false), <span key="c" className="tk-c">{line.slice(at)}</span>];
  }
  const out: React.ReactNode[] = [];
  let last = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(line); m; m = TOKEN.exec(line)) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const cls = m[1] ? (m[1].startsWith('/') ? 'tk-c' : 'tk-s') : m[2] ? 'tk-k' : 'tk-n';
    out.push(<span key={m.index} className={cls}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

const CodeView = memo(function CodeView({ path, text, onLine }: { path: string; text: string; onLine(n: number): void }) {
  const hash = HASH_COMMENTS.test(path);
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  return (
    <div className="code-view">
      {lines.map((l, i) => (
        <div key={i} className="code-line">
          <button className="code-num" onClick={() => onLine(i + 1)} title={`Open in your editor at line ${i + 1}`}>{i + 1}</button>
          <code>{l.length > 2000 ? l : tokens(l, hash)}</code>
        </div>
      ))}
    </div>
  );
});

export function FilesPanel({ recent, refreshKey, onMention, onOpen }: Props) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [changes, setChanges] = useState<Record<string, 'M' | 'A' | 'D'>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<{ path: string; text: string; binary: boolean; truncated: boolean; error?: string } | null>(null);

  const refresh = () => {
    window.pinpoint.projectFiles().then(setFiles).catch(() => setFiles([]));
    window.pinpoint.projectChanges().then(setChanges).catch(() => setChanges({}));
  };
  useEffect(refresh, [refreshKey]);

  const recentSet = useMemo(() => new Set(recent), [recent]);
  const touched = useMemo(() => new Set([...Object.keys(changes), ...recent]), [changes, recent]);
  const shown = useMemo(() => {
    const all = [...new Set([...(files || []), ...Object.keys(changes).filter((p) => changes[p] === 'D')])].sort();
    return onlyChanged ? all.filter((p) => touched.has(p)) : all;
  }, [files, changes, onlyChanged, touched]);
  const tree = useMemo(() => buildTree(shown), [shown]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? shown.filter((p) => p.toLowerCase().includes(q)).slice(0, 300) : null;
  }, [query, shown]);

  const pick = (p: string) => {
    setPicked(p);
    if (changes[p] === 'D') { setView({ path: p, text: '', binary: false, truncated: false, error: 'This file has been deleted.' }); return; }
    setView(null);
    window.pinpoint.readProjectFile(p)
      .then((r) => setPicked((now) => { if (now === p) setView({ path: p, ...r }); return now; }))
      .catch((e) => setView({ path: p, text: '', binary: false, truncated: false, error: String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }));
  };
  const badge = (p: string) => (changes[p]
    ? <i className={`file-badge ${changes[p]}`} title={{ M: 'Modified', A: 'New', D: 'Deleted' }[changes[p]]}>{changes[p]}</i>
    : recentSet.has(p) ? <i className="file-badge recent" title="Changed in this chat" /> : null);
  const fileRow = (p: string, depth: number, full?: boolean) => (
    <button key={p} className={`file-row ${picked === p ? 'on' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => pick(p)} title={p}>
      <File size={13} /><span>{full ? p : nameOf(p)}</span>{badge(p)}
    </button>
  );
  const hasTouched = (n: Node): boolean => n.files.some((f) => touched.has(f)) || [...n.dirs.values()].some(hasTouched);
  const rows = (n: Node, depth: number): React.ReactNode[] => [
    ...[...n.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).flatMap((d) => {
      const isOpen = open.has(d.path) || onlyChanged;
      return [
        <button key={`d:${d.path}`} className="file-row dir" style={{ paddingLeft: 8 + depth * 14 }} title={d.path} onClick={() => setOpen((s) => { const next = new Set(s); if (next.has(d.path)) next.delete(d.path); else next.add(d.path); return next; })}>
          {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}<Folder size={13} /><span>{d.name}</span>{!isOpen && hasTouched(d) && <i className="file-badge recent" title="Has changed files" />}
        </button>,
        ...(isOpen ? rows(d, depth + 1) : []),
      ];
    }),
    ...n.files.map((f) => fileRow(f, depth)),
  ];

  return (
    <div className="files-panel">
      <div className="files-side">
        <div className="files-tools">
          <label className="files-search">
            <Search size={12} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a file" spellCheck={false} onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }} />
            {query && <button onClick={() => setQuery('')} title="Clear"><X size={11} /></button>}
          </label>
          <button className={`icon-btn xs ${onlyChanged ? 'on' : ''}`} onClick={() => setOnlyChanged(!onlyChanged)} aria-pressed={onlyChanged} title="Only changed files"><FileTree size={13} /></button>
          <button className="icon-btn xs" onClick={refresh} title="Refresh"><RotateCw size={12} /></button>
        </div>
        <div className="files-list">
          {!files && <div className="files-empty"><Loader2 size={13} className="spin" /></div>}
          {files && (matches ? matches.map((p) => fileRow(p, 0, true)) : rows(tree, 0))}
          {files && (matches ? matches.length === 0 : shown.length === 0) && <div className="files-empty">{onlyChanged ? 'Nothing changed' : matches ? 'No file matches' : 'No files'}</div>}
        </div>
      </div>
      <div className="files-main">
        {picked ? (
          <>
            <div className="files-head">
              <span className="files-path" title={picked}>{picked}</span>
              {badge(picked)}
              <div className="spacer" />
              <button className="icon-btn xs" onClick={() => onMention(picked)} title="Mention this file in your message"><AtIcon size={13} /></button>
              <button className="icon-btn xs" onClick={() => onOpen(picked)} title="Open in your editor"><ExternalLink size={13} /></button>
            </div>
            {!view && <div className="files-empty"><Loader2 size={13} className="spin" /></div>}
            {view?.error && <div className="files-empty">{view.error}</div>}
            {view?.binary && <div className="files-empty">Can't show a binary file here.</div>}
            {view && !view.error && !view.binary && (
              <>
                <CodeView path={view.path} text={view.text} onLine={(n) => onOpen(view.path, n)} />
                {view.truncated && <div className="files-more">Showing the first 1 MB. Open it in your editor for the rest.</div>}
              </>
            )}
          </>
        ) : <div className="files-empty big"><FileTree size={22} /></div>}
      </div>
    </div>
  );
}
