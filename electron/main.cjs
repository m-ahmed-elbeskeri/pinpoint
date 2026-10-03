// Pinpoint: Electron main process.
// Owns: the window, settings persistence, page captures, request files on disk,
// the dev-server child process, and the coding-agent runs (Claude Code / Codex).
const { app, BrowserWindow, ipcMain, dialog, webContents, shell, session, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { runAgent, detectAgents, modelCatalog } = require('./agents.cjs');
const { buildPrompt, buildSteerPrompt, buildVerifyPrompt } = require('./prompt.cjs');
const snapshot = require('./snapshot.cjs');
const runs = require('./runs.cjs');
const project = require('./project.cjs');
const { listRoutes } = require('./routes.cjs');
const sourcemap = require('./sourcemap.cjs');
const gitx = require('./git.cjs');
const devserver = require('./devserver.cjs');
const designsystem = require('./designsystem.cjs');
const routecheck = require('./routecheck.cjs');
const cssrules = require('./cssrules.cjs');
const pins = require('./pins.cjs');
const tailwind = require('./tailwind.cjs');
const buildsize = require('./buildsize.cjs');
const instant = require('./instant.cjs');
const components = require('./components.cjs');
const background = require('./background.cjs');
const engines = require('./engines.cjs');
const updater = require('./updater.cjs');

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
  tabs: [],                   // URLs of the open browser tabs, restored with the project
  activeTab: 0,
  autoVerify: false,          // after a run, the agent checks the after screenshot and new errors
  variants: 0,                // 0 = off; 2-8 = try the request that many ways and pick one
  routeCheck: true,           // screenshot the other pages before/after a run and flag changes
  a11yCheck: true,            // run axe-core on the page and list the violations
  perfCheck: true,            // measure the open page's load cost before/after a run
  layoutOverlay: true,        // box model and flex/grid overlays while picking
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
    // Links that open a new window become a new tab in Pinpoint's browser.
    contents.setWindowOpenHandler(({ url }) => {
      if (win && !win.isDestroyed() && /^(https?|file):/.test(url)) win.webContents.send('browser:new-tab', url);
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
  if (switched) { killTree(devProc); devProc = null; killTree(storyProc); storyProc = null; }
  saveSettings({ projectDir: dir, recentProjects: recent, ...(switched && { devCommand: '', tabs: [], activeTab: 0 }) });
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
  return onWhite(img).toDataURL();
});

// A page that sets no background of its own is white in a browser, but its
// screenshot is transparent there (black text on nothing, once flattened).
// Screenshots are put on white, as the user saw the page.
function onWhite(img) {
  const { width, height } = img.getSize();
  if (!width || !height) return img;
  const scale = img.getScaleFactors()[0] || 1;
  const px = img.toBitmap({ scaleFactor: scale }); // BGRA, premultiplied
  let touched = false;
  for (let i = 3; i < px.length; i += 4) {
    const a = px[i];
    if (a === 255) continue;
    touched = true;
    const rest = 255 - a;
    px[i - 3] = Math.min(255, px[i - 3] + rest);
    px[i - 2] = Math.min(255, px[i - 2] + rest);
    px[i - 1] = Math.min(255, px[i - 1] + rest);
    px[i] = 255;
  }
  if (!touched) return img;
  return nativeImage.createFromBitmap(px, { width: Math.round(width * scale), height: Math.round(height * scale), scaleFactor: scale });
}

// ---------- IPC: page state (DevTools protocol) ----------
// Forced :hover/:focus/:active and media emulation go through the guest's
// debugger, the same channel DevTools uses.
const cdpRoots = new Map();  // webContents id -> document node id
const cdpSheets = new Map(); // webContents id -> Map<styleSheetId, header>
const netModes = new Map();  // webContents id -> 'hang' | 'error' (what to do with the page's API requests)
async function cdp(wc, method, params = {}) {
  if (!wc.debugger.isAttached()) {
    try { wc.debugger.attach('1.3'); }
    catch (err) { throw new Error(`Couldn't connect to the page (${err.message}). If the page's DevTools are open, close them and try again.`); }
    const id = wc.id;
    cdpSheets.set(id, new Map());
    wc.debugger.on('message', (_e, event, p) => {
      if (event === 'CSS.styleSheetAdded') cdpSheets.get(id)?.set(p.header.styleSheetId, p.header);
      else if (event === 'CSS.styleSheetRemoved') cdpSheets.get(id)?.delete(p.styleSheetId);
      else if (event === 'Fetch.requestPaused') onRequestPaused(wc, p);
    });
    wc.debugger.once('detach', () => { cdpRoots.delete(id); cdpSheets.delete(id); netModes.delete(id); });
  }
  return wc.debugger.sendCommand(method, params);
}

// Simulated data states: API calls either never answer (loading) or fail (error).
function onRequestPaused(wc, p) {
  const mode = netModes.get(wc.id);
  const send = (method, params) => wc.debugger.sendCommand(method, params).catch(() => {});
  if (mode === 'hang') return; // left pending: the page stays in its loading state
  if (mode === 'error') {
    return send('Fetch.fulfillRequest', {
      requestId: p.requestId, responseCode: 500,
      responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }],
      body: Buffer.from('{"error":"Simulated failure (Pinpoint)"}').toString('base64'),
    });
  }
  return send('Fetch.continueRequest', { requestId: p.requestId });
}
const guest = (id) => {
  const wc = webContents.fromId(id);
  if (!wc) throw new Error('webview not found');
  return wc;
};

