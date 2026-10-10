import { useEffect, useRef, useState } from 'react';
import { GitBranch, GitCommitHorizontal, GitPullRequestArrow, Loader2, Plus, X } from './icons';
import type { GitStatus, Settings } from '../lib/types';

interface Props {
  status: GitStatus | null;
  refresh(): Promise<void>;
  settings: Settings;
  saveSettings(p: Partial<Settings>): void;
  busy: boolean;                 // agent running
  prDefaults(): { title: string; body: string };
  flash(msg: string): void;
}

const errText = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange(v: boolean): void; label: string; hint: string }) {
  return (
    <button className={`git-toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      <span className="git-toggle-text"><b>{label}</b><small>{hint}</small></span>
    </button>
  );
}

// Branch chip + popover: branch per chat, commit after each run, open a PR.
export function GitPanel({ status, refresh, settings, saveSettings, busy, prDefaults, flash }: Props) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [pr, setPr] = useState<{ title: string; body: string; draft: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    refresh();
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); setPr(null); } };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (label: string, fn: () => Promise<string | void>) => {
    setWorking(label);
    try { const msg = await fn(); if (msg) flash(msg); await refresh(); }
    catch (e) { flash(errText(e)); }
    finally { setWorking(null); }
  };

  if (!status) return null;
  const onDefault = status.repo && status.branch === status.defaultBranch;
  const prBlocker = !status.repo ? 'Not a git repository'
    : !status.remote ? 'No "origin" remote yet'
      : !status.gh.installed ? 'Install the GitHub CLI (gh) to open PRs'
        : !status.gh.authed ? 'Run `gh auth login` to open PRs'
          : onDefault ? `You're on ${status.branch}; switch to a branch first` : null;

  return (
    <div className="git-wrap" ref={ref}>
      <button className={`chip ${status.repo ? (status.branch?.startsWith('pinpoint/') ? 'on' : '') : 'muted'}`} onClick={() => setOpen(!open)} title="Git">
        <GitBranch size={12} />
        <span className="chip-ellipsis">{status.repo ? status.branch : 'No git'}</span>
        {status.repo && !!status.dirty && <span className="git-dirty" title={`${status.dirty} uncommitted change${status.dirty > 1 ? 's' : ''}`}>{status.dirty}</span>}
      </button>

      {open && (
        <div className="git-pop">
          <div className="git-head">
            <GitBranch size={14} />
            <b>{status.repo ? status.branch : 'Git'}</b>
            {status.repo && <span className="hint">{status.dirty ? `${status.dirty} uncommitted` : 'clean'}{status.ahead ? ` · ${status.ahead} to push` : ''}</span>}
            <div className="spacer" />
            <button className="icon-btn xs" onClick={() => { setOpen(false); setPr(null); }}><X size={13} /></button>
          </div>

          {!status.repo ? (
            <div className="git-body">
              <p className="git-note">This project isn't a git repository yet. Initialize one to get a branch per chat, a commit per run and pull requests.</p>
              <button className="btn sm primary" disabled={!!working} onClick={() => act('init', async () => { await window.pinpoint.gitInit(); return 'Initialized a git repository.'; })}>
                {working === 'init' ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Initialize git
              </button>
            </div>
          ) : pr ? (
            <div className="git-body">
              <label className="git-field">Title<input value={pr.title} onChange={(e) => setPr({ ...pr, title: e.target.value })} /></label>
              <label className="git-field">Description<textarea rows={7} value={pr.body} onChange={(e) => setPr({ ...pr, body: e.target.value })} /></label>
              <label className="git-check"><input type="checkbox" checked={pr.draft} onChange={(e) => setPr({ ...pr, draft: e.target.checked })} /> Open as draft</label>
              <div className="git-actions">
                <button className="btn sm ghost" onClick={() => setPr(null)}>Back</button>
                <div className="spacer" />
                <button className="btn sm primary" disabled={!!working || !pr.title.trim()} onClick={() => act('pr', async () => {
                  const r = await window.pinpoint.gitOpenPR(pr);
                  setPr(null);
                  return r.existed ? 'Pushed. The pull request already existed; opened it.' : 'Pull request opened in your browser.';
                })}>
                  {working === 'pr' ? <Loader2 size={13} className="spin" /> : <GitPullRequestArrow size={13} />} Push & open PR
                </button>
              </div>
            </div>
          ) : (
            <div className="git-body">
              <Toggle on={settings.gitBranchPerChat} onChange={(v) => saveSettings({ gitBranchPerChat: v })} label="New branch for each chat" hint="A new chat starts on a pinpoint/… branch" />
              <Toggle on={settings.gitAutoCommit} onChange={(v) => saveSettings({ gitAutoCommit: v })} label="Commit after each run" hint="Commits only the files the agent changed" />
              <div className="git-actions">
                <button className="btn xs" disabled={!!working || busy} onClick={() => act('branch', async () => { const r = await window.pinpoint.gitBranch('visual-edit'); return `Switched to ${r.branch}`; })}>
                  {working === 'branch' ? <Loader2 size={12} className="spin" /> : <GitBranch size={12} />} New branch
                </button>
                <button className="btn xs" disabled={!!working || busy || !status.dirty} title={status.dirty ? 'Stage and commit everything' : 'Nothing to commit'} onClick={() => act('commit', async () => {
                  const c = await window.pinpoint.gitCommitAll(prDefaults().title || 'Visual edits');
                  return `Committed ${c.hash}`;
                })}>
                  {working === 'commit' ? <Loader2 size={12} className="spin" /> : <GitCommitHorizontal size={12} />} Commit all
                </button>
                <div className="spacer" />
                <button className="btn xs primary" disabled={!!working || busy || !!prBlocker} title={prBlocker || 'Push this branch and open a pull request'} onClick={() => setPr({ ...prDefaults(), draft: false })}>
                  <GitPullRequestArrow size={12} /> Open PR
                </button>
              </div>
              {prBlocker && status.repo && <p className="git-note small">{prBlocker}.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
