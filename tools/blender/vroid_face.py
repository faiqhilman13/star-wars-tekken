"""Face styling for the anime (VRoid) fighters, driven by the optional "face_style" / "beard" / "blush" blocks of a
vroid_chars config. vroid_finish.py calls these on the VRoid face (material names still the VRoid ones) after the
expressions are built; characters without the blocks are untouched.

face_style (all optional; metres / ratios / degrees):
  eye_height    0.78   vertical scale of each eye opening (lids, white, lines) about its centre
  iris_height   = eye_height   vertical scale of iris + highlight (> eye_height: the lids cut the iris)
  iris_scale    1.0    uniform iris + highlight scale
  highlight     0.6    iris highlight scale (geometry, about its centre)
  brow_drop     0.003  brows moved down; brow_tilt_deg: inner ends lowered (stern)
  chin_drop     0.008  lower face lengthened (nose -> chin stretch, fades into the neck), chin_fwd forward
  chin_widen    0.0    chin squared (lateral scale around the chin)
  jaw_widen     0.005  jaw corners pushed out
  cheekbone     0.0025 cheekbone plane pushed out
  lash_cut      0.35   eyelash / eyeline alpha cut (thinner lines); lash_hex their (lighter) colour
  brow_dilate   3      brow stroke thickened (texels); brow_hex their colour (flat painted)
The warps are smooth spatial fields (flat-topped falloffs) applied to the face and body meshes (basis and every
shape key), so the face / neck seams stay closed and the expressions follow the new shape.

beard: {"tone": 0.72, "under_tone": 0.38, "notches": [...], ...}: a painted anime short beard and moustache on the
face texture (flat hair colour, crisp edges, pointed notches along the cheek line, a skin gap at the mouth corners,
a darker band under the jaw). Texture only, so it follows every expression.

blush: {"hex": 0xD9786A, "cheek": 0.35, "ear": 0.35, "knuckle": 0.45, "knee": 0.4}: the painted skin is flattened
to the character's skin hue (its value shading kept), then blush is painted only at the listed places.
"""
import math

import bmesh
import numpy as np
from mathutils import Vector
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


def mat_ids(ob, *keys):
    return {i for i, m in enumerate(ob.data.materials) if m and any(k in m.name for k in keys)}


# ------------------------------------------------------------------------------------------------ landmarks
def landmarks(face):
    """Eye / iris / brow centres per side, nose tip, mouth line, chin, from the VRoid face material names."""
    me = face.data

    def by_side(ids):
        acc = {-1: [], 1: []}
        for p in me.polygons:
            if p.material_index in ids:
                for i in p.vertices:
                    c = me.vertices[i].co
                    acc[1 if c.y > 0 else -1].append(c)
        return {s: sum(v, Vector()) / len(v) for s, v in acc.items() if v}
    skin_ids = mat_ids(face, "_SKIN")
    eyes = by_side(mat_ids(face, "EyeWhite"))
    iris = by_side(mat_ids(face, "EyeIris"))
    brows = by_side(mat_ids(face, "FaceBrow"))
    mouth_v = [me.vertices[i].co for p in me.polygons if p.material_index in mat_ids(face, "FaceMouth")
               for i in p.vertices]
    skin_v = sorted({i for p in me.polygons if p.material_index in skin_ids for i in p.vertices})
    mid = [me.vertices[i].co for i in skin_v if abs(me.vertices[i].co.y) < 0.006]
    ez = sum(e.z for e in eyes.values()) / len(eyes)
    nose = max((c for c in mid if c.z < ez), key=lambda c: c.x).copy()
    chin = min(mid, key=lambda c: c.z).copy()
    front = [c for c in mid if c.z > chin.z + 0.01 and c.x > nose.x - 0.06]
    chin_front = max((c for c in front if c.z < chin.z + 0.03), key=lambda c: c.x).copy()
    mz = sum(c.z for c in mouth_v) / len(mouth_v)
    mx = max(c.x for c in mouth_v)
    ears = {}
    for s in (-1, 1):
        e = [me.vertices[i].co for i in skin_v if me.vertices[i].co.y * s > 0.098]
        if e:
            ears[s] = sum(e, Vector()) / len(e)
    return {"eyes": eyes, "iris": iris, "brows": brows, "nose": nose, "chin": chin, "chin_front": chin_front,
            "mouth": Vector((mx, 0.0, mz)), "mouth_w": max(abs(c.y) for c in mouth_v), "ez": ez, "ears": ears,
            "skin_ids": skin_ids}


