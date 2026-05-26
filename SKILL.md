---
name: asset-librarian
description: "Scan local folders for FBX/OBJ/GLB models, detect texture maps, generate thumbnails, write metadata to SQLite, and report missing textures."
metadata:
  {
    "openclaw":
      {
        "emoji": "📦",
        "requires": { "bins": ["python", "ffmpeg"] },
        "os": ["win32", "darwin", "linux"],
      },
  }
---

# Asset Librarian — 3D Model Asset Manager

Scans asset directories, catalogs 3D model files and textures, generates thumbnails, and stores everything in a local SQLite database.

## Workflow

### 1. Initialize the database

Run `scripts/init_db.py` to create the SQLite DB at the configured `ASSET_DB` path (default: `<scan_root>/asset_librarian.db`).

### 2. Scan a folder

Run `scripts/scan_assets.py` to:

- Walk the target directory recursively
- Identify 3D model files (`.fbx`, `.obj`, `.glb`, `.gltf`)
- Detect associated texture maps by filename conventions
- Match maps to model variants (LOD, material groups)
- Insert/update records in SQLite
- Print a missing-texture report

### 3. Generate thumbnails

Run `scripts/create_thumbnails.py` to render preview images for each model. Thumbnails are saved alongside the model file as `<model_name>_thumb.png`.

## Texture map detection rules

Texture filenames are matched against these key patterns (case-insensitive):

| Map             | Keywords                                    |
| --------------- | ------------------------------------------- |
| Albedo / Diffuse | `albedo`, `diffuse`, `diff`, `basecolor`, `base_color`, `col` |
| Normal            | `normal`, `nrm`, `nml`                     |
| Roughness         | `roughness`, `rough`, `rgh`               |
| Metallic          | `metallic`, `metal`, `met`                |
| AO (Ambient Occlusion) | `ao`, `ambient_occlusion`, `occlusion` |
| Displacement / Height | `displacement`, `disp`, `height`, `hgt` |
| Specular           | `specular`, `spec`, `spc`                |
| Glossiness         | `glossiness`, `gloss`, `gls`             |
| Opacity / Alpha    | `opacity`, `alpha`, `opac`, `alp`        |
| Emission           | `emission`, `emissive`, `emit`, `em`, `glow` |
| Subsurface         | `sss`, `subsurface`, `subdermal`         |

Textures in the same parent directory as the model, or in a `textures/` subdirectory, are matched to the model. A model's "texture set" is complete when each expected channel has exactly one candidate.

## Database schema (SQLite)

**Table: `models`**

| Column           | Type    | Description                              |
| ---------------- | ------- | ---------------------------------------- |
| id               | INTEGER | Primary key (auto)                       |
| file_path        | TEXT    | Full path to the model file              |
| file_name        | TEXT    | Base filename                            |
| format           | TEXT    | `fbx` / `obj` / `glb` / `gltf`          |
| file_size_bytes  | INTEGER | File size                                |
| last_modified    | TEXT    | ISO timestamp                            |
| scan_timestamp   | TEXT    | When this row was last updated           |
| variant          | TEXT    | LOD/variant label if detected            |

**Table: `textures`**

| Column     | Type    | Description                                |
| ---------- | ------- | ------------------------------------------ |
| id         | INTEGER | Primary key (auto)                         |
| model_id   | INTEGER | FK → models.id                             |
| file_path  | TEXT    | Full path to the texture file              |
| map_type   | TEXT    | One of: albedo, normal, roughness, metallic, ao, displacement, specular, glossiness, opacity, emission, subsurface |
| width      | INTEGER | Pixel width (if detectable)                |
| height     | INTEGER | Pixel height (if detectable)               |

**Table: `missing_textures`**

| Column        | Type    | Description                          |
| ------------- | ------- | ------------------------------------ |
| id            | INTEGER | Primary key (auto)                   |
| model_id      | INTEGER | FK → models.id                       |
| missing_types | TEXT    | Comma-separated missing map types    |
| reported_at   | TEXT    | When the gap was first reported      |
| resolved      | INTEGER | 0 = unresolved, 1 = resolved        |

## Configuration

Options are passed as CLI arguments or set via environment variables:

