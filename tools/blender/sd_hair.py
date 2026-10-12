"""HAIR PHASE: layered strand cards (scalp hair, beard, moustache, stubble) for the Saber Duel fighters.

  python tools/blender/run.py tools/blender/sd_hair.py -- --char kael

1. Strand-clump textures, generated (numpy, seeded): each clump is a few hundred anti-aliased strands that taper
   in opacity toward the tip, with per-strand value/hue jitter, root-dark to tip-light. They fill MAT-hair's atlas
   (sd_look.ATLAS): scalp clumps in the hair region, beard clumps + a stubble tile in the beard region; brows and
   lashes keep their MPFB textures. Transparent texels carry the root colour (no pale fringes, safe for blending).
2. Cards grow on offset layers of the scalp along a combed flow field (swept back from a side part, down over the
   back and sides), following the head's surface: a dense base layer, a mid layer, a crown/temple volume layer
   and small soft hairline cards. Hairline and beard line are defined by azimuth round the skull (sd_chars).
3. Beard: short down-flowing cards on the jaw, chin and cheeks, moustache cards from the upper lip, and a stubble
   shell (beard region offset 1 mm) mapped to the stubble tile; the skin gets sd_beard (darker stubble tint) and an
   updated sd_scalp for the bake.
All cards: MAT-hair (alpha MASK), weighted 100% to the head joint. Deterministic (fixed seeds).
"""
import argparse
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sd_chars  # noqa: E402
import sd_cloth as K  # noqa: E402
import sd_contract as C  # noqa: E402
import sd_look  # noqa: E402
import sd_util as U  # noqa: E402

from bl_ext.user_default.mpfb.services.locationservice import LocationService  # noqa: E402

PHASE = "05_hair"
TAG = "phase:" + PHASE
REPORT = {}


# ------------------------------------------------------------------------------------------------ textures
def _lin(hexv):
    return np.array([c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in C.hex_to_srgb(hexv)])


def clump(w, h, rng, root_hex, tip_hex, n=170, spread=0.42, taper=0.55, wave=1.6, thick=(0.9, 1.6), length=(0.72, 1.0),
          curl=0.0, gain=1.7, start=0.12, value=(0.75, 1.25)):
    """One clump strip (h rows, root at row 0, w cols): RGBA float (linear colour, straight alpha). Strands are
    splatted as small gaussians; colour = alpha-weighted mean of the strands covering a texel, alpha = max."""
    acc = np.zeros((h, w), np.float32)
    col = np.zeros((h, w, 3), np.float32)
    wsum = np.zeros((h, w), np.float32)
    root, tip = _lin(root_hex), _lin(tip_hex)
    cx = w / 2
    for _ in range(n):
        x0 = cx + float(np.clip(rng.normal(0, spread * w * 0.5), -0.48 * w, 0.48 * w))
        y0 = h * rng.uniform(0, start)                                  # ragged root line (no hard card edge)
        L = h * rng.uniform(*length) - y0
        x1 = cx + (x0 - cx) * (1 - taper) + rng.normal(0, w * 0.05)
        amp = rng.uniform(0.2, wave) * (w / 64.0)
        fr, ph = rng.uniform(0.5, 2.2), rng.uniform(0, 6.28)
        th = rng.uniform(*thick)
        val = rng.uniform(*value)
        hue = rng.normal(0, 0.05)
        steps = int(L * 1.6)
        t = np.linspace(0, 1, steps)
        xs = x0 + (x1 - x0) * t + amp * np.sin(2 * np.pi * fr * t + ph) + curl * w * 0.25 * np.sin(6.28 * 3 * t + ph) * t
        ys = y0 + t * L
        edge = 1.0 - 0.55 * min(1.0, abs(x0 - cx) / (0.45 * w)) ** 2       # sparser, fainter at the clump edges
        op = (1.0 - np.clip((t - 0.6) / 0.4, 0, 1)) ** 1.4 * rng.uniform(0.8, 1.0) * edge
        op = op * np.clip(t / 0.12, 0.0, 1.0) ** 0.7                       # soft root: no hard card edge
        tc = (ys / h)[:, None] ** 1.4                                      # colour by card height: no per-card bands
        c = (root[None, :] * (1 - tc) + tip[None, :] * tc) * val
        c[:, 0] *= (1 + hue)
        r = max(1, int(math.ceil(th * 1.5)))
        for dx in range(-r, r + 1):
            for dy in (-1, 0, 1):
                xi = np.round(xs).astype(int) + dx
                yi = np.round(ys).astype(int) + dy
                ok = (xi >= 0) & (xi < w) & (yi >= 0) & (yi < h)
                d = np.hypot(xs[ok] - xi[ok], ys[ok] - yi[ok])
                a = op[ok] * np.exp(-(d / th) ** 2 * 1.4)
                np.maximum.at(acc, (yi[ok], xi[ok]), a)
                np.add.at(col, (yi[ok], xi[ok]), c[ok] * a[:, None])
                np.add.at(wsum, (yi[ok], xi[ok]), a)
    out = np.zeros((h, w, 4), np.float32)
    has = wsum > 1e-5
    out[..., :3] = np.where(has[..., None], col / np.maximum(wsum, 1e-5)[..., None], root[None, None, :] * 0.85)
    out[..., 3] = np.clip(acc * gain, 0, 1)
    return out


