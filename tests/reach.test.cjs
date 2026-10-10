const OUT = process.env.PP_OUT || __dirname;
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http');
const { execFileSync } = require('node:child_process');
const repo = process.cwd();
const NL = String.fromCharCode(10);
const out = [];
const log = (name, ok, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + String(extra).slice(0, 320) : ''}`); fs.writeFileSync(path.join(OUT, 'reach.out'), out.join(NL) + NL); };
const { sleep, started, poll, pollFn } = require(path.join(process.cwd(), 'tests', 'wait.cjs'));
const electron = require('electron');
electron.app.commandLine.appendSwitch('host-resolver-rules', 'MAP shop.example.com 127.0.0.1');

const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-reach-'));
const shell = (title, body, head = '') => `<!doctype html><html lang="en"><head><title>${title}</title><link rel="stylesheet" href="/style.css">${head}</head><body><h1>${title}</h1>${body}</body></html>`;
fs.writeFileSync(path.join(proj, 'index.html'), shell('Home', '<p>Welcome to the shop.</p><button id="go" style="padding:10px 16px" onclick="document.getElementById(\'out\').textContent=\'clicked\'">Go</button><p id="out"></p>'));
fs.writeFileSync(path.join(proj, 'wide.html'), shell('Wide', '<div style="width:900px;height:40px;background:#ddd">A fixed-width strip</div><img src="/missing.png" alt="Product"><button style="width:10px;height:10px;padding:0;border:0"></button><script>console.error("boom on wide"); fetch("/api/nope");</script>'));
fs.writeFileSync(path.join(proj, 'dev.html'), shell('Dev', '<p>Dev markers here.</p>', '<script type="module" src="/@vite/client"></script>'));
fs.writeFileSync(path.join(proj, 'built.html'), shell('Built', '<p>Hashed bundle here.</p>', '<script type="module" src="/assets/index-a1b2c3d4.js"></script>'));
fs.writeFileSync(path.join(proj, 'style.css'), 'body { font-family: system-ui; padding: 24px; margin: 0; background: #fff; }' + NL + 'h1 { color: #111; }' + NL);
fs.writeFileSync(path.join(proj, 'serve.js'), [
  "const http = require('http'), fs = require('fs'), path = require('path');",
  "const i = process.argv.indexOf('--port');",
  'const port = Number(process.argv[i + 1]) || Number(process.env.PORT) || 0;',
  "http.createServer((q, s) => { const f = path.join(__dirname, q.url === '/' ? 'index.html' : q.url.split('?')[0]); if (!fs.existsSync(f)) { s.statusCode = 404; return s.end('no'); } s.end(fs.readFileSync(f)); })",
  "  .listen(port, '127.0.0.1', function () { console.log('http://localhost:' + this.address().port); });",
].join(NL));
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString().trim();
const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-origin-'));
git(bare, 'init', '-q', '--bare');
git(proj, 'init', '-q', '-b', 'main'); git(proj, 'config', 'user.email', 't@t'); git(proj, 'config', 'user.name', 't');
git(proj, 'add', '-A'); git(proj, 'commit', '-q', '-m', 'init'); git(proj, 'remote', 'add', 'origin', bare);

const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-agent-'));
const promptLog = path.join(agentDir, 'prompts.log');
fs.writeFileSync(path.join(agentDir, 'fake-claude.js'), [
  "const fs = require('fs'), path = require('path');",
  "if (process.argv.includes('--version')) { console.log('9.9.9 (stand-in)'); process.exit(0); }",
  "const emit = (o) => process.stdout.write(JSON.stringify(o) + String.fromCharCode(10));",
  "let buf = '';",
  "process.stdin.on('data', (d) => {",
  '  buf += d; let i;',
  '  while ((i = buf.indexOf(String.fromCharCode(10))) >= 0) {',
  '    const line = buf.slice(0, i); buf = buf.slice(i + 1);',
  '    let m; try { m = JSON.parse(line); } catch { continue; }',
  "    if (m.type !== 'user') continue;",
  "    const text = m.message.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ');",
  `    fs.appendFileSync(${JSON.stringify(promptLog)}, JSON.stringify({ text }) + String.fromCharCode(10));`,
  "    emit({ type: 'system', subtype: 'init', session_id: 's1', model: 'stand-in' });",
  "    const css = path.join(process.cwd(), 'style.css');",
  "    fs.writeFileSync(css, fs.readFileSync(css, 'utf8') + 'h1 { letter-spacing: 1px; }' + String.fromCharCode(10));",
  '    setTimeout(() => {',
  "      emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'Adjusted the heading.' }] } });",
  "      emit({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, duration_ms: 300, num_turns: 1 });",
  '    }, 300);',
  '  }',
  '});',
].join(NL));
const fakeBin = path.join(agentDir, process.platform === 'win32' ? 'fake-claude.cmd' : 'fake-claude');
if (process.platform === 'win32') fs.writeFileSync(fakeBin, '@node "%~dp0fake-claude.js" %*\r\n');
else { fs.writeFileSync(fakeBin, `#!/bin/sh\nexec node "${path.join(agentDir, 'fake-claude.js')}" "$@"\n`); fs.chmodSync(fakeBin, 0o755); }

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/nope') { res.statusCode = 500; return res.end('{"error":"nope"}'); }
  if (url === '/@vite/client' || url.startsWith('/assets/')) { res.setHeader('content-type', 'text/javascript'); return res.end(''); }
  const file = path.join(proj, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('no'); }
  res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html');
  res.setHeader('cache-control', 'no-store');
  res.end(fs.readFileSync(file));
});

