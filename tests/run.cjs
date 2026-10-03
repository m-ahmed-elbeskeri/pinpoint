// Test runner. Each suite is a script that prints/writes PASS and FAIL lines;
// most of them start the real app (or its main process) under Electron.
//
//   npm test                 everything that can run here
//   npm test -- --quick      no windows on screen: units, CI mode, page tools, main-process tools
//   npm test -- --only ui    one suite (or several, comma-separated)
//   npm test -- --engines    also download WebKit and Firefox (about 300 MB) and test them
//
// Suites that need a real project (Vite, Tailwind, Vue) use tests/.fixtures,
// created once with `npm run test:fixtures`; without it they are skipped.
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repo = path.join(__dirname, '..');
const electron = path.join(repo, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const fixtures = path.join(__dirname, '.fixtures');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;

// name, how it runs, whether it puts the app window on screen, and the fixture it needs
const SUITES = [
  { name: 'unit', runner: 'node', about: 'instant edits and component discovery' },
  { name: 'ci-mode', runner: 'node', about: 'headless capture / compare' },
  { name: 'page', runner: 'electron', about: 'page-side tools, change check' },
  { name: 'tools', runner: 'electron', about: 'main-process tools against a served page' },
  { name: 'extras', runner: 'electron', needs: 'tw4', about: 'Tailwind, Vue, Storybook, issues, build size' },
  { name: 'ui', runner: 'electron', window: true, about: 'picking and the element note' },
  { name: 'picker', runner: 'electron', window: true, about: 'model and thinking level control' },
  { name: 'tabs', runner: 'electron', window: true, about: 'browser tabs' },
  { name: 'flows', runner: 'electron', window: true, about: 'agent runs end to end (stand-in agent)' },
  { name: 'chats', runner: 'electron', window: true, about: 'several chats working at once' },
  { name: 'background', runner: 'electron', window: true, about: 'background runs in git worktrees' },
  { name: 'vite', runner: 'electron', window: true, needs: 'viteapp', about: 'instant edits, drag, workspace, profiles on a Vite project' },
  { name: 'engines', runner: 'electron', optIn: 'engines', about: 'WebKit and Firefox rendering' },
];

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-tests-'));

// Page-side helpers are TypeScript; the suites load them as plain scripts.
async function helpers() {
  const vite = await import('vite');
  for (const [name, src] of [['tokens', 'src/lib/tokens.ts'], ['a11y', 'src/lib/a11y.ts'], ['pagetools', 'src/lib/pagetools.ts'], ['inspect', 'src/lib/inspect.ts'], ['DeviceBar', 'src/components/DeviceBar.tsx']]) {
    const r = await vite.transformWithOxc(fs.readFileSync(path.join(repo, src), 'utf8'), src);
    fs.writeFileSync(path.join(out, `${name}.cjs`), r.code.replace(/^import .*$/gm, '').replace(/export const (\w+) =/g, 'exports.$1 =').replace(/export function (\w+)/g, 'exports.$1 = function $1'));
  }
}

function run(suite) {
  const file = path.join(__dirname, `${suite.name}.test.cjs`);
  const env = { ...process.env, PP_OUT: out, PP_FIXTURES: fixtures };
  delete env.ELECTRON_RUN_AS_NODE;
  let text = '';
  if (suite.runner === 'node') {
    const r = spawnSync(process.execPath, [file], { cwd: repo, env, encoding: 'utf8', timeout: 5 * 60 * 1000 });
    text = `${r.stdout || ''}${r.status === null ? '\nFAIL  timed out' : ''}`;
  } else {
    try { fs.rmSync(path.join(out, `${suite.name}.out`), { force: true }); } catch { /* first run */ }
    spawnSync(electron, [file], { cwd: repo, env, timeout: 6 * 60 * 1000, stdio: 'ignore' });
    try { text = fs.readFileSync(path.join(out, `${suite.name}.out`), 'utf8'); } catch { text = 'FAIL  the suite produced no results (it crashed or was closed)'; }
  }
  const lines = text.split('\n').filter((l) => /^(PASS|FAIL)/.test(l));
  const fails = lines.filter((l) => l.startsWith('FAIL'));
  // A suite that stopped without failing anything didn't finish: it stalled or was closed.
  if (suite.runner === 'electron' && !fails.length && !text.includes('[done]')) fails.push('FAIL  the suite did not run to the end');
  return { pass: lines.filter((l) => l.startsWith('PASS')).length, fails };
}

(async () => {
  if (!fs.existsSync(path.join(repo, 'dist', 'index.html')) || flag('build')) {
    console.log('Building the app…');
    execFileSync(process.execPath, [path.join(repo, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: repo, stdio: 'ignore' });
  }
  await helpers();
  let failed = 0, passed = 0;
  for (const suite of SUITES) {
    const skip = only ? (!only.includes(suite.name) && 'not selected')
      : suite.optIn ? (!flag(suite.optIn) && `opt in with --${suite.optIn}`)
        : flag('quick') && suite.window ? 'opens the app window'
          : suite.needs && !fs.existsSync(path.join(fixtures, suite.needs, 'node_modules')) ? 'needs `npm run test:fixtures`' : false;
    if (skip) { if (!only) console.log(`skip  ${suite.name.padEnd(11)} ${skip}`); continue; }
    const started = Date.now();
    let r = run(suite);
    // Suites that drive the window can be thrown off by other activity on the machine: one retry.
    let retried = false;
    if (r.fails.length && suite.runner === 'electron') { retried = true; r = run(suite); }
    passed += r.pass; failed += r.fails.length;
    console.log(`${r.fails.length ? 'FAIL' : 'ok  '}  ${suite.name.padEnd(11)} ${String(r.pass).padStart(3)} passed${r.fails.length ? `, ${r.fails.length} failed` : ''}  (${Math.round((Date.now() - started) / 1000)}s${retried ? ', retried' : ''})  ${suite.about}`);
    for (const f of r.fails) console.log(`        ${f.slice(0, 300)}`);
  }
  console.log(`\n${passed} passed, ${failed} failed. Screenshots and logs: ${out}`);
  process.exit(failed ? 1 : 0);
})();
