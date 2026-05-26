#!/usr/bin/env python3
"""
asset-librarian: Unreal Engine asset naming validation and texture channel detection.

Validates model filenames against UE name conventions and detects actual
texture channels by inspecting pixel data.

Usage:
    python scripts/validate_assets.py --db ./asset_librarian.db
    python scripts/validate_assets.py --db ./asset_librarian.db --report-only
"""

import argparse
import json
import os
import re
import sqlite3
import sys
from ue_naming_rules import run_type_validator
from texture_analyzer import analyze as analyze_texture

try:
    import numpy as np
except ImportError:
    np = None

try:
    from PIL import Image
except ImportError:
    Image = None

# ── UE Prefix Reference ──

UE_PREFIXES = {
    # Geometry
    "SM": "Static Mesh",
    "SK": "Skeletal Mesh",
    "SKC": "Skeleton",
    "R": "Rig",
    "A": "Animation",
    "ABP": "Animation Blueprint",
    "AL": "Animation Layer",
    "AM": "Alembic Mesh",
    # Materials & Textures
    "M": "Material",
    "MI": "Material Instance",
    "MPC": "Material Parameter Collection",
    "MF": "Material Function",
    "T": "Texture",
    "TC": "Texture Collection",
    "TD": "Texture Diffuse",
    # UI & Effects
    "WBP": "Widget Blueprint",
    "BP": "Blueprint",
    "P": "Particle System",
    "PS": "Particle System",
    "VFX": "VFX",
    "NI": "Niagara System",
    # Audio
    "S": "Sound",
    "SP": "Sound",
    "SS": "Sound",
    # Media & UI
    "UI": "UI",
    "F": "Font",
    "I": "Image",
    "IMG": "Image",
    # Data
    "DT": "Data Table",
    "D": "Data Asset",
    "C": "Curve",
    "CS": "Curve Set",
    # Levels
    "L": "Level",
    "LA": "Level Actor",
    "LG": "Level Geometry",
    "LS": "Level Script",
    "PP": "Post Process",
    "SUB": "Subsurface Profile",
    "PSYS": "Physics System",
}

# Texture suffix → map type
UE_TEXTURE_SUFFIXES = {
    "_D": "albedo",
    "_Diffuse": "albedo",
    "_Albedo": "albedo",
    "_N": "normal",
    "_Normal": "normal",
    "_R": "roughness",
    "_Roughness": "roughness",
    "_M": "metallic",
    "_Metallic": "metallic",
    "_A": "ao",
    "_AO": "ao",
    "_AmbientOcclusion": "ao",
    "_Occlusion": "ao",
    "_S": "specular",
    "_Specular": "specular",
    "_H": "displacement",
    "_Height": "displacement",
    "_Disp": "displacement",
    "_E": "emission",
    "_Emissive": "emission",
    "_ORM": "orm",
    "_Mask": "mask",
    "_Opacity": "opacity",
    "_Alpha": "opacity",
    "_Gloss": "glossiness",
    "_Glossiness": "glossiness",
    "_SSS": "subsurface",
    "_Subsurface": "subsurface",
    "_MTL": "material",
    "_CAD": "cad",
}

# Common materials that don't need standard prefixes (used as references)
MATERIAL_EXTS = {".uasset", ".umap"}


