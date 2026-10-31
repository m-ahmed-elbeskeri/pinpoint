const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TIMEOUT_MS, SLOW_TIMEOUT_MS, run, git, quiet, slugify } = require('./exec.cjs');
const { ghStatus, status } = require('./status.cjs');

const PULLS_CACHE_MS = 60000;
const SHOT_BRANCH = 'pinpoint-shots';
const SHOT_REF = 'refs/pinpoint/shots';

let prCache = { at: 0, cwd: '', data: null };
async function pulls(cwd) {
  if (prCache.cwd === cwd && Date.now() - prCache.at < PULLS_CACHE_MS) return prCache.data;
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

const forgetPulls = () => { prCache.at = 0; };

function repoSlug(remote) {
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remote || '');
  return m ? `${m[1]}/${m[2]}` : null;
}

async function pushShots(cwd, remote, branch, shots) {
  const slug = repoSlug(remote);
  if (!slug) return null;
  const env = { GIT_INDEX_FILE: path.join(os.tmpdir(), `pinpoint-index-${Date.now()}`) };
  try {
    await quiet(git(cwd, ['fetch', '--quiet', 'origin', `+refs/heads/${SHOT_BRANCH}:${SHOT_REF}`], { timeout: TIMEOUT_MS }));
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
    await git(cwd, ['push', '--quiet', 'origin', `${commit}:refs/heads/${SHOT_BRANCH}`], { timeout: SLOW_TIMEOUT_MS });
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
  await git(cwd, ['push', '-u', 'origin', st.branch], { timeout: SLOW_TIMEOUT_MS });
  const existing = await quiet(run('gh', ['pr', 'view', st.branch, '--json', 'url', '--jq', '.url'], cwd));
  forgetPulls();
  if (existing) return { url: existing, existed: true };
  const pictures = shots?.length ? await quiet(pushShots(cwd, st.remote, st.branch, shots)) : null;
  const file = path.join(os.tmpdir(), `pinpoint-pr-${Date.now()}.md`);
  fs.writeFileSync(file, pictures ? withShots(body, pictures) : body);
  try {
    const out = await run('gh', ['pr', 'create', '--title', title, '--body-file', file, '--head', st.branch, '--base', into, ...(draft ? ['--draft'] : [])], cwd, { timeout: SLOW_TIMEOUT_MS });
    const url = (out.match(/https:\/\/\S+/) || [out])[0];
    return { url, existed: false, shots: pictures ? pictures.length : 0 };
  } finally { fs.rmSync(file, { force: true }); }
}

async function createIssue(cwd, { title, body, attach }) {
  const gh = await ghStatus();
  if (!gh.installed) throw new Error('The GitHub CLI (gh) is not installed.');
  if (!gh.authed) throw new Error('Sign in to GitHub first: run `gh auth login`.');
  let gist = null, gistError = null;
  if (attach) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-handoff-'));
    const file = path.join(dir, `${attach.name.replace(/[^\w -]+/g, '').trim() || 'request'}.pinpoint.json`);
    fs.writeFileSync(file, JSON.stringify(attach.data));
    try {
      const out = await run('gh', ['gist', 'create', file, '--desc', `Pinpoint hand-off: ${title}`], cwd, { timeout: SLOW_TIMEOUT_MS });
      gist = (out.match(/https:\/\/gist\.github\.com\/\S+/) || [])[0] || null;
    } catch (err) {
      gistError = err.message; // the issue still goes out, without the file
      console.warn(`hand-off gist failed: ${err.message}`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  const full = gist
    ? `${body}\n\n**Hand-off file with screenshots:** ${gist}\nDownload it and open it in Pinpoint (share menu → Open hand-off file).`
    : body;
  const file = path.join(os.tmpdir(), `pinpoint-issue-${Date.now()}.md`);
  fs.writeFileSync(file, full);
  try {
    const out = await run('gh', ['issue', 'create', '--title', title, '--body-file', file], cwd, { timeout: TIMEOUT_MS });
    return { url: (out.match(/https:\/\/\S+/) || [out])[0], gist, gistError };
  } finally { fs.rmSync(file, { force: true }); }
}

module.exports = { SHOT_BRANCH, pulls, forgetPulls, repoSlug, pushShots, withShots, openPR, createIssue };
