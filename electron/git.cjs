const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function run(cmd, args, cwd, { timeout = 60000, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env } }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message).trim().split('\n').filter(Boolean).slice(-3).join(' ');
        return reject(Object.assign(new Error(msg || err.message), { code: err.code }));
      }
      resolve(String(stdout).trim());
    });
  });
}
const git = (cwd, args, opts) => run('git', args, cwd, opts);
const quiet = (p) => p.catch(() => null);

let ghState = null;
async function ghStatus() {
  if (ghState) return ghState;
  const installed = !!(await quiet(run('gh', ['--version'], os.homedir(), { timeout: 8000 })));
  let user = null;
  if (installed) user = await quiet(run('gh', ['api', 'user', '--jq', '.login'], os.homedir(), { timeout: 15000 }));
  ghState = { installed, authed: !!user, user };
  setTimeout(() => { ghState = null; }, 5 * 60 * 1000).unref();
  return ghState;
}

async function status(cwd) {
  const root = await quiet(git(cwd, ['rev-parse', '--show-toplevel']));
  if (!root) return { repo: false, gh: await ghStatus() };
  const branch = (await quiet(git(cwd, ['symbolic-ref', '--short', 'HEAD']))) || (await quiet(git(cwd, ['rev-parse', '--short', 'HEAD']))) || 'HEAD';
  const porcelain = (await quiet(git(cwd, ['status', '--porcelain']))) || '';
  const remote = await quiet(git(cwd, ['remote', 'get-url', 'origin']));
  const originHead = await quiet(git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']));
  const defaultBranch = originHead ? originHead.replace(/^origin\//, '') : (await quiet(git(cwd, ['rev-parse', '--verify', '--quiet', 'main']))) != null ? 'main' : 'master';
  const counts = await quiet(git(cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD']));
  const [behind, ahead] = counts ? counts.split(/\s+/).map(Number) : [0, 0];
  const hasCommits = !!(await quiet(git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])));
  const [gitDir, commonDir] = ((await quiet(git(cwd, ['rev-parse', '--git-dir', '--git-common-dir']))) || '').split('\n');
  const linked = !!gitDir && !samePath(path.resolve(cwd, gitDir), path.resolve(cwd, commonDir || gitDir));
  const upstreamName = counts ? await quiet(git(cwd, ['rev-parse', '--abbrev-ref', '@{u}'])) : null;
  // Tracking was set up but the branch has since been deleted on origin (usually after its PR merged).
  const gone = !counts && !!(await quiet(git(cwd, ['config', `branch.${branch}.merge`])));
  let fetchedAt = 0;
  try { fetchedAt = fs.statSync(path.resolve(cwd, commonDir || gitDir || '.git', 'FETCH_HEAD')).mtimeMs; } catch {  }
  return {
    repo: true, root, branch, defaultBranch, remote, hasCommits, linked,
    dirty: porcelain ? porcelain.split('\n').length : 0,
    ahead, behind, upstream: !!counts, upstreamName, gone, fetchedAt,
    gh: await ghStatus(),
  };
}

const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

function slugify(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'visual-edit';
}

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

async function initRepo(cwd) {
  await git(cwd, ['init', '-b', 'main']).catch(() => git(cwd, ['init']));
  return status(cwd);
}

const SHOT_BRANCH = 'pinpoint-shots';

// git that hands back stdout even when the exit code is non-zero (merge-tree exits 1 on conflicts).
function gitRaw(cwd, args, encoding = 'utf8') {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: 60000, maxBuffer: 64 * 1024 * 1024, encoding, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out: stdout }));
  });
}

const MAX_TEXT = 512 * 1024;
const isBinary = (buf) => buf.subarray(0, 8000).includes(0);
async function blobAt(cwd, rev, file) {
  const r = await gitRaw(cwd, ['show', `${rev}:${file}`], 'buffer');
  return r.code ? null : r.out;
}

