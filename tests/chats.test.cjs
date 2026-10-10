const OUT = process.env.PP_OUT || __dirname;
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const repo = process.cwd();
const NL = String.fromCharCode(10);
const out = [];
const log = (name, ok, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + String(extra).slice(0, 300) : ''}`); fs.writeFileSync(path.join(OUT, 'chats.out'), out.join(NL) + NL); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-chats-'));
fs.writeFileSync(path.join(proj, 'index.html'), '<!doctype html><html lang="en"><head><title>Home</title></head><body><h1>Home</h1><div style="height:3000px"></div><button id="deep" style="padding:20px">Deep button</button><div style="height:1500px"></div></body></html>');

const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-agent-'));
fs.writeFileSync(path.join(agentDir, 'fake-claude.js'), [
  "const fs = require('fs'), path = require('path');",
  "if (process.argv.includes('--version')) { console.log('9.9.9 (stand-in)'); process.exit(0); }",
  "const emit = (o) => process.stdout.write(JSON.stringify(o) + String.fromCharCode(10));",
  "let buf = '';",
  "process.stdin.on('data', (d) => {",
  "  buf += d;",
  "  let i;",
  "  while ((i = buf.indexOf(String.fromCharCode(10))) >= 0) {",
  "    const line = buf.slice(0, i); buf = buf.slice(i + 1);",
  "    let m; try { m = JSON.parse(line); } catch { continue; }",
  "    if (m.type !== 'user') continue;",
  "    const text = m.message.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ');",
  "    const word = (text.match(/(slow|quick)-(\\w+)/) || [])[0] || 'other';",
  "    emit({ type: 'system', subtype: 'init', session_id: 'sess-' + word, model: 'stand-in' });",
  "    emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'Starting on ' + word + '.' }] } });",
  "    setTimeout(() => {",
  "      fs.writeFileSync(path.join(process.cwd(), word + '.txt'), 'done');",
  "      emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'Wrote ' + word + '.txt.' }] } });",
  "      emit({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, duration_ms: 400, num_turns: 1 });",
  "    }, /slow-/.test(word) ? 7000 : 300);",
  "  }",
  "});",
].join(NL));
const fakeBin = path.join(agentDir, 'fake-claude.cmd');
fs.writeFileSync(fakeBin, '@node "%~dp0fake-claude.js" %*' + String.fromCharCode(13, 10));

const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.setHeader('cache-control', 'no-store'); res.end(fs.readFileSync(path.join(proj, 'index.html'))); });
server.listen(0, '127.0.0.1', () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ud-'));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ projectDir: proj, url: base + '/', claudePath: fakeBin, agent: 'claude', autoVerify: false, variants: 0, a11yCheck: false, routeCheck: false, perfCheck: false }));
  process.env.PINPOINT_USER_DATA = ud;
  const { app, BrowserWindow, webContents } = require('electron');
  require(path.join(repo, 'electron', 'main.cjs'));

  app.whenReady().then(async () => {
    await sleep(5000);
    const win = BrowserWindow.getAllWindows()[0];
    win.show(); win.focus();
    const host = win.webContents;
    const ui = (code) => host.executeJavaScript(code);
    const until = async (code, ms) => { for (let t = 0; t < ms; t += 300) { const v = await ui(code); if (v) return v; await sleep(300); } return null; };
    const send = async (text) => {
      await ui(`(() => { const t = document.querySelector('.composer-box textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(200);
      await ui(`document.querySelector('.send-btn.primary').click(); 0`);
    };
    const newChat = () => ui(`[...document.querySelectorAll('.panel-head .btn')].find((b) => /New chat/.test(b.textContent)).click(); 0`);
    const userText = () => ui(`[...document.querySelectorAll('.chat .msg.user')].map((m) => m.textContent).join(' | ')`);
    const chips = () => ui(`[...document.querySelectorAll('.other-chats button')].map((b) => b.className + ':' + b.textContent).join(' | ')`);
    const errors = [];
    host.on('console-message', (e) => { if ((e.level === 'error' || e.level === 3) && !/Security Warning/.test(e.message)) errors.push(e.message.slice(0, 200)); });

    try {
      log('stand-in agent detected', await until(`document.querySelector('.agent-seg button.on') && !document.querySelector('.agent-seg button.on.missing') ? 1 : 0`, 8000) === 1);

      await send('slow-alpha please');
      log('the first chat is working', await until(`document.querySelector('.chat .working') ? 1 : 0`, 8000) === 1);
      await sleep(600);
      log('New chat can be pressed while it works', (await ui(`[...document.querySelectorAll('.panel-head .btn')].find((b) => /New chat/.test(b.textContent)).disabled`)) === false);
      await newChat();
      await sleep(400);
      log('the new chat starts empty and idle', (await ui(`document.querySelectorAll('.chat .msg').length + (document.querySelector('.chat .working') ? 100 : 0)`)) === 0);
      log('the first chat is listed as still working', /running:slow-alpha/.test(await chips()), await chips());

      await send('quick-beta please');
      log('the second chat finishes on its own', await until(`document.querySelectorAll('.chat .done-card').length === 1 ? 1 : 0`, 6000) === 1, await userText());
      log('only its own messages are in it', (await userText()).includes('quick-beta') && !(await userText()).includes('slow-alpha'), await userText());
      log('its file was written', fs.existsSync(path.join(proj, 'quick-beta.txt')));
      log('the first chat was still working then', !fs.existsSync(path.join(proj, 'slow-alpha.txt')) && /running:slow-alpha/.test(await chips()), await chips());

      log('the first chat is marked finished when its agent is done', !!(await until(`document.querySelector('.other-chats button.finished') ? 1 : 0`, 15000)), await chips());
      log('its file was written too', fs.existsSync(path.join(proj, 'slow-alpha.txt')));
      const saved = () => fs.readdirSync(path.join(proj, '.pinpoint', 'chats')).map((f) => JSON.parse(fs.readFileSync(path.join(proj, '.pinpoint', 'chats', f), 'utf8')));
      await sleep(900);
      const alpha = saved().find((c) => /slow-alpha/.test(c.title));
      log('and saved with its result', !!alpha && alpha.items.some((i) => i.kind === 'done') && alpha.items.some((i) => i.kind === 'text' && /Wrote slow-alpha/.test(i.text)), alpha ? alpha.items.map((i) => i.kind).join() : 'not saved');

      await ui(`document.querySelector('.other-chats button').click(); 0`);
      await sleep(700);
      log('opening it shows its whole conversation', (await userText()).includes('slow-alpha') && (await ui(`document.querySelectorAll('.chat .done-card').length`)) === 1 && /Wrote slow-alpha/.test(await ui(`document.querySelector('.chat').innerText`)), await userText());
      log('its result lists only the file it wrote itself', /Changed 1 file/.test(await ui(`document.querySelector('.chat .done-card').innerText`)) && !/quick-beta/.test(await ui(`document.querySelector('.chat .done-card').innerText`)), await ui(`document.querySelector('.chat .done-card').innerText.slice(0, 80)`));
      log('the reminder goes away once it has been looked at', (await chips()) === '', await chips());

      await send('slow-gamma please');
      await until(`document.querySelector('.chat .working') ? 1 : 0`, 8000);
      await sleep(500);
      await ui(`document.querySelector('.dd .icon-btn[title="Chat history"]').click(); 0`);
      await sleep(500);
      log('the history lists both chats', (await ui(`document.querySelectorAll('.history-item').length`)) === 2);
      await ui(`[...document.querySelectorAll('.history-item')].find((i) => /quick-beta/.test(i.textContent)).click(); 0`);
      await sleep(700);
      log('switching to the other chat leaves the first working', (await userText()).includes('quick-beta') && /running/.test(await chips()) && !(await ui(`!!document.querySelector('.chat .working')`)), await chips());
      await ui(`document.querySelector('.other-chats button.running').click(); 0`);
      await sleep(600);
      log('coming back shows it still working, with what it has said so far', (await ui(`!!document.querySelector('.chat .working')`)) && /Starting on slow-gamma/.test(await ui(`document.querySelector('.chat').innerText`)));
      log('and it finishes on screen', await until(`document.querySelectorAll('.chat .done-card').length === 2 ? 1 : 0`, 15000) === 1, await ui(`document.querySelectorAll('.chat .done-card').length`));
      log('each chat kept its own agent session', (() => { const s = saved(); return s.length === 2 && new Set(s.map((c) => c.session && c.session.id)).size === 2; })(), saved().map((c) => c.session && c.session.id).join());

      await ui(`(() => { const c = document.querySelector('.chat'); c.style.flex = 'none'; c.style.height = '160px'; })()`);
      await send('slow-delta please');
      await until(`document.querySelector('.chat .working') ? 1 : 0`, 8000);
      await sleep(400);
      const atEnd = await ui(`(() => { const c = document.querySelector('.chat'); return c.scrollHeight - c.scrollTop - c.clientHeight; })()`);
      log('sending a message goes to the end of the chat', atEnd < 12 && !(await ui(`!!document.querySelector('.to-latest')`)), atEnd);
      await ui(`(() => { const c = document.querySelector('.chat'); c.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true })); c.scrollTop = 40; })()`);
      await sleep(400);
      log('scrolling up shows a way back to the latest message', (await ui(`document.querySelector('.to-latest button')?.textContent.trim()`)) === 'Latest');
      await until(`document.querySelectorAll('.chat .done-card').length === 3 ? 1 : 0`, 15000);
      await sleep(400);
      log('new output does not pull the view back down', (await ui(`document.querySelector('.chat').scrollTop`)) === 40, await ui(`document.querySelector('.chat').scrollTop`));
      log('and the button says there is something new', (await ui(`document.querySelector('.to-latest button')?.textContent.trim()`)) === 'New messages' && (await ui(`document.querySelector('.to-latest button').classList.contains('fresh')`)));
      await ui(`document.querySelector('.to-latest button').click(); 0`);
      const back = await until(`(() => { const c = document.querySelector('.chat'); return c.scrollHeight - c.scrollTop - c.clientHeight < 12 && !document.querySelector('.to-latest') ? 1 : 0; })()`, 4000);
      log('pressing it goes to the end and the button leaves', back === 1);

      const guest = webContents.getAllWebContents().find((w) => w.getType() === 'webview');
      const pg = (code) => guest.executeJavaScript(code);
      await sleep(6000);
      const cardsBefore = await ui(`document.querySelectorAll('.chat .done-card').length`);
      await ui(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true })); 0`);
      await pg(`document.querySelector('#deep').scrollIntoView({ block: 'center', behavior: 'instant' }); 0`);
      await sleep(400);
      let picked = false;
      for (let attempt = 0; attempt < 3 && !picked; attempt++) {
        guest.focus();
        const p = await pg(`(() => { const r = document.querySelector('#deep').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
        for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) guest.sendInputEvent({ type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
        await sleep(1500);
        picked = await ui(`!!document.querySelector('.note-pop')`);
      }
      log('an element far down the page is picked', picked);
      await pg(`window.scrollTo({ top: 0, behavior: 'instant' }); 0`);
      await sleep(300);
      await send('slow-frame please');
      const inView = `(() => { const r = document.querySelector('#deep').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()`;
      const trail = [];
      let framed = false;
      for (let i = 0; i < 20 && !framed; i++) { await sleep(150); framed = await pg(inView); trail.push(await pg(`Math.round(scrollY)`)); }
      await sleep(1200);
      log('sending brings it back into view for the "before" screenshot', framed && (await pg(inView)) === true, 'scroll positions: ' + trail.join(','));
      await pg(`window.scrollTo({ top: 0, behavior: 'instant' }); 0`);
      await until(`document.querySelectorAll('.chat .done-card').length > ${cardsBefore} ? 1 : 0`, 15000);
      let again = false;
      for (let i = 0; i < 30 && !again; i++) { await sleep(400); again = await pg(inView); }
      log('the "after" screenshot is taken at the same place', again, await pg(`scrollY`));

      await until(`document.querySelector('.chat .working') ? 0 : 1`, 15000);
      await ui(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true })); 0`);
      await send('slow-steer please');
      await until(`document.querySelector('.chat .working') ? 1 : 0`, 8000);
      await sleep(500);
      await send('quick-also this');
      const waiting = await until(`document.querySelector('.msg.user.steer .steer-now') ? document.querySelector('.msg.user.steer:last-of-type .steer-tag, .msg.user.steer .steer-tag').textContent : ''`, 5000);
      log('a message sent while the agent works waits behind its current step, with a Send now button', /Steered after the current step/.test(waiting || '') && /Send now/.test(waiting || ''), waiting);
      await ui(`document.querySelector('.msg.user.steer .steer-now').click(); 0`);
      const forced = await until(`!document.querySelector('.steer-now') && /Interrupted and sent/.test([...document.querySelectorAll('.msg.user.steer .steer-tag')].pop().textContent) ? 1 : 0`, 5000);
      log('pressing it interrupts the agent and marks the message as sent', forced === 1, await ui(`[...document.querySelectorAll('.msg.user.steer .steer-tag')].pop().textContent`));
      await until(`document.querySelector('.chat .working') ? 0 : 1`, 20000);
      log('finished runs offer no Send now button', (await ui(`document.querySelectorAll('.steer-now').length`)) === 0);
      log('no errors in the app console', errors.length === 0, errors.join(' | '));
      try { fs.writeFileSync(path.join(OUT, 'chats-end.png'), (await host.capturePage()).toPNG()); } catch {  }
    } catch (e) { log('exception', false, e.stack); }
    server.close();
    fs.appendFileSync(path.join(OUT, 'chats.out'), '[done]' + String.fromCharCode(10));
    app.exit(0);
  });
});
