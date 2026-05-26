#!/usr/bin/env python3
"""
asset-librarian: thumbnail generator for 3D model files.

Renders a front-view preview PNG for each FBX, OBJ, GLB or GLTF model
in the directory tree using trimesh (with a headless pyglet/OSMesa backend).

Usage:
    python scripts/create_thumbnails.py [--root ./assets] [--db ./asset_librarian.db] [--size 256]

Skips models that already have an up-to-date thumbnail.
"""

import argparse
import json
import os
import sqlite3
import sys
import traceback

from math import atan2, pi


try:
    import numpy as np
except ImportError:
    np = None


BLENDER_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "blender_scripts", "render_thumbnail.py")


def find_blender() -> str | None:
    """Locate the Blender executable on any platform."""
    import shutil
    blender = shutil.which("blender")
    if blender:
        return blender

    # Common install paths by OS
    candidates = []

    if sys.platform == "win32":
        # MSI / winget installs
        pf = os.environ.get("ProgramFiles", "C:\\Program Files")
        pf_x86 = os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)")
        local = os.environ.get("LOCALAPPDATA", "")
        for base in [pf, pf_x86, local]:
            for ver in ["4.5", "4.4", "4.3", "4.2", "4.1", "4.0", "3.6", "3.5", "3.4", "3.3"]:
                candidates.append(os.path.join(base, "Blender Foundation", f"Blender {ver}", "blender.exe"))
                candidates.append(os.path.join(base, f"Blender {ver}", "blender.exe"))
    elif sys.platform == "darwin":
        candidates.append("/Applications/Blender.app/Contents/MacOS/Blender")
        candidates.append(os.path.expanduser("~/Applications/Blender.app/Contents/MacOS/Blender"))
    else:
        # Linux: snap, flatpak, or compiled
        candidates.extend([
            "/snap/bin/blender",
            "/usr/bin/blender",
            "/usr/local/bin/blender",
            os.path.expanduser("~/blender/blender"),
        ])

    for path in candidates:
        if os.path.isfile(path):
            return path

    return None


def thumbnail_via_blender(model_path: str, size: int, stream_output: bool = False,
                          textures: dict[str, str] | None = None) -> str | None:
    """Render thumbnail using Blender EEVEE for a proper lit preview.

    When *stream_output* is True, prints Blender's stdout/stderr line by line
    as it runs (useful for Electron scan overlay or live terminal).
    """
    blender = find_blender()
    if not blender:
        return None
    if not os.path.isfile(BLENDER_SCRIPT):
        return None

    output = os.path.splitext(model_path)[0] + "_thumb.png"
    cmd = [
        blender, "--background", "--python", BLENDER_SCRIPT, "--",
        "--model", model_path,
        "--output", output,
        "--size", str(size),
        "--textures", json.dumps(textures or {}, ensure_ascii=False),
    ]
    import subprocess
    try:
        if stream_output:
            # Stream lines so the Electron UI shows live Blender progress
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1
            )
            last_line = None
            for line in proc.stdout:
                stripped = line.rstrip()
                if stripped:
                    print(f"   [blender] {stripped}")
                    last_line = stripped
            proc.wait()
            ok = proc.returncode == 0
        else:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            ok = result.returncode == 0
            if result.stdout:
                for line in result.stdout.splitlines():
                    if "✅" in line or "❌" in line:
                        print(f"   {line}")

        if ok and os.path.isfile(output):
            return output
        else:
            print(f"   ⚠️  Blender thumbnail failed")
            return None
    except FileNotFoundError:
        return None
    except subprocess.TimeoutExpired:
        print("   ⚠️  Blender timed out (120s)")
        return None


