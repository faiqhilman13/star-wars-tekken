"""COSTUME PHASE, KAEL (Obi-Wan ROTS adapted to LOOKS.kael): built procedurally around the fitted contract body.

  python tools/blender/run.py tools/blender/sd_costume_kael.py -- [--char kael]

Layers, inner to outer (all metres, contract frame: X forward, Y = far/left, Z up; az 0 = front, 90 = near):
  trousers  (MAT-kael_primary, shade 0.58)  body shell pelvis->calf, bloused over the boot tops, tucked below
  boots     (MAT-kael_leather)              body shell calf/foot, toes relaxed into a boot last, 15 mm sole + heel
  tunic     (MAT-kael_primary)              body shell torso + upper arms, V neck (wrap tip 1.2 cm to the near side)
  under     (MAT-kael_secondary)            cream undertunic showing in the V (higher, crossed neckline) + forearm cuffs
  sleeves   (MAT-kael_primary)              bell sleeves, ray-sampled loft round the arm, 1.6 -> 5.5 cm ease
  skirt     (MAT-kael_primary)              wrap skirt from the belt to mid-thigh (0.43 m), front overlap, 9 pleats,
                                            driven by skirt_<label>_0/1 bones on the game's 7 anchors (section 5)
  tabards   (MAT-kael_primary, shade 0.64)  strips over the shoulders front + back, tails over the skirt
  sash      (MAT-kael_trim)                 obi, 13 cm
  belt      (MAT-kael_leather)              4.5 cm, pouches, (MAT-kael_metal) buckle and hilt clip
Each piece records a "sd_shade" point attribute (value multiplier for the tintable fabric) and stays a separate
object in the master; sd_bake joins them per material on the delivery copy.
"""
import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sd_chars  # noqa: E402
import sd_cloth as K  # noqa: E402
import sd_contract as C  # noqa: E402
import sd_util as U  # noqa: E402

PHASE = "04_costume"
TAG = "phase:" + PHASE
TORSO = ("hips", "spine", "chest", "neck")
LEGS = ("thighN", "thighF", "shinN", "shinF", "footN", "footF")
ARMS = ("upperN", "upperF", "foreN", "foreF")

# skirt anchors from src/render/rig/costumes.ts (kael makeSkirt): az (0 front, 90 near), side for leg clearance
SKIRT = {"top": 0.075, "rx": 0.112, "rz": 0.162, "len": 0.43, "len1": 0.26, "flare": 0.16, "ease": 0.034,
         "anchors": [(30, "frontN"), (90, "near"), (148, "backN"), (180, "back"), (212, "backF"), (270, "far"), (330, "frontF")]}
REPORT = {}


def az_dir(az_deg):
    a = math.radians(az_deg)
    return Vector((math.cos(a), -math.sin(a), 0.0))      # game z (near) = Blender -Y


def tag(ob, shade=1.0, role=""):
    ob["owner"] = TAG
    ob["sd_piece"] = role
    K.set_attr(ob, "sd_shade", [shade] * len(ob.data.vertices))
    K.set_attr(ob, "sd_tone", [{"boots": 0.0, "belt": 0.5, "pouch": 1.0}.get(role, 0.5)] * len(ob.data.vertices))
    return ob


def push_out(ob, bvh, gap, max_dist=None, lateral=0.003):
    """Move garment vertices that sit inside (or closer than gap to) the given surface out along its normal.
    max_dist: only vertices whose nearest surface point is that close and lies under them (lateral offset from the
    normal line < `lateral`) - for a partial surface (a trimmed under-layer) whose open edge must not drag
    unrelated vertices onto it."""
    mw = ob.matrix_world
    inv = mw.inverted()
    moved = 0
    for v in ob.data.vertices:
        p = mw @ v.co
        loc, nrm, _, d = bvh.find_nearest(p)
        if loc is None:
            continue
        s = (p - loc).dot(nrm)
        if max_dist is not None and (d > max_dist or ((p - loc) - nrm * s).length > lateral):
            continue
        if s < gap:
            v.co = inv @ (loc + nrm * gap)
            moved += 1
    ob.data.update()
    return moved


# ------------------------------------------------------------------------------------------------ pieces
def v_tunic(p):
    """Front V of the tunic wrap (tip 1.2 cm toward the near side)."""
    return 1.455 + 2.3 * abs(p.y + 0.012)


def v_under(p):
    """Higher crossed neckline of the cream undertunic."""
    return 1.535 + 2.0 * abs(p.y - 0.006)


def collar_ok(p, d, v_fn, collar_z):
    if d == "head":
        return False
    if p.x > 0.015 and p.z > v_fn(p):
        return False
    if d == "neck" and p.z > collar_z:
        return False
    return True


def neck_cut(ob, tip, slope, y0, collar_r, z_from=1.60, axis_x=0.004, sides=12, top_z=None):
    """Straight V (two planes through the tip) and a collar that hugs the neck: a vertical prism of `sides` planes
    tangent to a circle of radius collar_r round the neck axis; faces inside it above z_from are removed."""
    n1 = Vector((0.0, -slope, 1.0)).normalized()
    n2 = Vector((0.0, slope, 1.0)).normalized()
    P = Vector((0.0, y0, tip))
    prism = []
    for k in range(sides):
        a = 2 * math.pi * (k + 0.5) / sides
        n = Vector((math.cos(a), math.sin(a), 0.0))
        prism.append((Vector((axis_x, 0.0, 0.0)) + n * collar_r, n))

    def inside_prism(c):
        return c.z > z_from and c.x < 0.03 and all((c - q).dot(n) < 0 for q, n in prism)

    def remove(c):
        in_v = c.x > 0.015 and (c - P).dot(n1) > 0 and (c - P).dot(n2) > 0
        # clean collar line round the base of the neck: a plane rising 0.15 m/m toward the nape
        above = top_z is not None and c.x < 0.03 and c.z > top_z - 0.15 * c.x
        return in_v or inside_prism(c) or above
    K.cut(ob, [(P, n1), (P, n2)], remove, region=lambda c: c.x > -0.02 and c.z > tip - 0.02)
    # the prism walls plus the z_from floor of the collar (bisected too, so the back of the collar is a clean line)
    K.cut(ob, prism + [(Vector((0.0, 0.0, z_from)), Vector((0.0, 0.0, 1.0)))], remove,
          region=lambda c: c.z > z_from - 0.02 and (c - Vector((axis_x, 0, c.z))).length < collar_r * 1.6)
    if top_z is not None:
        K.cut(ob, [(Vector((0.0, 0.0, top_z)), Vector((0.15, 0.0, 1.0)).normalized())], remove,
              region=lambda c: c.x < 0.04)


