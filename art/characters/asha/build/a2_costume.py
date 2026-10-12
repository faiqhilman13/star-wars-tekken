"""ASHA A2 COSTUME: the finished VRoid master (vroid_finish.py) dressed as "The Twin Fang" (art/ANIME_DIRECTION.md).

  python tools/blender/run.py art/characters/asha/build/a2_costume.py -- --char asha [--stage all]

Reads  art/characters/asha/asha_anime_master.blend
Writes art/characters/asha/asha_master.blend (+ textures/costume/*.png, review/a2_costume/costume_report.json)

Pieces (contract frame: faces +X, up +Z, near/right = -Y):
  body garments  teal halter crop top (body faces, cleavage bridged), dark-teal leggings with a side stripe, forearm
                 wraps, fingerless gloves - all re-materialed body faces, so nothing can poke through
  shells         wrapped soft boots (offset + smoothed body shell, sole, cuff), hem / collar / cuff bands
  straps         orange leather cross-harness with rings, hip belt with buckle
  skirt          short front flap, long back panels (skirt_<label>_0/_1), trim hems
  guard          small far-shoulder guard (pad_F)
  hair           VRoid bangs + side locks kept; high ponytail of lofted clumps with a white streak (hair_0..2),
                 hair tie; headband with a knot and two trailing tails (tail_0..1)
Materials (8): MAT-skin, MAT-face, MAT-eyes, MAT-hair, MAT-asha_primary, _secondary, _trim, _leather.
"""
import argparse
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.environ.get("SABER_REPO", "."), "tools", "blender"))
import sd_contract as C  # noqa: E402
import sd_util as U  # noqa: E402
import toonkit as K  # noqa: E402
import vroid_chars  # noqa: E402
import vroid_finish as VF  # noqa: E402

REPORT = {}
CID = "asha"

# ------------------------------------------------------------------------------------------------ palette (sRGB)
TEAL = 0x22675F          # LOOKS.primary 0x1f5f5a, a touch brighter for the lit tone
TEAL_HI = 0x2F8077
TEAL_DK = 0x123A37       # primaryDark
TEAL_LEG = 0x112A2A      # trousers 0x183b3a, darker so the top and skirt read against it
TEAL_LEG_HI = 0x1A3A39
ORANGE = 0xC9783C        # secondary
ORANGE_HI = 0xE09552
ORANGE_DK = 0x8A4524
GOLD = 0xD99A4E          # trim
GOLD_HI = 0xF2C778
GOLD_DK = 0x9A5C2A
LEATHER = 0x5E3720       # belt 0x6a3d1e
LEATHER_DK = 0x2A1C14    # boots
LEATHER_HI = 0x7E4C2C
WRAP = 0xB98A5E          # boot wraps (tan)
INK = 0x2A120C

# atlas rects (u0, v0, u1, v1)
P_TOP = (0.0, 0.52, 1.0, 1.0)
P_LEG = (0.0, 0.0, 0.5, 0.5)
P_SK_OUT = (0.52, 0.27, 0.74, 0.5)
P_SK_IN = (0.76, 0.27, 0.98, 0.5)
P_COLLAR = (0.52, 0.02, 0.98, 0.12)
S_STRAP = (0.02, 0.0, 0.22, 1.0)       # full-height column: harness straps (v repeats)
S_BAND = (0.26, 0.0, 0.46, 1.0)        # headband + tails
S_WRAP = (0.5, 0.5, 1.0, 1.0)          # forearm wraps (cylinder)
S_TIE = (0.5, 0.0, 1.0, 0.45)
# MAT-asha_leather atlas also carries the gold trim (7 materials: the gold bands, rings and buckle are leather
# material texels; they are not tinted in mirror matches)
T_BAND = (0.0, 0.0, 0.48, 0.24)        # gold trim bands (u across; uniform along v)
T_METAL = (0.5, 0.0, 1.0, 0.24)        # gold rings / buckle
L_BOOT = (0.0, 0.52, 1.0, 1.0)
L_GLOVE = (0.0, 0.26, 0.24, 0.5)
L_SOLE = (0.26, 0.26, 0.48, 0.5)
L_BELT = (0.5, 0.26, 0.74, 0.5)
L_GUARD = (0.76, 0.26, 1.0, 0.5)


def cyl_st(co, centre, z0, z1, front_s=0.5):
    """Cylinder coords around a vertical axis through centre (x, y): s = 0.5 at +X (front), 0.75 at -Y (near side),
    seam at the back; t = (z - z0) / (z1 - z0)."""
    a = math.atan2(-(co[1] - centre[1]), co[0] - centre[0])
    s = (a / (2 * math.pi) + 0.5) % 1.0
    return s, (co[2] - z0) / (z1 - z0)


# ================================================================================================ textures
def paint_primary(path):
    cv = K.Canvas(1024, 1024, TEAL)
    teal, hi, dk = K.C3(TEAL), K.C3(TEAL_HI), K.C3(TEAL_DK)
    ink = K.C3(0x0E2826)

    def top(s, t):
        # flat teal, a painted light band across the chest, darker side panels from the armpit down, centre seam,
        # two under-bust fold strokes; s: 0.5 front, 0.25 / 0.75 sides, 0 / 1 back
        c = K.mix(teal, hi, (K.smooth01(0.45, 0.8, t) * (1 - K.smooth01(0.85, 1.0, t)))[..., None] * 0.6)
        side = np.minimum(np.abs(s - 0.25), np.abs(s - 0.75))
        c = K.mix(c, dk, (K.band(side, 0.0, 0.11, 0.004))[..., None] * 0.75)
        c = K.mix(c, ink, (K.band(side, 0.055, 0.004, 0.002) + K.band(side, -0.055, 0.004, 0.002))[..., None] * 0)
        seam = np.minimum(np.abs(side - 0.055), 1.0)
        c = K.mix(c, ink, K.band(seam, 0.0, 0.0035, 0.002)[..., None] * 0.8)
        c = K.mix(c, ink, (K.band(s, 0.5, 0.003, 0.002) * K.smooth01(0.0, 0.2, t))[..., None] * 0.45)
        # fold strokes under the bust (front, both sides of the centre)
        for cx in (0.43, 0.57):
            d = np.hypot((s - cx) * 3.0, (t - 0.12) * 1.0)
            c = K.mix(c, dk, (K.band(d, 0.06, 0.012, 0.006) * (t > 0.08) * (np.abs(s - 0.5) > 0.03))[..., None] * 0.5)
        return c
    cv.paint(P_TOP, top, pad=0.01)

    def legs(s, t):
        # dark teal, lighter toward the top, a bright side stripe (s = 0.25 / 0.75) with ink edges, knee seams
        c = K.mix(K.C3(TEAL_LEG), K.C3(TEAL_LEG_HI), K.smooth01(0.4, 1.0, t)[..., None] * 0.7)
        side = np.minimum(np.abs(s - 0.25), np.abs(s - 0.75))
        c = K.mix(c, teal, K.band(side, 0.0, 0.05, 0.003)[..., None])
        c = K.mix(c, ink, K.band(side, 0.026, 0.006, 0.002)[..., None] * 0.9)
        # knee panel seam lines (front, t at the knee)
        kn = K.band(t, 0.22, 0.006, 0.003) * (np.abs(s - 0.5) < 0.18)
        c = K.mix(c, ink, kn[..., None] * 0.6)
        return c
    cv.paint(P_LEG, legs, pad=0.01)

    def sk_out(s, t):
        # t = 0 at the waist, 1 at the hem; s across. Flat teal, a soft darker gradient toward the hem, fold lines.
        c = K.mix(teal, dk, (K.smooth01(0.3, 1.0, t) * 0.45)[..., None])
        c = K.mix(c, hi, ((1 - K.smooth01(0.0, 0.3, t)) * 0.35)[..., None])
        for fx in (0.33, 0.66):
            c = K.mix(c, dk, (K.band(s, fx, 0.01, 0.006) * K.smooth01(0.25, 0.7, t))[..., None] * 0.6)
        return c
    cv.paint(P_SK_OUT, sk_out, pad=0.01)
    cv.paint(P_SK_IN, lambda s, t: K.mix(dk, K.C3(0x0B2422), K.smooth01(0.0, 1.0, t)[..., None] * 0.5), pad=0.01)
    cv.paint(P_COLLAR, lambda s, t: K.mix(dk, teal, K.smooth01(0.2, 0.8, t)[..., None]), pad=0.01)
    return cv.save("%s_primary" % CID, path)


