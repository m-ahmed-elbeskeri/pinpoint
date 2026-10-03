// Smoke test, round 2: run with electron from the repo root. Boots the real main process
// (so its IPC handlers exist) and drives them against a test page served over http.
const OUT = process.env.PP_OUT || __dirname;         // where results, screenshots and built helpers go
const FIX = process.env.PP_FIXTURES || __dirname;    // real projects some suites run against
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const repo = process.cwd();
const NL = String.fromCharCode(10);
const out = [];
const log = (name, ok, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); fs.writeFileSync(path.join(OUT, 'tools.out'), out.join(NL) + NL); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A project folder with a stylesheet, served over http.
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-proj-'));
fs.mkdirSync(path.join(proj, 'src'));
fs.writeFileSync(path.join(proj, 'src', 'app.css'), [
  ':root { --primary: #ff0000; }',
  '.card { padding: 12px; color: rgb(0, 0, 255); }',
  '',
  '.card.big { padding: 24px; }',
  '@media (min-width: 640px) { .card { margin: 4px; } }',
  '@media (max-width: 479px) { .card { margin: 1px; } }',
  '.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }',
].join(NL));
const react = fs.readFileSync(path.join(repo, 'node_modules/react/umd/react.development.js'), 'utf8');
const reactDom = fs.readFileSync(path.join(repo, 'node_modules/react-dom/umd/react-dom.development.js'), 'utf8');
const PAGE = `<!doctype html><html lang="en"><head><title>t</title><link rel="stylesheet" href="/src/app.css"></head><body>
<div class="card big" id="card" data-pinpoint="c1"><span id="leaf" data-pinpoint="t1">Hello</span></div>
<ul id="list"><li>one</li><li>two</li></ul>
<div id="root"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>
  function Button(props) { return React.createElement('button', { id: 'rb', 'data-pinpoint': 'r1' }, props.label + ':' + props.size); }
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Button, { label: 'Go', size: 2 }));
  window.api = () => fetch('/api/data').then((r) => r.status).catch(() => 'failed');
</script></body></html>`;
const server = http.createServer((req, res) => {
  if (req.url === '/react.js') return res.end(react);
  if (req.url === '/react-dom.js') return res.end(reactDom);
  if (req.url === '/src/app.css') { res.setHeader('content-type', 'text/css'); return res.end(fs.readFileSync(path.join(proj, 'src', 'app.css'))); }
  if (req.url === '/api/data') { res.setHeader('content-type', 'application/json'); return res.end('{"ok":true}'); }
  res.setHeader('content-type', 'text/html');
  res.end(PAGE);
});

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ud-'));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ projectDir: proj, url: '' }));
process.env.PINPOINT_USER_DATA = ud;

