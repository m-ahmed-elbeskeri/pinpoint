const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { loadSettings, saveSettings, projectDir } = require('./settings.cjs');
const background = require('./project/background.cjs');
const review = require('./page/review.cjs');
const sweep = require('./page/sweep.cjs');
const terminal = require('./terminal.cjs');
const updater = require('./updater.cjs');

const isDev = !!process.env.VITE_DEV_SERVER_URL;
if (process.env.PINPOINT_USER_DATA) app.setPath('userData', process.env.PINPOINT_USER_DATA);
let win = null;
const showWindow = () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } };
// A project's own window is its own process with its own settings folder, so one project can't reach into another's agent runs or dev server.
const projectWindow = !!process.env.PINPOINT_WINDOW;
if (projectWindow) {
  if (!app.requestSingleInstanceLock()) app.exit(0);
  app.on('second-instance', showWindow);
}

function fixPath() {
  const home = require('node:os').homedir();
  const extra = process.platform === 'win32'
    ? [path.join(home, '.local', 'bin'), path.join(process.env.APPDATA || '', 'npm')]
    : [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin'), path.join(home, '.volta', 'bin')];
  let shellPath = '';
  if (process.platform !== 'win32') {
    try {
      const out = require('node:child_process').execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__PP__%s__PP__" "$PATH"'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      shellPath = (out.match(/__PP__(.*)__PP__/) || [])[1] || '';
    } catch { /* keep what we have */ }
  }
  const parts = [...shellPath.split(path.delimiter), ...(process.env.PATH || '').split(path.delimiter), ...extra].filter(Boolean);
  process.env.PATH = [...new Set(parts)].join(path.delimiter);
}
fixPath();

const isMac = process.platform === 'darwin';
const APP_ICON = path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png');
if (process.platform === 'win32') app.setAppUserModelId('dev.pinpoint.app');
const TITLEBAR_HEIGHT = 52;

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#131419',
    title: 'Pinpoint',
    icon: APP_ICON,
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 18, y: 18 } }
      : { titleBarOverlay: { color: '#131419', symbolColor: '#a9abb8', height: TITLEBAR_HEIGHT - 1 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false,
      spellcheck: false,
    },
  });

  win.webContents.on('will-attach-webview', (_e, prefs) => {
    prefs.preload = path.join(__dirname, 'webview-preload.cjs');
    prefs.contextIsolation = true;
    prefs.nodeIntegration = false;
    prefs.sandbox = true;
  });

  const sendFs = () => win?.webContents.send('window:fullscreen', win.isFullScreen());
  win.on('enter-full-screen', sendFs);
  win.on('leave-full-screen', sendFs);
  win.on('closed', () => { win = null; });

  if (isDev) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      if (win && !win.isDestroyed() && /^(https?|file):/.test(url)) win.webContents.send('browser:new-tab', url);
      return { action: 'deny' };
    });
  }
});

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
  else try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); }
}

// The one instance of everything the handlers share. The domain modules hold on to these, never copies.
const ctx = {
  getWin: () => win,
  showWindow,
  projectWindow,
  loadSettings,
  saveSettings,
  projectDir,
  killTree,
  procs: { dev: null, story: null },
  active: new Map(),
  sideRuns: new Map(),
  bgRuns: new Map(),
  variantViews: new Map(),
};
for (const domain of [
  require('./ipc/window.cjs'),
  require('./ipc/project.cjs'),
  require('./ipc/page.cjs'),
  require('./ipc/agent.cjs'),
  require('./ipc/chats.cjs'),
  require('./ipc/story.cjs'),
  require('./ipc/background.cjs'),
  require('./ipc/variants.cjs'),
  require('./ipc/git.cjs'),
  require('./ipc/devserver.cjs'),
  require('./ipc/extensions.cjs'),
]) domain.register(ctx);

app.setName('Pinpoint');
app.whenReady().then(() => {
  if (isMac && isDev) app.dock?.setIcon(path.join(__dirname, 'icon.png'));
  ctx.watchNetwork();
  createWindow();
  updater.start((state) => { if (win && !win.isDestroyed()) win.webContents.send('update:state', state); });
});

app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
app.on('window-all-closed', () => {
  killTree(ctx.procs.dev);
  ctx.stopServices?.();
  killTree(ctx.procs.story);
  terminal.closeAll();
  review.stop();
  sweep.stop();
  for (const v of ctx.variantViews.values()) { killTree(v.proc); background.remove(v.run).catch(() => { /* quitting: nothing more to do */ }); }
  for (const r of ctx.active.values()) r.kill();
  for (const b of ctx.bgRuns.values()) { b.handle?.kill(); background.remove(b.run).catch(() => { /* quitting: nothing more to do */ }); }
  app.quit();
});