def detect_ue_prefix(filename: str) -> dict:
    """
    Check a filename against Unreal Engine prefix conventions.
    Returns dict with prefix, category, status, issues, and suggestions.

    For the 6 primary types (SM, SK, T, M, MI, BP) runs deep per-type
    validation with module naming, PascalCase checks, and type-specific rules.
    """
    stem = os.path.splitext(filename)[0]

    has_underscore = "_" in stem
    prefix = stem.split("_")[0] if has_underscore else None
    segments = stem.split("_") if has_underscore else [stem]

    result = {
        "prefix": prefix,
        "category": None,
        "status": "unknown",
        "issues": [],
        "suggestion": None,
    }

    if not prefix:
        result["issues"].append("No UE prefix detected (no underscore in name)")
        result["status"] = "invalid_prefix"
        return result

    # Match letters case-insensitively for prefix detection
    base_prefix = re.match(r"^([A-Za-z]+)", prefix)
    if not base_prefix:
        result["issues"].append(f"Prefix '{prefix}' does not start with letters")
        result["status"] = "invalid_prefix"
        return result

    raw_prefix = base_prefix.group(1)
    prefix_letters = raw_prefix.upper()

    if raw_prefix != raw_prefix.upper():
        result["issues"].append(f"Prefix '{raw_prefix}' should be uppercase (e.g., '{prefix_letters}_')")
        result["status"] = "case_warning"

    if prefix != prefix_letters and prefix.upper() == prefix_letters:
        pass  # Prefix differs only by case, already handled above
    elif prefix != prefix_letters:
        result["issues"].append(f"Prefix '{prefix}' has extra characters; expected '{prefix_letters}'")

    if prefix_letters not in UE_PREFIXES:
        result["status"] = "invalid_prefix"
        result["suggestion"] = _suggest_prefix(prefix_letters)
        return result

    # Remove the duplicate case check below since we handled it above

    # ── Common checks for all recognized prefixes ──

    result["category"] = UE_PREFIXES[prefix_letters]
    # Don't overwrite case_warning from earlier check
    if result["status"] not in ("case_warning",):
        result["status"] = "valid"

    # Empty name / trailing underscore check
    name_part = stem[len(prefix) + 1:] if has_underscore else ""
    if len(name_part) == 0:
        result["issues"].append("Empty asset name after prefix")
        result["status"] = "invalid_name"
        return result
    # Check for trailing underscore making an empty final segment
    if stem.endswith("_"):
        result["issues"].append("Trailing underscore after asset name — remove")
        if result["status"] == "valid":
            result["status"] = "invalid_name"

    # Spaces
    if " " in stem:
        result["issues"].append("Contains spaces — use underscores instead")
        result["status"] = "invalid"

    # Special characters
    if re.search(r"[^a-zA-Z0-9_]", stem):
        result["issues"].append("Contains special characters (only letters, digits, underscores allowed)")
        result["status"] = "invalid"

    # Overall length
    if len(stem) > 120:
        result["issues"].append(f"Name too long ({len(stem)} chars, max 120)")
        result["status"] = "length_warning"

    # ── Texture suffix detection (for T_ prefix check) ──
    if prefix_letters in ("T", "TD"):
        for suffix, map_type in UE_TEXTURE_SUFFIXES.items():
            if stem.upper().endswith(suffix.upper()):
                result["texture_type"] = map_type
                break
        else:
            result["issues"].append("Texture lacks standard UE suffix (_D, _N, _R, _M, _ORM, etc.)")

    # ── Per-type deep validation for SM, SK, T, M, MI, BP ──
    type_issues = run_type_validator(prefix_letters, stem, segments)
    if type_issues:
        result["issues"].extend(type_issues)
        # Upgrade status if we found concrete issues (not just warnings)
        if result["status"] == "valid":
            result["status"] = "type_warning"

    # ── Cross-type validation ──

    # Check for double underscores
    if "__" in stem:
        result["issues"].append("Contains double underscore '__' — use single underscores")
        if result["status"] in ("valid", "case_warning"):
            result["status"] = "type_warning"

    # UE discourages filenames ending with numbers (use LOD suffix instead)
    if re.search(r"_\d+$", stem) and not re.search(r"_LOD\d+$", stem, re.IGNORECASE):
        result["issues"].append("Ends with numeric suffix — use _LOD# convention instead")
        if result["status"] == "valid":
            result["status"] = "type_warning"

    # Check segment PascalCase for the name parts only (not prefix, not suffix parts)
    for i, seg in enumerate(segments[1:], 1):
        # Skip LOD/variant segments
        if re.match(r"^LOD\d+$", seg, re.IGNORECASE): continue
        if seg.lower() in ("high", "low", "med", "hq", "lq", "proxy", "impostor", "simple"): continue
        # Skip texture suffix segments for T_ type
        if prefix_letters == "T" and i == len(segments) - 1:
            if any(stem.upper().endswith(s.upper()) for s in UE_TEXTURE_SUFFIXES):
                continue
        # Check PascalCase
        if seg and seg[0].islower() and len(seg) > 2:
            result["issues"].append(f"Segment '{seg}' should use PascalCase (capitalize first letter)")

    return result


def _suggest_prefix(prefix: str) -> str:
    """Suggest a close UE prefix match."""
    from difflib import get_close_matches
    candidates = get_close_matches(prefix, list(UE_PREFIXES.keys()), n=3, cutoff=0.3)
    if candidates:
        return f"Did you mean: {', '.join(candidates)}?"
    return "Not a recognized UE prefix. See SKILL.md or go to docs.unrealengine.com"


# ── Texture Channel Detection ──

def analyze_texture_channels(image_path: str) -> dict | None:
    """Analyze texture via shared texture_analyzer module, adapting dict keys."""
    raw = analyze_texture(image_path)
    if raw is None:
        return None
    return {
        "width": raw["orig_width"],
        "height": raw["orig_height"],
        "mode": raw["mode"],
        "has_alpha": raw["has_alpha"],
        "channels": raw["channels"],
        "classification": raw["classification"],
        "is_constant": raw["is_constant"],
    }


# ── Database Operations ──

def ensure_table(conn):
    conn.executescript("""
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
    """)


