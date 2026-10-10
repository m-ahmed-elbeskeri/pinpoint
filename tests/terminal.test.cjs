const OUT = process.env.PP_OUT || __dirname;
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const repo = process.cwd();
const NL = String.fromCharCode(10);
const out = [];
const log = (name, ok, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + String(extra).slice(0, 300) : ''}`); fs.writeFileSync(path.join(OUT, 'terminal.out'), out.join(NL) + NL); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-term-'));
fs.writeFileSync(path.join(proj, 'index.html'), '<!doctype html><html lang="en"><head><title>Home</title></head><body><h1>Home</h1></body></html>');
fs.writeFileSync(path.join(proj, 'marker-file.txt'), 'x');

const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(fs.readFileSync(path.join(proj, 'index.html'))); });
server.listen(0, '127.0.0.1', () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ud-'));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ projectDir: proj, url: base + '/', a11yCheck: false, routeCheck: false, perfCheck: false }));
  process.env.PINPOINT_USER_DATA = ud;
  const { app, BrowserWindow } = require('electron');
  require(path.join(repo, 'electron', 'main.cjs'));
  const terminal = require(path.join(repo, 'electron', 'terminal.cjs'));

  app.whenReady().then(async () => {
    await sleep(5000);
    const win = BrowserWindow.getAllWindows()[0];
    win.show(); win.focus();
    const host = win.webContents;
    const ui = (code) => host.executeJavaScript(code);
    const until = async (code, ms) => { for (let t = 0; t < ms; t += 300) { const v = await ui(code); if (v) return v; await sleep(300); } return null; };
    const screen = `[...document.querySelectorAll('.term-screen')].find((s) => s.style.display !== 'none')?.querySelector('.xterm-rows')?.innerText || ''`;
    const toggleDrawer = () => ui(`[...document.querySelectorAll('.top-right .icon-btn')].find((b) => /Terminal/.test(b.title)).click(); 0`);
    const errors = [];
    host.on('console-message', (e) => { if ((e.level === 'error' || e.level === 3) && !/Security Warning/.test(e.message)) errors.push(e.message.slice(0, 200)); });

    try {
      const found = terminal.shells();
      log('shells installed on this machine are found', found.length >= 1 && found.every((s) => fs.existsSync(s.path)), found.map((s) => s.name).join(', '));

      await until(`[...document.querySelectorAll('.top-right .icon-btn')].some((b) => /Terminal/.test(b.title)) ? 1 : 0`, 20000);
      await toggleDrawer();
      log('opening the drawer starts a terminal', await until(`document.querySelectorAll('.term-tab').length === 1 && document.querySelector('.xterm-rows') ? 1 : 0`, 10000) === 1);
      log('it runs the first shell found', (await ui(`document.querySelector('.term-tab span').textContent`)) === found[0].name);
      const id = (await ui(`window.pinpoint.termList()`))[0].id;

      await sleep(1500);
      await ui(`window.pinpoint.termWrite(${JSON.stringify(id)}, 'echo pin' + 'point-ok\\r'); 0`);
      log('a command runs and its output is shown', !!(await until(`/pinpoint-ok/.test(${screen}) ? 1 : 0`, 10000)), (await ui(screen)).slice(-200));
      await ui(`window.pinpoint.termWrite(${JSON.stringify(id)}, 'ls\\r'); 0`);
      log('it started in the project folder', !!(await until(`/marker-file\\.txt/.test(${screen}) ? 1 : 0`, 10000)), (await ui(screen)).slice(-200));

      await ui(`document.querySelector('.term-screen .xterm-helper-textarea').focus(); 0`);
      await host.insertText('echo typed-');
      await host.insertText('by-hand');
      host.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      host.sendInputEvent({ type: 'char', keyCode: 'Enter' });
      host.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      const typed = await until(`(${screen}.match(/typed-by-hand/g) || []).length >= 2 ? 1 : 0`, 8000);
      log('typing in it works', typed === 1, (await ui(screen)).slice(-200));

      const size = await ui(`(() => { const r = document.querySelector('.term-screen .xterm-screen').getBoundingClientRect(), b = document.querySelector('.term-body').getBoundingClientRect(); return [Math.round(r.width), Math.round(b.width), Math.round(r.height), Math.round(b.height)]; })()`);
      log('it fills the drawer', size[0] > size[1] * 0.85 && size[2] > size[3] * 0.6, size.join());

      await ui(`document.querySelectorAll('.term-plus')[1].click(); 0`);
      await sleep(300);
      const offered = await ui(`[...document.querySelectorAll('.term-menu button b')].map((b) => b.textContent)`);
      log('the shell list offers every shell found', offered.join() === found.map((s) => s.name).join(), offered.join(', '));
      try { fs.writeFileSync(path.join(OUT, 'terminal-shells.png'), (await host.capturePage()).toPNG()); } catch {  }
      const second = found[1] || found[0];
      await ui(`[...document.querySelectorAll('.term-menu button')].find((b) => b.querySelector('b').textContent === ${JSON.stringify(second.name)}).click(); 0`);
      log('picking one opens a second terminal with it', await until(`document.querySelectorAll('.term-tab').length === 2 && document.querySelector('.term-tab.on span').textContent === ${JSON.stringify(second.name)} ? 1 : 0`, 8000) === 1);
      await sleep(600);
      log('the choice is remembered for next time', JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).terminalShell === second.id);

      await ui(`document.querySelector('.term-tab').click(); 0`);
      await toggleDrawer();
      await sleep(500);
      log('the drawer closes', (await ui(`!!document.querySelector('.drawer')`)) === false);
      log('the terminals keep running while it is closed', (await ui(`window.pinpoint.termList()`)).filter((s) => !s.exited).length === 2);
      await ui(`window.pinpoint.termWrite(${JSON.stringify(id)}, 'echo while-' + 'closed\\r'); 0`);
      await sleep(1200);
      await toggleDrawer();
      await until(`document.querySelectorAll('.term-tab').length === 2 ? 1 : 0`, 6000);
      await ui(`document.querySelector('.term-tab').click(); 0`);
      const kept = terminal.attach(host, id).buffer;
      log('output is collected while the drawer is closed', /while-closed/.test(kept), JSON.stringify(kept.slice(-160)));
      log('reopening shows them again, with what happened meanwhile', !!(await until(`/while-closed/.test(${screen}) ? 1 : 0`, 8000)), JSON.stringify(await ui(screen)).slice(-300));

      await ui(`document.querySelector('.term-tab.on button').click(); 0`);
      await sleep(600);
      log('closing a terminal ends it', (await ui(`document.querySelectorAll('.term-tab').length`)) === 1 && (await ui(`window.pinpoint.termList()`)).length === 1);
      try { fs.writeFileSync(path.join(OUT, 'terminal.png'), (await host.capturePage()).toPNG()); } catch {  }

      await ui(`[...document.querySelectorAll('.drawer .tabs button')].find((b) => /Dev server/.test(b.textContent)).click(); 0`);
      await sleep(300);
      log('the dev server tab is still there', (await ui(`!!document.querySelector('.dev-cmd') && getComputedStyle(document.querySelector('.term-wrap')).display === 'none'`)) === true);
      log('no errors in the app console', errors.length === 0, errors.join(' | '));
    } catch (e) { log('exception', false, e.stack); }
    server.close();
    fs.appendFileSync(path.join(OUT, 'terminal.out'), '[done]' + String.fromCharCode(10));
    app.exit(0);
  });
});
