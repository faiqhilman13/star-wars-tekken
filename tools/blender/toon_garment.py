"""Garment helpers for the anime (v5) costume scripts: split / clean authored VRoid clothing, simple clean pieces
(bands, panels, thick sheets, rounded boxes), weights, UV atlases and painted (flat colour + one gradient) textures.

Frame: the character faces +X, up +Z, the right side ("N") is -Y. Azimuths here are measured from +X toward +Y
(the character's left, "F"), in degrees.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

import sd_contract as C
import sd_util as U


def lin(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def enc(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def hexlin(h):
    return np.array(C.hex_to_linear(h)[:3])


def ss(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=float) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def az_dir(az):
    a = math.radians(az)
    return Vector((math.cos(a), math.sin(a), 0.0))


# ------------------------------------------------------------------------------------------------ mesh editing
def split_by_material(ob, keys, collection="COSTUME_SRC"):
    """{key: new object holding the polygons whose material name contains key} (copies; ob untouched)."""
    out = {}
    for key in keys:
        idx = [i for i, m in enumerate(ob.data.materials) if m and key in m.name]
        if not idx:
            continue
        cp = ob.copy()
        cp.data = ob.data.copy()
        cp.name = cp.data.name = "%s_%s" % (ob.name, key.lower())
        U.col(collection).objects.link(cp)
        bm = bmesh.new()
        bm.from_mesh(cp.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index not in idx], context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(cp.data)
        bm.free()
        out[key] = cp
    return out


def face_islands(me):
    """Polygon islands (lists of polygon indices) connected through shared edges."""
    edge_faces = {}
    for p in me.polygons:
        for ek in p.edge_keys:
            edge_faces.setdefault(ek, []).append(p.index)
    seen, out = set(), []
    for p in me.polygons:
        if p.index in seen:
            continue
        stack, comp = [p.index], []
        seen.add(p.index)
        while stack:
            f = stack.pop()
            comp.append(f)
            for ek in me.polygons[f].edge_keys:
                for g in edge_faces[ek]:
                    if g not in seen:
                        seen.add(g)
                        stack.append(g)
        out.append(comp)
    return out


def delete_faces(ob, faces):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in set(faces)], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def coords(ob):
    a = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
    ob.data.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


def set_coords(ob, P):
    ob.data.vertices.foreach_set("co", np.asarray(P, dtype=np.float32).ravel())
    ob.data.update()


def attr(ob, name):
    a = ob.data.attributes.get(name)
    if a is None:
        return np.zeros(len(ob.data.vertices))
    v = np.empty(len(a.data), dtype=np.float64)
    a.data.foreach_get("value", v)
    return v


def weights(ob):
    """Per-vertex {group name: weight}."""
    gi = {g.index: g.name for g in ob.vertex_groups}
    return [{gi[g.group]: g.weight for g in v.groups if g.weight > 0.0} for v in ob.data.vertices]


def group_share(W, names):
    return np.array([sum(w.get(n, 0.0) for n in names) / max(sum(w.values()), 1e-9) for w in W])


def set_weights(ob, W, top=4, min_w=0.01):
    """Replace ob's vertex groups by the dicts W (normalised, <= top influences)."""
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    groups = {}
    for vi, w in enumerate(W):
        items = sorted(((k, x) for k, x in w.items() if x > min_w), key=lambda t: -t[1])[:top]
        tot = sum(x for _, x in items) or 1.0
        for k, x in items:
            g = groups.get(k) or ob.vertex_groups.new(name=k)
            groups[k] = g
            g.add([vi], x / tot, "REPLACE")


def blend_w(a, b, t):
    out = {}
    for k, x in a.items():
        out[k] = out.get(k, 0.0) + x * (1 - t)
    for k, x in b.items():
        out[k] = out.get(k, 0.0) + x * t
    return out


class NearestWeights:
    """Weights of the nearest vertices of a skinned reference mesh (inverse-distance blend of k)."""

    def __init__(self, ob, keep=None):
        self.W = weights(ob)
        P = coords(ob)
        self.ids = [i for i in range(len(P)) if keep is None or keep(i, P[i], self.W[i])]
        self.kd = KDTree(len(self.ids))
        for k, i in enumerate(self.ids):
            self.kd.insert(Vector(P[i]), k)
        self.kd.balance()

    def __call__(self, p, k=4):
        acc, tot = {}, 0.0
        for _, idx, d in self.kd.find_n(Vector(p), k):
            w = 1.0 / max(d, 1e-4)
            tot += w
            for g, x in self.W[self.ids[idx]].items():
                acc[g] = acc.get(g, 0.0) + x * w
        return {g: x / tot for g, x in acc.items()}


