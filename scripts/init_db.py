#!/usr/bin/env python3
"""
asset-librarian: SQLite database initialiser.

Creates the asset_librarian.db with the canonical schema.
"""

import sqlite3
import argparse
import os
import sys


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS models (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path       TEXT    NOT NULL UNIQUE,
    file_name       TEXT    NOT NULL,
    format          TEXT    NOT NULL,
    file_size_bytes INTEGER,
    last_modified   TEXT,
    scan_timestamp  TEXT    NOT NULL DEFAULT (datetime('now')),
    variant         TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS textures (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id    INTEGER NOT NULL,
    file_path   TEXT    NOT NULL,
    map_type    TEXT    NOT NULL,
    width       INTEGER DEFAULT NULL,
    height      INTEGER DEFAULT NULL,
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS missing_textures (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id      INTEGER NOT NULL,
    missing_types TEXT    NOT NULL,
    reported_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    resolved      INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_models_path     ON models(file_path);
CREATE INDEX IF NOT EXISTS idx_textures_model  ON textures(model_id);
CREATE INDEX IF NOT EXISTS idx_missing_model   ON missing_textures(model_id);

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
"""


def main():
    parser = argparse.ArgumentParser(description="Initialise the asset-librarian SQLite database.")
    parser.add_argument("--db", default=os.environ.get("ASSET_DB", "asset_librarian.db"),
                        help="Path to SQLite database (default: asset_librarian.db)")
    args = parser.parse_args()

    db_path = os.path.abspath(args.db)
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)

    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    conn.close()
    print(f"✅ Database initialised at: {db_path}")


if __name__ == "__main__":
    main()
