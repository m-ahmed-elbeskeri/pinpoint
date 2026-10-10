const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    if (key.startsWith('no-')) out[key.slice(3)] = false;
    else if (argv[i + 1] == null || argv[i + 1].startsWith('--')) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

const say = (s) => process.stdout.write(s + '\n');

async function capture(args) {
  const routecheck = require('./routecheck.cjs');
  const { listRoutes } = require('./routes.cjs');
  if (!args.url || !args.out) throw new Error('capture needs --url=<address> and --out=<folder>');
  const base = String(args.url).replace(/\/$/, '');
  const project = path.resolve(args.project || '.');
  let routes = args.routes ? String(args.routes).split(',').map((r) => r.trim()).filter(Boolean)
    : listRoutes(project).filter((r) => !r.dynamic).map((r) => r.route);
  if (!routes.includes('/')) routes.unshift('/');
  routes = [...new Set(routes)].slice(0, 30);
  fs.mkdirSync(args.out, { recursive: true });
  const axe = args.a11y === false ? null : fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  const manifest = { url: base, at: new Date().toISOString(), routes: [] };
  for (const route of routes) {
    const url = base + route;
    const key = routecheck.keyFor(route);
    const shot = await routecheck.shoot(url);
    if (!shot) { say(`  ✗ ${route}  did not load`); manifest.routes.push({ route, key, failed: true }); continue; }
    fs.writeFileSync(path.join(args.out, `${key}.jpg`), shot.jpg);
    const entry = { route, key, noisy: shot.noisy };
    if (axe) {
      entry.a11y = await routecheck.visit(url, (wc) => wc.executeJavaScript(`(async () => { ${axe}\n const r = await axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length, targets: v.nodes.slice(0, 5).map((n) => n.target.map(String).join(' ')) })); })()`)) || [];
    }
    entry.perf = await routecheck.measure(url);
    manifest.routes.push(entry);
    say(`  ✓ ${route}${entry.a11y ? `  (${entry.a11y.reduce((s, v) => s + v.count, 0)} accessibility issues)` : ''}`);
  }
  fs.writeFileSync(path.join(args.out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  say(`Captured ${manifest.routes.filter((r) => !r.failed).length} of ${routes.length} pages into ${args.out}`);
  return 0;
}

async function compare(args) {
  const routecheck = require('./routecheck.cjs');
  if (!args.before || !args.after) throw new Error('compare needs --before=<folder> and --after=<folder>');
  const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const before = read(args.before), after = read(args.after);
  const base = args.url ? String(args.url).replace(/\/$/, '') : null;
  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
  const rows = [];
  let changed = 0, newA11y = 0;
  for (const a of after.routes) {
    const b = before.routes.find((r) => r.key === a.key);
    if (a.failed) { rows.push({ route: a.route, status: 'did not load' }); changed++; continue; }
    if (!b || b.failed) { rows.push({ route: a.route, status: 'new page' }); continue; }
    const diff = routecheck.compare(
      { jpg: fs.readFileSync(path.join(args.before, `${a.key}.jpg`)), noisy: b.noisy },
      { jpg: fs.readFileSync(path.join(args.after, `${a.key}.jpg`)), noisy: a.noisy },
    );
    const had = new Set((b.a11y || []).flatMap((v) => v.targets.map((t) => `${v.id}|${t}`)));
    const fresh = (a.a11y || []).map((v) => ({ ...v, targets: v.targets.filter((t) => !had.has(`${v.id}|${t}`)) })).filter((v) => v.targets.length);
    newA11y += fresh.reduce((s, v) => s + v.targets.length, 0);
    let areas = [];
    if (diff.changed) {
      changed++;
      if (base) areas = (await routecheck.nameAreas(base + a.route, diff.areas)).areas;
    }
    const js = a.perf && b.perf ? a.perf.js - b.perf.js : 0;
    rows.push({ route: a.route, key: a.key, status: diff.changed ? `changed (${diff.pct}%)` : 'same', areas, fresh, js });
  }
  const lines = ['## Pinpoint visual check', ''];
  lines.push(changed ? `**${changed} of ${after.routes.length} pages look different** from the base branch.` : `All ${after.routes.length} pages look the same as the base branch.`);
  if (newA11y) lines.push(`**${newA11y} new accessibility problem${newA11y > 1 ? 's' : ''}.**`);
  lines.push('', '| Page | Result | What changed | New accessibility issues | JS |', '|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(`| \`${r.route}\` | ${r.status} | ${(r.areas || []).map((x) => x.replace(/\|/g, '\\|')).join(', ') || '' } | ${(r.fresh || []).map((v) => `${v.help} (${v.targets.length})`).join('; ')} | ${r.js && Math.abs(r.js) >= 1024 ? `${r.js > 0 ? '+' : '−'}${kb(Math.abs(r.js))}` : ''} |`);
  }
  lines.push('', `Before and after screenshots are in \`${args.before}\` and \`${args.after}\` (one \`.jpg\` per page).`);
  const report = lines.join('\n') + '\n';
  if (args.report) fs.writeFileSync(args.report, report); else say(report);
  if (args.json) fs.writeFileSync(args.json, JSON.stringify({ changed, newA11y, rows }, null, 2));
  say(`${changed} page(s) changed, ${newA11y} new accessibility problem(s).`);
  const failOn = args['fail-on'] || 'none';
  if ((failOn === 'changes' || failOn === 'any') && changed) return 1;
  if ((failOn === 'a11y' || failOn === 'any') && newA11y) return 1;
  return 0;
}

async function buildSize(args) {
  const buildsize = require('./buildsize.cjs');
  const { now, previous } = await buildsize.measure(path.resolve(args.project || '.'));
  const kb = (n) => Math.round(n / 102.4) / 10;
  say(`JS ${kb(now.jsGzip)} kB gzipped (${kb(now.js)} kB), CSS ${kb(now.cssGzip)} kB gzipped (${kb(now.css)} kB), ${now.files} files${previous ? `; JS ${now.jsGzip - previous.jsGzip >= 0 ? '+' : ''}${kb(now.jsGzip - previous.jsGzip)} kB since last measured` : ''}`);
  let over = false;
  if (args['max-js'] && kb(now.jsGzip) > +args['max-js']) { say(`✗ JS is over the ${args['max-js']} kB limit`); over = true; }
  if (args['max-css'] && kb(now.cssGzip) > +args['max-css']) { say(`✗ CSS is over the ${args['max-css']} kB limit`); over = true; }
  return over ? 1 : 0;
}

const COMMANDS = { capture, compare, 'build-size': buildSize };

async function run(argv) {
  const args = parseArgs(argv);
  const command = COMMANDS[args._[0]];
  if (!command) { say('Usage: electron . --ci <capture|compare|build-size> [options]  (see electron/ci.cjs)'); app.exit(2); return; }
  await app.whenReady();
  try { app.exit(await command(args)); }
  catch (err) { process.stderr.write(`pinpoint: ${err.message}\n`); app.exit(2); }
}

app.disableHardwareAcceleration();

for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (err) => { process.stderr.write(`pinpoint: ${err?.stack || err}\n`); app.exit(3); });
}

app.on('window-all-closed', () => {});
run(process.argv.slice(process.argv.indexOf('--ci') + 1));
