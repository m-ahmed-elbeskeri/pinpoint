// Pinpoint: Electron main process.
// Owns: the window, settings persistence, page captures, request files on disk,
// the dev-server child process, and the coding-agent runs (Claude Code / Codex).
const { app, BrowserWindow, ipcMain, dialog, webContents, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { runAgent, detectAgents, modelCatalog } = require('./agents.cjs');
const { buildPrompt, buildSteerPrompt } = require('./prompt.cjs');
const snapshot = require('./snapshot.cjs');
const runs = require('./runs.cjs');
const project = require('./project.cjs');
const { listRoutes } = require('./routes.cjs');
const sourcemap = require('./sourcemap.cjs');
const gitx = require('./git.cjs');
const devserver = require('./devserver.cjs');

const isDev = !!process.env.VITE_DEV_SERVER_URL;
if (process.env.PINPOINT_USER_DATA) app.setPath('userData', process.env.PINPOINT_USER_DATA);
let win = null;

// ---------- settings ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = {
  agent: 'claude',            // 'claude' | 'codex'
  claudePath: 'claude',
  codexPath: 'codex',
  claudePermission: 'acceptEdits', // plan | acceptEdits | bypassPermissions
  codexSandbox: 'workspace-write', // read-only | workspace-write | danger-full-access
  claudeModel: '',            // '' = CLI default
  claudeEffort: '',
  codexModel: '',
  codexEffort: '',
  projectDir: '',
  url: 'http://localhost:3000',
  devCommand: '',
  recentProjects: [],
  panelSide: 'right',
  panelWidth: 400,
  panelHidden: false,
  drawerHeight: 240,
  useDesign: true,            // include DESIGN.md in prompts
  useMemory: true,            // include enabled memory items in prompts
  editorCommand: '',          // '' = auto-detect cursor / code / windsurf / zed
  gitBranchPerChat: false,    // new chat -> new pinpoint/* branch
  gitAutoCommit: false,       // commit each run's changed files
};
function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}

// ---------- PATH ----------
// GUI apps on macOS (and some Linux launchers) don't inherit the login shell's
// PATH, so `claude` / `codex` / `npm` wouldn't resolve. Ask the user's shell.
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

// ---------- window ----------
const isMac = process.platform === 'darwin';
const TITLEBAR_HEIGHT = 52;

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#131419',
    title: 'Pinpoint',
    icon: path.join(__dirname, 'icon.png'),
    // The app's top bar *is* the title bar: native traffic lights on macOS,
    // native min/max/close overlaid on the right on Windows and Linux.
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 18, y: 18 } }
      : { titleBarOverlay: { color: '#131419', symbolColor: '#a9abb8', height: TITLEBAR_HEIGHT - 1 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false, // our own UI; the guest <webview> stays sandboxed
    },
  });

  // Every <webview> gets our picker preload, with isolation on: the host page
  // never sees our code and the guest never sees Node.
  win.webContents.on('will-attach-webview', (_e, prefs) => {
    prefs.preload = path.join(__dirname, 'webview-preload.cjs');
    prefs.contextIsolation = true;
    prefs.nodeIntegration = false;
    prefs.sandbox = true;
  });

  // Traffic lights disappear in macOS full screen; let the UI drop their padding.
  const sendFs = () => win?.webContents.send('window:fullscreen', win.isFullScreen());
  win.on('enter-full-screen', sendFs);
  win.on('leave-full-screen', sendFs);
  win.on('closed', () => { win = null; });

  if (isDev) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

// Links that try to open new windows inside the guest: load them in place.
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      contents.loadURL(url);
      return { action: 'deny' };
    });
  }
});

// ---------- IPC: settings / dialogs ----------
ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:set', (_e, patch) => saveSettings(patch));
ipcMain.handle('agents:detect', () => detectAgents(loadSettings()));
ipcMain.handle('agents:models', () => modelCatalog());

ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  const s = loadSettings();
  const recent = [dir, ...s.recentProjects.filter((p) => p !== dir)].slice(0, 8);
  // A new project gets its own dev server: stop the old one and re-detect the command.
  const switched = path.resolve(dir) !== path.resolve(s.projectDir || '.');
  if (switched) { killTree(devProc); devProc = null; }
  saveSettings({ projectDir: dir, recentProjects: recent, ...(switched && { devCommand: '' }) });
  return dir;
});

ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));

