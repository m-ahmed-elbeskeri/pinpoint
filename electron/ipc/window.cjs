const { app, ipcMain, nativeImage, Menu, Notification, Tray } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const updater = require('../updater.cjs');

function register(ctx) {
  const { getWin, showWindow, projectWindow, loadSettings, saveSettings } = ctx;
  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:set', (_e, patch) => saveSettings(patch));

  // Desktop notifications carry Pinpoint's own icon (a page-side Notification would show a generic one), and a click brings the window back.
  ipcMain.handle('app:badge', (_e, count) => {
    const n = Math.max(0, count | 0);
    const win = getWin();
    try { app.setBadgeCount(n); } catch { /* not supported here */ }
    if (process.platform === 'win32' && win && !win.isDestroyed()) {
      // Windows has no number badge; a small dot over the taskbar icon says "look".
      if (!n) win.setOverlayIcon(null, '');
      else {
        const dot = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#ff4f3a"/></svg>').toString('base64'));
        win.setOverlayIcon(dot.isEmpty() ? null : dot, `${n} chat${n > 1 ? 's' : ''} need you`);
      }
    }
    return true;
  });

  ipcMain.handle('app:notify', (_e, { title, body }) => {
    if (!Notification.isSupported()) return false;
    const n = new Notification({ title: title || 'Pinpoint', body: String(body || '').slice(0, 240), icon: nativeImage.createFromPath(path.join(__dirname, '..', 'icon.png')) });
    n.on('click', showWindow);
    n.show();
    return true;
  });

  let tray = null;
  // The tray says what's going on while the window is out of sight. Only the first window keeps one.
  ipcMain.handle('app:tray', (_e, { working, waiting, chats }) => {
    if (projectWindow || loadSettings().tray === false) { tray?.destroy(); tray = null; return false; }
    if (!tray) {
      const image = nativeImage.createFromPath(path.join(__dirname, '..', 'icon.png')).resize({ width: 16, height: 16 });
      tray = new Tray(image);
      tray.on('click', showWindow);
    }
    const parts = [working ? `${working} working` : '', waiting ? `${waiting} need${waiting === 1 ? 's' : ''} you` : ''].filter(Boolean);
    tray.setToolTip(parts.length ? `Pinpoint: ${parts.join(', ')}` : 'Pinpoint');
    const rows = (chats || []).slice(0, 8).map((c) => ({
      label: `${String(c.title || 'Untitled').slice(0, 48)} · ${c.state}`,
      click: () => { showWindow(); getWin()?.webContents.send('tray:chat', c.id); },
    }));
    tray.setContextMenu(Menu.buildFromTemplate([
      ...rows, ...(rows.length ? [{ type: 'separator' }] : []),
      { label: 'Show Pinpoint', click: showWindow },
      { label: 'Quit', click: () => app.quit() },
    ]));
    return true;
  });

  // Opens a project in a window of its own. Launching it again just brings that window forward.
  ipcMain.handle('window:openProject', (_e, dir) => {
    const s = loadSettings();
    if (!dir || !fs.existsSync(dir)) throw new Error('That folder no longer exists.');
    if (path.resolve(dir) === path.resolve(s.projectDir || '.')) { showWindow(); return false; }
    const home = process.env.PINPOINT_WINDOW_HOME || app.getPath('userData');
    const ud = path.join(home, 'project-windows', crypto.createHash('sha1').update(path.resolve(dir)).digest('hex').slice(0, 16));
    const file = path.join(ud, 'settings.json');
    if (!fs.existsSync(file)) {
      fs.mkdirSync(ud, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ ...s, projectDir: dir, recentProjects: [dir, ...s.recentProjects.filter((p) => p !== dir)].slice(0, 8), devCommand: '', tabs: [], activeTab: 0, liveUrl: '', onboarded: true }, null, 2));
    }
    const { ELECTRON_RUN_AS_NODE: _drop, ...env } = process.env;
    const child = spawn(process.execPath, app.isPackaged ? [] : [app.getAppPath()], { detached: true, stdio: 'ignore', env: { ...env, PINPOINT_USER_DATA: ud, PINPOINT_WINDOW: dir, PINPOINT_WINDOW_HOME: home } });
    child.unref();
    return true;
  });

  // Keep the native window buttons (Windows / Linux title-bar overlay) in step with the app theme.
  ipcMain.handle('window:theme', (_e, light) => {
    const win = getWin();
    try { win?.setTitleBarOverlay?.(light ? { color: '#ffffff', symbolColor: '#4b4b55' } : { color: '#0b0b0d', symbolColor: '#a3a3ad' }); } catch { /* not supported on this platform */ }
    try { win?.setBackgroundColor(light ? '#ffffff' : '#0b0b0d'); } catch { /* window already gone */ }
    return true;
  });

  ipcMain.handle('update:state', () => updater.current());
  ipcMain.handle('update:install', () => updater.install());
}

module.exports = { register };
