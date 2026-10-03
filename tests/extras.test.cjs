// Round 5: Tailwind class generation (v4 and v3), Vue prop editing, live isolate,
// starting Storybook (stand-in script), issue + gist flow (stand-in gh), build size.
const OUT = process.env.PP_OUT || __dirname;         // where results, screenshots and built helpers go
const FIX = process.env.PP_FIXTURES || __dirname;    // real projects some suites run against
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const cp = require('node:child_process');
const repo = process.cwd();
const NL = String.fromCharCode(10);
const out = [];
const log = (name, ok, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + String(extra).slice(0, 260) : ''}`); fs.writeFileSync(path.join(OUT, 'extras.out'), out.join(NL) + NL); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a stand-in for the GitHub CLI: records what it was asked to do
const gh = { calls: [], gistFile: null, issueBody: null };
const realExecFile = cp.execFile;
cp.execFile = function (cmd, args, opts, cb) {
  if (cmd !== 'gh') return realExecFile.apply(this, arguments);
  gh.calls.push(args.slice(0, 2).join(' '));
  let outText = '';
  if (args[0] === '--version') outText = 'gh version 2.0.0';
  else if (args[0] === 'api') outText = 'tester';
  else if (args[0] === 'gist') { gh.gistFile = JSON.parse(fs.readFileSync(args[2], 'utf8')); outText = 'https://gist.github.com/tester/abc123'; }
  else if (args[0] === 'issue') { gh.issueBody = fs.readFileSync(args[args.indexOf('--body-file') + 1], 'utf8'); outText = 'https://github.com/o/r/issues/7'; }
  setImmediate(() => cb(null, outText, ''));
};

// ---- the project: Tailwind 4, a build script, a story and a "storybook" script
const proj = path.join(FIX, 'tw4');
fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
fs.writeFileSync(path.join(proj, 'src', 'Button.stories.js'), 'export default { title: "Button" };');
fs.writeFileSync(path.join(proj, 'sb.js'), `require('http').createServer((q, s) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ entries: { 'button--default': { type: 'story', id: 'button--default', importPath: './src/Button.stories.js' } } })); }).listen(6006); setTimeout(() => process.exit(0), 30000);`);
fs.writeFileSync(path.join(proj, 'build.js'), `const fs = require('fs'); fs.mkdirSync('dist', { recursive: true }); fs.writeFileSync('dist/app.js', 'console.log(1);'.repeat(+fs.readFileSync('size.txt', 'utf8'))); fs.writeFileSync('dist/app.css', 'a{color:red}'.repeat(50));`);
fs.writeFileSync(path.join(proj, 'size.txt'), '200');
fs.rmSync(path.join(proj, '.pinpoint'), { recursive: true, force: true }); // start without an earlier measurement
const pkg = JSON.parse(fs.readFileSync(path.join(proj, 'package.json'), 'utf8'));
pkg.scripts = { build: 'node build.js', storybook: 'node sb.js' };
fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify(pkg));

const vue = fs.readFileSync(path.join(FIX, 'vuep', 'node_modules', 'vue', 'dist', 'vue.global.js'), 'utf8');
const PAGE = `<!doctype html><html><head><title>vue</title><style>body{margin:0;padding:10px} #side{height:300px;background:#ddd} .box{padding:8px}</style></head><body>
<div id="side">sidebar</div><div id="wrapper" style="padding:50px;display:flex"><div id="app"></div></div>
<script src="/vue.js"></script>
<script>
  const Badge = { name: 'Badge', props: { label: String, count: Number }, template: '<button id="vb" class="box" data-pinpoint="v1" @click="n++">{{ label }}:{{ count }}:{{ n }}</button>', data: () => ({ n: 0 }) };
  Vue.createApp({ components: { Badge }, template: '<Badge label="New" :count="3" />' }).mount('#app');
