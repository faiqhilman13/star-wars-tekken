"""ANIME A3 COSTUME (Thane, the Temple Warden): masked and robed, ivory and gold over a dark under-robe, yellow accent.

  python tools/blender/run.py tools/blender/thane_costume.py -- --char thane

Reads  art/characters/<id>/<id>_anime_master.blend   (vroid_finish with keep_clothes)
Writes art/characters/<id>/<id>_anime_a3.blend        (export: vroid_export.py --master <that>)

Authored VRoid garments (the base's own outfit, exact fit), recoloured and mildly reshaped:
- robe top: the hoodie (hood and lower body removed), flat ivory with a painted gold-edged crossover over the dark
  under-robe; wide sleeves (upper arm tapered, a strong flare from the elbow, painted pleat lines);
- trousers: the slacks, dark; boots: shoes + a shaft from the slacks (as Kael's), dark leather.
Clean bold pieces (toon_garment):
- floor-length ivory robe in four panels split front and back, gold hem band, on eight skirt panels with knee
  segments; a dark under-robe showing through the splits and at the hem;
- wide gold sash with a gold buckle; an ivory mantle with a gold edge and yellow piping on pad_N / pad_F;
- deep ivory hood with a dark interior and a gold rim; a faceted ivory-and-gold mask with a dark visor slit; a
  tall forked gold crest; a long dark cape with a gold hem and yellow piping on cape_0..3;
- dark gloves (the hands keep palmOpen; the rest of the skin, the face and the hair are removed).
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
import kael_costume as KC  # noqa: E402
import sd_contract as C  # noqa: E402
import sd_rig as R  # noqa: E402
import sd_util as U  # noqa: E402
import toon_garment as G  # noqa: E402
import vroid_chars  # noqa: E402
import vroid_face as F  # noqa: E402
import vroid_finish as VF  # noqa: E402
import vroid_hair as HR  # noqa: E402

PHASE = "a3_costume"
REPORT = {}
TORSO = ("hips", "spine", "chest", "neck")
ARMS = ("upperN", "upperF", "foreN", "foreF", "handN", "handF")

# palette (sRGB hex; LOOKS.thane primary 0xa39678, trim 0xc89a3a, metal 0xe8dcc0, glove 0x2a2420, ui #ffc83d):
# ivory and gold over a dark under-robe
IVORY, IVORY_DK = 0xE8DFCB, 0xB3A68A
IVORY_SH = 0xC9BB9C                           # toon shade of the ivory: a light shade, the ivory stays bright
PLEAT = 0xC9BEA4
GOLD, GOLD_DK, GOLD_LT = 0xC89A3A, 0x8A6420, 0xE8C66A
UNDER, UNDER_DK = 0x2E2620, 0x17120E
CAPE, CAPE_DK = 0x3A2E24, 0x1E1813
SASH, SASH_DK = 0xC89A3A, 0x7A5618
ACCENT = 0xFFC83D                             # Thane's UI colour
MASK, MASK_DK = 0xEDE4D0, 0xA89C82
VISOR = 0x14100C
LEATHER, LEATHER_DK = 0x2A2420, 0x120F0C
TROUSERS, TROUSERS_DK = 0x2E2620, 0x14100C

# atlases
P_TOP = (0.0, 0.25, 0.75, 1.0)
P_ROBE = (0.0, 0.0, 0.75, 0.25)
P_ROBE_IN = (0.75, 0.0, 1.0, 0.25)
P_MANTLE = (0.75, 0.25, 1.0, 0.5)
P_HOOD = (0.75, 0.5, 1.0, 0.75)
P_HOOD_IN = (0.75, 0.75, 1.0, 0.875)
P_RIM = (0.75, 0.875, 1.0, 1.0)
S_SLACKS = (0.0, 0.25, 0.75, 1.0)
S_CAPE = (0.0, 0.0, 0.75, 0.25)
S_UNDER = (0.75, 0.25, 1.0, 1.0)
S_CAPE_IN = (0.75, 0.0, 0.875, 0.25)
S_ACCENT = (0.875, 0.0, 1.0, 0.25)
T_SASH = (0.0, 0.5, 1.0, 1.0)
T_SASH_IN = (0.0, 0.0, 1.0, 0.5)
M_MASK = (0.0, 0.5, 0.5, 1.0)
M_GOLD = (0.5, 0.5, 1.0, 1.0)
M_MASK_IN = (0.0, 0.0, 0.5, 0.5)
L_GLOVE = (0.0, 0.12, 0.25, 0.5)

SKIRT = {"top": 0.075, "rx": 0.12, "ry": 0.17, "len1": 0.48, "flare": 0.12,
         "anchors": [(-22, "frontN"), (-64, "flankN"), (-112, "rearN"), (-158, "backN"), (158, "backF"),
                     (112, "rearF"), (64, "flankF"), (22, "frontF")]}
WAIST = 1.0
SASH_Z = (0.972, 1.135)
ROBE_HEM, UNDER_HEM = 0.075, 0.050
CAPE_TOP, CAPE_HEM = 1.53, 0.14


def skirt_weights(az, d):
    S = SKIRT
    wtop = float(G.ss(0.0, 0.10, d))
    wlow = float(G.ss(S["len1"] - 0.12, S["len1"] + 0.10, d))
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


def cape_weights(z):
    seg = (CAPE_TOP - CAPE_HEM) / 4.0
    sv = (CAPE_TOP - z) / seg
    wc = 1.0 - float(G.ss(-0.4, 0.4, sv))
    x = max(0.0, sv)
    i0 = min(3, int(math.floor(x)))
    f = min(1.0, x - i0)
    i1 = min(3, i0 + 1)
    w = {"chest": wc}
    w["cape_%d" % i0] = w.get("cape_%d" % i0, 0.0) + (1 - wc) * (1 - f)
    w["cape_%d" % i1] = w.get("cape_%d" % i1, 0.0) + (1 - wc) * f
    return w


def add_bones(rig, cape_back_x):
    made = []
    for az, label in SKIRT["anchors"]:
        a = math.radians(az)
        h0 = Vector((SKIRT["rx"] * math.cos(a), SKIRT["ry"] * math.sin(a), 1.02 + SKIRT["top"]))
        low = Vector((SKIRT["flare"] * SKIRT["len1"] * math.cos(a), SKIRT["flare"] * SKIRT["len1"] * math.sin(a),
                      -SKIRT["len1"]))
        R.add_extra_bone(rig, "skirt_%s_0" % label, h0, "hips")
        R.add_extra_bone(rig, "skirt_%s_1" % label, h0 + low, "skirt_%s_0" % label)
        made += ["skirt_%s_0" % label, "skirt_%s_1" % label]
    seg = (CAPE_TOP - CAPE_HEM) / 4.0
    parent = "chest"
    for k in range(4):
        z = CAPE_TOP - k * seg
        R.add_extra_bone(rig, "cape_%d" % k, (cape_back_x(z), 0.0, z), parent)
        parent = "cape_%d" % k
        made.append("cape_%d" % k)
    for side, s in (("N", -1.0), ("F", 1.0)):
        R.add_extra_bone(rig, "pad_" + side, (0.0, s * 0.20, 1.55), "chest")
        made.append("pad_" + side)
    return made


# ------------------------------------------------------------------------------------------------ robe top
def build_robe_top(tops):
    me = tops.data
    hood = G.attr(tops, "sd_sec_hood")
    string = G.attr(tops, "sd_sec_hoodstring")
    isl = G.face_islands(me)
    hood_isl = max(isl, key=lambda comp: np.mean([hood[i] for f in comp for i in me.polygons[f].vertices]))
    P = G.coords(tops)
    W = G.weights(tops)
    arm = G.group_share(W, ARMS)
    kill = [f for comp in isl if len(comp) < 60 for f in comp] + list(hood_isl)
    kill += [p.index for p in me.polygons if max(string[i] for i in p.vertices) > 0.3]
    kill += [p.index for p in me.polygons if all(arm[i] < 0.2 and P[i, 2] < 0.955 for i in p.vertices)]
    kill += [p.index for p in me.polygons if all(arm[i] > 0.5 and P[i, 2] < 1.070 for i in p.vertices)]
    G.delete_faces(tops, kill)
    P = G.coords(tops)
    W = G.weights(tops)
    arm = G.group_share(W, ARMS)
    for s in (-1, 1):
        ax = Vector(C.joint_blender("fore" + ("F" if s > 0 else "N")))
        m = (arm > 0.3) & (P[:, 1] * s > 0.08)
        d = P[:, :2] - np.array([ax.x, ax.y])
        r = np.linalg.norm(d, axis=1)
        z = P[:, 2]
        taper = 1.0 - 0.28 * G.ss(1.57, 1.47, z) * G.ss(1.26, 1.35, z) * np.minimum(arm / 0.8, 1.0)
        k_up = np.minimum(np.maximum(taper, 0.068 / np.maximum(r, 1e-4)), 1.0)
        k_lo = 1.0 + 0.58 * G.ss(1.28, 1.08, z) ** 1.2 * np.minimum(arm / 0.8, 1.0)
        k = np.where(z > 1.28, k_up, k_lo)
        P[m, 0] = ax.x + d[m, 0] * k[m]
        P[m, 1] = ax.y + d[m, 1] * k[m]
        P[m, 2] -= 0.018 * G.ss(1.22, 1.08, P[m, 2])                 # the wide cuff hangs
    G.set_coords(tops, P)
    for i in range(len(P)):
        if arm[i] > 0.3 and P[i, 2] < 1.27:
            side = "F" if P[i, 1] > 0 else "N"
            W[i] = G.blend_w(W[i], {"fore" + side: 1.0}, float(G.ss(1.27, 1.18, P[i, 2])))
            W[i] = G.blend_w(W[i], {"fore" + side: 0.78, "upper" + side: 0.22}, float(G.ss(1.17, 1.10, P[i, 2])))
    G.set_weights(tops, W)
    REPORT["robe_top_removed_faces"] = len(set(kill))


def paint_robe_top(tops, px):
    """Flat ivory, one gradient; a gold-edged crossover over the dark under-robe; pleat lines on the sleeves."""
    out, lum = G.recolour_luma(px, IVORY_DK, IVORY)
    W = G.weights(tops)
    P = G.coords(tops)
    torso = G.group_share(W, TORSO)
    arm = G.group_share(W, ARMS)
    H, Wd = out.shape[:2]
    A, cov = F.raster_attr(tops, lambda p: True, np.hstack([P, torso[:, None], arm[:, None]]).astype(np.float32),
                           Wd, H, pad=3)
    x, y, z, tor, ar = (A[..., i] for i in range(5))
    rgb = G.hexlin(IVORY)[None, None, :] * (1.0 - 0.07 * np.clip((1.55 - z) / 0.55, 0, 1))[..., None]

    def put(mask, hexc):
        m = (np.clip(mask, 0, 1) * cov)[..., None]
        return rgb * (1 - m) + G.hexlin(hexc)[None, None, :] * m
    front = (x > 0.0) & (tor > 0.5)
    zN, zW = 1.64, 1.10
    yL = 0.070 + (zN - z) / (zN - zW) * (0.045 - 0.070)                  # a deep open V down to the sash
    yR = -yL
    vreg = front & (y > np.maximum(yR, -0.2)) & (y < yL)
    rgb = put(vreg.astype(float), UNDER)
    for edge in (yL, yR):
        band = front & (np.abs(y - edge) < 0.016) & (z > SASH_Z[1] - 0.02) & ~vreg
        rgb = put(band.astype(float), GOLD)
        rgb = put((front & (np.abs(np.abs(y - edge) - 0.016) < 0.0018) & (z > SASH_Z[1] - 0.02)).astype(float),
                  GOLD_DK)
    # sleeve pleats: thin vertical lines below the elbow, around the arm
    sl = (ar > 0.5) & (z < 1.30)
    ang = np.arctan2(y - np.sign(y) * 0.19, x)
    pleat = sl & (np.abs(((ang / (2 * np.pi)) * 14.0) % 1.0 - 0.5) > 0.465)
    rgb = put(pleat.astype(float), PLEAT)
    cuff = (ar > 0.5) & (z < 1.0725)
    rgb = put(cuff.astype(float), GOLD)
    out[..., :3] = G.enc(rgb)
    return out


# ------------------------------------------------------------------------------------------------ robe skirt
def build_robe(mb, env):
    """Outer ivory robe: four panels split front and back; dark under-robe all round, a little longer."""
    def radius(az, z, cache={}):
        key = (round(az, 1), round(z, 3))
        if key not in cache:
            r = 0.0
            for zz in np.linspace(WAIST, z, 6):
                e = G.radius_at(env, (0, 0), zz, az)
                if e is not None:
                    r = max(r, e)
            cache[key] = r
        return cache[key]
    rows = 18
    for a0, a1 in ((26.0, 96.0), (96.0, 172.0), (-26.0, -96.0), (-96.0, -172.0)):   # wide front split
        cols = 15
        Gd = np.zeros((cols, rows, 3))
        for i in range(cols):
            az = a0 + (a1 - a0) * i / (cols - 1)
            d = G.az_dir(az)
            for j in range(rows):
                v = j / (rows - 1)
                z = WAIST + 0.06 - (WAIST + 0.06 - ROBE_HEM) * v
                drop = WAIST + 0.06 - z
                rr = radius(az, max(z, 0.2)) + 0.030 + 0.065 * drop + 0.004 * math.sin(math.radians(az) * 3)
                Gd[i, j] = (d.x * rr, d.y * rr, z)
        N = G.grid_normals(Gd, lambda p: np.array([p[0], p[1], 0.0]))
        mb.thick(Gd, N, 0.005, "primary", P_ROBE, P_ROBE_IN, P_RIM,
                 lambda i, j, p: skirt_weights(KC.axis_az(p), WAIST + 0.075 - p[2]), ol=1.0)
    n = 56
    Gd = np.zeros((n, rows, 3))
    for i in range(n):
        az = -180.0 + 360.0 * i / n
        d = G.az_dir(az)
        for j in range(rows):
            v = j / (rows - 1)
            z = WAIST + 0.04 - (WAIST + 0.04 - UNDER_HEM) * v
            drop = WAIST + 0.06 - z
            rr = radius(az, max(z, 0.2)) + 0.016 + 0.055 * drop
            Gd[i, j] = (d.x * rr, d.y * rr, z)
    N = G.grid_normals(Gd, lambda p: np.array([p[0], p[1], 0.0]), closed_u=True)
    mb.grid(Gd, "secondary", S_UNDER, lambda i, j, p: skirt_weights(KC.axis_az(p), WAIST + 0.075 - p[2]), ol=1.0,
            closed_u=True, N=N)


def build_sash(mb, bvh, tw):
    n = 64
    band = KC.ring_grid(bvh, SASH_Z[0], SASH_Z[1], 6, n, lambda az, v: 0.016 + 0.004 * math.sin(math.pi * v))
    N = G.grid_normals(band, lambda p: np.array([p[0], p[1], 0.0]), closed_u=True)
    mb.thick(band, N, 0.005, "trim", T_SASH, T_SASH_IN, T_SASH_IN, lambda i, j, p: tw(p), ol=0.6, closed_u=True)
    d = G.az_dir(0.0)
    r = (G.radius_at(bvh, (0, 0), (SASH_Z[0] + SASH_Z[1]) / 2, 0.0) or 0.16) + 0.026
    c = (d.x * r, d.y * r, (SASH_Z[0] + SASH_Z[1]) / 2)
    G.add_box(mb, (0.014, 0.075, 0.085), c, 0.0, "metal", M_GOLD, tw(c), ol=0.6, bevel=0.006)


# ------------------------------------------------------------------------------------------------ mantle, cape
def build_mantle(mb, bvh, tw):
    """Ivory capelet over the shoulders and upper arms, open at the front; gold edge, yellow piping (rims)."""
    nu, nv = 60, 9
    a0, a1 = 12.0, 348.0
    Gd = np.zeros((nu, nv, 3))
    neck = Vector(C.joint_blender("neck"))
    for i in range(nu):
        az = a0 + (a1 - a0) * i / (nu - 1)
        d = G.az_dir(az)
        back = abs(((az - 180.0 + 180.0) % 360.0) - 180.0)
        top = 1.615 - 0.05 * float(G.ss(70.0, 160.0, back))         # high at the back of the neck, collar front
        hem = 1.33 + 0.05 * float(G.ss(120.0, 170.0, back))
        rmax = 0.0
        for j in range(nv):
            v = j / (nv - 1)
            z = top - (top - hem) * v
            r = G.radius_at(bvh, (neck.x, 0.0), z, az) or 0.12
            rmax = max(rmax, r)
            rr = rmax + 0.021 + 0.022 * v
            Gd[i, j] = (neck.x + d.x * rr, d.y * rr, z)
    N = G.grid_normals(Gd, lambda p: np.array([p[0] - neck.x, p[1], 0.0]))

    def wfn(i, j, p):
        base = {k: v for k, v in tw(p).items() if k in ("chest", "neck", "spine")} or {"chest": 1.0}
        side = abs(p[1]) / 0.22
        pad = float(G.ss(0.45, 0.85, side)) * float(G.ss(1.58, 1.45, p[2]))
        w = {k: v * (1 - pad) for k, v in base.items()}
        w["pad_" + ("F" if p[1] > 0 else "N")] = pad
        return w
    mb.thick(Gd, N, 0.006, "primary", P_MANTLE, P_HOOD_IN, P_RIM, wfn, ol=1.0)


def build_cape(mb, bvh):
    az0, az1, nu, nv = 112.0, 248.0, 31, 24
    Gd = np.zeros((nu, nv, 3))
    neck = Vector(C.joint_blender("neck"))
    for i in range(nu):
        az = az0 + (az1 - az0) * i / (nu - 1)
        back = abs(((az - 180.0 + 180.0) % 360.0) - 180.0)
        d = G.az_dir(az)
        top = CAPE_TOP + 0.02 * float(G.ss(68.0, 20.0, back))
        rmax = 0.0
        for j in range(nv):
            v = j / (nv - 1)
            z = top - (top - CAPE_HEM) * v
            r = G.radius_at(bvh, (neck.x - 0.01, 0.0), max(z, 0.5), az) or 0.10
            rmax = max(rmax, r)
            t = (top - z) / (top - CAPE_HEM)
            rr = rmax + 0.030 + (0.02 + 0.10 * t) * (1.0 - float(G.ss(50.0, 68.0, back)))
            Gd[i, j] = (neck.x - 0.01 + d.x * rr, d.y * rr, z)
    N = G.grid_normals(Gd, lambda p: np.array([p[0] - neck.x, p[1], 0.0]))
    mb.thick(Gd, N, 0.005, "secondary", S_CAPE, S_CAPE_IN, S_ACCENT, lambda i, j, p: cape_weights(p[2]), ol=1.0)
    col = Gd[nu // 2]
    return lambda z: float(np.interp(z, col[::-1, 2], col[::-1, 0])) + 0.01


# ------------------------------------------------------------------------------------------------ head: hood, mask, crest
def build_hood(mb, head, L):
    """Deep hood round the head: closed over the forehead, opening round the mask, falling into a cowl on the
    mantle. Ivory outside, dark inside, a gold rim."""
    ez = L["ez"]
    c = head.c
    z_peak = ez + 0.115                     # the hood's front edge over the forehead
    z_top = head.c.z + head.r.z + 0.033
    z_cowl = 1.58
    nv, nu = 22, 44
    Gd = np.zeros((nu, nv, 3))
    for j in range(nv):
        v = j / (nv - 1)
        z = z_top - (z_top - z_cowl) * v ** 0.9
        if z > z_peak:
            e = 0.0
        elif z > ez - 0.10:
            e = 66.0 * float(G.ss(z_peak, z_peak - 0.07, z))
        else:
            e = 66.0 - 30.0 * float(G.ss(ez - 0.10, z_cowl, z))
        for i in range(nu):
            az = e + (360.0 - 2 * e) * i / (nu - 1)
            d = G.az_dir(az)
            a_ = math.radians(az)
            rxy = 1.0 / math.sqrt((math.cos(a_) / head.r.x) ** 2 + (math.sin(a_) / head.r.y) ** 2)
            off = 0.034
            hz = (z - c.z) / (head.r.z + off)
            if hz > 0:                                                   # dome: the head ellipsoid, offset
                rr = (rxy + off) * math.sqrt(max(0.0, 1.0 - hz * hz))
            else:                                                        # sides and cowl
                below = float(G.ss(ez - 0.03, z_cowl, z))
                rr = (rxy + off) * (1.0 - 0.18 * float(G.ss(ez, ez - 0.10, z))) + 0.075 * below
            hit = head.bvh.ray_cast(Vector((c.x, c.y, z)) + d * 0.4, -d, 0.4)[0]
            if hit is not None:
                rr = max(rr, (Vector((hit.x, hit.y, 0)) - Vector((c.x, c.y, 0))).length + 0.022)
            Gd[i, j] = (c.x + d.x * rr, c.y + d.y * rr, z)
    N = G.grid_normals(Gd, lambda p: np.array([p[0] - c.x, p[1] - c.y, (p[2] - c.z) * 0.6]))

    def wfn(i, j, p):
        t = float(G.ss(ez - 0.05, ez - 0.13, p[2]))
        return {"head": 1.0 - t, "neck": t * 0.6, "chest": t * 0.4}
    mb.thick(Gd, N, 0.006, "primary", P_HOOD, P_HOOD_IN, P_RIM, wfn, ol=1.0)


def build_mask(mb, face, L):
    """Faceted ivory-and-gold mask: a sharp central ridge and angled planes (flat quads), standing just off the
    face; the visor slit and the gold edges are painted."""
    ez = L["ez"]
    me = face.data
    co = np.array([tuple(v.co) for v in me.vertices])
    skin = np.array(sorted({i for p in me.polygons if p.material_index in L["skin_ids"] for i in p.vertices}))
    S = co[skin]
    rows = [0.112, 0.080, 0.046, 0.016, -0.018, -0.054, -0.090, -0.126]      # ridge top ... pointed chin
    half = [0.022, 0.070, 0.082, 0.083, 0.079, 0.064, 0.040, 0.004]
    slope = [0.42, 0.42, 0.42, 0.45, 0.62, 0.78, 0.85, 0.85]                 # cheek planes angle back below the eyes
    ridge = [0.007, 0.006, 0.004, 0.0, 0.0, 0.0, 0.0, 0.0]                   # raised centre ridge on the forehead
    cols = [-1.0, -0.68, -0.34, 0.0, 0.34, 0.68, 1.0]
    b = 2.2                                # wrap curvature
    Gd = np.zeros((len(cols), len(rows), 3))
    x_prev = None
    for j, (dz, w) in enumerate(zip(rows, half)):
        z = ez + dz
        a = slope[j]
        band = S[np.abs(S[:, 2] - z) < 0.012]
        ys = np.array([c * w for c in cols])
        need = []
        for yv in ys:
            near = band[np.abs(band[:, 1] - yv) < 0.012]
            if len(near):
                need.append(near[:, 0].max() + a * abs(yv) + b * yv * yv + 0.008)
        x0 = max(need) if need else x_prev - 0.026          # below the chin: tuck back to the point
        x_prev = x0
        for i, yv in enumerate(ys):
            Gd[i, j] = (x0 - a * abs(yv) - b * yv * yv + (ridge[j] if i == len(cols) // 2 else 0.0), yv, z)
    N = G.grid_normals(Gd, lambda p: np.array([1.0, 0.0, 0.0]))
    base = len(mb.F)
    mb.thick(Gd, N, 0.005, "metal", M_MASK, M_MASK_IN, M_MASK_IN, lambda i, j, p: {"head": 1.0}, ol=1.0)
    REPORT["mask_faces"] = len(mb.F) - base
    return base, len(mb.F)


def build_crest(mb, head, L):
    """A tall forked crest standing on the hood's front, in the side (x-z) plane: it reads in the side camera."""
    ez = L["ez"]
    zt = head.c.z + head.r.z + 0.02
    x0 = head.c.x + head.r.x * 0.55
    parts = [[(x0 - 0.05, zt - 0.01), (x0 + 0.05, zt - 0.01), (x0 + 0.04, zt + 0.045), (x0 - 0.04, zt + 0.045)],
             [(x0 + 0.000, zt + 0.035), (x0 + 0.045, zt + 0.035), (x0 + 0.125, zt + 0.185)],     # front prong
             [(x0 - 0.040, zt + 0.035), (x0 - 0.002, zt + 0.035), (x0 - 0.050, zt + 0.150)]]     # back prong
    bm = bmesh.new()
    for outline in parts:
        vs = [[bm.verts.new((xv, yv, zv)) for xv, zv in outline] for yv in (-0.010, 0.010)]
        n = len(outline)
        bm.faces.new(vs[1])
        bm.faces.new(list(reversed(vs[0])))
        for k in range(n):
            k2 = (k + 1) % n
            bm.faces.new([vs[0][k], vs[0][k2], vs[1][k2], vs[1][k]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.normal_update()
    base = len(mb.P)
    for v in bm.verts:
        mb.P.append(tuple(v.co))
        mb.W.append({"head": 1.0})
        mb.OL.append(1.0)
    bm.verts.index_update()
    u0, v0, u1, v1 = M_GOLD
    for f in bm.faces:
        mb.F.append([base + v.index for v in f.verts])
        mb.UV.append([(u0 + (u1 - u0) * (0.5 + (v.co.x - x0) / 0.3), v0 + (v1 - v0) * (0.5 + (v.co.z - zt) / 0.4))
                      for v in f.verts])
        mb.MAT.append("metal")
    bm.free()


# ------------------------------------------------------------------------------------------------ painters
def paint_robe(u, v):
    c = G.hexlin(IVORY)[None, None, :] * (1.0 - 0.10 * v)[..., None]
    hem = (v > 0.93).astype(float)[..., None]
    c = c * (1 - hem) + G.hexlin(GOLD)[None, None, :] * hem
    line = ((np.abs(v - 0.925) < 0.0035) | (u < 0.02) | (u > 0.98)).astype(float)[..., None]
    c = c * (1 - line) + G.hexlin(GOLD_DK)[None, None, :] * line
    for uc in (0.33, 0.66):                                     # two clean fold shades, painted
        w = 0.01 + 0.05 * v
        m = ((np.abs(u - uc) < w) & (v > 0.2) & (v < 0.93)).astype(float)[..., None]
        c = c * (1 - 0.12 * m)
    return c


def paint_mantle(u, v):
    c = G.hexlin(IVORY)[None, None, :] * (1.0 - 0.08 * v)[..., None]
    band = (v > 0.78).astype(float)[..., None]
    c = c * (1 - band) + G.hexlin(GOLD)[None, None, :] * band
    line = (np.abs(v - 0.775) < 0.012).astype(float)[..., None]
    return c * (1 - line) + G.hexlin(GOLD_DK)[None, None, :] * line


def paint_hood(u, v):
    c = G.hexlin(IVORY)[None, None, :] * (1.0 - 0.10 * v)[..., None]
    rim = ((u < 0.035) | (u > 0.965)).astype(float)[..., None]
    return c * (1 - rim) + G.hexlin(GOLD)[None, None, :] * rim


def paint_cape(u, v):
    c = G.hexlin(CAPE)[None, None, :] * (1.0 - 0.15 * v)[..., None]
    for uc in (0.32, 0.68):
        w = 0.01 + 0.05 * v ** 1.2
        m = ((np.abs(u - uc) < w) & (v > 0.15)).astype(float)[..., None]
        c = c * (1 - 0.25 * m)
    band = (v > 0.94).astype(float)[..., None]
    c = c * (1 - band) + G.hexlin(GOLD)[None, None, :] * band
    pipe = ((np.abs(v - 0.935) < 0.004) | (u < 0.010) | (u > 0.990)).astype(float)[..., None]
    return c * (1 - pipe) + G.hexlin(ACCENT)[None, None, :] * pipe


def paint_mask(u, v):
    """Mask UV: u across (0 = right edge, 1 = left edge), v down from the ridge top (rows 0..7 -> 0..1; the eye
    line is at v ~0.50). A narrow visor slit tapering to points and rising at the ends; gold on the forehead
    ridge, the border and the cheek-plate lines running down to the chin."""
    c = G.hexlin(MASK)[None, None, :] * (1.0 - 0.08 * v)[..., None]
    du = np.abs(u - 0.5)
    vc = 0.496 - 0.10 * du                                   # slit centre line, rising toward the outer ends
    h = 0.034 * np.clip(1.0 - (du / 0.44) ** 2, 0, 1) ** 0.7
    slit = ((np.abs(v - vc) < h) & (du < 0.44)).astype(float)[..., None]
    c = c * (1 - slit) + G.hexlin(VISOR)[None, None, :] * slit
    gold = ((du < 0.010) & (v < vc - h - 0.02)) | (du > 0.475) | (v < 0.02) | (v > 0.985)
    for (u0, v0), (u1, v1) in (((0.36, 0.60), (0.08, 0.96)),):  # cheek plate lines (mirrored)
        dx, dy = u1 - u0, v1 - v0
        t = np.clip(((du - u0) * dx + (v - v0) * dy) / (dx * dx + dy * dy), 0, 1)
        gold |= np.hypot(du - (u0 + t * dx), v - (v0 + t * dy)) < 0.008
    g = gold.astype(float)[..., None]
    return c * (1 - g) + G.hexlin(GOLD)[None, None, :] * g


# ------------------------------------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", default="thane")
    a = ap.parse_args(U.args_after_dashes())
    cid = a.char
    cfg = vroid_chars.get(cid)
    cdir = U.char_dir(cid)
    bpy.ops.wm.open_mainfile(filepath=os.path.join(cdir, "%s_anime_master.blend" % cid))
    rig = bpy.data.objects["ARM-%s" % cid]
    body = bpy.data.objects["GEO-%s_body" % cid]
    face = bpy.data.objects["GEO-%s_face" % cid]
    hairs = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("GEO-%s_hair" % cid)]
    clothes = bpy.data.objects["GEO-%s_clothes" % cid]
    # landmarks / head model before anything is removed (vertex coords of the face are rest coords)
    for o in hairs + [face]:
        o.data.update()
    face_skin_ids = {i for i, m in enumerate(face.data.materials) if m and m.name == "MAT-face"}
    L = {"ez": None}
    eye = [face.data.vertices[i].co for p in face.data.polygons if p.material_index == 1 for i in p.vertices]
    L["ez"] = sum(c.z for c in eye) / len(eye)
    L["skin_ids"] = face_skin_ids
    head = HR.HeadModel(face, body, L, {})
    parts = G.split_by_material(clothes, ["Tops", "Bottoms", "Shoes"])
    tops, bottoms, shoes = parts["Tops"], parts["Bottoms"], parts["Shoes"]
    tex = {k: VF.image_px(VF.img_of(VF.mtoon(o.data.materials[0]))) for k, o in parts.items()}
    build_robe_top(tops)
    G.calm_normals(tops)                                  # clean cel shapes, no fold smudges
    shaft = KC.build_boots(bottoms, shoes)
    W_t = G.weights(tops)
    tor_v = G.group_share(W_t, TORSO)
    Pt = G.coords(tops)
    tw = G.NearestWeights(tops, keep=lambda i, p, w: sum(w.get(k, 0) for k in TORSO) / max(sum(w.values()), 1e-9)
                          > 0.9)
    ref = G.bvh_of([tops], lambda o, p: all(tor_v[i] > 0.5 for i in p.vertices))
    ref_sh = G.bvh_of([tops], lambda o, p: all(tor_v[i] > 0.5 or Pt[i, 2] > 1.30 for i in p.vertices))
    env = G.bvh_of([tops, bottoms, shaft], lambda o, p: o is not tops or all(tor_v[i] > 0.5 for i in p.vertices))
    mb = G.MeshBuilder()
    build_robe(mb, env)
    build_sash(mb, ref, tw)
    build_mantle(mb, ref_sh, tw)
    cape_back_x = build_cape(mb, ref_sh)
    build_hood(mb, head, L)
    mask0, mask1 = build_mask(mb, face, L)
    build_crest(mb, head, L)
    KC.boot_cuffs(mb, shaft)
    # body: only the hands and wrists stay (dark gloves)
    W = G.weights(body)
    P = G.coords(body)
    hand = G.group_share(W, ("handN", "handF"))
    fore = G.group_share(W, ("foreN", "foreF"))
    keep = (hand > 0.3) | ((fore > 0.3) & (P[:, 2] < 1.10))
    G.delete_faces(body, [p.index for p in body.data.polygons if not any(keep[i] for i in p.vertices)])
    for o in [face] + hairs:
        bpy.data.objects.remove(o, do_unlink=True)
    REPORT["bones"] = add_bones(rig, cape_back_x)
    # ---- textures
    tdir = os.path.join(cdir, "textures", "anime_src")
    os.makedirs(tdir, exist_ok=True)
    prim = G.Canvas(2048, 2048)
    prim.place(P_TOP, paint_robe_top(tops, tex["Tops"]))
    prim.paint(P_ROBE, paint_robe)
    prim.paint(P_ROBE_IN, G.flat(IVORY_DK))
    prim.paint(P_MANTLE, paint_mantle)
    prim.paint(P_HOOD, paint_hood)
    prim.paint(P_HOOD_IN, G.flat(UNDER_DK))
    prim.paint(P_RIM, G.flat(ACCENT))
    sec = G.Canvas(1024, 1024)
    sl, _ = G.recolour_luma(tex["Bottoms"], TROUSERS_DK, TROUSERS, gamma=0.9)
    sec.place(S_SLACKS, sl)
    sec.paint(S_CAPE, paint_cape)
    sec.paint(S_UNDER, G.flat(UNDER, grad=0.25))
    sec.paint(S_CAPE_IN, G.flat(UNDER_DK))
    sec.paint(S_ACCENT, G.flat(ACCENT))
    trim = G.Canvas(512, 512)
    trim.paint(T_SASH, G.flat(SASH, grad=0.1, edge="v0v1", edge_hex=SASH_DK, edge_w=0.08, stitch=(0.16, 0.03)))
    trim.paint(T_SASH_IN, G.flat(SASH_DK))
    met = G.Canvas(1024, 1024)
    met.paint(M_MASK, paint_mask)
    met.paint(M_GOLD, G.flat(GOLD, grad=0.25, edge="u", edge_hex=GOLD_DK, edge_w=0.04))
    met.paint(M_MASK_IN, G.flat(MASK_DK))
    lea = G.Canvas(1024, 1024)
    shp, _ = G.recolour_luma(tex["Shoes"], LEATHER_DK, LEATHER, gamma=0.9)
    lea.place(KC.L_SHOES, shp)
    lea.paint(KC.L_SHAFT, G.flat(LEATHER, grad=-0.1, line_at=(0.03,), line_hex=LEATHER_DK))
    lea.paint(KC.L_CUFF, G.flat(GOLD_DK, grad=0.2))
    lea.paint(L_GLOVE, G.flat(LEATHER, grad=0.0))
    imgs = {}
    for key, cv in (("primary", prim), ("secondary", sec), ("trim", trim), ("metal", met), ("leather", lea)):
        im = VF.new_image("%s_%s" % (cid, key), cv.px)
        path = os.path.join(tdir, "%s_%s.png" % (cid, key))
        im.filepath_raw = path
        im.file_format = "PNG"
        im.save()
        im.filepath = path
        imgs[key] = im
    mats = {"primary": KC.material(cfg, "MAT-%s_primary" % cid, imgs["primary"], IVORY, IVORY_SH, double=True,
                                   shift=0.12),
            "secondary": KC.material(cfg, "MAT-%s_secondary" % cid, imgs["secondary"], CAPE, CAPE_DK, double=True),
            "trim": KC.material(cfg, "MAT-%s_trim" % cid, imgs["trim"], SASH, SASH_DK),
            "metal": VF.toon_material("MAT-%s_metal" % cid, imgs["metal"],
                                      VF.toon_extras(cfg, MASK, MASK_DK, 0.9, -0.05, outline=0.0022, matcap="metal",
                                                     rim_scale=0.5), alpha="OPAQUE"),
            "leather": KC.material(cfg, "MAT-%s_leather" % cid, imgs["leather"], LEATHER, LEATHER_DK)}
    # ---- authored pieces: UVs into their rects
    for ob, key, rect in ((tops, "primary", P_TOP), (bottoms, "secondary", S_SLACKS), (shoes, "leather", KC.L_SHOES)):
        G.remap_uv(ob, rect)
        ob.data.materials.clear()
        ob.data.materials.append(mats[key])
    shaft.data.materials.clear()
    shaft.data.materials.append(mats["leather"])
    # gloves: the remaining hands into the flat glove rect, leather
    uvl = body.data.uv_layers.active.data
    gx, gy = (L_GLOVE[0] + L_GLOVE[2]) / 2, (L_GLOVE[1] + L_GLOVE[3]) / 2
    for li in range(len(uvl)):
        uvl[li].uv = (gx, gy)
    body.data.materials.clear()
    body.data.materials.append(mats["leather"])
    built = mb.build("GEO-%s_costume_kit" % cid, collection="COSTUME_SRC")
    order = ["primary", "secondary", "trim", "metal", "leather"]
    for k in order:
        built.data.materials.append(mats[k])
    built.data.polygons.foreach_set("material_index", [order.index(k) for k in built["sd_mats"]])
    for p in built.data.polygons[mask0:mask1]:
        p.use_smooth = False                                          # the mask's sharp planes
    for p in built.data.polygons:
        if built.data.materials[p.material_index].name == "MAT-%s_metal" % cid and p.index >= mask1:
            p.use_smooth = False                                      # crest / buckle facets
    del built["sd_mats"]
    for ob in (tops, bottoms, shoes, shaft):
        a_ = ob.data.attributes.get("sd_ol") or ob.data.attributes.new("sd_ol", "FLOAT", "POINT")
        a_.data.foreach_set("value", [1.0] * len(ob.data.vertices))
    for ob in (tops, bottoms, shoes, shaft, built):
        for nm in ("sd_sec_hood", "sd_sec_hoodstring", "sd_is_hood"):
            if ob.data.attributes.get(nm):
                ob.data.attributes.remove(ob.data.attributes[nm])
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
    G.set_weights(cos, G.weights(cos))
    VF.outline_mask(body, lambda v, p: 1.0)
    for o in [o for o in bpy.data.objects if o.users_collection and o.users_collection[0].name == "COSTUME_SRC"]:
        bpy.data.objects.remove(o, do_unlink=True)
    for m in [m for m in bpy.data.materials if m.users == 0]:
        bpy.data.materials.remove(m)
    low = [o for o in U.col("LOW").objects if o.type == "MESH"]
    REPORT["tris"] = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in low}
    REPORT["tris_total"] = sum(REPORT["tris"].values())
    REPORT["materials"] = sorted({m.name for o in low for m in o.data.materials if m})
    U.write_json(os.path.join(cdir, "review", PHASE, "costume_report.json"), REPORT)
    U.log("COSTUME", json.dumps(REPORT))
    U.save(os.path.join(cdir, "%s_anime_a3.blend" % cid))


if __name__ == "__main__":
    main()
