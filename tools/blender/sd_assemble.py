"""PHASE 06 ASSEMBLE: the delivery geometry a fighter is baked and exported from.

  python tools/blender/run.py tools/blender/sd_assemble.py -- --char kael [--res-json build/bake_plan.json]

Opens <id>_master.blend (left untouched) and writes build/cache/<id>_assembled.blend:
1. Body: the skin the costume hides (the master's sd_coverage Mask modifier over the sd_visible group) is deleted for
   real, shape keys (palmOpen) kept; the Mask modifier and the group go.
2. One mesh per material: costume pieces joined by contract material into GEO-<id>_<role> (primary, secondary, trim,
   leather, metal); hair cards and beard into GEO-<id>_hair (MAT-hair). Eyes, body, brows and lashes stay separate
   (the runtime alpha-blends meshes named /brow|lash/ and cuts out the other MAT-hair cards).
   Vertex groups merge by name, the Armature modifier of the first piece is kept (all pieces share ARM-<id>).
3. UVs: each joined costume mesh is smart-unwrapped (uniform texel density, 66 deg islands) and packed, so its
   material can be baked into one non-overlapping UV set.
4. The HIGH garments from sd_drape are joined per material into GEO-<id>_<role>_high (HIGH collection), the
   selected-to-active bake source for normal, AO, base colour and roughness.
Deterministic (no randomness).
"""
import argparse
import math
import json
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sd_cloth as K  # noqa: E402
import sd_contract as C  # noqa: E402
import sd_util as U  # noqa: E402

PHASE = "06_assemble"
ROLES = ("primary", "secondary", "trim", "leather", "metal")
REPORT = {}


def cut_hidden_skin(body):
    """Delete body vertices outside sd_visible (keeps shape keys: bmesh carries the key layers)."""
    vg = body.vertex_groups.get("sd_visible")
    if vg is None:
        return 0
    vis = set()
    for v in body.data.vertices:
        for g in v.groups:
            if g.group == vg.index and g.weight > 0.5:
                vis.add(v.index)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    kill = [v for v in bm.verts if v.index not in vis]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bmesh.ops.delete(bm, geom=[e for e in bm.edges if not e.link_faces], context="EDGES")   # no wire edges
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()
    for m in [m for m in body.modifiers if m.type == "MASK"]:
        body.modifiers.remove(m)
    body.vertex_groups.remove(vg)
    return len(kill)


