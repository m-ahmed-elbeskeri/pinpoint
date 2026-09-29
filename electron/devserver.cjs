// Works out how to start a project's dev server: which package manager, which
// script, which folder (monorepos and frontend/ subfolders), and the port it
// will likely serve on. Also checks whether that server is already up.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const exists = (...p) => fs.existsSync(path.join(...p));
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// Known dev-server invocations, with the port they default to.
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
// Script names in order of preference; storybook & co. rank below the app.
const NAME_RANK = ['dev', 'start', 'serve', 'develop', 'dev:web', 'web', 'dev:client', 'dev:app', 'preview', 'watch'];
const SKIP_NAME = /build|dist|release|deploy|publish|test|lint|typecheck|format|clean|icons|prepare|install|storybook:build/;
// Port fallback when a script's body doesn't name the tool (e.g. `node scripts/dev.mjs`).
const DEP_PORTS = [['next', 3000], ['nuxt', 3000], ['astro', 4321], ['@angular/core', 4200], ['gatsby', 8000], ['react-scripts', 3000], ['vite', 5173]];
const SUBDIRS = ['frontend', 'client', 'web', 'ui', 'app', 'site', 'www'];
const WORKSPACE_DIRS = ['apps', 'packages'];

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

// Native separators so cmd.exe's `cd` is happy too; quoted if it has spaces.
const cdPath = (rel) => { const p = rel.split('/').join(path.sep); return /\s/.test(p) ? `"${p}"` : p; };

function portFrom(body, fallback) {
  const m = /(?:--port[= ]|-p\s+|\bPORT=)(\d{2,5})/.exec(body);
  return m ? Number(m[1]) : fallback;
}

// Ranks one package.json's scripts; returns the candidates it offers.
function scriptCandidates(dir, root) {
  const pkg = readJson(path.join(dir, 'package.json'));
  const scripts = pkg?.scripts || {};
  const pm = packageManager(dir, root, pkg);
  const rel = path.relative(root, dir).split(path.sep).join('/');
  const needsInstall = !exists(dir, 'node_modules') && !exists(root, 'node_modules');
  // Workspaces install from the root; a standalone subfolder app installs in place.
  const rootPkg = readJson(path.join(root, 'package.json'));
  const installAtRoot = !!rootPkg && (!!rootPkg.workspaces || ['pnpm-workspace.yaml', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'bun.lock', 'bun.lockb'].some((f) => exists(root, f)));
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const depPort = DEP_PORTS.find(([d]) => deps[d])?.[1] ?? null;
  const out = [];
  for (const [name, body] of Object.entries(scripts)) {
    if (typeof body !== 'string' || SKIP_NAME.test(name)) continue;
    // Production servers (`next start`) need a build first; not what we want here.
    if (/\b(next|nuxt|remix-serve|react-router-serve)\s+start\b|\bnuxt\s+preview\b/.test(body)) continue;
    // Judge each step of `a && b` on its own, so `vite build && electron .` isn't a dev server.
    const steps = body.split(/&&|\|\||;|\|/).filter((s) => !/\b(build|preview|export|generate|install)\b/.test(s));
    const tool = TOOLS.find(([re]) => steps.some((s) => re.test(s)));
    const rank = NAME_RANK.indexOf(name);
    // Only scripts that look like they serve something.
    if (!tool && rank < 0) continue;
    let score = (rank >= 0 ? 40 - rank * 3 : 10) + (tool ? 30 : 0);
    if (tool && tool[2] === 'Storybook') score -= 35;
    if (tool && tool[2] === 'static server') score -= 10;
    if (/preview|watch/.test(name)) score -= 15;
    // A root script that fans out to workspaces (turbo, concurrently...) is fine, but prefer a direct server.
    if (/\b(turbo|nx|lerna|concurrently|npm-run-all|run-p)\b/.test(body)) score -= 5;
    if (rel) score -= 8;
    const install = needsInstall ? `${pm} install && ` : '';
    const cd = rel ? `cd ${cdPath(rel)} && ` : '';
    const command = installAtRoot ? install + cd + runCmd(pm, name) : cd + install + runCmd(pm, name);
    out.push({ command, label: tool ? tool[2] : name, dir: rel || '.', script: name, port: portFrom(body, tool ? tool[1] : depPort), score });
  }
  return out;
}

function otherStacks(root) {
  const out = [];
  if (exists(root, 'manage.py')) out.push({ command: 'python manage.py runserver', label: 'Django', dir: '.', port: 8000, score: 45 });
  if (exists(root, 'artisan')) out.push({ command: 'php artisan serve', label: 'Laravel', dir: '.', port: 8000, score: 45 });
  if (exists(root, 'bin', 'rails')) out.push({ command: 'bin/rails server', label: 'Rails', dir: '.', port: 3000, score: 45 });
  if (exists(root, 'Gemfile') && (exists(root, '_config.yml') || exists(root, '_config.toml'))) out.push({ command: 'bundle exec jekyll serve', label: 'Jekyll', dir: '.', port: 4000, score: 40 });
  if (exists(root, 'hugo.toml') || exists(root, 'hugo.yaml') || (exists(root, 'config.toml') && isDir(path.join(root, 'content')))) out.push({ command: 'hugo server', label: 'Hugo', dir: '.', port: 1313, score: 40 });
  if (!exists(root, 'package.json') && exists(root, 'index.html')) out.push({ command: 'npx --yes serve .', label: 'static site', dir: '.', port: 3000, score: 20 });
  return out;
}

function detect(root) {
  if (!root || !isDir(root)) return { command: '', candidates: [] };
  const dirs = [root];
  for (const s of SUBDIRS) if (exists(root, s, 'package.json')) dirs.push(path.join(root, s));
  for (const w of WORKSPACE_DIRS) {
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, w), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (e.isDirectory() && exists(root, w, e.name, 'package.json')) dirs.push(path.join(root, w, e.name));
  }
  const candidates = [...dirs.flatMap((d) => scriptCandidates(d, root)), ...otherStacks(root)]
    .sort((a, b) => b.score - a.score)
    .filter((c, i, all) => all.findIndex((x) => x.command === c.command) === i)
    .slice(0, 8)
    .map(({ score, ...c }) => c);
  return { command: candidates[0]?.command || '', candidates };
}

// True when something answers HTTP on the port (any status counts).
function probe(port, timeout = 700) {
  return new Promise((resolve) => {
    const req = http.get({ host: 'localhost', port, path: '/', timeout }, (res) => { res.resume(); resolve(true); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// Detects the command and, if its server is already running, where.
async function inspect(root) {
  const d = detect(root);
  const ports = [...new Set(d.candidates.map((c) => c.port).filter(Boolean))].slice(0, 3);
  let runningUrl = null;
  for (const p of ports) if (await probe(p)) { runningUrl = `http://localhost:${p}`; break; }
  return { ...d, runningUrl };
}

module.exports = { detect, inspect };