// Node ids for a selector. The document node is fetched once per page: asking
// for it again would drop the states already forced.
async function queryNodes(wc, selector) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!cdpRoots.has(wc.id)) {
      await cdp(wc, 'DOM.enable');
      await cdp(wc, 'CSS.enable');
      cdpRoots.set(wc.id, (await cdp(wc, 'DOM.getDocument', { depth: 0 })).root.nodeId);
    }
    try { return (await cdp(wc, 'DOM.querySelectorAll', { nodeId: cdpRoots.get(wc.id), selector })).nodeIds; }
    catch (err) { cdpRoots.delete(wc.id); if (attempt) throw err; } // the page navigated: fetch the new document
  }
  return [];
}

ipcMain.handle('page:force', async (_e, { webContentsId, selector, classes }) => {
  const wc = guest(webContentsId);
  if (!classes.length && !wc.debugger.isAttached()) return 0; // nothing was ever forced
  const nodeIds = await queryNodes(wc, selector);
  for (const nodeId of nodeIds) await cdp(wc, 'CSS.forcePseudoState', { nodeId, forcedPseudoClasses: classes });
  return nodeIds.length;
});

ipcMain.handle('page:emulate', async (_e, { webContentsId, colorScheme, reducedMotion, focus, touch }) => {
  const wc = guest(webContentsId);
  if (!colorScheme && !reducedMotion && !focus && !touch && !wc.debugger.isAttached()) return true;
  await cdp(wc, 'Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: colorScheme || '' },
      { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : '' },
      // A touch device: no hover, coarse pointer (what "@media (hover: hover)" rules test for).
      { name: 'hover', value: touch ? 'none' : '' },
      { name: 'pointer', value: touch ? 'coarse' : '' },
      { name: 'any-hover', value: touch ? 'none' : '' },
      { name: 'any-pointer', value: touch ? 'coarse' : '' },
    ],
  });
  // Mouse input arrives as touch events (taps, touch scrolling), as on a phone.
  await cdp(wc, 'Emulation.setTouchEmulationEnabled', { enabled: !!touch, maxTouchPoints: touch ? 5 : 1 });
  await cdp(wc, 'Emulation.setEmitTouchEventsForMouse', { enabled: !!touch, configuration: 'mobile' });
  // Keeps :focus styles and focus-driven UI alive while the user clicks around Pinpoint.
  await cdp(wc, 'Emulation.setFocusEmulationEnabled', { enabled: !!focus });
  return true;
});

// The CSS rules that style a picked element, with their files and lines.
ipcMain.handle('page:rules', async (_e, { webContentsId, uid }) => {
  const wc = guest(webContentsId);
  const [nodeId] = await queryNodes(wc, `[data-pinpoint="${String(uid).replace(/[^\w-]/g, '')}"]`);
  if (!nodeId) return [];
  return cssrules.matched({ cdp: (m, p) => cdp(wc, m, p), nodeId, sheets: cdpSheets.get(wc.id) || new Map(), projectDir: loadSettings().projectDir });
});

