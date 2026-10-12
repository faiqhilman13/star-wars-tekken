"""Kael-style restyle of a VRoid hair mesh (the optional "hair_style" block of a vroid_chars config): the VRoid
locks keep their tapered topology and painted texture, but each lock is re-routed along a combed flow.

The VRoid hair is ~150 two-layer lock islands radiating from the crown whorl. Each lock (outer + inner layer) gets a
spine (vertices binned by their angle from the crown), and every vertex is stored as an offset in the spine's
moving frame. Front and side locks then get a new spine that starts on the hairline and follows the comb flow
(great circles away from a "pole" on the forehead below the side part: up and back over the crown, back over the
ears at the sides). The lock is rebuilt along it, with the front lifted off the scalp. Back locks keep their path
and are lengthened toward the nape. The ahoge and tiny bits are removed, and two thin front locks become loose
strands falling over the forehead. A scalp cap (the texture's dark root colour) fills the gaps.

hair_style keys (heights in metres relative to the eye line, azimuths in degrees, 0 = front, + = character's left):
  part_az 17, pole_dz 0.02     side part azimuth; flow pole height on the forehead
  front 0.085, temple 0.070, ear 0.050, nape -0.120, sideburn -0.014   hairline (cap) heights
  front_span 58, side_span (46, 96)   azimuth range of the re-rooted front / side locks
  lift 0.012                   front volume lifted off the scalp just behind the hairline
  back_len 1.25                back locks lengthened toward the nape
  loose 2                      loose forehead strands (from the thinnest front locks)
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import sd_util as U


# ------------------------------------------------------------------------------------------------ head model
class HeadModel:
    """Ellipsoid fitted to the skull (body head-back + face mask without the ears); hair points are the further of
    the ellipsoid and the real skull along the radial ray, lifted off it."""

    def __init__(self, face, body, L, st):
        ez = L["ez"]
        self.ez = ez
        fme, bme = face.data, body.data
        verts, polys = [], []

        def add(me, keep):
            idx = {}
            for p in me.polygons:
                if not keep(me, p):
                    continue
                t = []
                for i in p.vertices:
                    if i not in idx:
                        idx[i] = len(verts)
                        verts.append(tuple(me.vertices[i].co))
                    t.append(idx[i])
                polys.append(t)

        def face_keep(me, p):
            c = p.center
            return p.material_index in L["skin_ids"] and not (abs(c.y) > 0.097 and c.x < 0.05)

        def body_keep(me, p):
            return all(me.vertices[i].co.z > ez - 0.02 for i in p.vertices)
        add(fme, face_keep)
        add(bme, body_keep)
        V = [Vector(v) for v in verts]
        top = max(v.z for v in V)
        front = max(v.x for v in V if v.z > ez + 0.03 and abs(v.y) < 0.03)
        back = min(v.x for v in V if v.z > ez)
        width = max(abs(v.y) for v in V if v.z > ez + 0.02)
        self.top = top
        self.c = Vector(((front + back) / 2, 0.0, ez))
        self.r = Vector(((front - back) / 2, width, top - ez))
        self.bvh = BVHTree.FromPolygons(verts, polys)
        self.st = st

    def point(self, u):
        """Parametric unit vector u -> point on the ellipsoid."""
        return self.c + Vector((u.x * self.r.x, u.y * self.r.y, u.z * self.r.z))

    def u_of(self, p):
        d = p - self.c
        return Vector((d.x / self.r.x, d.y / self.r.y, d.z / self.r.z)).normalized()

    def surface(self, u, h=0.0, gap=0.004):
        p = self.point(u)
        d = (p - self.c).normalized()
        hit = self.bvh.ray_cast(self.c + d * 0.4, -d, 0.6)[0]
        if hit is not None and (hit - self.c).length > (p - self.c).length:
            p = hit
        return p + d * (gap + h)

    def shell_r(self, p):
        return (self.surface(self.u_of(p), 0.0, 0.0) - self.c).length

    def u_at(self, az, z):
        a = math.radians(az)
        h = max(-0.999, min(0.999, (z - self.c.z) / self.r.z))
        cp = math.sqrt(1 - h * h)
        return Vector((cp * math.cos(a), cp * math.sin(a), h))

    def hairline_z(self, az):
        st = self.st
        a = abs(az)
        fr, te, ea, na = st.get("front", 0.085), st.get("temple", 0.070), st.get("ear", 0.050), st.get("nape", -0.12)
        sb = st.get("sideburn")
        if sb is None:
            knots = [(0, fr), (28, fr - 0.006), (48, te), (68, te - 0.012), (84, ea), (104, ea - 0.004),
                     (118, ea - 0.04), (140, na * 0.75), (180, na)]
        else:
            knots = [(0, fr), (28, fr - 0.006), (48, te), (62, te - 0.012), (70, sb), (78, sb), (83, ea),
                     (106, ea - 0.004), (118, ea - 0.04), (140, na * 0.75), (180, na)]
        for (x0, y0), (x1, y1) in zip(knots, knots[1:]):
            if x0 <= a <= x1:
                t = (a - x0) / (x1 - x0)
                t = t * t * (3 - 2 * t)
                return self.ez + y0 + (y1 - y0) * t
        return self.ez + knots[-1][1]


# ------------------------------------------------------------------------------------------------ cap
def cap_rows(head, n_az=72, n_z=16):
    rows = []
    zt = head.c.z + head.r.z * 0.995
    short = head.st.get("cap_short", 0.045)            # the cap stops above the back lock tips
    for i in range(n_z + 1):
        row = []
        t = i / n_z
        for j in range(n_az):
            az = -180.0 + 360.0 * j / n_az
            z0 = head.hairline_z(az) - 0.004 + short * U.smoothstep(110.0, 150.0, abs(az))
            z = z0 + (zt - z0) * (1 - (1 - t) ** 1.5)
            row.append(head.surface(head.u_at(az, z), 0.0, gap=0.0025))
        rows.append(row)
    return rows


def add_cap(bm, uvl, rows, uv):
    vs = [[bm.verts.new(p) for p in row] for row in rows]
    nr, nc = len(rows), len(rows[0])
    faces = []
    for i in range(nr - 1):
        for j in range(nc):
            j2 = (j + 1) % nc
            f = bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j2], vs[i][j2]))
            for loop in f.loops:
                loop[uvl].uv = uv
            f.smooth = True
            faces.append(f)
    return [v for row in vs for v in row], faces


# ------------------------------------------------------------------------------------------------ locks
def islands(me):
    n = len(me.vertices)
    parent = np.arange(n)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for e in me.edges:
        a, b = find(e.vertices[0]), find(e.vertices[1])
        if a != b:
            parent[a] = b
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def pair_islands(P, isl, tol=0.012):
    """Outer + inner layer pairs: same vertex count, centroids within tol; returns [(outer, inner or None)]."""
    cen = [P[ix].mean(axis=0) for ix in isl]
    used, out = set(), []
    order = sorted(range(len(isl)), key=lambda i: -len(isl[i]))
    for i in order:
        if i in used:
            continue
        used.add(i)
        best, bd = None, tol
        for j in order:
            if j in used or len(isl[j]) != len(isl[i]):
                continue
            d = float(np.linalg.norm(cen[i] - cen[j]))
            if d < bd:
                best, bd = j, d
        if best is None:
            out.append((isl[i], None))
        else:
            used.add(best)
            out.append((isl[i], isl[best]))
    return out


def _frames(S, c):
    n = len(S)
    T, N, B = np.zeros_like(S), np.zeros_like(S), np.zeros_like(S)
    for k in range(n):
        nk = S[k] - c
        nk /= max(np.linalg.norm(nk), 1e-9)
        tk = S[min(k + 1, n - 1)] - S[max(k - 1, 0)]
        tk = tk - nk * tk.dot(nk)
        tk /= max(np.linalg.norm(tk), 1e-9)
        N[k], T[k], B[k] = nk, tk, np.cross(tk, nk)
    return T, N, B


def _arc(S):
    return np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(S, axis=0), axis=1))])


class Lock:
    """A lock (outer + inner islands) as a spine with per-vertex frame offsets."""

    def __init__(self, P, outer, inner, c, W, K=16):
        self.outer, self.inner = outer, inner
        self.idx = outer + (inner or [])
        X = P[self.idx]
        D = X - c
        th = np.arccos(np.clip((D / np.linalg.norm(D, axis=1)[:, None]) @ W, -1, 1))
        lo, hi = float(th.min()), float(th.max())
        edges = np.linspace(lo, hi + 1e-6, K + 1)
        cen = 0.5 * (edges[:-1] + edges[1:])
        S = np.zeros((K, 3))
        ok = np.zeros(K, dtype=bool)
        for k in range(K):
            m = (th >= edges[k]) & (th < edges[k + 1])
            if m.any():
                S[k] = X[m].mean(axis=0)
                ok[k] = True
        for d in range(3):                               # fill empty bins
            S[~ok, d] = np.interp(cen[~ok], cen[ok], S[ok, d])
        self.S, self.cen = S, cen
        self.T, self.N, self.B = _frames(S, c)
        self.s = _arc(S)
        self.length = float(self.s[-1])
        # per-vertex: arc parameter and frame offsets
        f = np.clip(np.interp(th, cen, np.arange(K)), 0, K - 1)
        k0 = np.minimum(np.floor(f).astype(int), K - 2)
        a = (f - k0)[:, None]
        Sv = S[k0] * (1 - a) + S[k0 + 1] * a
        Tv = self.T[k0] * (1 - a) + self.T[k0 + 1] * a
        Nv = self.N[k0] * (1 - a) + self.N[k0 + 1] * a
        Bv = self.B[k0] * (1 - a) + self.B[k0 + 1] * a
        sv = self.s[k0] * (1 - a[:, 0]) + self.s[k0 + 1] * a[:, 0]
        # extrapolate beyond the end bins along the tangent
        lo_m, hi_m = th < cen[0], th > cen[-1]
        R = X - Sv
        o_t = np.einsum("ij,ij->i", R, Tv)
        sv = sv + np.where(lo_m | hi_m, o_t, 0.0)
        o_t = np.where(lo_m | hi_m, 0.0, o_t)
        self.sv = sv
        self.o = np.stack([o_t, np.einsum("ij,ij->i", R, Nv), np.einsum("ij,ij->i", R, Bv)], axis=1)
        self.tip, self.root = S[-1], S[0]
        self.width = float(np.ptp(self.o[:, 2]))
        self.top = float(X[:, 2].max())

    def rebuild(self, Q, c, scale=1.0, wscale=1.0, shift=0.0, sink=0.016):
        """New vertex positions along the polyline Q (n, 3) (arc-length parametrised). shift: the lock starts that
        far along itself (its pointed root end is pulled back along -T and sunk `sink` under the scalp)."""
        T, N, B = _frames(Q, c)
        sq = _arc(Q)
        s_eff = self.sv * scale - shift
        s = np.clip(s_eff, 0.0, sq[-1])
        f = np.interp(s, sq, np.arange(len(Q)))
        k0 = np.minimum(np.floor(f).astype(int), len(Q) - 2)
        a = (f - k0)[:, None]
        P = Q[k0] * (1 - a) + Q[k0 + 1] * a
        Tq = T[k0] * (1 - a) + T[k0 + 1] * a
        Nq = N[k0] * (1 - a) + N[k0 + 1] * a
        Bq = B[k0] * (1 - a) + B[k0 + 1] * a
        over = (s_eff - sq[-1])[:, None]                  # past the end: continue along the last tangent
        P = P + np.where(over > 0, T[-1][None, :] * over, 0.0)
        under = np.clip(-s_eff, 0.0, None)[:, None]       # before the start: collapsed under the scalp
        k = np.minimum(under / 0.004, 1.0)
        P = P - N[0][None, :] * k * sink
        o = self.o * (1.0 - k)
        return P + Tq * o[:, 0:1] + Nq * o[:, 1:2] + Bq * (o[:, 2:3] * wscale)


def flow_path(head, p0, length, pole, clear_fn, ds=0.004):
    """Integrate the comb flow (great circles away from the pole direction) over the shell from p0."""
    c = head.c
    pts = [p0.copy()]
    acc = 0.0
    p = p0.copy()
    while acc < length + 2 * ds:
        n = (p - c).normalized()
        t = -(pole - n * n.dot(pole))
        if t.length < 1e-4:
            t = Vector((-1.0, 0.0, 0.0)) - n * n.x
        t.normalize()
        q = p + t * ds
        q = head.surface(head.u_of(q), clear_fn(min(1.0, acc / max(length, 1e-6))), gap=0.0)
        acc += (q - p).length
        pts.append(q)
        p = q
    return np.array([tuple(x) for x in pts])


def bezier_path(head, u0, u1, ctrl, clear, n=24):
    out = []
    for k in range(n + 1):
        t = k / n
        v = (u0 * (1 - t) ** 2 + ctrl * 2 * t * (1 - t) + u1 * t * t).normalized()
        out.append(tuple(head.surface(v, clear, gap=0.0)))
    return np.array(out)


def comb_hair(hair, face, body, L, cfg):
    """Restyle the VRoid hair object in place (see the module doc). Returns (report, head model, outer-layer
    vertex set, cap vertex indices)."""
    st = cfg["hair_style"]
    head = HeadModel(face, body, L, st)
    me = hair.data
    P = np.array([tuple(v.co) for v in me.vertices])
    c = np.array(tuple(head.c))
    isl = islands(me)
    rep = {"islands": len(isl)}
    # crown whorl direction: the mean of the lock tops
    tops = [P[ix][np.argmax(P[ix][:, 2])] for ix in isl if len(ix) >= 8]
    W = np.mean(tops, axis=0) - c
    W /= np.linalg.norm(W)
    kill = []
    keep_isl = []
    for ix in isl:
        if len(ix) < 8 or P[ix][:, 2].max() > head.top + st.get("ahoge_above", 0.035):
            kill += ix                                   # the ahoge and tiny bits
        else:
            keep_isl.append(ix)
    locks = [Lock(P, o, i, c, W) for o, i in pair_islands(P, keep_isl)]
    for lk in locks:                                     # outer layer = the island further from the centre
        if lk.inner is not None and np.linalg.norm(P[lk.inner] - c, axis=1).mean() > \
                np.linalg.norm(P[lk.outer] - c, axis=1).mean():
            lk.outer, lk.inner = lk.inner, lk.outer
    ez = L["ez"]
    part = st.get("part_az", 17.0)
    pole = (head.surface(head.u_at(part, ez + st.get("pole_dz", 0.02)), 0.0) - head.c).normalized()

    def az_of(p):
        return math.degrees(math.atan2(p[1] - c[1], p[0] - c[0]))
    front, side, back = [], {-1: [], 1: []}, []
    for lk in locks:
        a = az_of(lk.tip)
        if abs(a) < st.get("front_tip_az", 50.0) and lk.tip[2] > ez - 0.04:
            front.append(lk)
        elif abs(a) < 120.0:
            side[1 if a > 0 else -1].append(lk)
        else:
            back.append(lk)
    by_w = sorted(front, key=lambda lk: lk.width)          # loose strands: mid-width front locks (they must read)
    loose = [by_w[int(len(by_w) * f)] for f in (0.25, 0.4)][:st.get("loose", 2)] if by_w else []
    front = [lk for lk in front if lk not in loose]
    newP = P.copy()

    cl_cap = st.get("clear_cap", 0.008)

    def clear_profile(lk):
        """The lock's own height over the scalp along its length, capped (VRoid bangs flare off the face at the
        tips - combed back they must lie down)."""
        cl = np.array([min(cl_cap, max(0.003, np.linalg.norm(s - c) - head.shell_r(Vector(tuple(s))))) for s in lk.S])
        return lambda f: float(np.interp(f, np.linspace(0, 1, len(cl)), cl)) * (1.0 - 0.45 * f)
    shift_f = st.get("root_shift", 0.18)
    lift = st.get("lift", 0.012)
    # front: re-rooted on the hairline across the forehead (a gap at the part), flowing up and back
    front.sort(key=lambda lk: az_of(lk.tip))
    span = st.get("front_span", 58.0)
    nf = len(front)
    roots = list(np.linspace(-span, span, nf)) if nf > 1 else [0.0]
    roots = [r + (3.0 if r >= part else -3.0) * (1.0 - min(1.0, abs(r - part) / 25.0)) for r in roots]
    for i, (lk, az) in enumerate(zip(front, roots)):
        base = clear_profile(lk)
        layer = (i % 3) * 0.0012

        def cf(f, base=base, layer=layer):
            return base(f) + layer + lift * (1 - (1 - min(1.0, f / 0.22)) ** 2) * (1 - f) ** 0.9
        p0 = head.surface(head.u_at(az, head.hairline_z(az) + 0.003), cf(0.0), gap=0.0)
        Q = flow_path(head, p0, lk.length, pole, cf)
        newP[lk.idx] = lk.rebuild(Q, c, shift=shift_f * lk.length)
    # sides: re-rooted along the temples / over the ears, flowing back over the ear tops
    s0, s1 = st.get("side_span", (46.0, 96.0))
    for sgn, lst in side.items():
        lst.sort(key=lambda lk: abs(az_of(lk.tip)))
        n = len(lst)
        for i, lk in enumerate(lst):
            az = sgn * (s0 + (s1 - s0) * (i / max(n - 1, 1)))
            base = clear_profile(lk)
            layer = (i % 2) * 0.0012

            def cf(f, base=base, layer=layer):
                return base(f) + layer
            zr = max(head.hairline_z(az), ez + st.get("ear", 0.05) - 0.008) + 0.003   # never below the ear top
            p0 = head.surface(head.u_at(az, zr), cf(0.0), gap=0.0)
            Q = flow_path(head, p0, lk.length * st.get("side_len", 0.95), pole, cf)
            newP[lk.idx] = lk.rebuild(Q, c, scale=st.get("side_len", 0.95), shift=shift_f * lk.length)
    # back: own path, lengthened toward the nape (continuing down past the end)
    bl = st.get("back_len", 1.25)
    for lk in back:
        S = lk.S.copy()
        tail = S[-1] + (lk.T[-1] * 0.6 + np.array([0.0, 0.0, -1.0]) * 0.4) * lk.length * (bl - 1.0 + 0.05)
        Q = np.vstack([S, tail[None, :]])
        newP[lk.idx] = lk.rebuild(Q, c, scale=bl)
    # loose strands over the forehead, beside the part
    for i, lk in enumerate(loose):
        az0 = part - 9.0 - 11.0 * i
        u0 = head.u_at(az0, head.hairline_z(az0) + 0.004)
        u1 = head.u_at(az0 - 10.0 - 4.0 * i, ez + 0.036 + 0.010 * i)
        Q = bezier_path(head, u0, u1, (u0 + u1).normalized() * 1.15, 0.004)
        L_new = float(_arc(Q)[-1])                       # only the tapered tip end shows; the rest tucks under
        newP[lk.idx] = lk.rebuild(Q, c, shift=max(0.0, lk.length - L_new), wscale=0.9)
    me.vertices.foreach_set("co", newP.astype(np.float32).ravel())
    # drop the ahoge / bits, then add the cap (UV on the texture's darkest root texel)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    outer = set()
    for lk in locks:
        outer.update(lk.outer)
    keep_outer = [bm.verts[i] for i in outer]
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in kill], context="VERTS")
    uvl = bm.loops.layers.uv.active
    cap_v, _ = add_cap(bm, uvl, cap_rows(head), st.get("cap_uv", (0.25, 0.985)))
    bm.verts.index_update()
    outer_idx = {v.index for v in keep_outer if v.is_valid}
    cap_idx = {v.index for v in cap_v}
    bm.to_mesh(me)
    bm.free()
    me.update()
    g = hair.vertex_groups.get("J_Bip_C_Head") or hair.vertex_groups.new(name="J_Bip_C_Head")
    g.add(sorted(cap_idx), 1.0, "REPLACE")
    rep.update({"locks": len(locks), "front": len(front), "side": {k: len(v) for k, v in side.items()},
                "back": len(back), "loose": len(loose), "removed_verts": len(kill), "cap_verts": len(cap_idx)})
    return rep, head, outer_idx, cap_idx


def dark_texel(px):
    """(u, v) of a dark, opaque texel near the root end of the hair texture (cap colour)."""
    H, W = px.shape[:2]
    lum = px[..., :3] @ np.array([0.2126, 0.7152, 0.0722])
    lum = np.where(px[..., 3] > 0.9, lum, 9.0)
    band = lum[int(H * 0.85):, :]
    y, x = np.unravel_index(np.argmin(band), band.shape)
    return ((x + 0.5) / W, (int(H * 0.85) + y + 0.5) / H)


# ------------------------------------------------------------------------------------------------ soft restyle
def soft_restyle(hair, face, body, L, st):
    """Preserve the authored VRoid hair: delete the ahoge (lock islands rising above the skull top) and lift the
    bang tips in front of the eyes by a smooth proportional field (no lock is re-routed).
      bang_lift 0.018    metres at eye level and below, fading to 0 at bang_top above the eyes
      bang_top 0.06      (relative to the eye line); bang_fwd 0.004: tips eased forward off the brows
      back_trim 0.0      fraction the back locks are shortened (toward the crown), smooth
    Returns a report."""
    head = HeadModel(face, body, L, st)
    me = hair.data
    P = np.array([tuple(v.co) for v in me.vertices])
    isl = islands(me)
    lim = head.top + st.get("ahoge_above", 0.035)
    kill = [i for ix in isl if P[ix][:, 2].max() > lim for i in ix]
    ez, c = L["ez"], head.c
    lift, top, fwd = st.get("bang_lift", 0.018), st.get("bang_top", 0.06), st.get("bang_fwd", 0.004)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]

    def ss(e0, e1, v):
        t = np.clip((v - e0) / (e1 - e0), 0, 1)
        return t * t * (3 - 2 * t)
    front = ss(c.x + 0.03, c.x + 0.09, x) * (1 - ss(0.085, 0.115, np.abs(y)))
    low = ss(ez + top, ez - 0.005, z)
    w = front * low
    P[:, 2] += lift * w
    P[:, 0] += fwd * w
    trim = st.get("back_trim", 0.0)
    if trim:
        back = ss(c.x - 0.02, c.x - 0.08, x)
        z0 = ez + 0.04
        below = z < z0
        P[below, 2] = z0 + (z[below] - z0) * (1 - trim * back[below])
    me.vertices.foreach_set("co", P.astype(np.float32).ravel())
    if kill:
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[i] for i in kill], context="VERTS")
        bm.to_mesh(me)
        bm.free()
    me.update()
    return {"ahoge_verts_removed": len(kill), "bang_verts_lifted": int((w > 0.01).sum()),
            "max_lift_m": round(float(lift * w.max()), 4)}
