"""
Per-type Unreal Engine naming convention validators for SM_, SK_, T_, M_, MI_, BP_.

Each validator returns a list of (issue, severity) tuples.
"""

import os
import re

# ── Shared constants ──

VALID_SEGMENT_RE = re.compile(r"^[A-Z][a-zA-Z0-9]*$")  # PascalCase
LOD_SUFFIX_RE = re.compile(r"_LOD\d+$", re.IGNORECASE)
VARIANT_SUFFIX_RE = re.compile(r"_(High|Low|Med|HQ|LQ|Proxy|Impostor|Simple)$", re.IGNORECASE)

TEXTURE_SUFFIX_MAP = {
    "_D": "albedo/diffuse",
    "_Diffuse": "albedo/diffuse",
    "_Albedo": "albedo/diffuse",
    "_BC": "basecolor",
    "_BaseColor": "basecolor",
    "_N": "normal",
    "_Normal": "normal",
    "_R": "roughness",
    "_Roughness": "roughness",
    "_M": "metallic",
    "_Metallic": "metallic",
    "_A": "ambient occlusion",
    "_AO": "ambient occlusion",
    "_AmbientOcclusion": "ambient occlusion",
    "_Occlusion": "ambient occlusion",
    "_ORM": "packed ORM (AO=R, Rough=G, Metal=B)",
    "_S": "specular",
    "_Specular": "specular",
    "_H": "height/displacement",
    "_Height": "height/displacement",
    "_Disp": "displacement",
    "_E": "emissive",
    "_Emissive": "emissive",
    "_Em": "emissive",
    "_Mask": "mask",
    "_Opacity": "opacity",
    "_Alpha": "opacity",
    "_Gloss": "glossiness",
    "_Glossiness": "glossiness",
    "_SSS": "subsurface",
    "_Subsurface": "subsurface",
    "_MTL": "material mask",
    "_CAD": "cad data",
    "_MRA": "packed MRA (Metal=R, Rough=G, AO=B)",
    "_P": "packed (custom)",
}


def camel_case_split(name):
    """Split PascalCase into words: 'WoodenBarrel' → ['Wooden', 'Barrel']."""
    return re.findall(r"[A-Z][a-z]*|[A-Z]+(?=[A-Z][a-z]|\d|\Z)|[a-z]+|\d+", name)


def check_pascal_case(segment, label="segment"):
    """Check if a name segment follows PascalCase. Returns issue or None."""
    if not segment:
        return None
    issues = []
    if segment[0].islower():
        issues.append(f"{label} '{segment}' should start with uppercase (PascalCase)")
    if "_" in segment:
        issues.append(f"{label} '{segment}' contains underscore — use CamelCase instead")
    if segment.isupper() and len(segment) > 3:
        issues.append(f"{label} '{segment}' is all-uppercase — use PascalCase")
    return issues or None


def check_no_trailing_digits(segment, label="segment"):
    """Warn if segment ends with digits that aren't a known LOD/variant."""
    if re.search(r"\d{2,}$", segment):
        return [f"{label} '{segment}' ends with multi-digit number — use LOD suffix or variant label"]
    return None


def check_segment_count(segments, min_count=2, max_count=4, type_name="asset"):
    """Validate the number of underscore-separated segments."""
    total = len(segments)
    issues = []
    if total < min_count:
        issues.append(f"Too few segments ({total}) — expected at least {min_count} ({type_name} naming: Prefix_Module_Name)")
    if total > max_count:
        issues.append(f"Too many segments ({total}) — max {max_count} recommended ({type_name} naming: Prefix_Module_Name)")
    return issues


# ── Per-type validators ──

