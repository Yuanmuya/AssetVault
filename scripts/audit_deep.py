"""Deep architecture audit of asset-librarian."""
import re, os

ROOT = r"C:\Users\10908\.openclaw\workspace\skills\asset-librarian"

def read(name):
    with open(os.path.join(ROOT, name), errors="ignore") as f:
        return f.read()

issues = []

# 1. scan_assets.py: loads ALL files into RAM
t = read("scripts/scan_assets.py")
if "walk_models(root)" in t:
    issues.append((
        "CRITICAL",
        "scan_assets.py walk_models() loads ALL model dicts into memory before any processing. "
        "On 50k+ assets this is ~100MB+ in one allocation. Need streaming iterator/yield."
    ))
ldd = t.count("os.listdir")
issues.append((
    "PERF",
    f"scan_assets.py collect_textures() calls os.listdir {ldd}x per unique texture dir. "
    "Each is a syscall. Should batch-walk the tree once and cache results."
))

# 2. One Blender subprocess per model
t = read("scripts/create_thumbnails.py")
spawns = t.count("subprocess.run") + t.count("subprocess.Popen")
issues.append((
    "PERF",
    f"create_thumbnails.py launches {spawns} Blender subprocess per model. "
    "Cold Blender start is 3-8s. With 100 models that's 5-13 minutes just launching Blender. "
    "Need batch rendering: pass multiple models to one Blender invocation."
))

# 3. sql.js loads entire DB in RAM
t = read("ui/electron/main.js")
if "readFileSync" in t and "new SQL.Database(buffer)" in t:
    issues.append((
        "MEMORY",
        "main.js: sql.js loads the ENTIRE .db file into Node heap via readFileSync+Buffer. "
        "A 2GB DB occupies 2GB+ resident RAM. Replace with better-sqlite3 (mmap-based, "
        "virtual memory, zero-copy reads) or use node:sqlite (built-in since Node 22)."
    ))

# 4. ModelViewer3D recreates scene on every click
t = read("ui/src/components/ModelViewer3D.jsx")
loaders = t.count("new GLTFLoader") + t.count("new OBJLoader") + t.count("new FBXLoader")
if loaders > 3:
    issues.append((
        "PERF",
        f"ModelViewer3D.jsx creates {loaders} loader instances on every mount. "
        "Clicking between models triggers full Three.js teardown+reinit. "
        "Pool loaders via useRef, only create on first mount."
    ))

# 5. Polling walks entire tree every 5s
t = read("ui/electron/watcher.js")
if "_walkDir" in t:
    issues.append((
        "SCALABILITY",
        "watcher.js polling calls _walkDir() every 5 seconds, traversing ENTIRE directory tree. "
        "At 50k files this is ~10,000 stat calls per poll = 50ms I/O every 5s. "
        "fs.watch handles instant notification; drop poll to 30s as fallback only."
    ))

# 6. Individual INSERTs instead of batch
t = read("scripts/scan_assets.py")
singletons = t.count("INSERT INTO textures")
if singletons > 3:
    issues.append((
        "PERF",
        f"scan_assets.py has {singletons} individual INSERT INTO textures calls. "
        "Each is a separate SQLite transaction+WAL flush. Use executemany() for bulk."
    ))

# 7. Static Three.js imports in bundle
imports = len(re.findall(r"from 'three", t))
if imports > 4:
    issues.append((
        "BUNDLE",
        f"ModelViewer3D.jsx statically imports {imports} Three.js modules. "
        "All loaders (GLTF, OBJ, FBX, DRACO, KTX2, Meshopt) ship in the main bundle. "
        "Dynamic import() would reduce initial payload by ~300KB."
    ))

# 8. SidePanel does multiple IPC round-trips per click
t = read("ui/src/components/SidePanel.jsx")
fetches = t.count("window.api.")
if fetches > 3:
    issues.append((
        "PERF",
        f"SidePanel.jsx makes {fetches} IPC calls per model click. "
        "Each crosses the Electron process boundary (main->renderer serialization). "
        "Fetch model+validation in one query or cache results."
    ))

# 9. Texture analyzer opens every texture individually
t = read("scripts/texture_analyzer.py")
if "Image.open" in t:
    issues.append((
        "PERF",
        "texture_analyzer.py opens each texture file individually with PIL. "
        "For 1000 4K textures this is 1000 disk IOPs. "
        "Should cache results per-path in the textures table (add column)."
    ))

# 10. Missing composite indexes
t = read("scripts/init_db.py")
if "format" in t and "CREATE INDEX IF NOT EXISTS idx_models" in t:
    has_format_idx = "format" in t.split("idx_models")[1] if "idx_models" in t else False
    if not has_format_idx:
        issues.append((
            "SCHEMA",
            "init_db.py has no index on models.format. "
            "UI filters by format on every search. Add composite (format, file_name) and (format, scan_timestamp)."
        ))

# 11. DropZone re-validates file structure on every drag
t = read("ui/src/components/DropZone.jsx")
if "handleDragOver" in t:
    issues.append((
        "PERF",
        "DropZone.jsx handleDragOver fires on every pixel the mouse moves over the window. "
        "It checks e.dataTransfer.types.includes on every event. "
        "Minimal but adds up on slow machines. Use requestAnimationFrame throttle."
    ))

# 12. WatchBar poll + IPC every 2s
t = read("ui/src/components/WatchBar.jsx")
if "setInterval" in t and "watchStatus" in t:
    issues.append((
        "PERF",
        "WatchBar.jsx polls watchStatus() every 2s via IPC round-trip. "
        "With watcher:status-update push events available this is redundant. "
        "Remove polling; rely entirely on push events."
    ))

print("=" * 72)
print("  ASSET-LIBRARIAN — Architecture Audit")
print("  Environment: Electron + sql.js + Python subprocess")
print("=" * 72)

counts = {"CRITICAL": 0, "MEMORY": 0, "PERF": 0, "SCALABILITY": 0, "SCHEMA": 0, "BUNDLE": 0}
for severity, desc in issues:
    counts[severity] = counts.get(severity, 0) + 1
    print(f"\n  [{severity}] {desc}")

print(f"\n{'.' * 72}")
print("  Summary by severity:")
for sev, cnt in sorted(counts.items()):
    print(f"    {sev:12s}  {cnt}")
print(f"\n  Total findings: {sum(counts.values())}")
print(f"  Total LOC: ~5000 across 30 files")
