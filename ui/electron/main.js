const { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { FolderWatcher, init: initWatcher } = require('./watcher');
const workerManager = require('./workers/worker-manager');
const updater = require('./auto-updater');

let mainWindow = null;
let currentDbPath = null;
const watcher = new FolderWatcher();

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'asset-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// ── Helper: resolve resource paths for dev vs prod ──
function resourcePath(relativePath) {
  // In dev: relative to project root (ui/../)
  // In prod: relative to process.resourcesPath (bundled as extraResources)
  if (app.isPackaged) {
    return path.join(process.resourcesPath, relativePath);
  }
  return path.resolve(__dirname, '..', '..', relativePath);
}

// ── Helper: send push events to renderer ──
function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function registerAssetFileProtocol() {
  protocol.handle('asset-file', (request) => {
    try {
      const requestUrl = new URL(request.url);
      const filePath = requestUrl.searchParams.get('path');
      if (!filePath) {
        return new Response('Missing file path', { status: 400 });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (e) {
      return new Response(e.message, { status: 500 });
    }
  });
}

// ── IPC Handlers ──

ipcMain.handle('db:open', async (_event, filePath) => {
  const result = await workerManager.openDatabase(filePath);
  console.log(`[db:open] ${result.ok ? 'ok' : 'failed'} ${filePath}${result.error ? ` — ${result.error}` : ''}`);
  if (result.ok) {
    currentDbPath = filePath;
    workerManager._currentDbPath = filePath;
  }
  return result.ok;
});

ipcMain.handle('db:query-models', async (_event, filters) => {
  return workerManager.queryModels(filters);
});

ipcMain.handle('db:get-model', async (_event, id) => {
  return workerManager.getModel(id);
});

ipcMain.handle('db:get-validation', async (_event, modelId) => {
  return workerManager.getValidation(modelId);
});

ipcMain.handle('db:validation-summary', async () => {
  return workerManager.getValidationSummary();
});

ipcMain.handle('db:stats', async () => {
  return workerManager.getStats();
});

ipcMain.handle('dialog:open-db', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Asset Librarian Database',
    filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] }],
    properties: ['openFile'],
  });
  if (result.canceled) return null;
  console.log(`[dialog:open-db] selected ${result.filePaths[0]}`);
  return result.filePaths[0];
});