def _flat(p, c, r, core=0.6):
    d = math.sqrt(((p.x - c.x) / r[0]) ** 2 + ((p.y - c.y) / r[1]) ** 2 + ((p.z - c.z) / r[2]) ** 2)
    return 1.0 - U.smoothstep(core, 1.0, d)


def warp_field(L, st):
    """f(p, cls) -> displaced p (cls: 0 = everything, 1 = iris / highlight, 2 = brow)."""
    eh = st.get("eye_height", 1.0)
    ih = st.get("iris_height", eh)
    bumps = []
    for s, E in L["eyes"].items():
        bumps.append(("eye", E, (0.036, 0.036, 0.030), (eh, ih)))
        if st.get("cheekbone"):
            bumps.append(("disp", E + Vector((-0.008, 0.013 * s, -0.026)), (0.024, 0.022, 0.016),
                          Vector((st["cheekbone"] * 0.5, st["cheekbone"] * s, 0))))
    ch, cf, no = L["chin"], L["chin_front"], L["nose"]
    if st.get("jaw_widen"):
        for s in (-1, 1):
            bumps.append(("disp", Vector((cf.x - 0.07, 0.060 * s, ch.z + 0.035)), (0.04, 0.03, 0.035),
                          Vector((0, st["jaw_widen"] * s, 0))))
    if st.get("chin_widen"):
        bumps.append(("scale_y", Vector((cf.x, 0.0, ch.z + 0.012)), (0.05, 0.045, 0.03), st["chin_widen"]))
    drop, fwd = st.get("chin_drop", 0.0), st.get("chin_fwd", 0.0)
    brow_drop = st.get("brow_drop", 0.0)
    tilt = math.tan(math.radians(st.get("brow_tilt_deg", 0.0)))
    brows = L["brows"]

    def f(p, cls=0):
        q = p.copy()
        for kind, c, r, v in bumps:
            w = _flat(p, c, r)
            if w <= 0.0:
                continue
            if kind == "eye":
                k = v[1] if cls == 1 else v[0]
                q.z += (c.z - p.z) * (1.0 - k) * w
            elif kind == "scale_y":
                q.y += p.y * v * w
            else:
                q += v * w
        if drop or fwd:                                       # nose -> chin stretch, fading into the neck
            if p.z >= no.z:
                fz = 0.0
            elif p.z >= ch.z:
                fz = (no.z - p.z) / max(no.z - ch.z, 1e-4)
            else:
                fz = 1.0 - U.smoothstep(ch.z, ch.z - 0.035, p.z)
            fx = U.smoothstep(-0.03, 0.05, p.x)
            q.z -= drop * fz * fx
            q.x += fwd * fz * fx
        if cls == 2 and brows:                                # brows: down + inner ends lowered
            b = brows[1 if p.y > 0 else -1]
            q.z -= brow_drop
            q.z += tilt * (abs(p.y) - abs(b.y))
        return q
    return f


def vertex_classes(face):
    me = face.data
    iris = mat_ids(face, "EyeIris", "EyeHighlight")
    brow = mat_ids(face, "FaceBrow")
    cls = np.zeros(len(me.vertices), dtype=np.int8)
    for p in me.polygons:
        if p.material_index in iris:
            cls[list(p.vertices)] = 1
        elif p.material_index in brow:
            cls[list(p.vertices)] = 2
    return cls


def apply_warp(objs, f, classes=None):
    """Displace every vertex of objs (basis and shape keys) by f; classes: {object name: per-vertex class}."""
    for ob in objs:
        me = ob.data
        cl = (classes or {}).get(ob.name)

        def g(i, co):
            return f(co, int(cl[i]) if cl is not None else 0)
        if me.shape_keys:
            for kb in me.shape_keys.key_blocks:
                co = [g(i, d.co) for i, d in enumerate(kb.data)]
                kb.data.foreach_set("co", np.array([tuple(c) for c in co], dtype=np.float32).ravel())
            me.vertices.foreach_set("co", np.array([tuple(d.co) for d in me.shape_keys.key_blocks[0].data],
                                                   dtype=np.float32).ravel())
        else:
            for v in me.vertices:
                v.co = g(v.index, v.co)
        me.update()


