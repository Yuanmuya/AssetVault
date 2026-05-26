#!/usr/bin/env python3
"""
Quick smoke test for asset-librarian.

Creates a temp directory with sample files, runs the full pipeline,
and verifies output.
"""

import os
import sqlite3
import sys
import tempfile
import uuid

# Add scripts to path
SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))

SCAN_PY = os.path.join(SCRIPTS_DIR, "scan_assets.py")
INIT_PY = os.path.join(SCRIPTS_DIR, "init_db.py")


def touch(path: str, content: bytes = b""):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(content)


def test():
    tmp = os.path.join(tempfile.gettempdir(), f"asset-librarian-test-{uuid.uuid4().hex[:8]}")
    root = os.path.join(tmp, "assets")
    tex_dir = os.path.join(root, "textures")
    os.makedirs(tex_dir)

    # Create sample assets
    assets = [
        ("barrel/barrel.fbx", "a barrel model"),
        ("barrel/textures/barrel_albedo.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 100),
        ("barrel/textures/barrel_normal.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 100),
        ("barrel/textures/barrel_roughness.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 100),
        ("crate/crate.obj", "a crate model"),
        ("crate/textures/crate_albedo.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 100),
        ("crate/crate_LOD0.fbx", "LOD crate"),
        ("sword/sword.glb", "a sword model"),
        # No textures!
        ("rock/rock.obj", "a rock"),
    ]
    for path, content in assets:
        touch(os.path.join(root, path), content if isinstance(content, bytes) else content.encode())

    db_path = os.path.join(tmp, "asset_librarian.db")

    # Run init
    os.chdir(SCRIPTS_DIR)
    os.system(f'python "{INIT_PY}" --db "{db_path}"')

    # Run scan
    ret = os.system(f'python "{SCAN_PY}" --root "{root}" --db "{db_path}"')

    # Verify DB
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM models")
    model_count = cur.fetchone()[0]
    print(f"\nModels in DB: {model_count}")

    cur.execute("SELECT file_name, format FROM models ORDER BY file_name")
    for r in cur.fetchall():
        print(f"  • {r[0]} ({r[1]})")

    cur.execute("SELECT COUNT(*) FROM textures")
    tex_count = cur.fetchone()[0]
    print(f"Textures in DB: {tex_count}")

    cur.execute("""
        SELECT m.file_name, t.map_type, t.file_path
        FROM textures t
        JOIN models m ON m.id = t.model_id
        ORDER BY m.file_name, t.map_type
    """)
    for r in cur.fetchall():
        print(f"  {r[0]} → {r[1]}")

    cur.execute("""
        SELECT m.file_name, mt.missing_types
        FROM missing_textures mt
        JOIN models m ON m.id = mt.model_id
        WHERE mt.resolved = 0
    """)
    missing = cur.fetchall()
    print(f"\nModels with missing textures: {len(missing)}")
    for r in missing:
        print(f"  ❌ {r[0]} — missing: {r[1]}")
    conn.close()

    # Cleanup
    import shutil
    shutil.rmtree(tmp)
    print(f"\n✅ Test passed! {tmp} cleaned up.")


if __name__ == "__main__":
    test()