def paint_secondary(path):
    cv = K.Canvas(1024, 1024, ORANGE)
    o, hi, dk = K.C3(ORANGE), K.C3(ORANGE_HI), K.C3(ORANGE_DK)
    ink = K.C3(0x4A1E0E)

    def strap(s, t):
        # across s: dark edges, stitch dashes 18 % in from each edge, a light ridge; v repeats along the strap
        c = K.mix(o, hi, K.band(s, 0.5, 0.25, 0.08)[..., None] * 0.35)
        edge = 1 - K.band(s, 0.5, 0.86, 0.02)
        c = K.mix(c, dk, edge[..., None])
        st = (K.band(s, 0.2, 0.035, 0.01) + K.band(s, 0.8, 0.035, 0.01)) * K.dashes(t, 0.05, 0.55)
        c = K.mix(c, ink, st[..., None] * 0.7)
        return c
    cv.paint(S_STRAP, strap, pad=0.008)

    def band(s, t):
        c = K.mix(o, hi, K.band(s, 0.42, 0.3, 0.1)[..., None] * 0.3)
        c = K.mix(c, dk, (1 - K.band(s, 0.5, 0.88, 0.02))[..., None])
        return c
    cv.paint(S_BAND, band, pad=0.008)

    def wrap(s, t):
        # spiral bandage: diagonal strips (periodic in s), ink line between turns, lighter strip centres
        ph = (t * 7.0 + s * 1.0) % 1.0
        c = K.mix(K.C3(0xB46A36), hi, K.band(ph, 0.5, 0.45, 0.25)[..., None] * 0.55)
        c = K.mix(c, ink, K.band(ph, 0.0, 0.06, 0.02)[..., None] * 0.85)
        c = K.mix(c, ink, K.band(ph, 1.0, 0.06, 0.02)[..., None] * 0.85)
        return c
    cv.paint(S_WRAP, wrap, pad=0.01)
    cv.paint(S_TIE, lambda s, t: K.mix(dk, o, K.smooth01(0.0, 1.0, t)[..., None]), pad=0.01)
    return cv.save("%s_secondary" % CID, path)


def paint_trim(cv):
    """Gold trim texels painted into the leather canvas."""
    g, hi, dk = K.C3(GOLD), K.C3(GOLD_HI), K.C3(GOLD_DK)

    def band(s, t):
        c = K.mix(g, hi, K.band(s, 0.4, 0.22, 0.08)[..., None] * 0.6)
        c = K.mix(c, dk, (1 - K.band(s, 0.5, 0.84, 0.03))[..., None])
        return c
    cv.paint(T_BAND, band, pad=0.01)
    cv.paint(T_METAL, lambda s, t: K.mix(dk, hi, K.smooth01(0.1, 0.9, t)[..., None] * 0.8 + 0.1), pad=0.01)


def paint_leather(path):
    cv = K.Canvas(1024, 1024, LEATHER)
    lt, hi, dk = K.C3(LEATHER), K.C3(LEATHER_HI), K.C3(LEATHER_DK)
    ink = K.C3(0x140A06)
    wrap_c, wrap_hi = K.C3(WRAP), K.C3(0xD8AE7E)

    def boot(s, t):
        # t: 0 sole .. 1 cuff. Dark soft leather; narrow tan wrap straps crossing in an X up the shin (3 crossings
        # per turn), ink edges; darker sole band; a lighter band under the cuff.
        c = K.mix(dk, K.C3(0x3A2618), K.smooth01(0.0, 0.7, t)[..., None])
        shin = K.smooth01(0.30, 0.33, t) * (1 - K.smooth01(0.87, 0.9, t))
        a = (s * 2.0 + t * 2.6) % 1.0
        b = (s * 2.0 - t * 2.6) % 1.0
        wa, wb = K.band(a, 0.5, 0.2, 0.015), K.band(b, 0.5, 0.2, 0.015)
        w = np.maximum(wa, wb) * shin
        cw = K.mix(wrap_c, wrap_hi, (K.band(a, 0.47, 0.06, 0.03) * (wa >= wb) + K.band(b, 0.47, 0.06, 0.03) * (wb > wa))[..., None] * 0.6)
        c = K.mix(c, cw, w[..., None])
        edge = (np.clip(K.band(a, 0.5, 0.23, 0.01) - wa, 0, 1) + np.clip(K.band(b, 0.5, 0.23, 0.01) - wb, 0, 1)) * shin
        c = K.mix(c, ink, np.clip(edge, 0, 1)[..., None] * 0.9)
        c = K.mix(c, K.C3(0x1A100A), (1 - K.smooth01(0.06, 0.075, t))[..., None])
        c = K.mix(c, ink, K.band(t, 0.30, 0.01, 0.004)[..., None] * 0.8)
        c = K.mix(c, K.C3(LEATHER_HI), K.band(t, 0.95, 0.07, 0.01)[..., None] * 0.8)
        return c
    cv.paint(L_BOOT, boot, pad=0.01)

    def glove(s, t):
        c = K.mix(dk, K.C3(0x4A3020), K.smooth01(0.0, 1.0, t)[..., None] * 0.6)
        return c
    cv.paint(L_GLOVE, glove, pad=0.01)

    def belt(s, t):
        c = K.mix(lt, hi, K.band(s, 0.45, 0.3, 0.1)[..., None] * 0.4)
        c = K.mix(c, dk, (1 - K.band(s, 0.5, 0.86, 0.02))[..., None])
        st = (K.band(s, 0.17, 0.03, 0.01) + K.band(s, 0.83, 0.03, 0.01)) * K.dashes(t, 0.012, 0.55)
        c = K.mix(c, K.C3(0xC89A62), st[..., None] * 0.7)
        return c
    cv.paint(L_BELT, belt, pad=0.008)

    def guard(s, t):
        c = K.mix(K.C3(0x6E4026), K.C3(0x8E5A34), K.smooth01(0.0, 0.7, 1 - t)[..., None] * 0.6)
        c = K.mix(c, dk, (1 - K.band(t, 0.5, 0.86, 0.02))[..., None])
        rv = (K.band((s * 6.0) % 1.0, 0.5, 0.12, 0.02) * K.band(t, 0.86, 0.06, 0.01))
        c = K.mix(c, K.C3(GOLD), rv[..., None])
        return c
    cv.paint(L_GUARD, guard, pad=0.01)
    cv.paint(L_SOLE, lambda s, t: K.mix(ink, dk, K.smooth01(0.0, 1.0, t)[..., None] * 0.5), pad=0.01)
    paint_trim(cv)
    return cv.save("%s_leather" % CID, path)


def make_materials(cfg, tex_dir):
    rim = K.rim_of(cfg, 0.30)
    prim = K.toon_material("MAT-asha_primary", paint_primary(os.path.join(tex_dir, "asha_primary.png")),
                           K.toon_extras(cfg, TEAL, 0x1C3A4E, toony=0.92, shift=-0.05, rim=rim, outline=0.0022))
    sec = K.toon_material("MAT-asha_secondary", paint_secondary(os.path.join(tex_dir, "asha_secondary.png")),
                          K.toon_extras(cfg, ORANGE, 0x8A3A26, toony=0.92, shift=-0.05, rim=rim, outline=0.0018))
    lea = K.toon_material("MAT-asha_leather", paint_leather(os.path.join(tex_dir, "asha_leather.png")),
                          K.toon_extras(cfg, LEATHER, 0x2E1410, toony=0.92, shift=-0.05, rim=rim, outline=0.0022))
    return {"primary": prim, "secondary": sec, "trim": lea, "leather": lea}     # gold trim atlased into leather


# ================================================================================================ body garments
def dominant(ob):
    names = {g.index: g.name for g in ob.vertex_groups}
    out = []
    for v in ob.data.vertices:
        g = max(v.groups, key=lambda g: g.weight) if v.groups else None
        out.append(names[g.group] if g else "")
    return np.array(out)


TORSO = ("hips", "spine", "chest", "neck")
LEGS = ("thighN", "shinN", "footN", "thighF", "shinF", "footF")
ARMS = ("upperN", "foreN", "handN", "upperF", "foreF", "handF")

