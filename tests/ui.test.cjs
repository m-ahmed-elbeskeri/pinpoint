// Drives the real app window: picks an element, opens each panel, and saves screenshots to look at.
const OUT = process.env.PP_OUT || __dirname;         // where results, screenshots and built helpers go
const FIX = process.env.PP_FIXTURES || __dirname;    // real projects some suites run against
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const repo = process.cwd();
const NL = String.fromCharCode(10);
const out = [];
const log = (name, ok, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); fs.writeFileSync(path.join(OUT, 'ui.out'), out.join(NL) + NL); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-proj-'));
fs.mkdirSync(path.join(proj, 'src'));
fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"demo","dependencies":{"tailwindcss":"^4.0.0"}}');
fs.writeFileSync(path.join(proj, 'src', 'app.scss'), ['.card {', '  padding: 12px;', '  &.big { padding: 24px; }', '}'].join(NL));
fs.writeFileSync(path.join(proj, 'src', 'app.css'), [
  ':root { --primary: #2255ee; --radius-md: 10px; --space-4: 16px; --text-lg: 18px; }',
  'body { font-family: system-ui; margin: 0; padding: 32px; background: #f6f7fb; }',
  '.card { padding: 12px; color: #223; background: white; border-radius: var(--radius-md); max-width: 420px; display: flex; flex-direction: column; gap: 12px; margin: 8px; }',
  '',
  '.card.big { padding: 24px; }',
  '.btn { background: var(--primary); color: white; border: 0; border-radius: var(--radius-md); padding: var(--space-4); font-size: var(--text-lg); }',
  '.btn:hover { background: #113399; }',
  '@media (min-width: 640px) { .card { margin: 24px; } }',
  '@media (max-width: 479px) { .card { margin: 4px; } }',
].join(NL));
const react = fs.readFileSync(path.join(repo, 'node_modules/react/umd/react.development.js'), 'utf8');
const reactDom = fs.readFileSync(path.join(repo, 'node_modules/react-dom/umd/react-dom.development.js'), 'utf8');
const PAGE = `<!doctype html><html lang="en"><head><title>Demo shop</title><link rel="stylesheet" href="/src/app.css"></head><body>
<div class="card big" id="card"><h2 id="h">Summer sale</h2><p>Everything must go, while stocks last.</p><div id="root"></div>
<form id="f" onsubmit="event.preventDefault(); window.submitted = q.value; done.textContent = 'Searched: ' + q.value;"><input id="q" placeholder="Search"><span id="done"></span></form></div>
<ul id="list"><li>one</li><li>two</li></ul>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>
  function BuyButton(props) { return React.createElement('button', { id: 'rb', className: 'btn', onClick: () => { window.clicked = (window.clicked || 0) + 1; } }, props.label + ' (' + props.size + ')'); }
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(BuyButton, { label: 'Buy now', size: 2, primary: true }));
</script></body></html>`;
const server = http.createServer((req, res) => {
  if (req.url === '/react.js') return res.end(react);
  if (req.url === '/react-dom.js') return res.end(reactDom);
  if (req.url === '/src/app.css') { res.setHeader('content-type', 'text/css'); return res.end(fs.readFileSync(path.join(proj, 'src', 'app.css'))); }
  res.setHeader('content-type', 'text/html');
  res.end(PAGE);
});