// Opens a project file in the user's code editor (at a line when we know it),
// falling back to the OS default app, then to revealing it in the folder.
const whichCache = new Map();
function which(cmd) {
  if (whichCache.has(cmd)) return Promise.resolve(whichCache.get(cmd));
  return new Promise((resolve) => {
    require('node:child_process').execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], { windowsHide: true, timeout: 4000 }, (err) => {
      whichCache.set(cmd, !err);
      resolve(!err);
    });
  });
}
ipcMain.handle('shell:openFile', async (_e, { rel, line }) => {
  const root = loadSettings().projectDir;
  if (!root) throw new Error('No project open.');
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(path.resolve(root))) throw new Error('Path is outside the project.');
  if (!fs.existsSync(abs)) throw new Error(`${rel} no longer exists.`);
  const custom = loadSettings().editorCommand?.trim();
  for (const cmd of custom ? [custom] : ['cursor', 'code', 'windsurf', 'zed']) {
    if (!custom && !(await which(cmd))) continue;
    const target = line ? `${abs}:${line}` : abs;
    const args = /zed$/i.test(cmd) ? [target] : ['-g', target];
    try {
      const child = spawn(cmd, args, { shell: process.platform === 'win32', detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', () => {});
      child.unref();
      return { via: cmd };
    } catch { /* try the next one */ }
  }
  const err = await shell.openPath(abs);
  if (!err) return { via: 'system' };
  shell.showItemInFolder(abs);
  return { via: 'folder' };
});

// ---------- IPC: capture ----------
// Captures the guest page (optionally a rect in CSS px) and returns a PNG data URL.
ipcMain.handle('capture', async (_e, { webContentsId, rect }) => {
  const wc = webContents.fromId(webContentsId);
  if (!wc) throw new Error('webview not found');
  const img = rect
    ? await wc.capturePage({
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      })
    : await wc.capturePage();
  return img.toDataURL();
});

// ---------- IPC: agent runs ----------
const active = new Map(); // runId -> { kill }

function writeRequestFiles(projectDir, runId, request) {
  project.ensureDir(projectDir);
  const dir = path.join(projectDir, '.pinpoint', 'requests', runId);
  fs.mkdirSync(dir, { recursive: true });

  const saveImg = (name, dataUrl) => {
    if (!dataUrl) return null;
    const file = path.join(dir, name);
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    return file;
  };

  const images = [];
  const overview = saveImg('overview.png', request.overview);
  if (overview) images.push(overview);
  for (const a of request.annotations) {
    a.imageFile = saveImg(`${a.n}-${a.kind}.png`, a.image);
    if (a.imageFile) images.push(a.imageFile);
    delete a.image;
  }
  delete request.overview;
  fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify(request, null, 2));
  return { dir, overview, images };
}