| Env / Arg      | Default                        | Description                      |
| -------------- | ------------------------------ | -------------------------------- |
| `ASSET_ROOT`   | `./assets`                     | Directory to scan                |
| `ASSET_DB`     | `<ASSET_ROOT>/asset_librarian.db` | SQLite database path          |
| `THUMB_SIZE`   | `256`                          | Thumbnail width in pixels        |

## Blender integration

Blender (≥4.x) provides high-quality EEVEE-rendered thumbnails and format conversion.

### Thumbnail rendering via Blender (`blender_scripts/render_thumbnail.py`)

When Blender is installed, `create_thumbnails.py` automatically detects it and renders
EEVEE thumbnails with studio lighting, auto-centering, auto-scaling, and transparent
background. Falls back to trimesh vertex projection when Blender is absent.

**Blender auto-detection** searches these locations:
- `PATH` / `which`
- Windows: `C:\Program Files\Blender Foundation\Blender {4.0–4.5}`,
  `%LOCALAPPDATA%\Blender Foundation`, winget install paths
- macOS: `/Applications/Blender.app`, `~/Applications/Blender.app`
- Linux: `/snap/bin/blender`, `/usr/bin/blender`

```bash
# Manual invocation
blender --background --python blender_scripts/render_thumbnail.py -- \
    --model path/to/model.fbx \
    --output path/to/thumb.png \
    --size 512 \
    --rotation 45 30 0
```

### Thumbnail pipeline (integrated into Electron UI)

The Electron desktop app runs `create_thumbnails.py` automatically after each scan
as the third pipeline step: `init_db.py` → `scan_assets.py` → `create_thumbnails.py`.

To regenerate thumbnails for an already-scanned database, click the
**🖼️ Thumbnails** button in the header. This uses `--force` to re-render even
cached thumbnails.

### CLI flags for `create_thumbnails.py`

| Flag | Description |
|------|-------------|
| `--db <path>` | SQLite database path |
| `--root <dir>` | Root asset directory |
| `--size <px>` | Thumbnail width (default 256) |
| `--blender-only` | Fail if Blender is not found |
| `--force` | Regenerate even cached thumbnails |

## UE Naming Validation

`scripts/validate_assets.py` checks asset filenames against Unreal Engine prefix
conventions and detects texture channel content by analyzing actual pixel data.

### UE prefix validation

Recognizes 40+ standard UE prefixes and checks:
- Valid prefix present (`SM_`, `SK_`, `M_`, `T_`, `BP_`, etc.)
- Prefix is uppercase (warns on `sm_` instead of `SM_`)
- No spaces or special characters in name
- Name length ≤ 120 characters
- Texture suffix matches type (`_D` = albedo, `_N` = normal, `_R` = roughness, etc.)
- Fuzzy prefix suggestions for unrecognized prefixes

### Per-type deep validation for SM_, SK_, T_, M_, MI_, BP_

| Type | Convention | Checks |
|------|-----------|-------|
| `SM_` | `SM_Module_MeshName[_Variant][_LOD#]` | PascalCase segments, module required, descriptive mesh name (not "Mesh"/"Prop"/"Asset"), no material prefixes inside, min 2 segments |
| `SK_` | `SK_SkeletonName_PartName[_LOD#]` | PascalCase, min 3 segments (needs skeleton + part name), variant/lod suffixes valid |
| `T_`  | `T_Module_AssetName_Suffix` | Must have _D/_N/_R/_M/_ORM/etc. suffix, min 2 segments, base name ≤ 80 chars, checks suffix matches map type |
| `M_`  | `M_Module_MaterialName[_Variant]` | PascalCase, 2‑segment names must be ≥ 6 chars, warns on texture-like suffixes |
| `MI_` | `MI_ParentMaterial_Variant` | Min 3 segments (needs parent + variant), warns if variant same as parent |
| `BP_` | `BP_Module_ClassName[_Variant]` | PascalCase, descriptive class name (not "Test"/"NewBlueprint"), min 2 segments |

Cross-type checks:
- Double underscores (`__`) flagged
- Numeric suffixes flagged (use `_LOD#` instead)
- All non-prefix segments checked for PascalCase
- Special characters and spaces rejected

### Texture channel detection

Opens each texture, downsamples to 64×64, and analyzes channel content:
- Channel mean and standard deviation (R, G, B, A)
- Constant vs varying content detection
- Normal map detection (bluish-tint heuristic)
- Packed ORM detection (AO=R, Roughness=G, Metallic=B)
- sRGB vs linear colorspace guess
- Alpha channel presence
- Bit depth

