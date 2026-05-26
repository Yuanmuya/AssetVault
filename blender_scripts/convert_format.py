#!/usr/bin/env python3
"""
Blender format converter — convert between FBX, OBJ, GLB/GLTF.

Usage:
    blender --background --python convert_format.py -- --input <path> --output <path>

Auto-detects format from the output file extension.
"""

import argparse
import os
import sys


def main():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []

    parser = argparse.ArgumentParser(description="Convert 3D model format via Blender")
    parser.add_argument("--input", "-i", required=True, help="Input model path")
    parser.add_argument("--output", "-o", required=True, help="Output model path")
    args = parser.parse_args(argv)

    in_path = os.path.abspath(args.input)
    out_path = os.path.abspath(args.output)

    if not os.path.isfile(in_path):
        print(f"❌ Input not found: {in_path}")
        sys.exit(1)

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    import bpy

    # Reset
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Import
    ext_in = os.path.splitext(in_path)[1].lower()
    if ext_in == ".fbx":
        bpy.ops.import_scene.fbx(filepath=in_path)
    elif ext_in == ".obj":
        bpy.ops.import_scene.obj(filepath=in_path)
    elif ext_in in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=in_path)
    elif ext_in == ".usdz":
        if hasattr(bpy.ops.wm, "usd_import"):
            bpy.ops.wm.usd_import(filepath=in_path)
        elif hasattr(bpy.ops.import_scene, "usd"):
            bpy.ops.import_scene.usd(filepath=in_path)
        else:
            print("❌ Blender USD/USDZ importer is not available in this Blender install")
            sys.exit(1)
    else:
        print(f"❌ Unsupported input format: {ext_in}")
        sys.exit(1)

    print(f"   Imported: {in_path}")

    # Export
    ext_out = os.path.splitext(out_path)[1].lower()
    if ext_out == ".fbx":
        bpy.ops.export_scene.fbx(filepath=out_path, embed_textures=True)
    elif ext_out == ".obj":
        bpy.ops.export_scene.obj(filepath=out_path)
    elif ext_out == ".glb":
        bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB")
    elif ext_out == ".gltf":
        bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLTF_SEPARATE")
    else:
        print(f"❌ Unsupported output format: {ext_out}")
        sys.exit(1)

    out_size = os.path.getsize(out_path)
    print(f"✅ Converted: {in_path} → {out_path} ({out_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
