import React, { useState } from 'react';

export default function SearchBar({
  query, onQueryChange,
  formatFilter, onFormatChange,
  missingOnly, onMissingToggle,
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div className={`search-bar ${focused ? 'focused' : ''}`}>
      <span className="search-icon">🔍</span>
      <input
        type="text"
        placeholder="Search models by name or path…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />

      <select
        value={formatFilter}
        onChange={(e) => onFormatChange(e.target.value)}
        className="filter-select"
      >
        <option value="">All formats</option>
        <option value="fbx">FBX</option>
        <option value="obj">OBJ</option>
        <option value="glb">GLB</option>
        <option value="gltf">GLTF</option>
        <option value="usdz">USDZ</option>
      </select>

      <label className="missing-toggle">
        <input
          type="checkbox"
          checked={missingOnly}
          onChange={(e) => onMissingToggle(e.target.checked)}
        />
        <span>Missing textures only</span>
      </label>
    </div>
  );
}