ipcMain.handle('agent:run', async (e, { runId, request, sessionId }) => {
  const settings = loadSettings();
  const cwd = settings.projectDir;
  if (!cwd || !fs.existsSync(cwd)) throw new Error('Pick a project folder first.');

  const files = writeRequestFiles(cwd, runId, request);
  const design = settings.useDesign ? project.readDesign(cwd) : null;
  const memory = settings.useMemory ? project.readMemory(cwd).filter((m) => m.enabled !== false && m.text?.trim()) : [];
  const prompt = buildPrompt({ request, files, projectDir: cwd, followUp: !!sessionId, design: design?.exists ? design.content : '', memory });
  const send = (evt) => { if (!e.sender.isDestroyed()) e.sender.send('agent:event', { runId, ...evt }); };

  // Git: a new chat can start on its own branch.
  if (settings.gitBranchPerChat && !sessionId) {
    try {
      const st = await gitx.status(cwd);
      if (st.repo && st.hasCommits) {
        const hint = request.instruction || request.annotations.map((a) => a.note).find(Boolean) || '';
        const branch = await gitx.createBranch(cwd, hint);
        send({ type: 'status', text: `On new branch ${branch}` });
        send({ type: 'git', branch });
      }
    } catch (err) { send({ type: 'log', text: `git branch failed: ${err.message}` }); }
  }

  const agentName = settings.agent === 'codex' ? 'Codex' : 'Claude Code';
  const snap = snapshot.take(cwd);
  // Attach the real file diff to the final event, whatever tools the agent used.
  const onEvent = async (evt) => {
    if (evt.type !== 'done') return send(evt);
    let changes = snapshot.diff(snap);
    try { changes = runs.save(cwd, runId, snap, changes, { request: { instruction: request.instruction, annotations: request.annotations.map(({ n, kind, note, element }) => ({ n, kind, note, element: element && { tag: element.tag, source: element.source } })) }, agent: agentName, url: request.url }); } catch (err) { send({ type: 'log', text: `could not save run record: ${err.message}` }); }
    let commit = null;
    if (settings.gitAutoCommit && changes.length && evt.ok) {
      try {
        const st = await gitx.status(cwd);
        if (st.repo) {
          commit = await gitx.commitPaths(cwd, changes.map((c) => c.path), gitx.commitMessage(request, changes, agentName));
          if (commit) runs.setMeta(cwd, runId, { commit });
        }
      } catch (err) { send({ type: 'log', text: `git commit failed: ${err.message}` }); }
    }
    send({ ...evt, changes, commit, request: { instruction: request.instruction, notes: request.annotations.map((a) => a.note).filter(Boolean) } });
  };
  const handle = runAgent({ settings, cwd, prompt, images: files.images, sessionId, onEvent });
  active.set(runId, handle);
  handle.done.finally(() => active.delete(runId));
  return { requestDir: files.dir };
});

// Diffs and reverts read the run records on disk, so they survive restarts.
const projectDir = () => {
  const dir = loadSettings().projectDir;
  if (!dir) throw new Error('No project open.');
  return dir;
};
ipcMain.handle('run:diff', (_e, runId) => runs.diff(projectDir(), runId));
ipcMain.handle('run:revert', (_e, { runId, paths, force }) => runs.revert(projectDir(), runId, paths || null, !!force));

// A message sent while the agent is working. "queue" lands after the agent's
// current step; "now" interrupts it first. Returns delivered:false when the run
// can't take live input (already finished, or the one-shot Codex fallback), in
// which case the UI sends it as a normal follow-up instead.
ipcMain.handle('agent:steer', (_e, { runId, steerId, request, mode }) => {
  const handle = active.get(runId);
  if (!handle || !handle.steerable) return { delivered: false };
  const cwd = loadSettings().projectDir;
  const files = writeRequestFiles(cwd, `${runId}-${steerId}`, request);
  const text = buildSteerPrompt({ request, files, mode });
  const delivered = mode === 'now' ? handle.interrupt(text, files.images) : handle.steer(text, files.images);
  return { delivered };
});

ipcMain.handle('agent:cancel', (_e, runId) => {
  active.get(runId)?.kill();
  return true;
});

// ---------- IPC: project context ----------
ipcMain.handle('chats:list', () => project.listChats(projectDir()));
ipcMain.handle('chats:load', (_e, id) => project.loadChat(projectDir(), id));
ipcMain.handle('chats:save', (_e, chat) => project.saveChat(projectDir(), chat));
ipcMain.handle('chats:delete', (_e, id) => project.deleteChat(projectDir(), id));
ipcMain.handle('design:read', () => project.readDesign(projectDir()));
ipcMain.handle('design:write', (_e, content) => project.writeDesign(projectDir(), content));
ipcMain.handle('memory:read', () => project.readMemory(projectDir()));
ipcMain.handle('memory:write', (_e, items) => project.writeMemory(projectDir(), items));
ipcMain.handle('routes:list', () => listRoutes(projectDir()));
// ---------- IPC: git ----------
ipcMain.handle('git:status', () => gitx.status(projectDir()));
ipcMain.handle('git:init', () => gitx.initRepo(projectDir()));
ipcMain.handle('git:branch', async (_e, hint) => ({ branch: await gitx.createBranch(projectDir(), hint || 'visual-edit') }));
ipcMain.handle('git:commitRun', async (_e, runId) => {
  const cwd = projectDir();
  const rec = runs.readMeta(cwd, runId);
  const paths = rec.changes.filter((c) => !c.reverted).map((c) => c.path);
  if (!paths.length) throw new Error('Nothing left to commit for this run.');
  const msg = gitx.commitMessage(rec.request || { instruction: 'Visual edit', annotations: [] }, rec.changes, rec.agent || 'Pinpoint');
  const commit = await gitx.commitPaths(cwd, paths, msg);
  if (!commit) throw new Error('These changes are already committed.');
  runs.setMeta(cwd, runId, { commit });
  return commit;
});
ipcMain.handle('git:commitAll', (_e, message) => gitx.commitAll(projectDir(), message));
ipcMain.handle('git:pr', async (_e, args) => {
  const r = await gitx.openPR(projectDir(), args);
  shell.openExternal(r.url);
  return r;
});

