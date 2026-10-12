"""ANIME A2 COSTUME (Kael): the authored VRoid outfit of the base (kept by vroid_finish "keep_clothes") recoloured
and mildly reshaped, plus a few clean bold pieces where no sample garment exists.

  python tools/blender/run.py tools/blender/kael_costume.py -- --char kael

Reads  art/characters/<id>/<id>_anime_master.blend   (vroid_finish with keep_clothes)
Writes art/characters/<id>/<id>_anime_a2.blend        (export: vroid_export.py --master <that>)

Pieces:
- tunic (MAT-kael_primary): the VRoid hoodie. Drawstrings and stray bits removed; the lower body stretched to
  mid-thigh with a little flare (a tunic skirt on skirt_* bones); sleeves without the ribbed cuffs, flared wide
  toward the wrist; the hood (down) lifted off the back so it lies over the cloak. Its authored texture is
  recoloured brown; the crossover V with the cream undertunic, the collar bands and the tabards are painted on
  through each texel's 3D position, the skirt is painted flat (one gradient + hem band), the hood in the cloak brown.
- trousers (MAT-kael_trim): the VRoid slacks, recoloured, cut inside the boots.
- boots (MAT-kael_leather): the VRoid shoes recoloured + a shaft from the slacks' lower legs (offset out, cut
  straight at the top) + a turned cuff band.
- obi (MAT-kael_secondary), leather belt with buckle, pouches and a hilt clip (MAT-kael_leather), tabard tails
  front and back (MAT-kael_trim), and a hooded half-cloak (MAT-kael_primary) on cape_0..3: clean simple shapes,
  flat painted colour plus one shade gradient.
- body: the skin hidden under the clothes is removed (no poke-through).
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
import sd_contract as C  # noqa: E402
import sd_rig as R  # noqa: E402
import sd_util as U  # noqa: E402
import toon_garment as G  # noqa: E402
import vroid_chars  # noqa: E402
import vroid_face as F  # noqa: E402
import vroid_finish as VF  # noqa: E402

PHASE = "a2_costume"
REPORT = {}
TORSO = ("hips", "spine", "chest", "neck")
ARMS = ("upperN", "upperF", "foreN", "foreF", "handN", "handF")

# palette (sRGB hex), Obi-Wan's: big shapes separated by value and hue - a light oatmeal tunic, mid-tan tabards
# and obi, off-white undertunic collar, light tan trousers, dark leather, the dark brown cloak framing the light
# figure, and Kael's UI blue as a thin accent on the cloak edge
TUNIC, TUNIC_DK = 0xD9C9A6, 0xA8936E          # lit / toon shade
TUNIC_LINE = 0x8C7656                         # seams, lapel edge
LAPEL = 0xCDBB96
TABARD, TABARD_DK = 0xA88458, 0x7D5F3C
COLLAR = TABARD_DK
CREAM, CREAM_LT, CREAM_DK = 0xF0EBDD, 0xF7F3EA, 0xC9C0AC   # off-white undertunic (and the forearm wraps)
CLOAK, CLOAK_DK, LINING = 0x5A3D26, 0x3A2617, 0x47301E
ACCENT = 0x45A6FF                             # Kael's UI colour
OBI, OBI_DK = 0xA88458, 0x7D5F3C
TROUSERS, TROUSERS_DK = 0xBFA47C, 0x8A714F
LEATHER, LEATHER_DK, LEATHER_LT = 0x3B2618, 0x1A0F08, 0x4A3220
METAL = 0xB7BEC8

# atlases (UV rects u0, v0, u1, v1)
P_HOODIE = (0.0, 0.25, 0.75, 1.0)
P_CLOAK = (0.0, 0.0, 0.75, 0.25)
P_LINING = (0.75, 0.0, 1.0, 0.5)
P_RIM = (0.75, 0.5, 1.0, 0.625)
S_OBI = (0.0, 0.5, 1.0, 1.0)
S_OBI_IN = (0.0, 0.0, 0.5, 0.5)
S_OBI_RIM = (0.5, 0.0, 1.0, 0.5)
T_SLACKS = (0.0, 0.25, 0.75, 1.0)
T_TABARD = (0.75, 0.25, 1.0, 1.0)
T_TAB_IN = (0.0, 0.0, 0.5, 0.25)
T_TAB_RIM = (0.5, 0.0, 1.0, 0.25)
L_SHOES = (0.0, 0.5, 0.5, 1.0)
L_SHAFT = (0.5, 0.5, 1.0, 1.0)
L_CUFF = (0.5, 0.3, 1.0, 0.5)
L_BELT = (0.0, 0.0, 1.0, 0.12)
L_POUCH = (0.0, 0.12, 0.25, 0.5)
L_METAL = (0.25, 0.12, 0.5, 0.3)
L_FLAP = (0.25, 0.3, 0.5, 0.5)

# skirt panels (runtime driveSkirt): anchors az (from +X toward the character's left) and labels
SKIRT = {"top": 0.075, "rx": 0.112, "ry": 0.162, "len1": 0.22, "flare": 0.16,
         "anchors": [(-30, "frontN"), (-90, "near"), (-148, "backN"), (180, "back"), (148, "backF"), (90, "far"),
                     (30, "frontF")]}
WAIST = 0.985            # tunic waist line (the skirt stretch starts below it)
HEM = 0.70               # tunic hem (mid thigh)
OBI_Z = (0.972, 1.112)
BELT_Z = (1.024, 1.064)
BOOT_TOP = 0.47
CAPE_TOP = 1.55
CLOAK_HEM = 0.60


def axis_az(p):
    return math.degrees(math.atan2(p[1], p[0]))


def skirt_weights(az, d):
    """hips at the waistband, then the two nearest skirt anchors, upper -> lower by drop d below the waist."""
    S = SKIRT
    wtop = float(G.ss(0.0, 0.10, d))
    wlow = float(G.ss(S["len1"] - 0.09, S["len1"] + 0.07, d))
    anc = sorted(S["anchors"])
    seq = [(a - 360, n) for a, n in anc] + anc + [(a + 360, n) for a, n in anc]
    i = max(k for k in range(len(seq) - 1) if seq[k][0] <= az)
    a0, n0 = seq[i]
    a1, n1 = seq[i + 1]
    f = float(G.ss(0.0, 1.0, (az - a0) / (a1 - a0)))
    w = {"hips": 1.0 - wtop}
    for n, m in ((n0, 1.0 - f), (n1, f)):
        w["skirt_%s_0" % n] = w.get("skirt_%s_0" % n, 0.0) + wtop * (1.0 - wlow) * m
        w["skirt_%s_1" % n] = w.get("skirt_%s_1" % n, 0.0) + wtop * wlow * m
    return w


def cape_weights(z, chest_w=None):
    """chest at the collar, then hat blends down the cape_0..3 chain."""
    seg = (CAPE_TOP - CLOAK_HEM) / 4.0
    sv = (CAPE_TOP - z) / seg
    wc = 1.0 - float(G.ss(-0.4, 0.4, sv))
    x = max(0.0, sv)
    i0 = min(3, int(math.floor(x)))
    f = min(1.0, x - i0)
    i1 = min(3, i0 + 1)
    w = dict(chest_w or {"chest": 1.0})
    w = {k: v * wc for k, v in w.items()}
    w["cape_%d" % i0] = w.get("cape_%d" % i0, 0.0) + (1 - wc) * (1 - f)
    w["cape_%d" % i1] = w.get("cape_%d" % i1, 0.0) + (1 - wc) * f
    return w


# ------------------------------------------------------------------------------------------------ extra bones
def add_bones(rig, cloak_back_x):
    made = []
    for az, label in SKIRT["anchors"]:
        a = math.radians(az)
        h0 = Vector((SKIRT["rx"] * math.cos(a), SKIRT["ry"] * math.sin(a), 1.02 + SKIRT["top"]))
        low = Vector((SKIRT["flare"] * SKIRT["len1"] * math.cos(a), SKIRT["flare"] * SKIRT["len1"] * math.sin(a),
                      -SKIRT["len1"]))
        R.add_extra_bone(rig, "skirt_%s_0" % label, h0, "hips")
        R.add_extra_bone(rig, "skirt_%s_1" % label, h0 + low, "skirt_%s_0" % label)
        made += ["skirt_%s_0" % label, "skirt_%s_1" % label]
    seg = (CAPE_TOP - CLOAK_HEM) / 4.0
    parent = "chest"
    for k in range(4):
        z = CAPE_TOP - k * seg
        R.add_extra_bone(rig, "cape_%d" % k, (cloak_back_x(z), 0.0, z), parent)
        parent = "cape_%d" % k
        made.append("cape_%d" % k)
    return made


# ------------------------------------------------------------------------------------------------ tunic (hoodie)
def build_tunic(tops):
    me = tops.data
    W = G.weights(tops)
    hood = G.attr(tops, "sd_sec_hood")
    string = G.attr(tops, "sd_sec_hoodstring")
    # 1. drawstrings and stray small bits
    isl = G.face_islands(me)
    kill = [f for comp in isl if len(comp) < 60 for f in comp]
    kill += [p.index for p in me.polygons if max(string[i] for i in p.vertices) > 0.3]
    REPORT["tunic_removed_faces"] = len(set(kill))
    G.delete_faces(tops, kill)
    me = tops.data
    W = G.weights(tops)
    hood = G.attr(tops, "sd_sec_hood")
    P = G.coords(tops)
    arm = G.group_share(W, ARMS)
    # the hood is its own island (the one with the most hood weight): a whole-island mask, kept as an attribute
    isl = G.face_islands(me)
    hood_isl = max(isl, key=lambda comp: np.mean([hood[i] for f in comp for i in me.polygons[f].vertices]))
    is_hood = np.zeros(len(me.vertices))
    for f in hood_isl:
        is_hood[list(me.polygons[f].vertices)] = 1.0
    a = me.attributes.get("sd_is_hood") or me.attributes.new("sd_is_hood", "FLOAT", "POINT")
    a.data.foreach_set("value", is_hood.tolist())
    # 2. sleeves: no ribbed cuff; the upper arm tapered close to the arm, flared only from the elbow to the cuff
    cuff_cut = 1.095
    sleeve_v = arm > 0.5
    kill = [p.index for p in me.polygons if all(sleeve_v[i] and P[i, 2] < cuff_cut for i in p.vertices)]
    G.delete_faces(tops, kill)
    me = tops.data
    W = G.weights(tops)
    hood = G.attr(tops, "sd_sec_hood")
    P = G.coords(tops)
    arm = G.group_share(W, ARMS)
    for s in (-1, 1):
        ax = Vector(C.joint_blender("fore" + ("F" if s > 0 else "N")))
        m = (arm > 0.3) & (P[:, 1] * s > 0.08)
        d = P[:, :2] - np.array([ax.x, ax.y])
        r = np.linalg.norm(d, axis=1)
        z = P[:, 2]
        # upper arm: pulled in toward the arm (never inside a 6.4 cm radius), full at mid upper arm, eased out to
        # the shoulder seam and the elbow
        taper = 1.0 - 0.30 * G.ss(1.57, 1.47, z) * G.ss(1.26, 1.35, z) * np.minimum(arm / 0.8, 1.0)
        k_up = np.maximum(taper, 0.064 / np.maximum(r, 1e-4))
        k_up = np.minimum(k_up, 1.0)
        # forearm: flare from the elbow to the cuff only
        k_lo = 1.0 + 0.55 * G.ss(1.28, 1.10, z) * np.minimum(arm / 0.8, 1.0)
        k = np.where(z > 1.28, k_up, k_lo)
        P[m, 0] = ax.x + d[m, 0] * k[m]
        P[m, 1] = ax.y + d[m, 1] * k[m]
        P[m, 2] -= 0.010 * G.ss(1.20, 1.10, P[m, 2])                      # the open cuff sags a little
    # 3. the tunic skirt: stretch the lower body to mid-thigh (the ribbed hem band keeps its height), flare
    hem0 = float(P[arm < 0.2, 2].min())
    rib = 0.04
    z = P[:, 2].copy()
    body_v = arm < 0.2
    zr0, zr1 = hem0 + rib, HEM + rib
    k_s = (WAIST - zr1) / (WAIST - zr0)
    lowz = body_v & (z < WAIST)
    zn = z.copy()
    mid = lowz & (z >= zr0)
    zn[mid] = WAIST - (WAIST - z[mid]) * k_s
    ribm = lowz & (z < zr0)
    zn[ribm] = z[ribm] - (zr0 - zr1)
    t = np.clip((WAIST - zn) / (WAIST - HEM), 0, 1)
    flare = 1.0 + 0.16 * t ** 1.3
    P[body_v, 0] *= np.where(lowz[body_v], flare[body_v], 1.0)
    P[body_v, 1] *= np.where(lowz[body_v], flare[body_v], 1.0)
    P[:, 2] = np.where(lowz, zn, z)
    # 4. hood (down): ~40 % less bulk, lowered onto the upper back, its sides pulled back off the jaw line; lifted
    # off the tunic so it lies over the cloak
    neck = np.array(C.joint_blender("neck"))
    hp = G.attr(tops, "sd_is_hood")
    if hp.any():
        c = (P * hp[:, None]).sum(axis=0) / hp.sum()
        sc = np.array([0.78, 0.74, 0.50])
        Ph = c + (P - c) * sc + np.array([-0.026, 0.0, -0.050])
        fwd = np.clip((P[:, 0] - (neck[0] - 0.04)) / 0.08, 0, 1)          # the parts beside the neck / jaw
        Ph[:, 0] -= 0.030 * fwd
        Ph[:, 2] -= 0.020 * fwd
        out = Ph - np.array([neck[0], neck[1], Ph[:, 2].mean()])
        out[:, 2] = 0.0
        out /= np.maximum(np.linalg.norm(out, axis=1, keepdims=True), 1e-6)
        Ph = Ph + out * 0.020
        P = P * (1 - hp[:, None]) + Ph * hp[:, None]
    G.set_coords(tops, P)
    # 5. weights: the skirt part onto the skirt panels; the hood rides on the chest / neck only (no arm pull)
    W = G.weights(tops)
    for i in range(len(P)):
        if hp[i] > 0.5 or hood[i] > 0.05:
            keep = {k: v for k, v in W[i].items() if k in ("chest", "neck", "spine")}
            W[i] = keep or {"chest": 1.0}
    # sleeves: the lower sleeve rides the forearm; the cuff keeps a little upper-arm weight so on a raised arm it
    # drapes back toward the elbow (and shows the wraps)
    for i in range(len(P)):
        if arm[i] > 0.3 and P[i, 2] < 1.27:
            side = "F" if P[i, 1] > 0 else "N"
            W[i] = G.blend_w(W[i], {"fore" + side: 1.0}, float(G.ss(1.27, 1.18, P[i, 2])))
            W[i] = G.blend_w(W[i], {"fore" + side: 0.80, "upper" + side: 0.20}, float(G.ss(1.17, 1.10, P[i, 2])))
    for i in range(len(P)):
        if body_v[i] and P[i, 2] < WAIST + 0.04:
            d = WAIST + 0.075 - P[i, 2]
            tb = float(G.ss(WAIST + 0.04, WAIST - 0.06, P[i, 2]))
            W[i] = G.blend_w(W[i], skirt_weights(axis_az(P[i]), d), tb)
    G.set_weights(tops, W)
    REPORT["tunic"] = {"hem_before": round(hem0, 3), "hem": round(float(P[body_v, 2].min()), 3),
                       "stretch": round(k_s, 3), "verts": len(P)}
    return tops


def paint_tunic(tops, px):
    """Recoloured hoodie texture + the painted crossover V, undertunic, collar bands, tabards, flat skirt and the
    hood in the cloak colour (per texel through the hoodie UVs and the vertices' rest positions)."""
    out, lum = G.recolour_luma(px, TUNIC_DK, TUNIC, gamma=0.9)
    me = tops.data
    W = G.weights(tops)
    P = G.coords(tops)
    torso = G.group_share(W, TORSO + tuple(n for n in {k for w in W for k in w} if n.startswith("skirt_")))
    hood = G.attr(tops, "sd_is_hood")
    att = np.hstack([P, torso[:, None], hood[:, None]]).astype(np.float32)
    H, Wd = out.shape[:2]
    A, cov = F.raster_attr(tops, lambda p: True, att, Wd, H, pad=3)
    x, y, z, tor, hd = A[..., 0], A[..., 1], A[..., 2], A[..., 3], A[..., 4]
    fold = np.ones_like(lum)[..., None]                                # flat colour: the hoodie smudges are gone
    tun = G.hexlin(TUNIC)[None, None, :] * (1.0 - 0.07 * np.clip((1.5 - z) / 0.5, 0, 1))[..., None]
    rgb = G.lin(out[..., :3])
    m0 = cov[..., None].astype(float)
    rgb = rgb * (1 - m0) + tun * m0                                     # flat tunic + soft folds + one gradient

    def put(mask, hexc, keep_folds=True):
        c = G.hexlin(hexc)[None, None, :] * (fold if keep_folds else 1.0)
        m = np.clip(mask, 0, 1)[..., None] * cov[..., None]
        return rgb * (1 - m) + c * m
    front = (x > 0.0) & (tor > 0.5)
    # skirt below the obi: flat tunic colour, one gradient, a clean hem band
    sk = (tor > 0.5) & (z < WAIST + 0.01)
    g = np.clip((WAIST - z) / (WAIST - HEM), 0, 1)
    base = G.hexlin(TUNIC)[None, None, :] * (1.0 - 0.10 * g[..., None])
    hem = (z < HEM + 0.030).astype(float)
    hl = (np.abs(z - (HEM + 0.030)) < 0.0022).astype(float)
    base = base * (1 - hem[..., None]) + G.hexlin(LAPEL)[None, None, :] * hem[..., None]
    base = base * (1 - hl[..., None]) + G.hexlin(TUNIC_LINE)[None, None, :] * hl[..., None]
    m = (sk * cov)[..., None]
    rgb = rgb * (1 - m) + base * m
    # tabards (over both shoulders, front and back), beside the collar
    for s in (-1, 1):
        tb = (np.abs(y - s * 0.108) < 0.046) & (tor > 0.5) & (z > OBI_Z[1] - 0.01) & (hd < 0.5)
        rgb = put(tb.astype(float), TABARD)
        edge = tb & (np.abs(np.abs(y - s * 0.108) - 0.040) < 0.0035)
        rgb = put(edge.astype(float), TABARD_DK, keep_folds=False)
    # crossover V (left lapel over the right panel) with the cream undertunic and the collar bands
    zN, zW, zR = 1.63, 1.08, 1.25
    yL = 0.055 + (zN - z) / (zN - zW) * (-0.075 - 0.055)
    yR = -0.055 + (zN - z) / (zN - zR) * (0.045 + 0.055)
    vreg = front & (y > yR) & (y < yL) & (z < zN + 0.03)
    rgb = put(vreg.astype(float), CREAM)
    under_collar = vreg & ((y - yR < 0.016) | (yL - y < 0.016))
    rgb = put(under_collar.astype(float), CREAM_LT)
    rgb = put((vreg & (np.abs(y - (yR + 0.016)) < 0.0018)).astype(float), CREAM_DK, keep_folds=False)
    lapel = front & (y >= yL) & (y < yL + 0.030) & (z > OBI_Z[1] - 0.02)
    rgb = put(lapel.astype(float), LAPEL)
    rgb = put((front & (np.abs(y - yL) < 0.0022) & (z > OBI_Z[1] - 0.02)).astype(float), TUNIC_LINE,
              keep_folds=False)
    rcol = front & (y <= yR) & (y > yR - 0.030) & (y < yL) & (z > zR - 0.02)
    rgb = put(rcol.astype(float), LAPEL)
    # the hood in the cloak colour
    rgb = put((hd > 0.5).astype(float), CLOAK)
    out[..., :3] = G.enc(rgb)
    return out


# ------------------------------------------------------------------------------------------------ boots
def build_boots(bottoms, shoes):
    """Shaft = the slacks below BOOT_TOP (bisected straight), pushed out along the normals; trousers cut inside."""
    shaft = bottoms.copy()
    shaft.data = bottoms.data.copy()
    shaft.name = shaft.data.name = "GEO-kael_boot_shaft"
    U.col("COSTUME_SRC").objects.link(shaft)
    bm = bmesh.new()
    bm.from_mesh(shaft.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, BOOT_TOP), plane_no=(0, 0, 1), clear_outer=True)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * (0.0065 if v.co.z > 0.12 else 0.004)
    # cylindrical UVs into the shaft rect (u around each leg, v down from the top)
    uvl = bm.loops.layers.uv.active
    for f in bm.faces:
        for lp in f.loops:
            c = lp.vert.co
            s = 1.0 if c.y > 0 else -1.0
            a = math.atan2(c.y - s * 0.10, c.x - 0.01)
            lp[uvl].uv = (0.5 + a / (2 * math.pi), (c.z - 0.02) / (BOOT_TOP - 0.02))
    bm.to_mesh(shaft.data)
    bm.free()
    G.remap_uv(shaft, L_SHAFT)
    # trousers: drop what the boots hide
    P = G.coords(bottoms)
    kill = [p.index for p in bottoms.data.polygons if all(P[i, 2] < BOOT_TOP - 0.03 for i in p.vertices)]
    G.delete_faces(bottoms, kill)
    # shoes a touch bigger so they wrap the shaft's foot end
    me = shoes.data
    me.update()
    P = G.coords(shoes)
    Nn = np.array([tuple(v.normal) for v in me.vertices])
    G.set_coords(shoes, P + Nn * 0.003)
    REPORT["boots"] = {"shaft_tris": sum(len(p.vertices) - 2 for p in shaft.data.polygons)}
    return shaft