def validate_sm(stem, segments):
    """SM_: Static Mesh — SM_Module_MeshName[_Variant][_LOD#]"""
    issues = []
    prefix = segments[0]

    # Segment count
    issues.extend(check_segment_count(segments, min_count=2, max_count=5, type_name="Static Mesh"))

    if len(segments) >= 2:
        module = segments[1]
        seg_issues = check_pascal_case(module, "Module")
        if seg_issues: issues.extend(seg_issues)

    if len(segments) >= 3:
        name = segments[2]
        seg_issues = check_pascal_case(name, "Mesh name")
        if seg_issues: issues.extend(seg_issues)
        dig_issues = check_no_trailing_digits(name, "Mesh name")
        if dig_issues: issues.extend(dig_issues)

    # Check that the name describes a mesh (avoid generic names)
    generic_names = {"Mesh", "Asset", "Object", "Prop", "Model", "NewMesh", "Test"}
    for seg in segments[2:]:
        seg_clean = re.sub(LOD_SUFFIX_RE, "", seg)
        seg_clean = re.sub(VARIANT_SUFFIX_RE, "", seg_clean)
        if seg_clean in generic_names:
            issues.append(f"Generic mesh name '{seg_clean}' — use descriptive name")

    # Check for material-referencing names (M_ prefix inside name)
    for seg in segments:
        if seg.startswith("M_") or seg.startswith("MI_"):
            issues.append(f"Material prefix '{seg}' inside mesh name — materials should use M_ prefix")

    return issues


def validate_sk(stem, segments):
    """SK_: Skeletal Mesh — SK_Module_SkeletonName_MeshName[_LOD#]"""
    issues = []

    issues.extend(check_segment_count(segments, min_count=3, max_count=5, type_name="Skeletal Mesh"))

    if len(segments) >= 2:
        issues.extend(check_pascal_case(segments[1], "Module") or [])

    if len(segments) >= 3:
        name = segments[2]
        issues.extend(check_pascal_case(name, "Skeleton/Character name") or [])
        issues.extend(check_no_trailing_digits(name, "Skeleton/Character name") or [])

    if len(segments) >= 4:
        mesh_part = segments[3]
        issues.extend(check_pascal_case(mesh_part, "Mesh part") or [])

    # Validate that skeletal meshes have at least 3 segments (SK_ + Skeleton + Part)
    if len(segments) < 3:
        issues.append("Skeletal meshes should follow SK_CharacterName_PartName (min 3 segments)")

    return issues


def validate_t(stem, segments):
    """T_: Texture — T_Module_AssetName_Suffix"""
    issues = []

    issues.extend(check_segment_count(segments, min_count=2, max_count=5, type_name="Texture"))

    if len(segments) >= 2:
        issues.extend(check_pascal_case(segments[1], "Module") or [])

    # Detect texture suffix (longest match first)
    suffix_found = None
    match_len = 0
    for suffix in sorted(TEXTURE_SUFFIX_MAP.keys(), key=lambda x: -len(x)):
        if stem.upper().endswith(suffix.upper()):
            if len(suffix) > match_len:
                suffix_found = suffix
                match_len = len(suffix)

    if suffix_found:
        map_type = TEXTURE_SUFFIX_MAP[suffix_found]
    else:
        # Check for last segment as potential suffix
        last_seg = segments[-1] if len(segments) > 1 else ""
        if last_seg.upper() in ("D", "N", "R", "M", "A", "S", "H", "E", "ORM", "MRA", "P"):
            issues.append(f"Suffix '{last_seg}' should be prefixed with underscore ('_{last_seg}')")
            map_type = TEXTURE_SUFFIX_MAP.get(f"_{last_seg}", "unknown")
        else:
            issues.append("Missing texture type suffix — append _D, _N, _R, _M, _ORM, etc.")
            map_type = None

    # 3-segment textures (T_BaseName_Suffix) are valid — don't flag them
    if len(segments) == 3 and suffix_found:
        return issues

    # Check name length for textures (UE has stricter limits)
    if suffix_found:
        name_without_suffix = stem[: -len(suffix_found)] if suffix_found else stem
        if len(name_without_suffix) > 80:
            issues.append(f"Texture base name too long ({len(name_without_suffix)} chars, max 80)")

    # Check that suffix matches common patterns
    if suffix_found and map_type:
        content_part = "_".join(segments[2:-1]) if suffix_found else "_".join(segments[2:])
        if len(content_part) == 0 and len(segments) >= 3:
            issues.append("Texture name has module but no asset name — T_Module_Suffix is too vague")

    return issues


