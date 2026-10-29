import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, ExternalLink, GitCommitHorizontal, GitPullRequestArrow, Loader2, RotateCw, X, AlertTriangle } from './icons';
import { DiffHunks, ICON, fileHunks, stats } from './DiffViewer';
import { PrBadge, PrForm, errText, type PrDefaults } from './GitPanel';
import { ago } from './ThreadSidebar';
import type { BranchCompare as Result, CompareFile, GitLogEntry, GitPull, GitStatus } from '../lib/types';

type Row = CompareFile & { key: string; side: 'out' | 'in' };
const rowsOf = (r: Result): Row[] => [
  ...r.files.map((f) => ({ ...f, key: `out:${f.path}`, side: 'out' as const })),
  ...r.incomingFiles.map((f) => ({ ...f, key: `in:${f.path}`, side: 'in' as const })),
];

// The select's value for "this branch's own copy on origin".
const ORIGIN = ' origin';

function Commits({ list, empty }: { list: GitLogEntry[]; empty: string }) {
  if (!list.length) return <li className="gb-empty">{empty}</li>;
  return <>{list.map((c) => (
    <li key={c.hash}><GitCommitHorizontal size={12} /><span className="gb-text"><span className="gb-name">{c.subject}</span><small><span className="mono">{c.hash}</span> · {c.author} · {ago(c.when)}</small></span></li>
  ))}</>;
}

interface Props {
  status: GitStatus;
  initialBase?: string;
  initialRemote?: boolean;
  prDefaults(): PrDefaults;
  flash(msg: string): void;
  onOpen(path: string): void;
  onClose(): void;
}

