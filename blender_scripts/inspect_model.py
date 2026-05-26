#!/usr/bin/env python3
"""
Blender model inspector — extract metadata from 3D models.

Usage:
    blender --background --python inspect_model.py -- --model <path> [--json]

Outputs: vertex/edge/face counts, material names, texture paths, UV layers,
         vertex colour layers, LOD info, and file integrity status.
"""

import argparse
import json
import os
import sys


def main():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []

    parser = argparse.ArgumentParser(description="Inspect 3D model metadata via Blender")
    parser.add_argument("--model", required=True, help="Path to 3D model file")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args(argv)

    model_path = os.path.abspath(args.model)
    if not os.path.isfile(model_path):
        print(f"❌ Model not found: {model_path}")
        sys.exit(1)

    import bpy

    bpy.ops.wm.read_factory_settings(use_empty=True)

    ext = os.path.splitext(model_path)[1].lower()
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=model_path)
    elif ext == ".obj":
        bpy.ops.import_scene.obj(filepath=model_path)
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=model_path)
    elif ext == ".usdz":
        if hasattr(bpy.ops.wm, "usd_import"):
            bpy.ops.wm.usd_import(filepath=model_path)
        elif hasattr(bpy.ops.import_scene, "usd"):
            bpy.ops.import_scene.usd(filepath=model_path)
        else:
            print("❌ Blender USD/USDZ importer is not available in this Blender install")
            sys.exit(1)
    else:
        print(f"❌ Unsupported format: {ext}")
        sys.exit(1)

    info = {
        "file": {
            "path": model_path,
            "name": os.path.basename(model_path),
            "format": ext.lstrip("."),
            "size_bytes": os.path.getsize(model_path),
        },
        "objects": [],
        "summary": {
            "total_meshes": 0,
            "total_vertices": 0,
            "total_edges": 0,
            "total_faces": 0,
            "total_materials": 0,
            "total_textures": 0,
        },
        "scene": {
            "world": bpy.context.scene.world.name if bpy.context.scene.world else None,
            "render_engine": bpy.context.scene.render.engine if hasattr(bpy.context.scene.render, "engine") else None,
        },
    }

    material_textures = set()
    material_names = set()

    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue

        mesh = obj.data
        obj_info = {
            "name": obj.name,
            "vertices": len(mesh.vertices),
            "edges": len(mesh.edges),
            "faces": len(mesh.polygons),
            "uv_layers": [uv.name for uv in mesh.uv_layers],
            "vertex_colors": [vc.name for vc in mesh.vertex_colors] if hasattr(mesh, "vertex_colors") else [],
            "materials": [],
        }

        for mat_slot in obj.material_slots:
            if mat_slot.material:
                mat_name = mat_slot.material.name
                material_names.add(mat_name)
                mat_info = {"name": mat_name, "nodes": []}
                if mat_slot.material.node_tree:
                    for node in mat_slot.material.node_tree.nodes:
                        if node.type == "TEX_IMAGE" and node.image:
                            tex_path = node.image.filepath if hasattr(node.image, "filepath") else node.image.name
                            mat_info["nodes"].append({
                                "type": node.type,
                                "name": node.name,
                                "texture": os.path.basename(tex_path) if tex_path else None,
                                "full_path": tex_path if os.path.isfile(bpy.path.abspath(tex_path)) else None,
                            })
                            if tex_path:
                                material_textures.add(bpy.path.abspath(tex_path) if not os.path.isabs(tex_path) else tex_path)
                obj_info["materials"].append(mat_info)

        info["objects"].append(obj_info)
        info["summary"]["total_meshes"] += 1
        info["summary"]["total_vertices"] += len(mesh.vertices)
        info["summary"]["total_edges"] += len(mesh.edges)
        info["summary"]["total_faces"] += len(mesh.polygons)

    info["summary"]["total_materials"] = len(material_names)
    info["summary"]["total_textures"] = len(material_textures)
    info["texture_paths"] = list(material_textures)

    # Integrity check
    missing_textures = [p for p in material_textures if not os.path.isfile(p)]
    info["integrity"] = {
        "status": "ok" if not missing_textures else "missing_textures",
        "missing_textures": missing_textures,
    }

    if args.json:
        print(json.dumps(info, indent=2, default=str))
    else:
        s = info["summary"]
        fmt = info["file"]["format"].upper()
        size_kb = info["file"]["size_bytes"] / 1024
        print(f"{'='*50}")
        print(f"  {info['file']['name']}  ({fmt}, {size_kb:.1f} KB)")
        print(f"{'='*50}")
        print(f"  Meshes:     {s['total_meshes']}")
        print(f"  Vertices:   {s['total_vertices']:,}")
        print(f"  Edges:      {s['total_edges']:,}")
        print(f"  Faces:      {s['total_faces']:,}")
        print(f"  Materials:  {s['total_materials']}")
        print(f"  Textures:   {s['total_textures']}")
        print(f"  Integrity:  {info['integrity']['status']}")
        if info["integrity"]["missing_textures"]:
            print(f"  Missing textures:")
            for p in info["integrity"]["missing_textures"]:
                print(f"    ⚠️  {p}")
        print()
        for obj_info in info["objects"]:
            uv_str = f", UVs: {obj_info['uv_layers']}" if obj_info["uv_layers"] else " (no UVs)"
            vc_str = f", Colors: {obj_info['vertex_colors']}" if obj_info["vertex_colors"] else ""
            print(f"  • {obj_info['name']}: {obj_info['vertices']}v / {obj_info['faces']}f{uv_str}{vc_str}")
            for mat in obj_info["materials"]:
                tex_names = [n["texture"] for n in mat["nodes"] if n["texture"]]
                if tex_names:
                    print(f"      {mat['name']}: {', '.join(tex_names)}")
                else:
                    print(f"      {mat['name']}: (no textures)")


if __name__ == "__main__":
    main()