def validate_m(stem, segments):
    """M_: Material — M_Module_MaterialName[_Variant]"""
    issues = []

    issues.extend(check_segment_count(segments, min_count=2, max_count=4, type_name="Material"))

    if len(segments) >= 2:
        issues.extend(check_pascal_case(segments[1], "Module") or [])

    if len(segments) >= 3:
        name = segments[2]
        issues.extend(check_pascal_case(name, "Material name") or [])

    # Material named just the prefix + one word is too vague unless >= 6 chars
    if len(segments) == 2:
        name_seg = segments[1]
        if len(name_seg) < 6:
            issues.append(f"Material name '{name_seg}' is too short — use M_Module_MaterialName (min 6 chars)")

    # Check for texture-like suffixes
    for suffix in ["_D", "_N", "_R", "_M", "_A", "_ORM"]:
        if stem.upper().endswith(suffix.upper()):
            issues.append(f"Material ends with texture suffix '{suffix}' — rename or use T_ prefix")

    return issues


def validate_mi(stem, segments):
    """MI_: Material Instance — MI_Module_VariantName or MI_ParentMaterial_Variant"""
    issues = []

    issues.extend(check_segment_count(segments, min_count=2, max_count=4, type_name="Material Instance"))

    if len(segments) >= 2:
        issues.extend(check_pascal_case(segments[1], "Module/Parent") or [])

    if len(segments) >= 3:
        variant = segments[2]
        issues.extend(check_pascal_case(variant, "Variant name") or [])

    # MI should reference what it's derived from
    if len(segments) < 3:
        issues.append("Material Instance should include parent reference: MI_Parent_Variant")

    # Variant indicator
    variant_keywords = ["Inst", "Variant", "V1", "V2", "Alt", "Damaged", "New", "Old", "Worn", "Clean"]
    last_seg = segments[-1] if len(segments) > 1 else ""
    if last_seg in variant_keywords:
        pass  # OK, common variant names
    elif len(segments) >= 3:
        # Last segment should suggest a variant, not just repeat parent
        if segments[-1] == segments[-2]:
            issues.append("Variant name same as parent — use MI_Parent_VariantName")

    return issues


def validate_bp(stem, segments):
    """BP_: Blueprint — BP_Module_ClassName[_Variant]"""
    issues = []

    issues.extend(check_segment_count(segments, min_count=2, max_count=4, type_name="Blueprint"))

    if len(segments) >= 2:
        issues.extend(check_pascal_case(segments[1], "Module") or [])

    if len(segments) >= 3:
        name = segments[2]
        issues.extend(check_pascal_case(name, "Class name") or [])

    # Blueprint should describe what it does
    action_words = {"Actor", "Pawn", "Character", "Component", "Widget", "Interface", "Library",
                    "FunctionLibrary", "GameMode", "PlayerState", "GameState", "HUD"}
    last_seg = segments[-1] if len(segments) > 1 else ""
    if last_seg not in action_words and len(segments) >= 3:
        pass  # Custom class name is fine
    elif len(segments) == 2:
        issues.append("Blueprint should include class description: BP_Module_ClassName")

    # Check for generic names
    generic = {"Blueprint", "BP", "NewBlueprint", "MyClass", "Test"}
    for seg in segments[1:]:
        if seg in generic:
            issues.append(f"Generic Blueprint name '{seg}' — use descriptive class name")

    return issues


# ── Dispatcher ──

PER_TYPE_VALIDATORS = {
    "SM": validate_sm,
    "SK": validate_sk,
    "T":  validate_t,
    "M":  validate_m,
    "MI": validate_mi,
    "BP": validate_bp,
}


def run_type_validator(prefix_letters, stem, segments):
    """Run the per-type validator if one exists. Returns list of issues."""
    validator = PER_TYPE_VALIDATORS.get(prefix_letters)
    if validator:
        return validator(stem, segments)
    return []
