import React, { useState, useEffect, useCallback, useRef } from 'react';

const MODEL_EXTS = new Set(['.fbx', '.obj', '.glb', '.gltf', '.usdz']);

/**
 * Extracts the common ancestor directory from an array of file paths.
 * For a single file returns its parent. For a folder with mixed files,
 * returns the deepest common ancestor.
 */
function commonAncestor(paths) {
  if (!paths || paths.length === 0) return null;
  if (paths.length === 1) {
    const p = paths[0];
    // If it has a model extension, treat as file → return parent
    const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
    return MODEL_EXTS.has(ext) ? p.replace(/[/\\][^/\\]+$/, '') : p;
  }

  // Split all paths into segments
  const split = paths.map(p => p.replace(/\\/g, '/').split('/'));

  // Find common prefix length
  let commonLen = 0;
  const first = split[0];
  for (let i = 0; i < first.length; i++) {
    const seg = first[i];
    if (split.every(s => s[i] === seg)) commonLen = i + 1;
    else break;
  }

  return split[0].slice(0, commonLen).join('/') || null;
}

function isModelFile(name) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return MODEL_EXTS.has(ext);
}

export default function DropZone({ onDropFolder, disabled }) {
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState(null);
  const dragCount = useRef(0);
  const overlayRef = useRef(null);

  const handleDragOver = useCallback((e) => {
    // Only react to file drops, not text/html
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (dragCount.current === 0) {
      setDragging(true);
    }
    dragCount.current += 1;
  }, []);

  const handleDragLeave = useCallback((e) => {
    // Only decrement when actually leaving the overlay or window
    if (e.relatedTarget && overlayRef.current?.contains(e.relatedTarget)) return;
    dragCount.current = Math.max(0, dragCount.current - 1);
    if (dragCount.current === 0) {
      setDragging(false);
      setDropTarget(null);
    }
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCount.current = 0;
    setDragging(false);
    setDropTarget(null);

    if (disabled) return;

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    // Collect all dropped paths
    const paths = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const filePath = window.api?.getDroppedFilePath?.(f) || f.path;
      if (filePath) paths.push(filePath.replace(/\\/g, '/'));
    }

    if (paths.length === 0) return;

    const pathInfo = await window.api?.getPathInfo?.(paths.map(p => p.replace(/\//g, '\\')));
    const infoByPath = new Map((pathInfo || []).map(info => [info.path.replace(/\\/g, '/'), info]));

    const dirs = [];
    const modelFiles = [];
    const otherFiles = [];
    for (const p of paths) {
      const info = infoByPath.get(p);
      if (info?.isDirectory) {
        dirs.push(p);
      } else if (isModelFile(p)) {
        modelFiles.push(p);
      } else {
        otherFiles.push(p);
      }
    }

    // Determine which folder(s) to scan
    const foldersToScan = new Set();

    if (dirs.length > 0) {
      // Dropped directories → scan each
      dirs.forEach(d => foldersToScan.add(d.replace(/\/+$/, '')));
    }

    if (modelFiles.length > 0) {
      // Dropped model files → scan their parent directories
      modelFiles.forEach(p => {
        const parent = p.replace(/[/\\][^/\\]+$/, '');
        foldersToScan.add(parent);
      });
    }

    if (otherFiles.length > 0) {
      // Dropped non-model files → scan their parent directories
      otherFiles.forEach(p => {
        const parent = p.replace(/[/\\][^/\\]+$/, '');
        foldersToScan.add(parent);
      });
    }

    // For simplicity, if multiple folders, find common ancestor
    let scanFolder = null;
    if (foldersToScan.size === 0) {
      // Nothing recognizable — try common ancestor of all paths
      scanFolder = commonAncestor(paths);
    } else if (foldersToScan.size === 1) {
      scanFolder = [...foldersToScan][0];
    } else {
      // Multiple distinct directories — find their common ancestor
      scanFolder = commonAncestor([...foldersToScan]);
    }

    if (scanFolder && onDropFolder) {
      onDropFolder(scanFolder, {
        dirs: dirs.length,
        models: modelFiles.length,
        total: paths.length,
        singleFile: dirs.length === 0 && modelFiles.length === 1 && otherFiles.length === 0 ? modelFiles[0] : null,
      });
    }
  }, [disabled, onDropFolder]);

  // Register global drag handlers
  useEffect(() => {
    // Listen on the document so drops work even when the overlay isn't visible yet
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);
    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('drop', handleDrop);
    };
  }, [handleDragOver, handleDragLeave, handleDrop]);

  if (!dragging) return null;

  return (
    <div className="drop-overlay" ref={overlayRef}>
      <div className="drop-indicator">
        <div className="drop-icon">
          <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div className="drop-text">
          <span className="drop-title">Drop to Import Assets</span>
          <span className="drop-hint">FBX · OBJ · GLB · GLTF · USDZ folders or files</span>
        </div>
      </div>
    </div>
  );
}
