import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowDown, ArrowUp, GitBranch, GitCommitHorizontal, GitCompareArrows, GitMerge, GitPullRequestArrow, Loader2, Plus, RotateCw, Search, Sparkles, Trash2, Worktree, X } from './icons';
import { ago } from './ThreadSidebar';
import type { GitBranchInfo, GitPull, GitStatus, Settings } from '../lib/types';

export type PrDefaults = { title: string; body: string; shots: { runId: string; label: string }[] };

interface Props {
  status: GitStatus | null;
  refresh(): Promise<void>;
  settings: Settings;
  saveSettings(p: Partial<Settings>): void;
  busy: boolean;
  prDefaults(): PrDefaults;
  flash(msg: string): void;
  onOpenWorktree(dir: string): Promise<boolean>;
  onCompare(base?: string, remote?: boolean): void;
  onSwitched(): void;
}

export const errText = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange(v: boolean): void; label: string; hint: string }) {
  return (
    <button className={`git-toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      <span className="git-toggle-text"><b>{label}</b><small>{hint}</small></span>
    </button>
  );
}

export function PrBadge({ pr }: { pr: GitPull }) {
  return (
    <button className={`gb-pr ${pr.state.toLowerCase()}`} title={`${pr.title} (${pr.state.toLowerCase()})`} onClick={(e) => { e.stopPropagation(); window.pinpoint.gitOpenUrl(pr.url); }}>
      {pr.state === 'MERGED' ? <GitMerge size={11} /> : <GitPullRequestArrow size={11} />}#{pr.number}
    </button>
  );
}

// Where this branch stands against its copy on origin, with the one or two actions that make sense right now.
function SyncStrip({ status, fetching, working, lock, act, onFetch, onCompareRemote }: {
  status: GitStatus; fetching: boolean; working: string | null; lock: boolean;
  act(label: string, fn: () => Promise<string | void>): void; onFetch(): void; onCompareRemote(): void;
}) {
  if (!status.remote) return <div className="gb-sync"><span className="gb-sync-state muted">Only on this computer: no origin remote</span></div>;
  const ahead = status.ahead || 0, behind = status.behind || 0;
  const checked = status.fetchedAt ? `checked ${ago(status.fetchedAt)}${ago(status.fetchedAt) === 'now' ? '' : ' ago'}` : 'never checked';
  const pullBtn = behind > 0 && (
    <button className="btn xs" disabled={lock} title="Fast-forward to origin's copy; uncommitted edits are carried across" onClick={() => act('pull', async () => {
      await window.pinpoint.gitPull();
      return `Pulled ${behind} commit${behind > 1 ? 's' : ''}`;
    })}>{working === 'pull' ? <Loader2 size={12} className="spin" /> : <ArrowDown size={12} />} Pull {behind}</button>
  );
  const pushBtn = (ahead > 0 || !status.upstream) && status.hasCommits && (
    <button className={`btn xs ${behind ? '' : 'primary'}`} disabled={lock || behind > 0} title={behind ? 'Pull first: origin has commits you don\'t' : status.upstream ? `Push to ${status.upstreamName}` : `Publish ${status.branch} to origin`}
      onClick={() => act('push', async () => { await window.pinpoint.gitPush(); return status.upstream ? `Pushed ${ahead} commit${ahead > 1 ? 's' : ''}` : `Published ${status.branch} to origin`; })}>
      {working === 'push' ? <Loader2 size={12} className="spin" /> : <ArrowUp size={12} />} {status.upstream ? `Push ${ahead}` : 'Publish'}
    </button>
  );
  return (
    <div className="gb-sync">
      <span className={`gb-sync-dot ${!status.upstream ? 'local' : ahead && behind ? 'diverged' : behind ? 'behind' : ahead ? 'ahead' : 'even'}`} />
      <span className="gb-sync-state">
        <b>{!status.upstream ? (status.gone ? 'Deleted on origin' : 'Not on origin yet')
          : ahead && behind ? 'Both sides have new commits' : behind ? `${behind} new on origin` : ahead ? `${ahead} not pushed` : 'Up to date with origin'}</b>
        <small>{status.upstream ? `${status.upstreamName} · ` : ''}{fetching ? 'checking…' : checked}</small>
      </span>
      <span className="gb-sync-acts">
        {status.upstream && <button className="icon-btn xs" title={`Compare with ${status.upstreamName}: what you'd push and what you'd pull`} onClick={onCompareRemote}><GitCompareArrows size={12} /></button>}
        <button className="icon-btn xs" disabled={fetching} title="Check origin for new commits (fetch)" onClick={onFetch}><RotateCw size={12} className={fetching ? 'spin' : ''} /></button>
        {pullBtn}
        {pushBtn}
      </span>
    </div>
  );
}

// Title, description, draft and screenshots for a new pull request into `base`.
export function PrForm({ defaults, base, onBack, onDone, flash }: { defaults: PrDefaults; base?: string; onBack(): void; onDone(): void; flash(msg: string): void }) {
  const [pr, setPr] = useState({ ...defaults, draft: false, withShots: defaults.shots.length > 0 });
  const [working, setWorking] = useState(false);
  const [writing, setWriting] = useState(false);
  const write = async () => {
    setWriting(true);
    try {
      const body = await window.pinpoint.draftPR({ draft: pr.body, base });
      setPr((now) => ({ ...now, body: `${body}\n\n---\nMade with [Pinpoint](https://github.com/m-ahmed-elbeskeri/pinpoint).` }));
    } catch (e) { flash(errText(e)); } finally { setWriting(false); }
  };
  const submit = async () => {
    setWorking(true);
    try {
      const r = await window.pinpoint.gitOpenPR({ title: pr.title, body: pr.body, draft: pr.draft, base, shots: pr.withShots ? pr.shots : [] });
      const wanted = pr.withShots && pr.shots.length > 0;
      flash(r.existed ? 'Pushed. The pull request already existed; opened it.'
        : wanted && !r.shots ? "Pull request opened, but the screenshots couldn't be uploaded." : 'Pull request opened in your browser.');
      onDone();
    } catch (e) { flash(errText(e)); } finally { setWorking(false); }
  };
  return (
    <div className="git-body">
      {base && <p className="git-note small">Into <b className="mono">{base}</b></p>}
      <label className="git-field">Title<input value={pr.title} onChange={(e) => setPr({ ...pr, title: e.target.value })} /></label>
      <label className="git-field">
        <span className="git-field-head">Description
          <button type="button" className="link-btn" disabled={writing || working} onClick={write} title="Have the agent read the branch's diff and write this. It changes nothing.">
            {writing ? <Loader2 size={11} className="spin" /> : <Sparkles size={11} />} {writing ? 'Writing…' : 'Write it for me'}
          </button>
        </span>
        <textarea rows={7} value={pr.body} onChange={(e) => setPr({ ...pr, body: e.target.value })} />
      </label>
      <label className="git-check"><input type="checkbox" checked={pr.draft} onChange={(e) => setPr({ ...pr, draft: e.target.checked })} /> Open as draft</label>
      {pr.shots.length > 0 && (
        <label className="git-check" title="The screenshots are pushed to a pinpoint-shots branch of this repository so GitHub can show them in the description.">
          <input type="checkbox" checked={pr.withShots} onChange={(e) => setPr({ ...pr, withShots: e.target.checked })} /> Add before and after screenshots ({Math.min(4, pr.shots.length)})
        </label>
      )}
      <div className="git-actions">
        <button className="btn sm ghost" onClick={onBack}>Back</button>
        <div className="spacer" />
        <button className="btn sm primary" disabled={working || !pr.title.trim()} onClick={submit}>
          {working ? <Loader2 size={13} className="spin" /> : <GitPullRequestArrow size={13} />} Push & open PR
        </button>
      </div>
    </div>
  );
}

export function GitPanel({ status, refresh, settings, saveSettings, busy, prDefaults, flash, onOpenWorktree, onCompare, onSwitched }: Props) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [pr, setPr] = useState<PrDefaults | null>(null);
  const [list, setList] = useState<GitBranchInfo[] | null>(null);
  const [pulls, setPulls] = useState<Record<string, GitPull>>({});
  const [q, setQ] = useState('');
  const [more, setMore] = useState(false);
  const [fetching, setFetching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = () => {
    window.pinpoint.gitBranches().then((r) => setList(r.branches)).catch(() => setList([]));
    window.pinpoint.gitPulls().then(setPulls).catch(() => {});
  };

  useEffect(() => {
    if (!open) return;
    refresh();
    if (status?.repo) load();
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); setPr(null); setQ(''); } };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open, status?.repo]);

  // Opening the panel checks origin when the last fetch is a few minutes old, so ahead/behind is current.
  useEffect(() => {
    if (!open || !status?.repo || !status.remote || Date.now() - (status.fetchedAt || 0) < 3 * 60 * 1000) return;
    setFetching(true);
    window.pinpoint.gitFetch().then(() => { refresh(); load(); }).catch(() => {}).finally(() => setFetching(false));
  }, [open, status?.repo]);

  const act = async (label: string, fn: () => Promise<string | void>) => {
    setWorking(label);
    try { const msg = await fn(); if (msg) flash(msg); await refresh(); load(); }
    catch (e) { flash(errText(e)); }
    finally { setWorking(null); }
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = list || [];
    return (needle ? all.filter((b) => b.name.toLowerCase().includes(needle)) : all.filter((b) => !b.remote || more)).slice(0, needle || more ? 200 : 40);
  }, [list, q, more]);

  if (!status) return null;
  const onDefault = status.repo && status.branch === status.defaultBranch;
  const prBlocker = !status.repo ? 'Not a git repository'
    : !status.remote ? 'No "origin" remote yet'
      : !status.gh.installed ? 'Install the GitHub CLI (gh) to open PRs'
        : !status.gh.authed ? 'Run `gh auth login` to open PRs'
          : onDefault ? `You're on ${status.branch}; switch to a branch first` : null;
  const lock = !!working || busy;
  const name = q.trim();
  const exact = !!list?.some((b) => b.name === name);
  const remoteCount = list?.filter((b) => b.remote).length || 0;
  const current = status.branch ? pulls[status.branch] : undefined;

  const openTree = async (dir: string, branch: string) => (await onOpenWorktree(dir)) ? `Opened the ${branch} worktree` : undefined;

  const switchTo = (b: GitBranchInfo) => act(`sw:${b.name}`, async () => {
    if (b.current) return;
    if (b.worktree) return openTree(b.worktree, b.name);
    const r = await window.pinpoint.gitSwitch(b.name);
    if (r.worktree) return openTree(r.worktree, b.name);
    setQ('');
    onSwitched();
    const parts = [`Switched to ${b.name}`];
    if (r.parked) parts.push(`${r.parked} uncommitted change${r.parked > 1 ? 's' : ''} kept on ${status.branch}`);
    if (r.restored) parts.push('your changes on this branch are back');
    if (r.conflict) parts.push(`your earlier changes here didn't apply cleanly and are kept in ${r.conflict}`);
    return parts.join(' · ');
  });

  const create = (worktree: boolean) => act('create', async () => {
    if (worktree) {
      const r = await window.pinpoint.gitWorktreeAdd({ branch: name, create: true });
      setQ('');
      return openTree(r.open, name);
    }
    await window.pinpoint.gitNewBranch(name);
    setQ('');
    return `Created ${name}${status.dirty ? '; your uncommitted changes came along' : ''}`;
  });

  return (
    <div className="git-wrap git-panel" ref={ref}>
      <button className={`chip ${status.repo ? (status.branch?.startsWith('pinpoint/') ? 'on' : '') : 'muted'}`} onClick={() => setOpen(!open)} title={status.linked ? `Git (worktree at ${status.root})` : 'Git'}>
        {status.linked ? <Worktree size={12} /> : <GitBranch size={12} />}
        {status.repo && <span className="chip-ellipsis">{status.branch}</span>}
        {status.repo && !!status.dirty && <span className="git-dirty" title={`${status.dirty} uncommitted change${status.dirty > 1 ? 's' : ''}`}>{status.dirty}</span>}
        {status.repo && (!!status.ahead || !!status.behind) && (
          <span className="git-sync-mini" title={`${status.ahead || 0} to push, ${status.behind || 0} to pull`}>{status.ahead ? `↑${status.ahead}` : ''}{status.behind ? `↓${status.behind}` : ''}</span>
        )}
      </button>

      {open && (
        <div className="git-pop branch-pop">
          <div className="git-head">
            {status.linked ? <Worktree size={14} /> : <GitBranch size={14} />}
            <b>{status.repo ? status.branch : 'Git'}</b>
            {status.repo && <span className="hint">{status.dirty ? `${status.dirty} uncommitted` : 'clean'}{status.linked ? ' · worktree' : ''}</span>}
            <div className="spacer" />
            <button className="icon-btn xs" onClick={() => { setOpen(false); setPr(null); }}><X size={13} /></button>
          </div>

          {status.repo && !pr && <SyncStrip status={status} fetching={fetching} working={working} lock={lock} act={act}
            onCompareRemote={() => { setOpen(false); onCompare(undefined, true); }}
            onFetch={() => { setFetching(true); window.pinpoint.gitFetch().then(() => { refresh(); load(); }).catch((e) => flash(errText(e))).finally(() => setFetching(false)); }} />}

          {!status.repo ? (
            <div className="git-body">
              <p className="git-note">This project isn't a git repository yet. Initialize one to get a branch per chat, a commit per run and pull requests.</p>
              <button className="btn sm primary" disabled={!!working} onClick={() => act('init', async () => { await window.pinpoint.gitInit(); return 'Initialized a git repository.'; })}>
                {working === 'init' ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Initialize git
              </button>
            </div>
          ) : pr ? (
            <PrForm defaults={pr} onBack={() => setPr(null)} onDone={() => { setPr(null); refresh(); load(); }} flash={flash} />
          ) : (
            <>
              <div className="gb-search">
                <Search size={13} />
                <input autoFocus placeholder="Find or create a branch" value={q} onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || lock) return;
                    if (shown[0] && (exact || !name)) switchTo(shown.find((b) => b.name === name) || shown[0]);
                    else if (name) create(false);
                  }} />
              </div>
              <ul className="gb-list">
                {name && !exact && (
                  <li className="gb-create">
                    <Plus size={13} /><span className="gb-name">Create <b>{name}</b></span>
                    <button className="btn xs" disabled={lock} onClick={() => create(false)} title="New branch from here; uncommitted changes come along">Here</button>
                    <button className="btn xs" disabled={lock} onClick={() => create(true)} title="New branch in its own folder; this folder stays as it is"><Worktree size={12} /> Worktree</button>
                  </li>
                )}
                {!list ? <li className="gb-empty"><Loader2 size={14} className="spin" /></li>
                  : !shown.length && !name ? <li className="gb-empty">No branches yet</li>
                    : shown.map((b) => {
                      const p = pulls[b.name];
                      return (
                        <li key={(b.remote ? 'r:' : '') + b.name} className={`gb-row ${b.current ? 'current' : ''}`}>
                          <button className="gb-main" disabled={lock || b.current} onClick={() => switchTo(b)}
                            title={b.current ? 'You are here' : b.worktree ? `Open its worktree: ${b.worktree}` : b.remote ? `Check out ${b.name} from origin` : `Switch to ${b.name}`}>
                            {working === `sw:${b.name}` ? <Loader2 size={12} className="spin" /> : b.worktree ? <Worktree size={12} /> : <GitBranch size={12} />}
                            <span className="gb-text">
                              <span className="gb-name">{b.name}{b.remote && <i> origin</i>}</span>
                              <small>{b.when ? ago(b.when) : ''}{b.subject ? ` · ${b.subject}` : ''}</small>
                            </span>
                          </button>
                          <span className="gb-tags">
                            {!!b.parked && <span className="gb-tag" title="Uncommitted changes kept for this branch; they come back when you switch to it"><Archive size={11} />{b.parked > 1 ? b.parked : ''}</span>}
                            {(b.ahead > 0 || b.behind > 0) && <span className="gb-tag mono" title={`${b.ahead} to push, ${b.behind} to pull`}>{b.ahead ? `↑${b.ahead}` : ''}{b.behind ? `↓${b.behind}` : ''}</span>}
                            {p && <PrBadge pr={p} />}
                          </span>
                          <span className="gb-acts">
                            {!b.current && <button className="icon-btn xs" title={`Compare with ${b.name}: what a PR into it would contain`} onClick={() => { setOpen(false); onCompare(b.name); }}><GitCompareArrows size={12} /></button>}
                            {!b.current && !b.worktree && (
                              <button className="icon-btn xs" disabled={lock} title="Open in its own worktree (a separate folder), leaving this one as it is"
                                onClick={() => act(`sw:${b.name}`, async () => { const r = await window.pinpoint.gitWorktreeAdd({ branch: b.name }); return openTree(r.open, b.name); })}><Worktree size={12} /></button>
                            )}
                            {b.worktree && (
                              <button className="icon-btn xs" disabled={lock} title="Remove this worktree folder (the branch is kept)"
                                onClick={() => act(`sw:${b.name}`, async () => { await window.pinpoint.gitWorktreeRemove(b.worktree!); return `Removed the ${b.name} worktree; the branch is kept`; })}><Trash2 size={12} /></button>
                            )}
                          </span>
                        </li>
                      );
                    })}
                {!name && remoteCount > 0 && (
                  <li className="gb-more"><button onClick={() => setMore(!more)}>{more ? 'Hide' : 'Show'} {remoteCount} branch{remoteCount > 1 ? 'es' : ''} only on origin</button></li>
                )}
              </ul>
              <div className="git-body">
                {!!status.dirty && <p className="git-note small">Switching keeps your {status.dirty} uncommitted change{status.dirty > 1 ? 's' : ''} with {status.branch}; they come back when you return.</p>}
                <details className="gb-settings">
                  <summary>Automatic branches and commits</summary>
                  <Toggle on={settings.gitBranchPerChat} onChange={(v) => saveSettings({ gitBranchPerChat: v })} label="New branch for each chat" hint="A new chat starts on a pinpoint/… branch" />
                  <Toggle on={settings.gitAutoCommit} onChange={(v) => saveSettings({ gitAutoCommit: v })} label="Commit after each run" hint="Commits only the files the agent changed" />
                </details>
                <div className="git-actions">
                  <button className="btn xs" disabled={!!working} onClick={() => { setOpen(false); onCompare(); }} title="See every change on this branch, against any base branch">
                    <GitCompareArrows size={12} /> Changes
                  </button>
                  <button className="btn xs" disabled={lock || !status.dirty} title={status.dirty ? 'Stage and commit everything' : 'Nothing to commit'} onClick={() => act('commit', async () => {
                    const c = await window.pinpoint.gitCommitAll(prDefaults().title || 'Visual edits');
                    return `Committed ${c.hash}`;
                  })}>
                    {working === 'commit' ? <Loader2 size={12} className="spin" /> : <GitCommitHorizontal size={12} />} Commit all
                  </button>
                  <div className="spacer" />
                  {current && current.state !== 'MERGED' && current.state !== 'CLOSED' ? (
                    <button className="btn xs" title={`${current.title}: open on GitHub`} onClick={() => window.pinpoint.gitOpenUrl(current.url)}>
                      <GitPullRequestArrow size={12} /> PR #{current.number}{current.state === 'DRAFT' ? ' (draft)' : ''}
                    </button>
                  ) : (
                    <button className="btn xs primary" disabled={lock || !!prBlocker} title={prBlocker || `Push this branch and open a pull request into ${status.defaultBranch}`} onClick={() => setPr(prDefaults())}>
                      <GitPullRequestArrow size={12} /> Open PR
                    </button>
                  )}
                </div>
                {prBlocker && <p className="git-note small">{prBlocker}.</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
