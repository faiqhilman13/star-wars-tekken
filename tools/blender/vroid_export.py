"""ANIME EXPORT: <id>_anime_master.blend -> public/models/<id>.glb (contract v5).

  python tools/blender/run.py tools/blender/vroid_export.py -- --char kael

- Meshes in LOW + the contract armature (RIG_DEF); modifiers not applied (shape keys: palmOpen on the body,
  expr_* on the face), skins, morph targets (with normals), no animation.
- Material custom property "toon" -> glTF material extras (linear RGB colours); build-only props stripped.
- The active colour attribute (sd_outline, R = outline width scale) -> COLOR_0 (export_vertex_color='ACTIVE').
- Armature custom props (gripCentreN/F, gripRadius, gripAxis) -> armature node extras.
- Images written as WebP (EXT_texture_webp).
Writes art/characters/<id>/exports/<id>.glb, copies it to public/models/<id>.glb and writes
art/characters/<id>/asset-manifest.json.
"""
import argparse
import json
import os
import shutil
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sd_util as U  # noqa: E402

STRIP = ("owner", "sd_alpha_mode", "sd_alpha_cutoff", "sd_role", "sd_piece", "sd_kind", "sd_ver", "sd_tint_hex")


def op_kwargs(op, kw):
    props = op.get_rna_type().properties.keys()
    return {k: v for k, v in kw.items() if k in props}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", required=True)
    ap.add_argument("--master", default="")
    ap.add_argument("--quality", type=int, default=90)
    a = ap.parse_args(U.args_after_dashes())
    cid = a.char
    cdir = U.char_dir(cid)
    master = a.master or os.path.join(cdir, "%s_anime_master.blend" % cid)
    bpy.ops.wm.open_mainfile(filepath=master)
    for idb in list(bpy.data.objects) + list(bpy.data.materials) + list(bpy.data.meshes) + list(bpy.data.armatures):
        for k in STRIP:
            if k in idb.keys():
                del idb[k]
    low = [o for o in U.col("LOW").objects if o.type == "MESH"]
    arm = next(o for o in U.col("RIG_DEF").objects if o.type == "ARMATURE")
    for ob in low:                                     # COLOR_0 = the outline mask
        ca = ob.data.color_attributes.get("sd_outline")
        if ca is not None:
            ob.data.color_attributes.active_color = ca
            ob.data.color_attributes.render_color_index = list(ob.data.color_attributes).index(ca)
        if ob.data.shape_keys:
            for kb in ob.data.shape_keys.key_blocks[1:]:
                kb.value = 0.0
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in low + [arm]:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    out = os.path.join(cdir, "exports")
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, cid + ".glb")
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
              export_animations=False, export_skins=True, export_def_bones=True, export_morph=True,
              export_morph_normal=False, export_texcoords=True, export_normals=True, export_materials="EXPORT",
              export_image_format="WEBP", export_image_quality=a.quality, export_extras=True,
              export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_cameras=False,
              export_lights=False, export_rest_position_armature=True, export_try_sparse_sk=False)
    bpy.ops.export_scene.gltf(**op_kwargs(bpy.ops.export_scene.gltf, kw))
    dst = os.path.join(U.REPO, "public", "models")
    os.makedirs(dst, exist_ok=True)
    shutil.copyfile(path, os.path.join(dst, cid + ".glb"))
    tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in low}
    manifest = {"asset": cid, "pipeline": "v5 anime (VRoid CC0 base)", "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "blender": bpy.app.version_string, "source": master.replace("\\", "/"),
                "file": "public/models/%s.glb" % cid, "bytes": os.path.getsize(path),
                "triangles": tris, "triangles_total": sum(tris.values()),
                "materials": sorted({m.name for o in low for m in o.data.materials if m}),
                "morphs": {o.name: [k.name for k in o.data.shape_keys.key_blocks[1:]] for o in low if o.data.shape_keys},
                "armature_extras": {k: (list(v) if hasattr(v, "__len__") and not isinstance(v, str) else v)
                                    for k, v in arm.items()},
                "units": {"up": "Y (glTF)", "forward": "game +x", "scale": 1.0}}
    U.write_json(os.path.join(cdir, "asset-manifest.json"), manifest)
    U.log("EXPORTED", path, os.path.getsize(path), "bytes", manifest["triangles_total"], "tris")


if __name__ == "__main__":
    main()
