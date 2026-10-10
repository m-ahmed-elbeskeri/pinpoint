// Works out what design system a project uses (Tailwind, a component library,
// CSS-variable tokens) so the agent reuses it instead of writing raw values,
// and counts how often a component is used so "this one or all of them" is a
// real choice.
const fs = require('node:fs');
const path = require('node:path');

const SKIP = new Set(['node_modules', '.git', '.next', '.nuxt', '.svelte-kit', '.astro', 'dist', 'build', 'out', '.output', '.pinpoint', 'coverage', '.turbo', '.vercel', '.cache', 'vendor', 'target', '__pycache__', '.venv', 'venv']);
const MAX_FILES = 6000;
const MAX_BYTES = 400 * 1024;

const LIBRARIES = [
  ['@mui/material', 'MUI'], ['@chakra-ui/react', 'Chakra UI'], ['antd', 'Ant Design'], ['@mantine/core', 'Mantine'],
  ['daisyui', 'daisyUI'], ['bootstrap', 'Bootstrap'], ['react-bootstrap', 'React Bootstrap'], ['@headlessui/react', 'Headless UI'],
  ['@headlessui/vue', 'Headless UI'], ['vuetify', 'Vuetify'], ['primevue', 'PrimeVue'], ['element-plus', 'Element Plus'],
  ['@nextui-org/react', 'NextUI'], ['@heroui/react', 'HeroUI'], ['flowbite', 'Flowbite'], ['@radix-ui/themes', 'Radix Themes'],
  ['@ark-ui/react', 'Ark UI'], ['bits-ui', 'Bits UI'], ['@angular/material', 'Angular Material'], ['bulma', 'Bulma'],
];
const STYLING = [
  ['styled-components', 'styled-components'], ['@emotion/react', 'Emotion'], ['@emotion/styled', 'Emotion'], ['sass', 'Sass'],
  ['@vanilla-extract/css', 'vanilla-extract'], ['@stitches/react', 'Stitches'], ['@pandacss/dev', 'Panda CSS'], ['unocss', 'UnoCSS'],
  ['class-variance-authority', 'cva variants'],
];

function walk(root, keep) {
  const out = [];
  const stack = [''];
  while (stack.length && out.length < MAX_FILES) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP.has(e.name)) stack.push(r); }
      else if (e.isFile() && keep(e.name)) out.push(r);
    }
  }
  return out;
}

// The same list as walk(), read without blocking the app while it works.
async function walkAsync(root, keep) {
  const out = [];
  const stack = [''];
  while (stack.length && out.length < MAX_FILES) {
    const rel = stack.pop();
    let entries;
    try { entries = await fs.promises.readdir(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP.has(e.name)) stack.push(r); }
      else if (e.isFile() && keep(e.name)) out.push(r);
    }
  }
  return out;
}

async function readSmallAsync(file) {
  try { return (await fs.promises.stat(file)).size <= MAX_BYTES ? await fs.promises.readFile(file, 'utf8') : null; } catch { return null; }
}

function readSmall(file) {
  try { return fs.statSync(file).size <= MAX_BYTES ? fs.readFileSync(file, 'utf8') : null; } catch { return null; }
}

