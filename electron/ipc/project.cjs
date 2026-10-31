const { ipcMain, dialog, shell } = require('electron');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { listRoutes } = require('../project/routes.cjs');
const apiroutes = require('../page/apiroutes.cjs');
const components = require('../project/components.cjs');
const designsystem = require('../project/designsystem.cjs');
const { inspectSafe } = require('../fsutil.cjs');
const instant = require('../project/instant.cjs');
const pins = require('../project/pins.cjs');
const project = require('../project/store.cjs');
const runs = require('../project/runs.cjs');
const sourcemap = require('../page/sourcemap.cjs');
const tailwind = require('../page/tailwind.cjs');

const SKIP_DIRS = new Set(['node_modules', '.git', '.pinpoint', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.turbo', 'coverage', '.cache', 'vendor', 'target']);

const whichCache = new Map();
function which(cmd) {
  if (whichCache.has(cmd)) return Promise.resolve(whichCache.get(cmd));
  return new Promise((resolve) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], { windowsHide: true, timeout: 4000 }, (err) => {
      whichCache.set(cmd, !err);
      resolve(!err);
    });
  });
}

const instantContext = (root) => {
  const ds = inspectSafe(root);
  return { tailwind: !!ds?.tailwind, tokens: ds?.tokens || [] };
};