// Everything on this branch measured against a base branch of your choice: what a pull request into it would show.
export function BranchCompare({ status, initialBase, initialRemote, prDefaults, flash, onOpen, onClose }: Props) {
  const [base, setBase] = useState(initialRemote && status.upstream ? ORIGIN : initialBase || status.defaultBranch || 'main');
  const remote = base === ORIGIN;
  const [working, setWorking] = useState(true);
  const [names, setNames] = useState<string[]>([]);
  const [pulls, setPulls] = useState<Record<string, GitPull>>({});
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<string>();
  const [tab, setTab] = useState<'files' | 'commits'>('files');
  const [pr, setPr] = useState<PrDefaults | null>(null);

  useEffect(() => {
    window.pinpoint.gitBranches().then((r) => setNames([...new Set(r.branches.map((b) => b.name))].filter((n) => n !== status.branch))).catch(() => {});
    window.pinpoint.gitPulls().then(setPulls).catch(() => {});
  }, []);

  const load = () => {
    setLoading(true); setError(null);
    window.pinpoint.gitCompare({ base: remote ? '' : base, working, remote })
      .then((r) => { setData(r); const rows = rowsOf(r); setSel((s) => (s && rows.some((f) => f.key === s) ? s : rows[0]?.key)); })
      .catch((e) => { setData(null); setError(errText(e)); })
      .finally(() => setLoading(false));
  };
  useEffect(load, [base, working]);

  const files = useMemo(() => (data ? rowsOf(data) : undefined), [data]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (!files?.length || tab !== 'files' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      const i = files.findIndex((f) => f.key === sel);
      const next = files[Math.min(files.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) { setSel(next.key); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [files, sel, tab, onClose]);

  const allStats = useMemo(() => new Map((files || []).map((f) => [f.key, stats(f)])), [files]);
  const totals = useMemo(() => [...allStats.entries()].filter(([k]) => k.startsWith('out:')).map(([, v]) => v).reduce<{ add: number; del: number }>((t, s) => ({ add: t.add + (s?.add || 0), del: t.del + (s?.del || 0) }), { add: 0, del: 0 }), [allStats]);
  const file = files?.find((f) => f.key === sel);
  const hunks = useMemo(() => fileHunks(file), [file]);
  const existing = status.branch ? pulls[status.branch] : undefined;
  const fileRow = (f: Row) => {
    const Icon = ICON[f.kind];
    const st = allStats.get(f.key);
    const conflicted = data?.conflicts?.includes(f.path);
    return (
      <li key={f.key}>
        <button className={`${f.key === sel ? 'on' : ''} ${f.kind} ${f.side}`} onClick={() => setSel(f.key)} title={f.from ? `${f.from} → ${f.path}` : f.path}>
          <Icon size={13} />
          <span className="df-name"><b>{f.path.split('/').pop()}</b><small>{f.path.split('/').slice(0, -1).join('/')}</small></span>
          {conflicted ? <span className="df-tag bad">conflict</span> : f.untracked ? <span className="df-tag">new</span>
            : st ? <span className="df-stat"><i className="add">+{st.add}</i><i className="del">−{st.del}</i></span> : null}
        </button>
      </li>
    );
  };
  const options = remote || names.includes(base) ? names : [base, ...names];

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="diff-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="diff-head">
          <h3>Changes</h3>
          <span className="bc-route">
            <b className="mono">{status.branch}</b>
            <span className="hint">{remote ? 'vs' : 'into'}</span>
            <select value={base} onChange={(e) => setBase(e.target.value)} title="Pick a branch to see what a pull request into it would contain, or this branch's copy on origin">
              {status.upstream && <optgroup label="This branch"><option value={ORIGIN}>{status.upstreamName} (on origin)</option></optgroup>}
              <optgroup label="Pull request into">{options.map((n) => <option key={n} value={n}>{n}</option>)}</optgroup>
            </select>
          </span>
          <label className="git-check" title="Count edits that aren't committed yet, as if you committed them now">
            <input type="checkbox" checked={working} onChange={(e) => setWorking(e.target.checked)} /> Include uncommitted
          </label>
          <div className="spacer" />
          <button className="icon-btn" onClick={load} disabled={loading} title="Refresh">{loading ? <Loader2 size={15} className="spin" /> : <RotateCw size={15} />}</button>
          {existing && existing.state !== 'CLOSED' && <PrBadge pr={existing} />}
          {!remote && existing?.state !== 'OPEN' && existing?.state !== 'DRAFT' && (
            <button className="btn xs primary" disabled={!data || !status.remote || !status.gh.authed || base === status.branch} onClick={() => setPr(prDefaults())}
              title={!status.remote ? 'No "origin" remote yet' : !status.gh.authed ? 'Run `gh auth login` to open PRs' : `Push and open a pull request into ${base}`}>
              <GitPullRequestArrow size={12} /> Open PR into {base}
            </button>
          )}
          <button className="icon-btn" onClick={onClose} title="Close (Esc)"><X size={16} /></button>
        </div>

        {data && (
          <div className="bc-summary">
            {data.remote ? <>
              <span className={data.commits.length ? 'bc-out' : 'hint'}><ArrowUp size={12} /> {data.commits.length} to push</span>
              <span className={data.incoming.length ? 'bc-in' : 'hint'}><ArrowDown size={12} /> {data.incoming.length} to pull</span>
            </> : <span>{data.commits.length} commit{data.commits.length === 1 ? '' : 's'}</span>}
            <span>{data.total} file{data.total === 1 ? '' : 's'} differ</span>
            <span className="df-stat"><i className="add">+{totals.add}</i><i className="del">−{totals.del}</i></span>
            {data.conflicts == null || (data.remote && !data.incoming.length) ? null : data.conflicts.length
              ? <span className="bc-bad" title={data.conflicts.join('\n')}><AlertTriangle size={12} /> {data.remote ? 'Pulling would conflict' : `Conflicts with ${data.ref}`} in {data.conflicts.length} file{data.conflicts.length > 1 ? 's' : ''}</span>
              : <span className="bc-ok"><CheckCircle2 size={12} /> {data.remote ? 'Pulls in cleanly' : `Merges cleanly into ${data.ref}`}</span>}
            {!data.remote && data.behind > 0 && <span className="hint">{data.ref} has {data.behind} newer commit{data.behind > 1 ? 's' : ''}</span>}
            {data.remote && !data.commits.length && !data.incoming.length && !data.total && <span className="bc-ok"><CheckCircle2 size={12} /> Same as {data.ref}</span>}
            {working && data.conflicts != null && <span className="hint">merge check covers committed work only</span>}
          </div>
        )}

        {error ? <div className="diff-empty">{error}</div> : !data ? <div className="diff-empty"><Loader2 className="spin" size={18} /></div> : (
          <div className="diff-body">
            <div className="bc-side">
              <div className="bc-tabs">
                <button className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>Files <small>{data.total + data.incomingFiles.length}</small></button>
                <button className={tab === 'commits' ? 'on' : ''} onClick={() => setTab('commits')}>Commits <small>{data.commits.length + (data.remote ? data.incoming.length : 0)}</small></button>
              </div>
              {tab === 'files' ? (
                <ul className="diff-files">
                  {data.remote && <li className="bc-group"><ArrowUp size={11} /> Yours, to push</li>}
                  {!data.files.length && <li className="gb-empty">{data.remote ? 'Nothing of yours to push.' : `Nothing differs from ${data.ref}.`}</li>}
                  {files!.filter((f) => f.side === 'out').map(fileRow)}
                  {data.remote && <li className="bc-group"><ArrowDown size={11} /> Incoming, to pull</li>}
                  {data.remote && !data.incomingFiles.length && <li className="gb-empty">Nothing new on origin.</li>}
                  {files!.filter((f) => f.side === 'in').map(fileRow)}
                  {data.total > data.files.length && <li className="gb-empty">{data.total - data.files.length} more not shown</li>}
                </ul>
              ) : (
                <ul className="bc-commits">
                  {data.remote && <li className="bc-group"><ArrowUp size={11} /> On this computer, not on origin</li>}
                  <Commits list={data.commits} empty={data.remote ? 'Nothing to push.' : `No commits yet${working ? '; only uncommitted changes' : ''}.`} />
                  {(data.remote || data.incoming.length > 0) && <li className="bc-group"><ArrowDown size={11} /> {data.remote ? 'On origin, not here yet' : `New on ${data.ref} since you branched`}</li>}
                  {(data.remote || data.incoming.length > 0) && <Commits list={data.incoming} empty="Nothing to pull." />}
                </ul>
              )}
            </div>

            <div className="diff-view">
              {pr ? (
                <PrForm defaults={pr} base={base} onBack={() => setPr(null)} onDone={() => { setPr(null); window.pinpoint.gitPulls().then(setPulls).catch(() => {}); }} flash={flash} />
              ) : file && (
                <>
                  <div className="diff-file-head">
                    <span className="mono">{file.from ? `${file.from} → ${file.path}` : file.path}</span>
                    {file.side === 'in' && <span className="df-tag in">on origin</span>}
                    <div className="spacer" />
                    {file.kind !== 'delete' && file.side === 'out' && <button className="btn ghost xs" onClick={() => onOpen(data.sub && file.path.startsWith(`${data.sub}/`) ? file.path.slice(data.sub.length + 1) : file.path)}><ExternalLink size={12} /> Open</button>}
                  </div>
                  {file.binary ? <div className="diff-empty">Binary file: no text diff.</div>
                    : file.tooLarge && !hunks ? <div className="diff-empty">File too large to show a diff.</div>
                      : hunks && hunks.length === 0 ? <div className="diff-empty">No text changes (renamed, whitespace or mode only).</div>
                        : <DiffHunks hunks={hunks} />}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
