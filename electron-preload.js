// Preload — exposes a safe settings API to the renderer (host page)
// contextIsolation means the renderer can't access Node directly
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  onSettingsUpdated: (cb) => ipcRenderer.on('settings-updated', (_, s) => cb(s)),
  isElectron: true,
});
