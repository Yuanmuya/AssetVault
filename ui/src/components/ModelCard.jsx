import React, { useState, useEffect, useRef } from 'react';

const FORMAT_COLORS = {
  fbx: '#e67e22',
  obj: '#2980b9',
  glb: '#27ae60',
  gltf: '#8e44ad',
  usdz: '#c49a2c',
};

export default function ModelCard({
  model,
  selected,
  onClick,
  onRemoveFromManager,
  onDeleteLocalAsset,
  thumbnailVersion,
}) {
  const [thumbPath, setThumbPath] = useState(null);
  const [imgError, setImgError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    (async () => {
      const path = await window.api.getThumbnailPath(model.file_path);
      setThumbPath(path);
      setImgError(false);
    })();
  }, [model.file_path, thumbnailVersion]);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const fmt = model.format?.toLowerCase();
  const color = FORMAT_COLORS[fmt] || '#666';
  const sizeMb = model.file_size_bytes ? (model.file_size_bytes / 1048576).toFixed(1) : '?';
  const hasMissing = model.missing_count > 0;

  const handleMenuToggle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen((open) => !open);
  };

  const handleRemove = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen(false);
    onRemoveFromManager?.(model);
  };

  const handleDeleteLocal = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen(false);
    onDeleteLocalAsset?.(model);
  };

  return (
    <div
      className={`model-card ${selected ? 'selected' : ''} ${hasMissing ? 'has-missing' : ''}`}
      onClick={onClick}
      title={model.file_name}
    >
      {/* Thumbnail */}
      <div className="card-thumb">
        {thumbPath && !imgError ? (
          <img
            src={`file://${thumbPath}?v=${encodeURIComponent(`${model.scan_timestamp || model.last_modified || ''}-${thumbnailVersion || 0}`)}`}
            alt={model.file_name}
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="card-placeholder">
            <span className="placeholder-icon">
              {fmt === 'fbx' ? '🔶' : fmt === 'obj' ? '🔷' : fmt === 'glb' ? '🟢' : fmt === 'usdz' ? '🟡' : '🟣'}
            </span>
          </div>
        )}

        {/* Format badge */}
        <span className="card-format" style={{ background: color }}>
          {fmt?.toUpperCase()}
        </span>

        {/* Missing warning */}
        {hasMissing && <span className="card-warning">⚠️</span>}

        <div className="card-menu" ref={menuRef}>
          <button
            className="card-menu-button"
            onClick={handleMenuToggle}
            title="Asset actions"
            aria-label={`Actions for ${model.file_name}`}
            aria-expanded={menuOpen}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="card-menu-popover" onClick={(event) => event.stopPropagation()}>
              <button type="button" onClick={handleRemove}>
                从管理器移除
              </button>
              <button type="button" className="danger" onClick={handleDeleteLocal}>
                删除本地资源
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="card-info">
        <div className="card-name" title={model.file_name}>
          {model.file_name}
        </div>
        <div className="card-meta">
          {sizeMb} MB
          {model.variant && <span className="card-variant">{model.variant}</span>}
        </div>
        {hasMissing && (
          <div className="card-missing">
            Missing: {model.missing_types}
          </div>
        )}
      </div>
    </div>
  );
}