### Schema (`asset_validation` table)

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| model_id | INTEGER | FK → models.id |
| ue_prefix | TEXT | Detected prefix (`SM`, `SK`, `T`, etc.) |
| ue_category | TEXT | Asset category (Static Mesh, Texture, etc.) |
| ue_status | TEXT | `valid`, `invalid_prefix`, `case_warning`, `invalid_name` |
| ue_issues | TEXT | Comma-separated issues |
| validated_at | TEXT | Timestamp |

### Run

```bash
# Validate + detect texture channels
python scripts/validate_assets.py --db ./asset_librarian.db

# Report only (no DB writes)
python scripts/validate_assets.py --db ./asset_librarian.db --report-only
```

Validation runs automatically as part of every folder scan in the Electron app.
Click **✅ Validate** anytime to re-run on the current database.

### Format conversion (`blender_scripts/convert_format.py`)

Convert between any supported format (FBX ↔ OBJ ↔ GLB/GLTF).

```bash
blender --background --python blender_scripts/convert_format.py -- \
    --input model.fbx \
    --output model.glb
```

### Model inspection (`blender_scripts/inspect_model.py`)

Extract detailed metadata: vertex/edge/face counts, material names,
texture paths, UV layers, vertex colour layers, integrity check.

```bash
# Human-readable report
blender --background --python blender_scripts/inspect_model.py -- \
    --model path/to/model.glb

# JSON output for programmatic use
blender --background --python blender_scripts/inspect_model.py -- \
    --model path/to/model.glb --json
```

## Three.js web viewer

A self-contained HTML 3D viewer at `viewer/index.html` for previewing models
in the browser. Features:

- Drag-and-drop loading of GLB, GLTF, OBJ (with MTL), FBX files
- Orbit controls (pan, rotate, zoom)
- Auto-rotate toggle
- Auto-fit camera on load
- Vertex count display
- EEVEE-like lighting (hemisphere + directional + rim)
- Shadow casting
- Works offline after `npm install` in the `viewer/` directory

```bash
# Serve locally (e.g. via Python's built-in HTTP server)
cd viewer
python -m http.server 8080
# Then open http://localhost:8080 in your browser
```

The viewer uses the Three.js library installed via npm:

```bash
cd viewer
npm install
```

## Electron Desktop UI

A full React + Electron desktop application lives in the `ui/` directory.

### Features

- **Drag-and-drop import** — drag folders or `.fbx`/`.obj`/`.glb`/`.gltf` files from your file manager onto the window; shows a translucent overlay with upload icon during drag; auto-detects the common parent directory and runs the scanner
- **Folder watch** — watches a folder in real-time; auto-scans new `.fbx`/`.obj`/`.glb`/`.gltf` files as they appear with a 3-second debounce; shows live toast notifications
- **Scan folder** — full pipeline: init DB → scan models → generate thumbnails (Blender or fallback)
- **Thumbnail grid** — browses all scanned models with format badges, size, and missing-texture warnings
- **3D preview panel** — drag-rotate/pinch-zoom with Three.js, auto-fits camera, shows vertex/face/material counts
- **Side panel** — detailed metadata, texture list with dimensions, missing texture alerts
- **Search & filter** — search by name, filter by format (FBX/OBJ/GLB/GLTF), toggle to show only incomplete models
- **Stats bar** — instant summary of total models, textures, missing maps, format breakdown
- **Native DB picker** — open any `asset_librarian.db` via native file dialog

### Stack

| Layer | Technology |
|-------|-----------|
| Shell | Electron (main/preload) |
| UI    | React 18 + Vite |
| 3D    | Three.js with GLTF/OBJ/FBX loaders |
| DB    | sql.js (pure JS SQLite — no native deps) |

### Run in dev mode

```bash
cd ui
npm install
npm run dev:renderer   # Vite dev server on :5173
npm run dev:electron  # Electron window connected to Vite
# Or: npm run dev      # Both concurrently
```

### Build for production

```bash
cd ui
npm run build:renderer   # Builds to ui/dist/
# Then package with electron-builder:
npx electron-builder --win  # Windows installer
```

### File structure