// Files changed from `from` to `to` (a commit, or the working tree when `to` is null), with both sides' text.
async function changedFiles(top, from, to) {
  const listed = await git(top, ['diff', '--name-status', '-M', '-z', from, ...(to ? [to] : [])]);
  const parts = listed.split('\0').filter((x) => x !== '');
  const entries = [];
  for (let i = 0; i < parts.length;) {
    const st = parts[i++];
    if (/^[RC]/.test(st)) { const old = parts[i++], now = parts[i++]; entries.push({ kind: 'modify', path: now, from: old }); }
    else { const p = parts[i++]; entries.push({ kind: st[0] === 'A' ? 'add' : st[0] === 'D' ? 'delete' : 'modify', path: p, from: p }); }
  }
  if (!to) {
    for (const p of ((await quiet(git(top, ['ls-files', '--others', '--exclude-standard', '-z']))) || '').split('\0').filter(Boolean)) {
      if (!entries.some((e) => e.path === p)) entries.push({ kind: 'add', path: p, from: p, untracked: true });
    }
  }
  const files = [];
  for (const e of entries.slice(0, 300)) {
    const before = e.kind === 'add' ? Buffer.alloc(0) : await blobAt(top, from, e.from);
    let after = Buffer.alloc(0);
    if (e.kind !== 'delete') after = !to ? (() => { try { return fs.readFileSync(path.join(top, e.path)); } catch { return null; } })() : await blobAt(top, to, e.path);
    const binary = !!(before && isBinary(before)) || !!(after && isBinary(after));
    const tooLarge = (before?.length || 0) > MAX_TEXT || (after?.length || 0) > MAX_TEXT;
    const text = (b) => (b && !binary && !tooLarge ? b.toString('utf8') : null);
    const was = text(before);
    let now = text(after);
    // A checkout with autocrlf has CRLF on disk while the committed side has LF; that isn't a change worth showing.
    if (!to && now != null && was != null && !was.includes('\r')) now = now.replace(/\r\n/g, '\n');
    files.push({ path: e.path, from: e.from !== e.path ? e.from : undefined, kind: e.kind, reverted: false, binary, tooLarge, untracked: !!e.untracked, before: was, after: now });
  }
  return { files, total: entries.length };
}