def bvh_of(objs, poly_ok=None):
    verts, polys = [], []
    for ob in objs:
        me = ob.data
        base = len(verts)
        verts += [tuple(v.co) for v in me.vertices]
        polys += [tuple(base + i for i in p.vertices) for p in me.polygons if poly_ok is None or poly_ok(ob, p)]
    return BVHTree.FromPolygons(verts, polys)


def radius_at(bvh, axis_xy, z, az, r_out=0.6):
    """Outer surface distance from the vertical axis at (axis_xy, z) toward azimuth az (ray from outside)."""
    d = az_dir(az)
    o = Vector((axis_xy[0], axis_xy[1], z))
    hit = bvh.ray_cast(o + d * r_out, -d, r_out)[0]
    return None if hit is None else (Vector((hit.x, hit.y, 0)) - Vector((axis_xy[0], axis_xy[1], 0))).length


# ------------------------------------------------------------------------------------------------ building
class MeshBuilder:
    """Accumulates quads with UVs, per-vertex weights / outline values and a material key; build() makes the
    object."""

    def __init__(self):
        self.P, self.F, self.UV, self.MAT, self.W, self.OL = [], [], [], [], [], []

    def grid(self, G, mat, uv_rect, wfn, ol=1.0, closed_u=False, flip=False, uv_fn=None, N=None):
        """G: (nu, nv, 3) points. Quads wound to face along N (vertex normals, if given; flip reverses that), UV
        (u, v) -> rect."""
        nu, nv = G.shape[0], G.shape[1]
        if N is not None:                                   # auto winding: the quad normal must agree with N
            i, j = nu // 2, nv // 2
            i2 = min(i + 1, nu - 1) if not closed_u else (i + 1) % nu
            qn = np.cross(G[i2, j] - G[i, j], G[i, min(j + 1, nv - 1)] - G[i, j])
            if np.dot(qn, N[i, j]) < 0:
                flip = not flip
        base = len(self.P)
        for i in range(nu):
            for j in range(nv):
                p = G[i, j]
                self.P.append(tuple(p))
                self.W.append(wfn(i, j, p))
                self.OL.append(ol(i, j, p) if callable(ol) else ol)
        u0, v0, u1, v1 = uv_rect
        for i in range(nu if closed_u else nu - 1):
            i2 = (i + 1) % nu
            for j in range(nv - 1):
                q = [(i, j), (i2, j), (i2, j + 1), (i, j + 1)]
                if flip:
                    q = q[::-1]
                self.F.append([base + a * nv + b for a, b in q])
                uvs = []
                for a, b in q:
                    ua = (a if not (closed_u and a == 0 and i == nu - 1) else nu) / (nu if closed_u else nu - 1)
                    vb = b / (nv - 1)
                    if uv_fn:
                        ua, vb = uv_fn(ua, vb)
                    uvs.append((u0 + (u1 - u0) * ua, v1 - (v1 - v0) * vb))
                self.UV.append(uvs)
                self.MAT.append(mat)
        return base

    def thick(self, G, N, t, mat, rect_out, rect_in, rect_rim, wfn, ol=1.0, closed_u=False, rim_v=(True, True),
              rim_u=True, uv_fn=None):
        """Thick sheet: G is the inner surface, N its outward normals (nu, nv, 3): outer = G + N t."""
        outer = G + N * t
        self.grid(outer, mat, rect_out, wfn, ol, closed_u, uv_fn=uv_fn, N=N)
        self.grid(G, mat, rect_in, wfn, ol, closed_u, uv_fn=uv_fn, N=-N)
        nu, nv = G.shape[0], G.shape[1]
        rims = []
        if rim_v[0]:
            rims.append([(G[i, 0], outer[i, 0]) for i in range(nu)] + ([(G[0, 0], outer[0, 0])] if closed_u else []))
        if rim_v[1]:
            rims.append([(outer[i, nv - 1], G[i, nv - 1]) for i in range(nu)] +
                        ([(outer[0, nv - 1], G[0, nv - 1])] if closed_u else []))
        if rim_u and not closed_u:
            rims.append([(outer[0, j], G[0, j]) for j in range(nv)])
            rims.append([(G[nu - 1, j], outer[nu - 1, j]) for j in range(nv)])
        for strip in rims:
            R = np.array([[a, b] for a, b in strip])
            self.grid(R, mat, rect_rim, lambda i, j, p: wfn(0, 0, p), ol)

    def build(self, name, collection="LOW"):
        me = bpy.data.meshes.new(name)
        me.from_pydata([Vector(p) for p in self.P], [], self.F)
        me.update()
        uvl = me.uv_layers.new(name="UVMap")
        k = 0
        for poly, uvs in zip(me.polygons, self.UV):
            for li, uv in zip(poly.loop_indices, uvs):
                uvl.data[li].uv = uv
        ob = bpy.data.objects.new(name, me)
        U.col(collection).objects.link(ob)
        for p in me.polygons:
            p.use_smooth = True
        set_weights(ob, self.W)
        ol = me.attributes.new("sd_ol", "FLOAT", "POINT")
        ol.data.foreach_set("value", [float(x) for x in self.OL])
        ob["sd_mats"] = list(self.MAT)
        return ob


