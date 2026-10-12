"""Anime costume toolkit for the ASHA / VEXA builds (art/characters/<id>/build/a2_costume.py). bpy + numpy only.

Pieces are authored in the contract frame (faces +X, up +Z, near/right side -Y) around the finished VRoid master
(vroid_finish.py) and end up as skinned meshes on the contract armature:
  * BodyRef        rest body surface: nearest point, smooth normal, interpolated contract weights (weight transfer)
  * MB             mesh builder: verts with weights + outline mask, faces with UVs + material slot
  * sheet()        thick closed sheet from a (nu, nv) mid-surface grid (outer, inner, rims) - panels, straps, plates
  * strap()        band following a path over the body (projected, bridged over concavities, offset)
  * sweep()        tube / clump along a curve with a section profile (hair clumps, rings, ribbons)
  * Canvas         painted toon textures (flat fills, gradients, seams, stitches, wraps) in sRGB
  * body edits     planar cuts, region material reassignment with UV projection, inflation, boundary loops
Everything is deterministic (no random numbers without a fixed seed).
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.join(os.environ.get("SABER_REPO", "."), "tools", "blender"))
import sd_contract as C  # noqa: E402
import sd_util as U  # noqa: E402


def J(name):
    return Vector(C.joint_blender(name))


def smooth01(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=float) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def hexrgb(h):
    return np.array(C.hex_to_srgb(h), dtype=np.float32)


def hexlin(h):
    return np.array(C.hex_to_linear(h)[:3], dtype=np.float32)


def mix(a, b, t):
    return a * (1 - t) + b * t


# ================================================================================================= body reference
class BodyRef:
    """Rest-pose surface of one or more skinned meshes (contract vertex groups) for projection and weight transfer."""

    def __init__(self, objs, names=None, exclude=()):
        """exclude: vertex-group names; triangles touching a vertex dominated by one of them are left out (e.g. the
        arms, so straps and belts near the arms never pick up arm weights or drape onto the arms)."""
        if not isinstance(objs, (list, tuple)):
            objs = [objs]
        self.names = list(names or C.CORE)
        cos, polys, Ws, Ns = [], [], [], []
        off = 0
        for ob in objs:
            me = ob.data
            me.update()
            co = np.array([tuple(v.co) for v in me.vertices], dtype=np.float64)
            nr = np.array([tuple(v.normal) for v in me.vertices], dtype=np.float64)
            W = np.zeros((len(co), len(self.names)))
            idx = {g.index: self.names.index(g.name) for g in ob.vertex_groups if g.name in self.names}
            for v in me.vertices:
                for g in v.groups:
                    j = idx.get(g.group)
                    if j is not None:
                        W[v.index, j] += g.weight
            s = W.sum(axis=1, keepdims=True)
            W = np.divide(W, s, out=np.zeros_like(W), where=s > 1e-9)
            bad = np.zeros(len(co), dtype=bool)
            if exclude:
                ex = [self.names.index(n) for n in exclude if n in self.names]
                if ex:
                    dom = np.argmax(W, axis=1)
                    bad = np.isin(dom, ex) & (W.max(axis=1) > 0)
            for p in me.polygons:
                vs = list(p.vertices)
                if bad[vs].any():
                    continue
                for k in range(1, len(vs) - 1):
                    polys.append((vs[0] + off, vs[k] + off, vs[k + 1] + off))
            cos.append(co)
            Ws.append(W)
            Ns.append(nr)
            off += len(co)
        self.co = np.vstack(cos)
        self.W = np.vstack(Ws)
        self.N = np.vstack(Ns)
        self.tris = np.array(polys, dtype=np.int64)
        self.bvh = BVHTree.FromPolygons([Vector(c) for c in self.co], [tuple(t) for t in self.tris])

    def nearest(self, p):
        loc, nrm, i, d = self.bvh.find_nearest(Vector(p))
        if loc is None:
            return None
        t = self.tris[i]
        a, b, c = (self.co[k] for k in t)
        bc = bary(np.array(loc), a, b, c)
        n = sum(bc[k] * self.N[t[k]] for k in range(3))
        n = n / max(np.linalg.norm(n), 1e-9)
        w = sum(bc[k] * self.W[t[k]] for k in range(3))
        # face normal sign for inside/outside tests
        fn = np.cross(b - a, c - a)
        fn = fn / max(np.linalg.norm(fn), 1e-12)
        return {"loc": np.array(loc), "n": n, "fn": fn, "w": w, "d": d, "tri": i}

    def weights(self, p, top=4):
        r = self.nearest(p)
        return top_weights(r["w"], self.names, top)

    def signed(self, p):
        r = self.nearest(p)
        return float(np.dot(np.asarray(p) - r["loc"], r["fn"])), r


def bary(p, a, b, c):
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0 @ v0, v0 @ v1, v1 @ v1
    d20, d21 = v2 @ v0, v2 @ v1
    den = d00 * d11 - d01 * d01
    if abs(den) < 1e-18:
        return np.array([1.0, 0.0, 0.0])
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    out = np.clip(np.array([1 - v - w, v, w]), 0, 1)
    return out / max(out.sum(), 1e-9)


def top_weights(w, names, top=4):
    order = np.argsort(-w)[:top]
    items = [(names[i], float(w[i])) for i in order if w[i] > 0.01]
    s = sum(x for _, x in items) or 1.0
    return {k: x / s for k, x in items}


def blend_w(*pairs):
    """blend_w((wdict, f), (wdict, f), ...) -> normalised top-4 dict."""
    acc = {}
    for wd, f in pairs:
        for k, x in wd.items():
            acc[k] = acc.get(k, 0.0) + x * f
    items = sorted(acc.items(), key=lambda t: -t[1])[:4]
    s = sum(x for _, x in items) or 1.0
    return {k: x / s for k, x in items if x > 1e-4}


# ================================================================================================= mesh builder
class MB:
    """Accumulates geometry; build() makes a mesh object with UVs, vertex groups, material slots and sd_outline."""

    def __init__(self):
        self.V, self.W, self.OL = [], [], []
        self.F, self.FUV, self.FM = [], [], []
        self.smooth = []

    def vert(self, p, w, ol=1.0):
        self.V.append(tuple(float(x) for x in p))
        self.W.append(dict(w))
        self.OL.append(float(ol))
        return len(self.V) - 1

    def face(self, vids, uvs, mat, smooth=True):
        if len(set(vids)) < 3:
            return
        self.F.append(tuple(vids))
        self.FUV.append([tuple(float(x) for x in uv) for uv in uvs])
        self.FM.append(mat)
        self.smooth.append(smooth)

    def extend(self, other):
        off = len(self.V)
        self.V += other.V
        self.W += other.W
        self.OL += other.OL
        self.F += [tuple(i + off for i in f) for f in other.F]
        self.FUV += other.FUV
        self.FM += other.FM
        self.smooth += other.smooth

    def build(self, name, mats, collection="LOW", rig=None):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.V, [], self.F)
        me.update()
        uv = me.uv_layers.new(name="UVMap")
        li = 0
        for p, fuv in zip(me.polygons, self.FUV):
            for k, l in enumerate(p.loop_indices):
                uv.data[l].uv = fuv[k]
        mslot = {}
        for m in mats:
            mslot[m.name] = len(me.materials)
            me.materials.append(m)
        me.polygons.foreach_set("material_index", [mslot[m.name] for m in self.FM])
        me.polygons.foreach_set("use_smooth", self.smooth)
        ob = bpy.data.objects.new(name, me)
        U.col(collection).objects.link(ob)
        groups = {}
        for vi, w in enumerate(self.W):
            for k, x in w.items():
                g = groups.get(k)
                if g is None:
                    g = groups[k] = ob.vertex_groups.new(name=k)
                g.add([vi], x, "REPLACE")
        ca = me.color_attributes.new("sd_outline", "BYTE_COLOR", "CORNER")
        vals = np.ones(len(me.loops) * 4, dtype=np.float32)
        lv = np.empty(len(me.loops), dtype=np.int64)
        me.loops.foreach_get("vertex_index", lv)
        vals[0::4] = np.array(self.OL, dtype=np.float32)[lv]
        ca.data.foreach_set("color", vals)
        me.color_attributes.active_color = ca
        if rig is not None:
            ob.parent = rig
            mod = ob.modifiers.new("Armature", "ARMATURE")
            mod.object = rig
        return ob


def grid_normals(P, closed_u=False, closed_v=False):
    nu, nv = P.shape[:2]
    du = np.zeros_like(P)
    dv = np.zeros_like(P)
    if closed_u:
        du = np.roll(P, -1, axis=0) - np.roll(P, 1, axis=0)
    else:
        du[1:-1] = P[2:] - P[:-2]
        du[0] = P[1] - P[0]
        du[-1] = P[-1] - P[-2]
    if closed_v:
        dv = np.roll(P, -1, axis=1) - np.roll(P, 1, axis=1)
    else:
        dv[:, 1:-1] = P[:, 2:] - P[:, :-2]
        dv[:, 0] = P[:, 1] - P[:, 0]
        dv[:, -1] = P[:, -1] - P[:, -2]
    n = np.cross(du, dv)
    ln = np.linalg.norm(n, axis=2, keepdims=True)
    return n / np.maximum(ln, 1e-12)


def sheet(mb, P, thick, mats, uvfn, wfn, olfn=None, outward=None, closed_u=False, closed_v=False, N=None,
          thick_fn=None, rim_uv=None, caps=True):
    """Thick sheet around mid-surface P (nu, nv, 3).
    mats: dict out / in / rim -> material.  uvfn(s, t, side) -> (u, v) with s, t in [0, 1] (side 'out' / 'in').
    wfn(p, s, t) -> weight dict.  olfn(s, t, side) -> outline mask.  outward(p) -> vector the outer side faces.
    thick_fn(s, t) overrides the constant thickness.  rim_uv: (u, v) for rim faces (defaults to uvfn on the border).
    """
    P = np.asarray(P, dtype=np.float64)
    nu, nv = P.shape[:2]
    G = grid_normals(P, closed_u, closed_v)
    if N is None:
        N = G
    if outward is not None:
        c = P[nu // 2, nv // 2]
        if np.dot(N[nu // 2, nv // 2], outward(c)) < 0:
            N = -N
    # winding: outer faces must face +N; the grid order (i, j) faces +cross(du, dv) = +G
    flip = float(np.sum(N * G)) < 0
    S = np.linspace(0, 1, nu)
    T = np.linspace(0, 1, nv)
    idx = {}
    for side, sg in (("out", 1.0), ("in", -1.0)):
        for i in range(nu):
            for j in range(nv):
                th = thick_fn(S[i], T[j]) if thick_fn else thick
                p = P[i, j] + N[i, j] * sg * th * 0.5
                w = wfn(P[i, j], S[i], T[j])
                ol = olfn(S[i], T[j], side) if olfn else 1.0
                idx[side, i, j] = mb.vert(p, w, ol)

    def put(q, uv, mat):
        if flip:
            q, uv = q[::-1], uv[::-1]
        mb.face(q, uv, mat)
    iu = range(nu if closed_u else nu - 1)
    jv = range(nv if closed_v else nv - 1)
    for side in ("out", "in"):
        for i in iu:
            for j in jv:
                i1, j1 = (i + 1) % nu, (j + 1) % nv
                q = [idx[side, i, j], idx[side, i1, j], idx[side, i1, j1], idx[side, i, j1]]
                s0, s1 = S[i], (S[i + 1] if i + 1 < nu else 1.0)
                t0, t1 = T[j], (T[j + 1] if j + 1 < nv else 1.0)
                uv = [uvfn(s0, t0, side), uvfn(s1, t0, side), uvfn(s1, t1, side), uvfn(s0, t1, side)]
                if side == "out":
                    put(q, uv, mats["out"])
                else:
                    put(q[::-1], uv[::-1], mats["in"])
    # rims (borders not closed)

    def rim(path):
        for (a, b) in zip(path[:-1], path[1:]):
            q = [idx["out", a[0], a[1]], idx["in", a[0], a[1]], idx["in", b[0], b[1]], idx["out", b[0], b[1]]]
            if rim_uv is not None:
                uv = [rim_uv] * 4
            else:
                uv = [uvfn(S[a[0]], T[a[1]], "out")] * 2 + [uvfn(S[b[0]], T[b[1]], "out")] * 2
            put(q, uv, mats.get("rim", mats["out"]))
    if not closed_v:
        rim([(i, 0) for i in range(nu)] + ([(0, 0)] if closed_u else []))
        rim([(i, nv - 1) for i in range(nu - 1, -1, -1)] + ([(nu - 1, nv - 1)] if closed_u else []))
    if not closed_u:
        rim([(nu - 1, j) for j in range(nv)] + ([(nu - 1, 0)] if closed_v else []))
        rim([(0, j) for j in range(nv - 1, -1, -1)] + ([(0, nv - 1)] if closed_v else []))
    return N


# ================================================================================================= curves
def catmull(pts, n, closed=False):
    """Resample a Catmull-Rom spline through pts into n points (uniform parameter per span, then by arc length)."""
    P = [np.asarray(p, dtype=np.float64) for p in pts]
    if closed:
        P = [P[-1]] + P + [P[0], P[1]]
    else:
        P = [2 * P[0] - P[1]] + P + [2 * P[-1] - P[-2]]
    dense = []
    for k in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[k - 1], P[k], P[k + 1], P[k + 2]
        for t in np.linspace(0, 1, 24, endpoint=False):
            t2, t3 = t * t, t * t * t
            dense.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                                (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    dense.append(P[-2] if not closed else P[1])
    D = np.array(dense)
    seg = np.linalg.norm(np.diff(D, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    want = np.linspace(0, s[-1], n + (1 if closed else 0))[: n] if closed else np.linspace(0, s[-1], n)
    out = np.empty((len(want), 3))
    for k in range(3):
        out[:, k] = np.interp(want, s, D[:, k])
    return out


def path_length(P, closed=False):
    d = np.linalg.norm(np.diff(P, axis=0), axis=1).sum()
    if closed:
        d += np.linalg.norm(P[0] - P[-1])
    return d


def drape_path(ref, P, offset, iters=12, closed=False, keep_ends=False):
    """Project a polyline onto the reference surface at `offset` and bridge concavities: alternate Laplacian smoothing
    with pushing points back out to the offset surface (a strap pulled taut over the body)."""
    P = np.array(P, dtype=np.float64)
    for p in range(len(P)):
        r = ref.nearest(P[p])
        P[p] = r["loc"] + r["n"] * offset
    for _ in range(iters):
        Q = P.copy()
        rng = range(len(P)) if closed else range(1, len(P) - 1)
        for i in rng:
            Q[i] = 0.5 * P[i] + 0.25 * (P[i - 1] + P[(i + 1) % len(P)])
        P = Q
        for i in range(len(P)):
            if keep_ends and not closed and i in (0, len(P) - 1):
                continue
            sd, r = ref.signed(P[i])
            if sd < offset:
                P[i] = r["loc"] + r["fn"] * offset if sd < 0 else P[i] + r["fn"] * (offset - sd)
    return P


def frames(P, up_fn, closed=False):
    """Tangent T and side B (B = up x T normalised) along a polyline; up_fn(i, p) gives the reference 'up' (normal)."""
    n = len(P)
    T = np.zeros_like(P)
    for i in range(n):
        if closed:
            T[i] = P[(i + 1) % n] - P[i - 1]
        else:
            T[i] = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
        T[i] /= max(np.linalg.norm(T[i]), 1e-12)
    Nn = np.array([up_fn(i, P[i]) for i in range(n)], dtype=np.float64)
    Nn = Nn - T * np.sum(Nn * T, axis=1, keepdims=True)
    Nn /= np.maximum(np.linalg.norm(Nn, axis=1, keepdims=True), 1e-12)
    B = np.cross(Nn, T)
    return T, Nn, B


def strap(mb, ref, pts, width, thick, offset, mats, uv_rect, closed=False, samples=None, wref=None, ol=0.6,
          width_fn=None, iters=12, across=2, drape=True, up_fn=None, uv_len=None, keep_ends=False):
    """A band of `width` x `thick` following pts over ref's surface at `offset` (to the band's inner face).
    uv_rect = (u0, v0, u1, v1): u across the band, v along it (v repeats every uv_len metres when given)."""
    base = np.asarray(pts, dtype=np.float64)
    if samples is None:
        L = path_length(catmull(base, 200, closed), closed)
        samples = max(4, int(L / 0.012))
    P = catmull(base, samples, closed)
    if drape:
        P = drape_path(ref, P, offset + thick * 0.5, iters=iters, closed=closed, keep_ends=keep_ends)
    up = up_fn or (lambda i, p: ref.nearest(p)["n"])
    T, Nn, B = frames(P, up, closed)
    acc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    L = acc[-1] + (np.linalg.norm(P[0] - P[-1]) if closed else 0.0)
    G = np.zeros((across, len(P), 3))
    for a in range(across):
        k = a / (across - 1) * 2 - 1
        for i in range(len(P)):
            w = width_fn(acc[i] / max(L, 1e-9)) if width_fn else width
            G[a, i] = P[i] + B[i] * k * w * 0.5
    Nn3 = np.repeat(Nn[None], across, axis=0)
    u0, v0, u1, v1 = uv_rect

    def uvfn(s, t, side):
        vv = t * L / uv_len if uv_len else t
        return (u0 + s * (u1 - u0), v0 + vv * (v1 - v0))
    wsrc = wref or ref
    sheet(mb, G, thick, mats, uvfn, lambda p, s, t: wsrc.weights(p), lambda s, t, side: ol, closed_v=closed,
          N=Nn3)
    return P


def sweep(mb, P, radius_fn, mats, uvfn, wfn, sides=8, closed=False, up=None, flat=1.0, olfn=None, cap=True,
          profile=None, twist_fn=None, uvk=None):
    """Tube along polyline P: section radius radius_fn(t) (t = 0..1 arc length), flattened by `flat` along the
    side axis (flat > 1 widens it). profile(k) -> (x, y) unit section points (default circle).
    uvfn(t, a) -> (u, v) with a = 0..1 around. Returns the vertex index rings."""
    P = np.asarray(P, dtype=np.float64)
    n = len(P)
    if callable(up):
        T, Nn, B = frames(P, up, closed)
    else:
        upv = np.asarray(up if up is not None else (0, 0, 1), dtype=np.float64)
        T, Nn, B = frames(P, lambda i, p: upv, closed)
    acc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    tt = acc / max(acc[-1], 1e-9)
    rings = []
    for i in range(n):
        r = radius_fn(tt[i])
        tw = twist_fn(tt[i]) if twist_fn else 0.0
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides + tw
            if profile:
                x, y = profile(k / sides)
            else:
                x, y = math.cos(a), math.sin(a)
            p = P[i] + B[i] * x * r * flat + Nn[i] * y * r
            ring.append(mb.vert(p, wfn(P[i], tt[i]), olfn(tt[i]) if olfn else 1.0))
        rings.append(ring)
    m = mats if isinstance(mats, dict) else {"out": mats}
    for i in range(n - 1 + (1 if closed else 0)):
        a_, b_ = rings[i], rings[(i + 1) % n]
        for k in range(sides):
            k1 = (k + 1) % sides
            q = [a_[k], a_[k1], b_[k1], b_[k]]
            ti, tj = tt[i], tt[(i + 1) % n] if (i + 1) < n else 1.0
            f = uvk(k) if uvk is not None else uvfn
            uv = [f(ti, k / sides), f(ti, (k + 1) / sides), f(tj, (k + 1) / sides), f(tj, k / sides)]
            mb.face(q, uv, m["out"])
    if cap and not closed:
        for ring, rev in ((rings[0], True), (rings[-1], False)):
            c = np.mean([mb.V[v] for v in ring], axis=0)
            ci = mb.vert(c, mb.W[ring[0]], mb.OL[ring[0]])
            for k in range(sides):
                q = [ring[k], ring[(k + 1) % sides], ci]
                if rev:
                    q = q[::-1]
                t0 = 0.0 if rev else 1.0
                mb.face(q, [uvfn(t0, 0.5)] * 3, m.get("cap", m["out"]))
    return rings


# ================================================================================================= body edits
def bisect(ob, plane_co, plane_no, region=None):
    """Cut ob along a plane (keeps shape keys / weights / UVs / attributes interpolated). region(co) -> bool limits
    which faces are cut (by face centre)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    faces = [f for f in bm.faces if region is None or region(f.calc_center_median())]
    geom = list({e for f in faces for e in f.edges}) + faces + list({v for f in faces for v in f.verts})
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=Vector(plane_co), plane_no=Vector(plane_no))
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(me)
    bm.free()
    me.update()


