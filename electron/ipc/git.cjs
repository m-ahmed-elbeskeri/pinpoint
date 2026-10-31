const { ipcMain, shell } = require('electron');
const fs = require('node:fs');
const { sleep } = require('../fsutil.cjs');
const gitx = require('../git/index.cjs');
const runs = require('../project/runs.cjs');

function register(ctx) {
  const { active, loadSettings, saveSettings, projectDir, killTree, procs } = ctx;
  ipcMain.handle('git:status', (_e, opts) => gitx.status(projectDir(), opts));
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

  const notWhileRunning = () => { if (active.size) throw new Error('An agent is editing this project. Wait for it to finish before switching.'); };
  ipcMain.handle('git:branches', () => gitx.branches(projectDir()));
  ipcMain.handle('git:pulls', () => gitx.pulls(projectDir()));
  ipcMain.handle('git:compare', (_e, args) => gitx.compare(projectDir(), args));
  ipcMain.handle('git:fetch', () => gitx.fetchOrigin(projectDir()));
  ipcMain.handle('git:pull', () => { notWhileRunning(); return gitx.pull(projectDir()); });
  ipcMain.handle('git:push', () => gitx.push(projectDir()));
  ipcMain.handle('git:openUrl', (_e, url) => { if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url); return true; });
  ipcMain.handle('git:switch', (_e, name) => { notWhileRunning(); return gitx.switchBranch(projectDir(), name); });
  ipcMain.handle('git:newBranch', (_e, name) => { notWhileRunning(); return gitx.newBranch(projectDir(), name); });
  ipcMain.handle('git:worktreeAdd', (_e, args) => gitx.addWorktree(projectDir(), args));
  ipcMain.handle('git:worktreeRemove', (_e, dir) => gitx.removeWorktree(projectDir(), dir));

  // Opens another worktree of the same repository in place: same dev command and tabs, dev server restarted there.
  ipcMain.handle('git:openWorktree', async (e, dir) => {
    notWhileRunning();
    const tree = await gitx.findTree(projectDir(), dir);
    if (!tree) throw new Error('That worktree no longer exists.');
    if (!fs.existsSync(tree.open)) throw new Error(`${tree.open} doesn't exist in that worktree.`);
    const wasRunning = !!procs.dev && procs.dev.exitCode === null;
    ctx.stopServices?.(); killTree(procs.dev); procs.dev = null; killTree(procs.story); procs.story = null;
    saveSettings({ projectDir: tree.open });
    const { devCommand } = loadSettings();
    if (wasRunning && devCommand) { await sleep(1500); ctx.startDevServer(e.sender, devCommand); }
    return { dir: tree.open, branch: tree.branch, restarted: wasRunning && !!devCommand };
  });

  ipcMain.handle('git:pr', async (_e, { shots, ...args }) => {
    const root = projectDir();
    const pairs = (shots || []).slice(-4).flatMap((s) => {
      const pair = runs.shotPair(root, s.runId);
      return pair ? [{ id: String(s.runId).replace(/[^\w-]/g, ''), label: s.label || '', ...pair }] : [];
    });
    const r = await gitx.openPR(root, { ...args, shots: pairs });
    shell.openExternal(r.url);
    return r;
  });
}

module.exports = { register };
