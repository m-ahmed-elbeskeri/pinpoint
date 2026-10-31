const fs = require('node:fs');
const path = require('node:path');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.pinpoint', '.next', '.nuxt', '.svelte-kit', '.astro', '.turbo',
  '.vercel', '.cache', '.parcel-cache', 'dist', 'build', 'out', 'coverage', '.output', 'target', '__pycache__', '.venv', 'venv',
]);
const MAX_FILES = 40000;
const MAX_CONTENT_FILE = 1024 * 1024;
const MAX_CONTENT_TOTAL = 150 * 1024 * 1024;
const BATCH = 64;

async function walk(root) {
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

// A file can vanish mid-walk; anything else stopping us reading it goes to the log.
const unread = (rel, err) => { if (err.code !== 'ENOENT') console.warn(`snapshot: ${rel}: ${err.message}`); };
const statOf = (root, rel) => fs.promises.stat(path.join(root, rel)).catch((err) => { unread(rel, err); return null; });

async function takeAsync(root) {
  const files = new Map();
  let budget = MAX_CONTENT_TOTAL;
  const all = await walk(root);
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const stats = await Promise.all(batch.map((rel) => statOf(root, rel)));
    const wanted = stats.map((st) => { const yes = !!st && st.size <= MAX_CONTENT_FILE && budget - st.size > 0; if (yes) budget -= st.size; return yes; });
    const contents = await Promise.all(batch.map((rel, j) => (wanted[j] ? fs.promises.readFile(path.join(root, rel)).catch((err) => { unread(rel, err); return undefined; }) : null)));
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
  const all = await walk(snap.root);
  const now = new Set(all);
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const stats = await Promise.all(batch.map((rel) => statOf(snap.root, rel)));
    for (let j = 0; j < batch.length; j++) {
      const rel = batch[j], st = stats[j], before = snap.files.get(rel);
      if (!st) continue;
      if (!before) changes.push({ path: rel, kind: 'add' });
      else if (st.mtimeMs !== before.mtime || st.size !== before.size) {
        if (before.content && st.size === before.size) {
          try { if ((await fs.promises.readFile(path.join(snap.root, rel))).equals(before.content)) continue; } catch { /* treat as changed */ }
        }
        changes.push({ path: rel, kind: 'modify' });
      }
    }
  }
  for (const rel of snap.files.keys()) if (!now.has(rel)) changes.push({ path: rel, kind: 'delete' });
  return changes;
}

module.exports = { takeAsync, diffAsync, walk };