def build_tunic(body, W):
    def keep(f, pts):
        for v, p in zip(f.verts, pts):
            d = K.dominant(W[v.index])
            if d == "head" and p.z < 1.665 and p.x < 0.02:      # MPFB head weights reach down the nape
                d = "neck"
            if d not in ("hips", "spine", "chest", "neck", "upperN", "upperF"):
                return False
            if d == "neck" and p.z > 1.68:
                return False
            if d in ("upperN", "upperF") and p.z < 1.36:
                return False
            if p.z < 1.0 or d == "head" or p.z > 1.70:
                return False
        return True

    def ease(p, w):
        d = K.dominant(w)
        e = 0.012
        if p.z > 1.50:
            e = 0.0095
        if p.z < 1.17:
            e = 0.009
        if d == "neck":
            e = 0.006
        if d in TORSO:                                       # blouses over the sash
            e += 0.011 * math.exp(-((p.z - 1.205) / 0.035) ** 2)
        return e
    ob = K.shell_from_body(body, "GEO-kael_tunic", keep, ease, relax=10, relax_factor=0.5, decimate=None,
                           pin_boundary=True)
    # loose fit for the cloth drape (sd_drape): 2.8 cm more ease over the torso, tapering off over the shoulders,
    # anatomy relaxed away, the waist band cinched under the sash
    TW = K.vertex_weights(ob)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    for v in bm.verts:
        z = v.co.z
        arm_w = sum(TW[v.index].get(g, 0.0) for g in ("upperN", "upperF"))
        e = 0.028 * (1.0 - U.smoothstep(1.45, 1.56, z)) * (1.0 - min(1.0, arm_w * 1.5))   # torso only
        if 1.06 < z < 1.15:
            e = -0.004
        v.co += v.normal * e
    K.relax_bmesh(bm, 25, 0.5, True)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    push_out(ob, envelope_bvh(body, W, TORSO + ARMS), 0.005)
    neck_cut(ob, 1.455, 2.3, -0.012, 0.076, axis_x=0.012, top_z=1.655)
    ob["sd_thick"] = [0.0025, 0.0, 1]
    return tag(ob, 1.0, "tunic")


def build_under(body, W):
    def keep(f, pts):
        for v, p in zip(f.verts, pts):
            d = K.dominant(W[v.index])
            if d == "head" and p.z < 1.665 and p.x < 0.02:
                d = "neck"
            if d not in ("chest", "spine", "neck") or p.z < 1.36 or p.z > 1.69:
                return False
        return True
    ob = K.shell_from_body(body, "GEO-kael_under", keep, lambda p, w: 0.0032, relax=8, decimate=None,
                           pin_boundary=True)
    neck_cut(ob, 1.535, 2.0, 0.006, 0.068, axis_x=0.012, top_z=1.665)
    ob["sd_thick"] = [0.0016, -1.0, 1]
    return tag(ob, 1.0, "undertunic")