Z_HEM = 1.312            # crop top hem (front), under the bust
Z_NECK = 1.645           # top of the halter neck (inside the collar band)
Z_HEM_BACK = 1.335
Z_WAIST = 1.060          # leggings top (front)
Z_WAIST_BACK = 1.085
Z_BOOT = 0.445           # boot cuff top
Z_WRAP0, Z_WRAP1 = 1.012, 1.175   # forearm wraps (down to the glove at the wrist)
HALTER_A = (0.130, 1.400)          # armhole line (|y|, z): under the arm ...
HALTER_B = (0.056, 1.640)          # ... to the side of the neck
NECK_C = (-0.008, 0.0)


def halter_y(z):
    (y0, z0), (y1, z1) = HALTER_A, HALTER_B
    return y0 + (z - z0) * (y1 - y0) / (z1 - z0)


def plane_from(p0, p1, p2):
    p0, p1, p2 = Vector(p0), Vector(p1), Vector(p2)
    n = (p1 - p0).cross(p2 - p0).normalized()
    return p0, n


def halter_side(sg):
    """Cut plane of the halter armhole on side sg (-1 near / +1 far): through the armpit and the neck side, parallel
    to X. Returns (point, normal) with the bare (shoulder) side positive."""
    a = Vector((0.0, sg * HALTER_A[0], HALTER_A[1]))
    b = Vector((0.0, sg * HALTER_B[0], HALTER_B[1]))
    d = (b - a).normalized()
    n = Vector((1, 0, 0)).cross(d).normalized()
    if n.dot(Vector((0, sg * 0.19, 1.58)) - a) < 0:
        n = -n
    return a, n


def body_garments(body, mats):
    me = body.data
    # --- clean cut lines
    hem0 = Vector((0.0, 0.0, 0.5 * (Z_HEM + Z_HEM_BACK)))
    hem_n = Vector(((Z_HEM_BACK - Z_HEM) / 0.2, 0.0, 1.0)).normalized()      # rises toward the back
    torso_box = lambda c: abs(c.y) < 0.16 and 1.2 < c.z < 1.7 and not (abs(c.y) > 0.125 and c.z < 1.5)  # noqa: E731
    K.bisect(body, hem0, hem_n, region=lambda c: torso_box(c) and c.z < 1.45)
    for sg in (-1, 1):
        p, n = halter_side(sg)
        K.bisect(body, p, n, region=lambda c, sg=sg: torso_box(c) and sg * c.y > 0.02 and c.z > 1.35)
    K.bisect(body, (0, 0, Z_NECK), (0, 0, 1), region=lambda c: abs(c.y) < 0.09 and 1.57 < c.z < 1.69)
    wz = Vector((0.0, 0.0, 0.5 * (Z_WAIST + Z_WAIST_BACK)))
    wn = Vector(((Z_WAIST_BACK - Z_WAIST) / 0.2, 0.0, 1.0)).normalized()
    K.bisect(body, wz, wn, region=lambda c: abs(c.y) < 0.2 and 0.95 < c.z < 1.2)
    K.bisect(body, (0, 0, Z_BOOT), (0, 0, 1), region=lambda c: c.z < 0.6)
    K.bisect(body, (0, 0, Z_WRAP1), (0, 0, 1), region=lambda c: abs(c.y) > 0.13 and 1.0 < c.z < 1.3)
    K.bisect(body, (0, 0, Z_WRAP0), (0, 0, 1), region=lambda c: abs(c.y) > 0.13 and 0.95 < c.z < 1.1)
    me.update()
    dom = dominant(body)
    fc = K.face_centres(me)
    polys = list(me.polygons)

    def pdom(p):
        names = [dom[v] for v in p.vertices]
        return max(set(names), key=names.count)
    pd = [pdom(p) for p in polys]

    def above(c, p0, n):
        return (Vector(c) - Vector(p0)).dot(n) > 0
    halters = [halter_side(-1), halter_side(1)]
    top, legs, wraps, gloves = [], [], [], []
    palm = K.point_attr(me, "vr_palm")
    f1 = K.point_attr(me, "vr_f1")
    th = K.point_attr(me, "vr_thumb")
    f23 = K.point_attr(me, "vr_f23")
    for i, p in enumerate(polys):
        c = fc[i]
        d = pd[i]
        if d in TORSO or d in ("upperN", "upperF") and abs(c[1]) < 0.13:
            if (above(c, hem0, hem_n) and c[2] < Z_NECK and not any(above(c, hp, hn) for hp, hn in halters)
                    and abs(c[1]) < 0.15):
                top.append(i)
                continue
        if (d in TORSO or d in LEGS) and not above(c, wz, wn) and c[2] > Z_BOOT:
            legs.append(i)
            continue
        if d in ("foreN", "foreF", "handN", "handF") and Z_WRAP0 < c[2] < Z_WRAP1:
            wraps.append(i)
            continue
        if d in ("handN", "handF"):
            vs = list(p.vertices)
            g = np.mean([palm[v] + f1[v] for v in vs])
            t = np.mean([th[v] for v in vs])
            tip = np.mean([f23[v] for v in vs])
            if (g > 0.45 or (t > 0.4 and c[2] > 0.93)) and tip < 0.5:
                gloves.append(i)
    REPORT["body_regions"] = {"top": len(top), "legs": len(legs), "wraps": len(wraps), "gloves": len(gloves)}
    # --- shape: top fabric bridges the cleavage and sits 2 mm proud; leggings 1.5 mm; wraps 2.5 mm
    vt = sorted({v for i in top for v in polys[i].vertices})
    K.inflate(body, vt, lambda co: 0.002, bridge=1.0, bridge_iters=14)
    me.update()
    vl = sorted({v for i in legs for v in polys[i].vertices})
    K.inflate(body, vl, lambda co: 0.0015)
    vw = sorted({v for i in wraps for v in polys[i].vertices})
    K.inflate(body, vw, lambda co: 0.0028)
    # --- UVs + materials
    K.assign_region(body, top, mats["primary"], lambda co, fi, k: cyl_st(co, (0.01, 0.0), Z_HEM - 0.01, Z_NECK),
                    rect=P_TOP)

    def leg_st(co, fi, k):
        if co[2] > 0.93:
            return cyl_st(co, (0.0, 0.0), Z_BOOT, Z_WAIST_BACK)
        yc = -0.1 if co[1] < 0 else 0.1
        return cyl_st(co, (0.0, yc), Z_BOOT, Z_WAIST_BACK)
    K.assign_region(body, legs, mats["primary"], leg_st, rect=P_LEG)

    def wrap_st(co, fi, k):
        yc = -0.19 if co[1] < 0 else 0.19
        return cyl_st(co, (0.0, yc), Z_WRAP0, Z_WRAP1)
    K.assign_region(body, wraps, mats["secondary"], wrap_st, rect=S_WRAP)

    def glove_st(co, fi, k):
        yc = -0.19 if co[1] < 0 else 0.19
        return cyl_st(co, (0.0, yc), 0.86, 1.04)
    K.assign_region(body, gloves, mats["leather"], glove_st, rect=L_GLOVE)
    return {"top": top, "legs": legs, "wraps": wraps, "gloves": gloves}