def validate(conn, report_only: bool = False):
    cur = conn.cursor()

    # Validate models
    cur.execute("SELECT id, file_name, file_path FROM models")
    models = cur.fetchall()
    if not models:
        print("   No models to validate.")
        return

    if not report_only:
        ensure_table(conn)

    valid_count = 0
    warning_count = 0
    invalid_count = 0
    total_issues = 0

    print(f"{'='*60}")
    print(f"  UE Asset Naming Validation")
    print(f"{'='*60}")
    print(f"  Models checked: {len(models)}")

    for mid, fname, fpath in models:
        result = detect_ue_prefix(fname)
        status = result["status"]
        issues = result["issues"]

        if status == "valid":
            valid_count += 1
        elif "warning" in status:
            warning_count += 1
        else:
            invalid_count += 1

        total_issues += len(issues)

        if not report_only:
            cur.execute("""
                INSERT OR REPLACE INTO asset_validation
                    (model_id, ue_prefix, ue_category, ue_status, ue_issues, validated_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
            """, (mid, result["prefix"], result["category"], status, ",".join(issues)))

        if issues:
            icon = {"valid": "✓", "invalid": "❌", "invalid_prefix": "❌",
                    "case_warning": "⚠️", "invalid_name": "❌",
                    "length_warning": "⚠️"}.get(status, "?")
            prefix_str = f"[{result['prefix'] or '??'}]" if result.get("prefix") else ""
            cat_str = f" ({result['category']})" if result.get("category") else ""
            print(f"  {icon} {fname} {prefix_str}{cat_str}")
            for iss in issues:
                print(f"       {iss}")
            if result.get("suggestion"):
                print(f"       💡 {result['suggestion']}")
        else:
            print(f"  ✓  {fname} — [{result['prefix']}] OK")

    print(f"\n  Summary: {valid_count} valid, {warning_count} warnings, {invalid_count} invalid")
    print(f"  Total issues: {total_issues}")

    # ── Texture channel analysis ──
    print(f"\n{'='*60}")
    print(f"  Texture Channel Analysis")
    print(f"{'='*60}")

    cur.execute("""
        SELECT DISTINCT t.file_path, t.map_type, t.width, t.height
        FROM textures t
        ORDER BY t.map_type, t.file_path
    """)
    textures = cur.fetchall()

    if not textures:
        print("   No textures to analyze.")
    else:
        print(f"  Textures analyzed: {len(textures)}")
        for tex_path, map_type, tw, th in textures:
            analysis = analyze_texture_channels(tex_path)
            if analysis:
                ch = analysis["channels"]
                ch_summary = ", ".join(
                    f"{cn}={cv['mean']:.2f}" for cn, cv in sorted(ch.items())
                )
                cls = analysis.get("classification", {})
                cls_type = cls.get("type", "?") if cls else "?"
                cls_desc = cls.get("description", "") if cls else ""
                cls_conf = cls.get("confidence", "") if cls else ""
                packed = ""
                if cls_type == "orm":
                    packed = " [PACKED: AO=R, Rough=G, Metal=B]"
                elif cls_type == "normal":
                    packed = " [NORMAL MAP]"

                fname = os.path.basename(tex_path)
                print(f"  \u2022 {fname}  {map_type}")
                print(f"       Size: {analysis['width']}\u00d7{analysis['height']}  "
                      f"Mode: {analysis['mode']}  "
                      f"Alpha: {'yes' if analysis['has_alpha'] else 'no'}")
                print(f"       Channels: {ch_summary}")
                print(f"       Pixel class: {cls_desc} (confidence={cls_conf}){packed}")

                # Update texture record with channel info
                if not report_only:
                    cur.execute("""
                        UPDATE textures
                        SET width=?, height=?
                        WHERE file_path=? AND (width IS NULL OR height IS NULL)
                    """, (analysis["width"], analysis["height"], tex_path))
            else:
                print(f"  • {os.path.basename(tex_path)}  (could not analyze)")

    if not report_only:
        conn.commit()
        print(f"\n  Validation results saved to asset_validation table.")

    print()
    return total_issues


def main():
    parser = argparse.ArgumentParser(
        description="Validate 3D asset naming against UE conventions and detect texture channels."
    )
    parser.add_argument("--db", default=None,
                        help="SQLite database path (default: $ASSET_DB or ./asset_librarian.db)")
    parser.add_argument("--report-only", action="store_true",
                        help="Only print report; don't write to database")
    args = parser.parse_args()

    db = args.db or os.environ.get("ASSET_DB", "asset_librarian.db")
    if not os.path.isfile(db):
        print(f"❌ Database not found: {db}")
        sys.exit(1)

    conn = sqlite3.connect(db)
    issues = validate(conn, report_only=args.report_only)
    conn.close()

    if issues > 0:
        print(f"⚠️  {issues} validation issues found. Review the report above.")
    else:
        print("✅ All assets pass UE naming conventions!")


if __name__ == "__main__":
    main()