def boundary_loops(me, keep):
    """Ordered boundary vertex loops of a mesh (lists of vertex indices) whose vertices pass keep(co)."""
    adj = {}
    for e in me.edges:
        pass
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.edges.ensure_lookup_table()
    for e in bm.edges:
        if e.is_boundary:
            a, b = e.verts[0].index, e.verts[1].index
            adj.setdefault(a, []).append(b)
            adj.setdefault(b, []).append(a)
    co = {v.index: v.co.copy() for v in bm.verts}
    bm.free()
    seen, loops = set(), []
    for start in adj:
        if start in seen:
            continue
        loop, cur, prev = [start], start, None
        seen.add(start)
        while True:
            nxt = [n for n in adj[cur] if n != prev and n not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            seen.add(cur)
            loop.append(cur)
        loops.append([i for i in loop if keep(co[i])])
    return [l for l in loops if len(l) > 3], co


def lapel(src, name, width, lift, shade, role, zmin=1.40):
    """Folded lapel / collar facing: a ribbon along the garment's neck-opening edge, lying on the garment (lifted
    by `lift`), `width` wide toward the garment interior (direction from each edge vertex to its interior
    neighbours), with a short turned edge so the band reads as doubled cloth."""
    me = src.data
    loops, co = boundary_loops(me, lambda c: c.z > zmin and abs(c.y) < 0.14)
    if not loops:
        return None
    loop = max(loops, key=len)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(src, dg)
    rows = [[], [], []]
    prev_in = None
    for i in loop:
        v = bm.verts[i]
        nrm = v.normal.copy()
        inner = [e.other_vert(v).co for e in v.link_edges if not e.is_boundary]
        if inner:
            d = sum((q - v.co for q in inner), Vector()) / len(inner)
        else:
            d = prev_in if prev_in is not None else Vector((0, 0, -1))
        d = (d - nrm * d.dot(nrm)).normalized()
        if prev_in is not None and d.dot(prev_in) < 0.3:
            d = (d + prev_in).normalized()
        prev_in = d
        p = v.co
        loc2, nrm2, _, _ = bvh.find_nearest(p + d * width)
        b = (loc2 + nrm2 * lift) if loc2 is not None else p + d * width + nrm * lift
        rows[0].append(p + nrm * (lift * 0.3) - d * 0.002)
        rows[1].append(p + nrm * lift)
        rows[2].append(b)
    bm.free()
    ob = K.grid_object(name, rows)
    return tag(ob, shade, role)


def collar_band(src, name, width, lift, overhang, shade, role, zmin=1.40, ymax=0.14, n=72, smooth=8):
    """Folded collar / lapel band over a garment's neck opening: the opening's boundary loop is smoothed (no
    stair steps from the body topology) and resampled evenly, then a ribbon `width` wide is laid on the garment
    beside it (lifted `lift`), overhanging the raw edge by `overhang` into the opening so the cut never shows.
    Built before the garment is thickened (needs its open boundary). Returns the band object (tagged)."""
    loops, co = boundary_loops(src.data, lambda c: c.z > zmin and abs(c.y) < ymax)
    if not loops:
        return None
    loop = max(loops, key=len)
    P = [co[i].copy() for i in loop]
    m = len(P)
    for _ in range(smooth):
        P = [P[k] * 0.5 + (P[k - 1] + P[(k + 1) % m]) * 0.25 for k in range(m)]
    seg = [(P[(k + 1) % m] - P[k]).length for k in range(m)]
    total = sum(seg)
    pts, acc, k = [], 0.0, 0
    for j in range(n):
        target = total * j / n
        while acc + seg[k] < target:
            acc += seg[k]
            k += 1
        t = (target - acc) / max(seg[k], 1e-9)
        pts.append(P[k].lerp(P[(k + 1) % m], t))
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(src, dg)
    rows = [[], [], []]
    for j in range(n):
        p = pts[j]
        loc, nrm, _, _ = bvh.find_nearest(p)
        nrm = nrm if loc is not None else Vector((0, 0, 1))
        t = (pts[(j + 1) % n] - pts[j - 1]).normalized()
        d = nrm.cross(t).normalized()
        # the garment side is where a step off the edge stays on the cloth
        dp = (bvh.find_nearest(p + d * 0.01)[0] - (p + d * 0.01)).length
        dm = (bvh.find_nearest(p - d * 0.01)[0] - (p - d * 0.01)).length
        if dm < dp:
            d = -d
        far = p + d * width
        lf, nf, _, _ = bvh.find_nearest(far)
        rows[0].append(p - d * overhang + nrm * (lift * 0.6))
        rows[1].append(p + d * (width * 0.45) + nrm * lift)
        rows[2].append((lf + nf * lift * 0.5) if lf is not None else far + nrm * lift * 0.5)
    ob = K.grid_object(name, rows, closed=True)
    ob["sd_edge"] = [c for p in pts for c in p]          # smoothed opening edge (for trimming overlying pieces)
    return tag(ob, shade, role)


def trim_under_band(ob, band, reach):
    """Delete faces of a piece lying over a collar band's edge zone (centre within `reach` of the smoothed opening
    edge), so its own stair-stepped top ends tucked under the band."""
    from mathutils import kdtree
    e = band["sd_edge"]
    pts = [Vector(e[i:i + 3]) for i in range(0, len(e), 3)]
    kd = kdtree.KDTree(len(pts))
    for i, p in enumerate(pts):
        kd.insert(p, i)
    kd.balance()
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    kill = [f for f in bm.faces if kd.find(f.calc_center_median())[2] < reach]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return len(kill)


def lapel_shade(ob, width, shade):
    """Darken sd_shade within `width` of the garment's neck-opening edge (the folded lapel / collar facing)."""
    from mathutils import kdtree
    me = ob.data
    loops, co = boundary_loops(me, lambda c: c.z > 1.42 and abs(c.y) < 0.14)
    pts = [co[i] for l in loops for i in l]
    if not pts:
        return
    kd = kdtree.KDTree(len(pts))
    for i, c in enumerate(pts):
        kd.insert(c, i)
    kd.balance()
    attr = me.attributes["sd_shade"]
    vals = [a.value for a in attr.data]
    for v in me.vertices:
        d = kd.find(v.co)[2]
        if d < width:
            vals[v.index] *= shade + (1.0 - shade) * U.smoothstep(width * 0.7, width, d)
    attr.data.foreach_set("value", vals)


def build_cuffs(body, W):
    def keep(f, pts):
        for v, p in zip(f.verts, pts):
            if K.dominant(W[v.index]) not in ("foreN", "foreF") or not (1.045 <= p.z <= 1.27):
                return False
        return True
    ob = K.shell_from_body(body, "GEO-kael_cuffs", keep, lambda p, w: 0.0045, relax=3, decimate=None)
    ob["sd_thick"] = [0.0018, -1.0, 1]
    return tag(ob, 1.0, "cuffs")


def build_trousers(body, W):
    def keep(f, pts):
        for v, p in zip(f.verts, pts):
            d = K.dominant(W[v.index])
            if d not in ("hips", "spine") + LEGS[:4]:
                return False
            if p.z > 1.13 or p.z < 0.40:
                return False
        return True

    def ease(p, w):
        if p.z < 0.52:
            return 0.003                                   # tucked into the boots
        if p.z < 0.62:
            return 0.003 + 0.018 * U.smoothstep(0.52, 0.57, p.z)   # bloused over the boot tops
        if p.z < 0.95:
            return 0.022
        return 0.012
    ob = K.shell_from_body(body, "GEO-kael_trousers", keep, ease, relax=12, decimate=None)
    ob["sd_thick"] = [0.002, -1.0, 1]
    return tag(ob, 0.58, "trousers")


def build_boots(body, W):
    """Tall boots: rings along a bent leg->foot axis (parallel-transported frames), radius = outer leg/foot
    envelope + leather ease, flared cuff, capped toe, 15 mm sole with a heel block."""
    pieces = []
    for side in (-1, 1):
        s_ = "N" if side < 0 else "F"
        y = side * 0.10
        env = envelope_bvh(body, W, ("shin" + s_, "foot" + s_))
        axis = [Vector((0.0, y, z)) for z in (0.50, 0.47, 0.43, 0.39, 0.35, 0.31, 0.27, 0.23, 0.19, 0.16)]
        for t in (0.2, 0.4, 0.6, 0.8, 1.0):                      # heel bend
            a = math.radians(90 * t)
            axis.append(Vector((0.085 - 0.085 * math.cos(a), y, 0.16 - 0.105 * math.sin(a))))
        axis += [Vector((x, y, z)) for x, z in ((0.125, 0.048), (0.16, 0.041), (0.19, 0.036), (0.212, 0.033))]
        n = len(axis)

        def rad(i, c, d):
            r = K.outer_radius(env, c, d, 0.25)
            r = 0.035 if r is None else r
            e = 0.009 if c.z > 0.12 else 0.0065
            e += 0.013 * U.smoothstep(0.44, 0.50, c.z)            # flared cuff
            if i >= n - 2:                                         # toe box: round off the last rings
                r = r * (0.9 if i == n - 2 else 0.7)
            return max(r + e, 0.018)
        ob = K.bent_axis_loft("GEO-kael_boot_" + s_, axis, 20, rad, up_hint=Vector((1, 0, 0)))
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.verts.ensure_lookup_table()
        # domed toe: two shrinking rings and a tip
        last = bm.verts[-20:]
        fwd = (axis[-1] - axis[-2]).normalized()
        ctr = axis[-1]
        prev = list(last)
        for sc, dz in ((0.78, 0.010), (0.45, 0.018)):
            ring = [bm.verts.new(ctr + (v.co - ctr) * sc + fwd * dz) for v in last]
            for k in range(20):
                bm.faces.new((prev[k], prev[(k + 1) % 20], ring[(k + 1) % 20], ring[k]))
            prev = ring
        tip = bm.verts.new(ctr + fwd * 0.022)
        for k in range(20):
            bm.faces.new((prev[k], prev[(k + 1) % 20], tip))
        for v in bm.verts:
            if v.co.z < 0.017:
                v.co.z = 0.017
        bm.normal_update()
        K.relax_bmesh(bm, 4, 0.4, verts=[v for v in bm.verts if 0.03 < v.co.z < 0.45])
        # cuff turned inside (leather thickness at the opening)
        bm.verts.ensure_lookup_table()
        top = [v for v in bm.verts if abs(v.co.z - 0.50) < 1e-4]
        ret = bmesh.ops.extrude_edge_only(bm, edges=[e for e in bm.edges if e.verts[0] in top and e.verts[1] in top])
        for v in [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]:
            c = Vector((0.0, y, v.co.z))
            v.co = c + (v.co - c) * 0.93 - Vector((0, 0, 0.025))
        # sole: convex hull of the tread outline, 4 mm proud, 17 mm thick; heel block under the back third
        from mathutils.geometry import convex_hull_2d
        tread = [v.co.copy() for v in bm.verts if v.co.z < 0.03]
        hull = [tread[i] for i in convex_hull_2d([(p.x, p.y) for p in tread])]
        hc = sum(hull, Vector()) / len(hull)
        outline = [Vector((p.x, p.y, 0.0)) + (Vector((p.x, p.y, 0.0)) - Vector((hc.x, hc.y, 0.0))).normalized() * 0.004
                   for p in hull]
        lo = [bm.verts.new((p.x, p.y, 0.0)) for p in outline]
        hi = [bm.verts.new((p.x, p.y, 0.018 + (0.012 if p.x < hc.x - 0.04 else 0.0))) for p in outline]
        m = len(outline)
        for k in range(m):
            bm.faces.new((lo[k], lo[(k + 1) % m], hi[(k + 1) % m], hi[k]))
        bm.faces.new(list(reversed(lo)))
        bm.faces.new(hi)
        bm.normal_update()
        bm.to_mesh(ob.data)
        bm.free()
        ob.data.update()
        K.ensure_outward(ob, lambda c: Vector((min(max(c.x, 0.0), 0.15), y, min(c.z, 0.3))))
        K.transfer_weights(ob, body, lambda i: K.dominant(W[i]) in ("shin" + s_, "foot" + s_))
        pieces.append(tag(ob, 1.0, "boots"))
    return pieces


def envelope_bvh(body, W, groups):
    keep = lambda i: K.dominant(W[i]) in groups  # noqa: E731
    bvh, _, _ = K.region_bvh(body, keep)
    return bvh


def skirt_weights(az, d):
    """Game makeSkirt weights: hips at the waistband, then the two nearest anchors, upper -> lower by drop d."""
    S = SKIRT
    wtop = U.smoothstep(0.0, 0.1, d)
    wlow = U.smoothstep(S["len1"] - 0.09, S["len1"] + 0.07, d)
    anc = sorted(S["anchors"])
    seq = [(a - 360, n) for a, n in anc] + anc + [(a + 360, n) for a, n in anc]
    i = max(k for k in range(len(seq) - 1) if seq[k][0] <= az)
    a0, n0 = seq[i]
    a1, n1 = seq[i + 1]
    f = U.smoothstep(0.0, 1.0, (az - a0) / (a1 - a0))
    w = {"hips": 1.0 - wtop}
    for n, m in ((n0, 1.0 - f), (n1, f)):
        w["skirt_%s_0" % n] = w.get("skirt_%s_0" % n, 0.0) + wtop * (1.0 - wlow) * m
        w["skirt_%s_1" % n] = w.get("skirt_%s_1" % n, 0.0) + wtop * wlow * m
    return w


def skirt_surface(env, az, d, ease0, extra=0.0, cache=None):
    """Skirt radius at azimuth az and drop d below the waistband pivot (cumulative max of the hip envelope)."""
    S = SKIRT
    top = 1.02 + S["top"]
    key = (round(az, 2), round(d, 4))
    r = 0.0
    zs = [top - d * t for t in (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)]
    for z in zs:
        e = K.outer_radius(env, Vector((0, 0, z)), az_dir(az))
        if e is not None:
            r = max(r, e)
    cone = r + ease0 + S["flare"] * d * 0.8
    a = math.radians(az)
    pleat = U.smoothstep(0.0, 0.22, d) * (0.0065 * math.sin(a * 9) + 0.004 * math.sin(a * 5 + 1.3) +
                                          0.0025 * math.sin(a * 14 + 0.7))
    return cone + pleat + extra


def skirt_panel(name, env, az0, az1, extra_fn, step=6.0, nrow=14):
    """One skirt panel from az0 to az1 (degrees, may run past 360 / below 0): rows by drop d below the waistband,
    the last row a 1.4 cm turned-up hem facing inside. Weights from the game's anchors (skirt_weights)."""
    S = SKIRT
    top = 1.02 + S["top"]
    n = int(round((az1 - az0) / step)) + 1
    az_list = [az0 + (az1 - az0) * i / (n - 1) for i in range(n)]
    rows, meta = [], []
    for r_i in range(nrow + 1):
        hemrow = r_i == nrow
        d = S["len"] * min(r_i, nrow - 1) / (nrow - 1)
        row = []
        for az in az_list:
            a = math.radians(az)
            dd = d * (1.0 + 0.035 * math.sin(a * 2 + 0.4) + 0.02 * math.sin(a * 5 + 2.1)) if d > 0 else 0.0
            rad = skirt_surface(env, az, dd, S["ease"], extra_fn(az, dd))
            p = az_dir(az) * rad + Vector((0, 0, top - dd))
            if hemrow:
                p = az_dir(az) * (rad - 0.004) + Vector((0, 0, top - dd + 0.014))
            row.append(p)
            meta.append((az % 360.0, dd))
        rows.append(row)
    ob = K.grid_object(name, rows)
    K.ensure_outward(ob, lambda c: Vector((0, 0, c.z)))
    for v, (az, d) in zip(ob.data.vertices, meta):
        K.set_weights(ob, v.index, skirt_weights(az, d))
    ob["sd_thick"] = [0.0025, -1.0, 1]
    return tag(ob, 1.0, "skirt")


def build_skirt(body, W, env):
    """Tunic skirt split at both sides: a back panel and two front panels crossing over (wearer's left over right,
    the over-panel edge just past the centre on the near side). Side edges overlap at the waist and part toward
    the hem; the back panel tucks under the fronts."""
    def back(az, d):
        edge = min(abs(az - 84.0), abs(az - 276.0))
        return -0.009 * (1.0 - U.smoothstep(0.0, 16.0, edge))

    def under(az, d):
        return 0.0

    def over(az, d):
        return 0.010
    pieces = [skirt_panel("GEO-kael_skirt_back", env, 84.0, 276.0, back),
              skirt_panel("GEO-kael_skirt_under", env, -18.0, 96.0, under),
              skirt_panel("GEO-kael_skirt_over", env, -96.0, 14.0, over)]
    return pieces, None


def build_tabard_tails(env):
    pieces = []
    S = SKIRT
    top = 1.02 + S["top"] + 0.04
    for a0, a1 in ((16, 40), (320, 344), (140, 164), (196, 220)):
        rows = []
        meta = []
        nrow = 12
        for r_i in range(nrow):
            d = -0.04 + (S["len"] + 0.03) * r_i / (nrow - 1)
            row = []
            for c in range(4):
                az = a0 + (a1 - a0) * c / 3
                dd = max(0.0, d)
                rad = skirt_surface(env, az, dd, S["ease"], 0.0) + 0.016
                z = 1.02 + S["top"] - d
                row.append(az_dir(az) * rad + Vector((0, 0, z)))
                meta.append((az, dd))
            rows.append(row)
        ob = K.grid_object("GEO-kael_tabtail_%d" % a0, rows)
        K.ensure_outward(ob, lambda c: Vector((0, 0, c.z)))
        for v, (az, dd) in zip(ob.data.vertices, meta):
            K.set_weights(ob, v.index, skirt_weights(az, dd))
        pieces.append(tag(ob, 0.64, "tabard_tail"))
    return pieces


def build_tabards(tunic):
    """Tabards: the tunic band 6-13 cm either side of the midline from the sash up over the shoulders and down the
    back, cut clean with vertical planes and lifted 4.5 mm off the tunic (its own edges read as cloth)."""
    pieces = []
    for side in (-1, 1):
        ob = tunic.copy()
        ob.data = tunic.data.copy()
        U.col("LOW").objects.link(ob)
        ob.name = ob.data.name = "GEO-kael_tabard_%s" % ("N" if side < 0 else "F")
        ob.hide_render = False
        for k in ("sd_thick",):
            if k in ob.keys():
                del ob[k]
        y_in, y_out = side * 0.06, side * 0.13
        planes = [(Vector((0, y_in, 0)), Vector((0, 1, 0))), (Vector((0, y_out, 0)), Vector((0, 1, 0))),
                  (Vector((0, 0, 1.155)), Vector((0, 0, 1)))]

        def remove(c, a=min(y_in, y_out), b=max(y_in, y_out)):
            # stop short of the collar at the back (the tabards pass under it over the shoulders)
            return not (a < c.y < b) or c.z < 1.155
        K.cut(ob, planes, remove)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.normal_update()
        for v in bm.verts:
            v.co += v.normal * 0.0045
        bm.to_mesh(ob.data)
        bm.free()
        ob.data.update()
        pieces.append(tag(ob, 0.64, "tabard"))
    return pieces


def arm_loft(body, W, side, name, z_top, z_bot, ease_top, ease_bot, n_around=22, n_rows=13, pleats=6, hem=0.014):
    s = "N" if side < 0 else "F"
    y = side * 0.19
    env = envelope_bvh(body, W, ("upper" + s, "fore" + s))
    rows = []
    for r_i in range(n_rows):
        t = r_i / (n_rows - 1)
        z = z_top + (z_bot - z_top) * t
        c = Vector((0.0, y, z))
        row = []
        for k in range(n_around):
            a = 2 * math.pi * k / n_around
            dv = Vector((math.cos(a), math.sin(a), 0.0))
            r = K.outer_radius(env, c, dv, 0.25)
            r = r if r is not None else 0.05
            e = ease_top + (ease_bot - ease_top) * (t ** 1.7)
            e += (0.002 + 0.007 * t ** 1.5) * (math.sin(a * pleats + 0.6) + 0.45 * math.sin(a * 3 + 1.9 + 2.0 * t))
            row.append(c + dv * (r + e))
        rows.append(row)
    # turned-up hem facing inside the cuff (reads as cloth thickness)
    cz = Vector((0.0, y, z_bot))
    rows.append([cz + (p - cz) * 0.97 + Vector((0, 0, hem)) for p in rows[-1]])
    ob = K.grid_object(name, rows, closed=True)
    K.ensure_outward(ob, lambda cc: Vector((0.0, y, cc.z)))
    keep = lambda i: K.dominant(W[i]) in ("upper" + s, "fore" + s)  # noqa: E731
    K.transfer_weights(ob, body, keep)
    return ob


def ring_band(name, env, z_lo, z_hi, offset, n_around=44, n_rows=4, wrinkle=0.0, floor_fn=None, tuck=0.0):
    rows = []
    for r_i in range(n_rows):
        z = z_hi - (z_hi - z_lo) * r_i / (n_rows - 1)
        row = []
        for k in range(n_around):
            az = 360.0 * k / n_around
            r = 0.0
            for zz in (z - 0.008, z, z + 0.008):
                e = K.outer_radius(env, Vector((0, 0, zz)), az_dir(az))
                r = max(r, e or 0.0)
            if floor_fn:
                r = max(r, floor_fn(az, z) - offset + 0.004)
            r += offset + wrinkle * math.sin(math.radians(az) * 13 + r_i * 1.7)
            if r_i in (0, n_rows - 1) and tuck:
                r -= tuck
            row.append(az_dir(az) * r + Vector((0, 0, z)))
        rows.append(row)
    ob = K.grid_object(name, rows, closed=True)
    K.ensure_outward(ob, lambda c: Vector((0, 0, c.z)))
    return ob


def box(name, size, loc, rot_z=0.0, bevel=0.003):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES")
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    U.col("LOW").objects.link(ob)
    ob.matrix_world = Matrix.Translation(loc) @ Matrix.Rotation(rot_z, 4, "Z")
    me.transform(ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)
    for p in me.polygons:
        p.use_smooth = False
    return ob


def build_belt_kit(env_belt_r, body):
    """Buckle, pouches and the hilt clip seated on the belt (radius sampler env_belt_r(az) -> belt outer radius)."""
    pieces = []
    zc = 1.0875
    # buckle (metal), front
    r = env_belt_r(0)
    pieces.append(tag(box("GEO-kael_buckle", (0.012, 0.062, 0.05), az_dir(0) * (r + 0.004) + Vector((0, 0, zc)), 0.0,
                          bevel=0.003), 1.0, "buckle"))
    # pouches (leather): body + flap, hung from the belt
    for az, w in ((38, 0.052), (63, 0.046), (-40, 0.052), (-64, 0.046), (118, 0.044)):
        r = env_belt_r(az % 360)
        rz = -math.radians(az)
        c = az_dir(az) * (r + 0.016) + Vector((0, 0, zc - 0.022))
        p = box("GEO-kael_pouch_%d" % az, (0.03, w, 0.058), c, rz, bevel=0.007)
        flap = box("GEO-kael_flap_%d" % az, (0.034, w + 0.004, 0.022), c + az_dir(az) * 0.003 + Vector((0, 0, 0.022)), rz,
                   bevel=0.004)
        pieces += [tag(p, 1.0, "pouch"), tag(flap, 1.0, "pouch")]
    # hilt clip (metal) on the near hip: plate + D-ring
    az = 100
    r = env_belt_r(az)
    c = az_dir(az) * (r + 0.006) + Vector((0, 0, zc))
    pieces.append(tag(box("GEO-kael_clip", (0.008, 0.028, 0.06), c, -math.radians(az), bevel=0.002), 1.0, "clip"))
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=False, radius=0.016, segments=12)
    ring = bpy.data.meshes.new("GEO-kael_dring")
    bm.to_mesh(ring)
    bm.free()
    ro = bpy.data.objects.new("GEO-kael_dring", ring)
    U.col("LOW").objects.link(ro)
    sk = ro.modifiers.new("skin", "SKIN")
    for sv in ring.skin_vertices[0].data:
        sv.radius = (0.0025, 0.0025)
    K.apply_modifiers(ro)
    ro.data.transform(Matrix.Translation(c + az_dir(az) * 0.006 - Vector((0, 0, 0.034))) @
                      Matrix.Rotation(-math.radians(az), 4, "Z") @ Matrix.Rotation(math.radians(90), 4, "Y"))
    pieces.append(tag(ro, 1.0, "clip"))
    return pieces


