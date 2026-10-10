const OUT = process.env.PP_OUT || __dirname;
const FIX = process.env.PP_FIXTURES || __dirname;
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http');
const { execFileSync, execFile } = require('node:child_process');
const repo = process.cwd();
const NL = String.fromCharCode(10);
const out = [];
const log = (name, ok, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + String(extra).slice(0, 320) : ''}`); fs.writeFileSync(path.join(OUT, 'background.out'), out.join(NL) + NL); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-bg-'));
const page = (t) => `<!doctype html><html lang="en"><head><title>${t}</title><link rel="stylesheet" href="/style.css"></head><body><h1>${t}</h1><p>Text on the ${t} page.</p></body></html>`;
fs.writeFileSync(path.join(proj, 'index.html'), page('Home'));
fs.writeFileSync(path.join(proj, 'about.html'), page('About'));
fs.writeFileSync(path.join(proj, 'style.css'), 'body { font-family: system-ui; padding: 40px; background: #fff; }\nh1 { color: #111; }\n');
const git = (...a) => execFileSync('git', a, { cwd: proj, stdio: 'pipe' }).toString();
git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('add', '-A'); git('commit', '-q', '-m', 'init');
fs.appendFileSync(path.join(proj, 'style.css'), 'p { color: #333; }\n');
fs.writeFileSync(path.join(proj, 'notes.txt'), 'untracked\n');
const START = fs.readFileSync(path.join(proj, 'style.css'), 'utf8');

const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-agent-'));
const seenLog = path.join(agentDir, 'seen.log');
fs.writeFileSync(path.join(agentDir, 'fake-claude.js'), `
const fs = require('fs'), path = require('path');
if (process.argv.includes('--version')) { console.log('9.9.9 (stand-in)'); process.exit(0); }
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type !== 'user') continue;
    const text = m.message.content.filter((c) => c.type === 'text').map((c) => c.text).join('\\n');
    const css = path.join(process.cwd(), 'style.css');
    const had = fs.readFileSync(css, 'utf8');
    fs.appendFileSync(${JSON.stringify(seenLog)}, JSON.stringify({ cwd: process.cwd(), sawUncommitted: had.includes('p { color: #333; }'), sawUntracked: fs.existsSync(path.join(process.cwd(), 'notes.txt')), background: /separate copy of the project/.test(text), text: text.slice(0, 4000) }) + '\\n');
    emit({ type: 'system', subtype: 'init', session_id: 's', model: 'stand-in' });
    const color = /green/.test(text) ? '#0a0' : '#00c';
    setTimeout(() => {
      fs.writeFileSync(css, had + 'h1 { color: ' + color + '; }\\n');
      emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'Made the heading ' + color + '.' }] } });
      emit({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, duration_ms: 300, num_turns: 1 });
    }, /slow/.test(text) ? 2500 : 500);
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
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ projectDir: proj, url: base + '/', claudePath: fakeBin, agent: 'claude', a11yCheck: false, routeCheck: false, perfCheck: false }));
  process.env.PINPOINT_USER_DATA = ud;
  const { app, BrowserWindow } = require('electron');
  require(path.join(repo, 'electron', 'main.cjs'));

  app.whenReady().then(async () => {
    await sleep(5000);
    const win = BrowserWindow.getAllWindows()[0];
    win.show(); win.focus();
    const host = win.webContents;
    const ui = (c) => host.executeJavaScript(c);
    const until = async (code, ms) => { for (let t = 0; t < ms; t += 400) { const v = await ui(code); if (v) return v; await sleep(400); } return null; };
    const type = (text) => ui(`(() => { const t = document.querySelector('.composer-box textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const seen = () => (fs.existsSync(seenLog) ? fs.readFileSync(seenLog, 'utf8').trim().split(NL).map((l) => JSON.parse(l)) : []);
    const worktrees = () => git('worktree', 'list').trim().split('\n').length;
    const errors = [];
    host.on('console-message', (e) => { if ((e.level === 'error' || e.level === 3) && !/Security Warning/.test(e.message)) errors.push(e.message.slice(0, 160)); });

    try {
      log('background button is available in a git project', (await until(`document.querySelector('.bg-btn') && !document.querySelector('.bg-btn').title.startsWith('Background runs need') ? 1 : 0`, 8000)) === 1);
      await type('Make the heading blue (slow)');
      await sleep(200);
      await ui(`document.querySelector('.bg-btn').click(); 0`);
      await sleep(1500);
      await type('Make the heading green');
      await sleep(200);
      await ui(`document.querySelector('.bg-btn').click(); 0`);
      const both = await until(`document.querySelectorAll('.bg-run').length === 2 ? 1 : 0`, 15000);
      log('two background runs started', both === 1);
      const done = await until(`document.querySelectorAll('.bg-run.done').length === 2 ? 1 : 0`, 60000);
      log('both finished', done === 1, await ui(`[...document.querySelectorAll('.bg-run .bg-head')].map((h) => h.innerText.replace(/\\s+/g, ' ')).join(' | ')`));
      const s = seen();
      log('each ran in its own copy, not in the project', s.length === 2 && s[0].cwd !== s[1].cwd && s.every((x) => path.resolve(x.cwd) !== path.resolve(proj)), s.map((x) => x.cwd).join(' | '));
      log('the copies had the uncommitted and untracked work', s.every((x) => x.sawUncommitted && x.sawUntracked));
      log('the agent was told it works in a copy', s.every((x) => x.background));
      log('the project itself is untouched so far', fs.readFileSync(path.join(proj, 'style.css'), 'utf8') === START && worktrees() === 3, `worktrees: ${worktrees()}`);
      try { fs.writeFileSync(path.join(OUT, 'bg.png'), (await host.capturePage()).toPNG()); } catch {}

      await ui(`[...document.querySelectorAll('.bg-run')].find((r) => /green/.test(r.innerText)).querySelector('.bg-actions .btn:not(.primary):not(.ghost)').click(); 0`);
      const patch = await until(`document.querySelector('.patch-view')?.innerText || ''`, 5000);
      log('diff shows only what the run changed', /\+h1 \{ color: #0a0; \}/.test(patch || '') && !/notes\.txt/.test(patch || '') && !/\+p \{ color: #333/.test(patch || ''), (patch || '').slice(0, 200));
      await ui(`document.querySelector('.compare-modal .icon-btn').click(); 0`);
      await ui(`[...document.querySelectorAll('.bg-run')].find((r) => /green/.test(r.innerText)).querySelector('.btn.primary').click(); 0`);
      await sleep(2500);
      const after = fs.readFileSync(path.join(proj, 'style.css'), 'utf8');
      log('apply brings the change into the project', after === START + 'h1 { color: #0a0; }\n', JSON.stringify(after.slice(-60)));
      const card = await ui(`[...document.querySelectorAll('.done-card .done-head > span:first-of-type')].map((x) => x.textContent).join(' | ')`);
      log('applied run appears in the chat, undoable', /Background run applied · 1 file/.test(card), card);
      await ui(`[...document.querySelectorAll('.bg-run')].find((r) => /blue/.test(r.innerText)).querySelector('.btn.primary').click(); 0`);
      const conflict = await until(`document.querySelector('.toast')?.textContent || ''`, 6000);
      log('a run that no longer fits is refused, not half-applied', /no longer fit/.test(conflict || '') && fs.readFileSync(path.join(proj, 'style.css'), 'utf8') === after, conflict);
      await ui(`[...document.querySelectorAll('.bg-run')].find((r) => /blue/.test(r.innerText)).querySelector('.btn.ghost').click(); 0`);
      await sleep(2500);
      log('discard removes the copy', (await ui(`document.querySelectorAll('.bg-run').length`)) === 0 && worktrees() === 1, `worktrees: ${worktrees()}`);
      log('no errors in the app console', errors.length === 0, errors.join(' | '));
    } catch (e) { log('exception', false, e.stack); }

    try {
      const { newer } = require(path.join(repo, 'electron', 'updater.cjs'));
      log('update version comparison', newer('0.10.0', '0.9.9') && newer('v1.0.0', '0.9.9') && !newer('0.3.0', '0.3.0') && !newer('0.2.9', '0.3.0') && newer('0.3.1', '0.3.0'));
    } catch (e) { log('updater exception', false, e.stack); }

    server.close();
    fs.appendFileSync(path.join(OUT, 'background.out'), '[done]' + String.fromCharCode(10));
  app.exit(0);
  });
});