// ---------- IPC: before / after screenshots ----------
ipcMain.handle('run:saveShot', (_e, { runId, name, dataUrl }) => {
  runs.saveShot(projectDir(), runId, name, dataUrl);
  return true;
});
ipcMain.handle('run:shots', (_e, runId) => runs.shots(projectDir(), runId));

ipcMain.handle('sourcemap:resolve', (_e, frame) => sourcemap.resolve(frame, loadSettings().projectDir));

// ---------- IPC: dev server ----------
let devProc = null;
function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
  else try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); }
}

ipcMain.handle('dev:start', (e, { command }) => {
  const { projectDir } = loadSettings();
  if (!projectDir) throw new Error('Pick a project folder first.');
  if (devProc) killTree(devProc);
  saveSettings({ devCommand: command });
  const send = (evt) => { if (!e.sender.isDestroyed()) e.sender.send('dev:event', evt); };
  devProc = spawn(command, { cwd: projectDir, shell: true, detached: process.platform !== 'win32', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', BROWSER: 'none' } });
  const proc = devProc;
  const onData = (d) => {
    // Strip ANSI colors: Vite & co. color the port number, which would split the URL.
    const text = d.toString().replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '');
    send({ type: 'log', text });
    // Surface the first local URL the dev server prints so the UI can jump to it.
    const m = text.match(/https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?[^\s)'"\u001b]*/);
    if (m) send({ type: 'url', url: m[0].replace('0.0.0.0', 'localhost') });
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('exit', (code) => { send({ type: 'exit', code }); if (devProc === proc) devProc = null; });
  send({ type: 'started', pid: proc.pid });
  return true;
});
ipcMain.handle('dev:detect', () => devserver.inspect(loadSettings().projectDir));
ipcMain.handle('dev:stop', () => { killTree(devProc); devProc = null; return true; });

// ---------- lifecycle ----------
app.setName('Pinpoint');
app.whenReady().then(() => {
  if (isMac && isDev) app.dock?.setIcon(path.join(__dirname, 'icon.png'));
  watchNetwork();
  createWindow();
});

// Failed requests made by the page (4xx/5xx, DNS, CORS…) are forwarded to the
// UI so they can be handed to the agent along with console errors.
function watchNetwork() {
  const ses = session.fromPartition('persist:pinpoint');
  const report = (d, extra) => {
    if (!win || win.isDestroyed() || /favicon\.ico($|\?)/.test(d.url) || /^(devtools|chrome-extension):/.test(d.url)) return;
    win.webContents.send('page:network', { url: d.url, method: d.method, resourceType: d.resourceType, at: Date.now(), ...extra });
  };
  ses.webRequest.onCompleted((d) => { if (d.statusCode >= 400) report(d, { status: d.statusCode }); });
  ses.webRequest.onErrorOccurred((d) => { if (d.error !== 'net::ERR_ABORTED') report(d, { error: d.error }); });
}
// macOS: clicking the dock icon with no windows open reopens one.
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
app.on('window-all-closed', () => {
  killTree(devProc);
  for (const r of active.values()) r.kill();
  app.quit();
});