// Animation speed for the whole page: 1 = normal, 0 = paused.
ipcMain.handle('page:animation', async (_e, { webContentsId, rate }) => {
  const wc = guest(webContentsId);
  if (rate === 1 && !wc.debugger.isAttached()) return true;
  await cdp(wc, 'Animation.enable');
  await cdp(wc, 'Animation.setPlaybackRate', { playbackRate: rate });
  return true;
});

// Network conditions and simulated data states for the page.
const THROTTLE = {
  normal: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  slow: { offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 50 * 1024 },
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
};
ipcMain.handle('page:network', async (_e, { webContentsId, mode }) => {
  const wc = guest(webContentsId);
  if (mode === 'normal' && !wc.debugger.isAttached()) return true;
  await cdp(wc, 'Network.enable');
  await cdp(wc, 'Network.emulateNetworkConditions', THROTTLE[mode] || THROTTLE.normal);
  if (mode === 'hang' || mode === 'error') {
    netModes.set(wc.id, mode);
    await cdp(wc, 'Fetch.enable', { patterns: [{ resourceType: 'XHR' }, { resourceType: 'Fetch' }] });
  } else {
    netModes.delete(wc.id);
    await cdp(wc, 'Fetch.disable').catch(() => {});
  }
  return true;
});

// Plays recorded steps back with real mouse and keyboard input, so handlers that
// only trust genuine events (form submit on Enter, focus management) behave as they did.
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
ipcMain.handle('page:replay', async (_e, { webContentsId, steps }) => {
  const wc = guest(webContentsId);
  const find = (sel) => wc.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), checked: !!el.checked, tag: el.tagName };
  })()`).catch(() => null);
  const click = (p) => { for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x: p.x, y: p.y, button: 'left', clickCount: 1 }); };
  const press = (keyCode) => { for (const type of ['keyDown', 'char', 'keyUp']) wc.sendInputEvent({ type, keyCode }); };
  wc.focus();
  let done = 0;
  for (const s of steps) {
    if (s.type === 'navigate') { await pause(700); done++; continue; } // caused by the step before it
    if (s.type === 'key') press(s.key);
    else {
      const p = s.selector ? await find(s.selector) : null;
      if (!p) break;
      if (s.type === 'click') click(p);
      else if (s.type === 'check') { if (String(p.checked) !== s.value) click(p); }
      else if (s.type === 'fill' && !s.secret) {
        if (p.tag === 'SELECT') {
          await wc.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(s.selector)}); el.value = ${JSON.stringify(s.value || '')}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`).catch(() => {});
        } else {
          click(p);
          await pause(80);
          await wc.executeJavaScript('document.activeElement && document.activeElement.select && document.activeElement.select()').catch(() => {});
          if (s.value) await wc.insertText(s.value); else press('Backspace');
        }
      }
    }
    done++;
    await pause(350);
  }
  return { done, total: steps.length };
});

// ---------- IPC: agent runs ----------
const active = new Map(); // runId -> { kill }
// Runs of different chats can overlap in one project. Each run's result is the difference
// between the files before and after it, which would also pick up what another run wrote
// meanwhile. So a run that finishes tells the ones still going which files it changed and
// what they looked like; a file still in exactly that state isn't theirs.
const othersWrote = new Map(); // runId -> Map<path, signature of the file as the other run left it>
const fileSig = (root, rel) => {
  try { return crypto.createHash('sha1').update(fs.readFileSync(path.join(root, rel))).digest('hex'); } catch { return 'gone'; }
};

function writeRequestFiles(projectDir, runId, request) {
  project.ensureDir(projectDir);
  const dir = path.join(projectDir, '.pinpoint', 'requests', runId);
  fs.mkdirSync(dir, { recursive: true });

  // The extension follows the data: agents pick the media type from it.
  const saveImg = (name, dataUrl) => {
    if (!dataUrl) return null;
    const [meta, b64] = dataUrl.split(',');
    const file = path.join(dir, /jpeg/.test(meta) ? name.replace(/\.png$/, '.jpg') : name);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
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
  if (request.verify) {
    request.verify = { beforeFile: saveImg('before.png', request.verify.before), afterFile: saveImg('after.png', request.verify.after), same: !!request.verify.same };
    images.push(...[request.verify.beforeFile, request.verify.afterFile].filter(Boolean));
  }
  fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify(request, null, 2));
  return { dir, overview, images };
}