def boot_cuffs(mb, shaft):
    """A turned cuff band round the top of each boot shaft."""
    P = G.coords(shaft)
    for s in (-1, 1):
        sel = P[(P[:, 1] * s > 0.02) & (P[:, 2] > BOOT_TOP - 0.02)]
        if not len(sel):
            continue
        cx, cy = float(sel[:, 0].mean()), float(sel[:, 1].mean())
        rows = []
        for j, (z, add) in enumerate(((BOOT_TOP + 0.006, 0.010), (BOOT_TOP - 0.004, 0.012),
                                      (BOOT_TOP - 0.036, 0.0095), (BOOT_TOP - 0.042, 0.002))):
            band = P[np.abs(P[:, 2] - min(z, BOOT_TOP - 0.004)) < 0.02]
            band = band[band[:, 1] * s > 0.02]
            row = []
            for i in range(28):
                a = 2 * math.pi * i / 28
                d = np.array([math.cos(a), math.sin(a)])
                rel = band[:, :2] - np.array([cx, cy])
                proj = rel @ d
                ang = np.abs(np.arctan2(rel[:, 1], rel[:, 0]) - a)
                ang = np.minimum(ang, 2 * math.pi - ang)
                r = float(proj[ang < 0.35].max()) if (ang < 0.35).any() else 0.06
                row.append((cx + d[0] * (r + add), cy + d[1] * (r + add), z))
            rows.append(row)
        Gd = np.array(rows).transpose(1, 0, 2)
        w = {"shin" + ("F" if s > 0 else "N"): 1.0}
        N = G.grid_normals(Gd, lambda p, cx=cx, cy=cy: np.array([p[0] - cx, p[1] - cy, 0.0]), closed_u=True)
        mb.grid(Gd, "leather", L_CUFF, lambda i, j, p, w=w: w, ol=1.0, closed_u=True, N=N)