def thumbnail_via_trimesh(model_path: str, size: int) -> str | None:
    """Fallback thumbnail using trimesh vertex projection."""
    try:
        import trimesh
    except ImportError:
        print("   ⚠️  trimesh not installed: pip install trimesh")
        return None

    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("   ⚠️  Pillow not installed: pip install Pillow")
        return None

    try:
        scene = trimesh.load(model_path, force="scene")
    except Exception as exc:
        print(f"   ⚠️  Failed to load {model_path}: {exc}")
        return None

    if hasattr(scene, 'to_geometry'):
        mesh = scene.to_geometry()
    elif hasattr(scene, 'dump'):
        mesh = scene.dump(concatenate=True)
    else:
        mesh = scene

    if mesh is None or (hasattr(mesh, "is_empty") and mesh.is_empty):
        print(f"   ⚠️  Empty mesh: {model_path}")
        return None

    centroid = mesh.centroid
    extents = mesh.extents
    if np is not None:
        max_extent = float(np.max(extents)) if extents.size > 0 else 1.0
    else:
        max_extent = max(extents) if extents else 1.0

    distance = max_extent * 2.5

    if np is not None and hasattr(mesh, "vertices") and len(mesh.vertices) > 0:
        vertices = mesh.vertices - centroid
        proj = vertices[:, :2] / distance
        px = ((proj[:, 0] + 1.0) * 0.5 * size).astype(int)
        py = ((1.0 - (proj[:, 1] + 1.0) * 0.5) * size).astype(int)
        px = np.clip(px, 2, size - 2)
        py = np.clip(py, 2, size - 2)
    else:
        img = Image.new("RGB", (size, size), (48, 48, 48))
        draw = ImageDraw.Draw(img)
        draw.text((size // 4, size // 2 - 8), "NO GEO", fill=(200, 200, 200))
        thumb_path = os.path.splitext(model_path)[0] + "_thumb.png"
        img.save(thumb_path)
        return thumb_path

    img = Image.new("RGB", (size, size), (32, 32, 48))
    pixels = img.load()
    for x, y in zip(px, py):
        if 0 <= x < size and 0 <= y < size:
            c = pixels[x, y]
            pixels[x, y] = (min(255, c[0] + 8), min(255, c[1] + 8), min(255, c[2] + 10))

    try:
        if hasattr(mesh, "faces") and len(mesh.faces) <= 20000:
            edges = set()
            for tri in mesh.faces:
                for i in range(3):
                    e = tuple(sorted((int(tri[i]), int(tri[(i + 1) % 3]))))
                    edges.add(e)
            draw = ImageDraw.Draw(img)
            for i, j in edges:
                draw.line([(px[i], py[i]), (px[j], py[j])], fill=(180, 200, 255), width=1)
    except ImportError:
        pass

    thumb_path = os.path.splitext(model_path)[0] + "_thumb.png"
    img.save(thumb_path)
    return thumb_path


def thumbnail_for(model_path: str, size: int = 256, blender_only: bool = False,
                  stream_output: bool = False, textures: dict[str, str] | None = None) -> str | None:
    """
    Generate a thumbnail for *model_path* and return its path, or None.

    Uses Blender EEVEE when available (renders proper lit preview with
    materials and lighting). Falls back to trimesh vertex projection
    unless *blender_only* is set.
    """
    # Prefer Blender for quality
    result = thumbnail_via_blender(model_path, size, stream_output=stream_output, textures=textures)
    if result:
        return result
    if blender_only:
        return None
    # Fallback
    return thumbnail_via_trimesh(model_path, size)


def main():
    parser = argparse.ArgumentParser(description="Generate thumbnails for 3D models.")
    parser.add_argument("--root", default=os.environ.get("ASSET_ROOT", "./assets"),
                        help="Root directory to scan (default: ./assets, or $ASSET_ROOT)")
    parser.add_argument("--db", default=None,
                        help="SQLite database path (default: <root>/asset_librarian.db)")
    parser.add_argument("--size", type=int, default=int(os.environ.get("THUMB_SIZE", "256")),
                        help="Thumbnail width in pixels (default: 256)")
    parser.add_argument("--blender-only", action="store_true",
                        help="Only use Blender; fail if Blender is not found")
    parser.add_argument("--force", action="store_true",
                        help="Regenerate thumbnails even if cached")
    parser.add_argument("--stream", action="store_true",
                        help="Stream Blender output line by line (for live UI)")
    parser.add_argument("--model", default=None,
                        help="Only generate the thumbnail for this model file path")
    args = parser.parse_args()

    # Report Blender status
    blender_path = find_blender()
    if blender_path:
        print(f"🔧 Blender found: {blender_path}")
    else:
        if args.blender_only:
            print("❌ Blender not found and --blender-only was set.")
            sys.exit(1)
        print(f"   ℹ️  Blender not found — will use trimesh fallback.")
        print(f"   ℹ️  Install Blender for high-quality thumbnails: blender.org")

    root = os.path.abspath(args.root)
    db = args.db or os.environ.get("ASSET_DB") or os.path.join(root, "asset_librarian.db")

    if not os.path.isfile(db):
        print(f"❌ Database not found: {db}. Run init_db.py first.")
        sys.exit(1)

    conn = sqlite3.connect(db)
    cur = conn.cursor()
    sql = """
        SELECT m.id, m.file_path, t.map_type, t.file_path
        FROM models m
        LEFT JOIN textures t ON t.model_id = m.id
    """
    params = []
    if args.model:
        sql += " WHERE m.file_path = ?"
        params.append(os.path.normpath(os.path.abspath(args.model)))
    sql += """
        ORDER BY m.id, t.id
    """
    cur.execute(sql, params)
    rows = cur.fetchall()
    conn.close()

    if not rows:
        print(f"❌ No models in database. Run scan_assets.py first.")
        sys.exit(1)

    ok = 0
    fail = 0
    models: dict[int, dict] = {}
    for model_id, path, map_type, texture_path in rows:
        entry = models.setdefault(model_id, {"path": path, "textures": {}})
        if map_type and texture_path and map_type not in entry["textures"]:
            entry["textures"][map_type] = texture_path

    for entry in models.values():
        path = entry["path"]
        textures = entry["textures"]
        if not os.path.isfile(path):
            print(f"⚠️  File missing: {path}")
            fail += 1
            continue

        thumb_path = os.path.splitext(path)[0] + "_thumb.png"
        if not args.force and os.path.isfile(thumb_path):
            mod_time = os.path.getmtime(path)
            thumb_time = os.path.getmtime(thumb_path)
            if thumb_time >= mod_time:
                print(f"✓  Cached: {os.path.basename(thumb_path)}")
                ok += 1
                continue

        print(f"🔨 Rendering: {os.path.basename(path)}")
        try:
            result = thumbnail_for(
                path,
                size=args.size,
                blender_only=args.blender_only,
                stream_output=args.stream,
                textures=textures,
            )
            if result:
                print(f"   → {result}")
                ok += 1
            else:
                fail += 1
        except Exception:
            traceback.print_exc()
            fail += 1

    print(f"\n{'='*40}")
    print(f"Thumbnails generated: {ok}")
    print(f"Failed:               {fail}")


if __name__ == "__main__":
    main()
