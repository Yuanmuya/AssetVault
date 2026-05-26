import React, { useEffect, useRef } from 'react';

export default function ScanOverlay({ visible, log, mode }) {
  const logEndRef = useRef(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [log]);

  if (!visible) return null;

  const hasError = log?.some(l => l.level === 'error');

  return (
    <div className="scan-overlay">
      <div className="scan-modal">
        <div className="scan-header">
          <span className="scan-spinner" />
          <span className="scan-title">
            {mode === 'thumbnails' ? 'Generating thumbnails…' : mode === 'validate' ? 'Validating asset naming…' : 'Scanning folder for 3D models…'}
          </span>
        </div>

        {log && log.length > 0 ? (
          <div className="scan-log">
            {log.map((entry, i) => (
              <div key={i} className={`scan-line scan-line-${entry.level}`}>
                {entry.text}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        ) : (
          <div className="scan-waiting">
            <p>Starting scanner…</p>
          </div>
        )}

        {hasError && (
          <div className="scan-footer">
            <span>⚠️ Some errors occurred — check the log above.</span>
          </div>
        )}
      </div>
    </div>
  );
}