ipcMain.handle('agent:run', async (e, { runId, request, sessionId, check }) => {
  const settings = loadSettings();
  const cwd = settings.projectDir;
  if (!cwd || !fs.existsSync(cwd)) throw new Error('Pick a project folder first.');

  const files = writeRequestFiles(cwd, runId, request);
  const design = settings.useDesign ? project.readDesign(cwd) : null;
  const memory = settings.useMemory ? project.readMemory(cwd).filter((m) => m.enabled !== false && m.text?.trim()) : [];
  // The detected design system goes in once per session, like DESIGN.md.
  let designSystem = null;
  if (!sessionId) { try { designSystem = designsystem.inspect(cwd); } catch { /* optional context */ } }
  const prompt = request.verify
    ? buildVerifyPrompt({ request })
    : buildPrompt({ request, files, projectDir: cwd, followUp: !!sessionId, design: design?.exists ? design.content : '', memory, designSystem });
  const send = (evt) => { if (!e.sender.isDestroyed()) e.sender.send('agent:event', { runId, ...evt }); };

  // Git: a new chat can start on its own branch.
  if (active.size && !request.verify) send({ type: 'status', text: 'Another chat is also editing this project. Changes made at the same time can show up in both results.' });
  if (settings.gitBranchPerChat && !sessionId && !(request.variant?.index > 1) && !active.size) {
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
  othersWrote.set(runId, new Map());
  // Other pages are screenshotted now (in the background) and again afterwards.
  let routes = null;
  if (check && !request.variant && !request.verify) {
    const list = settings.routeCheck !== false ? check.routes || [] : [];
    try { routes = routecheck.begin(cwd, list, settings.perfCheck !== false ? check.perfUrl : null, check.targets || [], check.partition || undefined); } catch (err) { send({ type: 'log', text: `route check skipped: ${err.message}` }); }
    routes?.before.catch(() => {});
    routes?.perfBefore.catch(() => {});
  }
  // The "before" screenshots have to be taken before the agent's first edit, or
  // the comparison would see no change. Usually they are reused from the last
  // run; otherwise wait for them, up to a limit, then go on without the check.
  if (routes) {
    const ready = Promise.all([routes.before, routes.perfBefore]).then(() => true, () => true);
    const slow = setTimeout(() => send({ type: 'status', text: 'Taking "before" screenshots of your pages…' }), 900);
    const inTime = await Promise.race([ready, pause(10000).then(() => false)]);
    clearTimeout(slow);
    if (!inTime) { send({ type: 'log', text: 'before-screenshots took too long; skipping the visual change check for this run' }); routes = null; }
  }
  // Attach the real file diff to the final event, whatever tools the agent used.
  const onEvent = async (evt) => {
    if (evt.type !== 'done') return send(evt);
    let changes = snapshot.diff(snap);
    const theirs = othersWrote.get(runId);
    othersWrote.delete(runId);
    if (theirs?.size) changes = changes.filter((c) => theirs.get(c.path) !== fileSig(cwd, c.path));
    for (const seen of othersWrote.values()) for (const c of changes) seen.set(c.path, fileSig(cwd, c.path));
    try { changes = runs.save(cwd, runId, snap, changes, { request: { instruction: request.instruction, annotations: request.annotations.map(({ n, kind, note, element }) => ({ n, kind, note, element: element && { tag: element.tag, source: element.source } })) }, agent: agentName, url: request.url }); } catch (err) { send({ type: 'log', text: `could not save run record: ${err.message}` }); }
    let commit = null;
    // Variants are tried and reverted one after another; only the one you pick gets committed.
    if (settings.gitAutoCommit && changes.length && evt.ok && !request.variant) {
      try {
        const st = await gitx.status(cwd);
        if (st.repo) {
          commit = await gitx.commitPaths(cwd, changes.map((c) => c.path), gitx.commitMessage(request, changes, agentName));
          if (commit) runs.setMeta(cwd, runId, { commit });
        }
      } catch (err) { send({ type: 'log', text: `git commit failed: ${err.message}` }); }
    }
    send({ ...evt, changes, commit, request: { instruction: request.instruction, notes: request.annotations.map((a) => a.note).filter(Boolean) } });
    // A change confined to the open page's own file can't reach the other pages.
    if (routes && evt.ok && changes.length) {
      const shared = changes.some((c) => c.path !== check.currentFile);
      routecheck.finish(routes, (name, buf) => runs.saveShotBuffer(cwd, runId, name, buf), shared)
        .catch((err) => { send({ type: 'log', text: `route check failed: ${err.message}` }); return []; })
        .then(async (results) => {
          const perf = await routecheck.finishPerf(routes).catch(() => null);
          if (results.length || perf) send({ type: 'routes', results, perf });
        });
    }
  };
  const handle = runAgent({ settings, cwd, prompt, images: files.images, sessionId, onEvent });
  active.set(runId, handle);
  handle.done.finally(() => { active.delete(runId); othersWrote.delete(runId); });
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
ipcMain.handle('run:apply', (_e, runId) => runs.apply(projectDir(), runId));
// "Before" screenshots taken while idle, so the next run doesn't wait for them.
ipcMain.handle('routes:prewarm', (_e, { list, partition }) => {
  const settings = loadSettings();
  if (settings.routeCheck === false || !settings.projectDir || active.size || !list?.length) return false;
  routecheck.prewarm(settings.projectDir, list, partition || undefined).catch(() => { /* best effort */ });
  return true;
});

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
ipcMain.handle('design:system', () => designsystem.inspect(projectDir()));
ipcMain.handle('design:usage', (_e, name) => designsystem.componentUsage(projectDir(), name));

// Storybook: the story file for a component, and its URL when Storybook is running.
function storybookScript(root) {
  try {
    const script = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts?.storybook || '';
    return script ? { port: +(script.match(/(?:-p|--port)[ =](\d+)/) || [])[1] || 6006 } : null;
  } catch { return null; }
}
async function storyUrl(root, file) {
  const ports = [...new Set([storybookScript(root)?.port || 6006, 6006, 6007])];
  for (const port of ports) {
    try {
      const res = await fetch(`http://localhost:${port}/index.json`, { signal: AbortSignal.timeout(1200) });
      if (!res.ok) continue;
      const entries = Object.values((await res.json()).entries || {});
      const base = path.basename(file);
      const hit = entries.find((e) => e.type === 'story' && String(e.importPath || '').endsWith(base));
      if (hit) return `http://localhost:${port}/iframe.html?id=${hit.id}&viewMode=story`;
    } catch { /* not running on this port */ }
  }
  return null;
}
ipcMain.handle('story:find', async (_e, name) => {
  const root = projectDir();
  const found = designsystem.findStory(root, name);
  return { ...found, url: found.file ? await storyUrl(root, found.file) : null, canStart: !!storybookScript(root) };
});

// Runs the project's own "storybook" script and waits until the story is being served.
let storyProc = null;
ipcMain.handle('story:start', async (_e, name) => {
  const root = projectDir();
  const found = designsystem.findStory(root, name);
  if (!found.file) return null;
  if (!storybookScript(root)) throw new Error('This project has no "storybook" script in package.json.');
  if (!storyProc || storyProc.exitCode !== null) {
    storyProc = spawn('npm run storybook -- --ci', { cwd: root, shell: true, detached: process.platform !== 'win32', stdio: 'ignore', env: { ...process.env, BROWSER: 'none' } });
    storyProc.on('error', () => {});
  }
  for (let i = 0; i < 60; i++) {
    await pause(2000);
    const url = await storyUrl(root, found.file);
    if (url) return url;
    if (storyProc.exitCode !== null) throw new Error('Storybook exited before it was ready. Run `npm run storybook` to see why.');
  }
  throw new Error('Storybook took too long to start.');
});

// ---------- IPC: instant edits (no agent) ----------
// Small unambiguous changes written straight into the source. Each one is
// recorded like a run, so it shows up in the chat with a diff and can be undone.
const instantContext = (root) => {
  let ds = null;
  try { ds = designsystem.inspect(root); } catch { /* optional */ }
  return { tailwind: !!ds?.tailwind, tokens: ds?.tokens || [] };
};
ipcMain.handle('instant:plan', (_e, annotation) => {
  const root = projectDir();
  try { const { summary, files } = instant.prepare(root, annotation, instantContext(root)); return { ok: true, summary, files }; }
  catch (err) { return { ok: false, reason: err.message }; }
});
ipcMain.handle('instant:apply', (_e, { runId, annotation }) => {
  const root = projectDir();
  const { writes, summary, files } = instant.prepare(root, annotation, instantContext(root));
  const snap = { root, files: new Map(files.map((rel) => [rel, { content: fs.readFileSync(path.join(root, rel)) }])) };
  for (const [abs, content] of writes) fs.writeFileSync(abs, content);
  const changes = runs.save(root, runId, snap, files.map((p) => ({ path: p, kind: 'modify' })), {
    request: { instruction: `Instant edit: ${summary.join('; ')}`, annotations: [] }, agent: 'Pinpoint (instant edit)',
  });
  return { changes, summary };
});

// ---------- IPC: component workspace ----------
ipcMain.handle('components:list', () => components.scan(projectDir()));

// ---------- IPC: "view as" profiles ----------
ipcMain.handle('profiles:read', () => project.readProfiles(projectDir()));
ipcMain.handle('profiles:write', (_e, list) => project.writeProfiles(projectDir(), list));
// Language, time zone and extra request headers for a page shown under a profile.
ipcMain.handle('page:profile', async (_e, { webContentsId, locale, timezone, headers }) => {
  const wc = guest(webContentsId);
  watchNetwork(wc.session);
  const extra = { ...(locale && { 'Accept-Language': locale }), ...(headers || {}) };
  if (!locale && !timezone && !Object.keys(extra).length && !wc.debugger.isAttached()) return true;
  await cdp(wc, 'Emulation.setLocaleOverride', { locale: locale || '' }).catch(() => {});
  // navigator.language follows the user-agent override, not the locale override.
  await cdp(wc, 'Emulation.setUserAgentOverride', { userAgent: wc.getUserAgent(), acceptLanguage: locale || undefined }).catch(() => {});
  await cdp(wc, 'Emulation.setTimezoneOverride', { timezoneId: timezone || '' }).catch(() => {});
  await cdp(wc, 'Network.enable');
  await cdp(wc, 'Network.setExtraHTTPHeaders', { headers: extra });
  return true;
});

// ---------- IPC: other browser engines ----------
ipcMain.handle('engines:status', () => engines.status(app.getPath('userData')));
ipcMain.handle('engines:install', (e) => engines.install(app.getPath('userData'), (text) => { if (!e.sender.isDestroyed()) e.sender.send('engines:progress', text); }));
// The page as WebKit and Firefox render it, logged in as the tab is.
ipcMain.handle('engines:shoot', async (_e, { webContentsId, url, width, height }) => {
  const wc = guest(webContentsId);
  let cookies = [];
  try {
    cookies = (await wc.session.cookies.get({ url })).map((c) => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path || '/', secure: !!c.secure, httpOnly: !!c.httpOnly,
      ...(c.expirationDate && { expires: c.expirationDate }),
      ...(c.sameSite && c.sameSite !== 'unspecified' && { sameSite: c.sameSite === 'no_restriction' ? 'None' : c.sameSite === 'strict' ? 'Strict' : 'Lax' }),
    }));
  } catch { /* shown logged out */ }
  const base = app.getPath('userData');
  const out = {};
  await Promise.all(engines.ENGINES.map(async (engine) => {
    try { out[engine] = `data:image/jpeg;base64,${(await engines.shoot(base, engine, url, { width, height, cookies })).toString('base64')}`; }
    catch (err) { out[engine] = { error: err.message }; }
  }));
  return out;
});

// ---------- IPC: background runs ----------
// A request handled in a separate copy of the project, so several can run at once.
const bgRuns = new Map(); // id -> { run, handle, text, files, patch }
const bgSend = (sender, evt) => { if (!sender.isDestroyed()) sender.send('bg:event', evt); };
ipcMain.handle('bg:blocker', () => background.blocker(projectDir()));
ipcMain.handle('bg:start', async (e, { id, request }) => {
  const settings = loadSettings();
  const root = projectDir();
  const run = await background.create(app.getPath('userData'), root, id);
  const entry = { run, handle: null, text: '', files: [], patch: '' };
  bgRuns.set(id, entry);
  try {
    // Screenshots stay in the real project; every other path in the request points into the copy.
    const files = writeRequestFiles(root, `bg-${id}`, request);
    const norm = (p) => p.replace(/\\/g, '/');
    const swap = (v, key) => {
      if (typeof v === 'string') return key === 'imageFile' ? v : v.split(root).join(run.cwd).split(norm(root)).join(norm(run.cwd));
      if (Array.isArray(v)) return v.map((x) => swap(x));
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x, k)]));
      return v;
    };
    const moved = { ...swap(request), background: true };
    const design = settings.useDesign ? project.readDesign(root) : null;
    const memory = settings.useMemory ? project.readMemory(root).filter((m) => m.enabled !== false && m.text?.trim()) : [];
    let designSystem = null;
    try { designSystem = designsystem.inspect(root); } catch { /* optional context */ }
    const prompt = buildPrompt({ request: moved, files, projectDir: run.cwd, followUp: false, design: design?.exists ? design.content : '', memory, designSystem });
    entry.handle = runAgent({
      settings, cwd: run.cwd, prompt, images: files.images, sessionId: null,
      onEvent: async (evt) => {
        if (evt.type === 'text') entry.text = evt.text;
        else if (evt.type === 'tool') bgSend(e.sender, { id, type: 'step', text: `${evt.name} ${path.basename(String(evt.detail || ''))}`.trim() });
        else if (evt.type === 'error') bgSend(e.sender, { id, type: 'step', text: evt.text });
        if (evt.type !== 'done') return;
        entry.finished = true;
        try {
          const res = await background.result(run);
          entry.files = res.files;
          entry.patch = res.patch;
          // A look at the result, when the project's dev server can be started in the copy.
          let shot = false;
          if (evt.ok && res.files.length && settings.devCommand && /^https?:/.test(request.url || '')) {
            bgSend(e.sender, { id, type: 'step', text: 'Taking a screenshot of the result…' });
            const { url, proc } = await background.preview(run, settings.devCommand, 5300 + Math.floor(Math.random() * 600));
            try {
              if (url) {
                const u = new URL(request.url);
                const s = await routecheck.shoot(url.replace(/\/$/, '') + u.pathname + u.search);
                if (s) { runs.saveShotBuffer(root, `bg-${id}`, 'after', s.jpg); shot = true; }
              }
            } finally { killTree(proc); }
          }
          bgSend(e.sender, { id, type: 'done', ok: evt.ok, files: res.files, summary: entry.text, cost: evt.cost, shot });
        } catch (err) { bgSend(e.sender, { id, type: 'done', ok: false, files: [], summary: `Couldn't collect the result: ${err.message}` }); }
      },
    });
  } catch (err) {
    bgRuns.delete(id);
    await background.remove(run);
    throw err;
  }
  return true;
});
ipcMain.handle('bg:diff', (_e, id) => bgRuns.get(id)?.patch || '');
ipcMain.handle('bg:shot', (_e, id) => runs.shots(projectDir(), `bg-${id}`).after || null);
// Bring a finished background run's changes into the project, as an undoable run.
ipcMain.handle('bg:apply', async (_e, { id, runId, instruction }) => {
  const entry = bgRuns.get(id);
  if (!entry) throw new Error('That background run is gone.');
  const root = projectDir();
  const inProject = (p) => path.relative(root, path.join(entry.run.top, p)).split(path.sep).join('/');
  const touched = entry.files.map((f) => ({ ...f, path: inProject(f.path) })).filter((f) => !f.path.startsWith('..'));
  const snap = { root, files: new Map() };
  for (const f of touched) { try { snap.files.set(f.path, { content: fs.readFileSync(path.join(root, f.path)) }); } catch { /* a new file */ } }
  await background.apply(entry.run, entry.files);
  const changes = runs.save(root, runId, snap, touched.map(({ path: p, kind }) => ({ path: p, kind })), { request: { instruction: instruction || 'Background run', annotations: [] }, agent: 'Background run' });
  bgRuns.delete(id);
  background.remove(entry.run).catch(() => {});
  return { changes };
});
ipcMain.handle('bg:discard', async (_e, id) => {
  const entry = bgRuns.get(id);
  if (!entry) return true;
  entry.handle?.kill();
  bgRuns.delete(id);
  setTimeout(() => background.remove(entry.run).catch(() => {}), entry.finished ? 0 : 4500); // a running agent gets a moment to stop first
  return true;
});