def scale_parts(face, keys, factor):
    """Scale the polygons of the given materials about their per-side centroid, in the basis and every key."""
    if abs(factor - 1.0) < 1e-4:
        return
    me = face.data
    ids = mat_ids(face, *keys)
    vs = sorted({i for p in me.polygons if p.material_index in ids for i in p.vertices})
    blocks = me.shape_keys.key_blocks if me.shape_keys else None
    for s in (-1, 1):
        side = [i for i in vs if (me.vertices[i].co.y > 0) == (s > 0)]
        if not side:
            continue
        for kb in (list(blocks) if blocks else [None]):
            data = kb.data if kb else me.vertices
            c = sum((data[i].co for i in side), Vector()) / len(side)
            for i in side:
                data[i].co = c + (data[i].co - c) * factor
    if blocks:
        for v, d in zip(me.vertices, blocks[0].data):
            v.co = d.co
    me.update()


def style_geometry(face, body, L, st):
    f = warp_field(L, st)
    apply_warp([face, body], f, {face.name: vertex_classes(face)})
    scale_parts(face, ("EyeIris", "EyeHighlight"), st.get("iris_scale", 1.0))
    scale_parts(face, ("EyeHighlight",), st.get("highlight", 1.0))


# ------------------------------------------------------------------------------------------------ texture styling
def thin_alpha(px, cut):
    a = px[..., 3]
    px[..., 3] = np.clip((a - cut) / max(1.0 - cut, 1e-3), 0, 1)


def dilate_alpha(px, n):
    a = px[..., 3].copy()
    for _ in range(int(n)):
        a = np.maximum.reduce([a, np.roll(a, 1, 0), np.roll(a, -1, 0), np.roll(a, 1, 1), np.roll(a, -1, 1)])
    px[..., 3] = a


def flat_line(px, cut=0.0, dilate=0):
    """A painted line layer (brow / lash / eyeline) made flat: RGB 1 (the atlas multiplier gives the colour),
    alpha thinned by `cut` or thickened by `dilate` texels."""
    px[..., :3] = 1.0
    if dilate:
        dilate_alpha(px, dilate)
    if cut:
        thin_alpha(px, cut)


def skin_mask(px):
    r_, g_, b_ = px[..., 0], px[..., 1], px[..., 2]
    return (px[..., 3] > 0.5) & (r_ > 0.45) & (r_ > b_ * 1.05) & (g_ > 0.3)


def flatten_skin(px, lit_hex, ref_pct=60.0):
    """Skin texels -> the character's lit skin hue with the painted value (luminance) kept: removes the painted
    pink patches (they become slightly darker skin). Returns the mask used."""
    m = skin_mask(px)
    rgb = lin(px[..., :3])
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    ref = float(np.percentile(lum[m], ref_pct))
    tgt = hexlin(lit_hex)
    out = tgt[None, None, :] * np.clip(lum / max(ref, 1e-4), 0.0, 1.12)[..., None]
    rgb[m] = out[m]
    px[..., :3] = enc(rgb)
    return m


