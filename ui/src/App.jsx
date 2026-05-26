import React, { useState, useEffect, useCallback, useRef } from 'react';
import ThumbnailGrid from './components/ThumbnailGrid';
import ModelViewer3D from './components/ModelViewer3D';
import SidePanel from './components/SidePanel';
import SearchBar from './components/SearchBar';
import StatsBar from './components/StatsBar';
import ScanOverlay from './components/ScanOverlay';
import WatchBar from './components/WatchBar';
import DropZone from './components/DropZone';

const INSPECTOR_STORAGE_KEY = 'assetLibrarian.inspectorSettings';
const DETAIL_WIDTH_STORAGE_KEY = 'assetLibrarian.detailPanelWidth';

const DEFAULT_INSPECTOR_SETTINGS = {
  viewport: '3d',
  renderMode: 'final',
  materialChannel: 'final',
  geometryMode: 'none',
  wireframe: { enabled: false, color: '#ffffff', opacity: 0.55 },
  singleSided: false,
  bones: false,
  boneInfluence: false,
};

function loadInspectorSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(INSPECTOR_STORAGE_KEY) || '{}');
    return {
      ...DEFAULT_INSPECTOR_SETTINGS,
      ...stored,
      wireframe: {
        ...DEFAULT_INSPECTOR_SETTINGS.wireframe,
        ...(stored.wireframe || {}),
      },
    };
  } catch {
    return DEFAULT_INSPECTOR_SETTINGS;
  }
}

function loadDetailPanelWidth() {
  const stored = Number(localStorage.getItem(DETAIL_WIDTH_STORAGE_KEY));
  return Number.isFinite(stored) ? Math.min(Math.max(stored, 640), 1400) : 820;
}

