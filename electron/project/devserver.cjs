const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { isDir, readJson } = require('../fsutil.cjs');
const { monorepo } = require('./detect/monorepo.cjs');
const { backends, procfile, taskTargets, compose } = require('./detect/services.cjs');

const exists = (...p) => fs.existsSync(path.join(...p));

const TOOLS = [
  [/\bnext\s+dev\b/, 3000, 'Next.js'],
  [/\bnuxi?\s+dev\b/, 3000, 'Nuxt'],
  [/\bastro\s+dev\b/, 4321, 'Astro'],
  [/\bremix\s+(vite:)?dev\b/, 5173, 'Remix'],
  [/\breact-router\s+dev\b/, 5173, 'React Router'],
  [/\bsvelte-kit\s+dev\b/, 5173, 'SvelteKit'],
  [/\bvite(\s+(dev|serve))?(\s|$)/, 5173, 'Vite'],
  [/\breact-scripts\s+start\b/, 3000, 'Create React App'],
  [/\bcraco\s+start\b/, 3000, 'Create React App'],
  [/\bng\s+serve\b/, 4200, 'Angular'],
  [/\bvue-cli-service\s+serve\b/, 8080, 'Vue CLI'],
  [/\bgatsby\s+develop\b/, 8000, 'Gatsby'],
  [/\bwebpack(-dev-server|\s+serve)\b/, 8080, 'webpack'],
  [/\bparcel\b/, 1234, 'Parcel'],
  [/\beleventy\b.*--serve/, 8080, 'Eleventy'],
  [/\bdocusaurus\s+start\b/, 3000, 'Docusaurus'],
  [/\bexpo\s+start\b.*--web/, 8081, 'Expo'],
  [/\bstorybook\s+dev\b|start-storybook/, 6006, 'Storybook'],
  [/\bserve\b|\bhttp-server\b|\blive-server\b/, 3000, 'static server'],
];
const NAME_RANK = ['dev', 'start', 'serve', 'develop', 'dev:web', 'web', 'dev:client', 'dev:app', 'preview', 'watch'];
const SKIP_NAME = /build|dist|release|deploy|publish|test|lint|typecheck|format|clean|icons|prepare|install|storybook:build/;
const DEP_PORTS = [['next', 3000], ['nuxt', 3000], ['astro', 4321], ['@angular/core', 4200], ['gatsby', 8000], ['react-scripts', 3000], ['vite', 5173]];
const SUBDIRS = ['frontend', 'client', 'web', 'ui', 'app', 'site', 'www'];
const WORKSPACE_DIRS = ['apps', 'packages'];
const SERVICE_DIRS = ['api', 'server', 'backend', 'service', 'worker'];
const SERVICE_GROUPS = ['services', 'apps', 'packages'];
const API_DEPS = /^(express|fastify|koa|hapi|@hapi\/hapi|@nestjs\/core|hono|elysia)$/;
const MAX_CANDIDATES = 14;

function packageManager(dir, root, pkg) {
  const pinned = /^(pnpm|yarn|bun|npm)@/.exec(pkg?.packageManager || readJson(path.join(root, 'package.json'))?.packageManager || '');
  if (pinned) return pinned[1];
  for (const d of [...new Set([dir, root])]) {
    if (exists(d, 'pnpm-lock.yaml')) return 'pnpm';
    if (exists(d, 'yarn.lock')) return 'yarn';
    if (exists(d, 'bun.lockb') || exists(d, 'bun.lock')) return 'bun';
    if (exists(d, 'package-lock.json')) return 'npm';
  }
  return 'npm';
}

const runCmd = (pm, name) => (pm === 'npm' ? (name === 'start' ? 'npm start' : `npm run ${name}`) : `${pm} ${name === 'start' ? 'start' : `run ${name}`}`);

const cdPath = (rel) => { const p = rel.split('/').join(path.sep); return /\s/.test(p) ? `"${p}"` : p; };

function portFrom(body, fallback) {
  const m = /(?:--port[= ]|-p\s+|\bPORT=)(\d{2,5})/.exec(body);
  return m ? Number(m[1]) : fallback;
}