def grid_normals(G, outward=None, closed_u=False):
    """Vertex normals of a (nu, nv, 3) grid, flipped to agree with outward(p) (a direction function)."""
    du = np.gradient(G, axis=0)
    if closed_u:
        du = (np.roll(G, -1, axis=0) - np.roll(G, 1, axis=0)) * 0.5
    dv = np.gradient(G, axis=1)
    N = np.cross(du, dv)
    N /= np.maximum(np.linalg.norm(N, axis=2, keepdims=True), 1e-9)
    if outward is not None:
        o = np.array([[outward(G[i, j]) for j in range(G.shape[1])] for i in range(G.shape[0])])
        sgn = np.sign(np.sum(N * o, axis=2, keepdims=True))
        sgn[sgn == 0] = 1
        N = N * sgn
    return N


def rounded_box(size, centre, rot_z=0.0, bevel=0.004, segments=2):
    """(verts, faces) of a bevelled box (size: x, y, z) at centre, turned rot_z degrees about Z."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=bevel, segments=segments, affect="EDGES",
                    profile=0.5)
    M = (bpy_matrix_rot_z(rot_z))
    for v in bm.verts:
        v.co = M @ v.co + Vector(centre)
    verts = [tuple(v.co) for v in bm.verts]
    bm.verts.index_update()
    faces = [[v.index for v in f.verts] for f in bm.faces]
    normals = [tuple(f.normal) for f in bm.faces]
    bm.free()
    return verts, faces, normals


def bpy_matrix_rot_z(deg):
    from mathutils import Matrix
    return Matrix.Rotation(math.radians(deg), 3, "Z")


def add_box(mb, size, centre, rot_z, mat, rect, w, ol=0.6, bevel=0.004):
    """A rounded box into the builder; UVs by planar projection of each face into rect."""
    verts, faces, normals = rounded_box(size, centre, rot_z, bevel)
    base = len(mb.P)
    for p in verts:
        mb.P.append(p)
        mb.W.append(w)
        mb.OL.append(ol)
    c = Vector(centre)
    u0, v0, u1, v1 = rect
    ext = max(size) * 0.6
    for f, n in zip(faces, normals):
        mb.F.append([base + i for i in f])
        n = Vector(n)
        ax = Vector((1, 0, 0)) if abs(n.z) > 0.7 else Vector((0, 0, 1))
        su = n.cross(ax).normalized()
        sv = n.cross(su).normalized()
        uvs = []
        for i in f:
            d = Vector(verts[i]) - c
            uu = 0.5 + d.dot(su) / (2 * ext)
            vv = 0.5 + d.dot(sv) / (2 * ext)
            uvs.append((u0 + (u1 - u0) * min(max(uu, 0), 1), v0 + (v1 - v0) * min(max(vv, 0), 1)))
        mb.UV.append(uvs)
        mb.MAT.append(mat)


# ------------------------------------------------------------------------------------------------ painting
class Canvas:
    """sRGB float canvas (h, w, 4), row 0 = bottom (UV v = 0)."""

    def __init__(self, w, h, fill=(0.5, 0.5, 0.5)):
        self.w, self.h = w, h
        self.px = np.zeros((h, w, 4), dtype=np.float32)
        self.px[..., :3] = enc(np.array(fill))
        self.px[..., 3] = 1.0

    def rect_px(self, rect):
        u0, v0, u1, v1 = rect
        return int(round(u0 * self.w)), int(round(v0 * self.h)), int(round(u1 * self.w)), int(round(v1 * self.h))

    def paint(self, rect, fn):
        """fn(u, v) -> linear rgb (h, w, 3) over the rect, u across 0..1, v top (0) -> bottom (1) of the rect
        (the builders' convention: v grows downward in garment space)."""
        x0, y0, x1, y1 = self.rect_px(rect)
        w, h = x1 - x0, y1 - y0
        u = (np.arange(w) + 0.5) / w
        v = 1.0 - (np.arange(h) + 0.5) / h
        Uu, Vv = np.meshgrid(u, v)
        self.px[y0:y1, x0:x1, :3] = enc(fn(Uu, Vv))

    def place(self, rect, px):
        """Resample an image (h, w, 4 sRGB) into rect."""
        x0, y0, x1, y1 = self.rect_px(rect)
        self.px[y0:y1, x0:x1] = resample(px, x1 - x0, y1 - y0)


def resample(px, w, h):
    tmp = bpy.data.images.new("_tg_tmp", px.shape[1], px.shape[0], alpha=True)
    tmp.pixels.foreach_set(px.astype(np.float32).ravel())
    tmp.scale(w, h)
    out = np.empty(w * h * 4, dtype=np.float32)
    tmp.pixels.foreach_get(out)
    bpy.data.images.remove(tmp)
    return out.reshape(h, w, 4)


def flat(col_hex, grad=0.0, edge=None, edge_hex=None, edge_w=0.03, line_hex=None, line_at=(), line_w=0.006,
         stitch=None):
    """A painter: flat colour, one vertical shade gradient (darker toward v = 1 by `grad`), an optional edge band
    (edge = "v1" / "v0" / "u" sides) and thin lines at the given v positions; stitch = (v, period) dashes."""
    c = hexlin(col_hex)
    ec = hexlin(edge_hex) if edge_hex is not None else c * 0.7
    lc = hexlin(line_hex) if line_hex is not None else c * 0.55

    def fn(u, v):
        k = (1.0 - grad * v)[..., None]
        out = c[None, None, :] * k
        if edge:
            m = np.zeros_like(u)
            if "v1" in edge:
                m = np.maximum(m, (v > 1 - edge_w).astype(float))
            if "v0" in edge:
                m = np.maximum(m, (v < edge_w).astype(float))
            if "u" in edge:
                m = np.maximum(m, ((u < edge_w) | (u > 1 - edge_w)).astype(float))
            out = out * (1 - m[..., None]) + ec[None, None, :] * k * m[..., None]
        for lv in line_at:
            m = (np.abs(v - lv) < line_w).astype(float)[..., None]
            out = out * (1 - m) + lc[None, None, :] * m
        if stitch:
            sv, period = stitch
            m = ((np.abs(v - sv) < line_w * 0.6) & ((u / period) % 1.0 < 0.55)).astype(float)[..., None]
            out = out * (1 - m) + lc[None, None, :] * m
        return out
    return fn


def recolour_luma(px, dark_hex, lit_hex, lo_pct=2.0, hi_pct=99.0, gamma=1.0):
    """Painted texture -> a ramp dark -> lit over its luminance (authored folds and seams kept, hue replaced)."""
    rgb = px[..., :3]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    a = px[..., 3] > 0.05
    lo, hi = np.percentile(lum[a], lo_pct), np.percentile(lum[a], hi_pct)
    t = np.clip((lum - lo) / max(hi - lo, 1e-4), 0, 1) ** gamma
    d, l_ = hexlin(dark_hex), hexlin(lit_hex)
    out = px.copy()
    out[..., :3] = enc(d[None, None, :] * (1 - t[..., None]) + l_[None, None, :] * t[..., None])
    return out, t


def remap_uv(ob, rect, poly_filter=None):
    """Squeeze ob's UVs (0..1) into rect."""
    me = ob.data
    uv = me.uv_layers.active.data
    u0, v0, u1, v1 = rect
    for p in me.polygons:
        if poly_filter is not None and not poly_filter(p):
            continue
        for li in p.loop_indices:
            x, y = uv[li].uv
            uv[li].uv = (u0 + (u1 - u0) * min(max(x, 0.0), 1.0), v0 + (v1 - v0) * min(max(y, 0.0), 1.0))


def calm_normals(ob, factor=0.55, arm_groups=("upperN", "upperF", "foreN", "foreF", "handN", "handF")):
    """Toon-calm shading normals for authored clothing: blend each corner normal toward the horizontal radial
    direction from the torso axis (arm vertices: from their arm's vertical axis), so the cel terminator draws a
    clean shape instead of catching every small fold (written as custom split normals, exported as glTF normals)."""
    me = ob.data
    me.update()
    W = weights(ob)
    arm = group_share(W, arm_groups)
    ns = []
    for p in me.polygons:
        for li in p.loop_indices:
            vi = me.loops[li].vertex_index
            co = me.vertices[vi].co
            n0 = me.corner_normals[li].vector.copy() if hasattr(me, "corner_normals") else me.loops[li].normal.copy()
            if arm[vi] > 0.5:
                ax = Vector((0.0, 0.19 if co.y > 0 else -0.19))
            else:
                ax = Vector((0.0, 0.0))
            rad = Vector((co.x - ax.x, co.y - ax.y, 0.0))
            if rad.length < 1e-6:
                ns.append(n0)
                continue
            rad.normalize()
            rad.z = n0.z * 0.6
            rad.normalize()
            if rad.dot(n0) < 0:                          # inner faces keep their own direction
                ns.append(n0)
                continue
            ns.append((n0 * (1.0 - factor) + rad * factor).normalized())
    me.normals_split_custom_set(ns)