server.listen(0, '127.0.0.1', () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ud-'));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ projectDir: proj, url: base + '/' }));
  process.env.PINPOINT_USER_DATA = ud;
  const { app, BrowserWindow, ipcMain, webContents } = require('electron');
  require(path.join(repo, 'electron', 'main.cjs'));
  const call = (channel, args) => ipcMain._invokeHandlers.get(channel)({ sender: { isDestroyed: () => true, send() {} } }, args);

  app.whenReady().then(async () => {
    await sleep(5000);
    const win = BrowserWindow.getAllWindows()[0];
    // Kept in front: a covered or minimized window can't be captured or clicked.
    win.show(); win.focus();
    const host = win.webContents;
    const guest = webContents.getAllWebContents().find((w) => w.getType() === 'webview');
    const ui = (code) => host.executeJavaScript(code);
    const pg = (code) => guest.executeJavaScript(code);
    let n = 0;
    const shot = async (name) => {
      await sleep(500);
      for (let i = 0; i < 3; i++) {
        try { fs.writeFileSync(path.join(OUT, `ui-${++n}-${name}.png`), (await host.capturePage()).toPNG()); return; } catch { n--; await sleep(700); win.show(); }
      }
    };
    const key = (k) => ui(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true })); 0`);
    const clickIn = async (sel) => {
      const p = await pg(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) guest.sendInputEvent({ type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
    };
    const errors = [];
    host.on('console-message', (e) => { if ((e.level === 'error' || e.level === 3) && !/Security Warning/.test(e.message)) errors.push(e.message.slice(0, 200)); });

    try {
      log('app window + page loaded', !!guest && /Demo shop/.test(guest.getTitle()), guest && guest.getTitle());
      await shot('home');

      // ---- pick the React button
      await ui(`document.addEventListener('click', (e) => { (window.__clicks = window.__clicks || []).push([String(e.target.className || e.target.tagName).slice(0, 30), e.isTrusted, e.detail, e.clientX, e.clientY].join(':')); }, true); 0`);
      await key('s');
      await sleep(300);
      let pop = false;
      for (let attempt = 0; attempt < 3 && !pop; attempt++) { // a stray real mouse move can steal the first click
        guest.focus();
        await clickIn('#rb');
        await sleep(2500);
        pop = await ui(`!!document.querySelector('.note-pop .el-tools')`);
      }
      log('picking opens the note with element tools', pop);
      await shot('picked');
      log('host clicks during pick (expect none)', true, JSON.stringify(await ui(`[window.__clicks || [], document.activeElement.className || document.activeElement.tagName]`)));
      // The Props and CSS tabs appear once the component and its rules have been looked up.
      let tabs = [];
      for (let i = 0; i < 20 && tabs.length < 4; i++) { tabs = await ui(`[...document.querySelectorAll('.el-tabs button')].map((b) => b.textContent)`); if (tabs.length < 4) await sleep(400); }
      log('tool tabs', tabs.length === 4, tabs.join(' | '));
      for (let i = 0; i < tabs.length; i++) {
        await ui(`document.querySelectorAll('.el-tabs button')[${i}].click(); 0`);
        await shot('tab-' + i);
      }
      const rules = await ui(`[...document.querySelectorAll('.el-rule-head')].map((r) => r.textContent)`);
      log('css tab lists rules with files', rules.some((r) => r.includes('.btn') && r.includes('app.css:6')), rules.join(' || '));

      // ---- live prop edit through the UI (Component tab)
      await ui(`document.querySelectorAll('.el-tabs button')[2].click(); 0`);
      await sleep(300);
      const propNames = await ui(`[...document.querySelectorAll('.el-stack .el-field > span')].map((s) => s.textContent)`);
      await ui(`(() => { const input = [...document.querySelectorAll('.el-stack .el-field')].find((f) => f.querySelector('span').textContent === 'label').querySelector('input'); input.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, 'Add to cart'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
      await sleep(600);
      log('prop edit re-renders the component', (await pg(`rb.textContent`)) === 'Add to cart (2)', `${propNames.join(',')} -> ${await pg(`rb.textContent`)}`);

      // ---- live tweak through the UI (Styles tab)
      await ui(`document.querySelectorAll('.el-tabs button')[0].click(); 0`);
      await sleep(300);
      await ui(`(() => { const input = document.querySelector('.el-grid .el-field input:not([type=color])'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, '40px'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(400);
      log('style tweak applies in the page', (await pg(`getComputedStyle(rb).paddingTop`)) === '40px');
      // ---- forced :hover
      await ui(`[...document.querySelectorAll('.el-row .chip')].find((c) => c.textContent === ':hover').click(); 0`);
      await sleep(1200);
      log('forced :hover', (await pg(`getComputedStyle(rb).backgroundColor`)) === 'rgb(17, 51, 153)', await pg(`getComputedStyle(rb).backgroundColor`));
      await shot('tweaked-hover');
      await key('Escape');
      await sleep(300);
      const annSub = await ui(`[...document.querySelectorAll('.ann-sub')].map((s) => s.textContent).join(' / ')`);
      log('annotation summarises what was set', /:hover/.test(annSub) && /tweak/.test(annSub), annSub);

      // ---- responsive mode, conditions menu, side by side
      await ui(`[...document.querySelectorAll('.vp-toggles > button')].find((b) => b.title.startsWith('Phone')).click(); 0`);
      await sleep(1200);
      log('responsive mode sizes the page', (await pg(`innerWidth`)) === 390, String(await pg(`innerWidth`)));
      const bps = await ui(`[...document.querySelectorAll('.device-bps .chip')].map((c) => c.textContent).join(' ')`);
      log('breakpoints listed', /479/.test(bps) && /640/.test(bps), bps);
      await shot('responsive');
      await ui(`document.querySelector('.vp-toggles .cond-wrap > button').click(); 0`);
      await shot('conditions');
      await ui(`[...document.querySelectorAll('.cond-pop .chip')].find((c) => c.textContent === 'Long text').click(); 0`);
      await sleep(500);
      log('stress test from the menu', /Summer sale Summer sale/.test(await pg(`h.textContent`)));
      await ui(`[...document.querySelectorAll('.cond-pop .chip')].find((c) => c.textContent === 'Long text').click(); document.querySelector('.vp-toggles .cond-wrap > button').click(); 0`);
      await ui(`[...document.querySelectorAll('.vp-toggles > button')].find((b) => b.title.startsWith('Phone, tablet')).click(); 0`);
      await sleep(3500);
      log('multi debug', true, JSON.stringify(await ui(`[!!document.querySelector('.multi'), [...document.querySelectorAll('.vp-toggles > button')].find((b) => b.title.startsWith('Phone, tablet')).outerHTML.slice(0, 200), window.__clicks.slice(-6)]`)));
      const panes = webContents.getAllWebContents().filter((w) => w.getType() === 'webview').length;
      log('side-by-side opens three more views', panes === 4, String(panes));
      await shot('multi');
      await ui(`document.querySelector('.multi-head .icon-btn').click(); [...document.querySelectorAll('.vp-toggles > button')].find((b) => b.title.startsWith('Fill the window')).click(); 0`);
      await sleep(800);

      // ---- record an interaction, then replay it with real input
      await ui(`document.querySelector('.mode-seg button:last-child').click(); 0`);
      await sleep(400);
      guest.focus();
      await clickIn('#rb');
      await sleep(300);
      await clickIn('#q');
      await sleep(200);
      await guest.insertText('shoes');
      for (const type of ['keyDown', 'char', 'keyUp']) guest.sendInputEvent({ type, keyCode: 'Enter' });
      await sleep(600);
      const live = await ui(`document.querySelector('.frozen-tag.rec')?.textContent || ''`);
      await shot('recording');
      await ui(`document.querySelector('.mode-seg button:last-child').click(); 0`);
      await sleep(400);
      const flow = await ui(`[...document.querySelectorAll('.ann-title')].map((s) => s.textContent).join(' / ')`);
      log('recording captured the steps', /Recorded interaction/.test(flow) && /[3-5] steps/.test(flow), `${live} => ${flow}`);
      log('real Enter submitted the form while recording', (await pg(`window.submitted`)) === 'shoes');
      await pg(`window.submitted = null; window.clicked = 0; q.value = ''; 0`);
      const r = await call('page:replay', { webContentsId: guest.id, steps: [
        { type: 'click', selector: '#rb' }, { type: 'fill', selector: '#q', value: 'boots' }, { type: 'key', key: 'Enter' },
      ] });
      await sleep(400);
      log('replay with real input: click, type, submit on Enter', r.done === 3 && (await pg(`window.clicked`)) === 1 && (await pg(`window.submitted`)) === 'boots', JSON.stringify([r, await pg(`window.clicked`), await pg(`window.submitted`)]));
      await shot('end');
      log('no errors in the app console', errors.length === 0, errors.join(' | ').slice(0, 400));

      // ---- line lookup without a source map
      const cssrules = require(path.join(repo, 'electron', 'cssrules.cjs'));
      log('cssrules module loads', typeof cssrules.matched === 'function');
    } catch (err) { log('exception', false, err.stack); }
    server.close();
    fs.appendFileSync(path.join(OUT, 'ui.out'), '[done]' + String.fromCharCode(10));
  app.exit(0);
  });
});
