// CI mode end to end, from plain node: serve a small site, capture, change it, capture, compare.
const OUT = process.env.PP_OUT || __dirname;         // where results, screenshots and built helpers go
const FIX = process.env.PP_FIXTURES || __dirname;    // real projects some suites run against
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http');
const { execFile } = require('node:child_process');
const repo = process.cwd();
const electron = path.join(repo, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
let pass = 0, failed = 0;
const check = (name, ok, extra = '') => { if (ok) pass++; else failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + String(extra).slice(0, 400)}`); };

const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ci-site-'));
const page = (t, extra = '') => `<!doctype html><html lang="en"><head><title>${t}</title><link rel="stylesheet" href="/style.css"></head><body>${extra}<h1>${t}</h1><p>Text on the ${t} page.</p></body></html>`;
fs.writeFileSync(path.join(proj, 'index.html'), page('Home'));
fs.writeFileSync(path.join(proj, 'about.html'), page('About'));
fs.writeFileSync(path.join(proj, 'style.css'), 'body { font-family: system-ui; padding: 40px; background: #fff; }\n');
const server = http.createServer((req, res) => {
  const file = path.join(proj, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('no'); }
  res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/html');
  res.setHeader('cache-control', 'no-store');
  res.end(fs.readFileSync(file));
});
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = (args) => new Promise((resolve) => execFile(electron, [repo, '--ci', ...args], { cwd: repo, env, timeout: 150000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: String(stdout) + String(stderr) })));

server.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ci-'));
  const before = path.join(dir, 'before'), after = path.join(dir, 'after'), report = path.join(dir, 'report.md');
  const b = await run(['capture', '--url=' + base, '--project=' + proj, '--out=' + before]);
  check('capture writes a screenshot and manifest per page', b.code === 0 && fs.existsSync(path.join(before, 'manifest.json')) && fs.existsSync(path.join(before, 'home.jpg')) && fs.existsSync(path.join(before, 'about-html.jpg')), `exit ${b.code}: ${b.out.slice(-400)}`);
  fs.appendFileSync(path.join(proj, 'style.css'), 'p { font-size: 30px; }\n');
  fs.writeFileSync(path.join(proj, 'about.html'), page('About', '<img src="/x.png" width="10" height="10">'));
  const a = await run(['capture', '--url=' + base, '--project=' + proj, '--out=' + after]);
  const c = await run(['compare', '--before=' + before, '--after=' + after, '--url=' + base, '--report=' + report, '--fail-on=changes']);
  const md = fs.existsSync(report) ? fs.readFileSync(report, 'utf8') : '';
  check('compare lists the changed pages and names what changed', a.code === 0 && /2 of 2 pages look different/.test(md) && /<p>/.test(md), `${c.out.slice(-300)} ${md}`);
  check('compare reports accessibility problems that are new', /1 new accessibility problem/.test(md) && /alt/i.test(md), md);
  check('exits 1 when told to fail on changes', c.code === 1, `exit ${c.code}`);
  const none = await run(['compare', '--before=' + after, '--after=' + after, '--fail-on=any']);
  check('exits 0 when nothing changed', none.code === 0 && /All 2 pages look the same/.test(none.out), `exit ${none.code}: ${none.out.slice(-300)}`);
  const usage = await run(['nope']);
  check('unknown command explains itself', usage.code === 2 && /Usage/.test(usage.out), `exit ${usage.code}`);
  console.log(`${pass} pass, ${failed} fail`);
  server.close();
  process.exit(failed ? 1 : 0);
});