def face_centres(me):
    out = np.zeros((len(me.polygons), 3))
    me.polygons.foreach_get("center", out.ravel())
    return out


def vert_co(me):
    out = np.zeros((len(me.vertices), 3))
    me.vertices.foreach_get("co", out.ravel())
    return out


def assign_region(ob, faces, mat, uv_fn, rect=(0.0, 0.0, 1.0, 1.0), periodic=True):
    """Give polygons `faces` material `mat` (slot added if needed) and new UVs in the atlas rect: uv_fn(co (3,),
    poly_index, corner) -> local (s, t) in [0, 1]. periodic: s wraps (cylinder) - a face that straddles the wrap is
    kept on one side (it may overshoot the rect by one face; paint rects with padding)."""
    me = ob.data
    if mat.name not in [m.name for m in me.materials]:
        me.materials.append(mat)
    slot = [m.name for m in me.materials].index(mat.name)
    uv = me.uv_layers.active.data
    u0, v0, u1, v1 = rect
    for fi in faces:
        p = me.polygons[fi]
        p.material_index = slot
        st = [uv_fn(np.array(me.vertices[me.loops[l].vertex_index].co), fi, k) for k, l in enumerate(p.loop_indices)]
        ss = [x for x, _ in st]
        if periodic and max(ss) - min(ss) > 0.5:
            st = [((x + 1.0) if x < 0.5 else x, y) for x, y in st]
            if max(x for x, _ in st) > 1.0 + 1e-6:
                st = [(x - 1.0, y) if True else (x, y) for x, y in st] if min(x for x, _ in st) > 0.75 else st
        for (x, y), l in zip(st, p.loop_indices):
            uv[l].uv = (u0 + x * (u1 - u0), v0 + y * (v1 - v0))
    me.update()
    return slot


