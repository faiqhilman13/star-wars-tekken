"""VEXA A2 COSTUME: the finished VRoid master (vroid_finish.py) armoured as "The Crimson Marauder"
(art/ANIME_DIRECTION.md).

  python tools/blender/run.py art/characters/vexa/build/a2_costume.py -- --char vexa

Reads  art/characters/vexa/vexa_anime_master.blend
Writes art/characters/vexa/vexa_master.blend (+ textures/costume/*.png, review/a2_costume/costume_report.json)

Contract frame: faces +X, up +Z, near (sword) side = -Y. Pieces, all clean bold shapes (no noise):
  bodysuit     every body face re-materialed (dark charcoal, seams); hands -> leather gloves
  cuirass      sculpted black chest plate + three abdominal lames, crimson edge strips
  pauldrons    big layered pauldron on the sword shoulder (pad_N) with a raised flange, small one far (pad_F)
  gauntlets    forearm plates with a flared cuff over leather gloves
  waist        crimson sash, leather belt, round metal buckle
  coat         six long panels split front and back, black outside / crimson lining, crimson edges (skirt_*)
  cape         tattered cape from the shoulders (cape_0..3), black / charcoal inside
  boots        armoured boots: leather shin tube + lofted foot + sole, metal greave and knee cop
  head         hood (head -> neck -> chest), faceted black half-mask with a red visor slit (MAT-visor), one
               authored VRoid lock escaping the hood; the hidden face mesh is dropped
Materials (6): MAT-hair, MAT-vexa_primary, _secondary, _trim, _metal (armour + patent-black gloves, boots and
belt atlased), MAT-visor. The face mesh is dropped (hidden under the mask).
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

REPO = os.environ.get("SABER_REPO", ".")
sys.path.insert(0, os.path.join(REPO, "art", "characters", "asha", "build"))
sys.path.insert(0, os.path.join(REPO, "tools", "blender"))
import sd_contract as C  # noqa: E402
import sd_util as U  # noqa: E402
import toonkit as K  # noqa: E402
import vroid_chars  # noqa: E402
import vroid_finish as VF  # noqa: E402

REPORT = {}
CID = "vexa"

# ------------------------------------------------------------------------------------------------ palette (sRGB)
COAT = 0x1D1C22          # LOOKS.primary
COAT_HI = 0x2E2C35
COAT_DK = 0x111015       # primaryDark
SUIT = 0x34323C          # LOOKS.secondary 0x2b2a31, lifted a touch so the armour reads against it
SUIT_HI = 0x46434F
SUIT_DK = 0x18171C
CRIMSON = 0x8E0F1E       # LOOKS.trim 0x8a121c, deepened so the warm arena rim can't push it orange
CRIMSON_HI = 0xA8182A
CRIMSON_DK = 0x4A0610
LEA = 0x111114           # LOOKS.glove
LEA_HI = 0x26252B
METAL = 0x23252B         # black lacquered armour (LOOKS.metal 0x40444c as the highlight)
METAL_HI = 0x5C6370
METAL_DK = 0x15161A
VISOR = 0xFF2020

# atlas rects
P_COAT_OUT = (0.0, 0.0, 0.48, 1.0)       # coat panels outside (v: waist 1 -> hem 0)
P_CAPE_OUT = (0.52, 0.0, 1.0, 0.48)
P_HOOD = (0.52, 0.52, 1.0, 1.0)
S_SUIT = (0.0, 0.0, 1.0, 0.70)           # bodysuit cylinder (full width)
S_INNER = (0.0, 0.74, 0.48, 1.0)         # cape / hood inside
S_COLLAR = (0.52, 0.74, 1.0, 1.0)
T_LINING = (0.0, 0.0, 0.48, 1.0)         # coat lining
T_BAND = (0.52, 0.0, 0.74, 1.0)          # edge strips (full-height column: v repeats along the strip)
T_SASH = (0.78, 0.0, 1.0, 1.0)           # sash (full-height column)
# MAT-vexa_metal atlas: armour, mask and the (black patent) leather parts share one texture (7 materials)
M_PLATE = (0.0, 0.0, 0.5, 0.24)          # armour plates: u across, v along (dark lacquer, edge highlight)
M_TRIMMED = (0.5, 0.0, 1.0, 0.24)        # plates with a painted crimson inlay line
M_MASK = (0.0, 0.26, 0.24, 0.5)
L_BELT = (0.26, 0.26, 0.48, 0.5)
L_GLOVE = (0.5, 0.26, 0.74, 0.5)
L_SOLE = (0.76, 0.26, 1.0, 0.5)
L_BOOT = (0.0, 0.52, 1.0, 1.0)

TORSO = ("hips", "spine", "chest", "neck")
LEGS = ("thighN", "shinN", "footN", "thighF", "shinF", "footF")
ARMS = ("upperN", "foreN", "handN", "upperF", "foreF", "handF")
Z_BOOT = 0.50
Z_GAUNT0, Z_GAUNT1 = 1.03, 1.255


def cyl_st(co, centre, z0, z1):
    a = math.atan2(-(co[1] - centre[1]), co[0] - centre[0])
    s = (a / (2 * math.pi) + 0.5) % 1.0
    return s, (co[2] - z0) / (z1 - z0)


def dominant(ob):
    names = {g.index: g.name for g in ob.vertex_groups}
    out = []
    for v in ob.data.vertices:
        g = max(v.groups, key=lambda g: g.weight) if v.groups else None
        out.append(names[g.group] if g else "")
    return np.array(out)


def ray(ref, origin, d, maxd=0.5):
    loc, n, i, dist = ref.bvh.ray_cast(Vector(tuple(origin)), Vector(tuple(d)))
    return dist if (loc is not None and dist < maxd) else None


# ================================================================================================ textures
def paint_primary(path):
    cv = K.Canvas(1024, 1024, COAT)
    c0, hi, dk = K.C3(COAT), K.C3(COAT_HI), K.C3(COAT_DK)
    ink = K.C3(0x08070A)

    def coat(s, t):
        # t = 1 at the waist, 0 at the hem: a lit band near the top, darker toward the hem, two fold strokes
        c = K.mix(dk, c0, K.smooth01(0.0, 0.5, t)[..., None])
        c = K.mix(c, hi, (K.smooth01(0.7, 0.95, t) * 0.6)[..., None])
        for fx in (0.3, 0.68):
            c = K.mix(c, ink, (K.band(s, fx, 0.012, 0.008) * K.smooth01(0.85, 0.3, t))[..., None] * 0.55)
        return c
    cv.paint(P_COAT_OUT, coat, pad=0.01)

    def cape(s, t):
        c = K.mix(dk, c0, K.smooth01(0.0, 0.6, t)[..., None])
        for fx in (0.2, 0.45, 0.7, 0.88):
            c = K.mix(c, ink, (K.band(s, fx, 0.01, 0.008) * K.smooth01(0.9, 0.2, t))[..., None] * 0.45)
        return c
    cv.paint(P_CAPE_OUT, cape, pad=0.01)
    cv.paint(P_HOOD, lambda s, t: K.mix(dk, hi, K.smooth01(0.2, 0.9, t)[..., None] * 0.7), pad=0.01)
    return cv.save("%s_primary" % CID, path)


def paint_secondary(path):
    cv = K.Canvas(1024, 1024, SUIT)
    c0, hi, dk = K.C3(SUIT), K.C3(SUIT_HI), K.C3(SUIT_DK)
    ink = K.C3(0x0C0B0E)

    def suit(s, t):
        # vertical gradient + side seams (s = 0.25 / 0.75) and a front seam; quilted bands on the upper arms / thighs
        c = K.mix(dk, c0, K.smooth01(0.0, 0.8, t)[..., None])
        side = np.minimum(np.abs(s - 0.25), np.abs(s - 0.75))
        c = K.mix(c, ink, K.band(side, 0.0, 0.006, 0.003)[..., None] * 0.8)
        c = K.mix(c, hi, K.band(side, 0.012, 0.008, 0.004)[..., None] * 0.35)
        c = K.mix(c, ink, K.band(s, 0.5, 0.004, 0.002)[..., None] * 0.5)
        return c
    cv.paint(S_SUIT, suit, pad=0.01)
    cv.paint(S_INNER, lambda s, t: K.mix(dk, c0, K.smooth01(0.0, 1.0, t)[..., None] * 0.6), pad=0.01)
    cv.paint(S_COLLAR, lambda s, t: K.mix(dk, hi, K.smooth01(0.0, 1.0, t)[..., None] * 0.6), pad=0.01)
    return cv.save("%s_secondary" % CID, path)


def paint_trim(path):
    cv = K.Canvas(512, 512, CRIMSON)
    c0, hi, dk = K.C3(CRIMSON), K.C3(CRIMSON_HI), K.C3(CRIMSON_DK)
    cv.paint(T_LINING, lambda s, t: K.mix(dk, c0, K.smooth01(0.0, 0.7, t)[..., None]), pad=0.01)

    def band(s, t):
        c = K.mix(c0, hi, K.band(s, 0.42, 0.3, 0.1)[..., None] * 0.5)
        return K.mix(c, dk, (1 - K.band(s, 0.5, 0.84, 0.03))[..., None])
    cv.paint(T_BAND, band, pad=0.01)

    def sash(s, t):
        c = K.mix(dk, c0, K.band(s, 0.5, 0.7, 0.2)[..., None])
        c = K.mix(c, hi, K.band(s, 0.38, 0.12, 0.08)[..., None] * 0.5)
        return c
    cv.paint(T_SASH, sash, pad=0.01)
    return cv.save("%s_trim" % CID, path)


def paint_metal(path):
    cv = K.Canvas(1024, 1024, METAL)
    c0, hi, dk = K.C3(METAL), K.C3(METAL_HI), K.C3(METAL_DK)

    def plate(s, t):
        # lacquered black plate: lighter toward the top edge, a crisp light bevel line along both edges
        c = K.mix(dk, c0, K.smooth01(0.0, 0.8, t)[..., None])
        c = K.mix(c, hi, (K.band(t, 0.96, 0.04, 0.01) + K.band(t, 0.04, 0.03, 0.01))[..., None] * 0.6)
        return c
    cv.paint(M_PLATE, plate, pad=0.01)

    def mask(s, t):
        c = K.mix(dk, c0, K.smooth01(0.0, 1.0, t)[..., None])
        return c
    cv.paint(M_MASK, mask, pad=0.01)

    def inlay(s, t):
        c = K.mix(dk, c0, K.smooth01(0.0, 0.8, t)[..., None])
        c = K.mix(c, K.C3(CRIMSON), K.band(t, 0.82, 0.035, 0.008)[..., None])
        c = K.mix(c, hi, K.band(t, 0.96, 0.04, 0.01)[..., None] * 0.6)
        return c
    cv.paint(M_TRIMMED, inlay, pad=0.01)
    lc, lhi, ldk = K.C3(LEA), K.C3(LEA_HI), K.C3(0x070709)

    def boot(s, t):
        c = K.mix(ldk, lc, K.smooth01(0.0, 0.6, t)[..., None])
        c = K.mix(c, lhi, K.band(t, 0.93, 0.06, 0.01)[..., None] * 0.8)
        return K.mix(c, ldk, K.band(t, 0.30, 0.012, 0.004)[..., None])
    cv.paint(L_BOOT, boot, pad=0.01)
    cv.paint(L_GLOVE, lambda s, t: K.mix(ldk, lhi, K.smooth01(0.0, 1.0, t)[..., None] * 0.5), pad=0.01)

    def belt(s, t):
        c = K.mix(lc, lhi, K.band(s, 0.45, 0.3, 0.1)[..., None] * 0.6)
        c = K.mix(c, ldk, (1 - K.band(s, 0.5, 0.84, 0.02))[..., None])
        return K.mix(c, K.C3(0x5A5560), (K.band(s, 0.17, 0.03, 0.01) + K.band(s, 0.83, 0.03, 0.01))[..., None] * 0.5)
    cv.paint(L_BELT, belt, pad=0.008)
    cv.paint(L_SOLE, lambda s, t: K.mix(ldk, lc, K.smooth01(0.0, 1.0, t)[..., None] * 0.5), pad=0.01)
    return cv.save("%s_metal" % CID, path)


def make_materials(cfg, tex_dir):
    rim = K.rim_of(cfg, 0.30)
    out = {}
    out["primary"] = K.toon_material("MAT-vexa_primary", paint_primary(os.path.join(tex_dir, "vexa_primary.png")),
                                     K.toon_extras(cfg, COAT, 0x0E080E, toony=0.92, rim=rim, outline=0.0022))
    out["secondary"] = K.toon_material("MAT-vexa_secondary",
                                       paint_secondary(os.path.join(tex_dir, "vexa_secondary.png")),
                                       K.toon_extras(cfg, SUIT, 0x151018, toony=0.92, rim=rim, outline=0.0022))
    out["trim"] = K.toon_material("MAT-vexa_trim", paint_trim(os.path.join(tex_dir, "vexa_trim.png")),
                                  K.toon_extras(cfg, CRIMSON, CRIMSON_DK, toony=0.92, rim=None, outline=0.0018))
    out["metal"] = K.toon_material("MAT-vexa_metal", paint_metal(os.path.join(tex_dir, "vexa_metal.png")),
                                   K.toon_extras(cfg, METAL, 0x100C14, toony=0.95, shift=0.0, rim=rim,
                                                 outline=0.0022, matcap="metal"))
    vis = K.Canvas(64, 64, VISOR)
    out["leather"] = out["metal"]                 # atlased: gloves, boots and belt live in the metal texture
    out["visor"] = K.toon_material("MAT-visor", vis.save("%s_visor" % CID, os.path.join(tex_dir, "vexa_visor.png")),
                                   K.toon_extras(cfg, VISOR, VISOR, toony=1.0, rim=None, outline=0.0, unlit=True))
    return out


# ================================================================================================ body
def torso_centre(body):
    """Torso axis x by height (mid of back and front of torso-dominated vertices, bust excluded above 1.36)."""
    co = K.vert_co(body.data)
    dom = dominant(body)
    m = np.isin(dom, TORSO)
    zs = np.arange(0.95, 1.75, 0.02)
    xs = []
    for z in zs:
        sel = m & (np.abs(co[:, 2] - z) < 0.012) & (np.abs(co[:, 1]) < 0.06)
        if sel.sum() < 3:
            xs.append(np.nan)
            continue
        back = co[sel, 0].min()
        front = co[sel, 0].max() if z < 1.36 or z > 1.52 else back + 0.17
        xs.append(0.5 * (back + front))
    xs = np.array(xs)
    ok = ~np.isnan(xs)
    xs = np.interp(zs, zs[ok], xs[ok])
    for _ in range(3):
        xs[1:-1] = 0.5 * xs[1:-1] + 0.25 * (xs[:-2] + xs[2:])
    return lambda z: float(np.interp(z, zs, xs))


def bodysuit(body, mats, tc):
    """Every body face becomes the bodysuit (secondary) except the hands (leather gloves); 1.5 mm proud."""
    me = body.data
    K.bisect(body, (0, 0, Z_GAUNT0 - 0.012), (0, 0, 1), region=lambda c: abs(c.y) > 0.13 and 0.9 < c.z < 1.1)
    me.update()
    dom = dominant(body)
    suit, gloves = [], []
    for i, p in enumerate(me.polygons):
        d = dom[p.vertices[0]]
        c = p.center
        if d in ("handN", "handF") and c.z < Z_GAUNT0 - 0.012:
            gloves.append(i)
        else:
            suit.append(i)
    vs = sorted({v for i in suit for v in me.polygons[i].vertices})
    K.inflate(body, vs, lambda co: 0.0015, bridge=0.8, bridge_iters=6)

    def suit_st(co, fi, k):
        d = dom[me.polygons[fi].vertices[0]]
        if d in ("upperN", "foreN", "handN", "upperF", "foreF", "handF"):
            return cyl_st(co, (0.0, -0.19 if co[1] < 0 else 0.19), 0.95, 1.65)
        if d in LEGS and co[2] < 0.93:
            return cyl_st(co, (0.0, -0.1 if co[1] < 0 else 0.1), 0.0, 1.0)
        return cyl_st(co, (tc(co[2]), 0.0), 0.85, 1.75)
    K.assign_region(body, suit, mats["secondary"], suit_st, rect=S_SUIT)

    def glove_st(co, fi, k):
        return cyl_st(co, (0.0, -0.19 if co[1] < 0 else 0.19), 0.84, 1.03)
    K.assign_region(body, gloves, mats["leather"], glove_st, rect=L_GLOVE)
    # MAT-skin is no longer used by any face: drop the slot
    names = [m.name for m in me.materials]
    if "MAT-skin" in names:
        idx = names.index("MAT-skin")
        mi = np.zeros(len(me.polygons), dtype=np.int32)
        me.polygons.foreach_get("material_index", mi)
        assert not (mi == idx).any()
        me.materials.pop(index=idx)
        mi[mi > idx] -= 1
        me.polygons.foreach_set("material_index", mi)
    REPORT["bodysuit"] = {"suit": len(suit), "gloves": len(gloves)}


# ================================================================================================ armour helpers
def shell_grid(ref, centre_fn, z0, z1, a0, a1, nu, nv, offset, top_fn=None, smooth=2, bot_fn=None):
    """Mid-surface grid around a vertical axis: u = azimuth a0..a1 (game convention: 0 = front, + = near side),
    v = height z0..z1 (top_fn(az) / bot_fn(az) override the edges); radius = ray-cast body radius + offset."""
    A = np.linspace(a0, a1, nu)
    G = np.zeros((nu, nv, 3))
    R = np.zeros((nu, nv))
    Z = np.zeros((nu, nv))
    for i, a in enumerate(A):
        zt = top_fn(a) if top_fn else z1
        zb = bot_fn(a) if bot_fn else z0
        for j in range(nv):
            z = zb + (zt - zb) * j / (nv - 1)
            cx = centre_fn(z)
            r = ray(ref, (cx, 0.0, z), (math.cos(a), -math.sin(a), 0.0)) or 0.1
            R[i, j] = r
            Z[i, j] = z
    for _ in range(smooth):
        R[1:-1, :] = 0.5 * R[1:-1, :] + 0.25 * (R[:-2, :] + R[2:, :])
        R[:, 1:-1] = 0.5 * R[:, 1:-1] + 0.25 * (R[:, :-2] + R[:, 2:])
    for i, a in enumerate(A):
        for j in range(nv):
            r = R[i, j] + (offset(a, j / (nv - 1)) if callable(offset) else offset)
            cx = centre_fn(Z[i, j])
            G[i, j] = (cx + r * math.cos(a), -r * math.sin(a), Z[i, j])
    return G


def uv_rect(rect):
    return lambda s, t, side: (rect[0] + s * (rect[2] - rect[0]), rect[1] + t * (rect[3] - rect[1]))


def edge_strip(mb, mat, P, normal_fn, width, thick, wfn, rect=T_BAND, ol=0.6):
    """Thin strip along polyline P (open), lying on the surface whose outward normal is normal_fn(p)."""
    P = np.asarray(P, dtype=np.float64)
    T, Nn, B = K.frames(P, lambda i, p: normal_fn(p), False)
    G = np.zeros((2, len(P), 3))
    for a_, k in enumerate((-1.0, 1.0)):
        G[a_] = P + B * k * width * 0.5
    acc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    L = acc[-1]
    K.sheet(mb, G, thick, {"out": mat, "in": mat},
            lambda s, t, sd: (rect[0] + s * (rect[2] - rect[0]), t * L / 0.3), lambda p, s, t: wfn(p),
            lambda s, t, sd: ol, N=np.repeat(Nn[None], 2, axis=0))


# ================================================================================================ cuirass
def cuirass(body, mbs, mats, tc):
    ref = K.BodyRef([body], exclude=ARMS)
    mb, mt = mbs["metal"], mats["metal"]
    met = {"out": mt, "in": mt}

    def top(a):
        # high at the front / back (collar line), dipping to the armpits at the sides
        side = abs(math.sin(a))
        return 1.585 - 0.13 * side ** 2.2

    def off(a, t):
        return 0.017 + 0.004 * t
    G = shell_grid(ref, tc, 1.33, 1.585, -math.pi, math.pi, 37, 9, off, top_fn=top, smooth=3)
    K.sheet(mb, G[:-1], 0.007, met, uv_rect(M_PLATE), lambda p, s, t: ref.weights(p), lambda s, t, sd: 1.0,
            outward=lambda p: np.array((p[0] - tc(p[2]), p[1], 0.0)), closed_u=True)
    nrm = lambda p: np.array((p[0] - tc(p[2]), p[1], 0.0))  # noqa: E731
    edge_strip(mbs["trim"], mats["trim"], np.vstack([G[:-1, -1], G[:1, -1]]) + 0.0, nrm, 0.012, 0.009,
               lambda p: ref.weights(p))
    edge_strip(mbs["trim"], mats["trim"], np.vstack([G[:-1, 0], G[:1, 0]]), nrm, 0.010, 0.009,
               lambda p: ref.weights(p))
    # three abdominal lames (front and sides), each overlapping the one below
    for k, (z0, z1, extra) in enumerate(((1.262, 1.345, 0.009), (1.182, 1.27, 0.010), (1.105, 1.19, 0.011))):
        G = shell_grid(ref, tc, z0, z1, -math.radians(92), math.radians(92), 19, 4, lambda a, t, e=extra: e + 0.004 * t,
                       smooth=2)
        K.sheet(mb, G, 0.006, met, uv_rect(M_TRIMMED if k == 0 else M_PLATE), lambda p, s, t: ref.weights(p),
                lambda s, t, sd: 1.0, outward=lambda p: np.array((p[0] - tc(p[2]), p[1], 0.0)))
    REPORT["cuirass"] = True


# ================================================================================================ pauldrons
def pauldron(body, rig, mbs, mats, side, big):
    """Layered pauldron over the shoulder of `side` ('N' near / 'F' far), rigid on pad_<side>: spherical lames of
    fixed, growing radius (a clean bold dome, not a shrink-wrap), crimson rims; the big one gets a swept flange that
    rises beside the head (the sword-side silhouette)."""
    sg = -1.0 if side == "N" else 1.0
    j = np.array(C.joint_blender("upper" + side))
    c = j + np.array((0.0, sg * 0.012, -0.035))
    X, Y, Z = np.eye(3)
    out = Y * sg

    def dirv(al, be):
        return math.cos(be) * Z + math.sin(be) * (math.cos(al) * out + math.sin(al) * X)
    if big:
        lames = [(math.radians(-14), math.radians(50), 0.120, math.radians(86)),
                 (math.radians(40), math.radians(74), 0.138, math.radians(80)),
                 (math.radians(64), math.radians(96), 0.156, math.radians(74))]
    else:
        lames = [(math.radians(0), math.radians(58), 0.088, math.radians(70)),
                 (math.radians(50), math.radians(88), 0.100, math.radians(62))]
    w = {"pad_" + side: 1.0}
    for li, (b0, b1, R, a_hw) in enumerate(lames):
        A = np.linspace(-a_hw, a_hw, 13)
        B = np.linspace(b0, b1, 7)
        # slight flare toward the lower rim and a crisp crown ridge
        G = np.array([[c + dirv(al, be) * (R * (1 + 0.06 * (be - b0) / max(b1 - b0, 1e-3)))
                       for be in B] for al in A])
        K.sheet(mbs["metal"], G, 0.008, {"out": mats["metal"], "in": mats["metal"]},
                lambda s, t, sd: (M_TRIMMED[0] + s * (M_TRIMMED[2] - M_TRIMMED[0]),
                                  M_TRIMMED[1] + (1 - t) * (M_TRIMMED[3] - M_TRIMMED[1])),
                lambda p, s, t: w, lambda s, t, sd: 1.0, outward=lambda p: p - c)
        rim = [c + dirv(al, b1) * (R * 1.06 + 0.002) for al in A]
        edge_strip(mbs["trim"], mats["trim"], rim, lambda p: p - c, 0.012, 0.012, lambda p: w)
    if False:
        # flange: a curved blade rising from the dome crown toward the head, front-to-back, tapering at the ends
        nu, nv = 13, 6
        A = np.linspace(-math.radians(62), math.radians(62), nu)
        G = np.zeros((nu, nv, 3))
        for i, al in enumerate(A):
            taper = (1 - (abs(al) / math.radians(62)) ** 2)
            for jj in range(nv):
                t = jj / (nv - 1)
                base = c + dirv(al, math.radians(-8)) * 0.108
                G[i, jj] = base + Z * (0.085 * taper * t) - out * (0.03 * t * taper) + X * (0.012 * math.sin(al) * t)
        K.sheet(mbs["metal"], G, 0.009, {"out": mats["metal"], "in": mats["metal"]}, uv_rect(M_PLATE),
                lambda p, s, t: w, lambda s, t, sd: 1.0, outward=lambda p: out)
        edge_strip(mbs["trim"], mats["trim"], G[:, -1], lambda p: out + Z * 0.3, 0.010, 0.012, lambda p: w)
    K.add_bone(rig, "pad_" + side, tuple(j), "chest")
    REPORT.setdefault("pauldrons", {})[side] = {"big": big, "lames": len(lames)}


# ================================================================================================ gauntlets
def gauntlets(body, mbs, mats):
    aref = K.BodyRef([body], exclude=TORSO + LEGS)
    for side, sg in (("N", -1.0), ("F", 1.0)):
        ax = np.array((0.004, sg * 0.19))
        nu, nv = 21, 8
        A = np.linspace(-math.pi, math.pi, nu)
        G = np.zeros((nu, nv, 3))
        for i, a in enumerate(A):
            for jj in range(nv):
                t = jj / (nv - 1)
                z = Z_GAUNT0 + (Z_GAUNT1 - Z_GAUNT0) * t
                d = (math.cos(a), math.sin(a), 0.0)
                r = ray(aref, (ax[0], ax[1], z), d, 0.12) or 0.04
                r += 0.007 + 0.011 * K.smooth01(0.72, 1.0, t)          # flared cuff toward the elbow
                G[i, jj] = (ax[0] + r * math.cos(a), ax[1] + r * math.sin(a), z)
        for _ in range(2):
            G[:, 1:-1] = 0.5 * G[:, 1:-1] + 0.25 * (G[:, :-2] + G[:, 2:])
        K.sheet(mbs["metal"], G[:-1], 0.007, {"out": mats["metal"], "in": mats["metal"]}, uv_rect(M_TRIMMED),
                lambda p, s, t: aref.weights(p), lambda s, t, sd: 1.0,
                outward=lambda p, ax=ax: np.array((p[0] - ax[0], p[1] - ax[1], 0.0)), closed_u=True)
    REPORT["gauntlets"] = True


# ================================================================================================ waist + coat
def waist(body, mbs, mats, tc):
    ref = K.BodyRef([body], exclude=ARMS)
    sash, belt_pts = [], []
    for k in range(40):
        az = 2 * math.pi * k / 40
        for z, lst in ((1.085, sash), (1.055, belt_pts)):
            cx = tc(z)
            r = ray(ref, (cx, 0, z), (math.cos(az), -math.sin(az), 0)) or 0.13
            lst.append((cx + r * math.cos(az), -r * math.sin(az), z))
    K.strap(mbs["trim"], ref, sash, 0.075, 0.006, 0.006, {"out": mats["trim"], "in": mats["trim"]}, T_SASH,
            closed=True, ol=1.0, uv_len=0.6)
    K.strap(mbs["metal"], ref, belt_pts, 0.036, 0.007, 0.013, {"out": mats["leather"], "in": mats["leather"]},
            L_BELT, closed=True, ol=1.0)
    # round buckle (metal disc with a crimson ring)
    z = 1.055
    r = ray(ref, (tc(z), 0, z), (1, 0, 0)) + 0.024
    c = np.array((tc(z) + r, 0.0, z))
    circ = [c + 0.028 * np.array((0, math.cos(a), math.sin(a))) for a in np.linspace(0, 2 * math.pi, 20, endpoint=False)]
    K.sweep(mbs["metal"], np.array(circ), lambda t: 0.008, {"out": mats["metal"]},
            lambda t, a: (M_PLATE[0] + a, 0.25), lambda p, t: ref.weights(p), sides=6, closed=True,
            up=lambda i, p: np.array((1.0, 0, 0)), olfn=lambda t: 0.6)
    disc = np.zeros((5, 5, 3))
    for i in range(5):
        for jj in range(5):
            u, v = (i / 4 - 0.5) * 0.044, (jj / 4 - 0.5) * 0.044
            disc[i, jj] = c + np.array((-0.002 - 40 * (u * u + v * v) * 0.0, u, v))
    K.sheet(mbs["trim"], disc, 0.006, {"out": mats["trim"], "in": mats["trim"]}, uv_rect(T_SASH),
            lambda p, s, t: ref.weights(p), lambda s, t, sd: 0.6, outward=lambda p: np.array((1.0, 0, 0)))


COAT_PANELS = [
    # label, game azimuth (deg), half width (deg), length (m), hinge t, flare (deg), hem slant
    ("frontN", 24.0, 20.0, 0.80, 0.45, 8.0, 0.10),
    ("frontF", -24.0, 20.0, 0.80, 0.45, 8.0, -0.10),
    ("sideN", 78.0, 28.0, 0.86, 0.45, 10.0, 0.0),
    ("sideF", -78.0, 28.0, 0.86, 0.45, 10.0, 0.0),
    ("backN", 142.0, 30.0, 0.90, 0.45, 9.0, -0.08),
    ("backF", -142.0, 30.0, 0.90, 0.45, 9.0, 0.08),
]


def coat(body, rig, mbs, mats, tc):
    ref = K.BodyRef([body], exclude=ARMS)
    rep = {}
    for li, (label, azd, hwd, length, hinge, flare, slant) in enumerate(COAT_PANELS):
        az0, hw, fl = math.radians(azd), math.radians(hwd), math.radians(flare)
        ztop = 1.10
        layer = 0.004 * (li % 2)

        def point(s, t, az0=az0, hw=hw, fl=fl, length=length, slant=slant, layer=layer):
            a = az0 + s * hw * (1 + 0.25 * t)
            L = length * (1 + slant * s)
            r_top = (ray(ref, (tc(ztop), 0, ztop - 0.01), (math.cos(a), -math.sin(a), 0)) or 0.13) + 0.016 + layer
            z = ztop - t * L * math.cos(fl)
            r = r_top + t * L * math.sin(fl)
            if z > 0.92:
                rb = ray(ref, (tc(z), 0, z), (math.cos(a), -math.sin(a), 0))
                if rb is not None:
                    r = max(r, rb + 0.018 + layer)
            r += 0.007 * math.cos(math.pi * 2 * (s + 1)) * float(K.smooth01(0.15, 0.9, t))
            cx = tc(max(z, 0.95))
            return np.array((cx + r * math.cos(a), -r * math.sin(a), z))
        S = np.linspace(-1, 1, 9)
        T = np.linspace(0, 1, 16)
        G = np.array([[point(s, t) for t in T] for s in S])
        n0, n1 = "skirt_%s_0" % label, "skirt_%s_1" % label

        def wfn(p, s, t, hinge=hinge, n0=n0, n1=n1):
            wh = 1 - float(K.smooth01(0.0, 0.1, t))
            w1 = float(K.smooth01(hinge - 0.1, hinge + 0.1, t))
            return K.blend_w(({"hips": 1.0}, wh), ({n0: 1.0}, (1 - wh) * (1 - w1)), ({n1: 1.0}, (1 - wh) * w1))

        def uvp(s, t, side):
            r = P_COAT_OUT if side == "out" else T_LINING
            return (r[0] + s * (r[2] - r[0]), r[3] - t * (r[3] - r[1]))
        cx0 = tc(1.0)
        K.sheet(mbs["coat"], G, 0.007, {"out": mats["primary"], "in": mats["trim"], "rim": mats["trim"]}, uvp,
                lambda p, s, t, wfn=wfn: wfn(p, s, t), lambda s, t, sd: 1.0,
                outward=lambda p, cx0=cx0: np.array((p[0] - cx0, p[1], 0.0)))
        # crimson edge strips down both sides and along the hem
        for col in (0, len(S) - 1):
            P = G[col]
            edge_strip(mbs["trim"], mats["trim"], P, lambda p, cx0=cx0: np.array((p[0] - cx0, p[1], 0.0)), 0.014,
                       0.010, lambda p, wfn=wfn, P=P: wfn(p, 0.0, float(np.argmin(np.linalg.norm(P - p, axis=1))) / (len(P) - 1)))
        Ph = G[:, -1]
        edge_strip(mbs["trim"], mats["trim"], Ph, lambda p, cx0=cx0: np.array((p[0] - cx0, p[1], 0.0)), 0.018, 0.010,
                   lambda p, wfn=wfn: wfn(p, 0.0, 1.0))
        K.add_bone(rig, n0, tuple(point(0.0, 0.0)), "hips")
        K.add_bone(rig, n1, tuple(point(0.0, hinge)), n0)
        rep[label] = {"az": azd, "hem_z": round(float(point(0.0, 1.0)[2]), 3)}
    REPORT["coat"] = rep


# ================================================================================================ cape
def cape(body, rig, mbs, mats, tc):
    """Tattered cape hanging from the upper back / shoulders (cape_0..3, parent chest), torn sawtooth hem."""
    ref = K.BodyRef([body], exclude=ARMS)
    nu, nv = 19, 18
    top_z, length = 1.575, 1.12
    seg = length / 4
    G = np.zeros((nu, nv, 3))
    S = np.linspace(-1, 1, nu)
    for i, s in enumerate(S):
        # deterministic torn hem: a few long tears + a sawtooth
        tear = 0.24 * max(0.0, math.cos(s * 10.5 + 0.6)) ** 4 + 0.11 * abs(((s * 6.5 + 0.25) % 1.0) - 0.5) * 2
        L = length * (1.0 - 0.08 * s * s) - tear
        for j in range(nv):
            t = j / (nv - 1)
            d = t * L
            z = top_z - d
            w = 0.165 + 0.17 * math.sqrt(t)                        # half width
            wrap = 0.035 * (1 - K.smooth01(0.0, 0.3, t))            # edges wrap forward at the shoulders
            bow = 0.155 + 0.10 * t ** 1.3                            # distance behind the spine axis
            x = tc(max(z, 0.95)) - bow + wrap * s * s - 0.02 * (1 - s * s) * t
            G[i, j] = (x, s * w, z)
    # keep it outside the back at the top rows
    for i in range(nu):
        for j in range(4):
            sd, r = ref.signed(G[i, j])
            if sd < 0.03:
                G[i, j] = G[i, j] + r["fn"] * (0.03 - sd)
    bones = ["cape_0", "cape_1", "cape_2", "cape_3"]

    def wfn(p, s, t):
        d = t * length
        sv = d / seg
        wc = 1 - float(K.smooth01(0.0, 0.45, sv))
        x = max(0.0, sv - 0.5)
        i0 = min(3, int(x))
        f = min(1.0, x - i0)
        i1 = min(3, i0 + 1)
        return K.blend_w(({"chest": 1.0}, wc), ({bones[i0]: 1.0}, (1 - wc) * (1 - f)), ({bones[i1]: 1.0}, (1 - wc) * f))

    def uvc(s, t, side):
        r = P_CAPE_OUT if side == "out" else S_INNER
        return (r[0] + s * (r[2] - r[0]), r[3] - t * (r[3] - r[1]))
    # the inner side is the bodysuit charcoal (secondary)
    K.sheet(mbs["coat"], G, 0.006, {"out": mats["primary"], "in": mats["secondary"], "rim": mats["primary"]}, uvc,
            wfn, lambda s, t, sd: 1.0, outward=lambda p: np.array((-1.0, 0.0, 0.0)))
    for k, b in enumerate(bones):
        head = G[nu // 2, int(round(k * seg / length * (nv - 1)))] if k else G[nu // 2, 0]
        K.add_bone(rig, b, tuple(head), "chest" if k == 0 else bones[k - 1])
    REPORT["cape"] = {"top_z": top_z, "length": length, "hem_min_z": round(float(G[:, -1, 2].min()), 3)}


# ================================================================================================ boots
def boots(body, mbs, mats):
    ref = K.BodyRef([body], exclude=ARMS)
    mb = mbs["metal"]
    lea = {"out": mats["leather"], "in": mats["leather"]}
    nth, zs = 28, np.linspace(0.105, Z_BOOT, 14)
    for sg in (-1.0, 1.0):
        ax = np.array((0.006, sg * 0.100))
        R = np.zeros((len(zs), nth))
        for j, z in enumerate(zs):
            for k in range(nth):
                th = 2 * math.pi * k / nth
                r = ray(ref, (ax[0], ax[1], z), (math.cos(th), math.sin(th), 0.0), 0.12)
                R[j, k] = r if r is not None else np.nan
        for j in range(len(zs)):
            row = R[j]
            R[j] = (R[j - 1] if j else 0.05) if np.isnan(row).all() else np.where(np.isnan(row), np.nanmean(row), row)
        for _ in range(3):
            R = 0.5 * R + 0.25 * (np.roll(R, 1, axis=1) + np.roll(R, -1, axis=1))
            R[1:-1] = 0.5 * R[1:-1] + 0.25 * (R[:-2] + R[2:])
        R = R + 0.010 + 0.004 * (1 - K.smooth01(0.12, 0.25, zs))[:, None] + 0.008 * K.smooth01(0.4, 0.5, zs)[:, None]
        G = np.zeros((nth, len(zs), 3))
        for j, z in enumerate(zs):
            for k in range(nth):
                th = 2 * math.pi * k / nth
                G[k, j] = (ax[0] + R[j, k] * math.cos(th), ax[1] + R[j, k] * math.sin(th), z)

        def uv_shin(s, t, side):
            z = zs[0] + t * (zs[-1] - zs[0])
            return (L_BOOT[0] + ((0.5 + s * sg) % 1.0) * (L_BOOT[2] - L_BOOT[0]),
                    L_BOOT[1] + (z / Z_BOOT) * (L_BOOT[3] - L_BOOT[1]))
        K.sheet(mb, G, 0.004, lea, uv_shin, lambda p, s, t: ref.weights(p), lambda s, t, sd: 1.0,
                outward=lambda p, ax=ax: np.array((p[0] - ax[0], p[1] - ax[1], 0.0)), closed_u=True)
        X = np.array([-0.072, -0.066, -0.052, -0.03, 0.0, 0.04, 0.08, 0.115, 0.145, 0.168, 0.182, 0.19])
        HW = np.array([0.014, 0.027, 0.035, 0.039, 0.042, 0.046, 0.048, 0.047, 0.043, 0.036, 0.026, 0.012])
        TOP = np.array([0.050, 0.092, 0.115, 0.13, 0.14, 0.12, 0.094, 0.077, 0.064, 0.052, 0.042, 0.030])
        nph = 18
        F = np.zeros((nph, len(X), 3))
        for i, x in enumerate(X):
            for k in range(nph):
                ph = 2 * math.pi * k / nph
                c_, s_ = math.cos(ph), math.sin(ph)
                y = ax[1] + HW[i] * c_ * (1.0 if s_ >= 0 else 1.05)
                zc = TOP[i] * 0.5
                z = zc + (TOP[i] * 0.5) * s_
                if s_ < 0:
                    z = max(0.006, z)
                    z = 0.006 + (z - 0.006) * 0.35 if z < 0.025 else z
                F[k, i] = (x + 0.012, y, z)
        K.sheet(mb, F, 0.004, lea, lambda s, t, sd: (L_BOOT[0] + s * (L_BOOT[2] - L_BOOT[0]),
                                                    L_BOOT[1] + (0.09 + 0.19 * t) * (L_BOOT[3] - L_BOOT[1])),
                lambda p, s, t: ref.weights(p), lambda s, t, sd: 1.0,
                outward=lambda p, ax=ax: np.array((0.0, p[1] - ax[1], p[2] - 0.05)), closed_u=True)
        Sg = np.zeros((2, len(X), 3))
        for i, x in enumerate(X):
            for a_, sgn in enumerate((-1.0, 1.0)):
                Sg[a_, i] = (x + 0.012, ax[1] + sgn * (HW[i] * 1.05 + 0.004), 0.007)
        K.sheet(mb, Sg, 0.015, lea, lambda s, t, sd: (L_SOLE[0] + t * (L_SOLE[2] - L_SOLE[0]),
                                                      L_SOLE[1] + s * (L_SOLE[3] - L_SOLE[1])),
                lambda p, s, t: ref.weights(p + np.array((0, 0, 0.03))), lambda s, t, sd: 1.0,
                N=np.tile(np.array((0, 0, 1.0)), (2, len(X), 1)))
        # metal greave on the shin front (shin weights) and a knee cop above it (knee: shin + thigh)
        nu, nv = 9, 7
        A = np.linspace(-math.radians(75), math.radians(75), nu)
        Gg = np.zeros((nu, nv, 3))
        for i, a in enumerate(A):
            for j in range(nv):
                z = 0.17 + (Z_BOOT - 0.03 - 0.17) * j / (nv - 1)
                jj = int(np.argmin(np.abs(zs - z)))
                kk = int(round((a % (2 * math.pi)) / (2 * math.pi) * nth)) % nth
                r = R[jj, kk] + 0.012
                Gg[i, j] = (ax[0] + r * math.cos(a), ax[1] + r * math.sin(a), z)
        K.sheet(mbs["metal"], Gg, 0.007, {"out": mats["metal"], "in": mats["metal"]}, uv_rect(M_TRIMMED),
                lambda p, s, t: ref.weights(p), lambda s, t, sd: 1.0,
                outward=lambda p, ax=ax: np.array((p[0] - ax[0], p[1] - ax[1], 0.0)))
        knee = np.array(C.joint_blender("shin" + ("N" if sg < 0 else "F")))
        kc = knee + np.array((0.0, 0.0, 0.0))
        Gk = np.zeros((7, 6, 3))
        for i in range(7):
            for j in range(6):
                al = (i / 6 - 0.5) * math.radians(120)
                be = (j / 5 - 0.5) * math.radians(110)
                r = (ray(ref, kc + np.array((-0.01, 0, 0)), (math.cos(al) * math.cos(be), math.sin(al) * math.cos(be),
                                                             math.sin(be)), 0.15) or 0.055) + 0.014
                Gk[i, j] = kc + np.array((-0.01, 0, 0)) + r * np.array((math.cos(al) * math.cos(be),
                                                                         math.sin(al) * math.cos(be), math.sin(be)))
        K.sheet(mbs["metal"], Gk, 0.007, {"out": mats["metal"], "in": mats["metal"]}, uv_rect(M_PLATE),
                lambda p, s, t: ref.weights(p), lambda s, t, sd: 1.0, outward=lambda p, kc=kc: p - kc)
    me = body.data
    dom = dominant(body)
    covered = [i for i, p in enumerate(me.polygons) if dom[p.vertices[0]] in LEGS and
               all(me.vertices[v].co.z < Z_BOOT - 0.025 for v in p.vertices)]
    K.delete_faces(body, covered)
    REPORT["boots"] = {"body_faces_removed": len(covered)}


# ================================================================================================ head
class _W:
    def __init__(self, w):
        self.w = w

    def weights(self, p):
        return self.w


def head_weights(z):
    hz = 1.70
    if z >= hz:
        return {"head": 1.0}
    if z >= 1.63:
        f = (hz - z) / (hz - 1.63)
        return K.blend_w(({"head": 1.0}, 1 - f), ({"neck": 1.0}, f))
    f = float(K.smooth01(1.63, 1.55, z))
    return K.blend_w(({"neck": 1.0}, 1 - f), ({"chest": 1.0}, f))


def head_frame(face):
    co = K.vert_co(face.data)
    eyes = [v for p in face.data.polygons if p.material_index == 1 for v in p.vertices]
    ez = float(co[eyes, 2].mean()) if eyes else 1.80
    return {"eye_z": ez, "chin_z": float(co[:, 2].min()), "top_z": float(co[:, 2].max()),
            "front_x": float(co[:, 0].max()), "centre": np.array((-0.008, 0.0, ez + 0.01))}


def mask(face, mbs, mats, hf):
    """Faceted black half-mask over the whole face (forehead under the hood brim to below the chin): an envelope of
    every face vertex (lashes, nose, lips) plus clearance, so nothing pokes through in any expression; a central
    ridge and flat shading give sculpted planes; a chevron visor slit at the eyes is MAT-visor."""
    co = K.vert_co(face.data)
    hc = hf["centre"]
    ax = np.array((hc[0] - 0.03, 0.0))
    ez = hf["eye_z"]
    zb, zt = hf["chin_z"] - 0.016, ez + 0.068
    rel = co[:, :2] - ax
    vaz = np.arctan2(-rel[:, 1], rel[:, 0])
    vr = np.hypot(rel[:, 0], rel[:, 1])
    rows = sorted(set(np.round(np.concatenate([np.linspace(zb, ez - 0.036, 6), [ez - 0.020, ez - 0.006, ez + 0.010],
                                              np.linspace(ez + 0.026, zt, 4)]), 4)))
    A = np.linspace(-math.radians(84), math.radians(84), 21)
    nu, nv = len(A), len(rows)
    R = np.full((nu, nv), np.nan)
    for i, a in enumerate(A):
        for j, z in enumerate(rows):
            m = (np.abs(vaz - a) < math.radians(10)) & (np.abs(co[:, 2] - z) < 0.016)
            if m.any():
                R[i, j] = vr[m].max()
    for j in range(nv):
        col = R[:, j]
        ok = ~np.isnan(col)
        R[:, j] = np.interp(np.arange(nu), np.nonzero(ok)[0], col[ok]) if ok.any() else 0.1
    raw = R.copy()
    for _ in range(2):
        R[1:-1] = 0.5 * R[1:-1] + 0.25 * (R[:-2] + R[2:])
        R[:, 1:-1] = 0.5 * R[:, 1:-1] + 0.25 * (R[:, :-2] + R[:, 2:])
        R = np.maximum(R, raw)
    G = np.zeros((nu, nv, 3))
    theta = math.radians(60)                                  # cheek planes: wedge half-angle from straight back

    def plane_r(r0, a):
        """Radius at azimuth a of the line through (r0, 0) receding at theta (one per side): flat cheek planes that
        angle back from the centre ridge; the face envelope pushes them out wherever the face is wider."""
        sg = 1.0 if a >= 0 else -1.0
        dvec = np.array((-math.cos(theta), -sg * math.sin(theta)))
        ray_ = np.array((math.cos(a), -math.sin(a)))
        M = np.array([[ray_[0], -dvec[0]], [ray_[1], -dvec[1]]])
        try:
            r, _s = np.linalg.solve(M, np.array((r0, 0.0)))
        except np.linalg.LinAlgError:
            return r0
        return r if r > 0 else r0
    i0 = int(np.argmin(np.abs(A)))
    for i, a in enumerate(A):
        ridge = 0.008 * max(0.0, 1 - abs(a) / math.radians(30))
        for j, z in enumerate(rows):
            base = R[i, j] + 0.010
            r = base + ridge
            if z < ez - 0.025:                                # cheeks / jaw: flat planes angling back
                r = max(min(plane_r(R[i0, j] + 0.020, a), R[i, j] + 0.020), R[i, j] + 0.005)
            if abs(z - (ez + 0.010)) < 1e-4:                  # angular brow ridge over the visor
                r += 0.010 * (1 - 0.5 * abs(a) / A.max())
            elif abs(z - (ez + 0.026)) < 1e-4:
                r += 0.004
            # narrow V jaw: below the mouth the mask closes to a point (envelope sampled at the narrowed angle)
            k = 0.30 + 0.70 * float(K.smooth01(zb, ez - 0.05, z))
            if k < 1:
                ii = int(np.argmin(np.abs(A - a * k)))
                r = max(r, R[ii, j] + 0.006)
            G[i, j] = (ax[0] + r * math.cos(a * k), -r * math.sin(a * k), z)
    # chevron slit: the slit rows dip toward the centre
    for i, a in enumerate(A):
        dip = 0.011 * max(0.0, 1 - abs(a) / math.radians(70))
        for j, z in enumerate(rows):
            if abs(z - (ez - 0.020)) < 1e-4 or abs(z - (ez - 0.006)) < 1e-4:
                G[i, j, 2] -= dip
    mb = K.MB()
    j0 = [j for j, z in enumerate(rows) if abs(z - (ez - 0.020)) < 1e-4][0]
    mt, mv = mats["metal"], mats["visor"]
    K.sheet(mb, G, 0.006, {"out": mt, "in": mt}, uv_rect(M_MASK), lambda p, s, t: {"head": 1.0},
            lambda s, t, sd: 1.0, outward=lambda p: np.array((p[0] - ax[0], p[1], 0.0)))
    n_out = (nu - 1) * (nv - 1)
    for i in range(nu - 1):
        if abs(A[i] + A[i + 1]) * 0.5 < math.radians(64):
            mb.FM[i * (nv - 1) + j0] = mv
    for k in range(n_out):
        mb.smooth[k] = False
    mbs["mask"] = mb
    REPORT["mask"] = {"rows": nv, "visor_row_z": round(rows[j0], 3), "top_z": round(zt, 3)}
    return zt


def hood(face, hair, body, mbs, mats, hf, mask_top):
    """Deep hood and cowl in one sheet: rows from the lower edge up to the crown, columns round the head. In front the
    lower edge is the brim, pulled forward and down into a peak over the brow; at the sides and back the sheet
    continues as a cowl settling on the neck and shoulders over the cape top. Close and round over the skull, with
    two clean vertical folds on each side of the cowl."""
    fref = K.BodyRef([face], names=["head"])
    bref = K.BodyRef([body], exclude=ARMS)
    hc = hf["centre"] + np.array((-0.012, 0.0, 0.0))
    nu, nv = 49, 16
    A = np.linspace(-math.pi, math.pi, nu)
    e_brim = math.asin(max(-1.0, min(1.0, (mask_top - 0.004 - hc[2]) / 0.13)))
    drop = hc[2] - 1.555
    folds = [math.radians(x) for x in (100.0, 138.0, -100.0, -138.0)]

    def e_min(a):
        f = float(K.smooth01(math.radians(78), math.radians(56), abs(a)))   # 1 in front, 0 at the sides / back
        return math.radians(-90) * (1 - f) + e_brim * f
    G = np.zeros((nu, nv, 3))
    for i, a in enumerate(A):
        e0 = e_min(a)
        back = max(0.0, -math.cos(a))
        front = max(0.0, math.cos(a))
        h = np.array((math.cos(a), -math.sin(a), 0.0))
        r_jaw = (ray(fref, hc, h, 0.3) or 0.10) + 0.022 + 0.010 * back
        r_sh = 0.125 + 0.095 * abs(math.sin(a)) ** 1.5 + 0.02 * back
        fold = sum(math.exp(-((math.atan2(math.sin(a - f), math.cos(a - f))) / 0.11) ** 2) for f in folds)
        for j in range(nv):
            e = e0 + (math.radians(89) - e0) * j / (nv - 1)
            if e >= 0:
                d = np.array((math.cos(a) * math.cos(e), -math.sin(a) * math.cos(e), math.sin(e)))
                r = ray(fref, hc, d, 0.3) or 0.11
                loose = 0.016 + 0.010 * math.cos(e) * (0.4 + 0.6 * back) + 0.012 * fold * math.cos(e) ** 3
                p = hc + d * (r + loose)
            else:
                k = -math.sin(e)
                z = hc[2] - k * drop
                o = np.array((hc[0], 0.0, z))
                r = r_jaw + (r_sh - r_jaw) * k ** 1.25 - 0.03 * back * math.sin(math.pi * min(1.0, k * 1.6))
                r += 0.022 * fold * (0.3 + 0.7 * k)
                rb = ray(bref, o, h, 0.4)
                if rb is not None:
                    r = max(r, rb + 0.022)
                p = o + h * r
            if j <= 2:                                                            # brim peak over the brow
                w = (1.0, 0.65, 0.3)[j]
                p = p + np.array((0.034 * front ** 3 * w, 0.0, -0.014 * front ** 5 * w))
            G[i, j] = p
    for _ in range(2):
        G[:, 1:-1] = 0.5 * G[:, 1:-1] + 0.25 * (G[:, :-2] + G[:, 2:])
        G[1:-1] = 0.5 * G[1:-1] + 0.25 * (G[:-2] + G[2:])

    def uvh(s, t, side):
        r = P_HOOD if side == "out" else S_INNER
        return (r[0] + s * (r[2] - r[0]), r[1] + t * (r[3] - r[1]))
    K.sheet(mbs["coat"], G[:-1], 0.006, {"out": mats["primary"], "in": mats["secondary"], "rim": mats["primary"]}, uvh,
            lambda p, s, t: head_weights(p[2]), lambda s, t, sd: 1.0,
            outward=lambda p: np.array((p[0] - hc[0], p[1], max(0.0, p[2] - hc[2]))), closed_u=True)
    edge = np.vstack([G[:-1, 0], G[:1, 0]])
    edge_strip(mbs["trim"], mats["trim"], edge, lambda p: np.array((p[0] - hc[0], p[1], max(0.0, p[2] - hc[2]))),
               0.013, 0.010, lambda p: head_weights(p[2]))
    REPORT["hood"] = {"brim_deg": round(math.degrees(e_brim), 1), "cowl_z": round(float(G[:, 0, 2].min()), 3)}


def lock(hair, hf, mask_top):
    """The one authored VRoid lock: moved to the near side so it escapes the hood over the mask (yaw about the
    head axis), recoloured by the finish step's hair ramp."""
    me = hair.data
    co = K.vert_co(me)
    hc = np.array((-0.008, 0.0, hf["eye_z"]))
    Rz = np.array(Matrix.Rotation(math.radians(-34), 3, "Z"))
    new = (co - hc) @ Rz.T + hc
    new[:, 2] += (mask_top + 0.03) - new[:, 2].max()       # the lock hangs from under the brim
    radial = new[:, :2] - hc[:2]
    radial /= np.maximum(np.linalg.norm(radial, axis=1, keepdims=True), 1e-6)
    new[:, :2] += radial * 0.020
    me.vertices.foreach_set("co", new.astype(np.float32).ravel())
    me.update()
    # keep only what hangs below the hood brim (it escapes from under it)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > mask_top + 0.004], context="VERTS")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    if me.attributes.get("custom_normal") is not None:
        me.attributes.remove(me.attributes["custom_normal"])
    me.update()
    for g in list(hair.vertex_groups):
        hair.vertex_groups.remove(g)
    g = hair.vertex_groups.new(name="head")
    g.add(list(range(len(me.vertices))), 1.0, "REPLACE")


