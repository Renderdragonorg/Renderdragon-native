const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    hideWindow: () => ipcRenderer.invoke('hide-window'),
    setAlwaysOnTop: (value) => ipcRenderer.invoke('set-always-on-top', value),
    setPinned: (value) => ipcRenderer.invoke('set-pinned', value),
    downloadAsset: (url, filename) => ipcRenderer.invoke('download-asset', url, filename),
    copyToClipboard: (url, filename, ext) => ipcRenderer.invoke('copy-to-clipboard', url, filename, ext),
    onWindowShown: (callback) => ipcRenderer.on('window-shown', callback),
    onWindowHidden: (callback) => ipcRenderer.on('window-hidden', callback),
    startDrag: (url, filename) => ipcRenderer.send('start-drag', url, filename),

    getShortcut: () => ipcRenderer.invoke('get-shortcut'),
    setShortcut: (shortcut) => ipcRenderer.invoke('set-shortcut', shortcut),
    resetShortcut: () => ipcRenderer.invoke('reset-shortcut'),
    platform: process.platform,

    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    onUpdateStatus: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('update-status', handler);
        return () => ipcRenderer.removeListener('update-status', handler);
    }
});