# ------------------------------------------------------------------------------------------------ coverage
def occlude(ob, occluder, radius=0.045, zmin=1.25, ymax=0.13, keep_y=0.105):
    """Keep only the part of a lower garment layer that can show: faces within `radius` of the occluder's neck
    opening (its boundary edges above zmin, |y| < ymax). Everything else is hidden under the occluder at rest and,
    being a different-density shell, would only poke through it when the torso bends or twists. Returns tris
    removed."""
    from mathutils import kdtree
    before = K.tris(ob)
    ome = occluder.data
    edge_faces = {}
    for p in ome.polygons:
        for ek in p.edge_keys:
            edge_faces[ek] = edge_faces.get(ek, 0) + 1
    rim = {i for ek, n in edge_faces.items() if n == 1 for i in ek
           if ome.vertices[i].co.z > zmin and abs(ome.vertices[i].co.y) < ymax}
    if not rim:
        return 0
    kd = kdtree.KDTree(len(rim))
    for k, i in enumerate(sorted(rim)):
        kd.insert(ome.vertices[i].co, k)
    kd.balance()
    me = ob.data
    near = {v.index for v in me.vertices if kd.find(v.co)[2] <= radius and abs(v.co.y) < keep_y}
    bm = bmesh.new()
    bm.from_mesh(me)
    kill = [f for f in bm.faces if not all(v.index in near for v in f.verts)]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me.update()
    return before - K.tris(ob)


