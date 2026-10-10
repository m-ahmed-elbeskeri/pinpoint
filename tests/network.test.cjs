const OUT = process.env.PP_OUT || __dirname;
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const repo = process.cwd();
const NL = String.fromCharCode(10);
const out = [];
const log = (name, ok, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + String(extra).slice(0, 300) : ''}`); fs.writeFileSync(path.join(OUT, 'network.out'), out.join(NL) + NL); };
const { sleep, started, poll } = require(path.join(process.cwd(), 'tests', 'wait.cjs'));

const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-net-'));
fs.mkdirSync(path.join(proj, 'server'), { recursive: true });
fs.mkdirSync(path.join(proj, 'logs'), { recursive: true });
fs.writeFileSync(path.join(proj, 'logs', 'server.log'), 'booted' + NL);
fs.writeFileSync(path.join(proj, 'server', 'index.js'), [
  "const express = require('express');",
  'const app = express();',
  "app.get('/api/users', (req, res) => res.json({ users: ['Ada'] }));",
  "app.get('/api/orders/:id', (req, res) => res.status(500).json({ error: 'out of stock' }));",
  "app.post('/api/login', (req, res) => res.json({ ok: true }));",
  'app.listen(3000);',
].join(NL));

const PAGE = `<!doctype html><html lang="en"><head><title>Shop</title></head><body><h1>Shop</h1><p id="users">loading</p><p id="order">loading</p>
<script>
fetch('/api/users').then((r) => r.json()).then((d) => { document.getElementById('users').textContent = d.users.join(','); });
fetch('/api/orders/7').then((r) => r.json()).then((d) => { document.getElementById('order').textContent = d.error || 'fine'; });
const x = new XMLHttpRequest(); x.open('POST', '/api/login'); x.setRequestHeader('content-type', 'application/json'); x.send(JSON.stringify({ name: 'ada' }));
</script></body></html>`;
let orderHits = 0;
const server = http.createServer((req, res) => {
  const json = (code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
  if (req.url === '/api/users') return json(200, { users: ['Ada'] });
  if (req.url.startsWith('/api/orders/')) { orderHits++; return json(500, { error: 'out of stock' }); }
  if (req.url === '/api/login') return json(200, { ok: true });
  res.setHeader('content-type', 'text/html'); res.setHeader('cache-control', 'no-store'); res.end(PAGE);
});

server.listen(0, '127.0.0.1', () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ud-'));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ projectDir: proj, url: base + '/', a11yCheck: false, routeCheck: false, perfCheck: false, serverLog: 'logs/server.log' }));
  process.env.PINPOINT_USER_DATA = ud;
  const { app, webContents } = require('electron');
  require(path.join(repo, 'electron', 'main.cjs'));
  const apiroutes = require(path.join(repo, 'electron', 'apiroutes.cjs'));
  const { buildPrompt, buildVerifyPrompt } = require(path.join(repo, 'electron', 'prompt.cjs'));

  app.whenReady().then(async () => {
    const win = await started(require('electron'));
    win.show(); win.focus();
    const host = win.webContents;
    const ui = (code) => host.executeJavaScript(code);
    const until = poll(ui, 300);
    const guest = () => webContents.getAllWebContents().find((w) => w.getType() === 'webview');
    const rows = () => ui(`[...document.querySelectorAll('.net-row')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`);
    const clickRow = (text) => ui(`[...document.querySelectorAll('.net-row')].filter((r) => r.innerText.includes(${JSON.stringify(text)})).pop().click(); 0`);
    const clickBtn = (scope, text) => ui(`[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find((b) => b.textContent.includes(${JSON.stringify(text)})).click(); 0`);
    const errors = [];
    host.on('console-message', (e) => { if ((e.level === 'error' || e.level === 3) && !/Security Warning/.test(e.message)) errors.push(e.message.slice(0, 200)); });

    try {
      await ui(`[...document.querySelectorAll('.top-right .icon-btn')].find((b) => /Terminal/.test(b.title)).click(); 0`);
      await until(`document.querySelector('.drawer .tabs') ? 1 : 0`, 8000);
      await clickBtn('.drawer .tabs', 'Network');
      const listed = await until(`document.querySelectorAll('.net-row').length >= 3 ? 1 : 0`, 10000);
      const first = await rows();
      log('the page\'s API calls are listed, fetch and XHR alike', listed === 1 && first.some((r) => /200 GET \/api\/users/.test(r)) && first.some((r) => /500 GET \/api\/orders\/7/.test(r)) && first.some((r) => /200 POST \/api\/login/.test(r)), first.join(' | '));
      log('failed requests are counted on the tab', (await ui(`document.querySelector('.drawer .tab-count')?.textContent || ''`)) === '1');

      await clickRow('/api/orders/7');
      const detail = await until(`/out of stock/.test(document.querySelector('.net-detail')?.innerText || '') && /server\\/index\\.js:4/.test(document.querySelector('.net-handler')?.innerText || '') ? document.querySelector('.net-detail').innerText.replace(/\\s+/g, ' ') : ''`, 10000);
      log('a failed request shows what the server answered and the file that handles it', !!detail, detail || await ui(`document.querySelector('.net-detail')?.innerText.replace(/\\s+/g, ' ') || ''`));

      await clickRow('/api/login');
      const sent = await until(`/"name": "ada"/.test(document.querySelector('.net-detail')?.innerText || '') ? 1 : 0`, 5000);
      log('the body an XHR sent is shown', sent === 1);

      await clickRow('/api/orders/7');
      await sleep(200);
      await clickBtn('.net-actions', 'Add to request');
      const ann = await until(`[...document.querySelectorAll('.ann-title')].map((t) => t.innerText.replace(/\\s+/g, ' ')).find((t) => /GET \\/api\\/orders\\/7/.test(t)) || ''`, 5000);
      log('a request can be attached to the next message', /500/.test(ann || '') && /index\.js:4/.test(ann || ''), ann);

      const before = orderHits;
      await clickBtn('.net-actions', 'Send again');
      const again = await until(`document.querySelectorAll('.net-row').length >= 4 ? 1 : 0`, 8000);
      log('send again re-issues the request from the page', again === 1 && orderHits === before + 1, `server saw ${orderHits - before} more`);

      await clickRow('/api/users');
      await sleep(200);
      await clickBtn('.net-actions', 'Mock response');
      await until(`document.querySelector('.net-form textarea') ? 1 : 0`, 4000);
      await ui(`(() => { const t = document.querySelector('.net-form textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, '{"users":["Mocked"]}'); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await clickBtn('.net-form', 'Save mock');
      await until(`document.querySelector('.net-mock.on') ? 1 : 0`, 4000);
      await sleep(600);
      guest().reload();
      const mocked = await poll((c) => guest().executeJavaScript(c), 300)(`document.getElementById('users').textContent === 'Mocked' ? 1 : 0`, 10000);
      log('a mocked endpoint answers the page with your JSON', mocked === 1, await guest().executeJavaScript(`document.getElementById('users').textContent`));
      log('and the row says it was a mock', (await until(`[...document.querySelectorAll('.net-row')].some((r) => r.querySelector('.net-tag') && r.innerText.includes('/api/users')) ? 1 : 0`, 5000)) === 1);
      await ui(`document.querySelector('.net-mock button').click(); 0`);
      await until(`document.querySelector('.net-mock.on') ? 0 : 1`, 4000);
      await sleep(600);
      guest().reload();
      const real = await poll((c) => guest().executeJavaScript(c), 300)(`document.getElementById('users').textContent === 'Ada' ? 1 : 0`, 10000);
      log('switching the mock off brings the real answer back', real === 1);
      try { fs.writeFileSync(path.join(OUT, 'network.png'), (await host.capturePage()).toPNG()); } catch {}

      const mark = await ui(`window.pinpoint.serverLogMark()`);
      fs.appendFileSync(path.join(proj, 'logs', 'server.log'), 'TypeError: stock is undefined' + NL);
      const since = await ui(`window.pinpoint.serverLogSince(${mark})`);
      log('server output written during a run is read back, and only that', /stock is undefined/.test(since) && !/booted/.test(since), since);

      const found = await apiroutes.find(proj, base + '/api/orders/7', 'GET');
      const request = { url: base + '/', title: 'Shop', viewport: { width: 1000, height: 700 }, instruction: 'Fix it', annotations: [{ n: 1, kind: 'request', note: 'should return the order', request: { method: 'GET', url: base + '/api/orders/7', status: 500, ms: 4, resBody: '{"error":"out of stock"}', handler: found } }], diagnostics: { console: [], network: [{ url: base + '/api/orders/7', method: 'GET', status: 500, at: 1, body: '{"error":"out of stock"}', handler: 'server/index.js:4' }], devLog: '', serverLog: 'TypeError: stock is undefined' } };
      const prompt = buildPrompt({ request, files: {}, projectDir: proj, followUp: false, design: '', memory: [], designSystem: null });
      log('the agent is told the request, its answer and its handler', /API request the page made: should return the order/.test(prompt) && /Handled by: server\/index\.js:4/.test(prompt) && /out of stock/.test(prompt) && /handled by server\/index\.js:4/.test(prompt) && /stock is undefined/.test(prompt));
      const check = buildVerifyPrompt({ request: { url: base + '/', annotations: [], verify: { afterFile: 'after.jpg', requests: [{ method: 'GET', url: base + '/api/orders/7', before: { status: 500 }, after: { status: 200, body: '{"id":7}' } }] } } });
      log('the result check is shown the request sent again', /sent again after your changes/.test(check) && /before 500, now 200/.test(check) && /"id":7/.test(check));

      log('no errors in the app console', errors.length === 0, errors.join(' | '));
    } catch (e) { log('exception', false, e.stack); }
    fs.appendFileSync(path.join(OUT, 'network.out'), '[done]' + NL);
    app.exit(0);
  });
});
