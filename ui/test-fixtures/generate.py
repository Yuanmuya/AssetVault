#!/usr/bin/env python3
"""Generate sample asset_librarian.db with fake model records for UI testing."""

import sqlite3, os
from PIL import Image, ImageDraw
import math

OUT_DIR = r"C:\Users\10908\.openclaw\workspace\skills\asset-librarian\ui\test-fixtures"
os.makedirs(OUT_DIR, exist_ok=True)

DB_PATH = os.path.join(OUT_DIR, "asset_librarian.db")
BASE = os.path.join(OUT_DIR, "assets")
TEX_DIR = os.path.join(BASE, "textures")
os.makedirs(TEX_DIR, exist_ok=True)

# ── Schema ──
conn = sqlite3.connect(DB_PATH)
conn.executescript("""
CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    format TEXT NOT NULL,
    file_size_bytes INTEGER,
    last_modified TEXT,
    scan_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    variant TEXT DEFAULT NULL
);
CREATE TABLE IF NOT EXISTS textures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    map_type TEXT NOT NULL,
    width INTEGER DEFAULT NULL,
    height INTEGER DEFAULT NULL,
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS missing_textures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id INTEGER NOT NULL,
    missing_types TEXT NOT NULL,
    reported_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS asset_validation (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id        INTEGER NOT NULL UNIQUE,
    ue_prefix       TEXT,
    ue_category     TEXT,
    ue_status       TEXT DEFAULT 'unknown',
    ue_issues       TEXT,
    validated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_validation_model ON asset_validation(model_id);

CREATE INDEX IF NOT EXISTS idx_models_path    ON models(file_path);
CREATE INDEX IF NOT EXISTS idx_textures_model ON textures(model_id);
CREATE INDEX IF NOT EXISTS idx_missing_model  ON missing_textures(model_id);
""")

# ── 5 Models ──
models = [
    (1, os.path.join(BASE, "steampack.fbx"),       "steampack.fbx",    "fbx",  3_145_728,  "2026-05-22T14:30:00", None),
    (2, os.path.join(BASE, "steampack_LOD0.fbx"),   "steampack_LOD0.fbx","fbx", 1_048_576, "2026-05-22T14:30:00", "LOD0"),
    (3, os.path.join(BASE, "ancient_vase.obj"),     "ancient_vase.obj", "obj",  768_000,   "2026-05-20T09:15:00", None),
    (4, os.path.join(BASE, "cyber_blade.glb"),      "cyber_blade.glb",  "glb",  2_097_152, "2026-05-23T08:00:00", None),
    (5, os.path.join(BASE, "ruins_tower.gltf"),     "ruins_tower.gltf", "gltf", 4_194_304, "2026-05-19T16:45:00", None),
]
for m in models:
    conn.execute(
        "INSERT OR REPLACE INTO models (id,file_path,file_name,format,file_size_bytes,last_modified,variant) VALUES (?,?,?,?,?,?,?)", m
    )

# ── Textures ──
textures = [
    (1, os.path.join(TEX_DIR, "steampack_albedo.png"),    "albedo",    2048, 2048),
    (1, os.path.join(TEX_DIR, "steampack_normal.png"),    "normal",    2048, 2048),
    (1, os.path.join(TEX_DIR, "steampack_roughness.png"), "roughness", 2048, 2048),
    (1, os.path.join(TEX_DIR, "steampack_metallic.png"),  "metallic",  2048, 2048),
    (1, os.path.join(TEX_DIR, "steampack_ao.png"),        "ao",        2048, 2048),
    (2, os.path.join(TEX_DIR, "steampack_albedo.png"),    "albedo",    2048, 2048),
    (2, os.path.join(TEX_DIR, "steampack_normal.png"),    "normal",    2048, 2048),
    (2, os.path.join(TEX_DIR, "steampack_roughness.png"), "roughness", 2048, 2048),
    (3, os.path.join(TEX_DIR, "vase_albedo.png"),         "albedo",    1024, 1024),
    (3, os.path.join(TEX_DIR, "vase_normal.png"),         "normal",    1024, 1024),
    (4, os.path.join(TEX_DIR, "blade_albedo.png"),        "albedo",    4096, 4096),
    (4, os.path.join(TEX_DIR, "blade_roughness.png"),     "roughness", 4096, 4096),
    (4, os.path.join(TEX_DIR, "blade_emission.png"),      "emission",  4096, 4096),
]
conn.executemany("INSERT INTO textures (model_id,file_path,map_type,width,height) VALUES (?,?,?,?,?)", textures)

# ── Missing-texture records ──
missing = [
    (2, "ao,metallic"),
    (3, "roughness"),
    (4, "ao,metallic,normal"),
    (5, "albedo,ao,displacement,emission,metallic,normal,roughness,subsurface"),
]
for mid, types in missing:
    conn.execute("INSERT INTO missing_textures (model_id,missing_types,resolved) VALUES (?,?,0)", (mid, types))

conn.commit()
conn.close()
print(f"✅ Database: {DB_PATH}  ({os.path.getsize(DB_PATH)} bytes)")

# ── Generate thumbnails (coloured circles with names) ──
def make_thumb(name, hue, path):
    img = Image.new("RGB", (256, 256), (18, 18, 32))
    draw = ImageDraw.Draw(img)
    for r in range(120, 0, -1):
        luma = 30 + 30 * math.sin(r * 0.08)
        sat = 200 - 8 * r
        color = (
            min(255, int(128 + sat * math.sin(hue + r * 0.05))),
            min(255, int(128 + sat * math.sin(hue + 2.1 + r * 0.05))),
            min(255, int(128 + sat * math.sin(hue + 4.2 + r * 0.05))),
        )
        draw.ellipse([128 - r, 128 - r, 128 + r, 128 + r], outline=color, width=1)
    draw.text((90, 108), "📦", fill=(220, 220, 240))
    draw.text((8, 230), name[:16], fill=(140, 150, 180))
    img.save(path, "PNG")
    print(f"   🖼️  {path}")

for name, hue in [("steampack", 0.0), ("steampack_LOD0", 0.3), ("ancient_vase", 2.1), ("cyber_blade", 4.5), ("ruins_tower", 3.2)]:
    make_thumb(name, hue, os.path.join(BASE, f"{name}_thumb.png"))

# ── Generate tiny texture dummy files ──
tex_names = [
    "steampack_albedo.png", "steampack_normal.png", "steampack_roughness.png",
    "steampack_metallic.png", "steampack_ao.png",
    "vase_albedo.png", "vase_normal.png",
    "blade_albedo.png", "blade_roughness.png", "blade_emission.png",
]
for tn in tex_names:
    img = Image.new("RGB", (8, 8), (64, 64, 80))
    img.save(os.path.join(TEX_DIR, tn), "PNG")

print(f"\n✅ Done. {len(models)} models, {len(textures)} texture entries, {len(missing)} missing-texture records.")