def joint_uv(objs, angle=66.0, margin=0.004):
    """Smart-unwrap several meshes into ONE shared UV layout (multi-object edit mode): uniform texel density and
    non-overlapping islands across all of a material's pieces."""
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    rims = {o.name: rim_faces(o) for o in objs}
    for o in objs:                                   # unwrap the shells only; rims are collapsed afterwards
        for p in o.data.polygons:
            p.select = p.index not in rims[o.name]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    try:
        bpy.ops.uv.pack_islands(margin=0.003, rotate=True, shape_method="CONCAVE")
    except TypeError:
        bpy.ops.uv.pack_islands(margin=0.003, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in objs:
        REPORT.setdefault("rim_faces", {})[o.name] = collapse_rim_uvs(o, rims[o.name])
        g = o.vertex_groups.get("sd_rim")
        if g is not None:
            o.vertex_groups.remove(g)


def rim_faces(ob):
    """Faces generated as solidify rims (every vertex in the sd_rim group)."""
    g = ob.vertex_groups.get("sd_rim")
    if g is None:
        return set()
    rim_v = set()
    for v in ob.data.vertices:
        for e in v.groups:
            if e.group == g.index and e.weight > 0.5:
                rim_v.add(v.index)
    return {p.index for p in ob.data.polygons if all(i in rim_v for i in p.vertices)}


def collapse_rim_uvs(ob, rims):
    """Rim strips (2-4 mm edge thickness) take the UV of the nearest shell corner: zero UV area, so they never
    get islands of their own (no confetti in the bake) and they sample their garment edge's texels."""
    from mathutils import kdtree
    me = ob.data
    uv = me.uv_layers.active.data
    shell = [(li, me.vertices[me.loops[li].vertex_index].co.copy()) for p in me.polygons if p.index not in rims
             for li in p.loop_indices]
    if not shell or not rims:
        return 0
    kd = kdtree.KDTree(len(shell))
    for k, (li, co) in enumerate(shell):
        kd.insert(co, k)
    kd.balance()
    for pi in rims:
        for li in me.polygons[pi].loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            _, k, _ = kd.find(co)
            uv[li].uv = uv[shell[k][0]].uv
    return len(rims)


def unify_uv_name(ob, name="UVMap"):
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name=name)
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[-1])
    me.uv_layers[0].name = name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", required=True)
    a = ap.parse_args(U.args_after_dashes())
    cid = a.char
    cdir = U.char_dir(cid)
    master = os.path.join(cdir, "%s_master.blend" % cid)
    out = os.path.join(cdir, "build", "cache", "%s_assembled.blend" % cid)
    plan = json.load(open(os.path.join(cdir, "build", "bake_plan.json")))
    bpy.ops.wm.open_mainfile(filepath=master)
    mats = C.material_names(cid)
    low = [o for o in U.col("LOW").objects if o.type == "MESH"]
    body = bpy.data.objects["GEO-%s_body" % cid]
    REPORT["skin_verts_cut"] = cut_hidden_skin(body)

    # costume pieces stay separate for the bake (each bakes only from its own HIGH twin, so layered cloth never
    # catches another layer's surface) but share one UV layout per material, unwrapped together
    by_mat = {}
    for o in low:
        if o is body or not o.data.materials:
            continue
        by_mat.setdefault(o.data.materials[0].name, []).append(o)
    groups = {}
    for role in ROLES:
        objs = sorted(by_mat.get(mats[role], []), key=lambda o: o.name)
        if not objs:
            continue
        for o in objs:
            unify_uv_name(o)
            bm = bmesh.new()
            bm.from_mesh(o.data)
            ng = [f for f in bm.faces if len(f.verts) > 4]
            if ng:
                bmesh.ops.triangulate(bm, faces=ng)
            bm.to_mesh(o.data)
            bm.free()
            o.data.update()
        joint_uv(objs)
        groups["GEO-%s_%s" % (cid, role)] = [o.name for o in objs]
        for o in objs:
            hi = bpy.data.objects.get(o.name + "_high")
            if hi is not None:
                hi.hide_render = False
                hi.hide_viewport = False
    # hair cards + beard join; brows and lashes stay separate meshes: the runtime finds them by name (/brow|lash/)
    # and renders them soft alpha-blended, while the cards are cutout with depth write
    hair = sorted([o for o in by_mat.get(mats["hair"], []) if not any(k in o.name.lower() for k in ("brow", "lash"))],
                  key=lambda o: o.name)
    if len(hair) > 1:
        hair_main = next(o for o in hair if o.name == "GEO-%s_hair" % cid)
        hair = [hair_main] + [o for o in hair if o is not hair_main]
        for o in hair:
            unify_uv_name(o)
        K.join(hair, "GEO-%s_hair" % cid)
    U.write_json(os.path.join(cdir, "build", "cache", "%s_groups.json" % cid), groups)
    REPORT["groups"] = {k: len(v) for k, v in groups.items()}
    REPORT["tris_by_material"] = {k: sum(K.tris(bpy.data.objects[n]) for n in v) for k, v in groups.items()}

    for o in bpy.data.objects:
        if o.type == "MESH" and "owner" in o.keys():
            del o["owner"]
    REPORT["objects"] = {o.name: {"tris": K.tris(o), "material": o.data.materials[0].name if o.data.materials else None}
                         for o in U.col("LOW").objects if o.type == "MESH"}
    REPORT["tris_total"] = sum(v["tris"] for v in REPORT["objects"].values())
    REPORT["materials"] = sorted({v["material"] for v in REPORT["objects"].values()})
    U.write_json(os.path.join(cdir, "review", PHASE, "assemble_report.json"), REPORT)
    U.log("ASSEMBLED", REPORT["tris_total"], "tris", len(REPORT["materials"]), "materials", REPORT["objects"])
    U.save(out)


if __name__ == "__main__":
    main()
