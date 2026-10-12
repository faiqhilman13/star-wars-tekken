"""Garment construction helpers for the Saber Duel fighters (bpy + bmesh, headless-safe).

Two construction methods (blender-image-to-3d categories.md section 2 "armour and straps over clothing"):
- shell_from_body: copy a region of the skinned body, offset it along smoothed normals by a per-vertex ease, relax
  it (removes anatomy such as the navel or toes), optionally decimate. The shell keeps the body's topology and
  vertex groups, so it deforms with the skin and never needs a weight transfer.
- ring_loft: sample the body (a filtered BVH) on rays around an axis at stations along it, offset by an ease
  profile, and build a quad grid with (angle, height) UVs. Used for skirts, sleeves, sashes, belts, boot cuffs.
Weights for lofted pieces come from transfer_weights (nearest surface on a filtered source region) or from an
explicit function (skirt panels).
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import sd_contract as C
import sd_util as U


# ------------------------------------------------------------------------------------------------ body queries
def is_skin_group(name):
    return name in C.CORE or name.startswith(("skirt_", "cape_", "hair_", "tail_", "pad_"))


def vertex_weights(ob):
    """[{skin group name: weight}] per vertex (helper groups such as sd_visible are ignored)."""
    names = {g.index: g.name for g in ob.vertex_groups if is_skin_group(g.name)}
    return [{names[g.group]: g.weight for g in v.groups if g.group in names} for v in ob.data.vertices]


def dominant(ws):
    return max(ws.items(), key=lambda kv: kv[1])[0] if ws else None


def region_bvh(body, keep_vertex):
    """BVH (world space) of the body faces whose vertices all pass keep_vertex(index)."""
    mw = body.matrix_world
    co = [mw @ v.co for v in body.data.vertices]
    polys = [tuple(p.vertices) for p in body.data.polygons if all(keep_vertex(i) for i in p.vertices)]
    return BVHTree.FromPolygons(co, polys), co, polys


def outer_radius(bvh, centre, direction, r_out=0.6):
    """Distance from centre to the outermost body surface along direction (ray cast inward from r_out)."""
    o = centre + direction * r_out
    hit = bvh.ray_cast(o, -direction, r_out)
    if hit[0] is None:
        return None
    return (hit[0] - centre).dot(direction)


# ------------------------------------------------------------------------------------------------ shells
def shell_from_body(body, name, keep_face, ease, relax=8, relax_factor=0.5, pin_boundary=False, decimate=None,
                    collection="LOW"):
    """New object from the body faces where keep_face(polygon, verts_world) is True. Every vertex moves along its
    (relaxed) normal by ease(p_world, weights_dict). Returns the object (vertex groups kept, shape keys removed)."""
    me = body.data.copy()
    ob = bpy.data.objects.new(name, me)
    U.col(collection).objects.link(ob)
    ob.matrix_world = body.matrix_world.copy()
    if me.shape_keys:
        ob.shape_key_clear()
    mw = body.matrix_world
    wts = vertex_weights(body)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    kill = [f for f in bm.faces if not keep_face(f, [mw @ v.co for v in f.verts])]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    # offset along normals, then relax the offset surface (keeps the overall form, drops small anatomy)
    dl = bm.verts.layers.deform.active
    names = {g.index: g.name for g in ob.vertex_groups}
    for v in bm.verts:
        w = {names[k]: x for k, x in v[dl].items()} if dl else {}
        v.co = v.co + v.normal * ease(mw @ v.co, w)
    relax_bmesh(bm, relax, relax_factor, pin_boundary)
    bm.to_mesh(me)
    bm.free()
    me.update()
    if decimate:
        dec = ob.modifiers.new("dec", "DECIMATE")
        dec.ratio = decimate
        dec.use_collapse_triangulate = False
        apply_modifiers(ob)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def relax_bmesh(bm, iters, factor=0.5, pin_boundary=False, verts=None):
    vs = verts if verts is not None else list(bm.verts)
    for _ in range(iters):
        new = {}
        for v in vs:
            if pin_boundary and v.is_boundary:
                continue
            nb = [e.other_vert(v) for e in v.link_edges]
            if not nb:
                continue
            avg = sum((n.co for n in nb), Vector()) / len(nb)
            if v.is_boundary:
                bn = [n for n in nb if n.is_boundary]
                if len(bn) >= 2:
                    avg = sum((n.co for n in bn), Vector()) / len(bn)
            new[v] = v.co.lerp(avg, factor)
        for v, c in new.items():
            v.co = c


def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    eo = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(eo, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    me.name = old.name
    bpy.data.meshes.remove(old)


# ------------------------------------------------------------------------------------------------ lofts
def grid_object(name, rows, collection="LOW", uv_rect=(0, 0, 1, 1), closed=False):
    """rows: list of rows, each a list of Vector (same count). Quads between consecutive rows; UV u along a row,
    v down the rows. closed: the last column connects to the first (UVs get a duplicate seam column instead)."""
    bm = bmesh.new()
    nr, nc = len(rows), len(rows[0])
    vs = [[bm.verts.new(p) for p in row] for row in rows]
    uv_l = bm.loops.layers.uv.new("UVMap")
    u0, v0, u1, v1 = uv_rect
    cols = nc if not closed else nc + 1
    for r in range(nr - 1):
        for c in range(cols - 1):
            c2 = (c + 1) % nc
            f = bm.faces.new((vs[r][c], vs[r][c2], vs[r + 1][c2], vs[r + 1][c]))
            uvs = [(c, r), (c + 1, r), (c + 1, r + 1), (c, r + 1)]
            for loop, (cu, rv) in zip(f.loops, uvs):
                loop[uv_l].uv = (u0 + (u1 - u0) * cu / (cols - 1), v1 - (v1 - v0) * rv / (nr - 1))
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    U.col(collection).objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def ensure_outward(ob, centre_fn):
    """Flip faces whose normals point toward centre_fn(face centre) (lofts built in either winding)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    flip = [f for f in bm.faces if f.normal.dot(f.calc_center_median() - centre_fn(f.calc_center_median())) < 0]
    if len(flip) > len(bm.faces) / 2:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
    bm.to_mesh(me)
    bm.free()