const { app, BrowserWindow, ipcMain } = require('electron');
require(path.join(repo, 'electron', 'main.cjs'));
const call = (channel, args) => ipcMain._invokeHandlers.get(channel)({ sender: { isDestroyed: () => true, send() {} } }, args);

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const win = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { preload: path.join(repo, 'electron', 'webview-preload.cjs'), contextIsolation: true, sandbox: true, partition: 'persist:pinpoint' } });
  const wc = win.webContents;
  const errors = [];
  wc.on('console-message', (e) => { const m = e.message ?? ''; if ((e.level === 'error' || e.level === 3) && !/Security Warning/.test(m)) errors.push(m); });
  await win.loadURL(base + '/');
  await sleep(600);
  const js = (code) => wc.executeJavaScript(code);
  const id = wc.id;
  const lib = (f) => require(path.join(OUT, f + '.cjs'));

  try {
    // ---- React hook + live prop edit
    log('devtools hook saw the renderer', (await js(`window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.size`)) >= 1);
    const ok = await js(lib('pagetools').setPropScript('r1', 'Button', 'label', 'Stop'));
    await sleep(200);
    log('live prop edit', ok === true && (await js(`rb.textContent`)) === 'Stop:2', await js(`rb.textContent`));
    await js(lib('pagetools').setPropScript('r1', 'Button', 'size', 5));
    await sleep(200);
    log('live numeric prop edit', (await js(`rb.textContent`)) === 'Stop:5', await js(`rb.textContent`));
    await js(lib('pagetools').setPropScript('r1', 'Button', 'label', 'Again'));
    await sleep(200);
    log('third prop edit keeps earlier ones', (await js(`rb.textContent`)) === 'Again:5', await js(`rb.textContent`));
    const names = await js(lib('pagetools').classNamesScript);
    log('class names', names.includes('card') && names.includes('big') && names.includes('spin'), names.join(','));
    const bps = await js(lib('DeviceBar').breakpointsScript);
    log('breakpoints', bps.length === 2 && bps[0].px === 479 && bps[0].kind === 'max' && bps[1].px === 640, JSON.stringify(bps));

    // ---- which rule sets what
    const rules = await call('page:rules', { webContentsId: id, uid: 'c1' });
    const top = rules[0];
    log('matched rules', rules.length >= 2 && /[.]card[.]big/.test(top.selector) && top.file === 'src/app.css' && top.line === 4 && top.wins.includes('padding'), JSON.stringify(rules.map((r) => [r.selector, r.file, r.line, r.media, r.wins])));
    const base1 = rules.find((r) => r.selector === '.card' && !r.media);
    log('lower rule keeps what it still wins', !!base1 && base1.line === 2 && base1.wins.includes('color') && !base1.wins.includes('padding'));
    log('media rule reported', rules.some((r) => /min-width: 640px/.test(r.media || '') && r.wins.includes('margin')));

    // ---- text / class edits and restore
    wc.send('setText', { uid: 't1', text: 'Howdy' });
    wc.send('setClass', { uid: 'c1', value: 'card' });
    await sleep(100);
    log('text + class edit', (await js(`leaf.textContent + '|' + card.className + '|' + getComputedStyle(card).paddingTop`)) === 'Howdy|card|12px');
    wc.send('untweak');
    await sleep(100);
    log('text + class restored', (await js(`leaf.textContent + '|' + card.className`)) === 'Hello|card big');

    // ---- stress tests
    wc.send('stress', ['long', 'rtl', 'empty']);
    await sleep(150);
    log('stress on', (await js(`[leaf.textContent, document.documentElement.dir, getComputedStyle(list.children[0]).display].join('|')`)) === 'Hello Hello Hello|rtl|none', await js(`[leaf.textContent, document.documentElement.dir, getComputedStyle(list.children[0]).display].join('|')`));
    wc.send('stress', ['pseudo']);
    await sleep(150);
    log('pseudo-localized', /Hélló/.test(await js(`leaf.textContent`)) || /H.ll./.test(await js(`leaf.textContent`)), await js(`leaf.textContent`));
    wc.send('stress', []);
    await sleep(150);
    log('stress off restores', (await js(`[leaf.textContent, document.documentElement.dir, getComputedStyle(list.children[0]).display].join('|')`)) === 'Hello||list-item');

    // ---- isolate
    wc.send('isolate', 'c1');
    await sleep(100);
    log('isolate', (await js(`getComputedStyle(list).display + '|' + getComputedStyle(leaf).display`)) === 'none|inline');
    wc.send('isolate', null);
    await sleep(100);
    log('isolate off', (await js(`getComputedStyle(list).display`)) === 'block');

    // ---- layout overlay shouldn't throw while hovering in select mode
    wc.send('mode', 'select');
    wc.send('markers', [{ uid: 'c1', n: 1, color: '#f00', active: true }]);
    await js(`document.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 80, altKey: true, bubbles: true })); 0`);
    await sleep(300);
    wc.send('mode', 'browse');

    // ---- animation speed
    win.showInactive();
    await js(`card.classList.add('spin'); 0`);
    // A window that was hidden a moment ago takes a little while to start animating.
    const m1 = await js(`getComputedStyle(card).transform`);
    let m2 = m1;
    for (let i = 0; i < 20 && m2 === m1; i++) { await sleep(200); m2 = await js(`getComputedStyle(card).transform`); }
    log('animation runs before pausing (else the next check is inconclusive)', m1 !== m2);
    await call('page:animation', { webContentsId: id, rate: 0 });
    await sleep(150);
    const t1 = await js(`getComputedStyle(card).transform`); await sleep(250); const t2 = await js(`getComputedStyle(card).transform`);
    await call('page:animation', { webContentsId: id, rate: 1 });
    await sleep(250);
    const t3 = await js(`getComputedStyle(card).transform`);
    log('animation pause / resume', t1 === t2 && t3 !== t2, [t1 === t2, t3 !== t2].join());

    // ---- data states
    log('api normally answers', (await js(`api()`)) === 200);
    await call('page:network', { webContentsId: id, mode: 'error' });
    log('error state: api fails with 500', (await js(`api()`)) === 500);
    await call('page:network', { webContentsId: id, mode: 'hang' });
    log('loading state: api never answers', (await js(`Promise.race([api(), new Promise((r) => setTimeout(() => r('pending'), 1200))])`)) === 'pending');
    await call('page:network', { webContentsId: id, mode: 'normal' });
    log('back to normal', (await js(`api()`)) === 200);
    log('no page errors from the preload', errors.filter((e) => !/api.data|500/.test(e)).length === 0, errors.join(' | ').slice(0, 300));
  } catch (err) { log('exception', false, err.stack); }

  // ---- perf probe + pins
  try {
    const routecheck = require(path.join(repo, 'electron', 'routecheck.cjs'));
    const check = routecheck.begin(proj, [], base + '/');
    const perf = await routecheck.finishPerf(check);
    log('perf probe', !!perf && perf.after.js > 100000 && perf.after.nodes > 5 && perf.after.requests >= 3, JSON.stringify(perf && perf.after));
    let pins = await call('pins:add', { url: base + '/', label: 'home' });
    log('pin added', pins.length === 1 && fs.existsSync(path.join(proj, '.pinpoint', 'pins', pins[0].id + '.base.jpg')));
    pins = await call('pins:check');
    log('pin unchanged', pins[0].changed === false, JSON.stringify(pins[0]));
    fs.appendFileSync(path.join(proj, 'src', 'app.css'), NL + 'body { background: rgb(200, 0, 0); }');
    pins = await call('pins:check');
    const im = await call('pins:images', pins[0].id);
    log('pin detects change', pins[0].changed === true && !!im.before && !!im.after, `${pins[0].pct}%`);
    pins = await call('pins:accept', pins[0].id);
    pins = await call('pins:check');
    log('accepted baseline matches', pins[0].changed === false);
    log('unpin', (await call('pins:remove', pins[0].id)).length === 0);
    // touch emulation: no hover, coarse pointer
    await call('page:emulate', { webContentsId: id, colorScheme: null, reducedMotion: false, focus: false, touch: true });
    const touchOn = await js(`matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches && navigator.maxTouchPoints`);
    await call('page:emulate', { webContentsId: id, colorScheme: null, reducedMotion: false, focus: false, touch: false });
    const touchOff = await js(`matchMedia('(pointer: coarse)').matches`);
    log('touch emulation on and off', touchOn === 5 && touchOff === false, JSON.stringify([touchOn, touchOff]));
  } catch (err) { log('perf/pins exception', false, err.stack); }

  server.close();
  fs.appendFileSync(path.join(OUT, 'tools.out'), '[done]' + String.fromCharCode(10));
  app.exit(0);
});