// ---------- IPC: updates ----------
ipcMain.handle('update:state', () => updater.current());
ipcMain.handle('update:install', () => updater.install());

// ---------- IPC: pinned baselines ----------
ipcMain.handle('pins:list', () => pins.list(projectDir()));
ipcMain.handle('pins:add', (_e, pin) => pins.add(projectDir(), pin));
ipcMain.handle('pins:check', () => pins.check(projectDir()));
ipcMain.handle('pins:images', (_e, id) => pins.images(projectDir(), id));
ipcMain.handle('pins:accept', (_e, id) => pins.accept(projectDir(), id));
ipcMain.handle('pins:remove', (_e, id) => pins.remove(projectDir(), id));

// ---------- IPC: hand-off ----------
// A request someone annotated (a designer, a PM) saved as one file a developer can open and run.
ipcMain.handle('handoff:save', async (_e, { name, data }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: `${name}.pinpoint.json`, filters: [{ name: 'Pinpoint hand-off', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(data));
  return r.filePath;
});
ipcMain.handle('handoff:open', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Pinpoint hand-off', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
  if (data?.pinpointHandoff !== 1) throw new Error("That file isn't a Pinpoint hand-off.");
  return data;
});
ipcMain.handle('handoff:issue', async (_e, args) => {
  const r = await gitx.createIssue(projectDir(), args);
  shell.openExternal(r.url);
  return r;
});

