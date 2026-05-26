#!/usr/bin/env python3
"""
Blender thumbnail renderer — invoked by Blender's bundled Python.

Usage (from outside Blender):
    blender --background --python render_thumbnail.py -- --model <path> [--output <path>] [--size 512] [--rotation 0 0 0]

Generates a lit, turntable-style thumbnail and saves as PNG.
"""

import argparse
import json
import math
import os
import sys


def first_existing_path(path):
    if path and os.path.isfile(path):
        return path
    return None


def get_principled_input(node, *names):
    for name in names:
        if name in node.inputs:
            return node.inputs[name]
    return None


def material_has_image_texture(mat):
    if not mat or not mat.use_nodes or not mat.node_tree:
        return False
    return any(node.type == "TEX_IMAGE" and getattr(node, "image", None) for node in mat.node_tree.nodes)


def is_dark_material(mat):
    if not mat:
        return True
    color = getattr(mat, "diffuse_color", (0, 0, 0, 1))
    if max(color[0], color[1], color[2]) >= 0.04:
        return False
    if mat.use_nodes and mat.node_tree:
        bsdf = next((node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
        color_input = get_principled_input(bsdf, "Base Color") if bsdf else None
        if color_input and max(color_input.default_value[:3]) >= 0.04:
            return False
    return True


def create_preview_material(bpy, textures):
    mat = bpy.data.materials.new("AssetLibrarianPreviewPBR")
    mat.diffuse_color = (0.72, 0.76, 0.82, 1.0)
    mat.use_nodes = True
    mat.blend_method = "OPAQUE"
    if hasattr(mat, "use_screen_refraction"):
        mat.use_screen_refraction = False

    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next((node for node in nodes if node.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        return mat

    base_color = get_principled_input(bsdf, "Base Color")
    roughness = get_principled_input(bsdf, "Roughness")
    metallic = get_principled_input(bsdf, "Metallic")
    alpha = get_principled_input(bsdf, "Alpha")
    emission_color = get_principled_input(bsdf, "Emission Color", "Emission")
    emission_strength = get_principled_input(bsdf, "Emission Strength")

    if base_color:
        base_color.default_value = (0.72, 0.76, 0.82, 1.0)
    if roughness:
        roughness.default_value = 0.65
    if metallic:
        metallic.default_value = 0.0
    if emission_strength:
        emission_strength.default_value = 1.0

    def image_node(map_type, colorspace="Non-Color"):
        image_path = first_existing_path(textures.get(map_type))
        if not image_path:
            return None
        try:
            image = bpy.data.images.load(image_path, check_existing=True)
            image.colorspace_settings.name = colorspace
            node = nodes.new(type="ShaderNodeTexImage")
            node.image = image
            node.label = map_type
            return node
        except Exception as exc:
            print(f"⚠️  Texture skipped ({map_type}): {exc}")
            return None

    albedo = image_node("albedo", "sRGB")
    if albedo and base_color:
        links.new(albedo.outputs["Color"], base_color)

    roughness_node = image_node("roughness")
    if roughness_node and roughness:
        links.new(roughness_node.outputs["Color"], roughness)

    metallic_node = image_node("metallic")
    if metallic_node and metallic:
        links.new(metallic_node.outputs["Color"], metallic)

    opacity = image_node("opacity")
    if opacity and alpha:
        links.new(opacity.outputs["Color"], alpha)
        mat.blend_method = "BLEND"
        if hasattr(mat, "show_transparent_back"):
            mat.show_transparent_back = True

    emission = image_node("emission", "sRGB")
    if emission and emission_color:
        links.new(emission.outputs["Color"], emission_color)

    normal = image_node("normal")
    normal_input = get_principled_input(bsdf, "Normal")
    if normal and normal_input:
        normal_map = nodes.new(type="ShaderNodeNormalMap")
        links.new(normal.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], normal_input)

    return mat


def import_usd_asset(bpy, model_path):
    if hasattr(bpy.ops.wm, "usd_import"):
        bpy.ops.wm.usd_import(filepath=model_path)
        return
    if hasattr(bpy.ops.import_scene, "usd"):
        bpy.ops.import_scene.usd(filepath=model_path)
        return
    print("❌ Blender USD/USDZ importer is not available in this Blender install")
    sys.exit(1)


def main():
    argv = sys.argv
    # Everything after "--" is our args
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []

    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Path to 3D model file")
    parser.add_argument("--output", default=None, help="Output PNG path (default: next to model)")
    parser.add_argument("--size", type=int, default=512, help="Image size in pixels (default: 512)")
    parser.add_argument("--textures", default="{}", help="JSON map of PBR texture channels to file paths")
    parser.add_argument("--rotation", nargs=3, type=float, default=[45, 30, 0],
                        help="Camera orbit (rx, ry, rz) degrees (default: 45 30 0)")
    args = parser.parse_args(argv)

    model_path = os.path.abspath(args.model)
    if not os.path.isfile(model_path):
        print(f"❌ Model not found: {model_path}")
        sys.exit(1)

    output = args.output or os.path.splitext(model_path)[0] + "_thumb.png"
    try:
        textures = json.loads(args.textures or "{}")
    except json.JSONDecodeError:
        textures = {}

    import bpy
    import mathutils

    # ── Reset scene ──
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # ── Import model ──
    ext = os.path.splitext(model_path)[1].lower()
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=model_path)
    elif ext == ".obj":
        bpy.ops.import_scene.obj(filepath=model_path)
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=model_path)
    elif ext == ".usdz":
        import_usd_asset(bpy, model_path)
    else:
        print(f"❌ Unsupported format: {ext}")
        sys.exit(1)

    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not mesh_objects:
        print("❌ No mesh objects found after import")
        sys.exit(1)

    # ── Preview-safe materials ──
    preview_mat = create_preview_material(bpy, textures)
    for obj in mesh_objects:
        obj.select_set(False)
        if not obj.material_slots:
            obj.data.materials.append(preview_mat)
            continue
        for slot in obj.material_slots:
            mat = slot.material
            if not mat:
                slot.material = preview_mat
                continue
            if is_dark_material(mat) and not material_has_image_texture(mat):
                slot.material = preview_mat

    # ── Centre and scale the full imported scene ──
    bbox_points = []
    for obj in mesh_objects:
        bbox_points.extend(obj.matrix_world @ mathutils.Vector(corner) for corner in obj.bound_box)
    min_v = mathutils.Vector((min(p.x for p in bbox_points), min(p.y for p in bbox_points), min(p.z for p in bbox_points)))
    max_v = mathutils.Vector((max(p.x for p in bbox_points), max(p.y for p in bbox_points), max(p.z for p in bbox_points)))
    center = (min_v + max_v) * 0.5
    size_v = max_v - min_v
    max_dim = max(size_v.x, size_v.y, size_v.z)
    scale = 2.0 / max_dim if max_dim > 0 else 1.0

    root = bpy.data.objects.new("AssetLibrarianRoot", None)
    bpy.context.collection.objects.link(root)
    roots = [obj for obj in bpy.context.scene.objects if obj.type != "CAMERA" and obj.type != "LIGHT" and obj.parent is None and obj != root]
    for obj in roots:
        obj.parent = root
    root.location = -center * scale
    root.scale = (scale, scale, scale)

    # ── Lighting ──
    def look_at(obj, target):
        direction = mathutils.Vector(target) - obj.location
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    bpy.context.scene.world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world.color = (0.78, 0.82, 0.88)

    bpy.ops.object.light_add(type="AREA", location=(4, -5, 5))
    light = bpy.context.object
    light.data.energy = 700
    light.data.size = 5
    look_at(light, (0, 0, 0))

    bpy.ops.object.light_add(type="AREA", location=(-4, 3, 4))
    fill = bpy.context.object
    fill.data.energy = 350
    fill.data.size = 6
    look_at(fill, (0, 0, 0))

    bpy.context.view_layer.update()

    # ── Add camera ──
    rx, ry, rz = [math.radians(v) for v in args.rotation]
    dist = 5.0
    cam_x = dist * math.cos(ry) * math.cos(rx)
    cam_y = dist * math.sin(ry) * math.cos(rx)
    cam_z = dist * math.sin(rx)
    bpy.ops.object.camera_add(location=(cam_x, cam_y, cam_z))
    cam = bpy.context.object
    look_at(cam, (0, 0, 0))
    cam.data.type = "ORTHO"
    cam.data.clip_start = 0.001
    cam.data.clip_end = 1000
    bpy.context.scene.camera = cam

    # Fit by projected camera-space bounds so very small source units still fill the thumbnail.
    bpy.context.view_layer.update()
    camera_space_points = []
    for obj in mesh_objects:
        for corner in obj.bound_box:
            world_point = obj.matrix_world @ mathutils.Vector(corner)
            camera_space_points.append(cam.matrix_world.inverted() @ world_point)
    if camera_space_points:
        min_x = min(p.x for p in camera_space_points)
        max_x = max(p.x for p in camera_space_points)
        min_y = min(p.y for p in camera_space_points)
        max_y = max(p.y for p in camera_space_points)
        projected_width = max_x - min_x
        projected_height = max_y - min_y
        cam.data.ortho_scale = max(projected_width, projected_height, 0.05) * 1.18

    # ── Rendering settings ──
    render_engines = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys()
    bpy.context.scene.render.engine = (
        "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in render_engines else "BLENDER_EEVEE"
    )
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.image_settings.color_mode = "RGBA"
    bpy.context.scene.render.resolution_x = args.size
    bpy.context.scene.render.resolution_y = args.size
    bpy.context.scene.render.film_transparent = True
    bpy.context.scene.render.filepath = output
    bpy.context.scene.render.filter_size = 1.5

    bpy.ops.render.render(write_still=True)
    print(f"✅ Thumbnail saved: {output}")


if __name__ == "__main__":
    main()
