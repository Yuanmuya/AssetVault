import React, { useState, useEffect, useCallback, useRef } from 'react';

export default function WatchBar({ dbPath, onRefresh }) {
  const [watching, setWatching] = useState(false);
  const [watchFolder, setWatchFolder] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [debounceRemaining, setDebounceRemaining] = useState(0);
  const [toast, setToast] = useState(null);
  const toastsRef = useRef([]);
  const toastId = useRef(0);

  const showToast = useCallback((text, type, duration = 4000) => {
    const id = ++toastId.current;
    toastsRef.current.push({ id, text, type });

    // Remove after duration
    setTimeout(() => {
      toastsRef.current = toastsRef.current.filter(t => t.id !== id);
      setToast(toastsRef.current[toastsRef.current.length - 1] || null);
    }, duration);

    setToast({ id, text, type });
  }, []);

  // ── Watch IPC events ──
  useEffect(() => {
    const unsubDetected = window.api.onWatchDetected((data) => {
      const parts = [];
      if (data.additions > 0) parts.push(`${data.additions} new`);
      if (data.deletions > 0) parts.push(`${data.deletions} removed`);
      const desc = parts.join(', ') || `${data.count} change(s)`;
      showToast(`👀 ${desc} — scanning...`, 'info', 3000);
    });

    const unsubUpdated = window.api.onWatchUpdated((data) => {
      setScanning(false);
      setPendingCount(0);
      const parts = [];
      if (data.added > 0) parts.push(`${data.added} added`);
      if (data.removed > 0) parts.push(`${data.removed} removed`);
      const desc = parts.join(', ') || `${data.count} updated`;
      showToast(`✅ ${desc} — grid refreshed`, 'success', 5000);
      if (onRefresh) onRefresh();
    });

    const unsubStatus = window.api.onWatchStatusUpdate?.((data) => {
      setDebounceRemaining(data.debounceRemaining || 0);
      setPendingCount(data.pending || 0);
      setScanning(data.scanning || false);
    });

    return () => {
      unsubDetected();
      unsubUpdated();
      if (unsubStatus) unsubStatus();
    };
  }, [onRefresh, showToast]);

  // ── Poll status fallback ──
  useEffect(() => {
    if (!watching) return;
    const interval = setInterval(async () => {
      try {
        const status = await window.api.watchStatus();
        setPendingCount(status.pending || 0);
        setScanning(status.scanning || false);
        if (status.debounceRemaining !== undefined) {
          setDebounceRemaining(status.debounceRemaining);
        }
      } catch (_) {}
    }, 2000);
    return () => clearInterval(interval);
  }, [watching]);

  // ── Resume watch status on mount ──
  useEffect(() => {
    (async () => {
      try {
        const status = await window.api.watchStatus();
        if (status.watching) {
          setWatching(true);
          setWatchFolder(status.folderPath);
          setScanning(status.scanning);
          setDebounceRemaining(status.debounceRemaining || 0);
        }
      } catch (_) {}
    })();
  }, [dbPath]);

  // ── Start / Stop ──
  const handleStartWatch = useCallback(async () => {
    const folderPath = await window.api.showOpenFolderDialog();
    if (!folderPath) return;

    const result = await window.api.watchStart(folderPath);
    if (result.ok) {
      setWatching(true);
      setWatchFolder(result.folderPath);
      setPendingCount(0);
      showToast(`👁 Watching: ${result.folderPath.split(/[/\\]/).pop()}`, 'info', 3000);
    } else {
      showToast(`Watch failed: ${result.error}`, 'error', 5000);
    }
  }, [showToast]);

  const handleStopWatch = useCallback(async () => {
    await window.api.watchStop();
    setWatching(false);
    setWatchFolder(null);
    setPendingCount(0);
    setScanning(false);
    setDebounceRemaining(0);
    showToast('Watch stopped', 'info', 2500);
  }, [showToast]);

  if (!dbPath) return null;

  return (
    <div className={`watch-bar ${watching ? 'active' : ''}`}>
      <div className="watch-left">
        {watching ? (
          <>
            <span className="watch-indicator" title="Watching for changes">
              <span className="watch-dot" /> Watching
            </span>
            <span className="watch-folder" title={watchFolder}>
              {watchFolder?.split(/[/\\]/).pop()}
            </span>

            {scanning && (
              <span className="watch-scanning">
                <span className="watch-spinner-sm" /> Scanning…
              </span>
            )}

            {!scanning && debounceRemaining > 0 && (
              <span className="watch-pending">
                ⏳ {debounceRemaining}s — {pendingCount} pending
              </span>
            )}

            {!scanning && debounceRemaining === 0 && pendingCount > 0 && (
              <span className="watch-pending">⏳ Processing {pendingCount} changes...</span>
            )}
          </>
        ) : (
          <span className="watch-idle">Not watching</span>
        )}
      </div>

      <div className="watch-right">
        {watching ? (
          <button className="btn btn-sm watch-btn" onClick={handleStopWatch} title="Stop watching">
            ⏹ Stop
          </button>
        ) : (
          <button className="btn btn-sm watch-btn" onClick={handleStartWatch}>
            👁 Watch Folder
          </button>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`watch-toast watch-toast-${toast.type}`} key={toast.id}>
          {toast.text}
          <button className="watch-toast-close" onClick={() => { toastsRef.current = []; setToast(null); }}>✕</button>
        </div>
      )}
    </div>
  );
}
