// Bridge between the Pinpoint UI (renderer) and the main process.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('pinpoint', {
  platform: process.platform,
  onFullscreen: on('window:fullscreen'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  detectAgents: () => ipcRenderer.invoke('agents:detect'),
  modelCatalog: () => ipcRenderer.invoke('agents:models'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  capture: (webContentsId, rect) => ipcRenderer.invoke('capture', { webContentsId, rect }),
  runAgent: (args) => ipcRenderer.invoke('agent:run', args),
  cancelAgent: (runId) => ipcRenderer.invoke('agent:cancel', runId),
  steerAgent: (args) => ipcRenderer.invoke('agent:steer', args),
  openFile: (rel, line) => ipcRenderer.invoke('shell:openFile', { rel, line }),
  runDiff: (runId) => ipcRenderer.invoke('run:diff', runId),
  revertRun: (runId, paths, force) => ipcRenderer.invoke('run:revert', { runId, paths, force }),
  listChats: () => ipcRenderer.invoke('chats:list'),
  loadChat: (id) => ipcRenderer.invoke('chats:load', id),
  saveChat: (chat) => ipcRenderer.invoke('chats:save', chat),
  deleteChat: (id) => ipcRenderer.invoke('chats:delete', id),
  readDesign: () => ipcRenderer.invoke('design:read'),
  writeDesign: (content) => ipcRenderer.invoke('design:write', content),
  readMemory: () => ipcRenderer.invoke('memory:read'),
  writeMemory: (items) => ipcRenderer.invoke('memory:write', items),
  listRoutes: () => ipcRenderer.invoke('routes:list'),
  resolveSourceMap: (frame) => ipcRenderer.invoke('sourcemap:resolve', frame),
  onNetworkError: on('page:network'),
  onAgentEvent: on('agent:event'),
  startDev: (command) => ipcRenderer.invoke('dev:start', { command }),
  stopDev: () => ipcRenderer.invoke('dev:stop'),
  onDevEvent: on('dev:event'),
});