def thicken(ob, thickness, offset=-1.0, rim=True):
    """Solidify (applied): real cloth/leather thickness with a rim at open edges."""
    s = ob.modifiers.new("thick", "SOLIDIFY")
    s.thickness = thickness
    s.offset = offset
    s.use_rim = rim
    s.use_even_offset = True
    s.use_quality_normals = True
    apply_modifiers(ob)


# ------------------------------------------------------------------------------------------------ weights
def transfer_weights(dst, src, keep_src_vertex=None, max_inf=4):
    """Copy skin weights from the nearest point of the source surface (optionally restricted to a region) by
    inverse-distance blending of the nearest face's vertices. Replaces dst's vertex groups."""
    bvh, co, polys = region_bvh(src, keep_src_vertex or (lambda i: True))
    sw = vertex_weights(src)
    for g in list(dst.vertex_groups):
        dst.vertex_groups.remove(g)
    groups = {}
    mw = dst.matrix_world
    for v in dst.data.vertices:
        p = mw @ v.co
        loc, nrm, fi, d = bvh.find_nearest(p)
        acc = {}
        if fi is not None:
            vids = polys[fi]
            ws = [1.0 / max(1e-5, (co[i] - loc).length) for i in vids]
            tot = sum(ws)
            for i, w in zip(vids, ws):
                for k, x in sw[i].items():
                    acc[k] = acc.get(k, 0.0) + x * w / tot
        set_weights(dst, v.index, acc, groups, max_inf)


def set_weights(ob, vi, acc, groups=None, max_inf=4, min_w=0.01):
    groups = groups if groups is not None else {}
    items = sorted(((k, w) for k, w in acc.items() if w > 0), key=lambda kv: -kv[1])[:max_inf]
    items = [(k, w) for k, w in items if w >= min_w] or items[:1]
    tot = sum(w for _, w in items) or 1.0
    for k, w in items:
        g = groups.get(k) or ob.vertex_groups.get(k) or ob.vertex_groups.new(name=k)
        groups[k] = g
        g.add([vi], w / tot, "REPLACE")
    return groups