const get = (url, headers = {}, method = 'GET', body = null) => new Promise((resolve) => {
  const req = http.request(url, { method, headers }, (res) => { let text = ''; res.on('data', (d) => { text += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text })); });
  req.on('error', (err) => resolve({ status: 0, headers: {}, text: String(err.message) }));
  if (body) req.write(body);
  req.end();
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const live = `http://shop.example.com:${port}`;
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ud-'));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ projectDir: proj, url: base + '/', claudePath: fakeBin, agent: 'claude', devCommand: 'node serve.js', autoVerify: false, a11yCheck: false, routeCheck: false, perfCheck: false }));
  process.env.PINPOINT_USER_DATA = ud;
  const { app, webContents, BrowserWindow } = electron;
  require(path.join(repo, 'electron', 'main.cjs'));
  const site = require(path.join(OUT, 'site.cjs'));
  const sweepLib = require(path.join(OUT, 'sweep.cjs'));
  const { flowVerdict } = require(path.join(OUT, 'flow.cjs'));
  const { buildPrompt, buildVerifyPrompt } = require(path.join(repo, 'electron', 'prompt.cjs'));
  const gitx = require(path.join(repo, 'electron', 'git.cjs'));
  const runs = require(path.join(repo, 'electron', 'runs.cjs'));

  app.whenReady().then(async () => {
    const win = await started(electron);
    win.show(); win.focus();
    const host = win.webContents;
    const ui = (code) => host.executeJavaScript(code);
    const until = poll(ui, 300);
    const wait = pollFn(300);
    const guest = () => webContents.getAllWebContents().find((w) => w.getType() === 'webview');
    const chip = () => ui(`(() => { const c = document.querySelector('.site-chip'); return c ? c.className.replace('site-chip', '').trim() + ':' + c.textContent.trim() : ''; })()`);
    const go = async (url, want) => { guest().loadURL(url).catch(() => {}); return until(`(() => { const c = document.querySelector('.site-chip'); return c && c.classList.contains(${JSON.stringify(want)}) && document.querySelector('.urlbar input').value.startsWith(${JSON.stringify(url)}) ? 1 : 0; })()`, 12000); };
    const type = (text) => ui(`(() => { const t = document.querySelector('.composer-box textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const send = async (text) => { await type(text); await sleep(200); await ui(`document.querySelector('.send-btn.primary').click(); 0`); };
    const prompts = () => (fs.existsSync(promptLog) ? fs.readFileSync(promptLog, 'utf8').trim().split(NL).map((l) => JSON.parse(l).text) : []);
    const shot = async (name) => { try { fs.writeFileSync(path.join(OUT, `reach-${name}.png`), (await host.capturePage()).toPNG()); } catch {  } };
    const errors = [];
    host.on('console-message', (e) => { if ((e.level === 'error' || e.level === 3) && !/Security Warning/.test(e.message)) errors.push(e.message.slice(0, 200)); });

    try {
      const k = site.siteKind;
      log('a localhost address is local, whatever is known about its build', k('http://localhost:3000/', null) === 'dev' && k('http://192.168.1.5:8080/x', 'unknown') === 'dev' && k('http://app.test/', 'unknown') === 'dev');
      log('a hashed bundle on localhost is a built copy', k('http://localhost:4173/', 'built') === 'built');
      log('a public address is the live site, unless it is serving a dev build (a tunnel)', k('https://example.com/pricing', 'unknown') === 'live' && k('https://example.com/', 'built') === 'live' && k('https://x.trycloudflare.com/', 'dev') === 'dev');
      log('a file and a blank tab are neither', k('file:///C:/site/index.html', null) === 'file' && k('about:blank', null) === 'none');
      log('the same page on the other side keeps its path and query', site.twinUrl('https://example.com/pricing?plan=pro#faq', 'http://localhost:5173') === 'http://localhost:5173/pricing?plan=pro#faq');

      log('replayed steps that all ran with no errors pass', flowVerdict({ done: 3, total: 3, errors: [], failed: [], before: { errors: 2, failed: 0 } }).ok === true && /2 when you recorded it/.test(flowVerdict({ done: 3, total: 3, errors: [], failed: [], before: { errors: 2, failed: 0 } }).text));
      log('a replay that stops early or still errors does not', flowVerdict({ done: 1, total: 3, errors: [], failed: [] }).ok === false && /step 2 of 3/.test(flowVerdict({ done: 1, total: 3, errors: [], failed: [] }).text) && flowVerdict({ done: 3, total: 3, errors: ['x'], failed: [] }).ok === false);

      const pageFound = { route: '/wide', url: base + '/wide', key: 'wide', shots: [
        { size: 'phone', label: 'Phone', width: 390, issues: [{ type: 'overflow', text: 'The page scrolls sideways: its content is 924px wide in a 390px window', nodes: ['div "A strip"'] }, { type: 'console', text: 'Console error: boom' }] },
        { size: 'tablet', label: 'Tablet', width: 820, issues: [{ type: 'console', text: 'Console error: boom' }] },
        { size: 'desktop', label: 'Desktop', width: 1280, issues: [{ type: 'console', text: 'Console error: boom' }] },
      ] };
      const groups = sweepLib.groupIssues(pageFound);
      log('the same problem at every width is listed once', groups.length === 2 && groups.find((g) => g.issue.type === 'console').everywhere === true && groups.find((g) => g.issue.type === 'overflow').sizes.join() === 'Phone');
      const ask = sweepLib.sweepInstruction([pageFound], () => 'wide.html');
      log('the request written from a sweep names the page, its file, the width and the element', /\/wide \(wide\.html\)/.test(ask) && /- Phone: The page scrolls sideways/.test(ask) && /Look at: div "A strip"/.test(ask) && /- Console error: boom/.test(ask), ask);

      const reqBase = { url: live + '/', title: 'Home', viewport: { width: 1000, height: 700 }, instruction: 'Make the heading bigger', annotations: [] };
      const livePrompt = buildPrompt({ request: { ...reqBase, site: { kind: 'live', local: base + '/' } }, files: {}, projectDir: proj, followUp: false, design: '', memory: [], designSystem: null });
      log('the agent is told when the page is the deployed site, and where the local one is', /DEPLOYED site/.test(livePrompt) && livePrompt.includes(`The same page on their machine is ${base}/`) && /will not show on the page the user has open/.test(livePrompt) && !/dev server is already running with hot reload/.test(livePrompt));
      const localPrompt = buildPrompt({ request: reqBase, files: {}, projectDir: proj, followUp: false, design: '', memory: [], designSystem: null });
      log('and is not told that for a local page', !/DEPLOYED/.test(localPrompt) && /dev server is already running with hot reload/.test(localPrompt));
      const flowPrompt = buildPrompt({ request: { ...reqBase, annotations: [{ n: 1, kind: 'flow', note: 'breaks', steps: [{ type: 'click', selector: '#go' }], seen: { errors: ['TypeError: x is undefined'], failed: ['GET /api/cart (500)'] } }, { n: 2, kind: 'note', note: 'Too busy (comment from Sam)', viewport: { width: 390, height: 800 } }, { n: 3, kind: 'element', note: 'bigger (comment from Sam)', viewport: { width: 390, height: 800 }, element: { uid: '', selector: 'h1', tag: 'h1', text: 'Home', rect: { x: 0, y: 0, width: 100, height: 40 } } }] }, files: {}, projectDir: proj, followUp: false, design: '', memory: [], designSystem: null });
      log('recorded steps carry the errors seen while recording', /Console errors while the user did this/.test(flowPrompt) && /TypeError: x is undefined/.test(flowPrompt) && /GET \/api\/cart \(500\)/.test(flowPrompt) && /replays these exact steps/.test(flowPrompt));
      log('review comments reach the agent as a page comment or a reviewer-picked element', /Comment about the page as a whole: Too busy/.test(flowPrompt) && /picked by a reviewer in their own browser, 390px wide/.test(flowPrompt));
      const checkPrompt = buildVerifyPrompt({ request: { url: base + '/', annotations: [], verify: { afterFile: 'after.jpg', flow: { done: 1, total: 3, errors: ['boom'], failed: [] } } } });
      log('the result check is told how the replay went', /stopped at step 2 of 3/.test(checkPrompt) && /Console error during the replay: boom/.test(checkPrompt));

      const body = gitx.withShots('## What changed\n\n- x\n\n---\nMade with Pinpoint.', [{ label: 'Bigger heading', before: 'https://b', after: 'https://a' }]);
      log('screenshots go into the PR description above the footer', /## Before and after[\s\S]*\| !\[Before\]\(https:\/\/b\) \| !\[After\]\(https:\/\/a\) \|[\s\S]*\n---\nMade with Pinpoint\.$/.test(body), body);
      log('the GitHub repository is read from either kind of remote', gitx.repoSlug('git@github.com:acme/site.git') === 'acme/site' && gitx.repoSlug('https://github.com/acme/site') === 'acme/site' && gitx.repoSlug('https://gitlab.com/acme/site.git') === null);
      const pic = path.join(agentDir, 'pic.jpg');
      fs.writeFileSync(pic, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      const statusBefore = git(proj, 'status', '--porcelain');
      const pushed = await gitx.pushShots(proj, 'https://github.com/acme/site.git', 'pinpoint/bigger-heading-ab12', [{ id: 'run1', label: 'Bigger', before: pic, after: pic }]).catch((e) => e.message);
      const again = await gitx.pushShots(proj, 'https://github.com/acme/site.git', 'pinpoint/bigger-heading-ab12', [{ id: 'run2', label: 'Again', before: pic, after: pic }]).catch((e) => e.message);
      const files = git(bare, 'ls-tree', '-r', '--name-only', 'pinpoint-shots').split(NL);
      log('screenshots are pushed to their own branch without touching your files or index', Array.isArray(pushed) && /^https:\/\/github\.com\/acme\/site\/blob\/[0-9a-f]{40}\/.+run1-before\.jpg\?raw=true$/.test(pushed[0].before) && git(proj, 'status', '--porcelain') === statusBefore && git(proj, 'branch', '--list', 'pinpoint-shots') === '', JSON.stringify(pushed).slice(0, 200));
      log('a later push keeps the earlier screenshots', Array.isArray(again) && files.length === 4 && files.some((f) => f.endsWith('run1-after.jpg')) && files.some((f) => f.endsWith('run2-before.jpg')), files.join(', '));

      log('a plain local server counts as local', (await until(`document.querySelector('.site-chip.dev') ? 1 : 0`, 10000)) === 1, await chip());
      log('a page with a hashed bundle counts as a built copy', (await go(base + '/built.html', 'built')) === 1, await chip());
      log('a page with dev-server markers counts as local', (await go(base + '/dev.html', 'dev')) === 1, await chip());
      log('a public address counts as live', (await go(live + '/', 'live')) === 1, await chip());
      await ui(`document.querySelector('.site-chip').click(); 0`);
      const pop = await until(`document.querySelector('.site-pop')?.innerText.replace(/\\s+/g, ' ') || ''`, 3000);
      log('the chip explains what live means and offers the local page', /The deployed site/.test(pop || '') && /Open this page locally/.test(pop || ''), pop);
      await shot('1-live');

      const beforeLive = prompts().length;
      await ui(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); 0`);
      await send('Make the heading bigger');
      const unseen = await until(`document.querySelector('.done-card .no-visual.unseen')?.innerText.replace(/\\s+/g, ' ') || ''`, 30000);
      log("a change made while on the live site says it can't be seen there yet", /you're on the live site/.test(unseen || '') && /See it locally/.test(unseen || ''), unseen);
      const told = prompts().slice(beforeLive).join(' ');
      log('and the agent was told it is the deployed site', /DEPLOYED site/.test(told) && told.includes(base + '/'), told.slice(0, 200));
      log('no "nothing visibly changed" warning is shown for it', (await ui(`document.querySelectorAll('.done-card .no-visual:not(.unseen), .done-card .no-visual-tag').length`)) === 0);
      await ui(`document.querySelector('.done-card .no-visual.unseen .link-btn').click(); 0`);
      log('"See it locally" opens the same page on the local server', (await until(`document.querySelector('.urlbar input').value === ${JSON.stringify(base + '/')} && document.querySelector('.site-chip.dev') ? 1 : 0`, 12000)) === 1, await ui(`document.querySelector('.urlbar input').value`));
      await sleep(1200);

      let recorded = 0;
      for (let attempt = 0; attempt < 3 && !recorded; attempt++) {
        await ui(`[...document.querySelectorAll('.mode-seg button')].find((b) => /Record/.test(b.textContent)).click(); 0`);
        await sleep(600);
        guest().focus();
        const p = await guest().executeJavaScript(`(() => { const r = document.getElementById('go').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
        for (const t of ['mouseMove', 'mouseDown', 'mouseUp']) guest().sendInputEvent({ type: t, x: p.x, y: p.y, button: 'left', clickCount: 1 });
        await sleep(1200);
        recorded = await ui(`(() => { const t = document.querySelector('.frozen-tag.rec'); return t && /1 step/.test(t.textContent) ? 1 : 0; })()`);
        await ui(`[...document.querySelectorAll('.mode-seg button')].find((b) => /Stop/.test(b.textContent))?.click(); 0`);
        await sleep(500);
      }
      const flowAnn = await ui(`[...document.querySelectorAll('.ann-title')].map((t) => t.innerText.replace(/\\s+/g, ' ')).find((t) => /Recorded interaction/.test(t)) || ''`);
      log('a click is recorded as a step', recorded === 1 && /1 step/.test(flowAnn), flowAnn);
      const cardsBefore = await ui(`document.querySelectorAll('.done-card').length`);
      await send('The button does nothing useful, fix it');
      await until(`document.querySelectorAll('.done-card').length > ${cardsBefore} ? 1 : 0`, 30000);
      const proof = await until(`document.querySelector('.done-card .flow-check')?.innerText.replace(/\\s+/g, ' ') || ''`, 40000);
      log('after the run the steps are replayed and the result is shown on the card', /Replayed your 1 step: all ran, no errors/.test(proof || ''), proof);
      log('the replay really clicked the button', (await guest().executeJavaScript(`document.getElementById('out').textContent`)) === 'clicked');
      await shot('2-flow');

      await ui(`[...document.querySelectorAll('.vp-toggles button')].find((b) => /Check every page/.test(b.title)).click(); 0`);
      const plan = await until(`[...document.querySelectorAll('.sweep-plan li')].map((l) => l.textContent).join(' ')`, 5000);
      log('the sweep lists the pages it will check', /\/wide\.html/.test(plan || '') && /\/built\.html/.test(plan || ''), plan);
      await ui(`[...document.querySelectorAll('.sweep .diff-head button')].find((b) => b.textContent.trim() === 'Start').click(); 0`);
      const summary = await until(`(() => { const h = document.querySelector('.sweep .diff-head .hint')?.textContent || ''; return /problem/.test(h) ? h : ''; })()`, 150000);
      const widePage = await ui(`[...document.querySelectorAll('.sweep-page')].find((s) => s.querySelector('header b').textContent === '/wide.html')?.innerText.replace(/\\s+/g, ' ') || ''`);
      log('the sweep finishes and counts what it found', /problems? on 1 of 4 pages/.test(summary || ''), summary);
      log('it finds the sideways scroll at the narrow widths only', /Phone · Tablet\s*The page scrolls sideways: its content is 9\d\dpx wide in a 390px window|Phone\s*The page scrolls sideways/.test(widePage) && !/Desktop[^A-Z]*The page scrolls sideways/.test(widePage), widePage.slice(0, 400));
      log('and the broken image, console error, failed request and tiny button', /1 image didn't load/.test(widePage) && /Console error: boom on wide/.test(widePage) && /Request failed: 500 \/api\/nope/.test(widePage) && /smaller than 24px/.test(widePage), widePage.slice(0, 600));
      const clean = await ui(`[...document.querySelectorAll('.sweep-page')].find((s) => s.querySelector('header b').textContent === '/')?.innerText.replace(/\\s+/g, ' ') || ''`);
      log('a page with nothing wrong says so', /Nothing found/.test(clean), clean);
      log('every page has a picture at each width', (await ui(`document.querySelectorAll('.sweep-shots img').length`)) === 12);
      await shot('3-sweep');
      await ui(`[...document.querySelectorAll('.sweep .diff-head button')].find((b) => /Fix all/.test(b.textContent)).click(); 0`);
      const drafted = await until(`(() => { const v = document.querySelector('.composer-box textarea').value; return /scrolls sideways/.test(v) ? v : ''; })()`, 8000);
      const refs = await until(`[...document.querySelectorAll('.ann-title')].filter((t) => /Reference image/.test(t.innerText)).length`, 8000);
      log('"Fix all" drafts the request and attaches the worst screenshots', /\/wide\.html \(wide\.html\)/.test(drafted || '') && refs >= 1, `${refs} screenshot(s) · ${String(drafted).slice(0, 160)}`);
      await ui(`[...document.querySelectorAll('.ann-x')].forEach((b) => b.click()); 0`);
      await type('');

      const state = await ui(`window.pinpoint.reviewStart(${JSON.stringify(base + '/')})`);
      const link = state.urls.find((u) => /\/\/localhost:/.test(u));
      const origin = `http://localhost:${state.port}`;
      const denied = await get(origin + '/');
      const token = new URL(link).searchParams.get('pp');
      const opened = await get(link);
      const cookie = String(opened.headers['set-cookie'] || '').split(';')[0];
      const page = await get(origin + '/', { cookie });
      const script = await get(origin + '/__pinpoint_review/client.js', { cookie });
      log('a review link is refused without its key and opens with it', denied.status === 403 && opened.status === 302 && cookie === `pp_review=${token}` && page.status === 200, `${denied.status} ${opened.status} ${page.status}`);
      log('the shared page is your site with the comment button added', /<h1>Home<\/h1>/.test(page.text) && page.text.includes('/__pinpoint_review/client.js') && /Leave a comment/.test(script.text));
      const css = await get(origin + '/style.css', { cookie });
      log('the rest of the site comes through unchanged', css.status === 200 && /font-family/.test(css.text));
      const bad = await get(origin + '/__pinpoint_review/comment', { 'content-type': 'application/json' }, 'POST', JSON.stringify({ text: 'sneaky' }));
      log('comments are refused without the key', bad.status === 403);

      const reviewer = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { partition: 'reviewer' } });
      await reviewer.loadURL(link);
      const rv = (code) => reviewer.webContents.executeJavaScript(code);
      const ready = await wait(() => rv(`!!document.getElementById('pinpoint-review')?.shadowRoot.querySelector('.pill')`), 8000);
      await rv(`document.getElementById('pinpoint-review').shadowRoot.querySelector('.pill').click(); 0`);
      await rv(`document.querySelector('h1').click(); 0`);
      await rv(`(() => { const r = document.getElementById('pinpoint-review').shadowRoot; r.querySelector('textarea').value = 'Make this heading friendlier'; r.querySelector('input').value = 'Sam'; r.querySelector('.send').click(); })()`);
      const sentNote = await wait(() => rv(`document.getElementById('pinpoint-review').shadowRoot.querySelector('.pill small').textContent`), 8000);
      reviewer.destroy();
      log('a reviewer can click an element in their browser and send a comment', ready === true && sentNote === '1 sent', String(sentNote));
      const badge = await until(`document.querySelector('.attach-btn b')?.textContent || ''`, 8000);
      log('the comment arrives in Pinpoint', badge === '1', badge);
      await ui(`document.querySelector('.attach-btn[title*="review comment"]').click(); 0`);
      await sleep(300);
      await ui(`[...document.querySelectorAll('.handoff-pop button')].find((b) => /Get comments/.test(b.textContent)).click(); 0`);
      const inbox = await until(`document.querySelector('.review-inbox article')?.innerText.replace(/\\s+/g, ' ') || ''`, 5000);
      log('the inbox shows who said what about which element', /Sam/.test(inbox || '') && /Make this heading friendlier/.test(inbox || '') && /<h1>/.test(inbox || ''), inbox);
      await shot('4-review');
      await ui(`[...document.querySelectorAll('.review-actions button')].find((b) => /Add to the request/.test(b.textContent)).click(); 0`);
      const note = await until(`[...document.querySelectorAll('.ann-list textarea')].map((t) => t.value).find((v) => /friendlier/.test(v)) || ''`, 5000);
      log('adding it turns the comment into an annotation on that element', /Make this heading friendlier \(comment from Sam\)/.test(note || '') && /<h1>/.test(await ui(`document.querySelector('.ann-title').innerText`)), note);
      await ui(`window.pinpoint.reviewStop()`);
      log('stopping the share closes the link', (await get(origin + '/', { cookie })).status === 0);
      await ui(`[...document.querySelectorAll('.ann-x')].forEach((b) => b.click()); 0`);

      const cssFile = path.join(proj, 'style.css');
      const baseCss = fs.readFileSync(cssFile);
      for (const [id, color] of [['v1', '#cc0000'], ['v2', '#0000cc']]) {
        fs.writeFileSync(cssFile, baseCss.toString() + `h1 { color: ${color}; }` + NL);
        runs.save(proj, id, { root: proj, files: new Map([['style.css', { content: baseCss }]]) }, [{ path: 'style.css', kind: 'modify' }], { request: { instruction: id, annotations: [] }, agent: 'test' });
        fs.writeFileSync(cssFile, baseCss);
      }
      const views = await ui(`window.pinpoint.variantsLive({ runIds: ['v1', 'v2'], page: '/style.css' })`).catch((e) => String(e.message));
      const served = Array.isArray(views) ? await Promise.all(views.map((v) => (v.url ? get(v.url) : { text: '' }))) : [];
      log('each variant runs live in its own copy of the project', Array.isArray(views) && views.length === 2 && /#cc0000/.test(served[0].text) && !/#0000cc/.test(served[0].text) && /#0000cc/.test(served[1].text) && !/#cc0000/.test(served[1].text), JSON.stringify(views).slice(0, 200));
      log('your own files stay as they were while the variants run', fs.readFileSync(cssFile).equals(baseCss));
      await ui(`window.pinpoint.variantsClose()`);
      log('closing the view removes the copies', git(proj, 'worktree', 'list').split(NL).length === 1, git(proj, 'worktree', 'list'));

      log('no errors in the app console', errors.length === 0, errors.join(' | '));
    } catch (e) { log('exception', false, e.stack); }
    fs.appendFileSync(path.join(OUT, 'reach.out'), '[done]' + NL);
    app.exit(0);
  });
});
