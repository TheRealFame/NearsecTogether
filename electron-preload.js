// Preload — exposes a safe settings API to the renderer (host page)
// contextIsolation means the renderer can't access Node directly
const { contextBridge, ipcRenderer, desktopCapturer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  onSettingsUpdated: (cb) => ipcRenderer.on('settings-updated', (_, s) => cb(s)),
  
  // NEW: Desktop Capturer API for window/screen selection
  getWindowSources: async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
      return sources.map(source => ({
        id: source.id,
        name: source.name,
        displayId: source.display_id,
        thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
        isScreen: source.id.startsWith('screen'),
      }));
    } catch (err) {
      console.error('[preload] getWindowSources error:', err);
      return [];
    }
  },
  
  isElectron: true,
});