# ================================================================================================ boots
def boots(body, mbs, mats):
    """Wrapped soft boots, built procedurally per leg: a shin tube lofted round the leg (ray-cast leg radius + 9 mm,
    smoothed), a clean lofted foot (heel -> toe box -> rounded toe) overlapping the tube at the ankle, a flat sole slab
    and a rolled cuff. Weights come from the leg surface; the leg skin under the boots is deleted."""
    ref = K.BodyRef([body], exclude=ARMS)
    mb = mbs["leather"]
    lea = {"out": mats["leather"], "in": mats["leather"]}
    nth, zs = 28, np.linspace(0.105, Z_BOOT, 13)
    rep = {}
    for sg in (-1.0, 1.0):
        ax = np.array((0.008, sg * 0.100))
        # --- shin tube
        R = np.zeros((len(zs), nth))
        for j, z in enumerate(zs):
            for k in range(nth):
                th = 2 * math.pi * k / nth
                d = Vector((math.cos(th), math.sin(th), 0.0))
                loc, n, i, dist = ref.bvh.ray_cast(Vector((ax[0], ax[1], z)), d)
                R[j, k] = dist if (loc is not None and dist < 0.12) else np.nan
        for j in range(len(zs)):
            row = R[j]
            if np.isnan(row).all():
                R[j] = R[j - 1] if j else 0.05
            else:
                R[j] = np.where(np.isnan(row), np.nanmean(row), row)
        for _ in range(3):
            R = 0.5 * R + 0.25 * (np.roll(R, 1, axis=1) + np.roll(R, -1, axis=1))
            R[1:-1] = 0.5 * R[1:-1] + 0.25 * (R[:-2] + R[2:])
        R = R + 0.009 + 0.004 * (1 - K.smooth01(0.12, 0.25, zs))[:, None]
        G = np.zeros((nth, len(zs), 3))
        for j, z in enumerate(zs):
            for k in range(nth):
                th = 2 * math.pi * k / nth
                G[k, j] = (ax[0] + R[j, k] * math.cos(th), ax[1] + R[j, k] * math.sin(th), z)

        def uv_shin(s, t, side):
            z = zs[0] + t * (zs[-1] - zs[0])
            # s runs round the leg from +X; put the wrap seam behind the leg
            u = (0.5 + s * sg) % 1.0
            return (L_BOOT[0] + u * (L_BOOT[2] - L_BOOT[0]), L_BOOT[1] + (z / Z_BOOT) * (L_BOOT[3] - L_BOOT[1]))
        K.sheet(mb, G, 0.004, lea, uv_shin, lambda p, s, t: ref.weights(p), lambda s, t, sd: 1.0,
                outward=lambda p, ax=ax: np.array((p[0] - ax[0], p[1] - ax[1], 0.0)), closed_u=True)
        # --- rolled cuff on the top ring
        top = [tuple(G[k, -1] + np.array((0, 0, -0.004))) for k in range(nth)]
        K.strap(mb, ref, top, 0.032, 0.008, 0.0, lea, (L_BOOT[0], L_BOOT[1] + 0.935 * (L_BOOT[3] - L_BOOT[1]), L_BOOT[2],
                L_BOOT[1] + 0.965 * (L_BOOT[3] - L_BOOT[1])), closed=True, drape=False, samples=nth, ol=1.0, wref=ref,
                up_fn=lambda i, p, ax=ax: np.array((p[0] - ax[0], p[1] - ax[1], 0.0)))
        # --- foot: sections along x (heel -> toe), D-shaped (flat bottom), capped by shrinking to the tip
        X = np.array([-0.072, -0.066, -0.052, -0.03, 0.0, 0.04, 0.08, 0.115, 0.145, 0.168, 0.182, 0.19])
        HW = np.array([0.014, 0.026, 0.034, 0.038, 0.041, 0.045, 0.047, 0.046, 0.042, 0.035, 0.025, 0.012])
        TOP = np.array([0.050, 0.090, 0.112, 0.128, 0.138, 0.118, 0.092, 0.075, 0.062, 0.051, 0.041, 0.030])
        nph = 18
        F = np.zeros((nph, len(X), 3))
        for i, x in enumerate(X):
            for k in range(nph):
                ph = 2 * math.pi * k / nph
                c, s_ = math.cos(ph), math.sin(ph)
                y = ax[1] + HW[i] * c * (1.0 if s_ >= 0 else 1.05)
                zc = TOP[i] * 0.5
                z = zc + (TOP[i] * 0.5) * s_
                if s_ < 0:
                    z = max(0.006, zc + (TOP[i] * 0.5) * s_ * 1.0)
                    z = 0.006 + (z - 0.006) * 0.35 if z < 0.025 else z
                F[k, i] = (x + 0.012, y, z)

        def uv_foot(s, t, side):
            return (L_BOOT[0] + s * (L_BOOT[2] - L_BOOT[0]), L_BOOT[1] + (0.09 + 0.19 * t) * (L_BOOT[3] - L_BOOT[1]))
        K.sheet(mb, F, 0.004, lea, uv_foot, lambda p, s, t: ref.weights(p), lambda s, t, sd: 1.0,
                outward=lambda p, ax=ax: np.array((0.0, p[1] - ax[1], p[2] - 0.05)), closed_u=True)
        # --- sole slab: the foot outline at the bottom, 3 mm wider, 14 mm thick
        S = np.zeros((2, len(X), 3))
        for i, x in enumerate(X):
            for a_, sgn in enumerate((-1.0, 1.0)):
                S[a_, i] = (x + 0.012, ax[1] + sgn * (HW[i] * 1.05 + 0.003), 0.006)
        K.sheet(mb, S, 0.013, lea, lambda s, t, sd: (L_SOLE[0] + t * (L_SOLE[2] - L_SOLE[0]), L_SOLE[1] + s * (L_SOLE[3] - L_SOLE[1])),
                lambda p, s, t: ref.weights(p + np.array((0, 0, 0.03))), lambda s, t, sd: 1.0,
                N=np.tile(np.array((0, 0, 1.0)), (2, len(X), 1)))
        rep["N" if sg < 0 else "F"] = {"shin_r_mean": round(float(R.mean()), 3)}
    # body under the boots goes (keep a 2 cm overlap under the cuff)
    me = body.data
    dom = dominant(body)
    covered = [i for i, p in enumerate(me.polygons) if dom[p.vertices[0]] in LEGS and
               all(me.vertices[v].co.z < Z_BOOT - 0.02 for v in p.vertices)]
    K.delete_faces(body, covered)
    rep["body_faces_removed"] = len(covered)
    REPORT["boots"] = rep


# ================================================================================================ trims on the top
def top_trims(body, top_faces, mbs, mats):
    """Gold piping along the crop top's hem and its halter edge (armholes + neckline as one loop), and a dark-teal
    collar band round the neck with a gold edge. Paths are cast onto the body, not traced from mesh edges."""
    ref = K.BodyRef([body], exclude=ARMS)
    tc = (0.01, 0.0)
    hem = []
    for k in range(48):
        az = 2 * math.pi * k / 48
        x = 0.1 * math.cos(az)
        z = 0.5 * (Z_HEM + Z_HEM_BACK) - (Z_HEM_BACK - Z_HEM) / 0.2 * x
        r = ray_r(ref, tc, z, az) or 0.11
        hem.append((tc[0] + r * math.cos(az), tc[1] - r * math.sin(az), z))
    K.strap(mbs["trim"], ref, hem, 0.016, 0.004, 0.0012, {"out": mats["trim"], "in": mats["trim"]}, T_BAND,
            closed=True, ol=0.6)

    def cast(y, z, sx):
        loc, n, i, dist = ref.bvh.ray_cast(Vector((0.0, y, z)), Vector((sx, 0.0, 0.0)))
        return None if loc is None else (loc.x, y, z)

    def side_line(sg, sx, up):
        pts = []
        for z in np.linspace(1.36, Z_NECK - 0.012, 18):
            p = cast(sg * halter_y(z), z, sx)
            if p is not None:
                pts.append(p)
        return pts if up else pts[::-1]

    def neck_arc(front, from_sg):
        pts = []
        lim = halter_y(Z_NECK - 0.012)
        for k in range(1, 12):
            f = k / 12
            y = from_sg * lim * (1 - 2 * f)
            p = cast(y, Z_NECK - 0.012, 1.0 if front else -1.0)
            if p is not None:
                pts.append(p)
        return pts
    loop = (side_line(-1, 1.0, True) + neck_arc(True, -1) + side_line(1, 1.0, False) +
            side_line(1, -1.0, True) + neck_arc(False, 1) + side_line(-1, -1.0, False))
    K.strap(mbs["trim"], ref, loop, 0.010, 0.004, 0.0012, {"out": mats["trim"], "in": mats["trim"]}, T_BAND,
            closed=True, ol=0.6, iters=6)
    # collar
    col, edge = [], []
    for k in range(36):
        az = 2 * math.pi * k / 36
        for z, lst in ((Z_NECK + 0.002, col), (Z_NECK + 0.019, edge)):
            r = ray_r(ref, NECK_C, z, az) or 0.05
            lst.append((NECK_C[0] + r * math.cos(az), NECK_C[1] - r * math.sin(az), z))
    K.strap(mbs["primary"], ref, col, 0.036, 0.0055, 0.0015, {"out": mats["primary"], "in": mats["primary"]},
            P_COLLAR, closed=True, ol=1.0, up_fn=lambda i, p: np.array((p[0] - NECK_C[0], p[1] - NECK_C[1], 0.0)))
    K.strap(mbs["trim"], ref, edge, 0.007, 0.0065, 0.0035, {"out": mats["trim"], "in": mats["trim"]}, T_BAND,
            closed=True, ol=0.6, up_fn=lambda i, p: np.array((p[0] - NECK_C[0], p[1] - NECK_C[1], 0.0)))
    REPORT["top_trims"] = {"hem_pts": len(hem), "halter_pts": len(loop)}


