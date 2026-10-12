"""PHASE 04b DRAPE: cloth-simulated HIGH garments and the LOW delivery garments derived from them.

  python tools/blender/run.py tools/blender/sd_drape.py -- --char kael

Runs after the costume phase (which leaves single-layer base pieces with weights, materials and an "sd_thick"
property). For every piece in the costume module's DRAPE spec, inner layers first:
1. HIGH = the base piece subdivided (Catmull-Clark, 4-16x the density).
2. Cloth simulation (Blender cloth, headless, deterministic): pinned per piece (shoulders, waist band, sleeve
   tops, skirt waistband...), gravity, a little extra cloth (negative shrink) so the excess gathers into folds,
   colliding with the body and with the inner garments already draped.
3. Crease detail: deterministic Perlin displacement along the normal (anisotropic, masked), e.g. compression
   wrinkles round the sash and the boot ankles.
4. LOW = the HIGH decimated to the piece's triangle budget (keeps the big folds in the silhouette), skin weights
   transferred from the base piece, attributes (sd_shade / sd_tone) carried through.
Then collar bands and tabards are built on the draped tunic (and draped over it), every piece gets its
thickness (solidify; rim-only for single-layer cloth), skin coverage is recomputed against the draped garments,
and the HIGH set is kept in the HIGH collection (hidden from renders) for the bake (normal + AO + colour).
"""
import argparse
import importlib
import json
import math
import os
import sys
import time

import bmesh
import bpy
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sd_cloth as K  # noqa: E402
import sd_util as U  # noqa: E402

PHASE = "04b_drape"
TAG = "phase:" + PHASE
REPORT = {"pieces": {}}


# ------------------------------------------------------------------------------------------------ helpers
def copy_object(src, name, collection):
    ob = src.copy()
    ob.data = src.data.copy()
    ob.name = ob.data.name = name
    for m in list(ob.modifiers):
        ob.modifiers.remove(m)
    ob.parent = None
    ob.matrix_world = src.matrix_world.copy()
    U.col(collection).objects.link(ob)
    return ob


def subdivide(ob, levels, simple=False):
    if levels <= 0:
        return
    m = ob.modifiers.new("sub", "SUBSURF")
    m.levels = m.render_levels = levels
    m.subdivision_type = "SIMPLE" if simple else "CATMULL_CLARK"
    m.boundary_smooth = "PRESERVE_CORNERS"
    K.apply_modifiers(ob)


def pin_group(ob, fn, name="sd_pin"):
    g = ob.vertex_groups.get(name) or ob.vertex_groups.new(name=name)
    boundary = set()
    if fn is None:
        return g
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for e in bm.edges:
        if e.is_boundary:
            boundary.update(v.index for v in e.verts)
    bm.free()
    n = 0
    for v in ob.data.vertices:
        w = fn(v.co, v.index in boundary)
        if w > 0.0:
            g.add([v.index], min(1.0, w), "REPLACE")
            n += 1
    return g


def set_collider(ob, on, outer=0.003, inner=0.008):
    m = next((m for m in ob.modifiers if m.type == "COLLISION"), None)
    if on and m is None:
        ob.modifiers.new("sd_collide", "COLLISION")
        ob.collision.thickness_outer = outer
        ob.collision.thickness_inner = inner
        ob.collision.cloth_friction = 5.0
        ob.collision.damping = 0.5
    elif not on and m is not None:
        ob.modifiers.remove(m)


def simulate(ob, sim, colliders):
    """Run the cloth sim on ob (frames 1..n) against colliders and bake the last frame into its mesh."""
    for c in colliders:
        set_collider(c, True, sim.get("collide_outer", 0.003))
    cl = ob.modifiers.new("cloth", "CLOTH")
    s = cl.settings
    s.quality = sim.get("quality", 6)
    s.mass = sim.get("mass", 0.2)
    s.tension_stiffness = s.compression_stiffness = sim.get("stiffness", 12.0)
    s.shear_stiffness = sim.get("shear", 4.0)
    s.bending_stiffness = sim.get("bending", 0.4)
    s.air_damping = sim.get("air", 2.0)
    s.vertex_group_mass = "sd_pin"
    s.pin_stiffness = sim.get("pin_stiffness", 2.0)
    s.shrink_min = sim.get("shrink", 0.0)
    cs = cl.collision_settings
    cs.distance_min = sim.get("distance", 0.003)
    cs.collision_quality = sim.get("collision_quality", 3)
    cs.use_self_collision = sim.get("self", False)
    if cs.use_self_collision:
        cs.self_distance_min = 0.002
    sc = bpy.context.scene
    frames = sim.get("frames", 50)
    sc.frame_start, sc.frame_end = 1, frames
    cl.point_cache.frame_start, cl.point_cache.frame_end = 1, frames
    for f in range(1, frames + 1):
        sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.remove(cl)
    ob.data = me
    me.name = old.name
    bpy.data.meshes.remove(old)
    sc.frame_set(1)
    for c in colliders:
        set_collider(c, False)


