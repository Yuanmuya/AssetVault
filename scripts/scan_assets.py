#!/usr/bin/env python3
"""
asset-librarian: stream-scan 3D model files and textures.

Streaming version uses generators to yield one model at a time,
writing each to SQLite incrementally. Never holds all model records
in memory simultaneously.

Usage:
    python scripts/scan_assets.py [--root ./assets] [--db ./asset_librarian.db]

Exit code: 0 if all models have complete texture sets, 1 otherwise.
"""

import argparse
import os
import re
import sqlite3
import sys
import time
from datetime import datetime
from collections import defaultdict

from texture_analyzer import analyze as analyze_texture
from create_thumbnails import find_blender as _find_blender


MODEL_EXTS = frozenset({".fbx", ".obj", ".glb", ".gltf", ".usdz"})
TEXTURE_EXTS = frozenset({".png", ".jpg", ".jpeg", ".tga", ".tif", ".tiff",
                          ".dds", ".exr", ".hdr", ".bmp"})
TEXTURE_DIR_NAMES = frozenset({"texture", "textures", "tex", "maps", "materials", "material"})

# Texture filename patterns (ordered by priority)
MAP_PATTERNS = (
    ("ao",             r"(ao|ambient_occlusion|occlusion)"),
    ("albedo",         r"(albedo|diffuse|diff|basecolor|base_color|col)"),
    ("normal",         r"(normal|nrm|nml)"),
    ("roughness",      r"(roughness|rough|rgh)"),
    ("metallic",       r"(metallic|metal|met)"),
    ("displacement",   r"(displacement|disp|height|hgt|heightmap)"),
    ("specular",       r"(specular|spec|spc)"),
    ("glossiness",     r"(glossiness|gloss|gls)"),
    ("opacity",        r"(opacity|alpha|opac|alp)"),
    ("emission",       r"(emission|emissive|emit|em|glow)"),
    ("subsurface",     r"(sss|subsurface|subdermal)"),
)
MAP_RX = {name: re.compile(p, re.IGNORECASE) for name, p in MAP_PATTERNS}

# Pixel classifier → map_type vocabulary
PIXEL_TYPE_MAP = {
    "albedo": "albedo",
    "normal": "normal",
    "orm": "orm",
    "metallic_or_mask": "metallic",
    "mid_grayscale": "roughness",
    "light_grayscale": "specular",
    "dark_grayscale": "metallic",
    "emission": "emission",
    "uniform_grey": "roughness",
    "uniform_color": "albedo",
    "alpha_mask": "opacity",
    "black": "ao",
    "white": "ao",
}

VARIANT_RE = re.compile(r"_(LOD\d+|High|Low|Med|HQ|LQ|Dense|Proxy|Impostor)$", re.IGNORECASE)
VARIANT_STRIP_RE = re.compile(r"_(?:LOD\d+|High|Low|Med|HQ|LQ|Dense|Proxy|Impostor)$", re.IGNORECASE)
TEXTURE_EXTS_TUPLE = tuple(TEXTURE_EXTS)


# ── Helpers ──

def detect_map_type(filename: str) -> str | None:
    stem = os.path.splitext(os.path.basename(filename))[0]
    for map_name, rx in MAP_RX.items():
        if rx.search(stem):
            return map_name
    return None


def infer_variant(stem: str) -> str | None:
    m = VARIANT_RE.search(stem)
    return m.group(1) if m else None


def get_base_name(stem: str) -> str:
    return VARIANT_STRIP_RE.sub("", stem)


def normalize_key(value: str) -> str:
    stem = os.path.splitext(os.path.basename(value))[0].lower()
    stem = VARIANT_STRIP_RE.sub("", stem)
    for map_name, rx in MAP_RX.items():
      stem = rx.sub("", stem)
    stem = re.sub(r"(^|_)(d|n|r|m|orm|ao|h|e|a)($|_)", "_", stem)
    return re.sub(r"[^a-z0-9]+", "", stem)


def texture_matches_model(tex_path: str, model: dict, model_dir: str) -> bool:
    tex_key = normalize_key(tex_path)
    model_key = normalize_key(model["stem"])
    folder_key = normalize_key(os.path.basename(model_dir))
    if not tex_key:
        return False
    return (
        bool(model_key and (model_key in tex_key or tex_key in model_key)) or
        bool(folder_key and (folder_key in tex_key or tex_key in folder_key))
    )