# ================================================================================================ belt / skirt
HIP_C = (0.006, 0.0)


def ray_r(ref, centre, z, az):
    d = Vector((math.cos(az), -math.sin(az), 0.0))
    loc, n, i, dist = ref.bvh.ray_cast(Vector((centre[0], centre[1], z)), d)
    return dist if loc is not None else None


def waist_z(x, dz=0.0):
    return 0.5 * (Z_WAIST + Z_WAIST_BACK) - (Z_WAIST_BACK - Z_WAIST) / 0.2 * x + dz


def belt(body, mbs, mats):
    ref = K.BodyRef([body], exclude=ARMS)
    pts = []
    for k in range(40):
        az = 2 * math.pi * k / 40
        z = waist_z(0.1 * math.cos(az), 0.006)
        r = ray_r(ref, HIP_C, z, az) or 0.15
        pts.append((HIP_C[0] + r * math.cos(az), HIP_C[1] - r * math.sin(az), z))
    P = K.strap(mbs["leather"], ref, pts, 0.042, 0.007, 0.004, {"out": mats["leather"], "in": mats["leather"]},
                L_BELT, closed=True, ol=1.0)
    # buckle: a gold plate on the front, slightly to the far side
    az = math.radians(-14)
    z = waist_z(0.1, 0.006)
    r = ray_r(ref, HIP_C, z, az) + 0.012
    c = np.array((HIP_C[0] + r * math.cos(az), HIP_C[1] - r * math.sin(az), z))
    n = np.array((math.cos(az), -math.sin(az), 0.0))
    side = np.cross((0, 0, 1), n)
    G = np.zeros((5, 4, 3))
    for i in range(5):
        for j in range(4):
            u = (i / 4 - 0.5) * 0.058
            v = (j / 3 - 0.5) * 0.05
            G[i, j] = c + side * u + np.array((0, 0, v)) - n * (u * u * 2.0)
    K.sheet(mbs["trim"], G, 0.008, {"out": mats["trim"], "in": mats["trim"]},
            lambda s, t, sd: (T_METAL[0] + s * (T_METAL[2] - T_METAL[0]), T_METAL[1] + t * (T_METAL[3] - T_METAL[1])),
            lambda p, s, t: ref.weights(p), lambda s, t, sd: 0.6, outward=lambda p: n)
    REPORT["belt"] = {"radius_front": round(r, 3)}
    return P


PANELS = [
    # label, game azimuth (deg, + toward the near side), half width (deg), length (m), hinge t (None = 1 bone),
    # flare (deg), V-hem depth, fold count, radial layer offset
    ("front", 0.0, 27.0, 0.25, None, 13.0, 0.22, 2, 0.000),
    ("backN", 122.0, 31.0, 0.56, 0.42, 11.0, 0.10, 3, 0.000),
    ("backF", -122.0, 31.0, 0.56, 0.42, 11.0, 0.10, 3, 0.000),
    ("back", 180.0, 27.0, 0.63, 0.42, 9.0, 0.16, 3, 0.007),
]


def skirt(body, rig, mbs, mats):
    ref = K.BodyRef([body], exclude=ARMS)
    rep = {}
    cx = np.array((HIP_C[0], HIP_C[1], 0.0))
    for label, azd, hwd, length, hinge, flare, vhem, folds, layer in PANELS:
        az0, hw, fl = math.radians(azd), math.radians(hwd), math.radians(flare)
        ztop = waist_z(0.1 * math.cos(az0), 0.012)

        def point(s, t, az0=az0, hw=hw, fl=fl, length=length, ztop=ztop, vhem=vhem, folds=folds, layer=layer):
            a = az0 + s * hw * (1 + 0.22 * t)
            L = length * (1 + vhem * (1 - abs(s)) - 0.04 * s * s)
            r_top = (ray_r(ref, HIP_C, ztop - 0.012, a) or 0.13) + 0.006 + layer
            z = ztop - t * L * math.cos(fl)
            r = r_top + t * L * math.sin(fl)
            rb = ray_r(ref, HIP_C, z, a) if z > 0.9 else None
            if rb is not None:
                r = max(r, rb + 0.010 + layer)
            r += 0.006 * math.cos(math.pi * folds * (s + 1)) * float(K.smooth01(0.1, 0.8, t))
            return np.array((HIP_C[0] + r * math.cos(a), HIP_C[1] - r * math.sin(a), z))
        nu, nv = 11, (14 if hinge else 8)
        S = np.linspace(-1, 1, nu)
        T = np.linspace(0, 1, nv)
        G = np.array([[point(s, t) for t in T] for s in S])
        n0, n1 = "skirt_%s_0" % label, "skirt_%s_1" % label

        def wfn(p, s, t, hinge=hinge, n0=n0, n1=n1):
            wh = 1 - float(K.smooth01(0.0, 0.14, t))
            if hinge is None:
                return K.blend_w(({"hips": 1.0}, wh), ({n0: 1.0}, 1 - wh))
            w1 = float(K.smooth01(hinge - 0.1, hinge + 0.1, t))
            return K.blend_w(({"hips": 1.0}, wh), ({n0: 1.0}, (1 - wh) * (1 - w1)), ({n1: 1.0}, (1 - wh) * w1))

        def uvp(s, t, side):
            r = P_SK_OUT if side == "out" else P_SK_IN
            return (r[0] + s * (r[2] - r[0]), r[3] - t * (r[3] - r[1]))
        K.sheet(mbs["primary"], G, 0.0065, {"out": mats["primary"], "in": mats["primary"]}, uvp,
                lambda p, s, t, wfn=wfn: wfn(p, s, t), lambda s, t, sd: 1.0,
                outward=lambda p: np.array((p[0] - cx[0], p[1] - cx[1], 0.0)))
        # gold hem band: the last 4.5 cm of the panel, a little thicker so it wraps the edge
        t0 = 1 - 0.045 / length
        Th = np.linspace(t0, 1.0, 3)
        Gt = np.array([[point(s, t) for t in Th] for s in S])
        ext = Gt[:, -1] - Gt[:, -2]
        Gt[:, -1] += ext / np.linalg.norm(ext, axis=1, keepdims=True) * 0.003
        K.sheet(mbs["trim"], Gt, 0.0105, {"out": mats["trim"], "in": mats["trim"]},
                lambda s, t, sd: (T_BAND[0] + t * (T_BAND[2] - T_BAND[0]), T_BAND[1] + s * (T_BAND[3] - T_BAND[1])),
                lambda p, s, t, t0=t0, wfn=wfn: wfn(p, 0.0, t0 + t * (1 - t0)), lambda s, t, sd: 0.6,
                outward=lambda p: np.array((p[0] - cx[0], p[1] - cx[1], 0.0)))
        K.add_bone(rig, n0, tuple(point(0.0, 0.0)), "hips")
        if hinge:
            K.add_bone(rig, n1, tuple(point(0.0, hinge)), n0)
        rep[label] = {"az": azd, "length": length, "top": [round(float(x), 3) for x in point(0.0, 0.0)],
                      "hem_z": round(float(point(0.0, 1.0)[2]), 3)}
    REPORT["skirt"] = rep


# ================================================================================================ harness
def harness(body, mbs, mats):
    ref = K.BodyRef([body], exclude=ARMS)
    loop = [(-0.075, -0.07, 1.50), (-0.03, -0.098, 1.585), (0.04, -0.098, 1.57), (0.095, -0.072, 1.50),
            (0.128, 0.0, 1.405), (0.105, 0.085, 1.335), (0.0, 0.118, 1.300), (-0.07, 0.085, 1.32),
            (-0.085, 0.0, 1.405)]
    rings = []
    for sg in (1, -1):
        pts = [(x, sg * y, z) for x, y, z in loop]
        K.strap(mbs["secondary"], ref, pts, 0.026, 0.0045, 0.0022, {"out": mats["secondary"], "in": mats["secondary"]},
                S_STRAP, closed=True, ol=0.6, uv_len=0.6)
    for c0 in ((0.128, 0.0, 1.405), (-0.085, 0.0, 1.405)):
        r = ref.nearest(c0)
        n = r["n"]
        c = r["loc"] + n * 0.009
        up = np.array((0, 0, 1.0)) - n * n[2]
        up /= np.linalg.norm(up)
        side = np.cross(n, up)
        circ = [c + 0.017 * (math.cos(a) * side + math.sin(a) * up) for a in np.linspace(0, 2 * math.pi, 20, endpoint=False)]
        K.sweep(mbs["trim"], np.array(circ), lambda t: 0.0045, {"out": mats["trim"]},
                lambda t, a: (T_METAL[0] + a * (T_METAL[2] - T_METAL[0]), T_METAL[1] + 0.5 * (T_METAL[3] - T_METAL[1])),
                lambda p, t: ref.weights(p), sides=6, closed=True, up=lambda i, p, n=n: n, olfn=lambda t: 0.6)
        rings.append([round(float(x), 3) for x in c])
    REPORT["harness_rings"] = rings