def crease(ob, spec):
    """Deterministic Perlin creases along the vertex normal: spec = {amp, scale: (sx, sy, sz), mask: fn(co),
    ridged: bool}. Anisotropic scale makes folds run along the long axis (e.g. horizontal sash wrinkles)."""
    me = ob.data
    me.update()
    sx, sy, sz = spec["scale"]
    amp = spec["amp"]
    off = Vector(spec.get("offset", (3.1, 7.7, 1.3)))
    mask = spec.get("mask")
    for v in me.vertices:
        m = mask(v.co) if mask else 1.0
        if m <= 0:
            continue
        q = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz)) + off
        n = noise.noise(q, noise_basis="PERLIN_ORIGINAL")
        n2 = 0.5 * noise.noise(q * 2.13 + off, noise_basis="PERLIN_ORIGINAL")
        h = n + n2
        if spec.get("ridged"):
            h = 0.6 - abs(h)
        v.co += v.normal * (h * amp * m)
    me.update()


def hem_distance(ob):
    """Geodesic distance (m) of every vertex to the piece's open boundary (hems, cuffs, cut edges): Dijkstra over
    the edges from all boundary vertices."""
    import heapq
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    dist = [math.inf] * len(bm.verts)
    heap = []
    for e in bm.edges:
        if e.is_boundary:
            for v in e.verts:
                if dist[v.index] > 0:
                    dist[v.index] = 0.0
                    heap.append((0.0, v.index))
    heapq.heapify(heap)
    while heap:
        d, i = heapq.heappop(heap)
        if d > dist[i] or d > 0.08:
            continue
        v = bm.verts[i]
        for e in v.link_edges:
            j = e.other_vert(v).index
            nd = d + e.calc_length()
            if nd < dist[j]:
                dist[j] = nd
                heapq.heappush(heap, (nd, j))
    bm.free()
    return dist


def surface_attributes(ob, seams=()):
    """Look-dev attributes on a HIGH garment for the bake: sd_hem (1 at hems/cuffs fading to 0 at 6 cm: dirt and
    wear), sd_seam (2 mm seam groove profile on the piece's seam planes), sd_stitch (dashed topstitch rows 4 mm
    either side of the seams and 12 mm in from every hem)."""
    me = ob.data
    dist = hem_distance(ob)
    hem, seam, stitch = [], [], []
    for v, d in zip(me.vertices, dist):
        p = v.co
        hem.append(1.0 - U.smoothstep(0.0, 0.06, d) if d < math.inf else 0.0)
        g, st = 0.0, 0.0
        dash = 0.5 + 0.5 * math.sin((p.x * 0.3 + p.y * 0.7 + p.z) * 2 * math.pi / 0.0045)
        dash = U.smoothstep(0.3, 0.7, dash)
        for P, N, region in seams:
            if region is not None and not region(p):
                continue
            sd = abs((p - Vector(P)).dot(Vector(N).normalized()))
            g = max(g, 1.0 - U.smoothstep(0.0, 0.0022, sd))
            st = max(st, (1.0 - U.smoothstep(0.0006, 0.0012, abs(sd - 0.004))) * dash)
        if d < math.inf:
            st = max(st, (1.0 - U.smoothstep(0.0006, 0.0012, abs(d - 0.012))) * dash)
        seam.append(g)
        stitch.append(st)
    for name, vals in (("sd_hem", hem), ("sd_seam", seam), ("sd_stitch", stitch)):
        a = me.attributes.get(name) or me.attributes.new(name, "FLOAT", "POINT")
        a.data.foreach_set("value", vals)


def decimate_to(ob, tris):
    cur = K.tris(ob)
    if tris and cur > tris:
        m = ob.modifiers.new("dec", "DECIMATE")
        m.ratio = max(0.01, tris / cur)
        m.use_collapse_triangulate = False
        K.apply_modifiers(ob)
    for p in ob.data.polygons:
        p.use_smooth = True


def thicken(ob, spec):
    if not spec:
        return
    th, off, rim_only = spec
    if "sd_rim" not in ob.vertex_groups:
        ob.vertex_groups.new(name="sd_rim")
    s = ob.modifiers.new("thick", "SOLIDIFY")
    s.rim_vertex_group = "sd_rim"                 # sd_assemble collapses the rim strips' UVs onto the island edges
    s.thickness = th
    s.offset = off
    s.use_rim = True
    s.use_rim_only = bool(rim_only)
    s.use_even_offset = False                 # even offset spikes at the sharp corners of folds and cuts
    s.thickness_clamp = 1.0                   # never offset further than the local edge length allows
    s.use_quality_normals = True
    K.apply_modifiers(ob)


def attach(ob, arm):
    ob.parent = arm
    m = ob.modifiers.new("Armature", "ARMATURE")
    m.object = arm


