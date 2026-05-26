import React, { useState, useEffect, useRef } from 'react';
import ModelCard from './ModelCard';

export default function ThumbnailGrid({
  models,
  selectedId,
  onSelect,
  onRemoveFromManager,
  onDeleteLocalAsset,
  onLoadMore,
  thumbnailVersion,
}) {
  const gridRef = useRef(null);

  if (!models || models.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-icon">🔍</span>
        <p>No models found</p>
        <p className="small">Try a different search or scan a new folder.</p>
      </div>
    );
  }

  return (
    <div className="thumbnail-grid" ref={gridRef}>
      {models.map((model) => (
        <ModelCard
          key={model.id}
          model={model}
          selected={model.id === selectedId}
          onClick={() => onSelect(model)}
          onRemoveFromManager={onRemoveFromManager}
          onDeleteLocalAsset={onDeleteLocalAsset}
          thumbnailVersion={thumbnailVersion}
        />
      ))}
    </div>
  );
}