def is_relative_to(path_value: str, parent: str) -> bool:
    try:
        os.path.relpath(path_value, parent)
        return os.path.commonpath([os.path.abspath(path_value), os.path.abspath(parent)]) == os.path.abspath(parent)
    except ValueError:
        return False


def get_image_size(path: str) -> tuple[int | None, int | None]:
    try:
        from PIL import Image
        with Image.open(path) as img:
            return img.size
    except Exception:
        return None, None


# ── Directory-level scanner (streaming) ──

def scan_directory(dirpath: str, dirnames: list[str], filenames: list[str],
                   tex_cache: dict[str, dict[str, list[str]]],
                   root_texture_index: dict[str, list[str]]):
    """
    Process a single directory from os.walk.
    Yields processed model groups one at a time.

    tex_cache is updated per-directory so repeated lookups for
    LOD variants in the same dir hit the cache instead of syscalls.
    """
    # --- Collect models in this directory ---
    models_in_dir = []
    for fn in filenames:
        ext = os.path.splitext(fn)[1].lower()
        if ext not in MODEL_EXTS:
            continue
        full = os.path.join(dirpath, fn)
        try:
            stat = os.stat(full)
        except OSError:
            continue
        stem = os.path.splitext(fn)[0]
        models_in_dir.append({
            "file_path": os.path.normpath(full),
            "file_name": fn,
            "format": ext.lstrip("."),
            "file_size_bytes": stat.st_size,
            "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "variant": infer_variant(stem),
            "stem": stem,
        })

    if not models_in_dir:
        return  # nothing to do for this directory

    # --- Collect textures for this directory and nested texture folders (cache) ---
    tex_cache[dirpath] = collect_textures_for_dir(dirpath, recursive=True)

    # --- Group models by base name for texture sharing ---
    groups: dict[str, list[dict]] = defaultdict(list)
    for m in models_in_dir:
        base = get_base_name(m["stem"])
        groups[base].append(m)

    # --- Process each group ---
    for base_key, group in groups.items():
        for model in group:
            shared_textures = collect_textures_for_model(model, dirpath, tex_cache[dirpath], root_texture_index)
            yield model, shared_textures


def add_texture(grouped: dict[str, list[str]], file_path: str):
    mt = detect_map_type(file_path)
    if mt:
        grouped[mt].append(os.path.normpath(file_path))


def collect_textures_for_dir(dirpath: str, recursive: bool = False) -> dict[str, list[str]]:
    """List texture files in a directory and group by map type."""
    grouped: dict[str, list[str]] = defaultdict(list)

    def collect_from(folder: str):
        try:
            with os.scandir(folder) as it:
                for entry in it:
                    if entry.is_file() and entry.name.lower().endswith(TEXTURE_EXTS_TUPLE):
                        add_texture(grouped, entry.path)
        except PermissionError:
            pass

    try:
        with os.scandir(dirpath) as it:
            for entry in it:
                if entry.is_file() and entry.name.lower().endswith(TEXTURE_EXTS_TUPLE):
                    add_texture(grouped, entry.path)
    except PermissionError:
        pass

    for tex_name in TEXTURE_DIR_NAMES:
        tex_sub = os.path.join(dirpath, tex_name)
        if os.path.isdir(tex_sub):
            if recursive:
                for subdir, _, _ in os.walk(tex_sub):
                    collect_from(subdir)
            else:
                collect_from(tex_sub)

    return dict(grouped)


def collect_all_textures(root: str) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = defaultdict(list)
    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            if fn.lower().endswith(TEXTURE_EXTS_TUPLE):
                add_texture(grouped, os.path.join(dirpath, fn))
    return dict(grouped)


def collect_textures_for_model(model: dict, model_dir: str,
                               local_textures: dict[str, list[str]],
                               root_texture_index: dict[str, list[str]]) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = defaultdict(list)
    seen: set[str] = set()

    def add_candidate(map_type: str, tex_path: str):
        norm = os.path.normpath(tex_path)
        if norm in seen:
            return
        seen.add(norm)
        grouped[map_type].append(norm)

    for map_type, tex_paths in local_textures.items():
        for tex_path in tex_paths:
            add_candidate(map_type, tex_path)

    for map_type, tex_paths in root_texture_index.items():
        if map_type in grouped:
            continue
        for tex_path in tex_paths:
            if is_relative_to(tex_path, model_dir):
                add_candidate(map_type, tex_path)
            elif texture_matches_model(tex_path, model, model_dir):
                add_candidate(map_type, tex_path)

    return dict(grouped)


