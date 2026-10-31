const fs = require('node:fs');
const path = require('node:path');
const { isBinary } = require('../fsutil.cjs');
const { git, quiet, gitRaw } = require('./exec.cjs');

const MAX_TEXT = 512 * 1024;
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
    const binary = isBinary(before) || isBinary(after);
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

module.exports = { compare };