function scriptCandidates(dir, root, turboExec) {
  const pkg = readJson(path.join(dir, 'package.json'));
  const scripts = pkg?.scripts || {};
  const pm = packageManager(dir, root, pkg);
  const rel = path.relative(root, dir).split(path.sep).join('/');
  const needsInstall = !exists(dir, 'node_modules') && !exists(root, 'node_modules');
  const rootPkg = readJson(path.join(root, 'package.json'));
  const installAtRoot = !!rootPkg && (!!rootPkg.workspaces || ['pnpm-workspace.yaml', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'bun.lock', 'bun.lockb'].some((f) => exists(root, f)));
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const depPort = DEP_PORTS.find(([d]) => deps[d])?.[1] ?? null;
  const out = [];
  for (const [name, body] of Object.entries(scripts)) {
    if (typeof body !== 'string' || SKIP_NAME.test(name)) continue;
    if (/\b(next|nuxt|remix-serve|react-router-serve)\s+start\b|\bnuxt\s+preview\b/.test(body)) continue;
    const steps = body.split(/&&|\|\||;|\|/).filter((s) => !/\b(build|preview|export|generate|install)\b/.test(s));
    const tool = TOOLS.find(([re]) => steps.some((s) => re.test(s)));
    const rank = NAME_RANK.indexOf(name);
    if (!tool && rank < 0) continue;
    let score = (rank >= 0 ? 40 - rank * 3 : 10) + (tool ? 30 : 0);
    if (tool && tool[2] === 'Storybook') score -= 35;
    if (tool && tool[2] === 'static server') score -= 10;
    if (/preview|watch/.test(name)) score -= 15;
    if (/\b(turbo|nx|lerna|concurrently|npm-run-all|run-p)\b/.test(body)) score -= 5;
    if (rel) score -= 8;
    const install = needsInstall ? `${pm} install && ` : '';
    const cd = rel ? `cd ${cdPath(rel)} && ` : '';
    // Turborepo runs a package from the root, with what it depends on built first.
    const viaTurbo = rel && turboExec && pkg?.name ? `${install}${turboExec} turbo run ${name} --filter=${pkg.name}` : '';
    const command = viaTurbo || (installAtRoot ? install + cd + runCmd(pm, name) : cd + install + runCmd(pm, name));
    const api = !tool && (Object.keys(deps).some((d) => API_DEPS.test(d)) || /(^|\/)(api|server|backend|service)s?$/.test(rel));
    out.push({ command, label: tool ? tool[2] : rel ? `${rel.split('/').pop()}: ${name}` : name, dir: rel || '.', script: name, port: portFrom(body, tool ? tool[1] : depPort), kind: api ? 'api' : tool ? 'web' : 'other', score: api ? score - 12 : score });
  }
  return out;
}

function otherStacks(root) {
  const out = [];
  if (exists(root, 'Gemfile') && (exists(root, '_config.yml') || exists(root, '_config.toml'))) out.push({ command: 'bundle exec jekyll serve', label: 'Jekyll', dir: '.', port: 4000, kind: 'web', score: 40 });
  if (exists(root, 'hugo.toml') || exists(root, 'hugo.yaml') || (exists(root, 'config.toml') && isDir(path.join(root, 'content')))) out.push({ command: 'hugo server', label: 'Hugo', dir: '.', port: 1313, kind: 'web', score: 40 });
  if (!exists(root, 'package.json') && exists(root, 'index.html')) out.push({ command: 'npx --yes serve .', label: 'static site', dir: '.', port: 3000, kind: 'web', score: 20 });
  return out;
}

// Backends and services anywhere a project usually keeps them, each run from its own folder.
function serviceCandidates(root) {
  const dirs = [root];
  for (const d of [...SUBDIRS, ...SERVICE_DIRS]) if (isDir(path.join(root, d))) dirs.push(path.join(root, d));
  for (const g of SERVICE_GROUPS) {
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, g), { withFileTypes: true }); } catch { continue; } // the project has no such folder
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.')) dirs.push(path.join(root, g, e.name));
  }
  return dirs.flatMap((dir) => {
    const rel = path.relative(root, dir).split(path.sep).join('/');
    const found = [...backends(dir), ...(rel ? [] : [...procfile(dir), ...taskTargets(dir), ...compose(dir)])];
    return found.map((c) => ({ ...c, dir: rel || '.', command: rel ? `cd ${cdPath(rel)} && ${c.command}` : c.command, label: rel ? `${rel.split('/').pop()}: ${c.label}` : c.label, score: rel ? c.score - 6 : c.score }));
  });
}

function detect(root) {
  if (!root || !isDir(root)) return { command: '', candidates: [] };
  const mono = monorepo(root);
  const nx = mono.nx.map((p) => ({ command: p.command, label: `Nx: ${p.project}`, dir: p.dir, port: p.port, kind: p.kind, score: p.kind === 'web' ? 72 : p.kind === 'api' ? 50 : 20 }));
  const dirs = [root, ...mono.packageDirs];
  for (const s of SUBDIRS) if (exists(root, s, 'package.json')) dirs.push(path.join(root, s));
  for (const w of WORKSPACE_DIRS) {
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, w), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (e.isDirectory() && exists(root, w, e.name, 'package.json')) dirs.push(path.join(root, w, e.name));
  }
  const candidates = [...nx, ...[...new Set(dirs)].flatMap((d) => scriptCandidates(d, root, mono.turbo)), ...serviceCandidates(root), ...otherStacks(root)]
    .sort((a, b) => b.score - a.score)
    .filter((c, i, all) => all.findIndex((x) => x.command === c.command) === i)
    .slice(0, MAX_CANDIDATES)
    .map(({ score, ...c }) => c);
  return { command: candidates[0]?.command || '', candidates };
}

function probe(port, timeout = 700) {
  return new Promise((resolve) => {
    const req = http.get({ host: 'localhost', port, path: '/', timeout }, (res) => { res.resume(); resolve(true); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

async function inspect(root) {
  const d = detect(root);
  const ports = [...new Set(d.candidates.filter((c) => c.kind !== 'api' && c.kind !== 'worker').map((c) => c.port).filter(Boolean))].slice(0, 3);
  let runningUrl = null;
  for (const p of ports) if (await probe(p)) { runningUrl = `http://localhost:${p}`; break; }
  return { ...d, runningUrl };
}

module.exports = { detect, inspect };
