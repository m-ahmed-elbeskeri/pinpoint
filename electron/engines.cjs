const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ENGINES = ['webkit', 'firefox'];
const home = (base) => path.join(base, 'engines');
const browsersDir = (base) => path.join(home(base), 'browsers');
const env = (base) => ({ ...process.env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: browsersDir(base) });

function status(base) {
  const core = fs.existsSync(path.join(home(base), 'node_modules', 'playwright-core', 'package.json'));
  let have = [];
  try { have = fs.readdirSync(browsersDir(base)); } catch {  }
  const installed = ENGINES.filter((e) => have.some((d) => d.startsWith(`${e}-`)));
  return { ready: core && installed.length === ENGINES.length, installed };
}

function run(cmd, args, opts, onLine) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 20 * 60 * 1000, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).replace(/\u001b\[[0-9;]*m/g, '').trim().split('\n').filter(Boolean).slice(0, 2).join(' ').slice(0, 300)));
      resolve(String(stdout));
    });
    if (onLine) for (const s of [child.stdout, child.stderr]) s?.on('data', (d) => { const t = d.toString().trim().split('\n').pop(); if (t) onLine(t.slice(0, 120)); });
  });
}

async function install(base, onProgress = () => {}) {
  const dir = home(base);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, 'package.json'))) fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"pinpoint-engines","private":true}');
  onProgress('Installing Playwright…');
  await run('npm', ['install', '--no-audit', '--no-fund', 'playwright-core'], { cwd: dir, shell: process.platform === 'win32' }, onProgress);
  onProgress('Downloading WebKit and Firefox…');
  const cli = path.join(dir, 'node_modules', 'playwright-core', 'cli.js');
  await run(process.execPath, [cli, 'install', ...ENGINES], { cwd: dir, env: env(base) }, onProgress);
  return status(base);
}

const SHOOT = `
const [engine, url, out, width, height, cookies] = process.argv.slice(1);
const pw = require('playwright-core');
(async () => {
  const browser = await pw[engine].launch();
  try {
    const context = await browser.newContext({ viewport: { width: +width, height: +height }, ignoreHTTPSErrors: true });
    const list = JSON.parse(cookies || '[]');
    if (list.length) await context.addCookies(list).catch(() => {});
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.addStyleTag({ content: '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}' }).catch(() => {});
    await page.waitForTimeout(700);
    await page.screenshot({ path: out, type: 'jpeg', quality: 85 });
  } finally { await browser.close(); }
})().catch((e) => { process.stderr.write(String(e && e.message || e)); process.exit(1); });
`;

async function shoot(base, engine, url, { width = 1280, height = 900, cookies = [] } = {}) {
  if (!ENGINES.includes(engine)) throw new Error(`Unknown engine: ${engine}`);
  const out = path.join(home(base), `shot-${engine}-${Date.now()}.jpg`);
  try {
    await run(process.execPath, ['-e', SHOOT, engine, url, out, String(width), String(height), JSON.stringify(cookies)], { cwd: home(base), env: env(base), timeout: 90000 });
    return fs.readFileSync(out);
  } finally { fs.rmSync(out, { force: true }); }
}

module.exports = { ENGINES, status, install, shoot };