// CSS for Tailwind classes added in Pinpoint that the dev build hasn't generated yet.
ipcMain.handle('tailwind:css', async (_e, classes) => {
  const root = projectDir();
  const ds = designsystem.inspect(root);
  if (!ds?.tailwind) return null;
  const abs = (f) => (f ? path.join(root, f) : '');
  return tailwind.generate(root, { entry: abs(ds.tailwind.entry), config: abs(ds.tailwind.configFile) }, classes);
});

// Runs the project's build and reports the size of the JS and CSS it emits.
// A Next.js build shares the .next folder with the dev server, so the dev server
// is stopped for the build and started again afterwards (when Pinpoint runs it).
ipcMain.handle('build:measure', async (e, pageUrl) => {
  const root = projectDir();
  if (!buildsize.sharesDevFolder(root)) return buildsize.measure(root);
  const ours = !!devProc && devProc.exitCode === null;
  if (!ours) {
    // Something else is serving the page: a dev server started outside Pinpoint. It can't be stopped from here.
    let live = false;
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(pageUrl || '')) {
      try { await fetch(pageUrl, { signal: AbortSignal.timeout(1500) }); live = true; } catch { /* nothing is listening */ }
    }
    if (live) throw new Error("A Next.js dev server that Pinpoint didn't start is running. Stop it first: a build and the dev server share the .next folder.");
    return buildsize.measure(root);
  }
  const command = loadSettings().devCommand;
  killTree(devProc);
  devProc = null;
  await pause(1500);
  try { return { ...(await buildsize.measure(root)), restarted: true }; }
  finally { if (command) startDevServer(e.sender, command); }
});

