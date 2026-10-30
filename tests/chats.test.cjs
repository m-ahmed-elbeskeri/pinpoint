const OUT = process.env.PP_OUT || __dirname;
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const repo = process.cwd();
const NL = String.fromCharCode(10);
const out = [];
const log = (name, ok, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + String(extra).slice(0, 300) : ''}`); fs.writeFileSync(path.join(OUT, 'chats.out'), out.join(NL) + NL); };
const { sleep, started, poll } = require(require('node:path').join(process.cwd(), 'tests', 'wait.cjs'));

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
    "    if (m.type === 'control_response' && m.response && m.response.request_id === 'perm-1') {",
  "      const ok = m.response.response.behavior === 'allow';",
  "      emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'bash-1', is_error: !ok, content: ok ? 'tests passed' : 'denied' }] } });",
  "      emit({ type: 'assistant', message: { content: [{ type: 'text', text: ok ? 'Permission granted, tests ran.' : 'Permission denied, skipped.' }] } });",
  "      emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'todo-2', name: 'TodoWrite', input: { todos: [{ content: 'Change the heading', status: 'completed', activeForm: 'Changing' }, { content: 'Run the tests', status: 'completed', activeForm: 'Running' }] } }] } });",
  "      emit({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, duration_ms: 300, num_turns: 1 });",
  "      continue;",
  "    }",
  "    if (m.type !== 'user') continue;",
  "    const text = m.message.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ');",
  "    const word = (text.match(/(slow|quick)-(\\w+)/) || [])[0] || 'other';",
    "    emit({ type: 'system', subtype: 'init', session_id: 'sess-' + word, model: 'stand-in' });",
  "    if (word === 'quick-ask') {",
  "      emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'todo-1', name: 'TodoWrite', input: { todos: [{ content: 'Change the heading', status: 'completed', activeForm: 'Changing' }, { content: 'Run the tests', status: 'in_progress', activeForm: 'Running the tests' }] } }] } });",
  "      emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'edit-1', name: 'Edit', input: { file_path: 'index.html', old_string: '<h1>Home</h1>', new_string: '<h1>Welcome home</h1>' } }] } });",
  "      emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'edit-1', content: 'ok' }] } });",
  "      emit({ type: 'control_request', request_id: 'perm-1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'npm test' } } });",
  "      continue;",
  "    }",
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
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ projectDir: proj, url: base + '/', claudePath: fakeBin, agent: 'claude', autoVerify: false, variants: 0, a11yCheck: false, routeCheck: false, perfCheck: false, statusBar: true }));
  process.env.PINPOINT_USER_DATA = ud;
  const { app, BrowserWindow, webContents } = require('electron');
  require(path.join(repo, 'electron', 'main.cjs'));

  app.whenReady().then(async () => {
    await started(require('electron'));
    const win = BrowserWindow.getAllWindows()[0];
    win.show(); win.focus();
    const host = win.webContents;
    const ui = (code) => host.executeJavaScript(code);
    const until = poll(ui, 300);
    const send = async (text) => {
      await ui(`(() => { const t = document.querySelector('.composer-box textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(200);
      await ui(`document.querySelector('.send-btn.primary').click(); 0`);
    };
    const newChat = () => ui(`[...document.querySelectorAll('.panel-head .btn')].find((b) => /New chat/.test(b.textContent)).click(); 0`);
    const userText = () => ui(`[...document.querySelectorAll('.chat .msg.user')].map((m) => m.textContent).join(' | ')`);
    const chips = () => ui(`[...document.querySelectorAll('.threads .thread:not(.on)')].filter((t) => t.matches('.running, .finished')).map((t) => (t.classList.contains('running') ? 'running' : 'finished') + ':' + t.querySelector('.thread-title').textContent).join(' | ')`);
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

      log('the first chat is marked finished when its agent is done', !!(await until(`document.querySelector('.threads .thread.finished') ? 1 : 0`, 15000)), await chips());
      log('its file was written too', fs.existsSync(path.join(proj, 'slow-alpha.txt')));
      const saved = () => fs.readdirSync(path.join(proj, '.pinpoint', 'chats')).map((f) => JSON.parse(fs.readFileSync(path.join(proj, '.pinpoint', 'chats', f), 'utf8')));
      await sleep(900);
      const alpha = saved().find((c) => /slow-alpha/.test(c.title));
      log('and saved with its result', !!alpha && alpha.items.some((i) => i.kind === 'done') && alpha.items.some((i) => i.kind === 'text' && /Wrote slow-alpha/.test(i.text)), alpha ? alpha.items.map((i) => i.kind).join() : 'not saved');

      await ui(`document.querySelector('.threads .thread.finished').click(); 0`);
      await sleep(700);
      log('opening it shows its whole conversation', (await userText()).includes('slow-alpha') && (await ui(`document.querySelectorAll('.chat .done-card').length`)) === 1 && /Wrote slow-alpha/.test(await ui(`document.querySelector('.chat').innerText`)), await userText());
      log('its result lists only the file it wrote itself', /Changed 1 file/.test(await ui(`document.querySelector('.chat .done-card').innerText`)) && !/quick-beta/.test(await ui(`document.querySelector('.chat .done-card').innerText`)), await ui(`document.querySelector('.chat .done-card').innerText.slice(0, 80)`));
      log('the reminder goes away once it has been looked at', (await chips()) === '', await chips());

      await send('slow-gamma please');
      await until(`document.querySelector('.chat .working') ? 1 : 0`, 8000);
      await sleep(500);
      await sleep(500);
      log('the sidebar lists both chats', (await ui(`document.querySelectorAll('.history-item').length`)) === 2);
      await ui(`[...document.querySelectorAll('.history-item')].find((i) => /quick-beta/.test(i.textContent)).click(); 0`);
      await sleep(700);
      log('switching to the other chat leaves the first working', (await userText()).includes('quick-beta') && /running/.test(await chips()) && !(await ui(`!!document.querySelector('.chat .working')`)), await chips());
      await ui(`document.querySelector('.threads .thread.running:not(.on)').click(); 0`);
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

      const mainBefore = await userText();
      await ui(`document.querySelector('.ptab-new').click(); 0`);
      await sleep(300);
      log('a side chat opens as a tab in the chat panel', await ui(`document.querySelectorAll('.ptab.side.on').length === 1 && !!document.querySelector('.side-chat:not(.hidden)') && getComputedStyle(document.querySelector('.chat')).display === 'none'`));
      await ui(`(() => { const t = document.querySelector('.side-chat:not(.hidden) .side-foot textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'quick-aside what is this?'); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(150);
      await ui(`document.querySelector('.side-chat:not(.hidden) .side-send').click(); 0`);
      const answer = await until(`/Wrote /.test(document.querySelector('.side-chat:not(.hidden) .side-body')?.innerText || '') ? document.querySelector('.side-chat:not(.hidden) .side-body').innerText : ''`, 15000);
      log('a side question gets its answer in the side chat', /Starting on/.test(answer || '') && /Wrote /.test(answer || ''), answer);
      await sleep(400);
      log('and leaves the main chat alone', (await userText()) === mainBefore && !(await ui(`document.querySelector('.chat').innerText.includes('quick-aside')`)));
      log('the tab is named after the question', /quick-aside/.test(await ui(`document.querySelector('.ptab.side').textContent`)));
      await ui(`document.querySelector('.ptab-new').click(); 0`);
      await sleep(200);
      log('several side chats can be open, each starting empty', (await ui(`document.querySelectorAll('.ptab.side').length`)) === 2 && (await ui(`document.querySelectorAll('.side-chat:not(.hidden) .side-body > *').length`)) === 0);
      await ui(`document.querySelector('.ptab:not(.side)').click(); 0`);
      await sleep(200);
      log('the Chat tab brings the main chat back', await ui(`getComputedStyle(document.querySelector('.chat')).display !== 'none' && !document.querySelector('.side-chat:not(.hidden)')`));
      log('nothing is left under Running once the side question is answered', (await until(`document.querySelector('.threads .task') ? 0 : 1`, 5000)) === 1, await ui(`[...document.querySelectorAll('.threads .task')].map((t) => t.textContent).join(' | ')`));

      await ui(`document.querySelector('.ptab:not(.side)').click(); 0`);
      const cardsBeforeAsk = await ui(`document.querySelectorAll('.chat .done-card').length`);
      await send('quick-ask please');
      const asked = await until(`document.querySelector('.chat .approval.pending')?.innerText || ''`, 8000);
      log('the agent asking to run a command shows an approval card', /Bash/.test(asked || '') && /npm test/.test(asked || '') && /Allow once/.test(asked || ''), asked);
      log('the chat is marked as needing you in the sidebar', /needs you/.test(await ui(`document.querySelector('.thread.on')?.textContent || ''`)));
      log('the plan shows as a checklist with progress', (await ui(`document.querySelectorAll('.chat .plan-card li').length`)) === 2 && /1 of 2 done/.test(await ui(`document.querySelector('.chat .plan-card').innerText`)));
      await ui(`document.querySelector('.chat .approval.pending .btn.primary').click(); 0`);
      const after = await until(`document.querySelectorAll('.chat .done-card').length > ${cardsBeforeAsk} ? document.querySelector('.chat').innerText : ''`, 8000);
      log('allowing it lets the agent carry on', /Permission granted/.test(after || ''), (after || '').slice(-200));
      log('the card records the answer', /Allowed once/.test(await ui(`document.querySelector('.chat .approval').innerText`)));
      log('the plan updates in place', (await ui(`document.querySelectorAll('.chat .plan-card').length`)) === 1 && /2 of 2 done/.test(await ui(`document.querySelector('.chat .plan-card').innerText`)));
      await ui(`[...document.querySelectorAll('.chat .tool-row .tool-head')].find((h) => /Edit/.test(h.textContent)).click(); 0`);
      await sleep(200);
      log('an edit step opens to a red/green diff', (await ui(`document.querySelectorAll('.chat .step-diff .add').length`)) === 1 && /Welcome home/.test(await ui(`document.querySelector('.chat .step-diff .add').textContent`)) && (await ui(`document.querySelectorAll('.chat .step-diff .del').length`)) === 1);

      const typeIn = (text) => ui(`(() => { const t = document.querySelector('.composer-box textarea'); t.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      const key = (k) => ui(`document.querySelector('.composer-box textarea').dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true })); 0`);
      await typeIn('look at @ind');
      const files = await until(`[...document.querySelectorAll('.assist-item')].map((b) => b.textContent).join(' | ')`, 5000);
      log('typing @ lists matching project files', /index\.html/.test(files || ''), files);
      await key('Tab');
      await sleep(200);
      log('picking one puts its path in the message', (await ui(`document.querySelector('.composer-box textarea').value`)) === 'look at @index.html ', await ui(`document.querySelector('.composer-box textarea').value`));
      await typeIn('/pla');
      const cmds = await until(`[...document.querySelectorAll('.assist-item')].map((b) => b.textContent).join(' | ')`, 3000);
      log('typing / lists commands', /\/plan/.test(cmds || ''), cmds);
      await key('Enter');
      await sleep(400);
      log('a command runs and clears the box', (await ui(`document.querySelector('.composer-box textarea').value`)) === '' && JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).claudePermission === 'plan' && !!(await ui(`!!document.querySelector('.plan-pill')`)));
      await ui(`document.querySelector('.plan-pill').click(); 0`);
      await sleep(300);
      log('the Plan only pill switches it back off', JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).claudePermission === 'acceptEdits');

      // Batch 1: quick replies, message actions, chat menu, palette search, status bar, shortcuts.
      await until(`document.querySelector('.chat .working') ? 0 : 1`, 15000);
      log('a finished run offers quick replies', (await ui(`document.querySelectorAll('.quick-replies button').length`)) === 3);
      await ui(`document.querySelector('.msg.user .msg-actions button:nth-child(2)').click(); 0`);
      await sleep(150);
      log('Edit puts a message back in the composer', (await ui(`document.querySelector('.composer-box textarea').value`)) === (await ui(`document.querySelector('.msg.user .msg-text').textContent`)));
      await typeIn('');
      const usersBefore = await ui(`document.querySelectorAll('.chat .msg.user').length`);
      await ui(`document.querySelector('.quick-replies button').click(); 0`);
      await until(`document.querySelectorAll('.chat .msg.user').length > ${usersBefore} ? 1 : 0`, 5000);
      log('a quick reply sends that message', /Continue|Try again/.test(await ui(`[...document.querySelectorAll('.chat .msg.user')].pop().textContent`)));
      await until(`document.querySelector('.chat .working') ? 0 : 1`, 15000);

      const menu = async (label) => {
        await ui(`document.querySelector('.thread.on .thread-more').click(); 0`);
        await sleep(150);
        await ui(`[...document.querySelectorAll('.thread-menu button')].find((b) => b.textContent.includes(${JSON.stringify(label)})).click(); 0`);
        await sleep(300);
      };
      const current = await ui(`[...document.querySelectorAll('.thread')].findIndex((t) => t.classList.contains('on'))`);
      await menu('Rename');
      await ui(`(() => { const i = document.querySelector('.thread-rename'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'My renamed chat'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
      await sleep(900);
      log('a chat can be renamed from its menu, and the name sticks', /My renamed chat/.test(await ui(`document.querySelector('.thread.on').textContent`)) && saved().some((c) => c.renamed === 'My renamed chat'), current);
      await menu('Pin to top');
      log('pinning puts it in a Pinned group', (await ui(`[...document.querySelectorAll('.threads-label')].some((l) => l.textContent === 'Pinned')`)) && saved().some((c) => c.pinned));
      await menu('Archive');
      log('archiving hides it behind Show archived', !(await ui(`!!document.querySelector('.thread.on')`)) && /Show archived \(1\)/.test(await ui(`document.querySelector('.threads-more')?.textContent || ''`)));
      await ui(`document.querySelector('.threads-more').click(); 0`);
      await sleep(200);
      log('and Show archived brings it back into view', await ui(`!!document.querySelector('.thread.on')`));

      await ui(`document.querySelector('.cmd-pill').click(); 0`);
      await sleep(200);
      await ui(`(() => { const i = document.querySelector('.cmd-input input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Wrote quick-beta'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      const hits = await until(`[...document.querySelectorAll('.cmd-item')].filter((b) => /In chats/.test(b.textContent)).map((b) => b.textContent).join(' | ')`, 4000);
      log('the palette finds chats by what was said in them', /quick-beta/.test(hits || ''), hits);
      await ui(`document.querySelector('.cmd-input input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 0`);
      await sleep(150);

      log('the status bar shows the agent', /9\.9\.9|Claude Code/.test(await ui(`document.querySelector('.statusbar')?.textContent || ''`)));
      await ui(`document.activeElement && document.activeElement.blur(); window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true })); 0`);
      await sleep(200);
      log('? opens the shortcuts sheet', await ui(`!!document.querySelector('.modal.shortcuts')`));
      await ui(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 0`);

      // Batch 2: history, snippets, paste chips, image chips.
      await until(`document.querySelector('.chat .working') ? 0 : 1`, 15000);
      await typeIn('');
      await key('ArrowUp');
      await sleep(150);
      const recalled = await ui(`document.querySelector('.composer-box textarea').value`);
      log('↑ in an empty composer brings back what was sent last', /Continue|Try again|quick-ask/.test(recalled), recalled);
      await key('ArrowDown');
      await sleep(150);
      log('and ↓ returns to an empty box', (await ui(`document.querySelector('.composer-box textarea').value`)) === '');
      await typeIn('/save make the header sticky');
      await until(`document.querySelector('.assist-item') ? 1 : 0`, 3000);
      await key('Enter');
      await sleep(500);
      const snips = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).snippets || [];
      log('/save keeps a snippet', snips.some((x) => x.name === 'make-the-header' && x.text === 'make the header sticky'), JSON.stringify(snips));
      await typeIn('/make');
      const offered = await until(`[...document.querySelectorAll('.assist-item')].map((b) => b.textContent).join(' | ')`, 3000);
      log('and offers it in the / menu', /make-the-header/.test(offered || ''), offered);
      await key('Enter');
      await sleep(200);
      log('picking it fills the composer', (await ui(`document.querySelector('.composer-box textarea').value`)) === 'make the header sticky');
      await typeIn('');

      await ui(`(() => { const t = document.querySelector('.composer-box textarea'); t.focus(); const dt = new DataTransfer(); dt.setData('text/plain', Array.from({ length: 60 }, (_, i) => 'log line ' + i).join(String.fromCharCode(10))); t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
      await sleep(200);
      log('a long paste becomes a chip, not text in the box', /60 lines/.test(await ui(`document.querySelector('.paste-chip')?.textContent || ''`)) && (await ui(`document.querySelector('.composer-box textarea').value`)) === '');
      await ui(`(async () => { const c = document.createElement('canvas'); c.width = c.height = 4; const blob = await new Promise((r) => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([blob], 'mock.png', { type: 'image/png' })); document.querySelector('.composer-box textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
      const chip = await until(`document.querySelector('.img-chip') ? 1 : 0`, 4000);
      log('a pasted image shows as a chip in the composer, not a row above it', chip === 1 && !(await ui(`[...document.querySelectorAll('.ann-list .ann')].some((a) => /mock/.test(a.textContent))`)));
      const usersNow = await ui(`document.querySelectorAll('.chat .msg.user').length`);
      await ui(`document.querySelector('.send-btn.primary').click(); 0`);
      await until(`document.querySelectorAll('.chat .msg.user').length > ${usersNow} ? 1 : 0`, 6000);
      const sent = await ui(`[...document.querySelectorAll('.chat .msg.user')].pop().textContent`);
      log('the pasted text goes with the message and the chips clear', /Pasted text/.test(sent) && /log line 59/.test(sent) && !(await ui(`!!document.querySelector('.paste-chip, .img-chip')`)), sent.slice(0, 120));
      await until(`document.querySelector('.chat .working') ? 0 : 1`, 15000);

      log('no errors in the app console', errors.length === 0, errors.join(' | '));
      try { fs.writeFileSync(path.join(OUT, 'chats-end.png'), (await host.capturePage()).toPNG()); } catch {  }
    } catch (e) { log('exception', false, e.stack); }
    server.close();
    fs.appendFileSync(path.join(OUT, 'chats.out'), '[done]' + String.fromCharCode(10));
    app.exit(0);
  });
});
