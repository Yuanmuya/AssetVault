# AssetVault — 3D Asset Management System

> Also known as: **Asset Librarian**

A cross-platform desktop application for managing 3D model assets. Scan, catalog, preview, and validate FBX/OBJ/GLB/GLTF assets, auto-detect associated texture maps, generate thumbnails, and store metadata in a local SQLite database.

![Electron](https://img.shields.io/badge/Electron-42.x-47848F?logo=electron)
![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react)
![Three.js](https://img.shields.io/badge/Three.js-0.184-000000?logo=threedotjs)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite)
![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python)
![License](https://img.shields.io/badge/License-MIT-green)

[**中文说明**](./README.md)

---

## 📋 Table of Contents

- [Features](#-features)
- [Project Structure](#-project-structure)
- [Quick Start](#-quick-start)
- [Texture Detection Rules](#-texture-detection-rules)
- [Database Schema](#-database-schema)
- [Tech Stack](#-tech-stack)
- [Testing](#-testing)
- [Changelog](#-changelog)
- [License](#-license)

---

## ✨ Features

### 🖥️ Desktop App (Electron + React)

- **Database Management** — Open SQLite databases to manage your 3D asset catalog
- **Thumbnail Grid** — Browse all assets in a grid view with search and filtering
- **3D Model Viewer** — Built-in Three.js viewer supporting FBX / OBJ / GLTF / GLB / USD formats, with orbit controls, material channel visualization, wireframe mode, vertex normals, Matcap preview, bone weights, and HDR environment lighting
- **Search & Filter** — Filter by filename, format, missing textures, and more
- **Stats Panel** — Asset counts, format distribution, and missing texture statistics
- **Scan Overlay** — Real-time scan progress and logs
- **Folder Watching** — Monitor directories and auto-refresh on changes
- **Drag & Drop** — Drag model files or database files to open quickly

### 🐍 Python Script Toolchain

| Script | Description |
|--------|-------------|
| `scripts/scan_assets.py` | Recursively scan directories, detect 3D models and associated textures |
| `scripts/init_db.py` | Initialize SQLite database |
| `scripts/create_thumbnails.py` | Batch generate thumbnails via Blender |
| `scripts/validate_assets.py` | Validate asset integrity (missing texture detection) |
| `scripts/audit.py` | Asset audit report |
| `scripts/audit_deep.py` | Deep asset audit |
| `scripts/report.py` | Generate statistical reports |
| `scripts/check_schema.py` | Check database table structure |
| `scripts/texture_analyzer.py` | Texture file analysis |
| `scripts/ue_naming_rules.py` | Unreal Engine naming convention validation |
| `scripts/test_smoke.py` | Smoke tests |

### 🎨 Blender Scripts

| Script | Description |
|--------|-------------|
| `blender_scripts/render_thumbnail.py` | Render model thumbnails |
| `blender_scripts/convert_format.py` | Convert model formats |
| `blender_scripts/inspect_model.py` | Inspect model structure |

### 👁️ Standalone 3D Viewer

The `viewer/` directory contains a pure front-end Three.js 3D model viewer (no Electron required) that can be opened directly in a browser.

---

## 📦 Project Structure

```
AssetVault/
├── scripts/                  # Python utility scripts
│   ├── scan_assets.py        # Asset scanning
│   ├── init_db.py            # Database initialization
│   ├── create_thumbnails.py  # Thumbnail generation
│   ├── validate_assets.py    # Asset validation
│   ├── audit.py              # Audit
│   ├── audit_deep.py         # Deep audit
│   ├── report.py             # Report generation
│   ├── check_schema.py       # Schema check
│   ├── texture_analyzer.py   # Texture analysis
│   ├── ue_naming_rules.py    # UE naming rules
│   └── test_smoke.py         # Smoke tests
├── blender_scripts/          # Blender scripts
│   ├── render_thumbnail.py   # Thumbnail rendering
│   ├── convert_format.py     # Format conversion
│   └── inspect_model.py      # Model inspection
├── ui/                       # Electron desktop app
│   ├── electron/             # Electron main process
│   │   ├── main.js           # Main process entry
│   │   ├── preload.js        # Preload script
│   │   ├── watcher.js        # File watcher
│   │   ├── auto-updater.js   # Auto updater
│   │   └── workers/          # Background workers
│   │       ├── db-worker.js        # Database operations
│   │       ├── scan-queue.js       # Scan queue
│   │       ├── thumbnail-queue.js  # Thumbnail queue
│   │       └── worker-manager.js   # Worker manager
│   ├── src/                  # React frontend
│   │   ├── App.jsx           # Main app component
│   │   ├── main.jsx          # Entry point
│   │   └── components/       # UI components
│   │       ├── ThumbnailGrid.jsx    # Thumbnail grid
│   │       ├── ModelViewer3D.jsx    # 3D model viewer
│   │       ├── SidePanel.jsx        # Detail side panel
│   │       ├── SearchBar.jsx        # Search bar
│   │       ├── StatsBar.jsx         # Stats bar
│   │       ├── ScanOverlay.jsx      # Scan overlay
│   │       ├── WatchBar.jsx         # Watch bar
│   │       ├── DropZone.jsx         # Drop zone
│   │       └── ModelCard.jsx        # Model card
│   │   └── styles/           # Stylesheets
│   ├── build-resources/      # Build resources (icons, etc.)
│   ├── vite.config.js        # Vite configuration
│   ├── electron-builder.yml  # Build configuration
│   └── package.json          # Dependencies
├── viewer/                   # Standalone 3D viewer
├── UpdateLog/                # Development changelog
├── test-fixtures/            # Test fixtures
├── README.md                 # Chinese documentation
└── README.en.md              # English documentation
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+
- **Python** 3.10+
- **Blender** 4.5+ (for thumbnail generation)
- **npm** or **yarn**

### Installation & Running

```bash
# 1. Install UI dependencies
cd ui
npm install

# 2. Start development mode (Vite + Electron concurrently)
npm run dev

# 3. Or start separately
npm run dev:renderer   # Start Vite dev server only (port 5173)
npm run dev:electron   # Start Electron only (requires Vite running first)
```

### Build Installers

```bash
cd ui

# Windows installer
npm run build

# macOS installer
npm run build:mac

# Linux installer
npm run build:linux

# All platforms
npm run build:all

# Package as directory (no installer)
npm run pack

# Build and publish
npm run dist
```

### Python Script Usage

```bash
# 1. Initialize database
python scripts/init_db.py --scan-root /path/to/assets

# 2. Scan assets
python scripts/scan_assets.py --scan-root /path/to/assets

# 3. Generate thumbnails (requires Blender)
python scripts/create_thumbnails.py --scan-root /path/to/assets

# 4. Validate assets
python scripts/validate_assets.py --scan-root /path/to/assets
```

---

## 🔍 Texture Detection Rules

Scripts automatically detect texture types by filename keywords (case-insensitive):

| Map Type | Keywords |
|----------|----------|
| Albedo / Diffuse | `albedo`, `diffuse`, `diff`, `basecolor`, `base_color`, `col` |
| Normal | `normal`, `nrm`, `nml` |
| Roughness | `roughness`, `rough`, `rgh` |
| Metallic | `metallic`, `metal`, `met` |
| AO (Ambient Occlusion) | `ao`, `ambient_occlusion`, `occlusion` |
| Displacement / Height | `displacement`, `disp`, `height`, `hgt` |
| Specular | `specular`, `spec`, `spc` |
| Glossiness | `glossiness`, `gloss`, `gls` |
| Opacity / Alpha | `opacity`, `alpha`, `opac`, `alp` |
| Emission | `emission`, `emissive`, `emit`, `em`, `glow` |
| Subsurface | `sss`, `subsurface`, `subdermal` |

Textures located in the same directory as the model, or in a `textures/` subdirectory, are automatically associated with the corresponding model.

---

## 🗄️ Database Schema

The SQLite database contains three tables:

### `models` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key (auto-increment) |
| `file_path` | TEXT | Full path to the model file |
| `file_name` | TEXT | Base filename |
| `format` | TEXT | Format (fbx / obj / glb / gltf) |
| `file_size_bytes` | INTEGER | File size in bytes |
| `last_modified` | TEXT | Last modified timestamp (ISO) |
| `scan_timestamp` | TEXT | Scan timestamp |
| `variant` | TEXT | LOD/variant label |

### `textures` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key (auto-increment) |
| `model_id` | INTEGER | Foreign key → models.id |
| `file_path` | TEXT | Path to texture file |
| `map_type` | TEXT | Map type (albedo, normal, roughness, etc.) |
| `width` | INTEGER | Pixel width |
| `height` | INTEGER | Pixel height |

### `missing_textures` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key (auto-increment) |
| `model_id` | INTEGER | Foreign key → models.id |
| `missing_types` | TEXT | Comma-separated missing map types |
| `reported_at` | TEXT | First reported timestamp |
| `resolved` | INTEGER | 0 = unresolved, 1 = resolved |

---

## 📊 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Desktop Framework** | Electron 42 |
| **Frontend Framework** | React 18, Vite 6 |
| **3D Rendering** | Three.js 0.184 |
| **Model Loaders** | GLTFLoader, FBXLoader, OBJLoader, USDLoader |
| **Database** | sql.js (SQLite WebAssembly) |
| **Packaging** | electron-builder (NSIS) |
| **Auto Update** | electron-updater |
| **Scripting** | Python 3.10+ |
| **Thumbnail Rendering** | Blender 4.5+ |

---

## 🧪 Testing

The project includes a test database and smoke test script:

```bash
# Run smoke tests
python scripts/test_smoke.py

# Test database located at
ui/test-fixtures/asset_librarian.db
```

---

## 📝 Changelog

See the [UpdateLog/](./UpdateLog/) directory (in Chinese).

---

## 📄 License

This project is open-sourced under the **MIT License**.

---

## 🙏 Acknowledgements

- [Three.js](https://threejs.org/) — Powerful 3D rendering engine
- [Electron](https://www.electronjs.org/) — Cross-platform desktop framework
- [React](https://react.dev/) — UI component library
- [sql.js](https://sql.js.org/) — WASM-powered SQLite
- [Blender](https://www.blender.org/) — Open-source 3D creation suite
- [Vite](https://vitejs.dev/) — Fast frontend build tool
