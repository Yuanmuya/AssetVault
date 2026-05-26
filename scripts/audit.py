"""Audit the asset-librarian codebase for bottlenecks."""
import re, os

ROOT = r"C:\Users\10908\.openclaw\workspace\skills\asset-librarian"

FILES = [
    ("scripts/scan_assets.py", "python"),
    ("scripts/create_thumbnails.py", "python"),
    ("scripts/validate_assets.py", "python"),
    ("scripts/texture_analyzer.py", "python"),
    ("scripts/ue_naming_rules.py", "python"),
    ("scripts/init_db.py", "python"),
    ("ui/electron/main.js", "js"),
    ("ui/electron/watcher.js", "js"),
    ("ui/electron/preload.js", "js"),
    ("ui/src/App.jsx", "jsx"),
    ("ui/src/components/DropZone.jsx", "jsx"),
    ("ui/src/components/ModelViewer3D.jsx", "jsx"),
    ("ui/src/components/SidePanel.jsx", "jsx"),
    ("ui/src/components/WatchBar.jsx", "jsx"),
    ("blender_scripts/render_thumbnail.py", "python"),
    ("blender_scripts/inspect_model.py", "python"),
]

def audit_python(text, name):
    issues = []
    lines = text.count("\n")

    # Sync I/O that blocks
    sync_stat = len(re.findall(r"\bos\.stat\b", text))
    sync_walk = len(re.findall(r"\bos\.walk\b", text))
    sync_listdir = len(re.findall(r"\bos\.listdir\b", text))
    sync_read = len(re.findall(r"open\(|\.read\(\)", text)) - sync_listdir - sync_walk
    if sync_stat > 10: issues.append(f"os.stat hot ({sync_stat})")
    if sync_walk > 3: issues.append(f"os.walk churn ({sync_walk})")
    if sync_listdir > 5: issues.append(f"os.listdir per-model ({sync_listdir})")

    # Subprocess per-item (Blender per-file)
    subprocesses = len(re.findall(r"subprocess\.run|subprocess\.Popen", text))
    if subprocesses > 2: issues.append(f"subprocess per-call ({subprocesses})")

    # Image loading without size limits
    pil_open = len(re.findall(r"Image\.open", text))
    if pil_open > 1: issues.append(f"Image.open unbatched ({pil_open})")

    # Thread-unsafe SQLite
    if name == "scan_assets.py":
        tx_span = re.findall(r"conn\.commit", text)
        if len(tx_span) <= 1: issues.append("single tx for entire scan (memory spike)")

    # Missing pagination / LIMIT in queries
    selects = len(re.findall(r"SELECT", text, re.I))
    limits = len(re.findall(r"LIMIT", text, re.I))
    if selects > limits and limits == 0:
        issues.append(f"no LIMIT ({selects} SELECTs)")

    return issues

def audit_js(text, name):
    issues = []
    # Sync fs calls in main process
    sync = len(re.findall(r"readFileSync|writeFileSync|readdirSync|statSync|existsSync", text))
    if sync > 10: issues.append(f"sync fs calls: {sync}")

    # Unbounded SQL queries
    no_where = len(re.findall(r"SELECT.*FROM\s+\w+", text))
    if no_where > 0: issues.append(f"potentially unbounded queries: {no_where}")

    # String building in hot paths
    pushes = len(re.findall(r"lines\.push|\.append\(", text))
    if pushes > 30: issues.append(f"hot-path array grows: {pushes}")

    return issues


print("=" * 72)
print("  ASSET-LIBRARIAN — Architecture Audit")
print("=" * 72)

all_issues = []
for relpath, lang in FILES:
    full = os.path.join(ROOT, relpath)
    if not os.path.isfile(full):
        continue
    with open(full, errors="ignore") as f:
        text = f.read()
    
    if lang in ("python",):
        issues = audit_python(text, relpath)
    else:
        issues = audit_js(text, relpath)
    
    if issues:
        print(f"\n  ❌ {relpath}:")
        for iss in issues:
            print(f"       • {iss}")
        all_issues.extend(issues)
    else:
        print(f"\n  ✓ {relpath}")

print(f"\n{'='*72}")
print(f"  Total issues: {len(all_issues)}")
print(f"{'='*72}")