# ── SQLite batch writer ──

class BatchWriter:
    """Buffers INSERTs and flushes with executemany for throughput."""

    def __init__(self, conn, batch_size=500):
        self.conn = conn
        self.cur = conn.cursor()
        self.batch_size = batch_size
        self.texture_buf: list[tuple] = []  # (model_id, file_path, map_type, w, h)
        self.thumb_buf: list[tuple] = []
        self.texture_count = 0
        self.model_count = 0

    def insert_model(self, model):
        self.cur.execute(
            """INSERT INTO models
               (file_path, file_name, format, file_size_bytes, last_modified, scan_timestamp, variant)
               VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
               ON CONFLICT(file_path) DO UPDATE SET
                   file_name=excluded.file_name,
                   format=excluded.format,
                   file_size_bytes=excluded.file_size_bytes,
                   last_modified=excluded.last_modified,
                   scan_timestamp=excluded.scan_timestamp,
                   variant=excluded.variant""",
            (model["file_path"], model["file_name"], model["format"],
             model["file_size_bytes"], model["last_modified"],
             model["variant"]),
        )
        self.model_count += 1
        row = self.cur.execute(
            "SELECT id FROM models WHERE file_path = ?",
            (model["file_path"],),
        ).fetchone()
        return row[0]

    def queue_texture(self, model_id, file_path, map_type, w, h):
        self.texture_buf.append((model_id, file_path, map_type, w, h))
        self.texture_count += 1
        if len(self.texture_buf) >= self.batch_size:
            self.flush_textures()

    def flush_textures(self):
        if not self.texture_buf:
            return
        self.cur.executemany(
            "INSERT INTO textures (model_id, file_path, map_type, width, height) VALUES (?, ?, ?, ?, ?)",
            self.texture_buf,
        )
        self.texture_buf.clear()

    def commit(self):
        self.flush_textures()
        self.conn.commit()


# ── Pixel-level texture analysis ──

def analyze_texture_file(tex_path: str, filename_map_type: str) -> str:
    """Run pixel analysis; return (actual_type, mismatch_info)."""
    if not analyze_texture:
        return filename_map_type
    try:
        analysis = analyze_texture(tex_path)
        if not analysis:
            return filename_map_type
    except Exception:
        return filename_map_type

    cls = analysis["classification"]
    px_type = cls["type"]
    px_conf = cls["confidence"]
    pixel_type = PIXEL_TYPE_MAP.get(px_type)

    if pixel_type and px_conf in ("high", "medium") and filename_map_type == "unknown":
        print(f"   🔬 Pixel-detected: {os.path.basename(tex_path)} -> {pixel_type} ({px_type})")
        return pixel_type

    if pixel_type and px_conf == "high" and pixel_type != filename_map_type and filename_map_type != "unknown":
        print(f"   ⚠️  Name/pixel mismatch: {os.path.basename(tex_path)}")
        print(f"       Named: {filename_map_type}, pixels suggest: {pixel_type} ({cls['description']})")

    return filename_map_type


# ── Main scan (generator pipeline) ──

def write_model_record(writer: BatchWriter, model: dict, shared_textures: dict[str, list[str]]) -> tuple[int, set[str]]:
    model_id = writer.insert_model(model)
    writer.flush_textures()
    writer.cur.execute("DELETE FROM textures WHERE model_id = ?", (model_id,))

    found_types = set()
    for map_type, tex_paths in shared_textures.items():
        for tex_path in tex_paths:
            w, h = get_image_size(tex_path)
            actual = analyze_texture_file(tex_path, map_type)
            writer.queue_texture(model_id, tex_path, actual, w, h)
        found_types.add(map_type)

    expected = {"albedo", "normal", "roughness"}
    missing = expected - found_types
    writer.cur.execute("DELETE FROM missing_textures WHERE model_id = ? AND resolved = 0", (model_id,))
    if missing:
        writer.cur.execute(
            "INSERT INTO missing_textures (model_id, missing_types, resolved) VALUES (?, ?, 0)",
            (model_id, ",".join(sorted(missing))),
        )

    return model_id, missing


def model_from_file(file_path: str) -> dict:
    stat = os.stat(file_path)
    fn = os.path.basename(file_path)
    stem = os.path.splitext(fn)[0]
    ext = os.path.splitext(fn)[1].lower()
    return {
        "file_path": os.path.normpath(file_path),
        "file_name": fn,
        "format": ext.lstrip("."),
        "file_size_bytes": stat.st_size,
        "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        "variant": infer_variant(stem),
        "stem": stem,
    }


