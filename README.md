# AssetVault — 3D 资产管理系统

> 原项目名：**Asset Librarian**

跨平台的 3D 模型资产管理桌面应用，支持扫描、编目、预览和验证 FBX/OBJ/GLB/GLTF 等格式的 3D 资产，自动检测关联贴图，生成缩略图，并将元数据存储在本地 SQLite 数据库中。

![Electron](https://img.shields.io/badge/Electron-42.x-47848F?logo=electron)
![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react)
![Three.js](https://img.shields.io/badge/Three.js-0.184-000000?logo=threedotjs)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite)
![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python)
![License](https://img.shields.io/badge/License-MIT-green)

---

## ✨ 功能特性

### 🖥️ 桌面应用 (Electron + React)

- **数据库管理** — 打开/创建 SQLite 数据库，管理 3D 资产目录
- **缩略图网格** — 以网格视图浏览所有资产，支持搜索与筛选
- **3D 模型预览** — 内置 Three.js 高精度预览器，支持：
  - FBX / OBJ / GLTF / GLB / USD 格式加载
  - 轨道控制器（旋转/平移/缩放）
  - 材质通道可视化（Base Color、Normal、Roughness、Metallic、AO 等）
  - 线框模式、顶点法线可视化
  - Matcap 材质预览
  - 骨骼权重可视化
  - 工作室 HDR 环境光照
  - 自定义背景色
- **搜索与筛选** — 按文件名、格式、缺失贴图等条件快速筛选
- **统计面板** — 资产总数、格式分布、贴图缺失统计一目了然
- **扫描覆盖层** — 实时显示扫描进度与日志
- **文件夹监控** — 监控指定目录，资产变更自动刷新
- **拖拽导入** — 拖拽模型文件或数据库文件快速打开

### 🐍 Python 脚本工具链

| 脚本 | 功能 |
|------|------|
| `scripts/scan_assets.py` | 递归扫描目录，识别 3D 模型并检测关联贴图 |
| `scripts/init_db.py` | 初始化 SQLite 数据库 |
| `scripts/create_thumbnails.py` | 调用 Blender 批量生成缩略图 |
| `scripts/validate_assets.py` | 验证资产完整性（贴图缺失检测） |
| `scripts/audit.py` | 资产审计报告 |
| `scripts/audit_deep.py` | 深度资产审计（文件结构与元数据） |
| `scripts/report.py` | 生成统计报告 |
| `scripts/check_schema.py` | 检查数据库表结构 |
| `scripts/texture_analyzer.py` | 贴图文件分析 |
| `scripts/ue_naming_rules.py` | Unreal Engine 命名规范检查 |
| `scripts/test_smoke.py` | 冒烟测试 |

### 🎨 Blender 脚本

| 脚本 | 功能 |
|------|------|
| `blender_scripts/render_thumbnail.py` | 渲染模型缩略图 |
| `blender_scripts/convert_format.py` | 模型格式转换 |
| `blender_scripts/inspect_model.py` | 模型结构检查 |

### 👁️ 独立 3D 查看器

`viewer/` 目录下提供基于 Three.js 的纯前端 3D 模型查看器（无需 Electron）。

---

## 📦 项目结构

```
AssetVault/
├── scripts/                  # Python 工具脚本
│   ├── scan_assets.py        # 资产扫描
│   ├── init_db.py            # 数据库初始化
│   ├── create_thumbnails.py  # 缩略图生成
│   ├── validate_assets.py    # 资产验证
│   ├── audit.py              # 审计
│   ├── audit_deep.py         # 深度审计
│   ├── report.py             # 报告生成
│   ├── check_schema.py       # 模式检查
│   ├── texture_analyzer.py   # 贴图分析
│   ├── ue_naming_rules.py    # UE 命名规范
│   └── test_smoke.py         # 冒烟测试
├── blender_scripts/          # Blender 脚本
│   ├── render_thumbnail.py   # 缩略图渲染
│   ├── convert_format.py     # 格式转换
│   └── inspect_model.py      # 模型检查
├── ui/                       # Electron 桌面应用
│   ├── electron/             # Electron 主进程
│   │   ├── main.js           # 主进程入口
│   │   ├── preload.js        # 预加载脚本
│   │   ├── watcher.js        # 文件监控
│   │   ├── auto-updater.js   # 自动更新
│   │   └── workers/          # 后台 Worker
│   │       ├── db-worker.js        # 数据库操作
│   │       ├── scan-queue.js       # 扫描队列
│   │       ├── thumbnail-queue.js  # 缩略图队列
│   │       └── worker-manager.js   # Worker 管理器
│   ├── src/                  # React 前端
│   │   ├── App.jsx           # 主应用组件
│   │   ├── main.jsx          # 入口
│   │   ├── components/       # UI 组件
│   │   │   ├── ThumbnailGrid.jsx    # 缩略图网格
│   │   │   ├── ModelViewer3D.jsx    # 3D 模型预览
│   │   │   ├── SidePanel.jsx        # 右侧详情面板
│   │   │   ├── SearchBar.jsx        # 搜索栏
│   │   │   ├── StatsBar.jsx         # 统计栏
│   │   │   ├── ScanOverlay.jsx      # 扫描覆盖层
│   │   │   ├── WatchBar.jsx         # 监控栏
│   │   │   ├── DropZone.jsx         # 拖拽区域
│   │   │   └── ModelCard.jsx        # 模型卡片
│   │   └── styles/           # 样式文件
│   ├── build-resources/      # 构建资源（图标等）
│   ├── vite.config.js        # Vite 配置
│   ├── electron-builder.yml  # 打包配置
│   └── package.json          # 依赖管理
├── viewer/                   # 独立 3D 查看器
├── UpdateLog/                # 开发更新日志
└── test-fixtures/            # 测试资源
```

---

## 🚀 快速开始

### 前置要求

- **Node.js** 18+
- **Python** 3.10+
- **Blender** 4.5+（用于缩略图生成）
- **npm** 或 **yarn**

### 安装与运行

```bash
# 1. 安装 UI 依赖
cd ui
npm install

# 2. 开发模式启动（Vite + Electron 同时启动）
npm run dev

# 3. 或者分别启动
npm run dev:renderer   # 仅启动 Vite 前端
npm run dev:electron   # 仅启动 Electron（需先启动 Vite）
```

### 构建安装包

```bash
cd ui

# Windows
npm run build

# macOS
npm run build:mac

# Linux
npm run build:linux

# 全平台
npm run build:all
```

### Python 脚本使用

```bash
# 1. 初始化数据库
python scripts/init_db.py --scan-root /path/to/assets

# 2. 扫描资产
python scripts/scan_assets.py --scan-root /path/to/assets

# 3. 生成缩略图（需安装 Blender）
python scripts/create_thumbnails.py --scan-root /path/to/assets

# 4. 验证资产
python scripts/validate_assets.py --scan-root /path/to/assets
```

---

## 🔍 贴图检测规则

脚本根据文件名关键词自动识别贴图类型（不区分大小写）：

| 贴图类型 | 关键词 |
|---------|--------|
| Albedo / Diffuse | `albedo`, `diffuse`, `diff`, `basecolor`, `base_color`, `col` |
| Normal | `normal`, `nrm`, `nml` |
| Roughness | `roughness`, `rough`, `rgh` |
| Metallic | `metallic`, `metal`, `met` |
| AO | `ao`, `ambient_occlusion`, `occlusion` |
| Displacement / Height | `displacement`, `disp`, `height`, `hgt` |
| Specular | `specular`, `spec`, `spc` |
| Glossiness | `glossiness`, `gloss`, `gls` |
| Opacity / Alpha | `opacity`, `alpha`, `opac`, `alp` |
| Emission | `emission`, `emissive`, `emit`, `em`, `glow` |
| Subsurface | `sss`, `subsurface`, `subdermal` |

贴图位于模型同级目录或 `textures/` 子目录中时自动匹配。

---

## 🗄️ 数据库 Schema

SQLite 数据库包含以下表：

### `models` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 主键（自增） |
| `file_path` | TEXT | 模型文件完整路径 |
| `file_name` | TEXT | 文件名 |
| `format` | TEXT | 格式（fbx / obj / glb / gltf） |
| `file_size_bytes` | INTEGER | 文件大小 |
| `last_modified` | TEXT | 最后修改时间 |
| `scan_timestamp` | TEXT | 扫描时间戳 |
| `variant` | TEXT | LOD/变体标签 |

### `textures` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 主键（自增） |
| `model_id` | INTEGER | 外键 → models.id |
| `file_path` | TEXT | 贴图文件路径 |
| `map_type` | TEXT | 贴图类型 |
| `width` | INTEGER | 像素宽度 |
| `height` | INTEGER | 像素高度 |

### `missing_textures` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 主键（自增） |
| `model_id` | INTEGER | 外键 → models.id |
| `missing_types` | TEXT | 缺失的贴图类型（逗号分隔） |
| `reported_at` | TEXT | 首次报告时间 |
| `resolved` | INTEGER | 0=未解决, 1=已解决 |

---

## 📊 技术栈

| 层级 | 技术 |
|------|------|
| **桌面框架** | Electron 42 |
| **前端** | React 18, Vite 6 |
| **3D 渲染** | Three.js 0.184 (GLTFLoader, FBXLoader, OBJLoader, USDLoader) |
| **数据库** | sql.js (SQLite WebAssembly) |
| **打包** | electron-builder (NSIS) |
| **自动更新** | electron-updater |
| **脚本** | Python 3.10+, Blender 4.5+ |

---

## 🧪 测试

```bash
# 运行冒烟测试
python scripts/test_smoke.py

# 使用测试数据库
ui/test-fixtures/asset_librarian.db
```

---

## 📝 更新日志

详见 [UpdateLog/](UpdateLog/) 目录。

---

## 📄 许可证

本项目基于 MIT 许可证开源。

---

## 🙏 致谢

- [Three.js](https://threejs.org/) — 强大的 3D 渲染引擎
- [Electron](https://www.electronjs.org/) — 跨平台桌面应用框架
- [React](https://react.dev/) — UI 组件库
- [sql.js](https://sql.js.org/) — WASM 驱动的 SQLite
- [Blender](https://www.blender.org/) — 开源 3D 创作套件
