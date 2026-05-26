import React, { useState, useEffect } from 'react';

const MAP_TYPE_EMOJIS = {
  albedo: '🎨', normal: '🔵', roughness: '⚪', metallic: '✨',
  ao: '🌑', displacement: '📏', specular: '💎', glossiness: '🪞',
  opacity: '👻', emission: '💡', subsurface: '🫧',
};

const STATUS_ICONS = {
  valid: '✅',
  invalid_prefix: '❌',
  invalid_name: '❌',
  invalid: '❌',
  case_warning: '⚠️',
  length_warning: '⚠️',
  unknown: '❓',
};

const WIRE_COLORS = ['#ffffff', '#050505', '#bfc4cc', '#ff1f2d', '#1257ff', '#00e84a', '#fff200'];

const CHANNELS = [
  { id: 'baseColor', label: 'Base Color', type: 'albedo', always: true },
  { id: 'metalness', label: 'Metalness', type: 'metallic' },
  { id: 'roughness', label: 'Roughness', type: 'roughness' },
  { id: 'normal', label: 'Normal Map', type: 'normal' },
  { id: 'ao', label: 'AO map', type: 'ao' },
  { id: 'opacity', label: 'Opacity', type: 'opacity' },
  { id: 'emission', label: 'Emission', type: 'emission' },
  { id: 'specularF0', label: 'Specular F0', capability: 'hasSpecular' },
  { id: 'clearCoat', label: 'Clear Coat', capability: 'hasClearCoat' },
  { id: 'clearCoatRoughness', label: 'Clear Coat Roughness', capability: 'hasClearCoat' },
];

const GEOMETRY_MODES = [
  { id: 'matcap', label: 'Matcap' },
  { id: 'matcapSurface', label: 'Matcap+Surface' },
  { id: 'wireframe', label: 'Wireframe' },
  { id: 'vertexNormals', label: 'Vertex Normals', capability: 'hasNormals' },
];

