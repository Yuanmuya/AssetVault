#!/usr/bin/env python3
"""Compare schemas between test-fixtures and init_db.py."""
import sqlite3, subprocess, tempfile, os

TEST_DB = r"C:\Users\10908\.openclaw\workspace\skills\asset-librarian\ui\test-fixtures\asset_librarian.db"
INIT_PY = r"C:\Users\10908\.openclaw\workspace\skills\asset-librarian\scripts\init_db.py"

def get_schema(path, label):
    conn = sqlite3.connect(path)
    rows = conn.execute("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name").fetchall()
    conn.close()
    print(f"=== {label} ===")
    for r in rows:
        print(r[2] if r[2] else f"{r[0]} {r[1]}")
    print()

get_schema(TEST_DB, "TEST FIXTURES")

tmpdb = os.path.join(tempfile.gettempdir(), "al_schema_check2.db")
if os.path.exists(tmpdb):
    os.remove(tmpdb)
subprocess.run(["python", INIT_PY, "--db", tmpdb], capture_output=True)
get_schema(tmpdb, "SCANNER (init_db.py)")
os.remove(tmpdb)

print("✅ Done — compare the two schemas above.")
print("Tables should match: models, textures, missing_textures + 3 indexes each.")
