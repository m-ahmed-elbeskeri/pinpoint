const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const extensions = require('../agents/extensions.cjs');

// PINPOINT_HOME keeps the test suite away from your own files.
const home = () => process.env.PINPOINT_HOME || os.homedir();

// The instruction files agents read. Only these can be opened from here.
const INSTRUCTIONS = [
  { key: 'claude', label: 'CLAUDE.md', scope: 'Project', file: (root) => path.join(root, 'CLAUDE.md') },
  { key: 'agents', label: 'AGENTS.md', scope: 'Project', file: (root) => path.join(root, 'AGENTS.md') },
  { key: 'claude-local', label: 'CLAUDE.local.md', scope: 'Project, just you', file: (root) => path.join(root, 'CLAUDE.local.md') },
  { key: 'claude-user', label: 'CLAUDE.md', scope: 'All your projects', file: () => path.join(home(), '.claude', 'CLAUDE.md') },
  { key: 'codex-user', label: 'AGENTS.md', scope: 'All your projects', file: () => path.join(home(), '.codex', 'AGENTS.md') },
];

function register({ loadSettings, projectDir }) {
  const cacheFile = (agent, cwd) => path.join(app.getPath('userData'), `extensions-${agent}-${Buffer.from(cwd).toString('hex').slice(-40)}.json`);

  // Last time's list shows at once while the agent is asked again.
  ipcMain.handle('extensions:cached', () => {
    const s = loadSettings();
    try { return JSON.parse(fs.readFileSync(cacheFile(s.agent, projectDir()), 'utf8')); } catch { return null; } // not listed yet
  });
  ipcMain.handle('extensions:list', async () => {
    const s = loadSettings();
    const cwd = projectDir();
    const found = await extensions.list(s, cwd);
    if (found.supported) fs.promises.writeFile(cacheFile(s.agent, cwd), JSON.stringify(found)).catch((e) => console.warn('Could not cache the extensions list:', e.message));
    return found;
  });

  ipcMain.handle('instructions:read', () => {
    const root = projectDir();
    return INSTRUCTIONS.map(({ key, label, scope, file }) => {
      const p = file(root);
      let content = null;
      try { content = fs.readFileSync(p, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      return { key, label, scope, path: p, exists: content !== null, content: content ?? '' };
    });
  });
  ipcMain.handle('instructions:write', (_e, { key, content }) => {
    const entry = INSTRUCTIONS.find((x) => x.key === key);
    if (!entry) throw new Error('Unknown instruction file.');
    const p = entry.file(projectDir());
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    return true;
  });
}

module.exports = { register };
