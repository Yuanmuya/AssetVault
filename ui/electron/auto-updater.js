/**
 * Auto-updater — checks for updates and applies them.
 *
 * Uses electron-updater with configurable provider.
 * In dev mode, runs as a no-op.
 */

const { autoUpdater } = require('electron-updater');
const { BrowserWindow, dialog } = require('electron');

let mainWindow = null;
let updateCheckTimer = null;

// ── Logging ──
autoUpdater.logger = {
  info: (msg) => console.log('[updater]', msg),
  warn: (msg) => console.warn('[updater]', msg),
  error: (msg) => console.error('[updater]', msg),
};

autoUpdater.autoDownload = false;       // ask before downloading
autoUpdater.autoInstallOnAppQuit = true; // install on quit

function init(_mainWindow) {
  mainWindow = _mainWindow;

  if (!isPackaged()) {
    console.log('[updater] Skipped — dev mode');
    return;
  }

  // ── Event handlers ──

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for updates…');
    sendStatus('Checking for updates…');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] Update available:', info.version);
    sendStatus(`Update ${info.version} available`);
    promptDownload(info);
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[updater] No update available (current: ' + info.version + ')');
    sendStatus('Up to date');
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent);
    sendStatus(`Downloading… ${pct}%`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(progress.percent / 100);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] Downloaded:', info.version);
    sendStatus(`Update ${info.version} downloaded — restart to install`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1); // clear
    }
    promptInstall(info);
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err.message);
    sendStatus(`Update error: ${err.message}`);
  });

  // ── Check on start (with delay) ──
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[updater] Check failed:', err.message);
    });
  }, 10000); // wait 10s for app to settle

  // ── Periodic check every 4 hours ──
  updateCheckTimer = setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 4 * 60 * 60 * 1000);
}

// ── Prompt user to download ──
async function promptDownload(info) {
  if (!mainWindow) return;
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update Available',
    message: `Version ${info.version} is available.`,
    detail: `Current version: ${require('../package.json').version}\n\nDownload the update now?`,
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });

  if (result.response === 0) {
    autoUpdater.downloadUpdate();
  }
}

// ── Prompt to install ──
async function promptInstall(info) {
  if (!mainWindow) return;
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update Ready',
    message: `Update ${info.version} has been downloaded.`,
    detail: 'Restart now to install the update?',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });

  if (result.response === 0) {
    setImmediate(() => autoUpdater.quitAndInstall());
  }
}

// ── Send status to renderer ──
function sendStatus(text) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', text);
  }
}

// ── Check manually (triggered from menu) ──
function checkNow() {
  autoUpdater.checkForUpdates().catch(() => {});
}

function isPackaged() {
  return process.env.NODE_ENV === 'production' || require('electron').app.isPackaged;
}

function shutdown() {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
}

module.exports = { init, checkNow, shutdown };