def coverage(body, W, garments):
    """Body vertex group sd_visible. Skin is hidden only where a ray along its normal hits an opaque garment within
    5 cm (so the hidden region always lies under cloth), dilated by one ring of neighbours kept visible at the
    edge; head, hands and the wrists below the cuffs always stay. A Mask modifier applies it in the master
    (non-destructive); sd_bake deletes the hidden skin on the delivery copy."""
    dg = bpy.context.evaluated_depsgraph_get()
    import bmesh as _bm
    tb = _bm.new()
    for g in garments:
        me = g.evaluated_get(dg).to_mesh()
        me.transform(g.matrix_world)
        tb.from_mesh(me)
        g.evaluated_get(dg).to_mesh_clear()
    bvh = BVHTree.FromBMesh(tb)
    tb.free()
    mw = body.matrix_world
    n3 = mw.to_3x3()
    hidden = set()
    poked = set()
    for v in body.data.vertices:
        p = mw @ v.co
        d = K.dominant(W[v.index])
        if d in ("head", "handN", "handF") or (d in ("foreN", "foreF") and p.z < 1.075):
            continue
        if d in ("shinN", "shinF", "footN", "footF", "thighN", "thighF", "hips", "spine", "upperN", "upperF"):
            hidden.add(v.index)
            continue
        nrm = (n3 @ v.normal).normalized()
        hit = bvh.ray_cast(p + nrm * 0.001, nrm, 0.05)
        if hit[0] is not None:
            hidden.add(v.index)
            continue
        # skin poking out through a garment (a flat decimated face dipping under a curved shoulder): looking inward
        # the ray meets the garment's outer face first -> hide the skin, the garment shows instead
        hit = bvh.ray_cast(p - nrm * 0.0005, -nrm, 0.015)
        if hit[0] is not None and hit[1].dot(nrm) > 0.3:
            hidden.add(v.index)
            poked.add(v.index)
    # keep a one-ring margin of skin visible around any hidden region boundary (overlap under the garment edge)
    nb = {}
    for e in body.data.edges:
        a, b = e.vertices
        nb.setdefault(a, []).append(b)
        nb.setdefault(b, []).append(a)
    edge = {i for i in hidden if any(j not in hidden for j in nb.get(i, [])) and K.dominant(W[i]) not in
            ("shinN", "shinF", "footN", "footF", "thighN", "thighF", "hips", "spine", "upperN", "upperF")}
    hidden -= edge - poked
    REPORT["skin_poke_hidden"] = len(poked)
    vis = [v.index for v in body.data.vertices if v.index not in hidden]
    vg = body.vertex_groups.get("sd_visible") or body.vertex_groups.new(name="sd_visible")
    vg.remove([v.index for v in body.data.vertices])
    vg.add(vis, 1.0, "REPLACE")
    m = body.modifiers.get("sd_coverage") or body.modifiers.new("sd_coverage", "MASK")
    m.vertex_group = "sd_visible"
    m.invert_vertex_group = False
    return len(vis)


