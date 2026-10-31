const fs = require('node:fs');
const path = require('node:path');
const { prepareWorktree } = require('../fsutil.cjs');
const { SLOW_TIMEOUT_MS, git, quiet, samePath, slugify, validName } = require('./exec.cjs');

async function worktrees(cwd) {
  const here = await git(cwd, ['rev-parse', '--show-toplevel']);
  const out = (await quiet(git(cwd, ['worktree', 'list', '--porcelain']))) || '';
  return out.split(/\n\s*\n/).filter(Boolean).map((block, i) => {
    const w = { path: '', branch: null, main: i === 0, current: false };
    for (const line of block.split('\n')) {
      const at = line.indexOf(' ');
      const key = at < 0 ? line : line.slice(0, at), val = at < 0 ? '' : line.slice(at + 1);
      if (key === 'worktree') w.path = path.resolve(val);
      else if (key === 'branch') w.branch = val.replace(/^refs\/heads\//, '');
    }
    w.current = !!w.path && samePath(w.path, here);
    return w;
  }).filter((w) => w.path && (w.main || w.branch || w.current));
}

// The same project folder inside another worktree (the project may live in a subfolder of the repository).
async function inTree(cwd, treePath) {
  const top = await git(cwd, ['rev-parse', '--show-toplevel']);
  return path.join(treePath, path.relative(path.resolve(top), path.resolve(cwd)));
}

async function addWorktree(cwd, { branch, create }) {
  if (create) await validName(cwd, branch);
  const trees = await worktrees(cwd);
  const taken = trees.find((w) => w.branch === branch);
  if (taken) return { open: await inTree(cwd, taken.path), existed: true };
  const main = trees[0].path;
  const home = path.join(path.dirname(main), `${path.basename(main)}.worktrees`);
  let dir = path.join(home, slugify(branch));
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(home, `${slugify(branch)}-${i}`);
  fs.mkdirSync(home, { recursive: true });
  await git(cwd, ['worktree', 'add', ...(create ? ['-b', branch, dir, 'HEAD'] : [dir, branch])], { timeout: SLOW_TIMEOUT_MS });
  const open = await inTree(cwd, dir);
  const project = path.resolve(cwd), mainProject = await inTree(cwd, main);
  // Make it ready to run: share the installed packages and bring the local env files and project memory along.
  const warnings = [...prepareWorktree(main, dir, { env: true }), ...prepareWorktree(mainProject, open, { env: true })];
  for (const f of ['memory.json', 'profiles.json']) {
    try {
      const src = path.join(project, '.pinpoint', f);
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(path.join(open, '.pinpoint'), { recursive: true });
      if (!fs.existsSync(path.join(open, '.pinpoint', '.gitignore'))) fs.writeFileSync(path.join(open, '.pinpoint', '.gitignore'), '*\n');
      fs.copyFileSync(src, path.join(open, '.pinpoint', f));
    } catch (err) { warnings.push(`${f}: ${err.message}`); }
  }
  for (const w of warnings) console.warn(`worktree setup: ${w}`);
  return { open, existed: false, warnings };
}

async function findTree(cwd, dir) {
  for (const w of await worktrees(cwd)) {
    const open = await inTree(cwd, w.path);
    if (samePath(open, dir) || samePath(w.path, dir)) return { ...w, open };
  }
  return null;
}

async function removeWorktree(cwd, dir) {
  const tree = await findTree(cwd, dir);
  if (!tree) throw new Error('That worktree no longer exists.');
  if (tree.main) throw new Error("The main checkout can't be removed.");
  if (tree.current) throw new Error('Switch to another worktree before removing this one.');
  if (await git(tree.path, ['status', '--porcelain'])) throw new Error(`${tree.branch || 'This worktree'} has uncommitted changes. Commit them or switch branches there first.`);
  // Unlink the shared node_modules first so removing the folder can't reach through into the main checkout's packages.
  const unlink = (at, depth) => {
    try {
      for (const f of fs.readdirSync(at, { withFileTypes: true })) {
        const p = path.join(at, f.name);
        if (f.name === 'node_modules') { if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p); }
        else if (depth < 4 && f.isDirectory() && !f.name.startsWith('.')) unlink(p, depth + 1);
      }
    } catch { /* gone, or unreadable: git reports what it can't remove */ }
  };
  unlink(tree.path, 0);
  await git(cwd, ['worktree', 'remove', '--force', tree.path]);
  await quiet(git(cwd, ['worktree', 'prune']));
  return { branch: tree.branch };
}

module.exports = { worktrees, inTree, addWorktree, findTree, removeWorktree };