def scan_single_file(file_path: str, db_path: str) -> int:
    file_path = os.path.abspath(file_path)
    db_path = os.path.abspath(db_path)
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in MODEL_EXTS:
        print(f"❌ Unsupported model file: {file_path}")
        return 1

    root = os.path.dirname(file_path)
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    writer = BatchWriter(conn)

    model = model_from_file(file_path)
    local_textures = collect_textures_for_dir(root, recursive=True)
    root_texture_index = collect_all_textures(root)
    shared_textures = collect_textures_for_model(model, root, local_textures, root_texture_index)
    model_id, missing = write_model_record(writer, model, shared_textures)
    writer.commit()
    conn.close()

    if missing:
        print(f"⚠️  Missing textures [{','.join(sorted(missing))}]  {model['file_name']}")
    print(f"Scan complete: {file_path}")
    print(f"Total models:      1")
    print(f"Database:          {db_path}")
    return 0 if not missing else 1


def scan(root: str, db_path: str) -> int:
    root = os.path.abspath(root)
    db_path = os.path.abspath(db_path)
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)

    blender_path = _find_blender()
    if blender_path:
        print(f"🔧 Blender found at: {blender_path}")
        print(f"   ℹ️  Thumbnails rendered separately via create_thumbnails.py")

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA synchronous = OFF")      # faster bulk inserts
    conn.execute("PRAGMA journal_mode = MEMORY")  # reduce WAL overhead
    writer = BatchWriter(conn)

    tex_cache: dict[str, dict] = {}
    format_counts: defaultdict[str, int] = defaultdict(int)
    missing_count = 0
    complete_count = 0
    all_texture_paths: set[str] = set()
    models_seen = 0
    start_time = time.time()
    root_texture_index = collect_all_textures(root)

    # ── Walk tree, yield one model at a time ──
    for dirpath, dirnames, filenames in os.walk(root):
        for model, shared_textures in scan_directory(dirpath, dirnames, filenames, tex_cache, root_texture_index):
            fmt = model["format"]
            format_counts[fmt] += 1
            models_seen += 1

            model_id, missing = write_model_record(writer, model, shared_textures)
            for tex_paths in shared_textures.values():
                all_texture_paths.update(tex_paths)

            if missing:
                missing_count += 1
                print(f"⚠️  Missing textures [{','.join(sorted(missing))}]  {model['file_name']}")
            else:
                complete_count += 1

            # Periodic progress
            if models_seen % 500 == 0:
                elapsed = time.time() - start_time
                print(f"   📊 {models_seen} models processed ({models_seen/elapsed:.0f}/s)")

            # Yield for external consumers (e.g. progress bar in UI)
            yield model_id, model, missing

    # ── Finalize ──
    writer.commit()
    elapsed = time.time() - start_time
    conn.execute("PRAGMA synchronous = FULL")
    conn.execute("PRAGMA journal_mode = DELETE")
    conn.close()

    print(f"\n{'='*60}")
    print(f"Scan complete: {root}")
    print(f"{'='*60}")
    print(f"Formats:           {', '.join(f'{k}={v}' for k, v in sorted(format_counts.items()))}")
    print(f"Total models:      {models_seen}")
    print(f"Complete sets:     {complete_count}")
    print(f"Missing textures:  {missing_count}")
    print(f"Textures indexed:  {len(all_texture_paths)}")
    print(f"Elapsed:           {elapsed:.1f}s ({models_seen/max(elapsed,0.1):.0f} models/s)")
    print(f"Database:          {db_path}")

    return 0 if missing_count == 0 else 1


# ── CLI entry point ──

def main():
    parser = argparse.ArgumentParser(description="Stream-scan folders for 3D assets.")
    parser.add_argument("--root", default=os.environ.get("ASSET_ROOT", "./assets"),
                        help="Root directory (default: ./assets)")
    parser.add_argument("--db", default=None,
                        help="Database path (default: <root>/asset_librarian.db)")
    parser.add_argument("--file", default=None,
                        help="Scan only one model file instead of a whole folder")
    args = parser.parse_args()

    db = args.db or os.environ.get("ASSET_DB") or os.path.join(
        os.path.abspath(args.root), "asset_librarian.db"
    )

    if args.file:
        sys.exit(scan_single_file(args.file, db))

    for _ in scan(args.root, db):
        pass


if __name__ == "__main__":
    main()