# ================================================================================================ far shoulder guard
def guard(body, rig, mbs, mats):
    ref = K.BodyRef([body])
    c = np.array(C.joint_blender("upperF")) + np.array((0.0, -0.012, -0.022))
    X, Y, Z = np.eye(3)

    def dirv(al, be):
        return math.cos(be) * Z + math.sin(be) * (math.cos(al) * Y + math.sin(al) * X)

    def rad(al, be):
        d = dirv(al, be)
        loc, n, i, dist = ref.bvh.ray_cast(Vector(tuple(c)), Vector(tuple(d)))
        return dist if loc is not None else 0.06
    for b0, b1, extra, a_hw in ((math.radians(8), math.radians(64), 0.024, math.radians(68)),
                                (math.radians(56), math.radians(98), 0.034, math.radians(60))):
        nu, nv = 9, 7
        A = np.linspace(-a_hw, a_hw, nu)
        B = np.linspace(b0, b1, nv)
        R = np.array([[rad(al, be) for be in B] for al in A])
        for _ in range(3):
            R[1:-1, 1:-1] = 0.5 * R[1:-1, 1:-1] + 0.125 * (R[:-2, 1:-1] + R[2:, 1:-1] + R[1:-1, :-2] + R[1:-1, 2:])
        Rm = max(R.mean(), 0.05)
        G = np.array([[c + dirv(al, be) * (0.5 * R[i, j] + 0.5 * Rm + extra) for j, be in enumerate(B)]
                      for i, al in enumerate(A)])
        K.sheet(mbs["leather"], G, 0.0065, {"out": mats["leather"], "in": mats["leather"]},
                lambda s, t, sd: (L_GUARD[0] + s * (L_GUARD[2] - L_GUARD[0]), L_GUARD[1] + (1 - t) * (L_GUARD[3] - L_GUARD[1])),
                lambda p, s, t: {"pad_F": 1.0}, lambda s, t, sd: 1.0, outward=lambda p: p - c)
        # gold edge along the lower rim of the plate
        Be = np.linspace(b1 - math.radians(7), b1 + math.radians(1.5), 2)
        Ge = np.array([[c + dirv(al, be) * (0.5 * R[i, -1] + 0.5 * Rm + extra + 0.0015) for be in Be]
                       for i, al in enumerate(A)])
        K.sheet(mbs["trim"], Ge, 0.009, {"out": mats["trim"], "in": mats["trim"]},
                lambda s, t, sd: (T_BAND[0] + t * (T_BAND[2] - T_BAND[0]), T_BAND[1] + s * (T_BAND[3] - T_BAND[1])),
                lambda p, s, t: {"pad_F": 1.0}, lambda s, t, sd: 0.6, outward=lambda p: p - c)
    K.add_bone(rig, "pad_F", tuple(C.joint_blender("upperF")), "chest")
    REPORT["guard"] = {"centre": [round(float(x), 3) for x in c]}


# ================================================================================================ hair
def clean_hair(hair):
    """Drop the small leftover cards of the removed twin tails / ears (islands sticking out at the sides / back)."""
    me = hair.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    seen, kill = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        comp, stack = [], [v]
        seen.add(v.index)
        while stack:
            a_ = stack.pop()
            comp.append(a_)
            for e in a_.link_edges:
                b_ = e.other_vert(a_)
                if b_.index not in seen:
                    seen.add(b_.index)
                    stack.append(b_)
        P = np.array([tuple(x.co) for x in comp])
        if len(comp) <= 30 and (np.abs(P[:, 1]).max() > 0.124 or P[:, 0].min() < -0.12):
            kill += comp
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me.update()
    REPORT["hair_clean_verts"] = len(kill)


