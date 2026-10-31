const { ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const designsystem = require('../project/designsystem.cjs');
const { sleep, readPkg } = require('../fsutil.cjs');

function storybookScript(root) {
  const script = readPkg(root)?.scripts?.storybook || '';
  return script ? { port: +(script.match(/(?:-p|--port)[ =](\d+)/) || [])[1] || 6006 } : null;
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

function register(ctx) {
  const { projectDir, procs } = ctx;
  ipcMain.handle('story:find', async (_e, name) => {
    const root = projectDir();
    const found = designsystem.findStory(root, name);
    return { ...found, url: found.file ? await storyUrl(root, found.file) : null, canStart: !!storybookScript(root) };
  });

  ipcMain.handle('story:start', async (_e, name) => {
    const root = projectDir();
    const found = designsystem.findStory(root, name);
    if (!found.file) return null;
    if (!storybookScript(root)) throw new Error('This project has no "storybook" script in package.json.');
    if (!procs.story || procs.story.exitCode !== null) {
      procs.story = spawn('npm run storybook -- --ci', { cwd: root, shell: true, detached: process.platform !== 'win32', stdio: 'ignore', env: { ...process.env, BROWSER: 'none' } });
      procs.story.on('error', () => { /* the wait below notices it never came up */ });
    }
    for (let i = 0; i < 60; i++) {
      await sleep(2000);
      const url = await storyUrl(root, found.file);
      if (url) return url;
      if (procs.story.exitCode !== null) throw new Error('Storybook exited before it was ready. Run `npm run storybook` to see why.');
    }
    throw new Error('Storybook took too long to start.');
  });
}

module.exports = { register };