// What a pull request from this branch into `base` would contain: the diff from the merge base (what GitHub shows),
// the commits, and whether it merges cleanly. With `working`, uncommitted changes are counted in too.
// With `remote`, the other side is this branch's own copy on origin: `files` is what you'd push, `incomingFiles`
// what you'd pull, each from the point where the two copies split.
async function compare(cwd, { base, working = true, remote = false }) {
  const top = await git(cwd, ['rev-parse', '--show-toplevel']);
  const branch = (await quiet(git(top, ['symbolic-ref', '--short', 'HEAD']))) || 'HEAD';
  const origin = !!(await quiet(git(top, ['remote', 'get-url', 'origin'])));
  if (remote) base = branch;
  if (origin) await quiet(git(top, ['fetch', '--quiet', 'origin', base], { timeout: 20000 }));
  const remoteRef = `refs/remotes/origin/${base}`;
  const ref = (await quiet(git(top, ['rev-parse', '--verify', '--quiet', remoteRef]))) ? remoteRef
    : !remote && (await quiet(git(top, ['rev-parse', '--verify', '--quiet', base]))) ? base : null;
  if (!ref) throw new Error(remote ? `${branch} isn't on origin yet. Push it to publish it.` : `There's no branch called ${base}.`);
  const mergeBase = await git(top, ['merge-base', ref, 'HEAD']).catch(() => { throw new Error(`${branch} and ${base} share no history.`); });
  const { files, total } = await changedFiles(top, mergeBase, working ? null : 'HEAD');
  const incomingFiles = remote ? (await changedFiles(top, mergeBase, ref)).files : [];
  const commitsIn = async (range) => ((await quiet(git(top, ['log', '--format=%h%x00%s%x00%an%x00%ct', range, '-n', '200']))) || '')
    .split('\n').filter(Boolean).map((l) => { const [hash, subject, author, at] = l.split('\0'); return { hash, subject, author, when: Number(at) * 1000 }; });
  const commits = await commitsIn(`${ref}..HEAD`);
  const incoming = await commitsIn(`HEAD..${ref}`);
  const behind = incoming.length;
  let conflicts = null;
  const mt = await gitRaw(top, ['merge-tree', '--write-tree', '--name-only', '--no-messages', ref, 'HEAD']);
  if (mt.code === 0) conflicts = [];
  else if (mt.code === 1) conflicts = String(mt.out).split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  const sub = path.relative(path.resolve(top), path.resolve(cwd)).split(path.sep).join('/');
  return { sub, branch, base, ref: ref.replace(/^refs\/remotes\//, ''), mergeBase: mergeBase.slice(0, 8), files, total, incomingFiles, commits, incoming, behind, conflicts, working, remote: !!remote };
}

const PARK = 'pinpoint-park:';

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

async function parked(cwd) {
  const out = (await quiet(git(cwd, ['stash', 'list', '--format=%gd%x00%s']))) || '';
  return out.split('\n').filter(Boolean).flatMap((l) => {
    const [ref, subject = ''] = l.split('\0');
    const at = subject.indexOf(PARK);
    return at < 0 ? [] : [{ ref, branch: subject.slice(at + PARK.length).trim() }];
  });
}

// The same project folder inside another worktree (the project may live in a subfolder of the repository).
async function inTree(cwd, treePath) {
  const top = await git(cwd, ['rev-parse', '--show-toplevel']);
  return path.join(treePath, path.relative(path.resolve(top), path.resolve(cwd)));
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

let prCache = { at: 0, cwd: '', data: null };
async function pulls(cwd) {
  if (prCache.cwd === cwd && Date.now() - prCache.at < 60000) return prCache.data;
  const gh = await ghStatus();
  if (!gh.authed || !(await quiet(git(cwd, ['remote', 'get-url', 'origin'])))) return {};
  const out = await quiet(run('gh', ['pr', 'list', '--state', 'all', '--limit', '100', '--json', 'number,state,url,headRefName,isDraft,title'], cwd, { timeout: 20000 }));
  const data = {};
  for (const p of out ? JSON.parse(out) : []) {
    if (!data[p.headRefName]) data[p.headRefName] = { number: p.number, state: p.isDraft && p.state === 'OPEN' ? 'DRAFT' : p.state, url: p.url, title: p.title };
  }
  prCache = { at: Date.now(), cwd, data };
  return data;
}

async function fetchOrigin(cwd) {
  if (!(await quiet(git(cwd, ['remote', 'get-url', 'origin'])))) throw new Error('No "origin" remote to fetch from.');
  await git(cwd, ['fetch', '--prune', '--quiet', 'origin'], { timeout: 60000 });
  prCache.at = 0;
  return status(cwd);
}

// Fast-forward only, carrying uncommitted edits across: never makes a merge commit behind your back.
async function pull(cwd) {
  const st = await status(cwd);
  if (!st.upstream) throw new Error(`${st.branch} isn't tracking a branch on origin yet.`);
  await git(cwd, ['pull', '--ff-only', '--autostash', '--quiet'], { timeout: 120000 }).catch((e) => {
    throw new Error(/not possible to fast-forward|diverg/i.test(e.message)
      ? `${st.branch} and its copy on origin have both moved on. Open Changes to see both sides, then merge or rebase in the terminal.` : e.message);
  });
  return status(cwd);
}

async function push(cwd) {
  const st = await status(cwd);
  if (!st.remote) throw new Error('No "origin" remote to push to.');
  if (st.behind) throw new Error(`origin has ${st.behind} commit${st.behind > 1 ? 's' : ''} you don't have yet. Pull first.`);
  await git(cwd, ['push', '-u', 'origin', st.branch], { timeout: 120000 });
  prCache.at = 0;
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

const validName = (cwd, name) => git(cwd, ['check-ref-format', '--branch', name]).catch(() => { throw new Error(`"${name}" isn't a valid branch name.`); });

async function newBranch(cwd, name) {
  await validName(cwd, name);
  await git(cwd, ['switch', '-c', name]);
  return { branch: name };
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
  await git(cwd, ['worktree', 'add', ...(create ? ['-b', branch, dir, 'HEAD'] : [dir, branch])], { timeout: 120000 });
  const open = await inTree(cwd, dir);
  const project = path.resolve(cwd), mainProject = await inTree(cwd, main);
  // Make it ready to run: share the installed packages and bring the local env files and project memory along.
  for (const [from, to] of [[main, dir], [mainProject, open]]) {
    try {
      const nm = path.join(from, 'node_modules');
      if (fs.existsSync(nm) && !fs.existsSync(path.join(to, 'node_modules'))) fs.symlinkSync(nm, path.join(to, 'node_modules'), 'junction');
    } catch {  }
    try {
      for (const f of fs.readdirSync(from)) {
        if (/^\.env(\..+)?$/.test(f) && !fs.existsSync(path.join(to, f)) && fs.statSync(path.join(from, f)).isFile()) fs.copyFileSync(path.join(from, f), path.join(to, f));
      }
    } catch {  }
  }
  for (const f of ['memory.json', 'profiles.json']) {
    try {
      const src = path.join(project, '.pinpoint', f);
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(path.join(open, '.pinpoint'), { recursive: true });
      if (!fs.existsSync(path.join(open, '.pinpoint', '.gitignore'))) fs.writeFileSync(path.join(open, '.pinpoint', '.gitignore'), '*\n');
      fs.copyFileSync(src, path.join(open, '.pinpoint', f));
    } catch {  }
  }
  return { open, existed: false };
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
    } catch {  }
  };
  unlink(tree.path, 0);
  await git(cwd, ['worktree', 'remove', '--force', tree.path]);
  await quiet(git(cwd, ['worktree', 'prune']));
  return { branch: tree.branch };
}
const SHOT_REF = 'refs/pinpoint/shots';

function repoSlug(remote) {
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remote || '');
  return m ? `${m[1]}/${m[2]}` : null;
}

async function pushShots(cwd, remote, branch, shots) {
  const slug = repoSlug(remote);
  if (!slug) return null;
  const env = { GIT_INDEX_FILE: path.join(os.tmpdir(), `pinpoint-index-${Date.now()}`) };
  try {
    await quiet(git(cwd, ['fetch', '--quiet', 'origin', `+refs/heads/${SHOT_BRANCH}:${SHOT_REF}`], { timeout: 60000 }));
    const parent = await quiet(git(cwd, ['rev-parse', '--verify', '--quiet', SHOT_REF]));
    if (parent) await git(cwd, ['read-tree', parent], { env });
    const dir = `${slugify(branch.replace(/^pinpoint\//, ''))}-${Date.now().toString(36)}`;
    const placed = [];
    for (const s of shots) {
      const names = {};
      for (const side of ['before', 'after']) {
        const blob = await git(cwd, ['hash-object', '-w', s[side]]);
        names[side] = `${dir}/${s.id}-${side}${path.extname(s[side]) || '.jpg'}`;
        await git(cwd, ['update-index', '--add', '--cacheinfo', `100644,${blob},${names[side]}`], { env });
      }
      placed.push({ label: s.label, ...names });
    }
    const tree = await git(cwd, ['write-tree'], { env });
    const commit = await git(cwd, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `Screenshots for ${branch}`]);
    await git(cwd, ['push', '--quiet', 'origin', `${commit}:refs/heads/${SHOT_BRANCH}`], { timeout: 120000 });
    const link = (name) => `https://github.com/${slug}/blob/${commit}/${name}?raw=true`;
    return placed.map((p) => ({ label: p.label, before: link(p.before), after: link(p.after) }));
  } finally { fs.rmSync(env.GIT_INDEX_FILE, { force: true }); }
}