function register(ctx) {
  const { getWin, loadSettings, saveSettings, projectDir, killTree, procs } = ctx;
  ipcMain.handle('project:read', (_e, rel) => {
    const root = loadSettings().projectDir;
    if (!root) throw new Error('No project open.');
    return project.readProjectFile(root, rel);
  });

  // What git sees as changed, for the badges in the file tree.
  ipcMain.handle('project:changes', async () => {
    const root = loadSettings().projectDir;
    if (!root || !fs.existsSync(root)) return {};
    return new Promise((resolve) => {
      execFile('git', ['status', '--porcelain', '--untracked-files=all', '-z'], { cwd: root, windowsHide: true, timeout: 8000, maxBuffer: 16 * 1024 * 1024 }, (err, out) => {
        if (err) return resolve({});
        const parts = String(out).split('\0');
        const map = {};
        for (let i = 0; i < parts.length; i++) {
          const row = parts[i];
          if (row.length < 4) continue;
          const code = row.slice(0, 2);
          map[row.slice(3)] = code.includes('D') ? 'D' : code === '??' || code.includes('A') ? 'A' : 'M';
          if (code[0] === 'R' || code[0] === 'C') i++; // a rename is followed by its old path
        }
        resolve(map);
      });
    });
  });

  // Files for @-mentions in the composer: git's view of the project when it's a repo, otherwise a capped walk.
  ipcMain.handle('project:files', async () => {
    const root = loadSettings().projectDir;
    if (!root || !fs.existsSync(root)) return [];
    const listed = await new Promise((resolve) => {
      execFile('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, windowsHide: true, timeout: 8000, maxBuffer: 32 * 1024 * 1024 }, (err, out) => resolve(err ? null : String(out).split('\n').filter(Boolean)));
    });
    if (listed) return listed.slice(0, 30000);
    const out = [];
    const walk = (dir, rel) => {
      if (out.length >= 20000) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') && e.name !== '.env.example') continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), r); } else out.push(r);
      }
    };
    walk(root, '');
    return out;
  });

  ipcMain.handle('dialog:pickFolder', async (_e, known) => {
    let dir = '';
    if (known) {
      if (!loadSettings().recentProjects.includes(known) || !fs.existsSync(known)) return null;
      dir = known;
    } else {
      const r = await dialog.showOpenDialog(getWin(), { properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      dir = r.filePaths[0];
    }
    const s = loadSettings();
    const recent = [dir, ...s.recentProjects.filter((p) => p !== dir)].slice(0, 8);
    const switched = path.resolve(dir) !== path.resolve(s.projectDir || '.');
    if (switched) { ctx.stopServices?.(); killTree(procs.dev); procs.dev = null; killTree(procs.story); procs.story = null; }
    saveSettings({ projectDir: dir, recentProjects: recent, ...(switched && { devCommand: '', tabs: [], activeTab: 0, liveUrl: '' }) });
    return dir;
  });

  ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
  ipcMain.handle('site:hints', () => {
    let homepage = null;
    try {
      const h = JSON.parse(fs.readFileSync(path.join(loadSettings().projectDir, 'package.json'), 'utf8')).homepage;
      if (typeof h === 'string' && /^https?:\/\//.test(h) && !/github\.com\/[^/]+\/[^/]+(#|$)/.test(h)) homepage = new URL(h).origin;
    } catch { /* no package.json, or the homepage isn't a URL */ }
    return { homepage };
  });

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
        child.on('error', () => { /* it failed to start after all: nothing to report */ });
        child.unref();
        return { via: cmd };
      } catch { /* try the next one */ }
    }
    const err = await shell.openPath(abs);
    if (!err) return { via: 'system' };
    shell.showItemInFolder(abs);
    return { via: 'folder' };
  });

  ipcMain.handle('api:handler', (_e, { url, method }) => apiroutes.find(loadSettings().projectDir, url, method).catch(() => null));

  const serverLogFile = () => {
    const { serverLog, projectDir } = loadSettings();
    if (!serverLog?.trim()) return null;
    return path.isAbsolute(serverLog) ? serverLog : path.join(projectDir || '', serverLog);
  };
  ipcMain.handle('serverlog:mark', async () => {
    const file = serverLogFile();
    if (!file) return 0;
    try { return (await fs.promises.stat(file)).size; } catch { return 0; }
  });
  ipcMain.handle('serverlog:since', async (_e, offset) => {
    const file = serverLogFile();
    if (!file) return '';
    try {
      const { size } = await fs.promises.stat(file);
      const from = offset > size ? 0 : Math.max(offset || 0, size - 64 * 1024);
      if (size <= from) return '';
      const handle = await fs.promises.open(file, 'r');
      try {
        const buf = Buffer.alloc(size - from);
        await handle.read(buf, 0, buf.length, from);
        return buf.toString('utf8').replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '').slice(-12000);
      } finally { await handle.close(); }
    } catch { return ''; }
  });

  ipcMain.handle('design:read', () => project.readDesign(projectDir()));
  ipcMain.handle('design:write', (_e, content) => project.writeDesign(projectDir(), content));
  ipcMain.handle('memory:read', () => project.readMemory(projectDir()));
  ipcMain.handle('memory:write', (_e, items) => project.writeMemory(projectDir(), items));
  ipcMain.handle('routes:list', () => listRoutes(projectDir()));
  ipcMain.handle('design:system', () => designsystem.inspect(projectDir()));
  ipcMain.handle('design:usage', (_e, name) => designsystem.componentUsage(projectDir(), name));

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

  ipcMain.handle('components:list', () => components.scan(projectDir()));

  ipcMain.handle('profiles:read', () => project.readProfiles(projectDir()));
  ipcMain.handle('profiles:write', (_e, list) => project.writeProfiles(projectDir(), list));

  ipcMain.handle('pins:list', () => pins.list(projectDir()));
  ipcMain.handle('pins:add', (_e, pin) => pins.add(projectDir(), pin));
  ipcMain.handle('pins:check', () => pins.check(projectDir()));
  ipcMain.handle('pins:images', (_e, id) => pins.images(projectDir(), id));
  ipcMain.handle('pins:accept', (_e, id) => pins.accept(projectDir(), id));
  ipcMain.handle('pins:remove', (_e, id) => pins.remove(projectDir(), id));

  ipcMain.handle('tailwind:css', async (_e, classes) => {
    const root = projectDir();
    const ds = designsystem.inspect(root);
    if (!ds?.tailwind) return null;
    const abs = (f) => (f ? path.join(root, f) : '');
    return tailwind.generate(root, { entry: abs(ds.tailwind.entry), config: abs(ds.tailwind.configFile) }, classes);
  });

  ipcMain.handle('sourcemap:resolve', (_e, frame) => sourcemap.resolve(frame, loadSettings().projectDir));
}

module.exports = { register };
