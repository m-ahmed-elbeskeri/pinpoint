// Agent-agnostic change tracking. Before a run we record every project file's
// mtime/size (and the contents of reasonably small files); afterwards we diff.
// This catches edits made through any tool (Edit, sed, scripts…); runs.cjs
// persists the before/after of changed files for diffs and undo.
const fs = require('node:fs');
const path = require('node:path');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.pinpoint', '.next', '.nuxt', '.svelte-kit', '.astro', '.turbo',
  '.vercel', '.cache', '.parcel-cache', 'dist', 'build', 'out', 'coverage', '.output', 'target', '__pycache__', '.venv', 'venv',
]);
const MAX_FILES = 40000;
const MAX_CONTENT_FILE = 1024 * 1024;       // keep contents of files up to 1 MB
const MAX_CONTENT_TOTAL = 150 * 1024 * 1024; // …up to 150 MB in total

function walk(root) {
  const out = [];
  const stack = [''];
  while (stack.length && out.length < MAX_FILES) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(r); }
      else if (e.isFile()) out.push(r);
    }
  }
  return out;
}

function take(root) {
  const files = new Map();
  let budget = MAX_CONTENT_TOTAL;
  for (const rel of walk(root)) {
    try {
      const st = fs.statSync(path.join(root, rel));
      const entry = { mtime: st.mtimeMs, size: st.size, content: null };
      if (st.size <= MAX_CONTENT_FILE && budget - st.size > 0) {
        entry.content = fs.readFileSync(path.join(root, rel));
        budget -= st.size;
      }
      files.set(rel, entry);
    } catch { /* vanished */ }
  }
  return { root, files };
}

function diff(snap) {
  const changes = [];
  const now = new Set(walk(snap.root));
  for (const rel of now) {
    const before = snap.files.get(rel);
    let st;
    try { st = fs.statSync(path.join(snap.root, rel)); } catch { continue; }
    if (!before) changes.push({ path: rel, kind: 'add' });
    else if (st.mtimeMs !== before.mtime || st.size !== before.size) {
      // mtime can change without content changing (e.g. a rewrite of identical text).
      if (before.content && st.size === before.size) {
        try { if (fs.readFileSync(path.join(snap.root, rel)).equals(before.content)) continue; } catch { /* treat as changed */ }
      }
      changes.push({ path: rel, kind: 'modify' });
    }
  }
  for (const rel of snap.files.keys()) if (!now.has(rel)) changes.push({ path: rel, kind: 'delete' });
  return changes;
}

module.exports = { take, diff };
