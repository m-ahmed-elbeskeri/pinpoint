// Git workflow for Pinpoint: branch per chat, commit after each run, open a PR.
// Uses the user's own `git` and `gh` CLIs.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function run(cmd, args, cwd, { timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
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

let ghState = null; // cached: { installed, authed, user }
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
  return {
    repo: true, root, branch, defaultBranch, remote, hasCommits,
    dirty: porcelain ? porcelain.split('\n').length : 0,
    ahead, behind, upstream: !!counts,
    gh: await ghStatus(),
  };
}

function slugify(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'visual-edit';
}

async function createBranch(cwd, hint) {
  const name = `pinpoint/${slugify(hint)}-${Math.random().toString(36).slice(2, 6)}`;
  await quiet(git(cwd, ['switch', '-c', name])) ?? (await git(cwd, ['checkout', '-b', name]));
  return name;
}

// Commit exactly the files a run changed (never the user's other work).
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

// Push the current branch and open (or find) its pull request.
async function openPR(cwd, { title, body, draft }) {
  const st = await status(cwd);
  if (!st.repo) throw new Error('This project is not a git repository.');
  if (!st.remote) throw new Error('No "origin" remote. Add one (for example with `gh repo create`) first.');
  if (!st.gh.installed) throw new Error('The GitHub CLI (gh) is not installed.');
  if (!st.gh.authed) throw new Error('Sign in to GitHub first: run `gh auth login`.');
  if (st.branch === st.defaultBranch) throw new Error(`You're on ${st.branch}. Turn on "Branch per chat" or create a branch before opening a PR.`);
  await git(cwd, ['push', '-u', 'origin', st.branch], { timeout: 120000 });
  const existing = await quiet(run('gh', ['pr', 'view', st.branch, '--json', 'url', '--jq', '.url'], cwd));
  if (existing) return { url: existing, existed: true };
  const file = path.join(os.tmpdir(), `pinpoint-pr-${Date.now()}.md`);
  fs.writeFileSync(file, body);
  try {
    const out = await run('gh', ['pr', 'create', '--title', title, '--body-file', file, '--head', st.branch, '--base', st.defaultBranch, ...(draft ? ['--draft'] : [])], cwd, { timeout: 120000 });
    const url = (out.match(/https:\/\/\S+/) || [out])[0];
    return { url, existed: false };
  } finally { fs.rmSync(file, { force: true }); }
}

// Opens a GitHub issue from a hand-off (a request someone annotated for a developer to run).
// With `attach`, the hand-off file (screenshots included) goes up as a secret
// gist linked from the issue: issues can't carry files through the CLI.
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
    } catch { /* the issue still goes out, without the file */ } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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

// Commit message for a run, built from what the user asked for.
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

module.exports = { status, createBranch, commitPaths, commitAll, initRepo, openPR, commitMessage, createIssue };
