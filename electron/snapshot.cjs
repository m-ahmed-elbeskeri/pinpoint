const fs = require('node:fs');
const path = require('node:path');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.pinpoint', '.next', '.nuxt', '.svelte-kit', '.astro', '.turbo',
  '.vercel', '.cache', '.parcel-cache', 'dist', 'build', 'out', 'coverage', '.output', 'target', '__pycache__', '.venv', 'venv',
]);
const MAX_FILES = 40000;
const MAX_CONTENT_FILE = 1024 * 1024;
const MAX_CONTENT_TOTAL = 150 * 1024 * 1024;

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

async function walkAsync(root) {
  const out = [];
  const stack = [''];
  while (stack.length && out.length < MAX_FILES) {
    const rel = stack.pop();
    let entries;
    try { entries = await fs.promises.readdir(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
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
    } catch {  }
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
      if (before.content && st.size === before.size) {
        try { if (fs.readFileSync(path.join(snap.root, rel)).equals(before.content)) continue; } catch {  }
      }
      changes.push({ path: rel, kind: 'modify' });
    }
  }
  for (const rel of snap.files.keys()) if (!now.has(rel)) changes.push({ path: rel, kind: 'delete' });
  return changes;
}

const BATCH = 64;
async function takeAsync(root) {
  const files = new Map();
  let budget = MAX_CONTENT_TOTAL;
  const all = await walkAsync(root);
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const stats = await Promise.all(batch.map((rel) => fs.promises.stat(path.join(root, rel)).catch(() => null)));
    const wanted = stats.map((st) => { const yes = !!st && st.size <= MAX_CONTENT_FILE && budget - st.size > 0; if (yes) budget -= st.size; return yes; });
    const contents = await Promise.all(batch.map((rel, j) => (wanted[j] ? fs.promises.readFile(path.join(root, rel)).catch(() => undefined) : null)));
    batch.forEach((rel, j) => {
      const st = stats[j];
      if (!st || contents[j] === undefined) return;
      files.set(rel, { mtime: st.mtimeMs, size: st.size, content: contents[j] });
    });
  }
  return { root, files };
}

async function diffAsync(snap) {
  const changes = [];
  const all = await walkAsync(snap.root);
  const now = new Set(all);
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const stats = await Promise.all(batch.map((rel) => fs.promises.stat(path.join(snap.root, rel)).catch(() => null)));
    for (let j = 0; j < batch.length; j++) {
      const rel = batch[j], st = stats[j], before = snap.files.get(rel);
      if (!st) continue;
      if (!before) changes.push({ path: rel, kind: 'add' });
      else if (st.mtimeMs !== before.mtime || st.size !== before.size) {
        if (before.content && st.size === before.size) {
          try { if ((await fs.promises.readFile(path.join(snap.root, rel))).equals(before.content)) continue; } catch {  }
        }
        changes.push({ path: rel, kind: 'modify' });
      }
    }
  }
  for (const rel of snap.files.keys()) if (!now.has(rel)) changes.push({ path: rel, kind: 'delete' });
  return changes;
}

module.exports = { take, diff, takeAsync, diffAsync, walk, walkAsync };