function InspectorButton({ active, disabled, children, onClick, title }) {
  return (
    <button
      className={`inspector-row-button ${active ? 'active' : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      <span className="inspector-glyph" />
      <span>{children}</span>
    </button>
  );
}

export default function SidePanel({
  model,
  onClose,
  inspectorSettings,
  onInspectorChange,
  inspectorCapabilities = {},
}) {
  const [detail, setDetail] = useState(null);
  const [validation, setValidation] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    if (!model?.id) return;
    (async () => {
      setLoadingDetail(true);
      const [data, val] = await Promise.all([
        window.api.getModel(model.id),
        window.api.getValidation(model.id),
      ]);
      setDetail(data);
      setValidation(val);
      setLoadingDetail(false);
    })();
  }, [model?.id]);

  if (!model) return null;

  const fmt = model.format?.toUpperCase();
  const sizeMb = model.file_size_bytes ? (model.file_size_bytes / 1048576).toFixed(2) : '?';
  const textures = detail?.textures || [];
  const missing = detail?.missing || [];
  const settings = inspectorSettings;

  // Group textures by map type
  const groupedTextures = {};
  textures.forEach((t) => {
    if (!groupedTextures[t.map_type]) groupedTextures[t.map_type] = [];
    groupedTextures[t.map_type].push(t);
  });
  const hasTextureType = (type) => Boolean(groupedTextures[type]?.length);
  const setSetting = (patch) => onInspectorChange(patch);
  const setWireframe = (patch) => onInspectorChange((current) => ({
    ...current,
    wireframe: { ...current.wireframe, ...patch },
  }));
  const setMaterialChannel = (channel) => setSetting({
    materialChannel: channel,
    geometryMode: channel === 'final' ? settings.geometryMode : 'none',
  });
  const setGeometryMode = (mode) => setSetting({
    geometryMode: settings.geometryMode === mode ? 'none' : mode,
    materialChannel: 'final',
  });

  // Validation
  const valData = validation;
  const hasValidation = valData && valData.ue_status;
  const isInvalid = hasValidation && valData.ue_status !== 'valid';
  const issues = valData?.ue_issues ? valData.ue_issues.split(',').filter(Boolean) : [];
  const prefixStr = valData?.ue_prefix ? `[${valData.ue_prefix}]` : null;
  const catStr = valData?.ue_category || null;

  return (
    <div className="side-panel">
      <div className="panel-header">
        <h3>📄 Details</h3>
        <button className="btn btn-sm" onClick={onClose}>✕</button>
      </div>

      <div className="panel-body">
        <section className="panel-section inspector-section">
          <h4>Model Inspector</h4>

          <div className="inspector-group">
            <div className="inspector-label-row">
              <span>WIRE FRAME</span>
              <span>{Math.round((settings.wireframe?.opacity ?? 0.55) * 10)}</span>
            </div>
            <div className="wire-controls">
              <button
                className={`wire-off ${!settings.wireframe?.enabled ? 'active' : ''}`}
                onClick={() => setWireframe({ enabled: false })}
                title="Wireframe off"
              >
                <span className="wire-off-icon" />
              </button>
              {WIRE_COLORS.map((color) => (
                <button
                  key={color}
                  className={`wire-color ${settings.wireframe?.enabled && settings.wireframe?.color === color ? 'active' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => setWireframe({ color, enabled: true })}
                  title={color}
                />
              ))}
            </div>
            <input
              className="inspector-slider"
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={settings.wireframe?.opacity ?? 0.55}
              onChange={(e) => setWireframe({ opacity: Number(e.target.value), enabled: true })}
            />
            <div className="side-mode-toggle" title="Choose material side rendering">
              <button
                className={settings.singleSided ? 'active' : ''}
                onClick={() => setSetting({ singleSided: true })}
              >
                Single
              </button>
              <button
                className={!settings.singleSided ? 'active' : ''}
                onClick={() => setSetting({ singleSided: false })}
              >
                Double
              </button>
            </div>
          </div>

          <div className="inspector-group">
            <div className="inspector-label-row"><span>VIEWPORT</span></div>
            <div className="segmented-control">
              {[
                ['3d', '3D'],
                ['split', '3D + 2D'],
                ['2d', '2D'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={settings.viewport === id ? 'active' : ''}
                  onClick={() => setSetting({ viewport: id })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="inspector-group">
            <div className="inspector-label-row"><span>RENDER</span></div>
            <InspectorButton
              active={settings.renderMode === 'final' && settings.materialChannel === 'final' && settings.geometryMode === 'none'}
              onClick={() => setSetting({ renderMode: 'final', materialChannel: 'final', geometryMode: 'none' })}
            >
              Final Render
            </InspectorButton>
            <InspectorButton
              active={settings.renderMode === 'noPost'}
              onClick={() => setSetting({ renderMode: settings.renderMode === 'noPost' ? 'final' : 'noPost' })}
            >
              No Post-Processing
            </InspectorButton>
          </div>

          <div className="inspector-group">
            <div className="inspector-label-row"><span>ANIMATION</span></div>
            <InspectorButton
              active={settings.bones}
              disabled={!inspectorCapabilities.hasBones}
              onClick={() => setSetting({ bones: !settings.bones })}
              title={!inspectorCapabilities.hasBones ? 'No skeleton found in this model' : 'Show skeleton bones'}
            >
              Bones
            </InspectorButton>
            <InspectorButton
              active={settings.boneInfluence}
              disabled={!inspectorCapabilities.hasSkinWeights}
              onClick={() => setSetting({ boneInfluence: !settings.boneInfluence })}
              title={!inspectorCapabilities.hasSkinWeights ? 'No skin weights found in this model' : 'Show bone influence heat map'}
            >
              Bones Influence
            </InspectorButton>
          </div>

          <div className="inspector-group">
            <div className="inspector-label-row"><span>MATERIAL CHANNELS</span></div>
            {CHANNELS.map((channel) => {
              const disabled = channel.capability
                ? !inspectorCapabilities[channel.capability]
                : (!channel.always && !hasTextureType(channel.type));
              return (
                <InspectorButton
                  key={channel.id}
                  active={settings.materialChannel === channel.id}
                  disabled={disabled}
                  onClick={() => setMaterialChannel(settings.materialChannel === channel.id ? 'final' : channel.id)}
                  title={disabled ? 'No matching material channel found' : channel.label}
                >
                  {channel.label}
                </InspectorButton>
              );
            })}
          </div>

          <div className="inspector-group">
            <div className="inspector-label-row"><span>GEOMETRY</span></div>
            {GEOMETRY_MODES.map((mode) => (
              <InspectorButton
                key={mode.id}
                active={settings.geometryMode === mode.id}
                disabled={mode.capability ? !inspectorCapabilities[mode.capability] : false}
                onClick={() => setGeometryMode(mode.id)}
                title={mode.capability && !inspectorCapabilities[mode.capability] ? 'Geometry data is not available' : mode.label}
              >
                {mode.label}
              </InspectorButton>
            ))}
          </div>

          <div className="inspector-group">
            <div className="inspector-label-row"><span>UV</span></div>
            <InspectorButton
              active={settings.geometryMode === 'uvChecker'}
              disabled={!inspectorCapabilities.hasUv}
              onClick={() => setGeometryMode('uvChecker')}
              title={!inspectorCapabilities.hasUv ? 'No UV coordinates found' : 'Show UV checker'}
            >
              UV Checker
            </InspectorButton>
          </div>
        </section>

        {/* File info */}
        <section className="panel-section">
          <h4>File</h4>
          <div className="detail-row">
            <span className="detail-label">Name</span>
            <span className="detail-value mono" title={model.file_name}>{model.file_name}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Format</span>
            <span className={`format-badge format-${fmt?.toLowerCase()}`}>{fmt}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Size</span>
            <span className="detail-value">{sizeMb} MB</span>
          </div>
          {model.variant && (
            <div className="detail-row">
              <span className="detail-label">Variant</span>
              <span className="detail-value variant-badge">{model.variant}</span>
            </div>
          )}
          <div className="detail-row">
            <span className="detail-label">Modified</span>
            <span className="detail-value">{model.last_modified?.split('T')[0]}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Scanned</span>
            <span className="detail-value">{model.scan_timestamp?.split('T')[0]}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Path</span>
            <span className="detail-value mono small" title={model.file_path}>
              {model.file_path?.split(/[/\\]/).slice(-3).join('/')}
            </span>
          </div>
        </section>

        {/* ── Naming Validation ── */}
        {hasValidation && (
          <section className={`panel-section validation-section ${isInvalid ? 'validation-warn' : 'validation-ok'}`}>
            <h4>
              {STATUS_ICONS[valData.ue_status] || '✅'} Naming
              {prefixStr && <span className="validation-prefix">{prefixStr}</span>}
            </h4>

            {catStr && (
              <div className="detail-row">
                <span className="detail-label">Category</span>
                <span className="detail-value">{catStr}</span>
              </div>
            )}

            <div className="detail-row">
              <span className="detail-label">Status</span>
              <span className={`validation-status-badge ${valData.ue_status}`}>
                {valData.ue_status.replace(/_/g, ' ')}
              </span>
            </div>

            {issues.length > 0 && (
              <div className="validation-issues">
                <span className="detail-label">Issues</span>
                <ul className="validation-issue-list">
                  {issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            {valData.validated_at && (
              <div className="detail-row">
                <span className="detail-label">Checked</span>
                <span className="detail-value">{valData.validated_at?.split('T')[0]}</span>
              </div>
            )}
          </section>
        )}

        {!hasValidation && !loadingDetail && (
          <section className="panel-section">
            <h4>✅ Naming</h4>
            <p className="empty-hint">Not yet validated — run <strong>✅ Validate</strong> from the header.</p>
          </section>
        )}

        {/* Textures */}
        <section className="panel-section">
          <h4>
            Textures
            {textures.length > 0 && <span className="badge">{textures.length}</span>}
          </h4>
          {Object.entries(groupedTextures).map(([type, texList]) => (
            <div className="texture-group" key={type}>
              <div className="texture-type-header">
                <span>{MAP_TYPE_EMOJIS[type] || '📋'}</span>
                <span className="texture-type-name">{type}</span>
              </div>
              {texList.map((tex) => (
                <div className="detail-row texture-row" key={tex.id}>
                  <span className="detail-value mono small" title={tex.file_path}>
                    {tex.file_path?.split(/[/\\]/).pop()}
                  </span>
                  {(tex.width && tex.height) && (
                    <span className="detail-hint">{tex.width}×{tex.height}</span>
                  )}
                </div>
              ))}
            </div>
          ))}
          {textures.length === 0 && !loadingDetail && (
            <p className="empty-hint">No textures indexed</p>
          )}
        </section>

        {/* Missing textures */}
        {missing.length > 0 && (
          <section className="panel-section warn-section">
            <h4>⚠️ Missing Textures</h4>
            {missing.map((m) => (
              <div className="missing-row" key={m.id}>
                <span className="missing-types">{m.missing_types}</span>
                <span className="missing-date">since {m.reported_at?.split('T')[0]}</span>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
