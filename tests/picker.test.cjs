// The model + thinking-level control: open it, pick a model, click and drag the slider.
const OUT = process.env.PP_OUT || __dirname;         // where results, screenshots and built helpers go
const FIX = process.env.PP_FIXTURES || __dirname;    // real projects some suites run against
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const repo = process.cwd();
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ud-'));
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-proj-'));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ projectDir: proj, url: '', agent: 'claude' }));
process.env.PINPOINT_USER_DATA = ud;
const { app, BrowserWindow } = require('electron');
require(path.join(repo, 'electron', 'main.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const log = (name, ok, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); fs.writeFileSync(path.join(OUT, 'picker.out'), out.join(String.fromCharCode(10)) + String.fromCharCode(10)); };
app.whenReady().then(async () => {
  await sleep(4000);
  const win = BrowserWindow.getAllWindows()[0];
  win.show(); win.focus();
  const host = win.webContents;
  const ui = (c) => host.executeJavaScript(c);
  const saved = () => JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
  const shot = async (name) => { try { fs.writeFileSync(path.join(OUT, `mp-${name}.png`), (await host.capturePage()).toPNG()); } catch {} };
  try {
    const btn = await ui(`document.querySelector('.mp-btn').innerText.replace(/\s+/g, ' ')`);
    log('one button for model and level', (await ui(`document.querySelectorAll('.agent-controls .mp-btn').length`)) === 1 && (await ui(`document.querySelectorAll('.agent-controls .dd-btn').length`)) === 2, btn);
    await shot('closed');
    await ui(`document.querySelector('.mp-btn').click(); 0`);
    await sleep(300);
    log('menu has the model list and a slider', (await ui(`document.querySelectorAll('.mp-models .dd-item').length`)) >= 4 && (await ui(`!!document.querySelector('.mp-track')`)));
    const r = await ui(`(() => { const b = document.querySelector('.mp-track').getBoundingClientRect(); return { x: b.left, y: b.top + b.height / 2, w: b.width }; })()`);
    const stops = await ui(`document.querySelectorAll('.mp-stop').length`);
    const at = (i) => Math.round(r.x + (r.w * i) / (stops - 1));
    const NAMES = { mouseDown: 'pointerdown', mouseMove: 'pointermove', mouseUp: 'pointerup' };
    const mouse = (type, x) => ui(`document.querySelector('.mp-track').dispatchEvent(new PointerEvent('${NAMES[type]}', { clientX: ${x}, clientY: ${Math.round(r.y)}, bubbles: true, pointerId: 1 })); 0`);
    // click the last stop
    await mouse('mouseDown', at(stops - 1)); await mouse('mouseUp', at(stops - 1));
    await sleep(400);
    log('clicking the track sets the level', saved().claudeEffort === 'max', saved().claudeEffort);
    // drag from the last stop back to the second, passing the ones between
    await mouse('mouseDown', at(stops - 1));
    const seen = [];
    for (let i = stops - 1; i >= 1; i--) { await mouse('mouseMove', at(i)); await sleep(150); seen.push(saved().claudeEffort); }
    const mid = seen.join('>');
    await mouse('mouseUp', at(1));
    await sleep(400);
    log('dragging moves through the levels', saved().claudeEffort === 'medium', `${mid} -> ${saved().claudeEffort}`);
    await shot('open');
    const label = await ui(`document.querySelector('.mp-current b').textContent`);
    log('menu names the chosen level', label === 'Medium', label);
    await ui(`document.querySelector('.mp-reset').click(); 0`);
    await sleep(300);
    log('"Use default" clears it', saved().claudeEffort === '');
    await ui(`[...document.querySelectorAll('.mp-models .dd-item')].find((b) => /Haiku/.test(b.textContent)).click(); 0`);
    await sleep(300);
    log('a model without thinking levels says so', saved().claudeModel === 'haiku' && /no thinking levels/.test(await ui(`document.querySelector('.mp-none')?.textContent || ''`)));
    await ui(`[...document.querySelectorAll('.mp-models .dd-item')].find((b) => /Sonnet/.test(b.textContent)).click(); 0`);
    await sleep(300);
    const fits = await ui(`(() => { const m = document.querySelector('.mp-menu').getBoundingClientRect(); return m.left >= 0 && m.right <= innerWidth && m.top >= 0; })()`);
    log('menu stays inside the window', fits === true);
  } catch (e) { log('exception', false, e.stack); }
  fs.appendFileSync(path.join(OUT, 'picker.out'), '[done]' + String.fromCharCode(10));
  app.exit(0);
});