function withShots(body, pictures) {
  const rows = pictures.map((p) => `${p.label ? `**${p.label.replace(/\|/g, '/')}**\n\n` : ''}| Before | After |\n|---|---|\n| ![Before](${p.before}) | ![After](${p.after}) |`);
  const section = ['## Before and after', '', rows.join('\n\n'), ''].join('\n');
  const cut = body.lastIndexOf('\n---\n');
  return cut >= 0 ? `${body.slice(0, cut)}\n\n${section}${body.slice(cut)}` : `${body}\n\n${section}`;
}

async function openPR(cwd,{ title, body, draft, shots, base }) {
  const st = await status(cwd);
  if (!st.repo) throw new Error('This project is not a git repository.');
  if (!st.remote) throw new Error('No "origin" remote. Add one (for example with `gh repo create`) first.');
  if (!st.gh.installed) throw new Error('The GitHub CLI (gh) is not installed.');
  if (!st.gh.authed) throw new Error('Sign in to GitHub first: run `gh auth login`.');
  const into = base || st.defaultBranch;
  if (st.branch === into) throw new Error(`You're on ${st.branch}. Switch to another branch before opening a PR into it.`);
  await git(cwd, ['push', '-u', 'origin', st.branch], { timeout: 120000 });
  const existing = await quiet(run('gh', ['pr', 'view', st.branch, '--json', 'url', '--jq', '.url'], cwd));
  prCache.at = 0;
  if (existing) return { url: existing, existed: true };
  const pictures = shots?.length ? await quiet(pushShots(cwd, st.remote, st.branch, shots)) : null;
  const file = path.join(os.tmpdir(), `pinpoint-pr-${Date.now()}.md`);
  fs.writeFileSync(file, pictures ? withShots(body, pictures) : body);
  try {
    const out = await run('gh', ['pr', 'create', '--title', title, '--body-file', file, '--head', st.branch, '--base', into, ...(draft ? ['--draft'] : [])], cwd, { timeout: 120000 });
    const url = (out.match(/https:\/\/\S+/) || [out])[0];
    return { url, existed: false, shots: pictures ? pictures.length : 0 };
  } finally { fs.rmSync(file, { force: true }); }
}