def normalize_limit(ob, max_inf=4, min_w=0.01):
    ws = vertex_weights(ob)
    for g in list(ob.vertex_groups):
        if g.name not in C.CORE and not g.name.startswith(("skirt_", "cape_", "hair_", "tail_", "pad_")):
            ob.vertex_groups.remove(g)
    keep = {g.name for g in ob.vertex_groups}
    groups = {}
    for i, w in enumerate(ws):
        w = {k: x for k, x in w.items() if k in keep}
        for k in list(w.keys()):
            ob.vertex_groups[k].remove([i])
        set_weights(ob, i, w, groups, max_inf, min_w)


# ------------------------------------------------------------------------------------------------ misc
def join(objs, name, collection="LOW"):
    objs = [o for o in objs if o]
    base = objs[0]
    for o in objs[1:]:
        for g in o.vertex_groups:
            if g.name not in base.vertex_groups:
                base.vertex_groups.new(name=g.name)
    ctx = {"active_object": base, "selected_editable_objects": objs, "selected_objects": objs, "object": base}
    with bpy.context.temp_override(**ctx):
        bpy.ops.object.join()
    base.name = name
    base.data.name = name
    U.move_to(base, collection)
    return base


def smart_uv(ob, angle=60.0, margin=0.006, scale_to_bounds=False):
    U.set_active(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, scale_to_bounds=scale_to_bounds)
    bpy.ops.object.mode_set(mode="OBJECT")


def pack_uv(ob, margin=0.004, rotate=True):
    U.set_active(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    try:
        bpy.ops.uv.pack_islands(margin=margin, rotate=rotate, shape_method="CONCAVE")
    except TypeError:
        bpy.ops.uv.pack_islands(margin=margin, rotate=rotate)
    bpy.ops.object.mode_set(mode="OBJECT")


def set_attr(ob, name, values, domain="POINT"):
    a = ob.data.attributes.get(name) or ob.data.attributes.new(name, "FLOAT", domain)
    a.data.foreach_set("value", list(values))


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ------------------------------------------------------------------------------------------------ clean cuts
def cut(ob, planes, remove, region=None):
    """Bisect ob with planes [(point, normal), ...] (only faces passing region(face centre) are cut), then delete
    faces whose centre satisfies remove(centre). Gives straight, clean garment edges instead of the stair steps
    of face selection."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for co, no in planes:
        faces = [f for f in bm.faces if region is None or region(f.calc_center_median())]
        geom = list({e for f in faces for e in f.edges}) + faces + list({v for f in faces for v in f.verts})
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, clear_inner=False, clear_outer=False)
    bm.faces.ensure_lookup_table()
    kill = [f for f in bm.faces if remove(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
    bm.to_mesh(me)
    bm.free()
    me.update()


def bent_axis_loft(name, axis_pts, n_around, radius_fn, collection="LOW", up_hint=Vector((1, 0, 0))):
    """Loft rings along a polyline axis with parallel-transported frames (no twist). radius_fn(i, centre, dir)
    returns the ring point offset along the unit in-plane direction dir. Returns the object (UV: u around,
    v along)."""
    rows = []
    T0 = (axis_pts[1] - axis_pts[0]).normalized()
    N = (up_hint - T0 * up_hint.dot(T0)).normalized()
    prevT = T0
    for i, c in enumerate(axis_pts):
        if i == 0:
            T = T0
        elif i == len(axis_pts) - 1:
            T = (axis_pts[i] - axis_pts[i - 1]).normalized()
        else:
            T = (axis_pts[i + 1] - axis_pts[i - 1]).normalized()
        q = prevT.rotation_difference(T)
        N = (q @ N)
        N = (N - T * N.dot(T)).normalized()
        B = T.cross(N)
        prevT = T
        row = []
        for k in range(n_around):
            a = 2 * math.pi * k / n_around
            d = N * math.cos(a) + B * math.sin(a)
            row.append(c + d * radius_fn(i, c, d))
        rows.append(row)
    return grid_object(name, rows, collection=collection, closed=True)
