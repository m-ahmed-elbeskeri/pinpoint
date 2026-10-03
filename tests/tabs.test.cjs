// Browser tabs: open, switch, annotate on two pages, close, and reopen with the project.
const OUT = process.env.PP_OUT || __dirname;         // where results, screenshots and built helpers go
const FIX = process.env.PP_FIXTURES || __dirname;    // real projects some suites run against
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http');
const repo = process.cwd();
const NL = String.fromCharCode(10);
const out = [];
const log = (name, ok, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + String(extra).slice(0, 260) : ''}`); fs.writeFileSync(path.join(OUT, 'tabs.out'), out.join(NL) + NL); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = (t) => `<!doctype html><html lang="en"><head><title>${t}</title></head><body style="font-family:system-ui;padding:30px"><h1 id="h">${t} heading</h1><a id="pop" href="/about" target="_blank">open about in a new window</a></body></html>`;
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(page(req.url.startsWith('/about') ? 'About' : 'Home')); });
server.listen(0, '127.0.0.1', () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-proj-'));
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ud-'));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ projectDir: proj, url: base + '/', a11yCheck: false, routeCheck: false }));
  process.env.PINPOINT_USER_DATA = ud;
  const { app, BrowserWindow, webContents } = require('electron');
  require(path.join(repo, 'electron', 'main.cjs'));
  app.whenReady().then(async () => {
    await sleep(4500);
    const win = BrowserWindow.getAllWindows()[0];
    win.show(); win.focus();
    const host = win.webContents;
    const ui = (c) => host.executeJavaScript(c);
    const guests = () => webContents.getAllWebContents().filter((w) => w.getType() === 'webview');
    const titles = () => ui(`[...document.querySelectorAll('.tab > span')].map((s) => s.textContent)`);
    const saved = () => JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
    const key = (k) => ui(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true })); 0`);
    const pick = async (guest, sel) => {
      for (let i = 0; i < 3; i++) {
        guest.focus();
        const p = await guest.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + 15), y: Math.round(r.top + r.height / 2) }; })()`);
        for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) guest.sendInputEvent({ type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
        await sleep(1800);
        if (await ui(`!!document.querySelector('.note-pop')`)) return true;
      }
      return false;
    };
    try {
      log('starts with one tab on the project page', (await titles()).join() === 'Home' && guests().length === 1, (await titles()).join());
      await key('s');
      await sleep(300);
      const picked1 = await pick(guests()[0], '#h');
      await key('Escape');
      await ui(`document.querySelector('.tab-new').click(); 0`);
      await sleep(2500);
      log('new tab opens the same site', (await titles()).length === 2 && guests().length === 2, (await titles()).join(' | '));
      await ui(`(() => { const i = document.querySelector('.urlbar input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(base + '/about')}); i.dispatchEvent(new Event('input', { bubbles: true })); i.form.requestSubmit(); })()`);
      await sleep(2500);
      log('second tab navigates on its own', (await titles()).join(' | ') === 'Home | About', (await titles()).join(' | '));
      const shown = await ui(`[...document.querySelectorAll('.frame webview')].map((w) => getComputedStyle(w).visibility).join()`);
      const homeGuest = guests().find((g) => g.getURL() === base + '/');
      log('only the active tab is shown; the other stays loaded', shown === 'hidden,visible' && !!homeGuest && homeGuest.getTitle() === 'Home', shown);
      const about = guests().find((g) => g.getURL().includes('about'));
      await key('s');
      await sleep(300);
      const picked2 = await pick(about, '#h');
      await key('Escape');
      const anns = await ui(`document.querySelectorAll('.ann-list .ann').length`);
      log('annotations from both tabs sit in one request', picked1 && picked2 && anns === 2, `picked ${picked1}/${picked2}, ${anns} annotations`);
      const thumbs = await ui(`Promise.all([...document.querySelectorAll('.ann-thumb')].map(async (t) => { const img = t.querySelector('img'); if (!img) return 'no image'; const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let light = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200) light++; return img.naturalWidth + 'x' + img.naturalHeight + ' light=' + Math.round(100 * light / (d.length / 4)) + '%'; }))`);
      log('annotation close-ups show the page', thumbs.length === 2 && thumbs.every((t) => /light=([5-9]\d|100)%/.test(t)), thumbs.join(' | '));
      log('tabs with annotations are marked', (await ui(`document.querySelectorAll('.tab .tab-pin').length`)) === 2);
      try { fs.writeFileSync(path.join(OUT, 'tabs.png'), (await host.capturePage()).toPNG()); } catch { /* window covered */ }
      await ui(`document.querySelector('.ann-list .ann').click(); 0`);
      await sleep(700);
      log('clicking an annotation switches to its tab', (await ui(`document.querySelector('.tab.on > span').textContent`)) === 'Home');
      log('url bar follows the active tab', (await ui(`document.querySelector('.urlbar input').value`)) === base + '/');
      await homeGuest.executeJavaScript(`document.getElementById('pop').click(); 0`, true);
      await sleep(2500);
      log('a link that opens a new window opens a tab', (await titles()).length === 3 && guests().length === 3, (await titles()).join(' | '));
      await sleep(1200);
      const s = saved();
      log('open tabs are remembered with the project', Array.isArray(s.tabs) && s.tabs.length === 3 && s.tabs[0] === base + '/', JSON.stringify(s.tabs));
      await ui(`document.querySelector('.tab.on .tab-x').click(); 0`);
      await sleep(600);
      await ui(`document.querySelectorAll('.tab')[1].querySelector('.tab-x').click(); 0`);
      await sleep(800);
      log('closing tabs removes them and their annotations', (await titles()).join() === 'Home' && guests().length === 1 && (await ui(`document.querySelectorAll('.ann-list .ann').length`)) === 1, `${(await titles()).join(' | ')} / ${guests().length} pages`);
      await ui(`document.querySelector('.tab .tab-x').click(); 0`);
      await sleep(800);
      log('closing the last tab leaves a blank one', (await titles()).join() === 'New tab', (await titles()).join());
    } catch (e) { log('exception', false, e.stack); }
    server.close();
    fs.appendFileSync(path.join(OUT, 'tabs.out'), '[done]' + String.fromCharCode(10));
  app.exit(0);
  });
});
