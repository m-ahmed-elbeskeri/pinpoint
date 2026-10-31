const { ipcMain, dialog, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const gitx = require('../git/index.cjs');
const project = require('../project/store.cjs');

function register(ctx) {
  const { getWin, loadSettings, projectDir } = ctx;
  ipcMain.handle('chats:list', () => project.listChats(projectDir()));
  // Another recent project's chats, for the sidebar's project tree. Only folders already in the recent list.
  ipcMain.handle('chats:listFor', (_e, dir) => (loadSettings().recentProjects.includes(dir) ? project.listChats(dir) : []));
  ipcMain.handle('chats:load', (_e, id) => project.loadChat(projectDir(), id));
  ipcMain.handle('chats:save', (_e, chat) => project.saveChat(projectDir(), chat));
  ipcMain.handle('chats:delete', (_e, id) => project.deleteChat(projectDir(), id));
  ipcMain.handle('chats:patch', (_e, { id, patch }) => project.patchChat(projectDir(), id, patch || {}));
  ipcMain.handle('chats:search', (_e, q) => project.searchChats(projectDir(), q));

  ipcMain.handle('chats:export', async (_e, id) => {
    const c = await project.loadChat(projectDir(), id);
    if (!c) return null;
    const name = String(c.renamed || c.title || 'chat').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'chat';
    const r = await dialog.showSaveDialog(getWin(), { defaultPath: `${name}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, project.chatMarkdown(c));
    return r.filePath;
  });

  ipcMain.handle('chats:share', async (_e, id) => {
    const c = await project.loadChat(projectDir(), id);
    if (!c) throw new Error('Send a message in this chat first.');
    const name = String(c.renamed || c.title || 'chat').replace(/[^\w -]+/g, '').trim().slice(0, 60) || 'chat';
    const r = await dialog.showSaveDialog(getWin(), { defaultPath: `${name}.pinpoint-chat.json`, filters: [{ name: 'Pinpoint chat', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(project.packThread(c)));
    return r.filePath;
  });

  ipcMain.handle('chats:receive', async () => {
    const r = await dialog.showOpenDialog(getWin(), { properties: ['openFile'], filters: [{ name: 'Pinpoint chat', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const c = project.unpackThread(JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')), crypto.randomUUID().replace(/-/g, '').slice(0, 16));
    await project.saveChat(projectDir(), c);
    return c.id;
  });

  ipcMain.handle('handoff:save', async (_e, { name, data }) => {
    const r = await dialog.showSaveDialog(getWin(), { defaultPath: `${name}.pinpoint.json`, filters: [{ name: 'Pinpoint hand-off', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(data));
    return r.filePath;
  });

  ipcMain.handle('handoff:open', async () => {
    const r = await dialog.showOpenDialog(getWin(), { properties: ['openFile'], filters: [{ name: 'Pinpoint hand-off', extensions: ['json'] }] });
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
}

module.exports = { register };