# ------------------------------------------------------------------------------------------------ obi, belt, kit
def ring_grid(bvh, z0, z1, rows, n_az, offset_fn, axis=(0.0, 0.0)):
    Gd = np.zeros((n_az, rows, 3))
    for i in range(n_az):
        az = -180.0 + 360.0 * i / n_az
        d = G.az_dir(az)
        for j in range(rows):
            z = z1 - (z1 - z0) * j / (rows - 1)
            r = G.radius_at(bvh, axis, z, az) or 0.15
            rr = r + offset_fn(az, j / (rows - 1))
            Gd[i, j] = (axis[0] + d.x * rr, axis[1] + d.y * rr, z)
    return Gd


def build_obi_belt(mb, bvh, tw):
    n = 64
    # obi: a wide sash, slightly bulged, its wrap overlap drawn as a diagonal fold (painted)
    obi = ring_grid(bvh, OBI_Z[0], OBI_Z[1], 6, n, lambda az, v: 0.006 + 0.004 * math.sin(math.pi * v))
    N = G.grid_normals(obi, lambda p: np.array([p[0], p[1], 0.0]), closed_u=True)

    def wfn(i, j, p):
        return tw(p)
    mb.thick(obi, N, 0.004, "secondary", S_OBI, S_OBI_IN, S_OBI_RIM, wfn, ol=0.6, closed_u=True)
    # belt over the obi
    belt = ring_grid(bvh, BELT_Z[0], BELT_Z[1], 3, n, lambda az, v: 0.016)
    N = G.grid_normals(belt, lambda p: np.array([p[0], p[1], 0.0]), closed_u=True)
    mb.thick(belt, N, 0.0035, "leather", L_BELT, L_BELT, L_BELT, wfn, ol=0.6, closed_u=True)
    # buckle, pouches, hilt clip on the belt
    def at(az, dz=0.0, out=0.0):
        d = G.az_dir(az)
        r = (G.radius_at(bvh, (0, 0), (BELT_Z[0] + BELT_Z[1]) / 2, az) or 0.15) + 0.0195 + out
        return (d.x * r, d.y * r, (BELT_Z[0] + BELT_Z[1]) / 2 + dz)
    c = at(0.0, 0.0, 0.004)
    G.add_box(mb, (0.010, 0.050, 0.042), c, 0.0, "leather", L_METAL, tw(c), ol=0.6, bevel=0.003)
    for az, size in ((-42.0, (0.034, 0.055, 0.060)), (-68.0, (0.030, 0.045, 0.052)),
                     (44.0, (0.034, 0.055, 0.060)), (118.0, (0.030, 0.045, 0.050))):
        c = at(az, -0.018, size[0] / 2)
        G.add_box(mb, size, c, az, "leather", L_POUCH, tw(c), ol=0.6, bevel=0.006)
        cf = at(az, 0.002, size[0] / 2 + 0.003)                      # flap
        G.add_box(mb, (size[0] * 0.55, size[1] * 1.04, size[2] * 0.45), cf, az, "leather", L_FLAP, tw(cf),
                  ol=0.6, bevel=0.005)
    # hilt clip on the left hip: a metal D-ring plate hanging from the belt
    c = at(78.0, -0.028, 0.004)
    G.add_box(mb, (0.008, 0.026, 0.040), c, 78.0, "leather", L_METAL, tw(c), ol=0.6, bevel=0.003)


