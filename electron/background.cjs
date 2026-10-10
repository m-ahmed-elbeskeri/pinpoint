const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function git(cwd, args, { input, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd, timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).trim().split('\n').filter(Boolean).slice(-2).join(' ')));
      resolve(String(stdout));
    });
    if (input != null) { child.stdin.end(input); }
  });
}

function gitBuffer(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

const homeFor = (base, root) => path.join(base, 'worktrees', crypto.createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 10));

async function blocker(root) {
  try { await git(root, ['rev-parse', '--show-toplevel']); } catch { return 'Background runs need a git repository (they work in a separate copy made with git).'; }
  try { await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']); } catch { return 'Background runs need at least one commit to copy from.'; }
  return null;
}

async function create(base, root, id) {
  const why = await blocker(root);
  if (why) throw new Error(why);
  const top = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
  const sub = path.relative(top, path.resolve(root));
  const dir = path.join(homeFor(base, root), id.replace(/[^\w-]/g, ''));
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await git(top, ['worktree', 'add', '--detach', dir, 'HEAD']);
  const patch = await git(top, ['diff', 'HEAD', '--binary']);
  if (patch.trim()) await git(dir, ['apply', '--whitespace=nowarn', '-'], { input: patch });
  const untracked = (await git(top, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  for (const rel of untracked) {
    try {
      const from = path.join(top, rel);
      if (fs.statSync(from).size > 5 * 1024 * 1024) continue;
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.copyFileSync(from, path.join(dir, rel));
    } catch {  }
  }
  for (const rel of ['node_modules', path.join(sub, 'node_modules')]) {
    const from = path.join(top, rel), to = path.join(dir, rel);
    try { if (fs.existsSync(from) && !fs.existsSync(to)) fs.symlinkSync(from, to, 'junction'); } catch {  }
  }
  await git(dir, ['add', '-A', '--', '.', ':(exclude)node_modules', `:(exclude)${path.posix.join(sub.split(path.sep).join('/') || '.', 'node_modules')}`]).catch(() => git(dir, ['add', '-A']));
  const tree = (await git(dir, ['write-tree'])).trim();
  return { dir, cwd: path.join(dir, sub), tree, top, sub };
}

async function result(run) {
  await git(run.dir, ['add', '-A', '--', '.', ':(exclude)node_modules']).catch(() => git(run.dir, ['add', '-A']));
  const names = (await git(run.dir, ['diff', '--cached', '--name-status', run.tree])).trim().split('\n').filter(Boolean);
  const files = names.map((l) => { const [s, ...p] = l.split('\t'); return { path: p[p.length - 1], kind: s.startsWith('A') ? 'add' : s.startsWith('D') ? 'delete' : 'modify' }; })
    .filter((f) => !/(^|\/)node_modules(\/|$)/.test(f.path));
  const patch = files.length ? await git(run.dir, ['diff', '--cached', '--binary', run.tree, '--', ...files.map((f) => f.path)]) : '';
  return { files, patch };
}

function mergeText(ours, base, theirs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-merge-'));
  const f = (name, text) => { const p = path.join(dir, name); fs.writeFileSync(p, text); return p; };
  return new Promise((resolve) => {
    execFile('git', ['merge-file', '-p', f('ours', ours), f('base', base), f('theirs', theirs)], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ text: String(stdout), conflict: !!err });
    });
  });
}

const readMaybe = (file) => { try { return fs.readFileSync(file); } catch { return null; } };
const lf = (buf) => buf.toString('utf8').replace(/\r\n/g, '\n');
const isBinary = (buf) => !!buf && buf.subarray(0, 8000).includes(0);

async function apply(run, files) {
  const plan = [];
  const clashes = [];
  for (const f of files) {
    const mine = path.join(run.top, f.path);
    const ours = readMaybe(mine);
    const theirs = f.kind === 'delete' ? null : readMaybe(path.join(run.dir, f.path));
    const base = f.kind === 'add' ? null : await gitBuffer(run.dir, ['show', `${run.tree}:${f.path}`]).catch(() => null);
    const binary = isBinary(ours) || isBinary(theirs) || isBinary(base);
    const same = (x, y) => (binary ? x.equals(y) : lf(x) === lf(y));
    const crlf = !!ours && ours.toString('utf8').includes('\r\n');
    const out = (text) => Buffer.from(crlf ? text.replace(/\n/g, '\r\n') : text);

    if (f.kind === 'delete') {
      if (ours && base && !same(ours, base)) clashes.push(f.path); else plan.push({ mine, remove: true });
    } else if (!theirs) {
      continue;
    } else if (!base) {
      if (ours && !same(ours, theirs)) clashes.push(f.path); else plan.push({ mine, content: binary ? theirs : out(lf(theirs)) });
    } else if (!ours) {
      clashes.push(f.path);
    } else if (same(ours, base)) {
      plan.push({ mine, content: binary ? theirs : out(lf(theirs)) });
    } else if (binary) {
      clashes.push(f.path);
    } else {
      const merged = await mergeText(lf(ours), lf(base), lf(theirs));
      if (merged.conflict) clashes.push(f.path); else plan.push({ mine, content: out(merged.text) });
    }
  }
  if (clashes.length) throw new Error(`These changes no longer fit: ${clashes.join(', ')} ${clashes.length > 1 ? 'were' : 'was'} edited in the same place since the run started. Nothing was applied.`);
  for (const p of plan) {
    if (p.remove) fs.rmSync(p.mine, { force: true });
    else { fs.mkdirSync(path.dirname(p.mine), { recursive: true }); fs.writeFileSync(p.mine, p.content); }
  }
}

async function remove(run) {
  for (const rel of ['node_modules', path.join(run.sub || '', 'node_modules')]) {
    try { const p = path.join(run.dir, rel); if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p); } catch {  }
  }
  await git(run.top, ['worktree', 'remove', '--force', run.dir]).catch(() => {});
  await git(run.top, ['worktree', 'prune']).catch(() => {});
}

function preview(run, command, port) {
  return new Promise((resolve) => {
    const full = /^(npm|pnpm|yarn|bun)\s+(run\s+)?[\w:-]+$/.test(command.trim()) ? `${command} -- --port ${port}` : `${command} --port ${port}`;
    const proc = spawn(full, { cwd: run.cwd, shell: true, detached: process.platform !== 'win32', env: { ...process.env, PORT: String(port), BROWSER: 'none', FORCE_COLOR: '0', NO_COLOR: '1' } });
    let done = false;
    const finish = (url) => { if (!done) { done = true; resolve({ url, proc }); } };
    const onData = (d) => {
      const m = d.toString().replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '').match(/https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?/);
      if (m) finish(m[0].replace('0.0.0.0', 'localhost'));
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', () => finish(null));
    proc.on('error', () => finish(null));
    setTimeout(() => finish(null), 60000);
  });
}

module.exports = { blocker, create, result, apply, remove, preview, git };