def hair_atlas(hair, cfg, tex_dir, extra=()):
    """MAT-hair texture -> 512 x 2048 in four full-width slots (VRoid UVs tile in u, so every slot spans the width):
    v 0.75..1  VRoid strands (dark), v 0.5..0.75 the same strands recoloured white (the near side lock, attribute
    vr_streak), v 0..0.5 painted ponytail strands: dark (u 0..0.5) and white streak (u 0.5..1)."""
    m = hair.data.materials[0]
    tex = next(n for n in m.node_tree.nodes if n.type == "TEX_IMAGE")
    src = VF.resized(VF.image_px(tex.image), 512, 512)
    out = np.zeros((2048, 512, 4), dtype=np.float32)
    out[1536:] = src
    white = src.copy()
    VF.recolour_ramp(white, 0x9C93A4, 0xF4F0EC, 0xFFFFFF, gamma=0.8)
    out[1024:1536] = white
    cv = K.Canvas(512, 1024)

    def strands(s, t, dark, base, lit, line):
        # t: 0 tip .. 1 root.  Root darker, lit toward the middle, ink strand lines at fixed u (clump edges)
        c = K.mix(K.C3(dark), K.C3(base), K.smooth01(0.95, 0.55, t)[..., None])
        c = K.mix(c, K.C3(lit), (K.smooth01(0.15, 0.45, t) * K.smooth01(0.85, 0.6, t))[..., None] * 0.55)
        ph = (s * 3.0) % 1.0
        c = K.mix(c, K.C3(line), K.band(ph, 0.5, 0.05, 0.03)[..., None] * 0.55)
        c = K.mix(c, K.C3(line), (K.band((s * 5.0 + 0.3) % 1.0, 0.5, 0.03, 0.02) * K.smooth01(0.0, 0.5, t))[..., None] * 0.3)
        return c
    cv.paint((0.0, 0.0, 0.5, 1.0), lambda s, t: strands(s, t, cfg["hair_shade"], 0x2A1A17, cfg["hair_lit"], 0x0C0606),
             pad=0.004)
    cv.paint((0.5, 0.0, 1.0, 1.0), lambda s, t: strands(s, t, 0xA49AA8, 0xE2DCDA, 0xFFFBF5, 0x8C8090), pad=0.004)
    out[:1024, :, :3] = cv.px[..., :3]
    out[:1024, :, 3] = 1.0
    img = VF.new_image("%s_hair_atlas" % CID, out)
    path = os.path.join(tex_dir, "asha_hair_atlas.png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.filepath = path
    tex.image = img
    n_st = 0
    for ob in [hair] + list(extra):
        me = ob.data
        streak = K.point_attr(me, "vr_streak")
        uv = me.uv_layers.active.data
        for p in me.polygons:
            st = all(streak[v] > 0.5 for v in p.vertices)
            n_st += st
            base = 0.5 if st else 0.75
            for l in p.loop_indices:
                u, v = uv[l].uv
                uv[l].uv = (u, base + 0.25 * min(max(v, 0.0), 1.0))
    REPORT["hair_atlas"] = {"path": path, "streak_faces": int(n_st)}


def hair_uv(region_u, t, a):
    """u across the clump section (a 0..1), v from the root (0.5) down to the tip (0)."""
    u0, u1 = region_u
    return (u0 + a * (u1 - u0), 0.5 * (1 - t) * 0.98 + 0.005)


# root on the upper back of the crown (ray 58 deg from vertical); the tail swings back hard at the root and hangs
# near vertical below (a progressive bend: pitch_root at the tie easing to pitch_tip from 15 % to 70 % of the length)
PONY = {"yaw_deg": 90.0, "root_ray_deg": 62.0, "pitch_root": 16.0, "pitch_tip": -4.0, "scale_len": 1.36,
        "scale_cross": 1.2, "root_dz": 0.0, "root_dx": 0.004}


def islands(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    seen, out = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        comp, stack = [], [v]
        seen.add(v.index)
        while stack:
            a_ = stack.pop()
            comp.append(a_.index)
            for e in a_.link_edges:
                b_ = e.other_vert(a_)
                if b_.index not in seen:
                    seen.add(b_.index)
                    stack.append(b_)
        out.append(comp)
    bm.free()
    return out


def ponytail(hair, rig, mb_trim, mat_trim, prep):
    """The high ponytail is the authored VRoid twin tail kept by a1b_prep.py (vr_pony): split off the hair mesh,
    turned from the side of the head to the back (yaw), swung a little further back (pitch), scaled up slightly and
    seated at the crown. Its VRoid chain shares (vr_pony0..2) become hair_0..2; a few outer cards carry the white
    streak (white strand slot of the hair atlas). Returns the new object."""
    me = hair.data
    flag = K.point_attr(me, "vr_pony") > 0.5
    pony = hair.copy()
    pony.data = hair.data.copy()
    pony.name = "GEO-%s_ponytail" % CID
    pony.data.name = pony.name
    U.col("LOW").objects.link(pony)
    bm = bmesh.new()
    bm.from_mesh(pony.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.nonzero(~flag)[0]], context="VERTS")
    bm.to_mesh(pony.data)
    bm.free()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.nonzero(flag)[0]], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me.update()
    pm = pony.data
    if pm.attributes.get("custom_normal") is not None:
        pm.attributes.remove(pm.attributes["custom_normal"])
    # transform: yaw about the vertical through the root, pitch about the lateral axis, scale, seat at the crown
    heads = [np.array(h) for h in prep["heads"]]
    root = heads[0]
    hc = np.array((-0.012, 0.0, 1.845))
    d = np.array((-math.sin(math.radians(PONY["root_ray_deg"])), 0.0, math.cos(math.radians(PONY["root_ray_deg"]))))
    loc, n, i, dist = K.BodyRef([hair]).bvh.ray_cast(Vector(tuple(hc + d * 0.3)), Vector(tuple(-d)))
    R = (np.array(loc) if loc is not None else hc + d * 0.12) + np.array((PONY["root_dx"], 0.0, PONY["root_dz"]))
    yaw = Matrix.Rotation(math.radians(PONY["yaw_deg"]), 3, "Z")
    ax_src = np.array(prep["tip"]) - root
    L_src = float(np.linalg.norm(ax_src))
    ax_src /= np.linalg.norm(ax_src)
    S = PONY["scale_cross"] * np.eye(3) + (PONY["scale_len"] - PONY["scale_cross"]) * np.outer(ax_src, ax_src)
    YS = np.array(yaw) @ S

    def xf(p):
        q = np.asarray(p) - root
        u = float(q @ ax_src) / L_src
        th = PONY["pitch_root"] + (PONY["pitch_tip"] - PONY["pitch_root"]) * float(K.smooth01(0.15, 0.7, u))
        Ry = np.array(Matrix.Rotation(math.radians(th), 3, "Y"))         # + swings the tail back (-X)
        return R + Ry @ (YS @ q)
    co = K.vert_co(pm)
    new = np.array([xf(p) for p in co])
    dy = xf(heads[0])[1]
    new[:, 1] -= dy
    pm.vertices.foreach_set("co", new.astype(np.float32).ravel())
    pm.update()
    nh = [xf(h) - np.array((0.0, dy, 0.0)) for h in heads]
    # weights: head + hair_0..2 from the VRoid chain shares
    w0, w1, w2 = (K.point_attr(pm, "vr_pony%d" % k) for k in range(3))
    for g in list(pony.vertex_groups):
        pony.vertex_groups.remove(g)
    groups = {nm: pony.vertex_groups.new(name=nm) for nm in ("head", "hair_0", "hair_1", "hair_2")}
    for v in pm.vertices:
        ws = {"hair_0": float(w0[v.index]), "hair_1": float(w1[v.index]), "hair_2": float(w2[v.index])}
        ws["head"] = max(0.0, 1.0 - sum(ws.values()))
        tot = sum(ws.values()) or 1.0
        for k, x in ws.items():
            if x / tot > 0.005:
                groups[k].add([v.index], x / tot, "REPLACE")
    # white streak: the outermost cards on the near side of the tail (lateral offset from the tail's own centre at
    # that height beyond PONY_STREAK[0] of its half width)
    zbin = np.round(new[:, 2] / 0.02).astype(int)
    st = np.zeros(len(pm.vertices), dtype=bool)
    mid, half = {}, {}
    for zb_ in np.unique(zbin):
        ys = new[zbin == zb_, 1]
        mid[zb_], half[zb_] = 0.5 * (ys.max() + ys.min()), max(0.5 * (ys.max() - ys.min()), 1e-3)
    ratio = np.array([(mid[zb_] - y) / half[zb_] for zb_, y in zip(zbin, new[:, 1])])
    comps = islands(pm)
    stats = []
    for comp in comps:
        rr = float(ratio[comp].mean())
        stats.append(rr)
        if rr > PONY_STREAK[0]:
            st[comp] = True
    REPORT["pony_streak_ratios"] = sorted(round(x, 2) for x in stats)[-12:]
    att = pm.attributes.get("vr_streak") or pm.attributes.new("vr_streak", "FLOAT", "POINT")
    att.data.foreach_set("value", st.astype(np.float32))
    # hair tie at the root and the bones
    T = (nh[1] - nh[0]) / np.linalg.norm(nh[1] - nh[0])
    N1 = np.cross(T, (0, 1.0, 0))
    N1 /= np.linalg.norm(N1)
    N2 = np.cross(T, N1)
    c = nh[0] + T * 0.03
    circ = [c + 0.026 * (math.cos(t_) * N1 + math.sin(t_) * N2) for t_ in np.linspace(0, 2 * math.pi, 16, endpoint=False)]
    K.sweep(mb_trim, np.array(circ), lambda t: 0.007, {"out": mat_trim},
            lambda t, a_: (T_METAL[0] + a_ * (T_METAL[2] - T_METAL[0]), T_METAL[1] + 0.5 * (T_METAL[3] - T_METAL[1])),
            lambda p, t: {"head": 1.0}, sides=6, closed=True, up=lambda i, p, T=T: T, olfn=lambda t: 0.6)
    K.add_bone(rig, "hair_0", tuple(nh[0]), "head")
    K.add_bone(rig, "hair_1", tuple(nh[1]), "hair_0")
    K.add_bone(rig, "hair_2", tuple(nh[2]), "hair_1")
    K.bind(pony, rig)
    REPORT["ponytail"] = {"source": prep["chain"][0], "verts": len(pm.vertices), "streak_verts": int(st.sum()),
                          "root": [round(float(x), 3) for x in nh[0]], "tip_z": round(float(new[:, 2].min()), 3)}
    return pony


PONY_STREAK = (0.42, 0.0)     # outer cards only: mean lateral offset toward the near side, in half widths


def front_lock(mb, mat_hair):
    """A white lock falling from the near temple beside the face (the streak shows from the game camera)."""
    pts = np.array([(0.074, -0.078, 1.905), (0.088, -0.098, 1.855), (0.086, -0.108, 1.805), (0.076, -0.112, 1.77),
                    (0.068, -0.108, 1.748)])
    P = K.catmull(pts, 18)
    hc = np.array((0.0, 0.0, 1.82))
    K.sweep(mb, P, lambda t: 0.0075 * (0.6 + 0.4 * float(K.smooth01(0, 0.25, t))) * (1 - t) ** 0.8 + 0.0008,
            {"out": mat_hair}, lambda t, a: hair_uv((0.5, 1.0), t, a), lambda p, t: {"head": 1.0}, sides=6,
            up=lambda i, p: (p - hc) * np.array((1.0, 1.0, 0.0)), flat=2.2, olfn=lambda t: 0.7)


class _HeadW:
    def weights(self, p):
        return {"head": 1.0}


