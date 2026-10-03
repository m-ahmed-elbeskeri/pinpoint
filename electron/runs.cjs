// Persistent run records under <project>/.pinpoint/runs/<runId>/.
// For every file a run changed we keep the before/after bytes, which powers the
// diff viewer and lets Undo (all or per file) work even after a restart.
const fs = require('node:fs');
const path = require('node:path');
const { structuredPatch } = require('diff');

function lineStats(before, after) {
  if (!before && !after) return {};
  const a = before ? before.toString('utf8') : '';
  const b = after ? after.toString('utf8') : '';
  let add = 0, del = 0;
  for (const h of structuredPatch('a', 'b', a, b, '', '', { context: 0 }).hunks) {
    for (const l of h.lines) { if (l[0] === '+') add++; else if (l[0] === '-') del++; }
  }
  return { add, del };
}

const KEEP_RUNS = 60;
const MAX_DIFF_BYTES = 1024 * 1024;

const runsDir = (root) => path.join(root, '.pinpoint', 'runs');
const runDir = (root, runId) => path.join(runsDir(root), runId.replace(/[^\w-]/g, ''));

const isBinary = (buf) => !!buf && buf.subarray(0, 8000).includes(0);

function readMaybe(file) {
  try { return fs.readFileSync(file); } catch { return null; }
}

function save(root, runId, snap, changes, meta = {}) {
  const dir = runDir(root, runId);
  fs.mkdirSync(dir, { recursive: true });
  const entries = changes.map((c, i) => {
    const before = snap.files.get(c.path)?.content || null;
    let after = null;
    if (c.kind !== 'delete') {
      try {
        const abs = path.join(root, c.path);
        if (fs.statSync(abs).size <= MAX_DIFF_BYTES) after = fs.readFileSync(abs);
      } catch { /* vanished */ }
    }
    if (before) fs.writeFileSync(path.join(dir, `${i}.before`), before);
    if (after) fs.writeFileSync(path.join(dir, `${i}.after`), after);
    const binary = isBinary(before) || isBinary(after);
    const complete = (c.kind === 'add' || before) && (c.kind === 'delete' || after);
    return {
      i, path: c.path, kind: c.kind,
      hasBefore: !!before, hasAfter: !!after,
      binary,
      ...(binary || !complete ? {} : lineStats(before, after)),
      reverted: false,
    };
  });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ runId, createdAt: Date.now(), ...meta, changes: entries }, null, 2));
  prune(root);
  return entries.map(({ path: p, kind, add, del }) => ({ path: p, kind, add, del }));
}

function prune(root) {
  try {
    const dirs = fs.readdirSync(runsDir(root))
      .map((d) => ({ d, t: fs.statSync(path.join(runsDir(root), d)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { d } of dirs.slice(KEEP_RUNS)) fs.rmSync(path.join(runsDir(root), d), { recursive: true, force: true });
  } catch { /* nothing to prune */ }
}

function load(root, runId) {
  const raw = readMaybe(path.join(runDir(root, runId), 'run.json'));
  if (!raw) throw new Error('This run is no longer available (older runs are pruned).');
  return JSON.parse(raw.toString('utf8'));
}

// Text of each changed file before/after the run, for the diff viewer.
function diff(root, runId) {
  const run = load(root, runId);
  const dir = runDir(root, runId);
  return run.changes.map((c) => {
    const before = c.hasBefore ? readMaybe(path.join(dir, `${c.i}.before`)) : null;
    const after = c.hasAfter ? readMaybe(path.join(dir, `${c.i}.after`)) : null;
    const tooLarge = (c.kind !== 'add' && !c.hasBefore) || (c.kind !== 'delete' && !c.hasAfter);
    return {
      path: c.path, kind: c.kind, reverted: c.reverted, binary: c.binary, tooLarge,
      before: c.binary || !before ? (c.kind === 'add' ? '' : null) : before.toString('utf8'),
      after: c.binary || !after ? (c.kind === 'delete' ? '' : null) : after.toString('utf8'),
    };
  });
}

// Restores files to their pre-run state. Files edited since the run (by you or
// a later run) are reported as conflicts and left alone unless `force`.
function revert(root, runId, paths, force) {
  const run = load(root, runId);
  const dir = runDir(root, runId);
  const result = { restored: [], conflicts: [], failed: [] };
  for (const c of run.changes) {
    if (c.reverted || (paths && !paths.includes(c.path))) continue;
    const abs = path.join(root, c.path);
    const current = readMaybe(abs);
    if (!force) {
      const expected = c.hasAfter ? readMaybe(path.join(dir, `${c.i}.after`)) : null;
      const same = c.kind === 'delete' ? current === null : !c.hasAfter || (current && expected && current.equals(expected));
      if (!same) { result.conflicts.push(c.path); continue; }
    }
    try {
      if (c.kind === 'add') fs.rmSync(abs, { force: true });
      else if (c.hasBefore) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, fs.readFileSync(path.join(dir, `${c.i}.before`)));
      } else { result.failed.push(c.path); continue; }
      c.reverted = true;
      result.restored.push(c.path);
    } catch { result.failed.push(c.path); }
  }
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run, null, 2));
  result.allReverted = run.changes.every((c) => c.reverted);
  return result;
}

// Puts a reverted run's changes back (used when picking one of several variants).
function apply(root, runId) {
  const run = load(root, runId);
  const dir = runDir(root, runId);
  const result = { restored: [], conflicts: [], failed: [] };
  for (const c of run.changes) {
    const abs = path.join(root, c.path);
    try {
      if (c.kind === 'delete') fs.rmSync(abs, { force: true });
      else if (c.hasAfter) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, fs.readFileSync(path.join(dir, `${c.i}.after`)));
      } else { result.failed.push(c.path); continue; }
      c.reverted = false;
      result.restored.push(c.path);
    } catch { result.failed.push(c.path); }
  }
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run, null, 2));
  result.allReverted = false;
  return result;
}

function readMeta(root, runId) { return load(root, runId); }

function setMeta(root, runId, patch) {
  const run = load(root, runId);
  fs.writeFileSync(path.join(runDir(root, runId), 'run.json'), JSON.stringify({ ...run, ...patch }, null, 2));
}

// Before/after screenshots live next to the run record.
function saveShot(root, runId, name, dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  saveShotBuffer(root, runId, name, Buffer.from(b64, 'base64'), /jpeg/.test(meta) ? 'jpg' : 'png');
}

function saveShotBuffer(root, runId, name, buf, ext = 'jpg') {
  const dir = runDir(root, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `shot-${name.replace(/[^\w-]/g, '')}.${ext}`), buf);
}

function shots(root, runId) {
  const dir = runDir(root, runId);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^shot-/.test(f)); } catch { return {}; }
  const out = {};
  for (const f of files) {
    const name = f.replace(/^shot-/, '').replace(/\.\w+$/, '');
    const mime = f.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
    out[name] = `data:${mime};base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}`;
  }
  return out;
}

module.exports = { save, diff, revert, apply, readMeta, setMeta, saveShot, saveShotBuffer, shots };
