const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Database
  openDatabase: (dbPath) => ipcRenderer.invoke('db:open', dbPath),
  queryModels: (filters) => ipcRenderer.invoke('db:query-models', filters),
  getModel: (id) => ipcRenderer.invoke('db:get-model', id),
  getValidation: (modelId) => ipcRenderer.invoke('db:get-validation', modelId),
  getValidationSummary: () => ipcRenderer.invoke('db:validation-summary'),
  getStats: () => ipcRenderer.invoke('db:stats'),

  // Dialogs
  showOpenDbDialog: () => ipcRenderer.invoke('dialog:open-db'),
  showOpenFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
  showOpenHdrDialog: () => ipcRenderer.invoke('dialog:open-hdr'),

  // Scanner
  runScan: (folderPath, dbPath) => ipcRenderer.invoke('scanner:run', folderPath, dbPath),
  runFileScan: (filePath, dbPath) => ipcRenderer.invoke('scanner:run-file', filePath, dbPath),
  generateThumbnails: (dbPath) => ipcRenderer.invoke('scanner:generate-thumbnails', dbPath),
  runValidation: (dbPath) => ipcRenderer.invoke('scanner:validate', dbPath),
  getScriptsDir: () => ipcRenderer.invoke('env:scripts-dir'),

  // Filesystem helpers
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),
  getThumbnailPath: (modelPath) => ipcRenderer.invoke('fs:thumb-exists', modelPath),
  savePreviewThumbnail: (modelPath, dataUrl) => ipcRenderer.invoke('fs:save-preview-thumbnail', modelPath, dataUrl),
  getModelFilePath: (modelPath) => ipcRenderer.invoke('fs:model-path', modelPath),
  getPathInfo: (paths) => ipcRenderer.invoke('fs:path-info', paths),
  confirmDeleteAsset: (payload) => ipcRenderer.invoke('dialog:confirm-delete', payload),
  removeAssetFromManager: (filePath) => ipcRenderer.invoke('asset:remove-from-manager', filePath),
  deleteLocalAsset: (filePath) => ipcRenderer.invoke('asset:delete-local', filePath),

  // Watcher
  watchStart: (folderPath) => ipcRenderer.invoke('watcher:start', folderPath),
  watchStop: () => ipcRenderer.invoke('watcher:stop'),
  watchStatus: () => ipcRenderer.invoke('watcher:status'),
  onWatchDetected: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('watcher:detected', handler);
    return () => ipcRenderer.removeListener('watcher:detected', handler);
  },
  onWatchUpdated: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('watcher:updated', handler);
    return () => ipcRenderer.removeListener('watcher:updated', handler);
  },
  onWatchStatusUpdate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('watcher:status-update', handler);
    return () => ipcRenderer.removeListener('watcher:status-update', handler);
  },

  // Menu events
  onMenuOpenDb: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('menu:open-db', handler);
    return () => ipcRenderer.removeListener('menu:open-db', handler);
  },
  onMenuScanFolder: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('menu:scan-folder', handler);
    return () => ipcRenderer.removeListener('menu:scan-folder', handler);
  },
  onMenuThumbnails: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('menu:thumbnails', handler);
    return () => ipcRenderer.removeListener('menu:thumbnails', handler);
  },
  onMenuValidate: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('menu:validate', handler);
    return () => ipcRenderer.removeListener('menu:validate', handler);
  },

  // App info
  getAppVersion: () => ipcRenderer.invoke('env:app-version'),

  // Updater
  checkForUpdates: () => ipcRenderer.invoke('app:check-update'),
  onUpdateStatus: (callback) => {
    const handler = (_event, text) => callback(text);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },
});
