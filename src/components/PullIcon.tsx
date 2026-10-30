import { GitMerge, GitPullRequestArrow, XCircle } from './icons';
import type { GitPull } from '../lib/types';

const WORD = { OPEN: 'Open', DRAFT: 'Draft', MERGED: 'Merged', CLOSED: 'Closed without merging' };

// A chat's pull request at a glance; a click opens it on GitHub.
export function PullIcon({ pull, branch }: { pull?: GitPull; branch?: string }) {
  if (!pull) return null;
  const Icon = pull.state === 'MERGED' ? GitMerge : pull.state === 'CLOSED' ? XCircle : GitPullRequestArrow;
  return (
    <button
      className={`pull-icon ${pull.state.toLowerCase()}`}
      onClick={(e) => { e.stopPropagation(); window.pinpoint.gitOpenUrl(pull.url); }}
      title={`${WORD[pull.state]} pull request #${pull.number}: ${pull.title}${branch ? ` (${branch})` : ''}`}
    >
      <Icon size={13} />
    </button>
  );
}
