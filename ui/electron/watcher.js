/**
 * Folder Watcher — monitors a directory for file changes using fs.watch
 * and periodic polling. Pushes detected changes to the scan queue.
 *
 * Separated from main.js: communicates via push events and callback.
 * DB access goes through worker-manager, scans through scan-queue.
 */

const fs = require('fs');
const path = require('path');

const MODEL_EXTS = new Set(['.fbx', '.obj', '.glb', '.gltf', '.usdz']);
const TEXTURE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.tga', '.tif', '.tiff', '.dds', '.exr', '.hdr', '.bmp']);
const WATCHABLE_EXTS = new Set([...MODEL_EXTS, ...TEXTURE_EXTS]);

let api = null;
let sendToRenderer = null;

function init(_api, _sendToRenderer) {
  api = _api;
  sendToRenderer = _sendToRenderer;
}

class FolderWatcher {
  constructor() {
    this.nativeWatcher = null;
    this.pollTimer = null;
    this.debounceTimer = null;
    this.folderPath = null;
    this.watching = false;
    this.scanning = false;
    this.pendingChanges = new Set();
    this.debounceRemaining = 0;
    this.debounceTick = null;
  }

  isModelFile(filePath) {
    return MODEL_EXTS.has(path.extname(filePath).toLowerCase());
  }

  isWatchableFile(filePath) {
    return WATCHABLE_EXTS.has(path.extname(filePath).toLowerCase());
  }

  // ── Detect changes incrementally ──
  async detectChanges() {
    if (!this.folderPath || !fs.existsSync(this.folderPath)) return new Set();

    const known = new Set(await api.getKnownModelPaths());
    const now = new Set();
    const changed = new Set();

    this._walkDir(this.folderPath, (filePath) => {
      if (!this.isModelFile(filePath)) return;
      now.add(filePath);
      if (!known.has(filePath)) changed.add(filePath);
    });

    // Deletions
    for (const k of known) {
      if (!now.has(k)) changed.add(k);
    }

    return changed;
  }

  _walkDir(dir, callback) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) this._walkDir(full, callback);
      else if (entry.isFile()) callback(full);
    }
  }

  // ── FS event handler ──
  handleChange(eventType, filePath) {
    if (!this.isWatchableFile(filePath)) return;
    const fullPath = path.resolve(this.folderPath, filePath);

    if (this.isModelFile(filePath)) {
      this.pendingChanges.add(fullPath);
    } else {
      // Texture change → signal correlated model
      const dir = path.dirname(fullPath);
      let dirEntries;
      try { dirEntries = fs.readdirSync(dir).filter(e => this.isModelFile(e)); }
      catch (e) { dirEntries = []; }
      for (const entry of dirEntries) {
        this.pendingChanges.add(path.join(dir, entry));
      }
    }
    this._resetDebounce();
  }

  // ── Polling (every 30s as fallback) ──
  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(async () => {
      if (this.scanning) return;
      const changed = await this.detectChanges();
      if (changed.size > 0) {
        for (const fp of changed) this.pendingChanges.add(fp);
        this._resetDebounce();
      }
    }, 30000);
  }

  stopPolling() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  // ── Debounce ──
  _resetDebounce() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceRemaining = 3;
    if (this.debounceTick) clearInterval(this.debounceTick);
    this.debounceTick = setInterval(() => {
      this.debounceRemaining -= 1;
      if (this.debounceRemaining <= 0) {
        clearInterval(this.debounceTick);
        this.debounceTick = null;
      }
      this._notifyStatus();
    }, 1000);
    this.debounceTimer = setTimeout(() => this.flush(), 3000);
    this._notifyStatus();
  }

  // ── Flush pending changes → scan queue ──
  async flush() {
    if (this.scanning || !this.folderPath) return;
    if (this.debounceTick) { clearInterval(this.debounceTick); this.debounceTick = null; }
    this.scanning = true;

    const pendingSet = new Set(this.pendingChanges);
    this.pendingChanges.clear();

    const additions = [], deletions = [];
    for (const fp of pendingSet) {
      (fs.existsSync(fp) ? additions : deletions).push(fp);
    }

    // Handle deletions via worker manager
    if (deletions.length > 0) {
      let removed = 0;
      for (const delPath of deletions) {
        const result = await api.removeModel(delPath);
        if (result?.ok && result?.removed) removed++;
      }
      if (removed > 0 && sendToRenderer) {
        sendToRenderer('watcher:detected', {
          count: deletions.length, additions: 0, deletions: removed,
          files: deletions.map(p => path.basename(p)).slice(0, 15),
        });
      }
    }

    // Handle additions via scan queue
    if (additions.length > 0) {
      if (sendToRenderer) {
        sendToRenderer('watcher:detected', {
          count: additions.length, additions: additions.length, deletions: 0,
          files: additions.map(p => path.basename(p)).slice(0, 15),
        });
      }

      // Send to scan queue — this runs async in the background
      const result = await api.enqueueScan(this.folderPath);
      // result has { ok, lines }

      if (sendToRenderer) {
        sendToRenderer('watcher:updated', {
          count: pendingSet.size, added: additions.length, removed: deletions.length,
          lines: result.lines ? result.lines.slice(-8) : [],
        });
      }
    }

    this.scanning = false;
  }

  // ── Start ──
  start(folderPath) {
    if (this.watching) this.stop();
    if (!fs.existsSync(folderPath)) throw new Error(`Folder not found: ${folderPath}`);

    this.folderPath = path.resolve(folderPath);
    this.pendingChanges.clear();

    try {
      this.nativeWatcher = fs.watch(this.folderPath, { recursive: true }, (eventType, filename) => {
        if (filename) this.handleChange(eventType, filename);
      });
    } catch (err) {
      this.nativeWatcher = null;
    }

    this.startPolling();
    this.watching = true;
    return this.folderPath;
  }

  stop() {
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    if (this.debounceTick) { clearInterval(this.debounceTick); this.debounceTick = null; }
    if (this.nativeWatcher) { this.nativeWatcher.close(); this.nativeWatcher = null; }
    this.stopPolling();
    this.watching = false;
    this.folderPath = null;
    this.pendingChanges.clear();
    this.scanning = false;
  }

  status() {
    return {
      watching: this.watching,
      folderPath: this.folderPath,
      pending: this.pendingChanges.size,
      scanning: this.scanning,
      debounceRemaining: this.debounceRemaining,
    };
  }

  _notifyStatus() {
    if (sendToRenderer) sendToRenderer('watcher:status-update', {
      pending: this.pendingChanges.size,
      scanning: this.scanning,
      debounceRemaining: this.debounceRemaining,
    });
  }
}

module.exports = { FolderWatcher, init };