def raster_weights(ob, poly_ok, vweight, W, H, pad=3):
    """Per-vertex weights painted into the polygon's UV space (max over overlapping triangles), dilated `pad`
    texels across the UV seams and softened."""
    me = ob.data
    uv = me.uv_layers.active.data
    out = np.zeros((H, W), dtype=np.float32)
    for p in me.polygons:
        if not poly_ok(p):
            continue
        li = list(p.loop_indices)
        ws = [vweight[me.loops[l].vertex_index] for l in li]
        if max(ws) <= 1e-4:
            continue
        uvs = [(uv[l].uv.x * W - 0.5, uv[l].uv.y * H - 0.5) for l in li]
        for k in range(1, len(li) - 1):
            (x0, y0), (x1, y1), (x2, y2) = uvs[0], uvs[k], uvs[k + 1]
            w0, w1, w2 = ws[0], ws[k], ws[k + 1]
            xa, xb = int(max(0, math.floor(min(x0, x1, x2)) - 1)), int(min(W - 1, math.ceil(max(x0, x1, x2)) + 1))
            ya, yb = int(max(0, math.floor(min(y0, y1, y2)) - 1)), int(min(H - 1, math.ceil(max(y0, y1, y2)) + 1))
            if xb < xa or yb < ya:
                continue
            den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
            if abs(den) < 1e-9:
                continue
            X, Y = np.meshgrid(np.arange(xa, xb + 1), np.arange(ya, yb + 1))
            l0 = ((y1 - y2) * (X - x2) + (x2 - x1) * (Y - y2)) / den
            l1 = ((y2 - y0) * (X - x2) + (x0 - x2) * (Y - y2)) / den
            l2 = 1.0 - l0 - l1
            ins = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02)
            val = np.where(ins, l0 * w0 + l1 * w1 + l2 * w2, 0.0)
            sl = out[ya:yb + 1, xa:xb + 1]
            np.maximum(sl, val, out=sl)
    for _ in range(pad):
        out = np.maximum.reduce([out, np.roll(out, 1, 0), np.roll(out, -1, 0), np.roll(out, 1, 1),
                                 np.roll(out, -1, 1)])
    for _ in range(2):
        out = (out + np.roll(out, 1, 0) + np.roll(out, -1, 0) + np.roll(out, 1, 1) + np.roll(out, -1, 1)) / 5.0
    return out


def blush_weights(coords, spots):
    """spots: [(centre, radius, strength)] -> per-vertex blush weight (smooth falloff, max over spots)."""
    w = np.zeros(len(coords))
    P = np.array([tuple(c) for c in coords])
    for c, r, s in spots:
        d = np.linalg.norm(P - np.array(tuple(c)), axis=1) / r
        t = np.clip(1.0 - d, 0, 1)
        w = np.maximum(w, s * t * t * (3 - 2 * t))
    return w


def apply_blush(px, wmap, blush_hex, lit_hex):
    rgb = lin(px[..., :3])
    mul = np.clip(hexlin(blush_hex) / np.maximum(hexlin(lit_hex), 1e-4), 0, 1)
    k = np.clip(wmap, 0, 1)[..., None]
    rgb = rgb * (1.0 - k + k * mul[None, None, :])
    px[..., :3] = enc(rgb)


# ------------------------------------------------------------------------------------------------ beard
# A painted anime short beard: one flat hair-colour shape on the face texture (MAT-face) along the jaw, chin and
# moustache, with crisp edges, a few clean pointed notches along the cheek line, a skin gap at the mouth corners
# and a one-tone darker band under the jaw. Being texture, it follows every expression for free.
#
# Face-surface coordinates: s = lateral arc length (azimuth about the head's vertical axis x 0.1 m, + = left),
# dz = height above the mouth line.

# top line (s, dz): moustache over the upper lip from under the nose, ending short of the mouth corners; the beard
# below the corners, rising diagonally along the cheek to the sideburns in front of the ears
BEARD_TOP = [(0.000, 0.0125), (0.012, 0.0120), (0.022, 0.0080), (0.028, 0.0030), (0.034, -0.0020),
             (0.042, -0.0020), (0.060, 0.0030), (0.085, 0.0100), (0.105, 0.0200), (0.125, 0.0330),
             (0.140, 0.0420)]
# pointed notches up into the cheek: (s centre, half width, height)
BEARD_NOTCHES = [(0.068, 0.009, 0.0070), (0.094, 0.009, 0.0080), (0.119, 0.008, 0.0075)]
# holes: (rx, rz, dz centre, s centre): lower lip, mouth slit, the skin gap at each mouth corner
# lips: the lower lip, the mouth slit and the upper lip (the moustache sits on the skin above it)
BEARD_HOLES = [(0.021, 0.0034, -0.0045, 0.0), (0.026, 0.0018, 0.0, 0.0), (0.024, 0.0038, 0.0012, 0.0)]
LIP_HOLES = 3                       # the lips: tinted lip colour, not bare pale skin
# thin diagonal skin slits from each mouth corner (s, dz) -> (s, dz), half width: the moustache drawn apart from the
# beard (mirrored to both sides)
BEARD_SLITS = [((0.0245, 0.0040), (0.0350, -0.0095), 0.0007)]   # painted in a mid skin-shade tone (shadow)