// Dependencies of the root package and of app packages one or two levels down.
function allDeps(root, pkgFiles) {
  const deps = {};
  for (const f of pkgFiles) {
    try { const p = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')); Object.assign(deps, p.dependencies, p.devDependencies); } catch { /* skip */ }
  }
  return deps;
}

// Asked for on every live tweak and again when a run starts: the answer is kept for a
// few seconds so a burst of edits walks the project once.
let lastInspect = null; // { root, at, value }
function inspect(root) {
  if (lastInspect && lastInspect.root === root && Date.now() - lastInspect.at < 5000) return lastInspect.value;
  const value = inspectNow(root);
  lastInspect = { root, at: Date.now(), value };
  return value;
}

function inspectNow(root) {
  if (!root || !fs.existsSync(root)) return null;
  const files = walk(root, (n) => /\.(css|scss|sass|less|pcss)$/.test(n) || n === 'package.json' || n === 'components.json' || /^(tailwind|uno|panda|theme)\.config\.\w+$/.test(n));
  const pkgs = files.filter((f) => /(^|\/)package\.json$/.test(f) && f.split('/').length <= 3);
  const deps = allDeps(root, pkgs);
  const named = (table) => [...new Set(table.filter(([dep]) => deps[dep]).map(([, name]) => name))];

  const libraries = named(LIBRARIES);
  const shadcn = files.find((f) => /(^|\/)components\.json$/.test(f));
  if (shadcn && Object.keys(deps).some((d) => d.startsWith('@radix-ui/') || d === 'radix-ui' || d.startsWith('@base-ui'))) libraries.unshift('shadcn/ui');
  const styling = named(STYLING);

  const styleFiles = files.filter((f) => /\.(css|scss|sass|less|pcss)$/.test(f));
  if (styleFiles.some((f) => /\.module\.\w+$/.test(f))) styling.push('CSS Modules');

  // CSS custom properties: which files define them, and what they are.
  const tokens = new Map();
  const tokenFiles = [];
  let tailwindCss = null;
  for (const f of styleFiles) {
    const text = readSmall(path.join(root, f));
    if (!text) continue;
    if (!tailwindCss && /@import\s+["']tailwindcss|@tailwind\s+base|@theme\b/.test(text)) tailwindCss = f;
    let count = 0;
    for (const m of text.matchAll(/(^|[;{\s])(--[\w-]+)\s*:\s*([^;}]+)[;}]/g)) {
      count++;
      if (!tokens.has(m[2]) && tokens.size < 300) tokens.set(m[2], m[3].trim().replace(/\s+/g, ' ').slice(0, 60));
    }
    if (count >= 3) tokenFiles.push({ file: f, count });
  }
  tokenFiles.sort((a, b) => b.count - a.count);

  const twConfig = files.find((f) => /(^|\/)tailwind\.config\.\w+$/.test(f));
  const tailwind = deps.tailwindcss || twConfig || tailwindCss
    ? { version: String(deps.tailwindcss || '').replace(/^[^\d]*/, '') || null, config: twConfig || tailwindCss || null, entry: tailwindCss || null, configFile: twConfig || null }
    : null;

  if (!tailwind && !libraries.length && !styling.length && !tokenFiles.length) return null;
  return {
    tailwind, libraries, styling,
    componentsConfig: shadcn || null,
    tokenFiles: tokenFiles.slice(0, 6),
    tokens: [...tokens].map(([name, value]) => ({ name, value })),
  };
}

// How many times <Name …> appears in the project's source, and where.
// Runs on every pick of a component, so the files are read without blocking the app
// and the answer for a name is kept briefly (picking siblings asks the same thing).
const usageCache = new Map(); // root:name -> { at, value }
async function componentUsage(root, name) {
  if (!root || !/^[A-Za-z_$][\w$.]{1,60}$/.test(name || '')) return { count: 0, files: [] };
  const hit = usageCache.get(`${root}:${name}`);
  if (hit && Date.now() - hit.at < 10000) return hit.value;
  const kebab = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  const esc = (s) => s.replace(/[.$]/g, '\\$&');
  const re = new RegExp(`<(?:${esc(name)}${kebab !== name.toLowerCase() ? `|${esc(kebab)}` : ''})(?=[\\s/>])`, 'g');
  const per = [];
  const files = await walkAsync(root, (n) => /\.(jsx|tsx|js|ts|vue|svelte|astro|mdx)$/.test(n) && !/\.(test|spec|stories)\.\w+$/.test(n) && !n.endsWith('.d.ts'));
  for (let i = 0; i < files.length; i += 64) {
    const texts = await Promise.all(files.slice(i, i + 64).map((f) => readSmallAsync(path.join(root, f))));
    texts.forEach((text, j) => {
      const n = text ? (text.match(re) || []).length : 0;
      if (n) per.push({ file: files[i + j], n });
    });
  }
  per.sort((a, b) => b.n - a.n);
  const value = { count: per.reduce((s, p) => s + p.n, 0), files: per.slice(0, 6).map((p) => p.file), fileCount: per.length };
  usageCache.set(`${root}:${name}`, { at: Date.now(), value });
  if (usageCache.size > 50) usageCache.delete(usageCache.keys().next().value);
  return value;
}

// The component's Storybook story file, if there is one, and whether the project uses Storybook.
function findStory(root, name) {
  if (!root || !/^[A-Za-z_$][\w$]{1,60}$/.test(name || '')) return { file: null, storybook: false };
  let storybook = fs.existsSync(path.join(root, '.storybook'));
  const stories = walk(root, (n) => /\.stories\.(jsx?|tsx?|mdx|vue|svelte)$/.test(n));
  if (stories.length) storybook = true;
  const lower = name.toLowerCase();
  const file = stories.find((f) => path.basename(f).split('.')[0].toLowerCase() === lower)
    || stories.find((f) => { const t = readSmall(path.join(root, f)); return !!t && new RegExp(`component:\\s*${name}\\b`).test(t); }) || null;
  return { file, storybook };
}

module.exports = { inspect, componentUsage, findStory };
