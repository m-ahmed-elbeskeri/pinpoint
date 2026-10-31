const fs = require('node:fs');
const path = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isBinary = (buf) => !!buf && buf.subarray(0, 8000).includes(0);
const readMaybe = (file) => { try { return fs.readFileSync(file); } catch { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const readJson = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const readPkg = (root) => readJson(path.join(root, 'package.json'), {});

// The detected design system is optional context: a project it can't be read from just goes without.
function inspectSafe(root) {
  try { return require('./project/designsystem.cjs').inspect(root); } catch { return null; }
}

// Makes a fresh worktree folder ready to run: shares `from`'s installed packages and, with `env`, copies its local
// env files. Returns what went wrong; a folder that doesn't exist on this branch isn't a failure.
function prepareWorktree(from, to, { env = false } = {}) {
  const warnings = [];
  const note = (what, err) => { if (err.code !== 'ENOENT') warnings.push(`${what}: ${err.message}`); };
  try {
    const modules = path.join(from, 'node_modules'), link = path.join(to, 'node_modules');
    if (fs.existsSync(modules) && !fs.existsSync(link)) fs.symlinkSync(modules, link, 'junction');
  } catch (err) { note('node_modules', err); }
  if (env) {
    try {
      for (const f of fs.readdirSync(from)) {
        if (/^\.env(\..+)?$/.test(f) && !fs.existsSync(path.join(to, f)) && fs.statSync(path.join(from, f)).isFile()) fs.copyFileSync(path.join(from, f), path.join(to, f));
      }
    } catch (err) { note('env files', err); }
  }
  return warnings;
}

module.exports = { sleep, isBinary, readMaybe, isDir, readJson, readPkg, inspectSafe, prepareWorktree };