def build_tabard_tails(mb, bvh):
    """Tabard ends hanging from under the obi, front and back, past the tunic hem."""
    for az_c in (-26.0, 26.0, 154.0, -154.0):
        cols = 7
        rows = 12
        Gd = np.zeros((cols, rows, 3))
        for i in range(cols):
            az = az_c + (i / (cols - 1) - 0.5) * 30.0
            d = G.az_dir(az)
            for j in range(rows):
                v = j / (rows - 1)
                z = OBI_Z[0] + 0.02 - (OBI_Z[0] + 0.02 - 0.60) * v
                zq = max(z, HEM + 0.01)
                r = G.radius_at(bvh, (0, 0), zq, az) or 0.18
                r += 0.007 + max(0.0, HEM + 0.01 - z) * 0.30                # continues the skirt flare past the hem
                Gd[i, j] = (d.x * r, d.y * r, z)
        N = G.grid_normals(Gd, lambda p: np.array([p[0], p[1], 0.0]))

        def wfn(i, j, p):
            return skirt_weights(axis_az(p), WAIST + 0.075 - p[2])
        mb.thick(Gd, N, 0.004, "trim", T_TABARD, T_TAB_IN, T_TAB_RIM, wfn, ol=0.6)


# ------------------------------------------------------------------------------------------------ cloak
def build_cloak(mb, bvh, tw):
    """Hooded half-cloak: over the shoulders and down the back to the knee, its hem rising to the upper arms at
    the sides (the arms stay free), a few broad clean folds; open in front."""
    az0, az1, nu, nv = 104.0, 256.0, 33, 22
    Gd = np.zeros((nu, nv, 3))
    meta = []
    neck = Vector(C.joint_blender("neck"))
    for i in range(nu):
        az = az0 + (az1 - az0) * i / (nu - 1)
        back = abs(((az - 180.0 + 180.0) % 360.0) - 180.0)       # 0 at the back centre
        d = G.az_dir(az)
        top_z = 1.585 - 0.025 * float(G.ss(40.0, 76.0, back))     # neck base, back of the shoulders
        hem_z = CLOAK_HEM + (0.86 - CLOAK_HEM) * float(G.ss(30.0, 76.0, back))
        rmax = 0.0
        col = []
        for j in range(nv):
            v = j / (nv - 1)
            z = top_z - (top_z - hem_z) * v
            r = G.radius_at(bvh, (neck.x - 0.01, 0.0), z, az) or 0.10
            rmax = max(rmax, r)                                    # hangs from the widest point above
            t = max(0.0, (top_z - z) / max(top_z - CLOAK_HEM, 1e-3))
            fold = 0.0                                             # folds are painted (clean shade shapes)
            bow = (0.010 + 0.06 * t) * (1.0 - float(G.ss(60.0, 110.0, back)))
            rr = rmax + 0.016 + bow + fold
            col.append((neck.x - 0.01 + d.x * rr, d.y * rr, z))
            meta.append(back)
        Gd[i] = col
    N = G.grid_normals(Gd, lambda p: np.array([p[0] - neck.x, p[1], 0.0]))

    def wfn(i, j, p):
        base = tw(p)
        up = {k: v for k, v in base.items() if k in ("chest", "neck", "spine")} or {"chest": 1.0}   # never the arms
        return cape_weights(p[2], up)
    mb.thick(Gd, N, 0.005, "primary", P_CLOAK, P_LINING, P_RIM, wfn, ol=1.0, rim_v=(True, True), rim_u=True)
    back_col = Gd[nu // 2]
    return lambda z: float(np.interp(z, back_col[::-1, 2], back_col[::-1, 0])) + 0.01


# ------------------------------------------------------------------------------------------------ body
def hide_covered_body(body):
    """Remove the skin the clothes cover: keep the head / neck above the collar, the hands and wrists."""
    W = G.weights(body)
    P = G.coords(body)
    hand = G.group_share(W, ("handN", "handF"))
    fore = G.group_share(W, ("foreN", "foreF"))
    keep = (P[:, 2] > 1.575) | (hand > 0.3) | ((fore > 0.3) & (P[:, 2] < 1.115))
    kill = [p.index for p in body.data.polygons if not any(keep[i] for i in p.vertices)]
    G.delete_faces(body, kill)
    REPORT["body_faces_removed"] = len(kill)


def paint_wraps(body, cid, tdir):
    """Cream forearm wraps painted on the skin texture between the wrist and the sleeve (diagonal wrap bands with
    thin darker separations); returns the number of texels painted."""
    m = body.data.materials[0]
    tex = next(n for n in m.node_tree.nodes if n.type == "TEX_IMAGE")
    px = VF.image_px(tex.image).copy()
    H, Wd = px.shape[:2]
    W = G.weights(body)
    P = G.coords(body)
    fore = G.group_share(W, ("foreN", "foreF"))
    hand = G.group_share(W, ("handN", "handF"))
    A, cov = F.raster_attr(body, lambda p: True, np.hstack([P, fore[:, None], hand[:, None]]).astype(np.float32),
                           Wd, H, pad=3)
    x, y, z, fo, ha = (A[..., i] for i in range(5))
    z0, z1 = 1.030, 1.120
    reg = cov & ((fo > 0.25) | (ha > 0.25)) & (z > z0) & (z < z1)
    s_ = np.sign(y)
    ang = np.arctan2(y - s_ * 0.19, x)                         # around the forearm axis
    phase = (z / 0.013 + ang / (2 * np.pi) * 1.6) % 1.0         # diagonal wrap bands
    line = (np.abs(phase - 0.5) > 0.44).astype(float)
    base = G.hexlin(CREAM)[None, None, :] * (1.0 - 0.12 * ((z - z0) / (z1 - z0)))[..., None]
    col = base * (1 - line[..., None]) + G.hexlin(CREAM_DK)[None, None, :] * line[..., None]
    end = ((z < z0 + 0.004) | (z > z1 - 0.004)).astype(float)[..., None]
    col = col * (1 - end) + G.hexlin(CREAM_DK)[None, None, :] * end
    rgb = G.lin(px[..., :3])
    rgb[reg] = col[reg]
    px[..., :3] = G.enc(rgb)
    im = VF.new_image("%s_skin_a2" % cid, px)
    path = os.path.join(tdir, "%s_skin_a2.png" % cid)
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    im.filepath = path
    tex.image = im
    return int(reg.sum())


def paint_cloak(u, v):
    """Cloak outer (u across the back from the left front edge, v down from the shoulders): flat dark brown, three
    large clean fold shades widening toward the hem, a dark hem band, Kael's blue piping on the hem and front edges."""
    c = G.hexlin(CLOAK)[None, None, :] * (1.0 - 0.12 * v)[..., None]
    shade = np.zeros_like(u)
    for uc, k in ((0.30, 1.0), (0.52, 0.8), (0.73, 1.0)):
        w = 0.008 + 0.055 * v ** 1.3
        shade = np.maximum(shade, ((np.abs(u - uc) < w) & (v > 0.18)).astype(float) * k)
    c = c * (1.0 - 0.22 * shade[..., None])
    band = (v > 0.935).astype(float)[..., None]
    c = c * (1 - band) + G.hexlin(CLOAK_DK)[None, None, :] * band
    pipe = ((np.abs(v - 0.928) < 0.0045) | (u < 0.010) | (u > 0.990)).astype(float)[..., None]
    return c * (1 - pipe) + G.hexlin(ACCENT)[None, None, :] * pipe


# ------------------------------------------------------------------------------------------------ materials
def material(cfg, name, img, lit, shade, double=False, outline=0.0022, toony=0.9, rim_scale=0.5, shift=-0.05):
    """Costume toon material: the character rim at half strength (a wide grazing band on cloth reads lavender);
    shift > 0 moves the terminator so big light surfaces stay lit (one clean shade shape on the far side)."""
    return VF.toon_material(name, img, VF.toon_extras(cfg, lit, shade, toony, shift, outline=outline,
                                                      rim_scale=rim_scale), alpha="OPAQUE", double=double)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", default="kael")
    a = ap.parse_args(U.args_after_dashes())
    cid = a.char
    cfg = vroid_chars.get(cid)
    cdir = U.char_dir(cid)
    bpy.ops.wm.open_mainfile(filepath=os.path.join(cdir, "%s_anime_master.blend" % cid))
    rig = bpy.data.objects["ARM-%s" % cid]
    body = bpy.data.objects["GEO-%s_body" % cid]
    clothes = bpy.data.objects["GEO-%s_clothes" % cid]
    parts = G.split_by_material(clothes, ["Tops", "Bottoms", "Shoes"])
    tops, bottoms, shoes = parts["Tops"], parts["Bottoms"], parts["Shoes"]
    tex = {k: VF.image_px(VF.img_of(VF.mtoon(o.data.materials[0]))) for k, o in parts.items()}
    build_tunic(tops)
    G.calm_normals(tops)                                  # clean cel shapes, no fold smudges
    shaft = build_boots(bottoms, shoes)
    # weights for the kit / cloak: torso vertices only (the hanging sleeves sit next to the belt: an arm weight
    # there would drag the belt up with a raised hand)
    tw = G.NearestWeights(tops, keep=lambda i, p, w: sum(w.get(k, 0) for k in TORSO) / max(sum(w.values()), 1e-9)
                          > 0.9)
    W_t = G.weights(tops)
    tor_v = G.group_share(W_t, TORSO + tuple(k for k in {g for w in W_t for g in w} if k.startswith("skirt_")))
    Pt = G.coords(tops)
    ref = G.bvh_of([tops], lambda o, p: all(tor_v[i] > 0.5 for i in p.vertices))           # torso only
    hood_v = G.attr(tops, "sd_is_hood")
    ref_cloak = G.bvh_of([tops], lambda o, p: all((tor_v[i] > 0.5 or Pt[i, 2] > 1.36) and hood_v[i] < 0.5
                                                  for i in p.vertices))
    mb = G.MeshBuilder()
    build_obi_belt(mb, ref, tw)
    build_tabard_tails(mb, ref)
    cloak_back_x = build_cloak(mb, ref_cloak, tw)
    boot_cuffs(mb, shaft)
    hide_covered_body(body)
    REPORT["bones"] = add_bones(rig, cloak_back_x)
    # ---- textures + materials
    tdir = os.path.join(cdir, "textures", "anime_src")
    REPORT["wrap_texels"] = paint_wraps(body, cid, tdir)
    prim = G.Canvas(2048, 2048)
    prim.place(P_HOODIE, paint_tunic(tops, tex["Tops"]))
    prim.paint(P_CLOAK, paint_cloak)
    prim.paint(P_LINING, G.flat(LINING, grad=0.1))
    prim.paint(P_RIM, G.flat(ACCENT))                     # the cloak's edge thickness: blue piping
    sec = G.Canvas(1024, 1024)
    sec.paint(S_OBI, G.flat(OBI, grad=0.12, edge="v0v1", edge_hex=OBI_DK, edge_w=0.06, stitch=(0.12, 0.02)))
    sec.paint(S_OBI_IN, G.flat(OBI_DK))
    sec.paint(S_OBI_RIM, G.flat(OBI_DK))
    trim = G.Canvas(1024, 1024)
    sl, _ = G.recolour_luma(tex["Bottoms"], 0xA88E66, TROUSERS, gamma=0.7)   # light tan, folds kept soft
    trim.place(T_SLACKS, sl)
    trim.paint(T_TABARD, G.flat(TABARD, grad=0.2, edge="u", edge_hex=COLLAR, edge_w=0.06, line_at=(0.96,),
                                line_hex=TROUSERS_DK))
    trim.paint(T_TAB_IN, G.flat(TROUSERS_DK))
    trim.paint(T_TAB_RIM, G.flat(COLLAR))
    lea = G.Canvas(1024, 1024)
    shp, _ = G.recolour_luma(tex["Shoes"], LEATHER_DK, LEATHER, gamma=0.9)
    lea.place(L_SHOES, shp)
    lea.paint(L_SHAFT, G.flat(LEATHER, grad=-0.15, line_at=(0.03,), line_hex=LEATHER_DK))
    lea.paint(L_CUFF, G.flat(LEATHER_LT, grad=0.3, stitch=(0.5, 0.05)))
    lea.paint(L_BELT, G.flat(LEATHER, grad=0.0, edge="v0v1", edge_hex=LEATHER_DK, edge_w=0.12,
                             stitch=(0.3, 0.012)))
    lea.paint(L_POUCH, G.flat(LEATHER_LT, grad=0.25))
    lea.paint(L_FLAP, G.flat(LEATHER, grad=0.1, edge="v1", edge_hex=LEATHER_DK, edge_w=0.12))
    lea.paint(L_METAL, G.flat(METAL, grad=0.35))
    imgs = {}
    for key, cv in (("primary", prim), ("secondary", sec), ("trim", trim), ("leather", lea)):
        im = VF.new_image("%s_%s" % (cid, key), cv.px)
        path = os.path.join(tdir, "%s_%s.png" % (cid, key))
        im.filepath_raw = path
        im.file_format = "PNG"
        im.save()
        im.filepath = path
        imgs[key] = im
    mats = {"primary": material(cfg, "MAT-%s_primary" % cid, imgs["primary"], TUNIC, TUNIC_DK, double=True),
            "secondary": material(cfg, "MAT-%s_secondary" % cid, imgs["secondary"], OBI, OBI_DK),
            "trim": material(cfg, "MAT-%s_trim" % cid, imgs["trim"], TROUSERS, TROUSERS_DK, double=True),
            "leather": material(cfg, "MAT-%s_leather" % cid, imgs["leather"], LEATHER, LEATHER_DK)}
    # ---- authored pieces: UVs into their atlas rects, one material each
    for ob, key, rect in ((tops, "primary", P_HOODIE), (bottoms, "trim", T_SLACKS), (shoes, "leather", L_SHOES)):
        G.remap_uv(ob, rect)
        ob.data.materials.clear()
        ob.data.materials.append(mats[key])
    shaft.data.materials.clear()
    shaft.data.materials.append(mats["leather"])
    built = mb.build("GEO-%s_costume_kit" % cid, collection="COSTUME_SRC")
    order = ["primary", "secondary", "trim", "leather"]
    for k in order:
        built.data.materials.append(mats[k])
    built.data.polygons.foreach_set("material_index", [order.index(k) for k in built["sd_mats"]])
    del built["sd_mats"]
    # outline values: authored garments 1 (silhouette), the kit's own per-vertex values
    for ob in (tops, bottoms, shoes, shaft):
        a = ob.data.attributes.get("sd_ol") or ob.data.attributes.new("sd_ol", "FLOAT", "POINT")
        a.data.foreach_set("value", [1.0] * len(ob.data.vertices))
    for ob in (tops, bottoms, shoes, shaft, built):
        for nm in ("sd_sec_hood", "sd_sec_hoodstring", "sd_is_hood"):
            if ob.data.attributes.get(nm):
                ob.data.attributes.remove(ob.data.attributes[nm])
    # ---- join into one costume mesh, skin it, outline mask
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    pieces = [tops, bottoms, shoes, shaft, built]
    for o in pieces:
        for i, l in enumerate(o.data.uv_layers):
            if i == 0:
                l.name = "UVMap"
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = tops
    bpy.ops.object.join()
    cos = tops
    cos.name = cos.data.name = "GEO-%s_costume" % cid
    for m in list(cos.modifiers):                       # armature rebuilt below; VRM MToon outline node groups go
        cos.modifiers.remove(m)
    for o in [o for o in bpy.data.objects if not o.users_collection and o.type == "MESH"]:
        bpy.data.objects.remove(o, do_unlink=True)        # the join's leftovers
    cos.parent = rig
    cos.matrix_parent_inverse = Matrix.Identity(4)
    mod = cos.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    U.move_to(cos, "LOW")
    olv = G.attr(cos, "sd_ol")
    VF.outline_mask(cos, lambda v, p: float(olv[v.index]))
    cos.data.attributes.remove(cos.data.attributes["sd_ol"])
    # normalise / limit weights
    G.set_weights(cos, G.weights(cos))
    for o in [o for o in bpy.data.objects if o.name == "GEO-%s_clothes" % cid or o.users_collection and
              o.users_collection[0].name == "COSTUME_SRC"]:
        bpy.data.objects.remove(o, do_unlink=True)
    low = [o for o in U.col("LOW").objects if o.type == "MESH"]
    REPORT["tris"] = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in low}
    REPORT["tris_total"] = sum(REPORT["tris"].values())
    REPORT["materials"] = sorted({m.name for o in low for m in o.data.materials if m})
    U.write_json(os.path.join(cdir, "review", PHASE, "costume_report.json"), REPORT)
    U.log("COSTUME", json.dumps(REPORT))
    U.save(os.path.join(cdir, "%s_anime_a2.blend" % cid))


if __name__ == "__main__":
    main()