</script></body></html>`;
const server = http.createServer((req, res) => { if (req.url === '/vue.js') return res.end(vue); res.setHeader('content-type', 'text/html'); res.end(PAGE); });

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ud-'));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ projectDir: proj, url: '' }));
process.env.PINPOINT_USER_DATA = ud;
const electron = require('electron');
const { app, BrowserWindow, ipcMain } = electron;
require(path.join(repo, 'electron', 'main.cjs'));
const call = (channel, args) => ipcMain._invokeHandlers.get(channel)({ sender: { isDestroyed: () => true, send() {} } }, args);
const lib = (f) => require(path.join(OUT, f + '.cjs'));

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const win = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { preload: path.join(repo, 'electron', 'webview-preload.cjs'), contextIsolation: true, sandbox: true, partition: 'persist:pinpoint' } });
  const wc = win.webContents;
  await win.loadURL(base + '/');
  await sleep(500);
  const js = (code) => wc.executeJavaScript(code);

  // ---- Tailwind: classes the build hasn't emitted
  try {
    const tailwind = require(path.join(repo, 'electron', 'tailwind.cjs'));
    const v4 = await tailwind.generate(proj, { entry: path.join(proj, 'src', 'app.css'), config: '' }, ['p-7', 'bg-brand', 'hover:underline', 'definitely-not-a-class']);
    log('tailwind 4: generates the asked utilities', v4.includes('.p-7') && v4.includes('.bg-brand') && /hover\\:underline/.test(v4) && !v4.includes('definitely-not'), `${v4.length} bytes`);
    log('tailwind 4: theme token carried, base styles left out', v4.includes('--color-brand') && !/@layer base/.test(v4) && !/box-sizing:\s*border-box/.test(v4));
    const viaIpc = await call('tailwind:css', ['m-9']);
    log('tailwind via the app (detects the entry css itself)', !!viaIpc && viaIpc.includes('.m-9'));
    wc.send('injectCss', v4);
    await js(`document.body.insertAdjacentHTML('beforeend', '<div id="fresh">x</div>'); fresh.classList.add('p-7', 'bg-brand'); 0`);
    await sleep(150);
    const eff = await js(`getComputedStyle(fresh).paddingTop + '|' + getComputedStyle(fresh).backgroundColor`);
    log('generated classes take effect in the page', eff === '28px|rgb(255, 0, 170)', eff);
    await js(`fresh.remove(); 0`);
    const tw3 = path.join(FIX, 'tw3');
    const v3 = await tailwind.generate(tw3, { entry: path.join(tw3, 'src', 'app.css'), config: path.join(tw3, 'tailwind.config.js') }, ['p-7', 'bg-brand', 'md:flex']);
    log('tailwind 3: generates utilities with the project config', v3.includes('.p-7') && v3.includes('.bg-brand') && /md\\:flex/.test(v3) && /255 0 170|#ff00aa/i.test(v3), `${v3.length} bytes`);
  } catch (err) { log('tailwind exception', false, err.stack); }

  // ---- Vue: find the component and edit its props live
  try {
    const src = await js(lib('inspect').locateSourceScript('v1'));
    log('vue component and props are read', src && src.owner === 'Badge' && src.props && src.props.label === '"New"' && src.props.count === '3', JSON.stringify(src));
    await js(`vb.click(); 0`);
    const ok = await js(lib('pagetools').setPropScript('v1', 'Badge', 'label', 'Sale'));
    await sleep(200);
    log('vue prop edit re-renders and keeps state', ok === true && (await js(`vb.textContent`)) === 'Sale:3:1', await js(`vb.textContent`));
    await js(lib('pagetools').setPropScript('v1', 'Badge', 'count', 9));
    await sleep(200);
    log('vue numeric prop edit', (await js(`vb.textContent`)) === 'Sale:9:1', await js(`vb.textContent`));

    // ---- isolate: alone on the page, live
    wc.send('isolate', 'v1');
    await sleep(200);
    const iso = await js(`(() => { const r = vb.getBoundingClientRect(); return [getComputedStyle(side).display, getComputedStyle(wrapper).display, Math.abs((r.left + r.width / 2) - innerWidth / 2) < 3, Math.abs((r.top + r.height / 2) - innerHeight / 2) < 3].join('|'); })()`);
    log('isolate: the rest leaves the layout and the element is centered', iso === 'none|contents|true|true', iso);
    await js(`vb.click(); 0`);
    await sleep(100);
    log('isolate: the component is still live', (await js(`vb.textContent`)) === 'Sale:9:2');
    wc.send('isolate', null);
    await sleep(150);
    log('isolate off restores the page', (await js(`[getComputedStyle(side).display, getComputedStyle(wrapper).display, vb.textContent].join('|')`)) === 'block|flex|Sale:9:2');
  } catch (err) { log('vue/isolate exception', false, err.stack); }

  // ---- Storybook: started from the project's script, then the story URL is found
  try {
    const before = await call('story:find', 'Button');
    log('story file found, storybook not running, can be started', before.file === 'src/Button.stories.js' && before.url === null && before.canStart === true, JSON.stringify(before));
    const url = await call('story:start', 'Button');
    log('storybook started and the story URL returned', url === 'http://localhost:6006/iframe.html?id=button--default&viewMode=story', url);
  } catch (err) { log('storybook exception', false, err.message); }

  // ---- issue with the hand-off attached as a gist
  try {
    electron.shell.openExternal = async () => {};
    const handoff = { pinpointHandoff: 1, createdAt: 1, url: 'http://x/', title: 't', instruction: 'Make it pop', annotations: [{ id: 'a', n: 1, kind: 'reference', note: 'like this', color: '#f00', image: 'data:image/png;base64,AAAA' }] };
    const r = await call('handoff:issue', { title: 'Make it pop', body: '## Request', attach: { name: 'Make it pop', data: handoff } });
    log('issue created with the hand-off in a gist', r.url.endsWith('/issues/7') && r.gist === 'https://gist.github.com/tester/abc123', JSON.stringify(r));
    log('gist holds the full hand-off, screenshots included', gh.gistFile && gh.gistFile.annotations[0].image.startsWith('data:image/png'));
    log('issue body links the gist', /gist\.github\.com\/tester\/abc123/.test(gh.issueBody) && gh.issueBody.startsWith('## Request'));
    const r2 = await call('handoff:issue', { title: 'Text only', body: 'b' });
    log('no screenshots: no gist is made', r2.gist === null && gh.calls.filter((c) => c.startsWith('gist')).length === 1);
  } catch (err) { log('issue exception', false, err.stack); }

  // ---- production build size
  try {
    const first = await call('build:measure');
    log('build measured', first.previous === null && first.now.files === 2 && first.now.js === 3000 && first.now.jsGzip > 0 && first.now.jsGzip < first.now.js, JSON.stringify(first.now));
    fs.writeFileSync(path.join(proj, 'size.txt'), '400');
    const second = await call('build:measure');
    log('second measure compares with the first', second.previous && second.previous.js === 3000 && second.now.js === 6000);
    // A Next.js project whose dev server was started outside the app (here: our test server) must not be built over.
    const next = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-next-'));
    fs.writeFileSync(path.join(next, 'package.json'), '{"scripts":{"build":"node -e 0"},"dependencies":{"next":"15"}}');
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ projectDir: next, url: '' }));
    const refused = await call('build:measure', `http://localhost:${server.address().port}/`).then(() => 'built', (e) => e.message);
    log('next.js: refuses to build over a dev server it did not start', /didn't start is running/.test(refused), refused);
    const idle = await call('build:measure', 'http://localhost:9/').then(() => 'built', (e) => e.message);
    log('next.js: builds when nothing is serving the page', /no JS or CSS output/.test(idle), idle);
  } catch (err) { log('build exception', false, err.stack); }

  server.close();
  fs.appendFileSync(path.join(OUT, 'extras.out'), '[done]' + String.fromCharCode(10));
  app.exit(0);
});
