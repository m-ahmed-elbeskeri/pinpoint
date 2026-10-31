const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TIMEOUT_MS, SLOW_TIMEOUT_MS, git, quiet, slugify, validName } = require('./exec.cjs');
const { status } = require('./status.cjs');
const { SHOT_BRANCH, forgetPulls } = require('./github.cjs');
const { worktrees, inTree } = require('./worktree.cjs');

const PARK = 'pinpoint-park:';

async function createBranch(cwd, hint) {
  const name = `pinpoint/${slugify(hint)}-${Math.random().toString(36).slice(2, 6)}`;
  await quiet(git(cwd, ['switch', '-c', name])) ?? (await git(cwd, ['checkout', '-b', name]));
  return name;
}

async function commitPaths(cwd, paths, message) {
  if (!paths.length) return null;
  await git(cwd, ['add', '-A', '--', ...paths]);
  const staged = await quiet(git(cwd, ['diff', '--cached', '--name-only', '--', ...paths]));
  if (!staged) return null;
  const file = path.join(os.tmpdir(), `pinpoint-commit-${Date.now()}.txt`);
  fs.writeFileSync(file, message);
  try {
    await git(cwd, ['commit', '-F', file, '--', ...paths]);
  } finally { fs.rmSync(file, { force: true }); }
  const hash = await git(cwd, ['rev-parse', '--short', 'HEAD']);
  return { hash, subject: message.split('\n')[0] };
}

async function commitAll(cwd, message) {
  await git(cwd, ['add', '-A']);
  const staged = await quiet(git(cwd, ['diff', '--cached', '--name-only']));
  if (!staged) throw new Error('Nothing to commit.');
  const file = path.join(os.tmpdir(), `pinpoint-commit-${Date.now()}.txt`);
  fs.writeFileSync(file, message);
  try { await git(cwd, ['commit', '-F', file]); } finally { fs.rmSync(file, { force: true }); }
  return { hash: await git(cwd, ['rev-parse', '--short', 'HEAD']), subject: message.split('\n')[0] };
}

async function parked(cwd) {
  const out = (await quiet(git(cwd, ['stash', 'list', '--format=%gd%x00%s']))) || '';
  return out.split('\n').filter(Boolean).flatMap((l) => {
    const [ref, subject = ''] = l.split('\0');
    const at = subject.indexOf(PARK);
    return at < 0 ? [] : [{ ref, branch: subject.slice(at + PARK.length).trim() }];
  });
}

