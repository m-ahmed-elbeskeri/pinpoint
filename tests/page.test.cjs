// Page-side tools (forced states, tweaks, freeze, themes, tokens, axe) and the change check.
const OUT = process.env.PP_OUT || __dirname;         // where results, screenshots and built helpers go
const FIX = process.env.PP_FIXTURES || __dirname;    // real projects some suites run against
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const repoRequire = require('node:module').createRequire(path.join(process.cwd(), 'package.json'));

const repo = process.cwd();
const out = [];
const log = (name, ok, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); fs.writeFileSync(path.join(OUT, 'page.out'), out.join(String.fromCharCode(10)) + String.fromCharCode(10)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Load a TS lib module (function + exported script builder) as CommonJS.
const loadTs = (rel) => require(path.join(OUT, path.basename(rel, '.ts') + '.cjs'));

const HTML = `<!doctype html><html><head><style>
:root { --primary: #ff0000; --radius-md: 8px; --space-4: 16px; --text-lg: 18px; --surface: 222 47% 11%; }
body { margin: 0; font-size: 16px; }
#btn { color: rgb(0, 0, 255); background: var(--primary); border-radius: var(--radius-md); padding: var(--space-4); font-size: var(--text-lg); }
#btn:hover { color: rgb(0, 128, 0); }
#other:hover { color: rgb(1, 2, 3); }
#menu { display: none; } #wrap:hover #menu { display: block; }
@media (prefers-color-scheme: dark) { body { background: rgb(10, 10, 10); } }
</style></head><body>
<div id="wrap"><button id="btn" data-pinpoint="u1">Go</button><span id="other" data-pinpoint="u2">x</span><div id="menu">menu</div></div>
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" id="noalt">
<script>window.leaves = 0; document.getElementById('wrap').addEventListener('mouseleave', () => { window.leaves++; });</script>
</body></html>`;

app.whenReady().then(async () => {
  log('app ready', true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-smoke-'));
  const page = path.join(dir, 'index.html');
  fs.writeFileSync(page, HTML);
  const url = 'file:///' + page.replace(/\\/g, '/');

  const win = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { preload: path.join(repo, 'electron', 'webview-preload.cjs'), contextIsolation: true, sandbox: true, partition: 'persist:pinpoint' } });
  const wc = win.webContents;
  await win.loadURL(url);
  log('page loaded', true);
  const js = (code) => wc.executeJavaScript(code);

  try {
    // ---- CDP: forced states survive forcing a second element; emulation works
    wc.debugger.attach('1.3');
    const cdp = (m, p = {}) => wc.debugger.sendCommand(m, p);
    await cdp('DOM.enable'); await cdp('CSS.enable');
    const root = (await cdp('DOM.getDocument', { depth: 0 })).root.nodeId;
    const q = async (sel) => (await cdp('DOM.querySelectorAll', { nodeId: root, selector: sel })).nodeIds;
    for (const id of await q('[data-pinpoint="u1"]')) await cdp('CSS.forcePseudoState', { nodeId: id, forcedPseudoClasses: ['hover'] });
    log('force :hover', (await js(`getComputedStyle(btn).color`)) === 'rgb(0, 128, 0)');
    for (const id of await q('[data-pinpoint="u2"]')) await cdp('CSS.forcePseudoState', { nodeId: id, forcedPseudoClasses: ['hover'] });
    log('first forced state kept after forcing a second', (await js(`getComputedStyle(btn).color`)) === 'rgb(0, 128, 0)' && (await js(`getComputedStyle(other).color`)) === 'rgb(1, 2, 3)');
    for (const id of await q('[data-pinpoint="u1"]')) await cdp('CSS.forcePseudoState', { nodeId: id, forcedPseudoClasses: [] });
    log('release :hover', (await js(`getComputedStyle(btn).color`)) === 'rgb(0, 0, 255)');
    // hover forced on an ancestor chain reveals a :hover-driven menu
    await js(`wrap.setAttribute('data-pinpoint-hover','')`);
    for (const id of await q('[data-pinpoint-hover]')) await cdp('CSS.forcePseudoState', { nodeId: id, forcedPseudoClasses: ['hover'] });
    log('forced hover opens css menu', (await js(`getComputedStyle(menu).display`)) === 'block');
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    log('emulate dark + reduced motion', (await js(`matchMedia('(prefers-color-scheme: dark)').matches && matchMedia('(prefers-reduced-motion: reduce)').matches`)) === true && (await js(`getComputedStyle(document.body).backgroundColor`)) === 'rgb(10, 10, 10)');
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: '' }, { name: 'prefers-reduced-motion', value: '' }] });
    log('emulation reset', (await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`)) === false);
    await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    log('focus emulation accepted', true);

    // ---- preload: tweaks, disabled, freeze
    wc.send('tweak', { uid: 'u1', prop: 'padding', value: '40px' });
    await sleep(100);
    log('tweak applies', (await js(`getComputedStyle(btn).paddingTop`)) === '40px');
    wc.send('setDisabled', { uid: 'u1', on: true });
    await sleep(60);
    log('disabled on', (await js(`btn.disabled`)) === true);
    wc.send('tweak', { uid: 'u1', prop: 'padding', value: '' });
    await sleep(60);
    { const pt = await js(`getComputedStyle(btn).paddingTop`), st = await js(`btn.getAttribute('style')`); log('tweak reset one prop', pt === '16px' && st === null, JSON.stringify([pt, st])); }
    wc.send('tweak', { uid: 'u1', prop: 'color', value: '#123456' });
    wc.send('clear');
    await sleep(100);
    log('clear restores element', (await js(`btn.disabled === false && btn.getAttribute('style') === null && !btn.hasAttribute('data-pinpoint')`)) === true, JSON.stringify(await js(`[btn.disabled, btn.getAttribute('style'), btn.hasAttribute('data-pinpoint')]`)));

    wc.send('freeze', true);
    await sleep(60);
    await js(`wrap.dispatchEvent(new MouseEvent('mouseleave')); 0`);
    const held = await js(`window.leaves`);
    wc.send('freeze', false);
    await sleep(60);
    await js(`wrap.dispatchEvent(new MouseEvent('mouseleave')); 0`);
    log('freeze holds page events, unfreeze releases', held === 0 && (await js(`window.leaves`)) === 1, `held=${held}`);

    // ---- freeze also holds the page's timers
    await js(`window.fired = 0; setTimeout(() => { window.fired++; }, 150); window.ticks = 0; window.iv = setInterval(() => { window.ticks++; }, 50); 0`);
    wc.send('freeze', true);
    await sleep(500);
    const heldTimer = await js(`window.fired`), heldTicks = await js(`window.ticks`);
    await sleep(200);
    const stillTicks = await js(`window.ticks`);
    wc.send('freeze', false);
    await sleep(250);
    log('freeze holds timeouts and intervals, release runs them', heldTimer === 0 && stillTicks === heldTicks && (await js(`window.fired`)) === 1 && (await js(`window.ticks`)) > stillTicks, JSON.stringify([heldTimer, heldTicks, stillTicks, await js(`window.fired`), await js(`window.ticks`)]));
    await js(`clearInterval(window.iv); 0`);

    // ---- class / attribute based themes
    await js(`document.documentElement.className = 'light app'; document.documentElement.setAttribute('data-theme', 'light'); 0`);
    wc.send('scheme', 'dark');
    await sleep(80);
    const dark = await js(`document.documentElement.className + '|' + document.documentElement.getAttribute('data-theme')`);
    wc.send('scheme', null);
    await sleep(80);
    const back = await js(`document.documentElement.className + '|' + document.documentElement.getAttribute('data-theme')`);
    log('dark mode also switches class and attribute themes, and restores', /\bdark\b/.test(dark) && !/\blight\b/.test(dark.split('|')[0]) && dark.endsWith('|dark') && back === 'light app|light', `${dark} -> ${back}`);
    await js(`document.documentElement.className = ''; document.documentElement.removeAttribute('data-theme'); 0`);

    // ---- token matching + axe
    await js(`btn.setAttribute('data-pinpoint','u1'); 0`);
    const tokens = await js(loadTs('src/lib/tokens.ts').tokenMatchScript('u1'));
    log('token match', tokens && tokens['background-color'] === '--primary' && tokens['border-radius'] === '--radius-md' && tokens.padding === '--space-4' && tokens['font-size'] === '--text-lg', JSON.stringify(tokens));
    const axe = fs.readFileSync(repoRequire.resolve('axe-core/axe.min.js'), 'utf8');
    const issues = await js(loadTs('src/lib/a11y.ts').a11yScript(axe));
    log('axe audit', Array.isArray(issues) && issues.some((v) => v.id === 'image-alt'), issues && issues.map((v) => `${v.id}×${v.count}`).join(','));
    const again = await js(loadTs('src/lib/a11y.ts').a11yScript(axe));
    log('axe second run', Array.isArray(again) && again.length === issues.length);
  } catch (err) { log('exception', false, err.stack); }

  // ---- route check: hidden-window screenshots, diff, baseline reuse
  try {
    const routecheck = require(path.join(repo, 'electron', 'routecheck.cjs'));
    const proj = path.join(dir, 'proj');
    fs.mkdirSync(proj);
    const a = path.join(proj, 'a.html'), b = path.join(proj, 'b.html');
    fs.writeFileSync(a, '<body style="background:#fff"><h1>A</h1></body>');
    fs.writeFileSync(b, '<body style="background:#fff"><h1>B</h1></body>');
    const u = (f) => 'file:///' + f.replace(/\\/g, '/');
    const routes = [{ route: '/a', url: u(a) }, { route: '/b', url: u(b) }];
    const saved = [];
    let check = routecheck.begin(proj, routes);
    await check.before;
    fs.writeFileSync(b, '<body style="background:#fff"><h1>B</h1><div style="height:400px;background:#c00"></div></body>');
    let res = await routecheck.finish(check, (name, buf) => saved.push([name, buf.length]));
    const ra = res.find((r) => r.route === '/a'), rb = res.find((r) => r.route === '/b');
    log('route check flags only the changed page', ra && !ra.changed && rb && rb.changed, JSON.stringify(res) + ' saved=' + JSON.stringify(saved));
    const t0 = Date.now();
    check = routecheck.begin(proj, routes);
    await check.before;
    log('baseline reused when nothing changed', Date.now() - t0 < 300, `${Date.now() - t0}ms`);
    res = await routecheck.finish(check, () => {});
    log('no change -> nothing flagged', res.length === 2 && res.every((r) => !r.changed), JSON.stringify(res));

    // content that moves by itself (a ticking box, a spinning one) is not a change
    const c = path.join(proj, 'c.html');
    fs.writeFileSync(c, '<body style="background:#fff"><h1 id="t">C</h1><div id="tick" style="width:200px;height:200px"></div><div style="width:120px;height:120px;background:#06c;animation:spin 1s linear infinite"></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style><script>let n=0;setInterval(()=>{tick.style.background=["#c00","#0c0","#00c","#cc0"][n++%4]},90)</script></body>');
    const moving = [{ route: '/c', url: u(c) }];
    check = routecheck.begin(proj, moving);
    await check.before;
    res = await routecheck.finish(check, () => {});
    log('self-moving content is not reported as a change', res.length === 1 && res[0].changed === false, JSON.stringify(res));
    check = routecheck.begin(proj, moving);
    await check.before;
    fs.writeFileSync(c, fs.readFileSync(c, 'utf8').replace('>C</h1>', ' style="color:#d00">C</h1>'));
    res = await routecheck.finish(check, () => {});
    log('a real change next to moving content is still caught and named', res[0].changed === true && (res[0].areas || []).some((n) => n.includes('<h1')), JSON.stringify(res));

    // baselines taken while idle are used by the next run
    fs.writeFileSync(a, '<body style="background:#fff"><h1>A2</h1></body>');
    routecheck.prewarm(proj, routes);
    await sleep(4500);
    const t1 = Date.now();
    check = routecheck.begin(proj, routes);
    await check.before;
    log('idle-time baseline makes the run start without waiting', Date.now() - t1 < 300, `${Date.now() - t1}ms`);
  } catch (err) { log('route check exception', false, err.stack); }

  fs.writeFileSync(path.join(OUT, 'page.out'), out.join('\n') + '\n');
  fs.appendFileSync(path.join(OUT, 'page.out'), '[done]' + String.fromCharCode(10));
  app.exit(0);
});