export default function App() {
  const api = window.api;
  const [dbConnected, setDbConnected] = useState(false);
  const [dbPath, setDbPath] = useState(null);
  const [models, setModels] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [inspectorSettings, setInspectorSettings] = useState(loadInspectorSettings);
  const [inspectorCapabilities, setInspectorCapabilities] = useState({});
  const [detailFullscreen, setDetailFullscreen] = useState(false);
  const [detailPanelWidth, setDetailPanelWidth] = useState(loadDetailPanelWidth);
  const [thumbnailVersion, setThumbnailVersion] = useState(0);

  // Scan / thumbnail state
  const [scanning, setScanning] = useState(false);
  const [scanLog, setScanLog] = useState([]);
  const [scanMode, setScanMode] = useState(''); // 'scan' | 'thumbnails'
  const scanningRef = useRef(false);

  const updateInspectorSettings = useCallback((patch) => {
    setInspectorSettings((current) => {
      const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
      localStorage.setItem(INSPECTOR_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetInspectorSettings = useCallback(() => {
    const next = {
      ...DEFAULT_INSPECTOR_SETTINGS,
      wireframe: { ...DEFAULT_INSPECTOR_SETTINGS.wireframe },
    };
    setInspectorSettings(next);
    localStorage.setItem(INSPECTOR_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const handleSelectModel = useCallback((model) => {
    setSelectedModel(model);
    setInspectorCapabilities({});
    resetInspectorSettings();
  }, [resetInspectorSettings]);

  const handleDetailResizeStart = useCallback((event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = detailPanelWidth;
    const maxWidth = Math.max(720, window.innerWidth - 360);

    const onMove = (moveEvent) => {
      const next = Math.min(Math.max(startWidth + (startX - moveEvent.clientX), 640), maxWidth);
      setDetailPanelWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDetailPanelWidth((width) => {
        localStorage.setItem(DETAIL_WIDTH_STORAGE_KEY, String(width));
        return width;
      });
      document.body.classList.remove('resizing-detail-panel');
    };

    document.body.classList.add('resizing-detail-panel');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [detailPanelWidth]);

  // ── Refresh ──
  const refreshData = useCallback(async () => {
    if (!api) {
      setError('Desktop API is not available. Please use the Electron app window, not the browser preview.');
      return;
    }
    try {
      const [modelsData, statsData] = await Promise.all([
        api.queryModels({
          search: searchQuery || undefined,
          format: formatFilter || undefined,
          missingOnly: missingOnly || undefined,
        }),
        api.getStats(),
      ]);
      setModels(modelsData);
      setStats(statsData);
    } catch (e) {
      setError(e.message);
    }
  }, [api, searchQuery, formatFilter, missingOnly]);

  // ── Connect to DB ──
  const connectDb = useCallback(async (path) => {
    if (!api) {
      setError('Desktop API is not available. Please use the Electron app window, not the browser preview.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ok = await api.openDatabase(path);
      if (!ok) {
        setError(`Could not open database file: ${path}`);
        return;
      }

      const [modelsData, statsData] = await Promise.all([
        api.queryModels({}),
        api.getStats(),
      ]);

      setDbPath(path);
      setDbConnected(true);
      setModels(modelsData);
      setStats(statsData);
      setSelectedModel(null);
      setInspectorCapabilities({});
      setDetailFullscreen(false);
      resetInspectorSettings();

      if (modelsData.length === 0) {
        setError(`Opened database, but no models were found in ${path}.`);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [api, resetInspectorSettings]);

  const handleOpenDb = useCallback(async () => {
    if (!api) {
      setError('Desktop API is not available. Please use the Electron app window, not the browser preview.');
      return;
    }
    try {
      const path = await api.showOpenDbDialog();
      if (path) await connectDb(path);
    } catch (e) {
      setError(`Open Database failed: ${e.message}`);
    }
  }, [api, connectDb]);

  const handleRemoveFromManager = useCallback(async (model) => {
    if (!api || !model?.file_path) return;
    setError(null);
    try {
      const confirm = await api.confirmDeleteAsset({
        mode: 'manager',
        fileName: model.file_name,
        filePath: model.file_path,
      });
      if (!confirm?.confirmed) return;

      const result = await api.removeAssetFromManager(model.file_path);
      if (!result?.ok) {
        setError(result?.error || 'Failed to remove asset from manager.');
        return;
      }

      if (selectedModel?.id === model.id) setSelectedModel(null);
      await refreshData();
    } catch (e) {
      setError(`Remove failed: ${e.message}`);
    }
  }, [api, refreshData, selectedModel?.id]);

  const handleDeleteLocalAsset = useCallback(async (model) => {
    if (!api || !model?.file_path) return;
    setError(null);
    try {
      const confirm = await api.confirmDeleteAsset({
        mode: 'local',
        fileName: model.file_name,
        filePath: model.file_path,
      });
      if (!confirm?.confirmed) return;

      const result = await api.deleteLocalAsset(model.file_path);
      if (!result?.ok) {
        const detail = result?.errors?.join('; ') || result?.error || 'Failed to delete local asset.';
        setError(detail);
        return;
      }

      if (result.missingFiles?.length > 0) {
        setError('Model file was already missing; the manager record was removed.');
      }
      if (selectedModel?.id === model.id) setSelectedModel(null);
      await refreshData();
    } catch (e) {
      setError(`Delete failed: ${e.message}`);
    }
  }, [api, refreshData, selectedModel?.id]);

  useEffect(() => {
    if (dbConnected) refreshData();
  }, [dbConnected, refreshData]);

  // ── Scan Folder ──
  const handleScanFolder = useCallback(async () => {
    if (scanningRef.current) return;

    const folderPath = await window.api.showOpenFolderDialog();
    if (!folderPath) return;

    scanningRef.current = true;
    setScanning(true);
    setScanMode('scan');
    setScanLog([]);
    setError(null);

    // Determine DB path: use current if connected, else new in folder
    const targetDb = dbPath || (folderPath + '/asset_librarian.db');

    try {
      const result = await window.api.runScan(folderPath, targetDb);

      if (result?.lines) {
        setScanLog(result.lines);
      }

      if (result?.ok) {
        // Re-open the DB so sql.js picks up the fresh data
        await connectDb(targetDb);
        // Auto-start watching the scanned folder
        await window.api.watchStart(folderPath);
      } else {
        setError('Scan completed with errors — check the log for details.');
      }
    } catch (e) {
      setError(`Scan failed: ${e.message}`);
      setScanLog(prev => [...prev, { level: 'error', text: e.message }]);
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, [dbPath, connectDb]);

  // ── Validate UE naming ──
  const handleValidate = useCallback(async () => {
    if (scanningRef.current || !dbPath) return;

    scanningRef.current = true;
    setScanning(true);
    setScanMode('validate');
    setScanLog([]);
    setError(null);

    try {
      const result = await window.api.runValidation(dbPath);
      if (result?.lines) setScanLog(result.lines);
      await refreshData();
    } catch (e) {
      setError(`Validation failed: ${e.message}`);
      setScanLog(prev => [...prev, { level: 'error', text: e.message }]);
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, [dbPath, refreshData]);

  // ── Generate Thumbnails only (for already-scanned DB) ──
  const handleGenerateThumbnails = useCallback(async () => {
    if (scanningRef.current || !dbPath) return;

    scanningRef.current = true;
    setScanning(true);
    setScanMode('thumbnails');
    setScanLog([]);
    setError(null);

    try {
      const result = await window.api.generateThumbnails(dbPath);
      if (result?.lines) setScanLog(result.lines);
      await refreshData();
    } catch (e) {
      setError(`Thumbnail generation failed: ${e.message}`);
      setScanLog(prev => [...prev, { level: 'error', text: e.message }]);
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, [dbPath, refreshData]);

  useEffect(() => {
    const cleanup = [
      window.api.onMenuOpenDb?.(handleOpenDb),
      window.api.onMenuScanFolder?.(handleScanFolder),
      window.api.onMenuThumbnails?.(handleGenerateThumbnails),
      window.api.onMenuValidate?.(handleValidate),
    ].filter(Boolean);

    return () => {
      cleanup.forEach((fn) => fn());
    };
  }, [handleOpenDb, handleScanFolder, handleGenerateThumbnails, handleValidate]);

  // ── Drop Folder Import ──
  const handleDropFolder = useCallback(async (folderPath, summary) => {
    if (scanningRef.current) return;

    scanningRef.current = true;
    setScanning(true);
    setScanMode('scan');
    setScanLog([]);
    setError(null);

    const targetDb = dbPath || (folderPath + '/asset_librarian.db');

    try {
      const result = summary?.singleFile
        ? await window.api.runFileScan(summary.singleFile.replace(/\//g, '\\'), targetDb)
        : await window.api.runScan(folderPath, targetDb);
      if (result?.lines) setScanLog(result.lines);

      if (result?.ok) {
        await connectDb(targetDb);
        await window.api.watchStart(folderPath);
      } else {
        setError('Scan completed with errors — check the log for details.');
      }
    } catch (e) {
      setError(`Scan failed: ${e.message}`);
      setScanLog(prev => [...prev, { level: 'error', text: e.message }]);
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, [dbPath, connectDb]);

  // ── Scan from welcome screen (with autogenerated DB in folder) ──
  const handleScanFromWelcome = useCallback(async () => {
    const folderPath = await window.api.showOpenFolderDialog();
    if (!folderPath) return;

    scanningRef.current = true;
    setScanning(true);
    setScanMode('scan');
    setScanLog([]);
    setError(null);

    const targetDb = folderPath + '/asset_librarian.db';

    try {
      const result = await window.api.runScan(folderPath, targetDb);
      if (result?.lines) setScanLog(result.lines);

      if (result?.ok) {
        await connectDb(targetDb);
        await window.api.watchStart(folderPath);
      } else {
        setError('Scan completed with errors — check the log for details.');
      }
    } catch (e) {
      setError(`Scan failed: ${e.message}`);
      setScanLog(prev => [...prev, { level: 'error', text: e.message }]);
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, [connectDb]);

  // ── Render: Welcome Screen ──
  if (!dbConnected) {
    return (
      <>
        <DropZone onDropFolder={handleDropFolder} />
        <div className="welcome-screen">
          <div className="welcome-card">
            <div className="welcome-icon">📦</div>
            <h1>Asset Librarian</h1>
            <p>3D Model Asset Manager</p>
            <div className="welcome-actions">
              <button className="btn btn-primary btn-large" onClick={handleOpenDb} disabled={loading}>
                {loading ? 'Opening…' : '📂 Open Database'}
              </button>
              <button className="btn btn-large" onClick={handleScanFromWelcome} disabled={loading}>
                🔍 Scan Folder
              </button>
            </div>
            {error && <p className="error-text">{error}</p>}
            <div className="welcome-hint">
              <p>Open an <code>asset_librarian.db</code> file, or scan a folder of 3D models.</p>
              <p className="small">Supports FBX, OBJ, GLB, GLTF, USDZ formats.</p>
            </div>
          </div>
        </div>
        <ScanOverlay visible={scanning} log={scanLog} mode={scanMode} />
      </>
    );
  }

  // ── Render: Main App ──
  return (
    <>
      <DropZone onDropFolder={handleDropFolder} disabled={scanning} />
      <div className="app-layout">
        {/* Header */}
        <header className="app-header">
          <div className="app-title">
            <span className="app-logo">📦</span>
            <span className="app-name">Asset Librarian</span>
            {dbPath && <span className="db-path" title={dbPath}>{dbPath.split(/[/\\]/).pop()}</span>}
          </div>
          <SearchBar
            query={searchQuery}
            onQueryChange={setSearchQuery}
            formatFilter={formatFilter}
            onFormatChange={setFormatFilter}
            missingOnly={missingOnly}
            onMissingToggle={setMissingOnly}
          />
          <div className="header-actions">
            <button className="btn btn-sm" onClick={handleScanFolder} disabled={scanning}>
              🔍 Scan
            </button>
            <button className="btn btn-sm" onClick={handleGenerateThumbnails} disabled={scanning}>
              🖼️ Thumbnails
            </button>
            <button className="btn btn-sm" onClick={handleValidate} disabled={scanning}>
              ✅ Validate
            </button>
            <button className="btn btn-sm" onClick={handleOpenDb}>📂 Open</button>
            <button className="btn btn-sm" onClick={refreshData}>🔄 Refresh</button>
          </div>
        </header>

        {/* Watch bar */}
        <WatchBar dbPath={dbPath} onRefresh={refreshData} />

        {/* Stats */}
        <StatsBar stats={stats} />

        {/* Main content */}
        <div className="main-content">
          <div className={`grid-panel ${selectedModel ? '' : 'full'}`}>
            <ThumbnailGrid
              models={models}
              selectedId={selectedModel?.id}
              onSelect={handleSelectModel}
              onRemoveFromManager={handleRemoveFromManager}
              onDeleteLocalAsset={handleDeleteLocalAsset}
              thumbnailVersion={thumbnailVersion}
            />
          </div>

          {selectedModel && (
            <div
              className={`detail-panel ${detailFullscreen ? 'fullscreen' : ''}`}
              style={detailFullscreen ? undefined : { '--detail-panel-width': `${detailPanelWidth}px` }}
            >
              {!detailFullscreen && (
                <div
                  className="detail-resizer"
                  onMouseDown={handleDetailResizeStart}
                  title="Drag to resize preview panel"
                />
              )}
              <ModelViewer3D
                model={selectedModel}
                onClose={() => {
                  setDetailFullscreen(false);
                  setSelectedModel(null);
                }}
                inspectorSettings={inspectorSettings}
                onCapabilitiesChange={setInspectorCapabilities}
                isFullscreen={detailFullscreen}
                onToggleFullscreen={() => setDetailFullscreen((value) => !value)}
                onThumbnailSaved={() => setThumbnailVersion((version) => version + 1)}
              />
              <SidePanel
                model={selectedModel}
                onClose={() => {
                  setDetailFullscreen(false);
                  setSelectedModel(null);
                }}
                inspectorSettings={inspectorSettings}
                onInspectorChange={updateInspectorSettings}
                inspectorCapabilities={inspectorCapabilities}
              />
            </div>
          )}
        </div>
      </div>

      <ScanOverlay visible={scanning} log={scanLog} mode={scanMode} />
    </>
  );
}