async function branches(cwd) {
  const [refs, trees, parks, current] = await Promise.all([
    git(cwd, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%00%(upstream:track)%00%(committerdate:unix)%00%(subject)', 'refs/heads', 'refs/remotes']),
    worktrees(cwd), parked(cwd), quiet(git(cwd, ['symbolic-ref', '--short', 'HEAD'])),
  ]);
  const rows = refs.split('\n').filter(Boolean).map((line) => {
    const [ref, track = '', when, subject = ''] = line.split('\0');
    const remote = ref.startsWith('refs/remotes/');
    return { ref, remote, track, when, subject, name: remote ? ref.replace(/^refs\/remotes\/[^/]+\//, '') : ref.replace(/^refs\/heads\//, '') };
  });
  const local = new Set(rows.filter((r) => !r.remote).map((r) => r.name));
  const list = [];
  for (const r of rows) {
    if (r.remote && (r.name === 'HEAD' || local.has(r.name) || r.name === SHOT_BRANCH || list.some((b) => b.name === r.name))) continue;
    const tree = r.remote ? null : trees.find((w) => w.branch === r.name);
    list.push({
      name: r.name, remote: r.remote, subject: r.subject, when: Number(r.when) * 1000 || 0,
      current: !!tree?.current && r.name === current,
      ahead: Number(/ahead (\d+)/.exec(r.track)?.[1] || 0), behind: Number(/behind (\d+)/.exec(r.track)?.[1] || 0), gone: /gone/.test(r.track),
      worktree: tree && !tree.current ? await inTree(cwd, tree.path) : null,
      parked: parks.filter((p) => p.branch === r.name).length,
    });
    if (list.length >= 200) break;
  }
  return { branches: list, worktrees: await Promise.all(trees.map(async (w) => ({ ...w, open: await inTree(cwd, w.path) }))) };
}

async function fetchOrigin(cwd) {
  if (!(await quiet(git(cwd, ['remote', 'get-url', 'origin'])))) throw new Error('No "origin" remote to fetch from.');
  await git(cwd, ['fetch', '--prune', '--quiet', 'origin'], { timeout: TIMEOUT_MS });
  forgetPulls();
  return status(cwd);
}

// Fast-forward only, carrying uncommitted edits across: never makes a merge commit behind your back.
async function pull(cwd) {
  const st = await status(cwd);
  if (!st.upstream) throw new Error(`${st.branch} isn't tracking a branch on origin yet.`);
  await git(cwd, ['pull', '--ff-only', '--autostash', '--quiet'], { timeout: SLOW_TIMEOUT_MS }).catch((e) => {
    throw new Error(/not possible to fast-forward|diverg/i.test(e.message)
      ? `${st.branch} and its copy on origin have both moved on. Open Changes to see both sides, then merge or rebase in the terminal.` : e.message);
  });
  return status(cwd);
}

async function push(cwd) {
  const st = await status(cwd);
  if (!st.remote) throw new Error('No "origin" remote to push to.');
  if (st.behind) throw new Error(`origin has ${st.behind} commit${st.behind > 1 ? 's' : ''} you don't have yet. Pull first.`);
  await git(cwd, ['push', '-u', 'origin', st.branch], { timeout: SLOW_TIMEOUT_MS });
  forgetPulls();
  return status(cwd);
}

const stashTop = (cwd) => quiet(git(cwd, ['rev-parse', '--verify', '--quiet', 'refs/stash']));

// Switches this folder to another branch. Uncommitted work is parked in a stash named after the branch it
// belongs to, and whatever was parked for the branch being switched to comes back.
async function switchBranch(cwd, name) {
  const top = await git(cwd, ['rev-parse', '--show-toplevel']);
  const tree = (await worktrees(cwd)).find((w) => w.branch === name);
  if (tree && !tree.current) return { worktree: await inTree(cwd, tree.path) };
  const from = await quiet(git(top, ['symbolic-ref', '--short', 'HEAD']));
  if (from === name) return { branch: name, parked: 0, restored: false, conflict: null };
  const dirty = await git(top, ['status', '--porcelain']);
  let parkedNow = 0;
  if (dirty) {
    const before = await stashTop(top);
    await git(top, ['stash', 'push', '--include-untracked', '-m', `${PARK}${from || 'detached'}`]);
    if ((await stashTop(top)) !== before) parkedNow = dirty.split('\n').length;
  }
  try { await git(top, ['switch', name]); }
  catch (e) {
    if (parkedNow) await quiet(git(top, ['stash', 'pop', '--index']));
    throw e;
  }
  const mine = (await parked(top)).find((p) => p.branch === name);
  let restored = false, conflict = null;
  if (mine) {
    try { await git(top, ['stash', 'pop', '--index', mine.ref]); restored = true; }
    catch { conflict = mine.ref; }
  }
  return { branch: name, parked: parkedNow, restored, conflict };
}

async function newBranch(cwd, name) {
  await validName(cwd, name);
  await git(cwd, ['switch', '-c', name]);
  return { branch: name };
}

function commitMessage(request, changes, agentName) {
  const firstNote = request.annotations.map((a) => a.note?.trim()).find(Boolean);
  let subject = (request.instruction?.trim() || firstNote || 'Visual edit').split('\n')[0].trim();
  if (subject.length > 72) subject = subject.slice(0, 69).trimEnd() + '...';
  const lines = [subject, ''];
  const notes = request.annotations.filter((a) => a.note?.trim());
  if (notes.length) {
    for (const a of notes) {
      const target = a.element ? `<${a.element.tag}>${a.element.source?.file ? ` in ${a.element.source.file}` : ''}` : a.kind;
      lines.push(`- [${a.n}] ${target}: ${a.note.trim().split('\n')[0]}`);
    }
    lines.push('');
  }
  if (request.instruction?.trim() && request.instruction.trim().split('\n').length > 1) {
    lines.push(request.instruction.trim(), '');
  }
  lines.push(`Changed: ${changes.map((c) => c.path).join(', ')}`, '', `Made with Pinpoint (${agentName}).`);
  return lines.join('\n');
}

module.exports = { createBranch, commitPaths, commitAll, commitMessage, branches, fetchOrigin, pull, push, switchBranch, newBranch };