def stubble_tile(w, h, rng, hexv):
    out = np.zeros((h, w, 4), np.float32)
    c = _lin(hexv)
    out[..., :3] = c * 0.85
    n = int(w * h / 18)
    xs = rng.integers(0, w, n)
    ys = rng.integers(0, h, n)
    ang = rng.uniform(-0.5, 0.5, n) + math.pi / 2
    for k in range(3):
        xi = np.clip((xs + np.cos(ang) * k).astype(int), 0, w - 1)
        yi = np.clip((ys + np.sin(ang) * k).astype(int), 0, h - 1)
        out[yi, xi, 3] = np.maximum(out[yi, xi, 3], rng.uniform(0.5, 1.0, n))
        out[yi, xi, :3] = c * rng.uniform(0.7, 1.2, n)[:, None]
    return out


def beard_patch(w, h, rng, root_hex, tip_hex, n=300, length=(0.22, 0.40), thick=(1.3, 2.2), spread_deg=15.0,
                gain=1.15):
    """Short-beard tile: n short, slightly curved strands scattered over the whole tile, combed down (+row) with
    +-spread_deg jitter, each fading toward its tip; alpha windowed off the tile borders so card outlines never
    show. Overlapping cards then read as one continuous short beard instead of separate tufts."""
    acc = np.zeros((h, w), np.float32)
    col = np.zeros((h, w, 3), np.float32)
    wsum = np.zeros((h, w), np.float32)
    root, tip = _lin(root_hex), _lin(tip_hex)
    for _ in range(n):
        x0, y0 = rng.uniform(0, w), rng.uniform(-0.1 * h, 0.9 * h)
        L = h * rng.uniform(*length)
        ang = math.radians(rng.normal(0, spread_deg))
        bend = rng.normal(0, 0.25)
        th = rng.uniform(*thick)
        val = rng.uniform(0.7, 1.25)
        steps = max(4, int(L * 1.6))
        t = np.linspace(0, 1, steps)
        a = ang + bend * t
        xs = x0 + np.cumsum(np.sin(a)) * (L / steps)
        ys = y0 + np.cumsum(np.cos(a)) * (L / steps)
        op = (1.0 - np.clip((t - 0.5) / 0.5, 0, 1)) ** 1.2 * rng.uniform(0.75, 1.0)
        c = (root[None, :] * (1 - t[:, None]) + tip[None, :] * t[:, None]) * val
        r = max(1, int(math.ceil(th * 1.5)))
        for dx in range(-r, r + 1):
            for dy in (-1, 0, 1):
                xi = np.round(xs).astype(int) + dx
                yi = np.round(ys).astype(int) + dy
                ok = (xi >= 0) & (xi < w) & (yi >= 0) & (yi < h)
                d = np.hypot(xs[ok] - xi[ok], ys[ok] - yi[ok])
                aa = op[ok] * np.exp(-(d / th) ** 2 * 1.4)
                np.maximum.at(acc, (yi[ok], xi[ok]), aa)
                np.add.at(col, (yi[ok], xi[ok]), c[ok] * aa[:, None])
                np.add.at(wsum, (yi[ok], xi[ok]), aa)
    out = np.zeros((h, w, 4), np.float32)
    has = wsum > 1e-5
    out[..., :3] = np.where(has[..., None], col / np.maximum(wsum, 1e-5)[..., None], root[None, None, :])
    # elliptical footprint with a noisy rim: a card reads as an irregular soft patch, never as a rectangle
    yy, xx = np.mgrid[0:h, 0:w]
    rr = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2))
    rim = 0.78 + 0.12 * rng.standard_normal((h // 16 + 1, w // 16 + 1)).repeat(16, 0).repeat(16, 1)[:h, :w]
    win = np.clip((1.0 - rr) / np.maximum(1.0 - rim, 0.05), 0, 1)
    out[..., 3] = np.clip(acc * gain, 0, 1) * win
    return out


def build_atlas(cfg, path, size=2048):
    """Hair atlas: 8 scalp clump strips (top 3/4), MPFB brows/lashes, 3 beard clump strips + stubble tile."""
    rng = np.random.default_rng(cfg.get("hair_seed", 1977))
    atlas = np.zeros((size, size, 4), np.float32)
    root, tip = cfg["hair_hex"], cfg["hair_tip_hex"]
    btip = cfg.get("beard_tip_hex", tip)
    hair_rows = int(size * 0.75)
    sw = size // 8
    strips = {}
    specs = [dict(n=420, spread=0.95, taper=0.12, wave=1.2, thick=(1.3, 2.2), length=(0.6, 1.0)),
             dict(n=400, spread=0.95, taper=0.18, wave=1.6, thick=(1.3, 2.2), length=(0.6, 1.0)),
             dict(n=380, spread=0.9, taper=0.22, wave=1.2, thick=(1.3, 2.1), length=(0.55, 1.0)),
             dict(n=360, spread=0.9, taper=0.25, wave=2.4, thick=(1.3, 2.2), length=(0.55, 1.0)),
             dict(n=340, spread=0.85, taper=0.3, wave=2.0, thick=(1.3, 2.1), length=(0.55, 0.95)),
             dict(n=300, spread=0.8, taper=0.45, wave=1.6, thick=(1.3, 2.1), length=(0.5, 0.95)),
             dict(n=170, spread=0.95, taper=0.1, wave=1.0, thick=(1.0, 1.7), length=(0.35, 0.8), gain=1.4),
             dict(n=120, spread=0.95, taper=0.1, wave=1.0, thick=(0.9, 1.5), length=(0.3, 0.7), gain=1.3)]
    for i, sp in enumerate(specs):
        img = clump(sw, hair_rows, rng, root, tip, **sp)
        atlas[size - hair_rows:, i * sw:(i + 1) * sw] = img[::-1]        # Blender rows go bottom-up; root at top
        strips["hair%d" % i] = (i * sw / size, 0.25, (i + 1) * sw / size, 1.0)
    # beard strips in the beard region (u 0.5..1, v 0..0.25): 3 clumps + stubble
    bw, bh = size // 8, size // 4
    for i in range(3):
        img = beard_patch(bw, bh, rng, btip, cfg.get("beard_hex", btip), n=cfg.get("beard_strands", 300))
        x0 = size // 2 + i * bw
        atlas[0:bh, x0:x0 + bw] = img[::-1]
        strips["beard%d" % i] = (x0 / size, 0.0, (x0 + bw) / size, 0.25)
    x0 = size // 2 + 3 * bw
    atlas[0:bh, x0:x0 + bw] = stubble_tile(bw, bh, rng, root)
    strips["stubble"] = (x0 / size, 0.0, (x0 + bw) / size, 0.25)
    # brows / lashes from MPFB
    data = LocationService.get_user_data()
    for key, kind, name in (("brows", "eyebrows", cfg["brows"]), ("lashes", "eyelashes", cfg["lashes"])):
        folder = os.path.join(data, kind, name)
        png = os.path.join(folder, [f for f in os.listdir(folder) if f.endswith(".png")][0])
        im = bpy.data.images.load(png, check_existing=True)
        u0, v0, u1, v1 = sd_look.ATLAS[key]
        w, h = int((u1 - u0) * size), int((v1 - v0) * size)
        c = im.copy()
        c.scale(w, h)
        px = np.empty(w * h * 4, np.float32)
        c.pixels.foreach_get(px)
        bpy.data.images.remove(c)
        px = px.reshape(h, w, 4)
        px[..., :3] = np.where(px[..., :3] <= 0.04045, px[..., :3] / 12.92, ((px[..., :3] + 0.055) / 1.055) ** 2.4)
        lum = px[..., :3].mean(axis=2)
        dark = _lin(root) * 1.15
        px[..., :3] = dark[None, None, :] * (0.7 + 0.6 * lum[..., None])
        a = px[..., 3]
        px[..., :3] = np.where(a[..., None] > 0.05, px[..., :3], dark[None, None, :])
        px[..., 3] = np.clip(a * 1.25, 0, 1)                           # thin lashes survive the alpha cut
        atlas[int(v0 * size):int(v0 * size) + h, int(u0 * size):int(u0 * size) + w] = px
    enc = atlas.copy()
    rgb = np.clip(enc[..., :3], 0, 1)
    enc[..., :3] = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    name = os.path.splitext(os.path.basename(path))[0]
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, size, size, alpha=True)
    img.pixels.foreach_set(enc.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save()
    img.filepath = path
    return img, strips


# ------------------------------------------------------------------------------------------------ head frame
def interp(knots, x):
    for (x0, y0), (x1, y1) in zip(knots, knots[1:]):
        if x0 <= x <= x1:
            t = (x - x0) / (x1 - x0)
            return y0 + (y1 - y0) * t
    return knots[-1][1] if x > knots[-1][0] else knots[0][1]


class Head:
    def __init__(self, body, cfg):
        self.body = body
        self.cfg = cfg
        self.hc = Vector(cfg["head_centre"])
        me = body.data
        self.co = [v.co.copy() for v in me.vertices]
        self.nrm = [v.normal.copy() for v in me.vertices]
        W = K.vertex_weights(body)
        self.head_v = {i for i, w in enumerate(W) if K.dominant(w) in ("head", "neck") and self.co[i].z > 1.64}
        polys = [tuple(p.vertices) for p in me.polygons if all(i in self.head_v for i in p.vertices)]
        self.bvh = BVHTree.FromPolygons([tuple(c) for c in self.co], polys)
        self.polys = polys

    def theta(self, p):
        d = p - self.hc
        return abs(math.degrees(math.atan2(d.y, d.x)))

    def is_scalp(self, p):
        return p.z > interp(self.cfg["hairline"], self.theta(p)) and not self.in_ear(p)

    def in_ear(self, p):
        d = p - self.hc
        return abs(d.y) > 0.083 and 1.765 < p.z < 1.865 and -0.04 < d.x < 0.03

    def snap(self, p, h):
        loc, n, _, _ = self.bvh.find_nearest(p)
        return (loc + n * h, n) if loc is not None else (p, Vector((0, 0, 1)))


def sample_surface(head, keep, n, rng):
    """Area-uniform points on the head faces whose centres pass keep(centre)."""
    tris = []
    for f in head.polys:
        pts = [head.co[i] for i in f]
        c = sum(pts, Vector()) / len(pts)
        if not keep(c):
            continue
        for k in range(1, len(pts) - 1):
            a, b, cc = pts[0], pts[k], pts[k + 1]
            tris.append((a, b, cc, ((b - a).cross(cc - a)).length * 0.5))
    if not tris:
        return []
    areas = np.array([t[3] for t in tris])
    cum = np.cumsum(areas) / areas.sum()
    out = []
    for _ in range(n):
        i = int(np.searchsorted(cum, rng.random()))
        a, b, cc, _ = tris[min(i, len(tris) - 1)]
        r1, r2 = rng.random(), rng.random()
        if r1 + r2 > 1:
            r1, r2 = 1 - r1, 1 - r2
        out.append(a + (b - a) * r1 + (cc - a) * r2)
    return out


def blue_noise(head, keep, n, rng, k=10):
    """n well-spread roots (Mitchell best-candidate over area-uniform candidates): even coverage without the
    clumps and gaps of plain random sampling."""
    cand = sample_surface(head, keep, n * k, rng)
    if not cand:
        return []
    cand = np.array([tuple(c) for c in cand])
    chosen = [cand[0]]
    for i in range(1, n):
        batch = cand[i * k:(i + 1) * k]
        ch = np.array(chosen)
        d = np.min(np.linalg.norm(batch[:, None, :] - ch[None, :, :], axis=2), axis=1)
        chosen.append(batch[int(np.argmax(d))])
    return [Vector(c) for c in chosen]


def flow(head, p, n, part_y):
    """Combed direction at scalp point p (normal n): swept up and back off the forehead, back over the crown and
    away from a side part, back and down over the temples and sides, down over the back."""
    d = p - head.hc
    front = U.smoothstep(-0.02, 0.06, d.x)
    top = U.smoothstep(0.0, 0.07, d.z)
    side = U.smoothstep(0.045, 0.08, abs(d.y)) * (1.0 - top)
    back = U.smoothstep(0.0, -0.06, d.x)
    away = 1.0 if p.y < part_y else -1.0
    vz = 0.9 * front * (1.0 - side) - 1.0 * side - 1.2 * back * (1.0 - top) - 0.15 * top
    g = Vector((-1.0 + 0.7 * back * (1.0 - top), 0.0, vz))
    g += Vector((0.0, -0.4 * away, 0.0)) * top * (1.0 - side) * (0.4 + 0.6 * front)   # comb away from the part
    g = g - n * g.dot(n)
    return g.normalized() if g.length > 1e-6 else Vector((0, 0, -1))


def grow_card(head, root, h, length, width, segs, rng, part_y, keep_on, flow_fn=None, droop=0.0, lift=0.0015,
              climb=0.0012):
    """Ribbon following the flow on the offset surface (scalp + h, rising `climb` per segment so a card's tip lies
    over the roots of the cards it covers). Returns (points_left, points_right) rows."""
    p, n = head.snap(root, h)
    step = length / segs
    rows = []
    jitter = Vector((rng.normal(0, 0.07), rng.normal(0, 0.07), rng.normal(0, 0.05)))
    for k in range(segs + 1):
        fdir = (flow_fn or flow)(head, p, n, part_y)
        fdir = (fdir + jitter - n * jitter.dot(n)).normalized()
        wdir = n.cross(fdir).normalized()
        w = width * (1.0 - 0.35 * k / segs)
        up = n * (lift * k / segs)
        rows.append((p - wdir * w / 2 + up, p + wdir * w / 2 + up))
        if k == segs:
            break
        nxt = p + fdir * step + Vector((0, 0, -droop * step))
        if keep_on:
            p, n = head.snap(nxt, h + climb * (k + 1))
        else:
            p = nxt
    return rows


def volume_normals(ob, centre, blend=0.75, squash=(1.0, 1.0, 0.8)):
    """Hair-card shading: per-loop custom normals pointing out of the hair volume (radial from the skull centre,
    flattened a little vertically), blended with the card normal, so the cards light as one mass of hair and the
    backs of cards never catch light from behind."""
    me = ob.data
    me.update()
    ns = [None] * len(me.loops)
    for poly in me.polygons:
        for li in poly.loop_indices:
            p = me.vertices[me.loops[li].vertex_index].co
            r = Vector(((p.x - centre.x) * squash[0], (p.y - centre.y) * squash[1], (p.z - centre.z) * squash[2]))
            r = r.normalized() if r.length > 1e-6 else Vector((0, 0, 1))
            fn = poly.normal if poly.normal.dot(r) >= 0 else -poly.normal
            ns[li] = (r * blend + fn * (1 - blend)).normalized()
    me.normals_split_custom_set(ns)
    inward = sum(1 for p in me.polygons if p.normal.dot(p.center - centre) < 0)
    REPORT.setdefault("inward_faces", {})[ob.name] = inward


def cards_object(name, cards, collection="LOW"):
    """cards: list of (rows, uv_rect)."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    for rows, (u0, v0, u1, v1) in cards:
        vs = [(bm.verts.new(a), bm.verts.new(b)) for a, b in rows]
        n = len(rows) - 1
        for k in range(n):
            # wound so the face normal is flow x width = the scalp normal (outward): the camera sees front faces,
            # so double-sided renderers (EEVEE, three.js) never flip the shading normal into the skull
            f = bm.faces.new((vs[k][0], vs[k + 1][0], vs[k + 1][1], vs[k][1]))
            uv = [(u0, v1 - (v1 - v0) * k / n), (u0, v1 - (v1 - v0) * (k + 1) / n),
                  (u1, v1 - (v1 - v0) * (k + 1) / n), (u1, v1 - (v1 - v0) * k / n)]
            for loop, c in zip(f.loops, uv):
                loop[uvl].uv = c
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    U.col(collection).objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def strip_rect(rect, rng, frac=1.0):
    """A random horizontal sub-span of a clump strip (so neighbouring cards do not repeat the same strands)."""
    u0, v0, u1, v1 = rect
    w = (u1 - u0) * frac
    s = u0 + (u1 - u0 - w) * rng.random()
    return (s, v0, s + w, v1)


# ------------------------------------------------------------------------------------------------ build
def build_scalp(head, cfg, strips, rng):
    part_y = cfg.get("part_y", 0.03)
    layers = cfg["hair_layers"]
    cards = []
    hl = cfg["hairline"]
    for L in layers:
        if L["kind"] == "hairline":
            # soft hairline: short sparse cards rooted from 4 mm below to 10 mm above the line
            keep = lambda c: (not head.in_ear(c) and  # noqa: E731
                              -0.001 < c.z - interp(hl, head.theta(c)) < 0.010)
        elif L["kind"] == "top":
            keep = lambda c: head.is_scalp(c) and (c - head.hc).z > 0.03  # noqa: E731
        else:
            keep = head.is_scalp
        roots = blue_noise(head, keep, L["n"], rng)
        for r in roots:
            length = rng.uniform(*L["length"])
            width = rng.uniform(*L["width"])
            # cards rooted near the hairline start on the skin (no floating root edge over the forehead)
            h = max(0.0008, rng.uniform(*L["h"]) * U.smoothstep(0.0, 0.035, r.z - interp(hl, head.theta(r))))
            rows = grow_card(head, r, h, length, width, L["segs"], rng, part_y, True, droop=L.get("droop", 0.0),
                             climb=L.get("climb", 0.0012))
            sname = "hair%d" % int(rng.choice(L["strips"]))
            cards.append((rows, strip_rect(strips[sname], rng, 0.85)))
    ob = cards_object("GEO-%s_hair" % cfg["id"], cards)
    volume_normals(ob, head.hc)
    return ob


def beard_region(head, cfg):
    bl = cfg["beard_line"]

    def ok(p):
        d = p - head.hc
        th = head.theta(p)
        if d.x < cfg.get("beard_min_dx", 0.0) or th > bl[-1][0] or head.in_ear(p):
            return False
        if p.z > interp(bl, th):
            return False
        if p.z < cfg.get("beard_neck_z", 1.675):
            return False
        lips = cfg["lips"]
        if abs(p.y) < lips[0] and lips[1] < p.z < lips[2] and p.x > lips[3]:
            return False
        return True
    return ok


def build_beard(head, cfg, strips, rng):
    ok = beard_region(head, cfg)
    must = cfg["moustache"]

    def beard_flow(hd, p, n, _):
        g = Vector((0.25, 0.0, -1.0))
        g = g - n * g.dot(n)
        return g.normalized()
    cards = []
    for r in blue_noise(head, lambda c: ok(c) and not (abs(c.y) < must[0] and must[1] < c.z < must[2]),
                        cfg["beard_cards"], rng):
        rows = grow_card(head, r, rng.uniform(0.0008, 0.0026), rng.uniform(0.012, 0.018), rng.uniform(0.008, 0.012), 2,
                         rng, 0.0, True, flow_fn=beard_flow, lift=0.0006, climb=0.0003)
        cards.append((rows, strip_rect(strips["beard%d" % int(rng.integers(0, 3))], rng, 0.8)))

    def must_flow(hd, p, n, _):
        g = Vector((0.15, -0.9 if p.y < 0 else 0.9, -1.0))
        g = g - n * g.dot(n)
        return g.normalized()
    for r in blue_noise(head, lambda c: ok(c) and abs(c.y) < must[0] and must[1] < c.z < must[2] and c.x > 0.15,
                        cfg["moustache_cards"], rng):
        rows = grow_card(head, r, 0.0015, rng.uniform(0.012, 0.017), rng.uniform(0.008, 0.012), 3, rng, 0.0, True,
                         flow_fn=must_flow, lift=0.0008, climb=0.0004)
        cards.append((rows, strip_rect(strips["beard%d" % int(rng.integers(0, 3))], rng, 0.8)))
    # stubble shell: the beard region of the skin, lifted 1 mm, mapped to the stubble tile (planar UV, tiled 3x)
    body = head.body
    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    keepv = {v.index for v in bm.verts if v.index in head.head_v and ok(v.co)}
    kill = [f for f in bm.faces if not all(v.index in keepv for v in f.verts)]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    dl = bm.verts.layers.deform.active
    if dl:
        bm.verts.layers.deform.remove(dl)
    for name in [a.name for a in me.attributes if a.name.startswith("sd_")]:
        pass
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * 0.001
    uvl = bm.loops.layers.uv.active or bm.loops.layers.uv.new("UVMap")
    u0, v0, u1, v1 = strips["stubble"]
    for f in bm.faces:
        for loop in f.loops:
            c = loop.vert.co
            su = ((c.y * 12.0) % 1.0)
            sv = ((c.z * 12.0) % 1.0)
            loop[uvl].uv = (u0 + (u1 - u0) * (0.05 + 0.9 * su), v0 + (v1 - v0) * (0.05 + 0.9 * sv))
    st = bpy.data.meshes.new("GEO-%s_stubble" % cfg["id"])
    bm.to_mesh(st)
    bm.free()
    for a in [a for a in st.attributes if a.name.startswith("sd_")]:
        st.attributes.remove(a)
    so = bpy.data.objects.new(st.name, st)
    U.col("LOW").objects.link(so)
    beard = cards_object("GEO-%s_beard" % cfg["id"], cards)
    volume_normals(beard, head.hc + Vector((-0.02, 0.0, -0.06)), blend=0.6)
    bpy.data.objects.remove(so, do_unlink=True)          # stubble lives in the skin texture (sd_beard), not a shell
    return beard, None, keepv


def clip_scalp(body, head, cfg):
    """sd_scalp only on the scalp: fades out over 1.2 cm below the hairline, never on the ears or the face."""
    me = body.data
    at = me.attributes["sd_scalp"]
    vals = np.zeros(len(me.vertices), np.float32)
    at.data.foreach_get("value", vals)
    hl = cfg["hairline"]
    for v in me.vertices:
        p = v.co
        if v.index not in head.head_v or head.in_ear(p):
            vals[v.index] = 0.0
            continue
        dz = p.z - interp(hl, head.theta(p))
        # hairline darkened into the skin: a 1.9 cm gradient below the line (broken into short hairs by the
        # skin shader's stipple), full hair colour above it
        grad = U.smoothstep(-0.016, 0.003, dz)
        vals[v.index] = max(vals[v.index] * U.smoothstep(-0.012, -0.002, dz), grad)
    at.data.foreach_set("value", vals)
    return int((vals > 0.5).sum())


def head_only(ob):
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    g = ob.vertex_groups.new(name="head")
    g.add([v.index for v in ob.data.vertices], 1.0, "REPLACE")


def beard_attribute(body, keepv, head):
    me = body.data
    vals = [0.0] * len(me.vertices)
    for i in keepv:
        vals[i] = 1.0
    nb = [[] for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices
        nb[a].append(b)
        nb[b].append(a)
    for _ in range(3):
        vals = [0.5 * x + 0.5 * (sum(vals[j] for j in n) / len(n) if n else x) for x, n in zip(vals, nb)]
    a = me.attributes.get("sd_beard") or me.attributes.new("sd_beard", "FLOAT", "POINT")
    a.data.foreach_set("value", vals)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", required=True)
    a = ap.parse_args(U.args_after_dashes())
    cfg = sd_chars.get(a.char)
    cdir = U.char_dir(a.char)
    master = os.path.join(cdir, "%s_master.blend" % a.char)
    bpy.ops.wm.open_mainfile(filepath=master)
    U.clear_owned(TAG)
    for old in [o for o in bpy.data.objects if o.name.startswith(("GEO-%s_hair" % a.char, "GEO-%s_beard" % a.char,
                                                                    "GEO-%s_stubble" % a.char))]:
        U.remove_object(old)                                   # MPFB hair shell, earlier cards, .001 duplicates
    body = bpy.data.objects["GEO-%s_body" % a.char]
    arm = bpy.data.objects["ARM-%s" % a.char]
    rng = np.random.default_rng(cfg.get("hair_seed", 1977))
    atlas, strips = build_atlas(cfg, os.path.join(cdir, "textures", "src", "hair_atlas.png"))
    mat = bpy.data.materials.get("MAT-hair") or sd_look.hair_material("MAT-hair", atlas)
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE":
            n.image = atlas
    head = Head(body, cfg)
    objs = [build_scalp(head, cfg, strips, rng)]
    if cfg.get("beard_cards"):
        beard, stubble, keepv = build_beard(head, cfg, strips, rng)
        objs += [beard]
        beard_attribute(body, keepv, head)
    for ob in objs:
        ob["owner"] = TAG
        ob.data.materials.append(mat)
        head_only(ob)
        ob.parent = arm
        m = ob.modifiers.new("Armature", "ARMATURE")
        m.object = arm
    # scalp attribute for the skin bake against the new cards
    import sd_body
    sd_body.scalp_attribute(body, objs[0])
    REPORT["scalp_verts"] = clip_scalp(body, head, cfg)
    skin = bpy.data.materials.get("MAT-skin")
    if skin:
        add_beard_tint(skin, cfg)
        add_hairline_stipple(skin)
    REPORT["tris"] = {o.name: K.tris(o) for o in objs}
    REPORT["tris_total"] = sum(REPORT["tris"].values())
    U.write_json(os.path.join(cdir, "review", "05_hair", "hair_report.json"), REPORT)
    U.log("HAIR", json.dumps(REPORT))
    U.save(master)


def add_hairline_stipple(skin):
    """Break the skin's scalp/hairline colour gradient (sd_scalp) into short-hair stipple: inside the gradient
    band the factor is pushed up or down by an anisotropic Voronoi dot pattern (1-2 mm, stretched along the hair
    growth), so the hairline reads as fine hairs thinning into the skin, not as paint. Idempotent."""
    nt = skin.node_tree
    for n in [n for n in nt.nodes if n.label == "sd_stipple"]:
        nt.nodes.remove(n)
    at = next((n for n in nt.nodes if n.type == "ATTRIBUTE" and n.attribute_name == "sd_scalp"), None)
    if at is None:
        return
    targets = [l.to_socket for l in at.outputs["Fac"].links]
    new = []

    def node(kind, **kw):
        n = nt.nodes.new(kind)
        n.label = "sd_stipple"
        for k, v in kw.items():
            setattr(n, k, v)
        new.append(n)
        return n

    def math(op, a, b=None, c=None):
        n = node("ShaderNodeMath", operation=op)
        for i, v in enumerate((a, b, c)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                nt.links.new(v, n.inputs[i])
        return n.outputs[0]
    tc = node("ShaderNodeTexCoord")
    mp = node("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (700.0, 700.0, 260.0)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    vo = node("ShaderNodeTexVoronoi")
    vo.inputs["Scale"].default_value = 1.0
    nt.links.new(mp.outputs["Vector"], vo.inputs["Vector"])
    f = at.outputs["Fac"]
    dots = math("SUBTRACT", 0.5, vo.outputs["Distance"])            # +0.5 at a hair, -0.5 between hairs
    ff = math("MULTIPLY", f, f)
    band = math("SUBTRACT", f, ff)                                  # f (1 - f): only inside the gradient
    pert = math("MULTIPLY", math("MULTIPLY", dots, band), 3.2)
    out = node("ShaderNodeMath", operation="ADD", use_clamp=True)
    nt.links.new(f, out.inputs[0])
    nt.links.new(pert, out.inputs[1])
    for t in targets:
        nt.links.new(out.outputs[0], t)


def add_beard_tint(skin, cfg):
    """Stubble shadow on the skin under the beard (baked into MAT-skin's base colour)."""
    nt = skin.node_tree
    bsdf = U.principled(nt)
    old = [n for n in nt.nodes if n.label.startswith("sd_beard")]
    if old:                                      # rebuild: drop the previous tint, relink the original colour
        first = next(n for n in old if n.label == "sd_beard_mix")
        src = first.inputs[6].links[0].from_socket
        for n in old:
            nt.nodes.remove(n)
        nt.links.new(src, bsdf.inputs["Base Color"])
    link = bsdf.inputs["Base Color"].links[0]
    src = link.from_socket
    n0 = set(nt.nodes)
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_type = "GEOMETRY"
    at.attribute_name = "sd_beard"
    at.location = (-150, 900)
    mx = nt.nodes.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    mx.blend_type = "MIX"
    mx.location = (80, 760)
    sc = nt.nodes.new("ShaderNodeMath")
    sc.operation = "MULTIPLY"
    sc.inputs[1].default_value = cfg.get("beard_skin_mix", 0.8)
    nt.links.new(at.outputs["Fac"], sc.inputs[0])
    nt.links.new(sc.outputs[0], mx.inputs["Factor"])
    nt.links.new(src, mx.inputs[6])
    mx.inputs[7].default_value = C.hex_to_linear(cfg.get("beard_skin_hex", cfg["hair_hex"]))
    # stubble: fine dark speckle (object space, ~0.6 mm) only inside the beard region
    tc = nt.nodes.new("ShaderNodeTexCoord")
    vo = nt.nodes.new("ShaderNodeTexVoronoi")
    vo.inputs["Scale"].default_value = 1600.0
    nt.links.new(tc.outputs["Object"], vo.inputs["Vector"])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.0
    mr.inputs["From Max"].default_value = 0.25
    mr.inputs["To Min"].default_value = 1.0
    mr.inputs["To Max"].default_value = 0.0
    nt.links.new(vo.outputs["Distance"], mr.inputs["Value"])
    sp = nt.nodes.new("ShaderNodeMath")
    sp.operation = "MULTIPLY"
    nt.links.new(mr.outputs["Result"], sp.inputs[0])
    nt.links.new(at.outputs["Fac"], sp.inputs[1])
    sp2 = nt.nodes.new("ShaderNodeMath")
    sp2.operation = "MULTIPLY"
    sp2.inputs[1].default_value = 0.8
    nt.links.new(sp.outputs[0], sp2.inputs[0])
    mx2 = nt.nodes.new("ShaderNodeMix")
    mx2.data_type = "RGBA"
    mx2.blend_type = "MIX"
    nt.links.new(sp2.outputs[0], mx2.inputs["Factor"])
    nt.links.new(mx.outputs[2], mx2.inputs[6])
    mx2.inputs[7].default_value = tuple(c * 0.6 for c in C.hex_to_linear(cfg["hair_hex"])[:3]) + (1.0,)
    nt.links.new(mx2.outputs[2], bsdf.inputs["Base Color"])
    for n in set(nt.nodes) - n0:
        n.label = "sd_beard"
    mx.label = "sd_beard_mix"


if __name__ == "__main__":
    main()
