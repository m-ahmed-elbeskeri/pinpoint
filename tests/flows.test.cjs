const OUT = process.env.PP_OUT || __dirname;
const FIX = process.env.PP_FIXTURES || __dirname;
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const repo = process.cwd();
const NL = String.fromCharCode(10);
const out = [];
const log = (name, ok, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + String(extra).slice(0, 300) : ''}`); fs.writeFileSync(path.join(OUT, 'flows.out'), out.join(NL) + NL); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-e2e-'));
const page = (title) => `<!doctype html><html lang="en"><head><title>${title}</title><link rel="stylesheet" href="/style.css"></head><body><h1>${title}</h1><p>Some text on the ${title} page.</p><a href="/about.html">About</a></body></html>`;
fs.writeFileSync(path.join(proj, 'index.html'), page('Home'));
fs.writeFileSync(path.join(proj, 'about.html'), page('About'));
const CSS0 = 'body { font-family: system-ui; padding: 40px; background: #ffffff; }' + NL + 'h1 { color: #111111; }' + NL;
fs.writeFileSync(path.join(proj, 'style.css'), CSS0);

const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-agent-'));
const promptLog = path.join(agentDir, 'prompts.log');
fs.writeFileSync(path.join(agentDir, 'fake-claude.js'), `
const fs = require('fs'), path = require('path');
if (process.argv.includes('--version')) { console.log('9.9.9 (stand-in)'); process.exit(0); }
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const css = path.join(process.cwd(), 'style.css');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type !== 'user') continue;
    const text = m.message.content.filter((c) => c.type === 'text').map((c) => c.text).join('\\n');
    const images = m.message.content.filter((c) => c.type === 'image').length;
    fs.appendFileSync(${JSON.stringify(promptLog)}, JSON.stringify({ text, images }) + '\\n');
    emit({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'stand-in' });
    let reply;
    const variant = text.match(/## Variant (\\d+) of/);
    if (/Automatic check from Pinpoint/.test(text)) reply = 'Looked at the screenshot: it matches the request.';
    else if (/Tidy the stylesheet/.test(text)) { fs.writeFileSync(css, fs.readFileSync(css, 'utf8') + '/* tidied */\\n'); reply = 'Tidied style.css.'; }
    else if (/Selected element/.test(text)) { fs.writeFileSync(css, fs.readFileSync(css, 'utf8') + 'h1 { letter-spacing: 6px; }\\np { color: #008800; }\\n'); reply = 'Spaced out the heading (and, by mistake, recolored the paragraph).'; }
    else if (variant) { fs.writeFileSync(css, fs.readFileSync(css, 'utf8') + 'h1 { color: ' + ['#cc0000', '#0000cc', '#00aa00', '#aa00aa'][variant[1] - 1] + '; font-size: ' + (40 + variant[1] * 20) + 'px; }\\n'); reply = 'Variant ' + variant[1] + ' done.'; }
    else { fs.writeFileSync(css, fs.readFileSync(css, 'utf8') + 'h1 { color: #d40000; }\\n'); reply = 'Changed the heading color in style.css.'; }
    setTimeout(() => {
      emit({ type: 'assistant', message: { content: [{ type: 'text', text: reply }] } });
      emit({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, duration_ms: 400, num_turns: 1 });
    }, 400);
  }
});
`);
const fakeBin = path.join(agentDir, 'fake-claude.cmd');
fs.writeFileSync(fakeBin, '@node "%~dp0fake-claude.js" %*\r\n');

const server = http.createServer((req, res) => {
  const file = path.join(proj, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('no'); }
  res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/html');
  res.setHeader('cache-control', 'no-store');
  res.end(fs.readFileSync(file));
});

server.listen(0, '127.0.0.1', () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ud-'));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ projectDir: proj, url: base + '/', claudePath: fakeBin, agent: 'claude', autoVerify: true, variants: 0, a11yCheck: false }));
  process.env.PINPOINT_USER_DATA = ud;
  const { app, BrowserWindow, webContents } = require('electron');
  require(path.join(repo, 'electron', 'main.cjs'));

  app.whenReady().then(async () => {
    await sleep(5000);
    const appWin = BrowserWindow.getAllWindows()[0];
    appWin.show(); appWin.focus();
    const host = appWin.webContents;
    const guest = webContents.getAllWebContents().find((w) => w.getType() === 'webview');
    const ui = (code) => host.executeJavaScript(code);
    const until = async (code, ms) => { for (let t = 0; t < ms; t += 400) { const v = await ui(code); if (v) return v; await sleep(400); } return null; };
    const prompts = () => (fs.existsSync(promptLog) ? fs.readFileSync(promptLog, 'utf8').trim().split(NL).map((l) => JSON.parse(l)) : []);
    const send = async (text) => {
      await ui(`(() => { const t = document.querySelector('.composer-box textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(200);
      await ui(`document.querySelector('.send-btn.primary').click(); 0`);
    };
    const cards = () => ui(`[...document.querySelectorAll('.done-card .done-head > span:first-of-type')].map((s) => s.textContent)`);
    const shot = async (name) => {
      for (let i = 0; i < 3; i++) {
        try { fs.writeFileSync(path.join(OUT, `e2e-${name}.png`), (await host.capturePage()).toPNG()); return; } catch { await sleep(700); appWin.show(); }
      }
    };
    const errors = [];
    host.on('console-message', (e) => { if ((e.level === 'error' || e.level === 3) && !/Security Warning/.test(e.message)) errors.push(e.message.slice(0, 200)); });

    try {
      log('app loaded the project page', /Home/.test(guest.getTitle()), guest.getTitle());
      log('stand-in agent detected', await until(`document.querySelector('.agent-seg button.on') && !document.querySelector('.agent-seg button.on.missing') && !document.querySelector('.warn-box') ? 1 : 0`, 8000) === 1);

      await send('Make the page background warmer');
      const first = await until(`document.querySelectorAll('.done-card').length >= 1 ? 1 : 0`, 30000);
      log('run finishes with a card', first === 1, (await cards()).join(' | '));
      log('the file was really changed', fs.readFileSync(path.join(proj, 'style.css'), 'utf8').includes('#d40000'));
      const p1 = prompts()[0];
      log('the agent got the request and the screenshot', !!p1 && /Make the page background warmer/.test(p1.text) && /Visual change request/.test(p1.text) && p1.images >= 1, p1 && `${p1.images} image(s)`);

      const checked = await until(`[...document.querySelectorAll('.done-card .done-head')].some((h) => /Checked the result/.test(h.textContent)) ? 1 : 0`, 40000);
      log('the result check ran as a second turn', checked === 1, (await cards()).join(' | '));
      const p2 = prompts().find((p) => /Automatic check from Pinpoint/.test(p.text));
      log('the check got before and after screenshots', !!p2 && p2.images === 2 && /After your changes/.test(p2.text) && /Before your changes/.test(p2.text), p2 && `${p2.images} image(s)`);
      log('it resumed the same session', prompts().length === 2);

      const routes = await until(`document.querySelector('.done-card .where')?.innerText || ''`, 40000);
      const all = await ui(`[...document.querySelectorAll('.done-card')][0].innerText`);
      const rows = await ui(`[...document.querySelectorAll('.done-card .where-row')].map((r) => r.innerText.replace(/\\s+/g, ' '))`);
      log('unintended change on the other page is flagged', /Also changed 1 other page/.test(all) && rows.some((r) => r.includes('/about.html')), String(routes).replace(/\s+/g, ' '));
      log('each changed page names what changed on it', rows.some((r) => r.includes('this page') && r.includes('<h1>') && r.includes('Home')) && rows.some((r) => r.includes('/about.html') && r.includes('<h1>') && r.includes('About')), rows.join(' || '));
      log('before/after screenshots attached to the run', await ui(`!!document.querySelector('.done-card .shot-strip')`));
      const perfShown = await until(`document.querySelector('.done-card .load-stats-btn') ? 1 : 0`, 15000);
      log('load stats are a click away', perfShown === 1, routes);
      await ui(`document.querySelector('.done-card .load-stats-btn').click(); 0`);
      log('the load stats open on the card', await until(`/Files requested/.test(document.querySelector('.done-card .load-stats')?.textContent || '') ? 1 : 0`, 3000) === 1);
      await shot('1-run');

      await ui(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true })); 0`);
      await sleep(300);
      for (let attempt = 0; attempt < 4; attempt++) {
        guest.focus();
        const hp = await guest.executeJavaScript(`(() => { const r = document.querySelector('h1').getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }; })()`);
        for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) guest.sendInputEvent({ type, x: hp.x, y: hp.y, button: 'left', clickCount: 1 });
        await sleep(2000);
        if (await ui(`document.querySelectorAll('.ann-list .ann').length`)) break;
        await ui(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true })); 0`);
        await sleep(300);
      }
      const doneBefore = (await cards()).length;
      await ui(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 0`);
      await send('Space the letters out');
      await until(`document.querySelectorAll('.done-card').length > ${doneBefore} ? 1 : 0`, 30000);
      const side = await until(`(() => { const rows = [...document.querySelectorAll('.done-card .where-row')].map((r) => r.innerText.replace(/\\s+/g, ' ')); const mine = rows.filter((r) => r.includes('what you pointed at')); return mine.length ? mine.join(' || ') : ''; })()`, 45000);
      const head = await ui(`[...document.querySelectorAll('.done-card .where-head')].map((h) => h.innerText).pop()`);
      log('same-page side effect is separated from what was pointed at', !!side && /<h1>/.test(side) && /and also <p>/.test(side), `${head} ${side}`);
      await until(`[...document.querySelectorAll('.done-card .done-head')].filter((h) => /Checked the result/.test(h.textContent)).length >= 2 ? 1 : 0`, 40000);
      await shot('1b-side-effect');

      const before3c = (await cards()).length;
      await send('Tidy the stylesheet');
      await until(`document.querySelectorAll('.done-card').length > ${before3c} ? 1 : 0`, 30000);
      const quiet = await until(`document.querySelector('.done-card .no-visual')?.innerText.replace(/\\s+/g, ' ') || ''`, 30000);
      const tag = await ui(`[...document.querySelectorAll('.done-card .no-visual-tag')].length`);
      const earlier = await ui(`[...document.querySelectorAll('.done-card')].slice(0, 1).some((c) => c.querySelector('.no-visual'))`);
      log('a run that changes nothing visible says so on its card', /No visible change on this page/.test(quiet || '') && tag === 1 && earlier === false, `${quiet} (tags: ${tag})`);
      await until(`[...document.querySelectorAll('.done-card .done-head')].filter((h) => /Checked the result/.test(h.textContent)).length >= 3 ? 1 : 0`, 40000);
      await shot('1c-no-visual');
      const checks = prompts().filter((p) => /Automatic check/.test(p.text));
      log('the result check is told when nothing visibly changed (and only then)', checks.length === 3 && /pixel-for-pixel identical/.test(checks[2].text) && !/pixel-for-pixel identical/.test(checks[1].text));

      await ui(`document.querySelector('.variants-btn').click(); 0`);
      await sleep(300);
      await ui(`[...document.querySelectorAll('.variants-row .chip')].find((c) => c.textContent === '2').click(); document.querySelector('.variants-btn').click(); 0`);
      const beforeVariants = fs.readFileSync(path.join(proj, 'style.css'), 'utf8');
      await send('Restyle the heading');
      const picker = await until(`document.querySelector('.variants-card') ? 1 : 0`, 90000);
      log('both variants ran and the picker appeared', picker === 1, (await cards()).join(' | '));
      const vp = prompts().filter((p) => /## Variant \d of 2/.test(p.text));
      log('each variant got its own instruction', vp.length === 2 && /Variant 1 of 2/.test(vp[0].text) && /restored to how they were/.test(vp[1].text));
      log('files are back at the starting point until one is picked', fs.readFileSync(path.join(proj, 'style.css'), 'utf8') === beforeVariants);
      const opts = await ui(`[...document.querySelectorAll('.variants-grid figcaption b')].map((b) => b.textContent)`);
      const thumbs = await until(`document.querySelectorAll('.variant-shot img').length`, 6000);
      log('picker shows both with screenshots', opts.join() === 'Variant 1,Variant 2' && thumbs === 2, `${opts.join()} thumbs=${thumbs}`);
      log('no result check was run on the variants', prompts().filter((p) => /Automatic check/.test(p.text)).length === 3);
      await ui(`document.querySelectorAll('.variants-grid figcaption .btn')[1].click(); 0`);
      await sleep(1500);
      const picked = fs.readFileSync(path.join(proj, 'style.css'), 'utf8');
      log('picking variant 2 applies its files', picked.includes('#0000cc') && !picked.includes('#cc0000'));
      await ui(`document.querySelectorAll('.variants-grid figcaption .btn')[0].click(); 0`);
      await sleep(1500);
      const switched = fs.readFileSync(path.join(proj, 'style.css'), 'utf8');
      log('switching to variant 1 swaps them', switched.includes('#cc0000') && !switched.includes('#0000cc'));
      await shot('2-variants');
      log('no errors in the app console', errors.length === 0, errors.join(' | '));
    } catch (err) { log('exception', false, err.stack); }
    server.close();
    fs.appendFileSync(path.join(OUT, 'flows.out'), '[done]' + String.fromCharCode(10));
  app.exit(0);
  });
});
