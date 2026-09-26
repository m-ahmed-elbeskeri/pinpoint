// Discovers the app's routes from the file system (and React Router configs),
// so the UI can list pages and the agent knows which file renders the current one.
const fs = require('node:fs');
const path = require('node:path');

const SKIP = new Set(['node_modules', '.git', '.next', '.nuxt', '.svelte-kit', '.astro', 'dist', 'build', 'out', '.output', '.pinpoint', 'coverage', '.turbo', '.vercel']);
const MAX = 400;

function walk(dir, root, out, depth = 0) {
  if (depth > 12 || out.length > 5000) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, root, out, depth + 1);
    else out.push(path.relative(root, abs).split(path.sep).join('/'));
  }
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const dynamic = (r) => /\[|:|\*/.test(r);

function readPkg(root) {
  try { const p = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); return { ...p.dependencies, ...p.devDependencies }; }
  catch { return {}; }
}

// "(group)" and "@slot" segments don't appear in URLs.
const cleanSegs = (segs) => segs.filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'));
const join = (segs) => '/' + cleanSegs(segs).join('/');

function listRoutes(root) {
  const deps = readPkg(root);
  const routes = [];
  const add = (route, file, framework) => {
    route = route.replace(/\/+/g, '/').replace(/(.)\/$/, '$1') || '/';
    if (!routes.some((r) => r.route === route)) routes.push({ route, file, framework, dynamic: dynamic(route) });
  };

  for (const base of ['app', 'src/app']) {
    const dir = path.join(root, base);
    if (!isDir(dir) || !deps.next) continue;
    const files = []; walk(dir, root, files);
    for (const f of files) {
      const m = f.slice(base.length + 1).match(/^(.*?)\/?page\.(tsx|jsx|ts|js|mdx|md)$/);
      if (m) add(join(m[1].split('/')), f, 'Next.js');
    }
  }

  // Next pages router, Astro and Nuxt share the "file = route" convention.
  for (const base of ['pages', 'src/pages']) {
    const dir = path.join(root, base);
    if (!isDir(dir)) continue;
    const fw = deps.astro ? 'Astro' : deps.nuxt ? 'Nuxt' : deps.next ? 'Next.js' : 'Pages';
    const files = []; walk(dir, root, files);
    for (const f of files) {
      const rel = f.slice(base.length + 1);
      if (!/\.(tsx|jsx|ts|js|astro|md|mdx|vue|html)$/.test(rel) || /^api\//.test(rel) || /(^|\/)_/.test(rel)) continue;
      if (/\.(ts|js)$/.test(rel) && fw === 'Astro') continue; // Astro endpoints
      const segs = rel.replace(/\.[^.]+$/, '').split('/');
      if (segs[segs.length - 1] === 'index') segs.pop();
      add(join(segs), f, fw);
    }
  }

  // SvelteKit
  const sk = path.join(root, 'src', 'routes');
  if (isDir(sk) && (deps['@sveltejs/kit'] || fs.existsSync(path.join(root, 'svelte.config.js')))) {
    const files = []; walk(sk, root, files);
    for (const f of files) {
      const m = f.slice('src/routes/'.length).match(/^(.*?)\/?\+page\.svelte$/);
      if (m) add(join(m[1].split('/')), f, 'SvelteKit');
    }
  }

  // Remix / React Router v7 flat routes: app/routes/blog.$slug.tsx -> /blog/:slug
  const rr = path.join(root, 'app', 'routes');
  if (isDir(rr) && (deps['@remix-run/react'] || deps['@react-router/dev'])) {
    for (const f of fs.readdirSync(rr)) {
      const name = f.replace(/\.(tsx|jsx|ts|js|mdx)$/, '').replace(/\/route$/, '');
      if (name === f && !isDir(path.join(rr, f))) continue;
      const segs = name.split('.').filter((s) => !s.startsWith('_') || s === '_index').map((s) => (s === '_index' ? '' : s.replace(/^\$$/, '*').replace(/^\$/, ':')));
      add(join(segs), `app/routes/${f}`, 'Remix');
    }
  }

  // React Router declared in code: <Route path="/x"> or { path: '/x' }
  if (deps['react-router-dom'] || deps['react-router'] || deps['@tanstack/react-router']) {
    const files = []; walk(path.join(root, 'src'), root, files);
    for (const f of files.filter((x) => /\.(tsx|jsx|ts|js)$/.test(x)).slice(0, 1500)) {
      let src;
      try { src = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
      if (!/Route|createBrowserRouter|createRoute/.test(src)) continue;
      for (const m of src.matchAll(/\bpath\s*[:=]\s*\{?\s*["'`]([^"'`]+)["'`]/g)) {
        if (m[1].startsWith('/') || m[1] === '*' ) add(m[1], f, 'React Router');
        else if (!/[.\s]/.test(m[1])) add('/' + m[1], f, 'React Router');
      }
    }
  }

  // Plain HTML sites
  if (!routes.length) {
    const files = []; walk(root, root, files);
    for (const f of files.filter((x) => x.endsWith('.html')).slice(0, 200)) {
      add(f === 'index.html' ? '/' : '/' + f, f, 'HTML');
    }
  }

  return routes.slice(0, MAX).sort((a, b) => (a.dynamic - b.dynamic) || a.route.localeCompare(b.route));
}

module.exports = { listRoutes };