# ------------------------------------------------------------------------------------------------ main
def drape_piece(ent, base, arm, colliders, high_col="HIGH"):
    t0 = time.time()
    hi = copy_object(base, base.name + "_high", high_col)
    for g in list(hi.vertex_groups):
        hi.vertex_groups.remove(g)
    subdivide(hi, ent.get("subdiv", 1), ent.get("simple", False))
    if ent.get("sim"):
        pin_group(hi, ent.get("pin"))
        before = [v.co.copy() for v in hi.data.vertices]
        simulate(hi, ent["sim"], colliders)
        moved = max((v.co - b).length for v, b in zip(hi.data.vertices, before))
        if moved > ent["sim"].get("max_move", 0.15):          # unstable sim: keep the undraped shape, say so
            U.log("DRAPE WARNING", base.name, "sim moved a vertex %.2f m: discarded" % moved)
            for v, b in zip(hi.data.vertices, before):
                v.co = b
            REPORT.setdefault("sim_discarded", []).append(base.name)
        REPORT.setdefault("max_move", {})[base.name] = round(moved, 4)
    subdivide(hi, ent.get("post_subdiv", 0))
    for c in ent.get("creases", []):
        crease(hi, c)
    hi.data.update()
    if ent.get("cloth", True):
        surface_attributes(hi, ent.get("seams", ()))
    for p in hi.data.polygons:
        p.use_smooth = True
    lo = copy_object(base if ent.get("keep_low") else hi, base.name + "_low", "LOW")
    lo.hide_render = False
    decimate_to(lo, ent.get("low_tris"))
    K.transfer_weights(lo, base)
    K.normalize_limit(lo)
    for k in ("sd_piece", "sd_thick"):
        if k in base.keys():
            lo[k] = base[k]
            hi[k] = base[k]
    name = base.name
    U.remove_object(base)
    lo.name = lo.data.name = name
    attach(lo, arm)
    hi.hide_render = True
    REPORT["pieces"][name] = {"high_tris": K.tris(hi), "low_tris": K.tris(lo), "seconds": round(time.time() - t0, 1)}
    U.log("DRAPE", name, REPORT["pieces"][name])
    return lo, hi


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", required=True)
    ap.add_argument("--master", default="", help="master .blend to work on (default <id>_master.blend; the anime "
                                                 "pipeline passes <id>_anime_master.blend)")
    ap.add_argument("--only", default="", help="comma list of pieces to drape (debug); others keep their base")
    a = ap.parse_args(U.args_after_dashes())
    cdir = U.char_dir(a.char)
    master = a.master or os.path.join(cdir, "%s_master.blend" % a.char)
    CK = importlib.import_module("sd_costume_%s" % a.char)
    bpy.ops.wm.open_mainfile(filepath=master)
    for o in [o for o in bpy.data.objects if o.name.endswith("_high") and "HIGH" in [c.name for c in o.users_collection]]:
        U.remove_object(o)
    body = bpy.data.objects["GEO-%s_body" % a.char]
    arm = bpy.data.objects["ARM-%s" % a.char]
    masks = [m for m in body.modifiers if m.type == "MASK"]
    for m in masks:
        m.show_viewport = m.show_render = False
    W = K.vertex_weights(body)
    high = {}
    only = set(a.only.split(",")) if a.only else None
    spec = CK.drape_spec()
    for ent in spec["pieces"]:
        base = bpy.data.objects.get(ent["name"])
        if base is None or (only and ent["name"] not in only):
            continue
        cols = [body] + [high[n] for n in ent.get("colliders", []) if n in high] + \
               [bpy.data.objects[n] for n in ent.get("colliders_low", []) if n in bpy.data.objects]
        lo, hi = drape_piece(ent, base, arm, cols)
        high[ent["name"]] = hi
    # collar bands and tabards on the draped tunic, draped in turn
    extra = CK.drape_extras(high, body, W, arm, drape_piece) if hasattr(CK, "drape_extras") else []
    # thickness, LOW and HIGH alike
    for ob in [o for o in bpy.data.objects if o.type == "MESH" and "sd_thick" in o.keys()]:
        thicken(ob, list(ob["sd_thick"]))
        del ob["sd_thick"]
    # coverage against the draped LOW garments
    for m in masks:
        m.show_viewport = m.show_render = True
    garments = [o for o in U.col("LOW").objects if o.type == "MESH" and o.get("sd_piece") in spec["coverage_roles"]]
    REPORT["visible_body_verts"] = CK.coverage(body, W, garments)
    REPORT["tris_low"] = sum(K.tris(o) for o in U.col("LOW").objects if o.type == "MESH" and o.get("sd_piece"))
    REPORT["tris_high"] = sum(K.tris(o) for o in U.col("HIGH").objects if o.type == "MESH")
    U.write_json(os.path.join(cdir, "review", PHASE, "drape_report.json"), REPORT)
    U.log("DRAPED", json.dumps({k: v for k, v in REPORT.items() if k != "pieces"}))
    U.save(master)


if __name__ == "__main__":
    main()
