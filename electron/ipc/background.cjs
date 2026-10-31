const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { runAgent } = require('../agents/index.cjs');
const background = require('../project/background.cjs');
const { inspectSafe } = require('../fsutil.cjs');
const project = require('../project/store.cjs');
const { buildPrompt } = require('../prompt/index.cjs');
const routecheck = require('../page/routecheck.cjs');
const runs = require('../project/runs.cjs');

const STOP_GRACE_MS = 4500; // a running agent gets a moment to stop before its folder goes

const bgSend = (sender, evt) => { if (!sender.isDestroyed()) sender.send('bg:event', evt); };

function register(ctx) {
  const { bgRuns, loadSettings, projectDir, killTree } = ctx;
  ipcMain.handle('bg:blocker', () => background.blocker(projectDir()));

  ipcMain.handle('bg:start', async (e, { id, request }) => {
    const settings = loadSettings();
    const root = projectDir();
    const run = await background.create(app.getPath('userData'), root, id);
    const entry = { run, handle: null, text: '', files: [], patch: '' };
    bgRuns.set(id, entry);
    for (const w of run.warnings) bgSend(e.sender, { id, type: 'step', text: `Setup: ${w}` });
    try {
      const files = project.writeRequestFiles(root, `bg-${id}`, request);
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
      const designSystem = inspectSafe(root);
      const prompt = buildPrompt({ request: moved, files, projectDir: run.cwd, followUp: false, design: design?.exists ? design.content : '', memory, designSystem });
      entry.handle = runAgent({
        settings, cwd: run.cwd, prompt, images: files.images, sessionId: null, requestDir: files.dir,
        onEvent: async (evt) => {
          if (evt.type === 'text') entry.text = evt.text;
          else if (evt.type === 'text_delta') entry.text += evt.text;
          else if (evt.type === 'tool') bgSend(e.sender, { id, type: 'step', text: `${evt.name} ${path.basename(String(evt.detail || ''))}`.trim() });
          else if (evt.type === 'error') bgSend(e.sender, { id, type: 'step', text: evt.text });
          if (evt.type !== 'done') return;
          entry.finished = true;
          try {
            const res = await background.result(run);
            entry.files = res.files;
            entry.patch = res.patch;
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
  ipcMain.handle('bg:shot', async (_e, id) => (await runs.shots(projectDir(), `bg-${id}`, ['after'])).after || null);

  ipcMain.handle('bg:apply', async (_e, { id, runId, instruction }) => {
    const entry = bgRuns.get(id);
    if (!entry) throw new Error('That background run is gone.');
    const root = projectDir();
    const inProject = (p) => path.relative(root, path.join(entry.run.top, p)).split(path.sep).join('/');
    const touched = entry.files.map((f) => ({ ...f, path: inProject(f.path) })).filter((f) => !f.path.startsWith('..'));
    const snap = { root, files: new Map() };
    for (const f of touched) {
      try { snap.files.set(f.path, { content: fs.readFileSync(path.join(root, f.path)) }); }
      catch (err) { if (err.code !== 'ENOENT') throw err; } // ENOENT: a new file
    }
    await background.apply(entry.run, entry.files);
    const changes = runs.save(root, runId, snap, touched.map(({ path: p, kind }) => ({ path: p, kind })), { request: { instruction: instruction || 'Background run', annotations: [] }, agent: 'Background run' });
    bgRuns.delete(id);
    background.remove(entry.run).catch(() => { /* leftover folder: git prunes it later */ });
    return { changes };
  });

  ipcMain.handle('bg:discard', async (_e, id) => {
    const entry = bgRuns.get(id);
    if (!entry) return true;
    entry.handle?.kill();
    bgRuns.delete(id);
    setTimeout(() => background.remove(entry.run).catch(() => { /* leftover folder: git prunes it later */ }), entry.finished ? 0 : STOP_GRACE_MS);
    return true;
  });
}

module.exports = { register };
