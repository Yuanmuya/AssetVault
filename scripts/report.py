#!/usr/bin/env python3
"""
asset-librarian: query and report from the SQLite database.

Usage:
    python scripts/report.py --db ./asset_librarian.db
    python scripts/report.py --db ./asset_librarian.db --missing-only
    python scripts/report.py --db ./asset_librarian.db --export-json
"""

import argparse
import json
import os
import sqlite3
import sys


def report(db_path: str, missing_only: bool = False, export_json: bool = False):
    if not os.path.isfile(db_path):
        print(f"❌ Database not found: {db_path}")
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Models summary
    cur.execute("""
        SELECT format, COUNT(*) AS cnt FROM models GROUP BY format ORDER BY format
    """)
    fmt_rows = cur.fetchall()
    total = sum(r["cnt"] for r in fmt_rows)

    cur.execute("SELECT COUNT(*) FROM missing_textures WHERE resolved = 0")
    unresolved = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM textures")
    tex_count = cur.fetchone()[0]

    if export_json:
        cur.execute("SELECT * FROM models ORDER BY file_path")
        models = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT * FROM textures ORDER BY model_id, map_type")
        textures = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT * FROM missing_textures WHERE resolved = 0 ORDER BY model_id")
        missing = [dict(r) for r in cur.fetchall()]
        payload = {
            "summary": {
                "total_models": total,
                "by_format": {r["format"]: r["cnt"] for r in fmt_rows},
                "textures_indexed": tex_count,
                "unresolved_missing": unresolved,
            },
            "models": models,
            "textures": textures,
            "missing": missing,
        }
        print(json.dumps(payload, indent=2, default=str))
        conn.close()
        return

    print(f"{'='*60}")
    print(f"Asset Librarian Report")
    print(f"{'='*60}")
    print(f"Database:   {db_path}")
    print(f"Total models: {total}")
    for r in fmt_rows:
        print(f"  {r['format'].upper():6s}  {r['cnt']}")
    print(f"Textures indexed:  {tex_count}")
    print(f"Unresolved issues: {unresolved}")
    print()

    if not missing_only:
        # Latest 10 models
        cur.execute("SELECT file_name, format, file_size_bytes, last_modified, variant FROM models ORDER BY scan_timestamp DESC LIMIT 10")
        rows = cur.fetchall()
        if rows:
            print("Recent models:")
            for r in rows:
                size_mb = r["file_size_bytes"] / 1_048_576 if r["file_size_bytes"] else 0
                var = f" [{r['variant']}]" if r["variant"] else ""
                print(f"  • {r['file_name']}{var} ({r['format'].upper()}, {size_mb:.1f} MB)")
            print()

    # Missing textures
    if unresolved > 0:
        cur.execute("""
            SELECT m.file_name, mt.missing_types, mt.reported_at
            FROM missing_textures mt
            JOIN models m ON m.id = mt.model_id
            WHERE mt.resolved = 0
            ORDER BY mt.reported_at DESC
        """)
        missing_rows = cur.fetchall()
        print(f"❌ Models with missing textures ({len(missing_rows)}):")
        for r in missing_rows:
            print(f"  • {r['file_name']}  — missing: {r['missing_types']}  (since {r['reported_at']})")
        print()

        # Group by missing type
        cur.execute("""
            SELECT mt.missing_types, COUNT(*) AS cnt
            FROM missing_textures mt
            WHERE mt.resolved = 0
            GROUP BY mt.missing_types
            ORDER BY cnt DESC
        """)
        print("Most common gaps:")
        for r in cur.fetchall():
            print(f"  • missing {r['missing_types']}:  {r['cnt']} model(s)")
    else:
        print("✅ All models have complete texture sets!")

    conn.close()


def main():
    parser = argparse.ArgumentParser(description="Query and report from the asset-librarian database.")
    parser.add_argument("--db", default=os.environ.get("ASSET_DB", "asset_librarian.db"),
                        help="SQLite database path")
    parser.add_argument("--missing-only", action="store_true",
                        help="Only show models with missing textures")
    parser.add_argument("--export-json", action="store_true",
                        help="Export full database as JSON")
    args = parser.parse_args()

    report(args.db, missing_only=args.missing_only, export_json=args.export_json)


if __name__ == "__main__":
    main()