def _interp_np(knots, x):
    xs = np.array([k[0] for k in knots])
    ys = np.array([k[1] for k in knots])
    return np.interp(x, xs, ys)


def beard_field_np(s, dz, bc):
    """Signed distance-ish field (m, > 0 inside the beard) for arrays s, dz."""
    a = np.abs(s)
    top = _interp_np(bc.get("top", BEARD_TOP), a)
    for c, hw, h in bc.get("notches", BEARD_NOTCHES):
        top = top + h * np.clip(1.0 - np.abs(a - c) / hw, 0.0, 1.0)
    f = np.minimum(np.minimum(top - dz, bc.get("side", 0.145) - a), dz + bc.get("under", 0.09))
    for rx, rz, cz, cs in bc.get("holes", BEARD_HOLES):
        e = np.sqrt(((s - cs) / rx) ** 2 + ((dz - cz) / rz) ** 2)
        f = np.minimum(f, (e - 1.0) * min(rx, rz))
    for (s0, z0), (s1, z1), hw in bc.get("slits", BEARD_SLITS):
        dx, dy = s1 - s0, z1 - z0
        ln2 = dx * dx + dy * dy
        t = np.clip(((a - s0) * dx + (dz - z0) * dy) / ln2, 0, 1)
        d = np.hypot(a - (s0 + t * dx), dz - (z0 + t * dy))
        f = np.minimum(f, d - hw)
    return f


def raster_attr(ob, poly_ok, attr, W, H, pad=2):
    """Per-vertex attributes (n, k) interpolated into the polygons' UV space: (H, W, k) values and a coverage
    mask (dilated `pad` texels across UV seams)."""
    me = ob.data
    uv = me.uv_layers.active.data
    k = attr.shape[1]
    out = np.zeros((H, W, k), dtype=np.float32)
    cov = np.zeros((H, W), dtype=bool)
    for p in me.polygons:
        if not poly_ok(p):
            continue
        li = list(p.loop_indices)
        vi = [me.loops[l].vertex_index for l in li]
        uvs = [(uv[l].uv.x * W - 0.5, uv[l].uv.y * H - 0.5) for l in li]
        for t in range(1, len(li) - 1):
            (x0, y0), (x1, y1), (x2, y2) = uvs[0], uvs[t], uvs[t + 1]
            a0, a1, a2 = attr[vi[0]], attr[vi[t]], attr[vi[t + 1]]
            xa, xb = int(max(0, math.floor(min(x0, x1, x2)) - 1)), int(min(W - 1, math.ceil(max(x0, x1, x2)) + 1))
            ya, yb = int(max(0, math.floor(min(y0, y1, y2)) - 1)), int(min(H - 1, math.ceil(max(y0, y1, y2)) + 1))
            if xb < xa or yb < ya:
                continue
            den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
            if abs(den) < 1e-12:
                continue
            X, Y = np.meshgrid(np.arange(xa, xb + 1), np.arange(ya, yb + 1))
            l0 = ((y1 - y2) * (X - x2) + (x2 - x1) * (Y - y2)) / den
            l1 = ((y2 - y0) * (X - x2) + (x0 - x2) * (Y - y2)) / den
            l2 = 1.0 - l0 - l1
            ins = (l0 >= -0.01) & (l1 >= -0.01) & (l2 >= -0.01)
            if not ins.any():
                continue
            val = l0[..., None] * a0 + l1[..., None] * a1 + l2[..., None] * a2
            sl = out[ya:yb + 1, xa:xb + 1]
            sl[ins] = val[ins]
            cov[ya:yb + 1, xa:xb + 1] |= ins
    for _ in range(pad):                                 # spill the edge values over the seams
        grown = cov.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            src = np.roll(np.roll(out, dy, 0), dx, 1)
            sc = np.roll(np.roll(cov, dy, 0), dx, 1)
            take = sc & ~grown
            out[take] = src[take]
            grown |= take
        cov = grown
    return out, cov


