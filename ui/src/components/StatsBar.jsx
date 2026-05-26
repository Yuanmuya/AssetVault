import React from 'react';

export default function StatsBar({ stats }) {
  if (!stats) return null;

  const total = stats.total_models || 0;
  const missing = stats.unresolved_missing || 0;
  const textures = stats.total_textures || 0;
  const missingModels = stats.total_missing_models || 0;

  return (
    <div className="stats-bar">
      <div className="stat-item">
        <span className="stat-value">{total}</span>
        <span className="stat-label">Models</span>
      </div>
      <div className="stat-divider" />
      <div className="stat-item">
        <span className="stat-value">{textures}</span>
        <span className="stat-label">Textures</span>
      </div>
      <div className="stat-divider" />
      <div className="stat-item">
        <span className="stat-value">{missing}</span>
        <span className="stat-label">Missing maps</span>
      </div>
      <div className="stat-divider" />
      <div className={`stat-item ${missingModels > 0 ? 'stat-warn' : ''}`}>
        <span className="stat-value">{missingModels}</span>
        <span className="stat-label">Incomplete</span>
      </div>

      {stats.by_format && (
        <>
          <div className="stat-divider" />
          {stats.by_format.map((f) => (
            <div className="stat-item" key={f.format}>
              <span className="stat-label format-badge">{f.format.toUpperCase()}</span>
              <span className="stat-value-sm">{f.cnt}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