// axe-core's source, which the UI runs inside the page to list accessibility violations.
let axeSource = null;
ipcMain.handle('a11y:source', () => (axeSource ??= fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')));
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

function startDevServer(sender, command) {
  const { projectDir } = loadSettings();
  if (!projectDir) throw new Error('Pick a project folder first.');
  if (devProc) killTree(devProc);
  saveSettings({ devCommand: command });
  const send = (evt) => { if (!sender.isDestroyed()) sender.send('dev:event', evt); };
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
}
ipcMain.handle('dev:start', (e, { command }) => startDevServer(e.sender, command));
ipcMain.handle('dev:detect', () => devserver.inspect(loadSettings().projectDir));
ipcMain.handle('dev:stop', () => { killTree(devProc); devProc = null; return true; });

// ---------- lifecycle ----------
app.setName('Pinpoint');
app.whenReady().then(() => {
  if (isMac && isDev) app.dock?.setIcon(path.join(__dirname, 'icon.png'));
  watchNetwork();
  createWindow();
  updater.start((state) => { if (win && !win.isDestroyed()) win.webContents.send('update:state', state); });
});

// Failed requests made by the page (4xx/5xx, DNS, CORS…) are forwarded to the
// UI so they can be handed to the agent along with console errors.
const watched = new WeakSet(); // sessions (browser profiles) already being listened to
function watchNetwork(ses = session.fromPartition('persist:pinpoint')) {
  if (watched.has(ses)) return;
  watched.add(ses);
  const report = (d, extra) => {
    if (routecheck.captureIds.has(d.webContentsId)) return; // our own hidden route screenshots
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
  killTree(storyProc);
  for (const r of active.values()) r.kill();
  for (const b of bgRuns.values()) { b.handle?.kill(); background.remove(b.run).catch(() => {}); }
  app.quit();
});
