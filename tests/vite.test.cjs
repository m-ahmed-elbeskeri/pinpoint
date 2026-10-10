const OUT = process.env.PP_OUT || __dirname;
const FIX = process.env.PP_FIXTURES || __dirname;
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const { spawn, execSync } = require('node:child_process');
const repo = process.cwd();
const NL = String.fromCharCode(10);
const out = [];
const log = (name, ok, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + String(extra).slice(0, 300) : ''}`); fs.writeFileSync(path.join(OUT, 'vite.out'), out.join(NL) + NL); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proj = path.join(FIX, 'viteapp');
const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(proj, rel)), { recursive: true }); fs.writeFileSync(path.join(proj, rel), text); };
fs.rmSync(path.join(proj, '.pinpoint'), { recursive: true, force: true });
w('vite.config.js', `import react from '@vitejs/plugin-react';\nexport default { plugins: [react()], server: { port: 5199, strictPort: true } };\n`);
w('index.html', `<!doctype html><html lang="en"><head><title>Vite demo</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>\n`);
w('src/main.jsx', `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\nimport './app.css';\ncreateRoot(document.getElementById('root')).render(<App />);\n`);
const APP = [
  `import { Button } from './components/Button.tsx';`,
  `export default function App() {`,
  `  return (`,
  `    <main className="page">`,
  `      <h1 className="title">Summer sale</h1>`,
  `      <p className="lead">Everything must go.</p>`,
  `      <Button label="Buy now" variant="primary" />`,
  `      <footer className="foot">Footer text</footer>`,
  `    </main>`,
  `  );`,
  `}`,
  ``,
].join('\n');
w('src/App.jsx', APP);
w('src/components/Button.tsx', [
  `type Props = { label: string; variant?: 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'lg'; disabled?: boolean };`,
  `export function Button({ label, variant = 'primary', size = 'sm', disabled = false }: Props) {`,
  `  return <button className={'btn ' + variant + ' ' + size} disabled={disabled}>{label}</button>;`,
  `}`,
  ``,
].join('\n'));
const CSS = `body { margin: 0; font-family: system-ui; background: #fff; }\n.page { padding: 30px; display: flex; flex-direction: column; gap: 14px; align-items: flex-start; }\n.title {\n  margin: 0;\n  padding: 8px;\n  color: #222;\n}\n.btn { border: 0; border-radius: 6px; padding: 8px 14px; }\n.btn.primary { background: #2255ee; color: #fff; }\n.btn.ghost { background: #eee; }\n.btn.danger { background: #c00; color: #fff; }\n.btn.lg { font-size: 20px; }\n`;
w('src/app.css', CSS);
fs.mkdirSync(path.join(proj, '.pinpoint'), { recursive: true });
fs.writeFileSync(path.join(proj, '.pinpoint', 'profiles.json'), JSON.stringify([{ id: 'admin1', name: 'Admin', locale: 'de-DE', timezone: 'Asia/Tokyo', flags: 'role=admin\nnewNav=true', headers: '' }]));

const vite = spawn(process.env.npm_node_execpath || 'node', [path.join(proj, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: proj, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
const stopVite = () => { try { execSync(`taskkill /pid ${vite.pid} /T /F`, { stdio: 'ignore' }); } catch { try { vite.kill(); } catch {} } };
const base = 'http://localhost:5199';

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ud-'));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ projectDir: proj, url: base + '/', a11yCheck: false, routeCheck: false, perfCheck: false }));
process.env.PINPOINT_USER_DATA = ud;
const { app, BrowserWindow, webContents } = require('electron');
require(path.join(repo, 'electron', 'main.cjs'));

app.whenReady().then(async () => {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(base + '/')).ok; } catch {} if (!up) await sleep(500); }
  log('dev server started', up);
  await sleep(6500);
  const win = BrowserWindow.getAllWindows()[0];
  win.show(); win.focus();
  const host = win.webContents;
  const ui = (c) => host.executeJavaScript(c);
  const guests = () => webContents.getAllWebContents().filter((x) => x.getType() === 'webview');
  const until = async (fn, ms) => { for (let t = 0; t < ms; t += 300) { const v = await fn(); if (v) return v; await sleep(300); } return null; };
  const key = (k) => ui(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true })); 0`);
  const read = (rel) => fs.readFileSync(path.join(proj, rel), 'utf8');
  const mouse = (g, type, x, y) => g.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  const rectOf = (g, sel) => g.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const pick = async (g, sel) => {
    for (let i = 0; i < 4; i++) {
      await key('s'); await sleep(250);
      g.focus();
      const r = await rectOf(g, sel);
      for (const t of ['mouseMove', 'mouseDown', 'mouseUp']) mouse(g, t, r.x + Math.min(12, r.w / 2), r.y + r.h / 2);
      await sleep(2200);
      if (await ui(`!!document.querySelector('.note-pop .el-tools')`)) return true;
    }
    return false;
  };
  const tabBtn = (label) => ui(`[...document.querySelectorAll('.el-tabs button')].find((b) => b.textContent.startsWith(${JSON.stringify(label)})).click(); 0`);
  const setInput = (sel, value) => ui(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const applyBtn = () => until(() => ui(`(() => { const b = [...document.querySelectorAll('.note-pop-foot .btn')].find((x) => /Apply now/.test(x.textContent)); return b ? (b.disabled ? 'disabled: ' + b.title : 'ready') : ''; })()`), 6000);
  const clickApply = () => ui(`[...document.querySelectorAll('.note-pop-foot .btn')].find((x) => /Apply now/.test(x.textContent)).click(); 0`);
  const errors = [];
  host.on('console-message', (e) => { if ((e.level === 'error' || e.level === 3) && !/Security Warning/.test(e.message)) errors.push(e.message.slice(0, 160)); });

  try {
    const g = guests()[0];
    log('vite app loaded', /Vite demo/.test(g.getTitle()), g.getTitle());

    log('picked the heading', await pick(g, 'h1'));
    await tabBtn('Content');
    await sleep(200);
    await setInput('.el-stack .el-field input', 'Winter sale');
    const a1 = await applyBtn();
    log('text edit can be applied without the agent', a1 === 'ready', a1);
    await clickApply();
    await sleep(1500);
    log('text written to the source', read('src/App.jsx').includes('<h1 className="title">Winter sale</h1>'));
    log('hot reload shows it', (await until(() => g.executeJavaScript(`document.querySelector('h1').textContent === 'Winter sale'`), 5000)) === true);
    const card = await ui(`[...document.querySelectorAll('.done-card .done-head > span:first-of-type')].map((s) => s.textContent).join(' | ')`);
    log('shown in the chat as an instant edit', /Applied instantly · 1 file/.test(card), card);
    await ui(`[...document.querySelectorAll('.done-card .done-actions .btn')].find((b) => b.title.startsWith('Restore')).click(); 0`);
    await sleep(1200);
    log('undo restores the source', read('src/App.jsx') === APP);

    log('picked the heading again', await pick(g, 'h1'));
    await tabBtn('Styles');
    await sleep(200);
    await setInput('.el-grid .el-field input:not([type=color])', '20px');
    const a2 = await applyBtn();
    log('style tweak can be applied without the agent', a2 === 'ready', a2);
    await clickApply();
    await sleep(1500);
    log('css rule edited in place', read('src/app.css').includes('.title {\n  margin: 0;\n  padding: 20px;\n  color: #222;\n}'), JSON.stringify(read('src/app.css').slice(120, 200)));

    log('picked the paragraph', await pick(g, 'p.lead'));
    await key('Escape'); await sleep(200);
    await ui(`document.querySelector('.ann-list .ann').click(); 0`);
    await key('s'); await sleep(300);
    g.focus();
    let r = await rectOf(g, 'p.lead');
    mouse(g, 'mouseMove', r.x + r.w - 2, r.y + r.h / 2); mouse(g, 'mouseDown', r.x + r.w - 2, r.y + r.h / 2);
    for (let i = 1; i <= 6; i++) { mouse(g, 'mouseMove', r.x + r.w - 2 + i * 10, r.y + r.h / 2); await sleep(30); }
    mouse(g, 'mouseUp', r.x + r.w + 58, r.y + r.h / 2);
    await sleep(600);
    const sub1 = await ui(`document.querySelector('.ann-list .ann-sub').textContent`);
    const wNow = await g.executeJavaScript(`Math.round(document.querySelector('p.lead').getBoundingClientRect().width)`);
    log('dragging the edge resizes the element', /tweak/.test(sub1) && Math.abs(wNow - Math.round(r.w + 58)) <= 3, `${sub1} (${Math.round(r.w)} -> ${wNow})`);

    r = await rectOf(g, 'p.lead');
    const f = await rectOf(g, 'footer');
    mouse(g, 'mouseMove', r.x + 20, r.y + r.h / 2); mouse(g, 'mouseDown', r.x + 20, r.y + r.h / 2);
    for (let i = 1; i <= 8; i++) { mouse(g, 'mouseMove', r.x + 20, r.y + r.h / 2 + ((f.y + f.h + 10 - r.y) * i) / 8); await sleep(30); }
    mouse(g, 'mouseUp', r.x + 20, f.y + f.h + 10);
    await sleep(700);
    const order = await g.executeJavaScript(`[...document.querySelector('main').children].map((c) => c.tagName).join()`);
    const sub2 = await ui(`document.querySelector('.ann-list .ann-sub').textContent`);
    log('dragging the body moves it among its siblings', order === 'H1,BUTTON,FOOTER,P' && /moved to 4/.test(sub2), `${order} / ${sub2}`);
    await ui(`document.querySelector('.ann-list .ann').click(); 0`);
    await key('Escape'); await sleep(200);
    log('picked the moved paragraph', await pick(g, 'p.lead'));
    await sleep(400);
    await ui(`document.querySelector('.note-pop .note-pop-foot .btn.ghost').click(); 0`);
    await sleep(300);
    const src0 = read('src/App.jsx');
    const plan = await ui(`(async () => { const lines = [...document.querySelectorAll('.ann-list .ann-sub')].map((s) => s.textContent); return lines.join(' | '); })()`);
    log('annotation still carries the move', /moved to 4/.test(plan), plan);

    await key('Escape');
    await ui(`[...document.querySelectorAll('.vp-toggles > button')].find((b) => b.title.startsWith('Components')).click(); 0`);
    const names = await until(() => ui(`(() => { const l = [...document.querySelectorAll('.ws-list li b')].map((b) => b.textContent); return l.length ? l.join() : ''; })()`), 8000);
    log('workspace lists the project components', /Button/.test(names || '') && /App/.test(names || ''), names);
    await ui(`[...document.querySelectorAll('.ws-list li button')].find((b) => b.querySelector('b').textContent === 'Button').click(); 0`);
    const rendered = await until(() => g.executeJavaScript(`(() => { const w = document.getElementById('pinpoint-workspace'); const b = w && w.querySelector('button'); return b ? b.className + '|' + b.textContent : ''; })()`), 8000);
    log('component renders alone with its default props', rendered === 'btn primary sm|Label', rendered);
    const props = await ui(`[...document.querySelectorAll('.ws-prop > span')].map((s) => s.textContent).join()`);
    log('prop controls come from its types', props === 'label *,variant,size,disabled', props);
    await ui(`(() => { const s = [...document.querySelectorAll('.ws-prop')].find((p) => p.querySelector('span').textContent === 'variant').querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'danger'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const danger = await until(() => g.executeJavaScript(`(document.querySelector('#pinpoint-workspace button') || {}).className === 'btn danger sm'`), 5000);
    log('changing a prop re-renders it', danger === true);
    await ui(`document.querySelector('.ws-grid-toggle input').click(); 0`);
    const cells = await until(() => g.executeJavaScript(`(() => { const b = [...document.querySelectorAll('#pinpoint-workspace button')].map((x) => x.className); return b.length > 1 ? b.join(';') : ''; })()`), 5000);
    log('variant grid renders every combination', (cells || '').split(';').length === 6 && /btn ghost lg/.test(cells) && /btn danger sm/.test(cells), cells);
    try { fs.writeFileSync(path.join(OUT, 'workspace.png'), (await host.capturePage()).toPNG()); } catch {}
    await ui(`document.querySelector('.ws-head .icon-btn').click(); 0`);
    await sleep(400);
    log('closing the workspace gives the page back', (await g.executeJavaScript(`!document.getElementById('pinpoint-workspace')`)) === true);

    await g.executeJavaScript(`document.cookie = 'who=default; path=/'; localStorage.setItem('mine', '1'); 0`);
    await ui(`document.querySelector('.profile-btn').click(); 0`);
    await sleep(300);
    await ui(`[...document.querySelectorAll('.profile-row b')].find((b) => b.textContent === 'Admin').closest('button').click(); 0`);
    const g2 = await until(async () => guests().find((x) => x.id !== g.id && /5199/.test(x.getURL())), 10000);
    await sleep(3500);
    const seen = g2 ? await g2.executeJavaScript(`[localStorage.getItem('role'), localStorage.getItem('newNav'), localStorage.getItem('mine'), document.cookie, navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone].join('|')`) : 'no page';
    log('profile: own storage, flags set, language and time zone applied', seen === 'admin|true||' + '|de-DE|Asia/Tokyo', seen);
    log('the tab says who it is viewed as', (await ui(`document.querySelector('.profile-btn').textContent`)) === 'Admin');
    try { fs.writeFileSync(path.join(OUT, 'profile.png'), (await host.capturePage()).toPNG()); } catch {}
    log('no errors in the app console', errors.length === 0, errors.join(' | '));
  } catch (e) { log('exception', false, e.stack); }
  stopVite();
  fs.appendFileSync(path.join(OUT, 'vite.out'), '[done]' + String.fromCharCode(10));
  app.exit(0);
});
