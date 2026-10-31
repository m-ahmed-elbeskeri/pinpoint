const { app, ipcMain } = require('electron');
const background = require('../project/background.cjs');
const { sleep } = require('../fsutil.cjs');
const runs = require('../project/runs.cjs');

function register(ctx) {
  const { variantViews, loadSettings, projectDir, killTree } = ctx;
  async function closeVariantViews() {
    const open = [...variantViews.values()];
    variantViews.clear();
    for (const v of open) killTree(v.proc);
    if (open.length) await sleep(1200);
    await Promise.all(open.map((v) => background.remove(v.run).catch(() => { /* leftover folder: git prunes it later */ })));
  }

  ipcMain.handle('variants:live', async (e, { runIds, page }) => {
    const root = projectDir();
    const { devCommand } = loadSettings();
    if (!devCommand) throw new Error('Start the dev server from Pinpoint once, so it knows the command to preview each variant with.');
    await closeVariantViews();
    const ids = runIds.slice(0, 4);
    const send = (text) => { if (!e.sender.isDestroyed()) e.sender.send('variants:progress', text); };
    const made = [];
    for (const runId of ids) {
      send(`Making a copy of the project for variant ${made.length + 1} of ${ids.length}…`);
      const run = await background.create(app.getPath('userData'), root, `live-${String(runId).replace(/[^\w-]/g, '')}-${Date.now().toString(36)}`);
      for (const other of ids) runs.writeInto(root, other, run.cwd, 'before');
      runs.writeInto(root, runId, run.cwd, 'after');
      made.push({ runId, run });
      variantViews.set(runId, { run, proc: null });
    }
    send('Starting a dev server for each variant…');
    const base = 5400 + Math.floor(Math.random() * 400);
    return Promise.all(made.map(async ({ runId, run }, i) => {
      const { url, proc } = await background.preview(run, devCommand, base + i * 3);
      const view = variantViews.get(runId);
      if (view) view.proc = proc; else killTree(proc);
      return { runId, url: url ? url.replace(/\/$/, '') + (page || '/') : null };
    }));
  });

  ipcMain.handle('variants:close', async () => { await closeVariantViews(); return true; });
}

module.exports = { register };