# ------------------------------------------------------------------------------------------------ skirt bones
def skirt_bones(arm):
    S = SKIRT
    U.set_active(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for b in [b for b in eb if b.name.startswith("skirt_")]:
        eb.remove(b)
    made = []
    for az, label in S["anchors"]:
        a = math.radians(az)
        # game coordinates (x fwd, y up, z near) -> Blender (x, -z, y)
        g0 = (S["rx"] * math.cos(a), 1.02 + S["top"], S["rz"] * math.sin(a))
        low = (S["flare"] * S["len1"] * math.cos(a), -S["len1"], S["flare"] * S["len1"] * math.sin(a))
        g1 = (g0[0] + low[0], g0[1] + low[1], g0[2] + low[2])
        b0 = eb.new("skirt_%s_0" % label)
        b0.head = Vector(C.game_to_blender(g0))
        b0.tail = b0.head + Vector((0, 0, 0.06))
        b0.roll = 0.0
        b0.parent = eb["hips"]
        b1 = eb.new("skirt_%s_1" % label)
        b1.head = Vector(C.game_to_blender(g1))
        b1.tail = b1.head + Vector((0, 0, 0.06))
        b1.roll = 0.0
        b1.parent = b0
        made += [b0.name, b1.name]
    bpy.ops.object.mode_set(mode="OBJECT")
    return made


# ------------------------------------------------------------------------------------------------ materials
ROLE_MAT = {"lapel": "primary", "collar": "secondary", "tunic": "primary", "skirt": "primary", "sleeve": "primary", "trousers": "primary", "tabard": "primary",
            "tabard_tail": "primary", "undertunic": "secondary", "cuffs": "secondary", "sash": "trim",
            "belt": "leather", "boots": "leather", "pouch": "leather", "buckle": "metal", "clip": "metal"}


def assign_placeholder_materials(pieces, cfg):
    """Contract material per piece. If sd_matlib has built the look-dev materials they are reused; otherwise a flat
    palette stand-in (colour x sd_shade attribute) is made so review renders read before look-dev."""
    import sd_matlib
    mats = sd_matlib.ensure_costume_materials(cfg)
    for ob in pieces:
        role = ob.get("sd_piece", "")
        m = mats[ROLE_MAT[role]]
        ob.data.materials.clear()
        ob.data.materials.append(m)


# ------------------------------------------------------------------------------------------------ drape spec
def _band(z, lo, hi, feather=0.01):
    return U.smoothstep(lo - feather, lo, z) * (1.0 - U.smoothstep(hi, hi + feather, z))


def drape_spec():
    """sd_drape settings per piece, inner layers first. pin(co, on_boundary) -> 0..1 (cloth pin weight)."""
    top = 1.02 + SKIRT["top"]
    soft = {"stiffness": 12.0, "shear": 4.0, "bending": 0.35, "mass": 0.2, "quality": 8}
    wool = {"stiffness": 15.0, "shear": 5.0, "bending": 0.6, "mass": 0.3, "quality": 8}

    def tunic_pin(c, b):
        w = 0.6 * U.smoothstep(1.56, 1.62, c.z) if abs(c.y) < 0.12 else 0.0
        if c.z < 1.14:
            w = max(w, 1.0 - U.smoothstep(1.10, 1.14, c.z))         # cinched under the sash
        if b and c.z > 1.40 and abs(c.y) < 0.14:
            w = max(w, 0.8)                                         # neck opening keeps its line
        return w

    def trousers_pin(c, b):
        return max(U.smoothstep(1.03, 1.07, c.z), 1.0 - U.smoothstep(0.47, 0.50, c.z))

    def skirt_pin(c, b):
        return U.smoothstep(top - 0.045, top - 0.02, c.z)

    def sleeve_pin(c, b):
        return U.smoothstep(1.50, 1.535, c.z)

    def tail_pin(c, b):
        return U.smoothstep(top - 0.01, top + 0.02, c.z)

    def sash_mask(c):
        return 1.0

    def ankle(c):
        return _band(c.z, 0.08, 0.21, 0.03)
    pieces = [
        {"name": "GEO-kael_under", "subdiv": 2, "low_tris": 500,
         "creases": [{"amp": 0.0012, "scale": (60, 60, 40)}]},
        {"name": "GEO-kael_cuffs", "subdiv": 2, "low_tris": 500,
         "creases": [{"amp": 0.0018, "scale": (18, 18, 110), "ridged": True}]},
        {"name": "GEO-kael_trousers", "subdiv": 1, "post_subdiv": 1, "low_tris": 1700, "pin": trousers_pin,
         "seams": [((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), lambda p: abs(p.y) > 0.10 and p.z < 0.95)],
         "sim": dict(soft, shrink=-0.05, frames=50), "colliders_low": ["GEO-kael_boot_N", "GEO-kael_boot_F"]},
        {"name": "GEO-kael_tunic", "subdiv": 1, "post_subdiv": 1, "low_tris": 2800, "pin": tunic_pin,
         "seams": [((-0.012, 0.0, 0.0), (1.0, 0.0, 0.0), lambda p: abs(p.y) > 0.07)],      # shoulder + side seams
         "sim": dict(soft, shrink=-0.035, frames=60), "colliders": ["GEO-kael_under"]},
        {"name": "GEO-kael_skirt_back", "subdiv": 1, "post_subdiv": 1, "low_tris": 900, "pin": skirt_pin,
         "sim": dict(wool, shrink=-0.02, frames=50, distance=0.002, collide_outer=0.002), "colliders": ["GEO-kael_trousers"]},
        {"name": "GEO-kael_skirt_under", "subdiv": 1, "post_subdiv": 1, "low_tris": 600, "pin": skirt_pin,
         "sim": dict(wool, shrink=-0.02, frames=50, distance=0.002, collide_outer=0.002),
         "colliders": ["GEO-kael_trousers", "GEO-kael_skirt_back"]},
        {"name": "GEO-kael_skirt_over", "subdiv": 1, "post_subdiv": 1, "low_tris": 600, "pin": skirt_pin,
         "sim": dict(wool, shrink=-0.02, frames=50, distance=0.002, collide_outer=0.002),
         "colliders": ["GEO-kael_trousers", "GEO-kael_skirt_back", "GEO-kael_skirt_under"]},
        {"name": "GEO-kael_sleeve_N", "subdiv": 1, "post_subdiv": 1, "low_tris": 900, "pin": sleeve_pin,
         "seams": [((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), lambda p: abs(p.y) < 0.19)],         # inner arm seam
         "sim": dict(wool, bending=2.5, shrink=-0.03, frames=60), "colliders": ["GEO-kael_tunic"]},
        {"name": "GEO-kael_sleeve_F", "subdiv": 1, "post_subdiv": 1, "low_tris": 900, "pin": sleeve_pin,
         "seams": [((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), lambda p: abs(p.y) < 0.19)],         # inner arm seam
         "sim": dict(wool, bending=2.5, shrink=-0.03, frames=60), "colliders": ["GEO-kael_tunic"]},
        {"name": "GEO-kael_sash", "subdiv": 2, "low_tris": 900,
         "creases": [{"amp": 0.0028, "scale": (7, 7, 150), "ridged": True, "mask": sash_mask}]},
        {"name": "GEO-kael_belt", "subdiv": 1, "low_tris": 400,
         "creases": [{"amp": 0.0006, "scale": (30, 30, 30)}]},
        {"name": "GEO-kael_boot_N", "subdiv": 2, "low_tris": 1000,
         "creases": [{"amp": 0.0022, "scale": (22, 22, 150), "ridged": True, "mask": ankle}]},
        {"name": "GEO-kael_boot_F", "subdiv": 2, "low_tris": 1000,
         "creases": [{"amp": 0.0022, "scale": (22, 22, 150), "ridged": True, "mask": ankle, "offset": (9.3, 2.2, 5.1)}]},
    ]
    for t in ("16", "320", "140", "196"):
        pieces.append({"name": "GEO-kael_tabtail_%s" % t, "subdiv": 2, "low_tris": 90, "pin": tail_pin,
                       "sim": dict(wool, shrink=0.0, frames=30),
                       "colliders": ["GEO-kael_skirt_back", "GEO-kael_skirt_under", "GEO-kael_skirt_over"]})
    for n in ("buckle", "clip", "dring") + tuple("pouch_%s" % a for a in ("38", "63", "-40", "-64", "118")) +             tuple("flap_%s" % a for a in ("38", "63", "-40", "-64", "118")):
        pieces.append({"name": "GEO-kael_%s" % n, "subdiv": 1, "low_tris": None, "keep_low": True})
    return {"pieces": pieces,
            "coverage_roles": ("tunic", "undertunic", "cuffs", "trousers", "sash", "belt", "skirt", "boots", "sleeve")}


def drape_extras(high, body, W, arm, drape_piece):
    """After the drape: folded collar bands on the draped tunic / undertunic openings, then the tabards cut from
    the draped tunic, lifted, tucked under the collar band and draped over the tunic."""
    import sd_drape as D
    out = []
    tunic_lo = bpy.data.objects["GEO-kael_tunic"]
    bands = {}
    for src_name, nm, w, lift, ov, sh, role in (("GEO-kael_tunic", "GEO-kael_lapel", 0.022, 0.0065, 0.006, 0.8, "lapel"),
                                                ("GEO-kael_under", "GEO-kael_collar", 0.014, 0.0026, 0.005, 0.95, "collar")):
        src_hi = high.get(src_name)
        if src_hi is None:
            continue
        band = collar_band(src_hi, nm, w, lift, ov, sh, role)
        if band is None:
            continue
        K.transfer_weights(band, bpy.data.objects[src_name])
        band.data.materials.clear()
        band.data.materials.append(bpy.data.objects[src_name].data.materials[0])
        band["sd_thick"] = [0.002, -1.0, 1]
        hi = D.copy_object(band, nm + "_high", "HIGH")
        for g in list(hi.vertex_groups):
            hi.vertex_groups.remove(g)
        D.subdivide(hi, 2)
        hi["sd_thick"] = [0.002, -1.0, 1]
        hi.hide_render = True
        D.attach(band, arm)
        bands[role] = band
        out.append(band)
    tabards = build_tabards(high["GEO-kael_tunic"])
    for t in tabards:
        if "lapel" in bands:
            trim_under_band(t, bands["lapel"], 0.012)
        K.transfer_weights(t, tunic_lo)
        t["sd_thick"] = [0.003, 1.0, 1]
        ent = {"name": t.name, "subdiv": 0, "low_tris": 450,
               "pin": lambda c, b: max(U.smoothstep(1.50, 1.56, c.z), 0.6 * (1.0 - U.smoothstep(1.13, 1.17, c.z))),
               "sim": {"stiffness": 20.0, "shear": 8.0, "bending": 3.0, "mass": 0.3, "shrink": 0.0, "frames": 30,
                       "quality": 12}}
        lo, hi = drape_piece(ent, t, arm, [body, high["GEO-kael_tunic"]])
        out.append(lo)
    for b in bands.values():
        if "sd_edge" in b.keys():
            del b["sd_edge"]
    return out


# ------------------------------------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", default="kael")
    ap.add_argument("--master", default="", help="master .blend to work on (default <id>_master.blend; the anime "
                                                 "pipeline passes <id>_anime_master.blend)")
    a = ap.parse_args(U.args_after_dashes())
    cdir = U.char_dir(a.char)
    master = a.master or os.path.join(cdir, "%s_master.blend" % a.char)
    bpy.ops.wm.open_mainfile(filepath=master)
    U.clear_owned(TAG)
    U.purge_orphans()
    body = bpy.data.objects["GEO-%s_body" % a.char]
    arm = bpy.data.objects["ARM-%s" % a.char]
    W = K.vertex_weights(body)
    body_bvh = envelope_bvh(body, W, TORSO + LEGS + ARMS + ("handN", "handF", "head"))

    tunic = build_tunic(body, W)
    under = build_under(body, W)
    cuffs = build_cuffs(body, W)
    trousers = build_trousers(body, W)
    boots = build_boots(body, W)
    REPORT["pushed_out"] = {o.name: push_out(o, body_bvh, g) for o, g in
                            ((under, 0.003), (cuffs, 0.002), (trousers, 0.004))}
    # skirt: envelope = pelvis + legs + trousers ease (arms excluded: they hang through the skirt at rest)
    env_skirt = envelope_bvh(body, W, ("hips", "spine") + LEGS[:4])
    skirts, _ = build_skirt(body, W, env_skirt)
    tails = build_tabard_tails(env_skirt)
    # bell sleeves: snug at the shoulder, widening to wide cuffs (the drape folds them)
    sleeves = [arm_loft(body, W, s_, "GEO-kael_sleeve_%s" % ("N" if s_ < 0 else "F"), 1.555, 1.05, 0.010, 0.075,
                        n_around=28, n_rows=16, pleats=5) for s_ in (-1, 1)]
    for s_ in sleeves:
        tag(s_, 1.0, "sleeve")
        s_["sd_thick"] = [0.002, -1.0, 1]
    REPORT["under_occluded_tris"] = occlude(under, tunic)
    env_torso = envelope_bvh(body, W, TORSO)

    def over_skirt(az, z):
        top = 1.02 + SKIRT["top"]
        return skirt_surface(env_skirt, az, max(0.0, top - z), SKIRT["ease"], 0.012) + 0.003
    sash = ring_band("GEO-kael_sash", env_torso, 1.04, 1.155, 0.022, n_rows=5, wrinkle=0.0016, floor_fn=over_skirt,
                     tuck=0.006)
    K.transfer_weights(sash, body, lambda i: K.dominant(W[i]) in TORSO)
    tag(sash, 1.0, "sash")
    belt = ring_band("GEO-kael_belt", env_torso, 1.066, 1.111, 0.029, n_rows=3,
                     floor_fn=lambda az, z: over_skirt(az, z) + 0.006)
    K.transfer_weights(belt, body, lambda i: K.dominant(W[i]) in TORSO)
    tag(belt, 1.0, "belt")

    def belt_r(az):
        r = 0.0
        for zz in (1.111, 1.0875, 1.066):
            r = max(r, K.outer_radius(env_torso, Vector((0, 0, zz)), az_dir(az)) or 0.0, over_skirt(az, zz) + 0.006 - 0.029)
        return r + 0.029 + 0.005
    kit = build_belt_kit(belt_r, body)
    for k in kit:
        K.transfer_weights(k, body, lambda i: K.dominant(W[i]) in TORSO)
    for ob in (sash, belt):
        ob["sd_thick"] = [0.004, 1.0, 1]
    for t in tails:
        t["sd_thick"] = [0.002, -1.0, 1]
    # approximate here; sd_drape recomputes it against the draped garments
    REPORT["visible_body_verts"] = coverage(body, W, [tunic, under, cuffs, trousers, sash, belt] + skirts + boots +
                                            sleeves)
    # bones for the skirt panels (section 5)
    REPORT["skirt_bones"] = skirt_bones(arm)
    pieces = [tunic, under, cuffs, trousers, sash, belt] + skirts + boots + tails + sleeves + kit
    for ob in pieces:
        ob.parent = arm
        m = ob.modifiers.new("Armature", "ARMATURE")
        m.object = arm
        K.normalize_limit(ob)
    assign_placeholder_materials(pieces, sd_chars.get(a.char))
    REPORT["tris"] = {o.name: K.tris(o) for o in pieces}
    REPORT["tris_costume"] = sum(REPORT["tris"].values())
    U.write_json(os.path.join(cdir, "review", "04_costume", "costume_report.json"), REPORT)
    U.log("COSTUME", REPORT["tris_costume"], REPORT["tris"])
    U.save(master)


if __name__ == "__main__":
    main()
