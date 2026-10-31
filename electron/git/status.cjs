const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, git, quiet, samePath } = require('./exec.cjs');

const GH_STATE_MS = 5 * 60 * 1000;

let ghState = null;
async function ghStatus() {
  if (ghState) return ghState;
  const installed = !!(await quiet(run('gh', ['--version'], os.homedir(), { timeout: 8000 })));
  let user = null;
  if (installed) user = await quiet(run('gh', ['api', 'user', '--jq', '.login'], os.homedir(), { timeout: 15000 }));
  ghState = { installed, authed: !!user, user };
  setTimeout(() => { ghState = null; }, GH_STATE_MS).unref();
  return ghState;
}

// fast: don't wait for GitHub, which goes over the network. The caller asks again without it.
async function status(cwd, { fast } = {}) {
  const root = await quiet(git(cwd, ['rev-parse', '--show-toplevel']));
  if (!root) return { repo: false, gh: fast ? (ghState || { installed: true, authed: true, user: null, checking: true }) : await ghStatus() };
  const [symbolic, porcelain, remote, originHead, counts, head, dirs] = await Promise.all([
    quiet(git(cwd, ['symbolic-ref', '--short', 'HEAD'])),
    quiet(git(cwd, ['status', '--porcelain'])),
    quiet(git(cwd, ['remote', 'get-url', 'origin'])),
    quiet(git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])),
    quiet(git(cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])),
    quiet(git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])),
    quiet(git(cwd, ['rev-parse', '--git-dir', '--git-common-dir'])),
  ]);
  const branch = symbolic || (await quiet(git(cwd, ['rev-parse', '--short', 'HEAD']))) || 'HEAD';
  const defaultBranch = originHead ? originHead.replace(/^origin\//, '') : (await quiet(git(cwd, ['rev-parse', '--verify', '--quiet', 'main']))) != null ? 'main' : 'master';
  const [behind, ahead] = counts ? counts.split(/\s+/).map(Number) : [0, 0];
  const hasCommits = !!head;
  const [gitDir, commonDir] = (dirs || '').split('\n');
  const linked = !!gitDir && !samePath(path.resolve(cwd, gitDir), path.resolve(cwd, commonDir || gitDir));
  const upstreamName = counts ? await quiet(git(cwd, ['rev-parse', '--abbrev-ref', '@{u}'])) : null;
  // Tracking was set up but the branch has since been deleted on origin (usually after its PR merged).
  const gone = !counts && !!(await quiet(git(cwd, ['config', `branch.${branch}.merge`])));
  let fetchedAt = 0;
  try { fetchedAt = fs.statSync(path.resolve(cwd, commonDir || gitDir || '.git', 'FETCH_HEAD')).mtimeMs; } catch { /* never fetched */ }
  return {
    repo: true, root, branch, defaultBranch, remote, hasCommits, linked,
    dirty: porcelain ? porcelain.split('\n').length : 0,
    ahead, behind, upstream: !!counts, upstreamName, gone, fetchedAt,
    gh: fast ? (ghState || { installed: true, authed: true, user: null, checking: true }) : await ghStatus(),
  };
}

async function initRepo(cwd) {
  await git(cwd, ['init', '-b', 'main']).catch(() => git(cwd, ['init']));
  return status(cwd);
}

module.exports = { ghStatus, status, initRepo };