def region_boundary_loops(me, faces):
    """Closed boundary loops (vertex index lists) of a face set."""
    fs = set(faces)
    count = {}
    for fi in fs:
        p = me.polygons[fi]
        vs = list(p.vertices)
        for k in range(len(vs)):
            e = tuple(sorted((vs[k], vs[(k + 1) % len(vs)])))
            count[e] = count.get(e, 0) + 1
    # boundary = edges used once inside the set
    edges = [e for e, c in count.items() if c == 1]
    adj = {}
    for a, b in edges:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    loops, seen = [], set()
    for start in adj:
        if start in seen:
            continue
        loop = [start]
        seen.add(start)
        prev, cur = None, start
        while True:
            nxt = [x for x in adj[cur] if x != prev and x not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            loop.append(cur)
            seen.add(cur)
        if len(loop) > 2:
            loops.append(loop)
    return loops


def inflate(ob, verts, amount_fn, bridge=0, bridge_iters=0):
    """Push vertices out along their normals (basis + every shape key by the same offset). amount_fn(co) -> metres.
    bridge_iters > 0: also fill concavities (Laplacian smoothed position, outward component only)."""
    me = ob.data
    me.update()
    vs = list(verts)
    co = vert_co(me)
    nr = np.zeros_like(co)
    me.vertices.foreach_get("normal", nr.ravel())
    off = np.zeros_like(co)
    if bridge_iters:
        sel = np.zeros(len(co), dtype=bool)
        sel[vs] = True
        nb = [[] for _ in range(len(co))]
        for e in me.edges:
            a, b = e.vertices
            nb[a].append(b)
            nb[b].append(a)
        sm = co.copy()
        for _ in range(bridge_iters):
            new = sm.copy()
            for i in vs:
                if nb[i]:
                    new[i] = 0.5 * sm[i] + 0.5 * sm[nb[i]].mean(axis=0)
            sm = new
        out = np.sum((sm - co) * nr, axis=1)
        for i in vs:
            if out[i] > 0:
                off[i] += nr[i] * out[i] * bridge
    for i in vs:
        off[i] += nr[i] * amount_fn(co[i])
    new = co + off
    me.vertices.foreach_set("co", new.astype(np.float32).ravel())
    if me.shape_keys:
        for kb in me.shape_keys.key_blocks:
            k = np.zeros_like(co)
            kb.data.foreach_get("co", k.ravel())
            kb.data.foreach_set("co", (k + off).astype(np.float32).ravel())
    me.update()


def delete_faces(ob, faces):
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    kill = [bm.faces[i] for i in faces]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me.update()


def point_attr(me, name):
    a = me.attributes.get(name)
    if a is None:
        return np.zeros(len(me.vertices))
    out = np.zeros(len(me.vertices), dtype=np.float32)
    a.data.foreach_get("value", out)
    return out


def set_outline(ob, fn):
    """sd_outline (CORNER, R) = fn(vertex co, poly) for every corner; replaces the attribute."""
    me = ob.data
    for a in [a for a in me.color_attributes if a.name == "sd_outline"]:
        me.color_attributes.remove(a)
    ca = me.color_attributes.new("sd_outline", "BYTE_COLOR", "CORNER")
    vals = np.ones(len(me.loops) * 4, dtype=np.float32)
    for p in me.polygons:
        for l in p.loop_indices:
            vals[l * 4] = fn(me.vertices[me.loops[l].vertex_index].co, p)
    ca.data.foreach_set("color", vals)
    me.color_attributes.active_color = ca


# ================================================================================================= textures
class Canvas:
    """sRGB float canvas (h, w, 4), row 0 = bottom (UV v = 0), painted with flat fills and soft gradients."""

    def __init__(self, w, h, fill=0x808080):
        self.w, self.h = w, h
        self.px = np.ones((h, w, 4), dtype=np.float32)
        self.px[..., :3] = hexrgb(fill)
        yy, xx = np.mgrid[0:h, 0:w]
        self.U = (xx + 0.5) / w
        self.V = (yy + 0.5) / h

    def rect_mask(self, r):
        u0, v0, u1, v1 = r
        return (self.U >= u0) & (self.U < u1) & (self.V >= v0) & (self.V < v1)

    def local(self, r):
        u0, v0, u1, v1 = r
        return (self.U - u0) / (u1 - u0), (self.V - v0) / (v1 - v0)

    def fill(self, r, col):
        m = self.rect_mask(r)
        self.px[m, :3] = hexrgb(col) if isinstance(col, int) else col

    def paint(self, r, fn, pad=0.0):
        """fn(s, t) -> (h, w, 3) colour evaluated over the rect's local coordinates; pad (in UV units) extends the
        painted area with the clamped edge values (bleed for wrap seams and mip-maps)."""
        u0, v0, u1, v1 = r
        m = self.rect_mask((u0 - pad, v0 - pad, u1 + pad, v1 + pad))
        s, t = self.local(r)
        col = fn(np.clip(s, 0.0, 1.0), np.clip(t, 0.0, 1.0))
        self.px[m, :3] = np.clip(col[m], 0, 1)

    def save(self, name, path):
        im = bpy.data.images.get(name)
        if im:
            bpy.data.images.remove(im)
        im = bpy.data.images.new(name, self.w, self.h, alpha=True)
        im.pixels.foreach_set(self.px.astype(np.float32).ravel())
        os.makedirs(os.path.dirname(path), exist_ok=True)
        im.filepath_raw = path
        im.file_format = "PNG"
        im.save()
        im.filepath = path
        return im


def C3(h):
    return hexrgb(h)[None, None, :]


def band(x, c, w, soft=0.0):
    """1 inside |x - c| < w/2 with a soft edge of `soft`."""
    d = np.abs(x - c) - w * 0.5
    if soft <= 0:
        return (d < 0).astype(np.float32)
    return np.clip(0.5 - d / soft, 0, 1)


def dashes(x, period, duty=0.55):
    return ((x / period) % 1.0 < duty).astype(np.float32)


# ================================================================================================= materials
def toon_extras(cfg, lit_hex, shade_hex, toony=0.9, shift=-0.05, rim=None, rim_power=4.0, outline=0.0022,
                outline_hex=None, matcap="none", unlit=False):
    lit, shade = hexlin(lit_hex), hexlin(shade_hex)
    ratio = np.clip(shade / np.maximum(lit, 1e-4), 0, 1)
    oc = hexlin(outline_hex if outline_hex is not None else cfg["outline_hex"])
    return {"shadeColor": [round(float(x), 4) for x in ratio], "shadeShift": shift, "shadeToony": toony,
            "rimColor": [round(float(x), 4) for x in rim] if rim is not None else None,
            "rimPower": rim_power, "outlineWidth": outline, "outlineColor": [round(float(x), 4) for x in oc],
            "matcap": matcap, "unlit": unlit}


def rim_of(cfg, k):
    return hexlin(cfg["rim_hex"]) * k


def toon_material(name, img, extras, double=False, alpha="OPAQUE", cutoff=0.5):
    import vroid_finish as VF
    return VF.toon_material(name, img, extras, alpha=alpha, cutoff=cutoff, double=double)


# ================================================================================================= bones
def add_bone(rig, name, head, parent, length=0.06, tail=None):
    U.set_active(rig)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = rig.data.edit_bones.get(name) or rig.data.edit_bones.new(name)
    eb.head = Vector(head)
    eb.tail = Vector(head) + Vector((0, 0, length))      # every contract bone points +Z, roll 0 (identity rest)
    eb.roll = 0.0
    eb.parent = rig.data.edit_bones[parent]
    eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")


def bind(ob, rig):
    ob.parent = rig
    ob.matrix_parent_inverse = Matrix.Identity(4)
    if not any(m.type == "ARMATURE" for m in ob.modifiers):
        mod = ob.modifiers.new("Armature", "ARMATURE")
        mod.object = rig


def limit_weights(ob, top=4):
    """<= top influences per vertex, normalised; drops groups with no weight."""
    names = {g.index: g.name for g in ob.vertex_groups}
    for v in ob.data.vertices:
        gs = sorted([(g.group, g.weight) for g in v.groups], key=lambda t: -t[1])
        keep = [(gi, w) for gi, w in gs[:top] if w >= 0.01] or gs[:1]
        s = sum(w for _, w in keep) or 1.0
        for gi, w in gs:
            ob.vertex_groups[names[gi]].remove([v.index])
        for gi, w in keep:
            ob.vertex_groups[names[gi]].add([v.index], w / s, "REPLACE")


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)