```
ui/
├── package.json
├── vite.config.js
├── index.html
├── electron/
│   ├── main.js         # Electron main process + IPC
│   └── preload.js      # Context bridge (api.*)
└── src/
    ├── main.jsx        # React entry
    ├── App.jsx         # Root app (DB connect, routing)
    ├── components/
    │   ├── ThumbnailGrid.jsx
    │   ├── ModelCard.jsx
    │   ├── ModelViewer3D.jsx
    │   ├── SidePanel.jsx
    │   ├── SearchBar.jsx
    │   ├── StatsBar.jsx
    │   ├── ScanOverlay.jsx
    │   └── WatchBar.jsx
    └── styles/
        ├── app.css
        └── watch-bar.css
```

## Report

After scanning, the script prints:

- Total models found (by format)
- Models with complete texture sets
- Models with missing textures (grouped by missing channel)
- Unused / orphaned texture files


## Architecture: Background Workers

The UI uses a background worker architecture inspired by multi-process
database servers and job queues:

`
Electron main process (main.js)
  ├── IPC Handlers              ← renderer requests
  ├── FolderWatcher (watcher.js) ← lightweight FS events
  └── Worker Manager (workers/worker-manager.js)
        ├── DB Worker (worker_thread: sql.js)
        │     Owns the SQLite connection in an isolated thread.
        │     All queries serialised via message-passing IPC.
        │     Avoids blocking the renderer or main process.
        ├── Scan Queue (workers/scan-queue.js)
        │     Manages Python subprocess scans as a singleton queue.
        │     Pending scans are debounced and merged.
        │     Only one scan runs at a time.
        └── Thumbnail Queue (workers/thumbnail-queue.js)
              Batches Blender renders into groups of 10 models
              per Python invocation, avoiding 3-8s cold-start
              overhead per model.
`

### Worker isolation

| Worker | Process | Memory | Crash behaviour |
|--------|---------|--------|-----------------|
| DB worker | worker_thread (same process) | WASM heap in thread | Thread restartable, DB reopened |
| Scan queue | child_process (Python) | OS-managed | Auto-respawned on next request |
| Thumbnail queue | child_process (Python) | OS-managed | Queue persists, next batch retries |

### Benefits

- **Database access is non-blocking** to the UI thread
- **Scans are debounced and merged** — rapid file changes don't queue
- **Thumbnails batch-rendered** — 10 models per invocation
- **Watcher polling reduced** to 30-second fallback
- **Deletions handled inline** without a full re-scan


## Production Build & Packaging

### Prerequisites

`ash
pip install Pillow numpy trimesh
`

### Build the desktop app

`ash
cd ui
npm install
npm run build            # Windows NSIS installer (ui/release/)
npm run build:mac        # macOS DMG
npm run build:linux      # Linux AppImage + deb
`

### Output

`
ui/release/
  ├── Asset-Librarian-Setup-1.0.0-win-x64.exe   (Windows)
  ├── Asset-Librarian-1.0.0-mac-x64.dmg          (macOS Intel)
  ├── Asset-Librarian-1.0.0-mac-arm64.dmg        (macOS Apple Silicon)
  ├── Asset-Librarian-1.0.0-linux-x86_64.AppImage (Linux)
  └── Asset-Librarian-1.0.0-linux-x86_64.deb     (Linux)
`

### What's in the package

| Resource | Location in package | Purpose |
|----------|-------------------|---------|
| dist/ | pp.asar/dist/ | React UI (Vite build) |
| electron/ | pp.asar/electron/ | Main + preload + workers |
| scripts/*.py | Resources/scripts/ | Scanner, validator, analyzer |
| lender_scripts/*.py | Resources/blender_scripts/ | Thumbnail renderer |
| sql.js WASM | pp.asar.unpacked/ | Database engine |

### Auto-update

The app checks for updates on start (with 10s delay to let the UI settle)
and every 4 hours thereafter. Update notifications prompt before downloading:

1. **Update available** → dialog asks to download
2. **Download progress** → progress bar + status in window
3. **Ready to install** → dialog asks to restart

Configure the update feed URL in electron-builder.yml:

`yaml
publish:
  provider: generic
  url: https://your-update-server.com
`

Or use GitHub Releases:

`yaml
publish:
  provider: github
  owner: your-org
  repo: asset-librarian
`
