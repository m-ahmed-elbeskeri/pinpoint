const { execFile } = require('node:child_process');
const path = require('node:path');

const TIMEOUT_MS = 60000;
const SLOW_TIMEOUT_MS = 120000;

function run(cmd, args, cwd, { timeout = TIMEOUT_MS, env } = {}) {
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

// git that hands back stdout even when the exit code is non-zero (merge-tree exits 1 on conflicts).
function gitRaw(cwd, args, encoding = 'utf8') {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, encoding, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out: stdout }));
  });
}

const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

function slugify(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'visual-edit';
}

const validName = (cwd, name) => git(cwd, ['check-ref-format', '--branch', name]).catch(() => { throw new Error(`"${name}" isn't a valid branch name.`); });

module.exports = { TIMEOUT_MS, SLOW_TIMEOUT_MS, run, git, quiet, gitRaw, samePath, slugify, validName };