ipcMain.handle('dialog:open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Folder to Scan for 3D Models',
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:open-hdr', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select HDR Environment',
    filters: [
      { name: 'HDR Environment', extensions: ['hdr', 'exr'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:confirm-delete', async (_event, payload = {}) => {
  const fileName = payload.fileName || path.basename(payload.filePath || '');
  const isLocalDelete = payload.mode === 'local';
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: isLocalDelete ? ['删除本地资源', '取消'] : ['从管理器移除', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: isLocalDelete ? '删除本地资源' : '从管理器移除资源',
    message: isLocalDelete
      ? `确定要删除本地资源 "${fileName}" 吗？`
      : `确定要从管理器移除 "${fileName}" 吗？`,
    detail: isLocalDelete
      ? '将删除模型文件和对应的 _thumb.png 缩略图，并从管理器中移除记录。不会删除贴图、scene.bin、MTL 或其他关联文件。'
      : '只会删除管理器数据库中的记录，不会删除本地模型文件或缩略图。',
  });
  return { confirmed: result.response === 0 };
});

ipcMain.handle('env:scripts-dir', async () => {
  return resourcePath('scripts');
});

ipcMain.handle('env:blender-scripts-dir', async () => {
  return resourcePath('blender_scripts');
});

ipcMain.handle('env:app-version', async () => {
  return app.getVersion();
});

ipcMain.handle('app:check-update', async () => {
  updater.checkNow();
  return { ok: true };
});

ipcMain.handle('fs:thumb-exists', async (_event, modelPath) => {
  const dir = path.dirname(modelPath);
  const base = path.basename(modelPath, path.extname(modelPath));
  const thumb = path.join(dir, `${base}_thumb.png`);
  const fs = require('fs');
  return fs.existsSync(thumb) ? thumb : null;
});

ipcMain.handle('fs:save-preview-thumbnail', async (_event, modelPath, dataUrl) => {
  try {
    if (!modelPath || !dataUrl?.startsWith('data:image/png;base64,')) {
      return { ok: false, error: 'Invalid thumbnail data.' };
    }
    const thumb = thumbnailPathForModel(modelPath);
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    await fs.promises.writeFile(thumb, Buffer.from(base64, 'base64'));
    return { ok: true, path: thumb };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('fs:model-path', async (_event, modelPath) => {
  const fs = require('fs');
  return modelPath && fs.existsSync(modelPath) ? modelPath : null;
});

ipcMain.handle('fs:path-info', async (_event, paths = []) => {
  return paths.map((filePath) => {
    try {
      const stat = fs.statSync(filePath);
      return {
        path: filePath,
        exists: true,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        ext: path.extname(filePath).toLowerCase(),
      };
    } catch (e) {
      return {
        path: filePath,
        exists: false,
        isDirectory: false,
        isFile: false,
        ext: path.extname(filePath).toLowerCase(),
        error: e.message,
      };
    }
  });
});

function thumbnailPathForModel(modelPath) {
  const dir = path.dirname(modelPath);
  const base = path.basename(modelPath, path.extname(modelPath));
  return path.join(dir, `${base}_thumb.png`);
}

ipcMain.handle('asset:remove-from-manager', async (_event, filePath) => {
  const result = await workerManager.removeModel(filePath);
  if (!result.ok || !result.removed) {
    return {
      ok: false,
      removed: result.removed,
      error: result.error || 'Asset record was not removed from the manager.',
    };
  }
  return { ok: true, removed: true };
});

ipcMain.handle('asset:delete-local', async (_event, filePath) => {
  const deletedFiles = [];
  const missingFiles = [];
  const errors = [];
  const thumbPath = thumbnailPathForModel(filePath);

  async function deleteIfExists(targetPath, required) {
    if (!fs.existsSync(targetPath)) {
      if (required) missingFiles.push(targetPath);
      return;
    }
    try {
      await fs.promises.rm(targetPath);
      if (fs.existsSync(targetPath)) {
        errors.push(`Could not delete: ${targetPath}`);
      } else {
        deletedFiles.push(targetPath);
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        missingFiles.push(targetPath);
        return;
      }
      errors.push(`${targetPath}: ${e.message}`);
    }
  }

  await deleteIfExists(filePath, true);
  await deleteIfExists(thumbPath, false);

  if (errors.length > 0) {
    return { ok: false, deletedFiles, missingFiles, errors };
  }

  const result = await workerManager.removeModel(filePath);
  if (!result.ok || !result.removed) {
    return {
      ok: false,
      deletedFiles,
      missingFiles,
      removed: result.removed,
      error: result.error || 'Local files were handled, but the manager record was not removed.',
    };
  }

  return { ok: true, removed: true, deletedFiles, missingFiles };
});

// ── Scanner IPC (delegates to background worker) ──

ipcMain.handle('scanner:run', async (_event, folderPath, targetDbPath) => {
  const result = await workerManager.enqueueScan(folderPath, targetDbPath);
  workerManager._currentDbPath = targetDbPath;

  // Print scan lines to console for debugging
  if (result.lines) {
    for (const line of result.lines) {
      if (line.level === 'error') console.error('[scan]', line.text);
    }
  }
  return result;
});

ipcMain.handle('scanner:run-file', async (_event, filePath, targetDbPath) => {
  const result = await workerManager.enqueueFileScan(filePath, targetDbPath);
  workerManager._currentDbPath = targetDbPath;
  return result;
});

ipcMain.handle('scanner:generate-thumbnails', async (_event, targetDbPath) => {
  return workerManager.enqueueThumbnails(targetDbPath);
});

ipcMain.handle('scanner:validate', async (_event, targetDbPath) => {
  return workerManager.enqueueValidation(targetDbPath);
});

// ── Watcher IPC ──

ipcMain.handle('watcher:start', async (_event, folderPath) => {
  try {
    const started = watcher.start(folderPath);
    return { ok: true, folderPath: started };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('watcher:stop', async () => {
  watcher.stop();
  return { ok: true };
});

ipcMain.handle('watcher:status', async () => {
  return watcher.status();
});

// ── Application Menu ──

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    // macOS app menu
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),

    // File
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Database…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open-db'),
        },
        {
          label: 'Scan Folder…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('menu:scan-folder'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },

    // Edit
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },

    // View
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    // Tools
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Generate Thumbnails',
          accelerator: 'CmdOrCtrl+T',
          click: () => mainWindow?.webContents.send('menu:thumbnails'),
        },
        {
          label: 'Validate Naming',
          accelerator: 'CmdOrCtrl+Shift+V',
          click: () => mainWindow?.webContents.send('menu:validate'),
        },
        { type: 'separator' },
        {
          label: 'Check for Updates…',
          click: () => updater.checkNow(),
        },
      ],
    },

    // Help
    {
      label: 'Help',
      submenu: [
        {
          label: 'Asset Librarian Help',
          click: () => shell.openExternal('https://github.com/asset-librarian/asset-librarian'),
        },
        {
          label: 'Report Issue',
          click: () => shell.openExternal('https://github.com/asset-librarian/asset-librarian/issues'),
        },
        { type: 'separator' },
        {
          label: 'About Asset Librarian',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Asset Librarian',
              message: 'Asset Librarian',
              detail: `Version ${app.getVersion()}\n\n3D Model Asset Manager\nFBX · OBJ · GLB · GLTF`,
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ── Window ──

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Asset Librarian',
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  registerAssetFileProtocol();

  // Build application menu
  buildMenu();

  // Start background workers
  try {
    await workerManager.init();
    console.log('✅ Worker manager initialised (DB worker thread running)');
  } catch (e) {
    console.error('❌ Failed to start worker manager:', e);
  }

  // Wire watcher to worker manager and renderer
  initWatcher({
    getKnownModelPaths: () => workerManager.getKnownModelPaths(),
    removeModel: (fp) => workerManager.removeModel(fp),
    enqueueScan: (folderPath, dbPath) => workerManager.enqueueScan(folderPath, dbPath),
    _currentDbPath: currentDbPath,
  }, sendToRenderer);

  createWindow();

  // Start auto-updater (production only)
  updater.init(mainWindow);
});

app.on('window-all-closed', async () => {
  await workerManager.shutdown();
  updater.shutdown();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});

app.on('before-quit', async () => {
  await workerManager.shutdown();
  updater.shutdown();
});
