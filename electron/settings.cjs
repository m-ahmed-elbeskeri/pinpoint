const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = {
  agent: 'claude',
  claudePath: 'claude',
  codexPath: 'codex',
  claudePermission: 'acceptEdits',
  codexSandbox: 'workspace-write',
  claudeModel: '',
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
  useDesign: true,
  useMemory: true,
  editorCommand: '',
  gitBranchPerChat: false,
  gitAutoCommit: false,
  tabs: [],
  activeTab: 0,
  autoVerify: false,
  variants: 0,
  routeCheck: true,
  a11yCheck: true,
  perfCheck: true,
  layoutOverlay: true,
  liveUrl: '',
};
let settingsNow = null;
let settingsStamp = '';
const stampOf = () => { try { const st = fs.statSync(settingsFile()); return `${st.mtimeMs}:${st.size}`; } catch { return ''; } };
function loadSettings() {
  const stamp = stampOf();
  if (settingsNow && stamp === settingsStamp) return { ...settingsNow };
  try { settingsNow = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; settingsStamp = stamp; }
  catch { settingsNow = null; return { ...DEFAULT_SETTINGS }; }
  return { ...settingsNow };
}
function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  settingsNow = next;
  settingsStamp = stampOf();
  return next;
}
const projectDir = () => {
  const dir = loadSettings().projectDir;
  if (!dir) throw new Error('No project open.');
  return dir;
};

module.exports = { loadSettings, saveSettings, projectDir };
