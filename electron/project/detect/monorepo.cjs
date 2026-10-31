// Finds the projects of a monorepo, and how its tool runs one of them.
const fs = require('node:fs');
const path = require('node:path');

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const exists = (...p) => fs.existsSync(path.join(...p));
const SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'coverage']);
const MAX_PROJECTS = 200;
const MAX_DEPTH = 4;

function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)).map((e) => e.name);
  } catch { return []; } // not there, or not readable: no projects in it
}

// Expands workspace patterns: `apps/*`, `packages/**`, `tools/cli`. `!` patterns exclude.
function expandGlobs(root, patterns) {
  const out = new Set();
  const walk = (dir, parts) => {
    if (out.size >= MAX_PROJECTS) return;
    if (!parts.length) { out.add(dir); return; }
    const [head, ...rest] = parts;
    if (head === '**') {
      walk(dir, rest);
      if (path.relative(root, dir).split(path.sep).length < MAX_DEPTH) for (const d of subdirs(dir)) walk(path.join(dir, d), parts);
    } else if (head.includes('*')) {
      const re = new RegExp(`^${head.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      for (const d of subdirs(dir)) if (re.test(d)) walk(path.join(dir, d), rest);
    } else if (exists(dir, head)) walk(path.join(dir, head), rest);
  };
  for (const p of patterns.filter((x) => !x.startsWith('!'))) walk(root, p.replace(/^\.\//, '').replace(/\/$/, '').split('/'));
  const excluded = new Set();
  const inc = [...out];
  out.clear();
  for (const p of patterns.filter((x) => x.startsWith('!'))) walk(root, p.slice(1).replace(/^\.\//, '').replace(/\/$/, '').split('/'));
  for (const d of out) excluded.add(d);
  return inc.filter((d) => !excluded.has(d));
}

// pnpm-workspace.yaml's `packages:` list, without pulling in a YAML parser for one list.
function pnpmPatterns(root) {
  const lines = readText(path.join(root, 'pnpm-workspace.yaml')).split(/\r?\n/);
  const at = lines.findIndex((l) => /^packages\s*:/.test(l));
  if (at < 0) return [];
  const out = [];
  for (const l of lines.slice(at + 1)) {
    const m = /^\s*-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/.exec(l);
    if (m) out.push(m[1]);
    else if (l.trim() && !l.trim().startsWith('#')) break;
  }
  return out;
}

function workspacePatterns(root) {
  const pkg = readJson(path.join(root, 'package.json'));
  const w = Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages || [];
  const lerna = readJson(path.join(root, 'lerna.json'))?.packages || [];
  return [...w, ...lerna, ...pnpmPatterns(root)];
}

// Nx keeps projects in project.json files, or as package.json projects within workspaces.
function nxProjects(root) {
  if (!exists(root, 'nx.json')) return [];
  const found = [];
  const walk = (dir, depth) => {
    if (found.length >= MAX_PROJECTS || depth > MAX_DEPTH) return;
    for (const d of subdirs(dir)) {
      const full = path.join(dir, d);
      const cfg = readJson(path.join(full, 'project.json'));
      if (cfg) found.push({ dir: full, name: cfg.name || d, targets: cfg.targets || {}, type: cfg.projectType });
      walk(full, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

const NX_TARGETS = ['serve', 'dev', 'start', 'develop'];

function nxCandidates(root, exec) {
  return nxProjects(root).flatMap((p) => {
    const target = NX_TARGETS.find((t) => p.targets[t]);
    if (!target) return [];
    const options = p.targets[target].options || {};
    const executor = String(p.targets[target].executor || '');
    return [{
      project: p.name, dir: path.relative(root, p.dir).split(path.sep).join('/'),
      command: `${exec} nx ${target} ${p.name}`, port: Number(options.port) || null,
      kind: /:node\b|node:|nest|express|fastify/.test(executor) ? 'api' : p.type === 'library' ? 'other' : 'web',
    }];
  });
}

function execPrefix(root) {
  if (exists(root, 'pnpm-lock.yaml')) return 'pnpm exec';
  if (exists(root, 'yarn.lock')) return 'yarn';
  if (exists(root, 'bun.lockb') || exists(root, 'bun.lock')) return 'bunx';
  return 'npx';
}

const hasTool = (root, file, dep) => exists(root, file) || !!{ ...readJson(path.join(root, 'package.json'))?.devDependencies, ...readJson(path.join(root, 'package.json'))?.dependencies }[dep];

function monorepo(root) {
  const packageDirs = expandGlobs(root, workspacePatterns(root)).filter((d) => exists(d, 'package.json'));
  return {
    packageDirs,
    nx: exists(root, 'nx.json') ? nxCandidates(root, execPrefix(root)) : [],
    turbo: hasTool(root, 'turbo.json', 'turbo') ? execPrefix(root) : null,
  };
}

module.exports = { monorepo, expandGlobs, pnpmPatterns, execPrefix };
