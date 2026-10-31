import { useState } from 'react';
import { GitMerge, GitPullRequestArrow, Loader2, Sparkles } from '../ui/icons';
import { errText } from '../../lib/util';
import type { GitPull } from '../../types';

export type PrDefaults = { title: string; body: string; shots: { runId: string; label: string }[] };

export function PrBadge({ pr }: { pr: GitPull }) {
  return (
    <button className={`gb-pr ${pr.state.toLowerCase()}`} title={`${pr.title} (${pr.state.toLowerCase()})`} onClick={(e) => { e.stopPropagation(); window.pinpoint.gitOpenUrl(pr.url); }}>
      {pr.state === 'MERGED' ? <GitMerge size={11} /> : <GitPullRequestArrow size={11} />}#{pr.number}
    </button>
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