# ================================================================================================ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", default=CID)
    ap.parse_args(U.args_after_dashes())
    cfg = vroid_chars.get(CID)
    cdir = U.char_dir(CID)
    bpy.ops.wm.open_mainfile(filepath=os.path.join(cdir, "%s_anime_master.blend" % CID))
    rig = bpy.data.objects["ARM-%s" % CID]
    body = bpy.data.objects["GEO-%s_body" % CID]
    face = bpy.data.objects["GEO-%s_face" % CID]
    hair = bpy.data.objects["GEO-%s_hair" % CID]
    tex_dir = os.path.join(cdir, "textures", "costume")
    mats = make_materials(cfg, tex_dir)
    mbs = {k: K.MB() for k in ("coat", "metal", "trim")}
    hf = head_frame(face)
    tc = torso_centre(body)
    bodysuit(body, mats, tc)
    cuirass(body, mbs, mats, tc)
    pauldron(body, rig, mbs, mats, "N", True)
    pauldron(body, rig, mbs, mats, "F", False)
    gauntlets(body, mbs, mats)
    waist(body, mbs, mats, tc)
    coat(body, rig, mbs, mats, tc)
    cape(body, rig, mbs, mats, tc)
    boots(body, mbs, mats)
    mtop = mask(face, mbs, mats, hf)
    hood(face, hair, body, mbs, mats, hf, mtop)
    lock(hair, hf, mtop)
    # the face is hidden under the mask: drop the face mesh (MAT-face, MAT-eyes, expr_*) - masked fighters ship
    # without it (the v5 check keys on the toon extras)
    fme = face.data
    bpy.data.objects.remove(face, do_unlink=True)
    if fme.users == 0:
        bpy.data.meshes.remove(fme)
    built = []
    order = {"coat": [mats["primary"], mats["trim"], mats["secondary"]], "metal": [mats["metal"]],
             "trim": [mats["trim"]], "mask": [mats["metal"], mats["visor"]]}
    for k, mb in mbs.items():
        if mb.F:
            built.append(mb.build("GEO-%s_%s" % (CID, k), order[k], rig=rig))
    for ob in built + [body, hair]:
        K.limit_weights(ob)
    m = bpy.data.materials.get("MAT-hair")
    if m is not None and m.get("toon"):
        t = dict(m["toon"])
        t["rimColor"] = None
        m["toon"] = t
    REPORT["bones"] = [b.name for b in rig.data.bones]
    REPORT["tris"] = {o.name: K.tris(o) for o in U.col("LOW").objects if o.type == "MESH"}
    REPORT["tris_total"] = sum(REPORT["tris"].values())
    REPORT["materials"] = sorted({m.name for o in U.col("LOW").objects if o.type == "MESH" for m in o.data.materials})
    U.write_json(os.path.join(cdir, "review", "a2_costume", "costume_report.json"), REPORT)
    U.log("COSTUME", json.dumps(REPORT))
    U.save(os.path.join(cdir, "%s_master.blend" % CID))


if __name__ == "__main__":
    main()