def headband(hair, face, rig, mbs, mats, eye_z):
    co = np.vstack([K.vert_co(hair.data), K.vert_co(face.data)])
    cx, cy = 0.0, 0.0
    zf, zb = eye_z + 0.072, eye_z + 0.092
    n = 48
    rs, zs = [], []
    for k in range(n):
        th = 2 * math.pi * k / n
        dirv = np.array((math.cos(th), -math.sin(th)))
        z = zf + (zb - zf) * (1 - math.cos(th)) / 2
        m = np.abs(co[:, 2] - z) < 0.014
        P = co[m, :2] - (cx, cy)
        dist = P @ dirv
        lat = np.abs(P @ np.array((-dirv[1], dirv[0])))
        ok = lat < 0.02
        rs.append(dist[ok].max() if ok.any() else 0.1)
        zs.append(z)
    rs = np.array(rs)
    for _ in range(4):
        rs = 0.5 * rs + 0.25 * (np.roll(rs, 1) + np.roll(rs, -1))
    rs = np.maximum(rs, 0.06) + 0.002
    pts = np.array([(cx + r * math.cos(2 * math.pi * k / n), cy - r * math.sin(2 * math.pi * k / n), z)
                    for k, (r, z) in enumerate(zip(rs, zs))])
    K.strap(mbs["secondary"], None, pts, 0.022, 0.0042, 0.0, {"out": mats["secondary"], "in": mats["secondary"]},
            S_BAND, closed=True, ol=1.0, drape=False, samples=n,
            up_fn=lambda i, p: np.array((p[0] - cx, p[1] - cy, 0.0)), wref=_HeadW(), uv_len=0.25)
    kn = int(round(n * 128 / 360))
    kd = np.array((pts[kn][0] - cx, pts[kn][1] - cy, 0.0))
    kd /= np.linalg.norm(kd)
    kb = pts[kn] + kd * 0.010 + np.array((0, 0, -0.004))
    kt = np.cross((0, 0, 1.0), kd)
    K.sweep(mbs["secondary"], np.array([kb + kt * 0.02 - kd * 0.006, kb + kd * 0.004, kb - kt * 0.02 - kd * 0.006]),
            lambda t: 0.012 * (0.6 + 0.4 * math.sin(math.pi * t)), {"out": mats["secondary"]},
            lambda t, a: (S_BAND[0] + a * (S_BAND[2] - S_BAND[0]), 0.5), lambda p, t: {"head": 1.0}, sides=8,
            up=lambda i, p: np.array((0, 0, 1.0)), flat=1.0)
    tails = [
        [kb, kb + (-0.04, -0.010, -0.04), kb + (-0.075, -0.018, -0.12), kb + (-0.095, -0.022, -0.22),
         kb + (-0.105, -0.020, -0.33), kb + (-0.105, -0.014, -0.43)],
        [kb, kb + (-0.035, -0.024, -0.045), kb + (-0.06, -0.045, -0.12), kb + (-0.075, -0.058, -0.21),
         kb + (-0.08, -0.066, -0.30), kb + (-0.078, -0.07, -0.37)],
    ]
    first = None
    for tp in tails:
        P = K.catmull([np.array(x) for x in tp], 22)
        acc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
        L = acc[-1]
        T, Nn, Bn = K.frames(P, lambda i, p, kd=kd: np.array((kd[0], kd[1], 0.15)), False)
        W = 3
        G = np.zeros((W, len(P), 3))
        for i in range(len(P)):
            t = acc[i] / L
            w = 0.034 - 0.006 * t
            for a_ in range(W):
                G[a_, i] = P[i] + Bn[i] * (a_ - 1) * w * 0.5
        G[1, -1] = G[1, -2] + (G[1, -1] - G[1, -2]) * 0.1 - T[-1] * 0.022       # swallowtail notch

        def wfn(p, s, t):
            wh = 1 - float(K.smooth01(0.0, 0.08, t))
            b = float(K.smooth01(0.38, 0.52, t))
            return K.blend_w(({"head": 1.0}, wh), ({"tail_0": 1.0}, (1 - wh) * (1 - b)), ({"tail_1": 1.0}, (1 - wh) * b))
        K.sheet(mbs["secondary"], G, 0.004, {"out": mats["secondary"], "in": mats["secondary"]},
                lambda s, t, sd, L=L: (S_BAND[0] + s * (S_BAND[2] - S_BAND[0]), t * L / 0.25),
                wfn, lambda s, t, sd: 1.0, N=np.repeat(Nn[None], W, axis=0))
        if first is None:
            first = (P, acc, L)
    P, acc, L = first
    K.add_bone(rig, "tail_0", tuple(kb), "head")
    K.add_bone(rig, "tail_1", tuple(np.array([np.interp(0.45 * L, acc, P[:, k]) for k in range(3)])), "tail_0")
    REPORT["headband"] = {"front_z": round(zf, 3), "back_z": round(zb, 3), "knot": [round(float(x), 3) for x in kb]}


# ================================================================================================ build
def tune_base_materials(cfg):
    """Rims: the full character rim is too loud on dark hair; skin keeps a softer one (runtime adds the game rim)."""
    for name, k in (("MAT-skin", 0.30), ("MAT-face", None), ("MAT-hair", None)):
        m = bpy.data.materials.get(name)
        if m is None or not m.get("toon"):
            continue
        t = dict(m["toon"])
        t["rimColor"] = [round(float(x), 4) for x in K.rim_of(cfg, k)] if k else None
        if name == "MAT-hair":
            t["outlineWidth"] = 0.0020
        m["toon"] = t


def clean_face_texture(face, tex_dir):
    """The flattened VRoid face skin keeps a few painted white glints (lower lip, nose tip) that read as spots on
    the darker skin: clamp texels much brighter than the skin median in the face-skin slot of the MAT-face atlas."""
    m = face.data.materials[0]
    tex = next(n for n in m.node_tree.nodes if n.type == "TEX_IMAGE")
    px = VF.image_px(tex.image)
    h, w = px.shape[:2]
    slot = px[h // 2:, : w // 2]
    a = slot[..., 3] > 0.5
    lum = slot[..., :3] @ np.array([0.2126, 0.7152, 0.0722])
    med = np.median(slot[a][:, :3], axis=0)
    mlum = float(med @ np.array([0.2126, 0.7152, 0.0722]))
    hot = a & (lum > mlum * 1.45)
    slot[hot, :3] = med * 1.04
    px[h // 2:, : w // 2] = slot
    img = VF.new_image(tex.image.name + "_c", px)
    path = os.path.join(tex_dir, "asha_face_clean.png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.filepath = path
    tex.image = img
    REPORT["face_glints_removed"] = int(hot.sum())


def eye_height(face):
    me = face.data
    zs = [me.vertices[v].co.z for p in me.polygons if p.material_index == 1 for v in p.vertices]
    return float(np.mean(zs))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", default=CID)
    a = ap.parse_args(U.args_after_dashes())
    cfg = vroid_chars.get(CID)
    cdir = U.char_dir(CID)
    bpy.ops.wm.open_mainfile(filepath=os.path.join(cdir, "%s_anime_master.blend" % CID))
    rig = bpy.data.objects["ARM-%s" % CID]
    body = bpy.data.objects["GEO-%s_body" % CID]
    face = bpy.data.objects["GEO-%s_face" % CID]
    hair = bpy.data.objects["GEO-%s_hair" % CID]
    tex_dir = os.path.join(cdir, "textures", "costume")
    mats = make_materials(cfg, tex_dir)
    mbs = {k: K.MB() for k in ("primary", "secondary", "trim", "leather")}
    regions = body_garments(body, mats)
    top_trims(body, regions["top"], mbs, mats)
    belt(body, mbs, mats)
    skirt(body, rig, mbs, mats)
    harness(body, mbs, mats)
    guard(body, rig, mbs, mats)
    boots(body, mbs, mats)
    clean_hair(hair)
    prep = json.load(open(os.path.join(cdir, "review", "a1b_prep", "prep_report.json")))["hair"]["pony"]
    pony = ponytail(hair, rig, mbs["trim"], mats["trim"], prep)
    hair_atlas(hair, cfg, tex_dir, extra=[pony])
    headband(hair, face, rig, mbs, mats, eye_height(face))
    built = []
    for k, mb in mbs.items():
        if mb.F:
            built.append(mb.build("GEO-%s_%s" % (CID, k), [mats[k]], rig=rig))
    for ob in built + [body, pony]:
        K.limit_weights(ob)
    tune_base_materials(cfg)
    clean_face_texture(face, tex_dir)
    REPORT["bones"] = [b.name for b in rig.data.bones]
    REPORT["tris"] = {o.name: K.tris(o) for o in U.col("LOW").objects if o.type == "MESH"}
    REPORT["tris_total"] = sum(REPORT["tris"].values())
    REPORT["materials"] = sorted({m.name for o in U.col("LOW").objects if o.type == "MESH" for m in o.data.materials})
    U.write_json(os.path.join(cdir, "review", "a2_costume", "costume_report.json"), REPORT)
    U.log("COSTUME", json.dumps(REPORT))
    U.save(os.path.join(cdir, "%s_master.blend" % CID))


if __name__ == "__main__":
    main()