def paint_beard_on_face(face, L, cfg, face_px, skin_index):
    """Paint the beard into the face skin texture face_px (h, w, 4 sRGB, in place) through the face skin UVs:
    every texel gets its 3D position and normal, hence (s, dz) and the field -> a crisp coverage edge."""
    bc = cfg["beard"]
    me = face.data
    H, W = face_px.shape[:2]
    co = np.array([tuple(v.co) for v in me.vertices], dtype=np.float32)
    nr = np.array([tuple(v.normal) for v in me.vertices], dtype=np.float32)
    att, cov = raster_attr(face, lambda p: p.material_index == skin_index, np.hstack([co, nr]), W, H)
    P, N = att[..., :3], att[..., 3:]
    s = np.arctan2(P[..., 1], P[..., 0]) * 0.1
    dz = P[..., 2] - L["mouth"].z
    f = beard_field_np(s, dz, bc)
    aa = bc.get("edge", 0.0005)                         # metres of anti-aliasing: a crisp painted edge
    alpha = np.clip(0.5 + f / (2 * aa), 0, 1) * cov
    lit, shade = hexlin(cfg["hair_lit"]), hexlin(cfg["hair_shade"])
    base = shade + (lit - shade) * bc.get("tone", 0.72)
    dark = shade + (lit - shade) * bc.get("under_tone", 0.38)
    nz = N[..., 2] / np.maximum(np.linalg.norm(N, axis=-1), 1e-6)
    under = np.clip((-nz - 0.30) / 0.06, 0, 1) * (P[..., 2] < L["mouth"].z - 0.02)   # faces down: under the jaw
    col = base[None, None, :] * (1 - under[..., None]) + dark[None, None, :] * under[..., None]
    rgb = lin(face_px[..., :3])
    # lips inside the beard: a darker warm lip tone so the bare strip doesn't read as teeth
    lips = np.zeros_like(f)
    for rx, rz, cz, cs in bc.get("holes", BEARD_HOLES)[:LIP_HOLES]:
        e = np.sqrt(((s - cs) / (rx + 0.002)) ** 2 + ((dz - cz) / (rz + 0.0012)) ** 2)
        lips = np.maximum(lips, np.clip((1.0 - e) / 0.25, 0, 1))
    lip_mul = np.array(bc.get("lip_mul", (0.72, 0.50, 0.46)))
    k = (lips * cov)[..., None] * bc.get("lip_k", 0.9)
    rgb = rgb * (1 - k + k * lip_mul[None, None, :])
    # mouth-corner lines: a mid skin-shade tone (they read as shadow, never as a highlight)
    a_ = np.abs(s)
    slit = np.zeros_like(f)
    for (s0, z0), (s1, z1), hw in bc.get("slits", BEARD_SLITS):
        dx, dy = s1 - s0, z1 - z0
        t = np.clip(((a_ - s0) * dx + (dz - z0) * dy) / (dx * dx + dy * dy), 0, 1)
        d = np.hypot(a_ - (s0 + t * dx), dz - (z0 + t * dy))
        slit = np.maximum(slit, np.clip(1.0 - (d - hw) / (2 * aa), 0, 1))
    sm = np.array(bc.get("slit_mul", (0.70, 0.50, 0.46)))
    ks = (slit * cov)[..., None]
    rgb = rgb * (1 - ks + ks * sm[None, None, :])
    rgb = rgb * (1 - alpha[..., None]) + col * alpha[..., None]
    face_px[..., :3] = enc(rgb)
    return float(alpha.sum())


def transfer_keys_to_new(face, n_orig, src_mats):
    """Vertices added after index n_orig take the shape-key deltas and the skin weights of their nearest original
    vertex of the src_mats polygons."""
    me = face.data
    ok = sorted({i for p in me.polygons if p.material_index in src_mats for i in p.vertices if i < n_orig})
    kd = KDTree(len(ok))
    for k_, i in enumerate(ok):
        kd.insert(me.vertices[i].co, k_)
    kd.balance()
    near = {}
    for vi in range(n_orig, len(me.vertices)):
        _, k_, _ = kd.find(me.vertices[vi].co)
        near[vi] = ok[k_]
    if me.shape_keys:
        kb = me.shape_keys.key_blocks
        basis = kb[0]
        for vi, j in near.items():
            basis.data[vi].co = me.vertices[vi].co
            for k in list(kb)[1:]:
                k.data[vi].co = me.vertices[vi].co + (k.data[j].co - basis.data[j].co)
    for vi, j in near.items():
        for g in me.vertices[j].groups:
            face.vertex_groups[g.group].add([vi], g.weight, "REPLACE")
    return len(near)
