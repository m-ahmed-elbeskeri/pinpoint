const { app, shell } = require('electron');

const REPO = 'm-ahmed-elbeskeri/pinpoint';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function latestRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const r = await res.json();
  return { version: String(r.tag_name || '').replace(/^v/, ''), url: r.html_url };
}

let state = { status: 'idle' };
let installer = null;

function start(notify) {
  const set = (next) => { state = next; notify(state); };
  if (!app.isPackaged) return;

  if (process.platform === 'darwin') {
    const check = () => latestRelease()
      .then((r) => { if (newer(r.version, app.getVersion())) set({ status: 'available', version: r.version, url: r.url, manual: true }); })
      .catch(() => {});
    check();
    setInterval(check, CHECK_EVERY_MS).unref();
    return;
  }

  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  installer = autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (i) => set({ status: 'downloading', version: i.version }));
  autoUpdater.on('download-progress', (p) => set({ ...state, status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => set({ status: 'ready', version: i.version }));
  autoUpdater.on('error', () => { if (state.status === 'downloading') set({ status: 'error' }); });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, CHECK_EVERY_MS).unref();
}

function install() {
  if (state.status === 'ready' && installer) { installer.quitAndInstall(); return true; }
  if (state.url) { shell.openExternal(state.url); return true; }
  return false;
}

module.exports = { start, install, newer, latestRelease, current: () => state };
