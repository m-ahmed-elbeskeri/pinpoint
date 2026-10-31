const { ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const buildsize = require('../project/buildsize.cjs');
const devserver = require('../project/devserver.cjs');
const { sleep } = require('../fsutil.cjs');
const terminal = require('../terminal.cjs');

function register(ctx) {
  const { loadSettings, saveSettings, projectDir, killTree, procs } = ctx;
  function startDevServer(sender, command) {
    const { projectDir } = loadSettings();
    if (!projectDir) throw new Error('Pick a project folder first.');
    if (procs.dev) killTree(procs.dev);
    saveSettings({ devCommand: command });
    const send = (evt) => { if (!sender.isDestroyed()) sender.send('dev:event', evt); };
    procs.dev = spawn(command, { cwd: projectDir, shell: true, detached: process.platform !== 'win32', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', BROWSER: 'none' } });
    const proc = procs.dev;
    const onData = (d) => {
      const text = d.toString().replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '');
      send({ type: 'log', text });
      const m = text.match(/https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?[^\s)'"\u001b]*/);
      if (m) send({ type: 'url', url: m[0].replace('0.0.0.0', 'localhost') });
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => { send({ type: 'exit', code }); if (procs.dev === proc) procs.dev = null; });
    send({ type: 'started', pid: proc.pid });
    return true;
  }
  ctx.startDevServer = startDevServer;

  // Other services the page needs (an API, a worker) run next to the dev server, their output in the same log.
  const services = new Map();
  const stopService = (command) => { killTree(services.get(command)); services.delete(command); };
  ctx.stopServices = () => { for (const command of [...services.keys()]) stopService(command); };
  ipcMain.handle('dev:serviceStart', (e, { command, label }) => {
    const { projectDir } = loadSettings();
    if (!projectDir) throw new Error('Pick a project folder first.');
    if (services.has(command)) return true;
    const send = (evt) => { if (!e.sender.isDestroyed()) e.sender.send('dev:event', evt); };
    const proc = spawn(command, { cwd: projectDir, shell: true, detached: process.platform !== 'win32', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', BROWSER: 'none' } });
    services.set(command, proc);
    const onData = (d) => send({ type: 'log', text: d.toString().replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '').replace(/^(?=.)/gm, `[${label}] `) });
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => {
      if (services.get(command) === proc) services.delete(command);
      send({ type: 'log', text: `[${label}] exited with code ${code}\n` });
      send({ type: 'service', command, running: false });
    });
    send({ type: 'service', command, running: true });
    return true;
  });
  ipcMain.handle('dev:serviceStop', (_e, command) => { stopService(command); return true; });

  ipcMain.handle('dev:start', (e, { command }) => startDevServer(e.sender, command));
  ipcMain.handle('dev:detect', () => devserver.inspect(loadSettings().projectDir));
  ipcMain.handle('dev:stop', () => { killTree(procs.dev); procs.dev = null; return true; });

  ipcMain.handle('term:shells', () => terminal.shells());
  ipcMain.handle('term:list', () => terminal.list());
  ipcMain.handle('term:open', (e, opts) => terminal.open(e.sender, { ...opts, cwd: opts?.cwd || loadSettings().projectDir }));
  ipcMain.handle('term:attach', (e, id) => terminal.attach(e.sender, id));
  ipcMain.on('term:write', (_e, { id, data }) => terminal.write(id, data));
  ipcMain.on('term:resize', (_e, { id, cols, rows }) => terminal.resize(id, cols, rows));
  ipcMain.on('term:close', (_e, id) => terminal.close(id));

  ipcMain.handle('build:measure', async (e, pageUrl) => {
    const root = projectDir();
    if (!buildsize.sharesDevFolder(root)) return buildsize.measure(root);
    const ours = !!procs.dev && procs.dev.exitCode === null;
    if (!ours) {
      let live = false;
      if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(pageUrl || '')) {
        try { await fetch(pageUrl, { signal: AbortSignal.timeout(1500) }); live = true; } catch { /* nothing is listening */ }
      }
      if (live) throw new Error("A Next.js dev server that Pinpoint didn't start is running. Stop it first: a build and the dev server share the .next folder.");
      return buildsize.measure(root);
    }
    const command = loadSettings().devCommand;
    killTree(procs.dev);
    procs.dev = null;
    await sleep(1500);
    try { return { ...(await buildsize.measure(root)), restarted: true }; }
    finally { if (command) startDevServer(e.sender, command); }
  });
}

module.exports = { register };