async function createIssue(cwd, { title, body, attach }) {
  const gh = await ghStatus();
  if (!gh.installed) throw new Error('The GitHub CLI (gh) is not installed.');
  if (!gh.authed) throw new Error('Sign in to GitHub first: run `gh auth login`.');
  let gist = null;
  if (attach) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-handoff-'));
    const file = path.join(dir, `${attach.name.replace(/[^\w -]+/g, '').trim() || 'request'}.pinpoint.json`);
    fs.writeFileSync(file, JSON.stringify(attach.data));
    try {
      const out = await run('gh', ['gist', 'create', file, '--desc', `Pinpoint hand-off: ${title}`], cwd, { timeout: 120000 });
      gist = (out.match(/https:\/\/gist\.github\.com\/\S+/) || [])[0] || null;
    } catch {  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  const full = gist
    ? `${body}\n\n**Hand-off file with screenshots:** ${gist}\nDownload it and open it in Pinpoint (share menu → Open hand-off file).`
    : body;
  const file = path.join(os.tmpdir(), `pinpoint-issue-${Date.now()}.md`);
  fs.writeFileSync(file, full);
  try {
    const out = await run('gh', ['issue', 'create', '--title', title, '--body-file', file], cwd, { timeout: 60000 });
    return { url: (out.match(/https:\/\/\S+/) || [out])[0], gist };
  } finally { fs.rmSync(file, { force: true }); }
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

module.exports = { status, compare, fetchOrigin, pull, push, branches, pulls, switchBranch, newBranch, addWorktree, removeWorktree, findTree, createBranch, commitPaths, commitAll, initRepo, openPR, commitMessage, createIssue, repoSlug, withShots, pushShots };
