"""ANIME A1 FINISH: the fitted VRoid base (vroid_fit.py) made into a Saber Duel delivery master.

  python tools/blender/run.py tools/blender/vroid_finish.py -- --char kael

 1. Base clothes stripped (the VRoid body under them is complete: painted shorts / socks stay as underwear);
    the skin made opaque.
 2. Hair restyled by posing the VRoid hair joints (bangs lifted off the eyes, a couple left loose) and
    recoloured; skin, iris and brows recoloured (painted textures keep their hand-painted shading).
 3. Fists (section 4): fingers curled about the hand's lateral axis until the fist channel fits the hilt
    (bisection on the measured hole radius), thumb wrapped by IK over index / middle; the open hand (slightly
    spread) is kept as the palmOpen morph on the left hand. The measured grip centres become armature extras.
 4. Contract skeleton (17 joints, identity rest rotations) with the VRoid weights merged into it
    (v5 mapping table), at most 4 influences.
 5. Face expressions expr_blink / angry / shout / pain / smile / focus built from the VRoid Fcl_* blendshapes;
    the Fcl_* keys are dropped.
 6. Toon materials: face (skin, mouth, brows, lashes, eyeline -> MAT-face) and eyes (white, iris, highlight
    -> MAT-eyes) merged into atlases, MAT-skin, MAT-hair; each a baseColor-only Principled material with the
    v5 "toon" extras (shade colour / shift / toony, rim, outline, matcap) from the MToon parameters.
 7. Outline mask: colour attribute COLOR_0 (R = outline width scale: 0 inside the face, 1 on the silhouette).
 Output: art/characters/<id>/<id>_anime_master.blend, review/a1_finish/finish_report.json.
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
import vroid_chars  # noqa: E402
import vroid_face as F  # noqa: E402
import vroid_hair as HR  # noqa: E402

PHASE = "a1_finish"
REPORT = {}
SIDES = (("R", "N", -1.0), ("L", "F", 1.0))
FINGERS = ("Index", "Middle", "Ring", "Little")
CURL = {"Index": (80.0, 95.0, 60.0), "Middle": (84.0, 98.0, 60.0), "Ring": (86.0, 98.0, 60.0),
        "Little": (88.0, 95.0, 55.0)}
HAND_KEYS = ("_Hand", "Thumb", "Index", "Middle", "Ring", "Little")     # hand + finger bones (not the legs)
GRIP_R = 0.0215
HOLE_TARGET = 0.0195            # fist channel radius: fingers close a little onto the 21.5 mm hilt


def srgb_lin(h):
    return np.array(C.hex_to_linear(h)[:3])


# ------------------------------------------------------------------------------------------------ 1 strip
def keep_clothes(body, cid, keys):
    """A copy of the base's clothing (materials whose names contain any of keys) as GEO-<id>_clothes in the
    COSTUME_SRC collection: authored VRoid garments for a costume script (exact fit: same base and the same warp)."""
    me = body.data
    keep = [i for i, m in enumerate(me.materials) if m and any(k in m.name for k in keys)]
    if not keep:
        return None
    ob = body.copy()
    ob.data = me.copy()
    ob.name = ob.data.name = "GEO-%s_clothes" % cid
    U.col("COSTUME_SRC").objects.link(ob)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index not in keep], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    # remember the VRoid secondary (physics) parts before the weights are merged: hood, hood strings, ...
    gi = {g.index: g.name for g in ob.vertex_groups}
    for key in ("Hood", "HoodString"):
        a = ob.data.attributes.new("sd_sec_" + key.lower(), "FLOAT", "POINT")
        vals = [max([g.weight for g in v.groups if key in gi[g.group] and
                     (key == "HoodString" or "String" not in gi[g.group])] or [0.0]) for v in ob.data.vertices]
        a.data.foreach_set("value", vals)
    REPORT["clothes_kept"] = {me.materials[i].name: True for i in keep}
    return ob


def strip_clothes(body):
    me = body.data
    mats = [m.name if m else "" for m in me.materials]
    keep = [i for i, n in enumerate(mats) if "SKIN" in n.upper()]
    bm = bmesh.new()
    bm.from_mesh(me)
    kill = [f for f in bm.faces if f.material_index not in keep]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me.update()
    REPORT["stripped_faces"] = len(kill)
    return mats[keep[0]] if keep else None


def image_px(img):
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)


def set_px(img, px):
    img.pixels.foreach_set(px.astype(np.float32).ravel())
    img.update()


def new_image(name, px):
    """A fresh (unpacked) image holding px (h, w, 4) - the VRM textures arrive packed, and edits to a packed image
    do not survive saving."""
    h, w = px.shape[:2]
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    im = bpy.data.images.new(name, w, h, alpha=True)
    im.pixels.foreach_set(px.astype(np.float32).ravel())
    return im


def resized(px, w, h):
    tmp = new_image("_sd_tmp_resize", px)
    tmp.scale(w, h)
    out = image_px(tmp)
    bpy.data.images.remove(tmp)
    return out


def lin(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def enc(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def tint_to(px, target_hex, mask=None, strength=1.0):
    """Per-channel linear gain moving the image's mean colour (inside mask) onto target_hex; the painted shading
    (relative variation) is kept. px: (h, w, 4) array, modified in place; returns the gain."""
    rgb = lin(px[..., :3])
    if mask is None:                       # skin-like texels only (not the painted shorts / socks / background)
        r_, g_, b_ = px[..., 0], px[..., 1], px[..., 2]
        mask = (px[..., 3] > 0.5) & (r_ > 0.45) & (r_ > b_ * 1.05) & (g_ > 0.3)
    m = mask
    mean = rgb[m].mean(axis=0)
    gain = srgb_lin(target_hex) / np.maximum(mean, 1e-4)
    gain = 1.0 + (gain - 1.0) * strength
    out = rgb * gain[None, None, :]
    px[..., :3] = enc(out)
    return [round(float(g), 3) for g in gain]


def recolour_ramp(px, dark_hex, lit_hex, spec_hex=None, gamma=1.0):
    """Replace an image's colours by a ramp dark -> lit over its luminance (hair: the painted strand shading and
    the highlight band survive, the hue becomes the character's). px modified in place."""
    rgb = px[..., :3]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    a = px[..., 3] > 0.05
    lo, hi = np.percentile(lum[a], 2), np.percentile(lum[a], 99.5)
    t = np.clip((lum - lo) / max(hi - lo, 1e-4), 0, 1) ** gamma
    d, l_ = lin(np.array(C.hex_to_srgb(dark_hex))), lin(np.array(C.hex_to_srgb(lit_hex)))
    out = d[None, None, :] * (1 - t[..., None]) + l_[None, None, :] * t[..., None]
    if spec_hex is not None:
        s = lin(np.array(C.hex_to_srgb(spec_hex)))
        hl = np.clip((t - 0.8) / 0.2, 0, 1)[..., None]
        out = out * (1 - hl) + s[None, None, :] * hl
    px[..., :3] = enc(out)


def recolour_iris(px, iris_hex):
    """Iris texture: keep its value structure, swap hue/saturation for the character's eye colour (in place)."""
    rgb = lin(px[..., :3])
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    iris = sat > 0.25
    target = srgb_lin(iris_hex)
    val = mx / max(float(np.percentile(mx[iris], 90)), 1e-4)
    out = rgb.copy()
    out[iris] = np.clip(target[None, :] * val[iris][:, None] * 1.1, 0, 1)
    px[..., :3] = enc(out)


# ------------------------------------------------------------------------------------------------ 2 hair
def hair_roots(arm):
    head = arm.data.bones["J_Bip_C_Head"]
    return [b for b in arm.data.bones if b.parent == head and b.name.startswith("HairJoint")]


def restyle_hair(arm, hair_objs, cfg):
    """Lift the bang strands (roots in front of the skull) forward-up about their roots, more the further out
    they hang; the `hair_loose` most central bangs stay down (loose strands over the forehead)."""
    head = arm.data.bones["J_Bip_C_Head"].head_local
    roots = hair_roots(arm)
    bangs = [b for b in roots if b.head_local.x - head.x > 0.03]
    bangs.sort(key=lambda b: abs(b.head_local.y))
    loose = {b.name for b in bangs[:cfg.get("hair_loose", 0)]}
    R.reset_pose(arm)
    lat = Vector((0.0, 1.0, 0.0))
    for b in bangs:
        k = 0.25 if b.name in loose else 1.0
        R.rotate_pose(arm, b.name, lat, -math.radians(cfg.get("hair_sweep_deg", 30.0)) * k)
    R.apply_pose_as_rest(arm, hair_objs, dqs=False)
    REPORT["hair_bangs"] = {"lifted": len(bangs) - len(loose), "loose": len(loose), "roots": len(roots)}


# ------------------------------------------------------------------------------------------------ 3 fists
def hand_verts(body, vs):
    names = {g.index for g in body.vertex_groups if g.name.startswith("J_Bip_%s_" % vs) and
             any(k in g.name for k in HAND_KEYS)}
    out = []
    for v in body.data.vertices:
        w = sum(g.weight for g in v.groups if g.group in names)
        if w > 0.3:
            out.append(v.index)
    return out


def curl(arm, vs, k):
    axis = Vector((0.0, -1.0, 0.0))                       # finger dir (-Z) x palm normal (+X)
    for f in FINGERS:
        for seg, ang in zip((1, 2, 3), CURL[f]):
            R.rotate_pose(arm, "J_Bip_%s_%s%d" % (vs, f, seg), axis, math.radians(ang * k))


def thumb_wrap(arm, vs, centre):
    """IK the thumb tip onto the outside of the curled index / middle middle phalanges."""
    bpy.context.view_layer.update()
    i1 = R.wpose(arm, "J_Bip_%s_Index2" % vs).translation
    i2 = R.wpose(arm, "J_Bip_%s_Index3" % vs).translation
    p = i1 * 0.6 + i2 * 0.4                                   # over the index middle phalanx
    out = Vector((p.x - centre.x, 0.0, p.z - centre.z))
    out = out.normalized() if out.length > 1e-6 else Vector((1, 0, 0))
    sg = 1.0 if vs == "L" else -1.0
    tgt_pos = p + out * 0.010 + Vector((0.0, sg * 0.006, 0.0))
    tgt = bpy.data.objects.new("_ik_tgt", None)
    bpy.context.scene.collection.objects.link(tgt)
    tgt.location = arm.matrix_world.inverted() @ tgt_pos
    pb = arm.pose.bones["J_Bip_%s_Thumb3" % vs]
    c = pb.constraints.new("IK")
    c.target = tgt
    c.chain_count = 3
    bpy.context.view_layer.update()
    mats = {n: R.wpose(arm, n).copy() for n in ("J_Bip_%s_Thumb1" % vs, "J_Bip_%s_Thumb2" % vs, "J_Bip_%s_Thumb3" % vs)}
    pb.constraints.remove(c)
    bpy.data.objects.remove(tgt, do_unlink=True)
    for n, M in mats.items():
        R.set_wpose(arm, n, M)
    tip = arm.matrix_world @ arm.pose.bones["J_Bip_%s_Thumb3" % vs].tail
    miss = (tip - tgt_pos).length
    return round(miss, 4)


def fist_hole(coords, idx, band_y):
    """Largest empty circle enclosed by the curled hand in the plane across the grip axis (world X/Z), using
    hand vertices within 2 cm of band_y. Returns (centre (x, z), radius) or (None, 0)."""
    P = np.array([(coords[i].x, coords[i].z) for i in idx if abs(coords[i].y - band_y) < 0.005])
    if len(P) < 12:
        return None, 0.0
    lo, hi = P.min(axis=0), P.max(axis=0)
    best, best_r = None, 0.0
    for gx in np.linspace(lo[0], hi[0], 36):
        for gz in np.linspace(lo[1], hi[1], 36):
            d = P - np.array([gx, gz])
            r = np.hypot(d[:, 0], d[:, 1])
            near = r < 0.06
            ang = np.arctan2(d[near, 1], d[near, 0])
            sectors = np.unique(((ang + np.pi) / (2 * np.pi) * 12).astype(int) % 12)
            if len(sectors) < 11:
                continue
            rr = r.min()
            if rr > best_r:
                best, best_r = (gx, gz), rr
    return best, best_r


def make_fists(arm, body, report, extra=()):
    """Curl both hands until the fist channel matches HOLE_TARGET; returns the open-hand coordinates (palmOpen
    source, left hand spread a little) and leaves the fist pose applied as the rest."""
    R.reset_pose(arm)
    # open hand, slightly spread (palmOpen)
    palm = Vector((1.0, 0.0, 0.0))
    for f, deg in zip(FINGERS, (-5.0, 0.0, 5.0, 9.0)):
        R.rotate_pose(arm, "J_Bip_L_%s1" % f, palm, math.radians(deg))
    R.rotate_pose(arm, "J_Bip_L_Thumb1", palm, math.radians(-8.0))
    open_co = U.evaluated_coords(body)
    R.reset_pose(arm)
    grips = {}
    for vs, cs, sg in SIDES:
        idx = hand_verts(body, vs)
        band_y = arm.data.bones["J_Bip_%s_Middle1" % vs].head_local.y
        side_bones = [b.name for b in arm.pose.bones if b.name.startswith("J_Bip_%s_" % vs) and
                      any(k in b.name for k in HAND_KEYS)]
        scan = []
        for k in [0.55 + 0.05 * i for i in range(17)]:      # 0.55 .. 1.35
            R.reset_pose(arm, side_bones)
            curl(arm, vs, k)
            co = U.evaluated_coords(body)
            c, r = fist_hole(co, idx, band_y)
            scan.append((k, c, r))
        # tightest curl whose channel still (nearly) fits the hilt: fingers close onto it, pads compressed a little
        ok = [t for t in scan if t[1] is not None and t[2] >= HOLE_TARGET - 0.003]
        k, c, r = max(ok, key=lambda t: t[0]) if ok else scan[len(scan) // 2]
        report.setdefault("fist_scan_" + cs, [(round(t[0], 2), round(t[2], 4)) for t in scan])
        R.reset_pose(arm, side_bones)
        curl(arm, vs, k)
        centre = Vector((c[0], band_y, c[1])) if c else R.wpose(arm, "J_Bip_%s_Hand" % vs).translation
        miss = thumb_wrap(arm, vs, centre)
        co = U.evaluated_coords(body)
        c2, r2 = fist_hole(co, idx, band_y)
        if c2:
            centre = Vector((c2[0], band_y, c2[1]))
        wrist = Vector(C.joint_blender("hand" + cs))
        off_b = centre - wrist
        off_game = (round(off_b.x, 4), round(off_b.z, 4), round(-off_b.y, 4))
        grips[cs] = off_game
        report["grip_" + cs] = {"curl_scale": round(k, 3), "hole_radius": round(r2 or r, 4), "thumb_miss": miss,
                                "centre_offset_game": off_game}
    R.apply_pose_as_rest(arm, [body] + list(extra), dqs=False)
    return open_co, grips


def add_palm_open(body, open_co, arm_names_l):
    """palmOpen = the open (spread) left hand; everything else equals the fist basis."""
    me = body.data
    gi = {g.index for g in body.vertex_groups if g.name in arm_names_l}
    if not me.shape_keys:
        body.shape_key_add(name="Basis", from_mix=False)
    key = body.shape_key_add(name="palmOpen", from_mix=False)
    key.value = 0.0
    n = 0
    for v in me.vertices:
        w = sum(g.weight for g in v.groups if g.group in gi)
        if w > 0.0 and (open_co[v.index] - v.co).length > 1e-6:
            key.data[v.index].co = v.co + (open_co[v.index] - v.co) * min(1.0, w * 1.5)
            n += 1
    REPORT["palmOpen_vertices"] = n


# ------------------------------------------------------------------------------------------------ 4 contract rig
def contract_group(name):
    if name.startswith("J_Bip_"):
        part = name[6:]
        side = part[0]
        rest = part[2:] if side in "RL" else part[2:]
        cs = {"R": "N", "L": "F"}.get(side)
        if side == "C":
            return {"Hips": "hips", "Spine": "spine", "Chest": "chest", "UpperChest": "chest", "Neck": "neck",
                    "Head": "head"}.get(rest)
        if rest.startswith("Shoulder"):
            return "chest"
        if rest.startswith("UpperArm"):
            return "upper" + cs
        if rest.startswith("LowerArm"):
            return "fore" + cs
        if rest.startswith(("Hand", "Thumb", "Index", "Middle", "Ring", "Little")):
            return "hand" + cs
        if rest.startswith("UpperLeg"):
            return "thigh" + cs
        if rest.startswith("LowerLeg"):
            return "shin" + cs
        if rest.startswith(("Foot", "ToeBase")):
            return "foot" + cs
    if name.startswith(("J_Adj_", "HairJoint", "J_Sec_Hair")):
        return "head"
    if name.startswith("J_Sec_"):
        return "chest"
    if name == "Root":
        return "hips"
    return None


def sec_parent_group(arm, name):
    """A VRoid secondary bone (J_Sec_*: twist helpers on some bases, coat / skirt / hood physics) -> the contract
    joint of its nearest mapped J_Bip ancestor (so arm and leg twist weights stay on the limb)."""
    b = arm.data.bones.get(name) if arm is not None else None
    while b is not None:
        if b.name.startswith("J_Bip_") or b.name == "Root":
            return contract_group(b.name)
        b = b.parent
    return None


def merge_to_contract(ob, max_inf=4, arm=None):
    """Rewrite ob's vertex groups as the 17 contract joints (sums by the mapping table; the clavicle bone gives
    25 % of its weight to the upper arm), normalised, <= max_inf influences. With the VRoid armature given, J_Sec_*
    groups (other than hair) follow their bone's nearest J_Bip ancestor instead of the chest."""
    old = {g.index: g.name for g in ob.vertex_groups}
    sec = {n: sec_parent_group(arm, n) for n in old.values()
           if n.startswith("J_Sec_") and not n.startswith("J_Sec_Hair")} if arm is not None else {}
    per = []
    for v in ob.data.vertices:
        acc = {}
        for g in v.groups:
            n = old[g.group]
            cg = sec.get(n) or contract_group(n)
            if cg is None:
                continue
            w = g.weight
            if n.startswith("J_Bip_R_Shoulder") or n.startswith("J_Bip_L_Shoulder"):
                up = "upperN" if "_R_" in n else "upperF"
                acc[up] = acc.get(up, 0.0) + 0.25 * w
                w *= 0.75
            acc[cg] = acc.get(cg, 0.0) + w
        items = sorted(((k, w) for k, w in acc.items() if w > 0.01), key=lambda t: -t[1])[:max_inf]
        tot = sum(w for _, w in items)
        if tot <= 0:
            items = [("head" if ob.name.endswith(("_face", "_hair")) else "hips", 1.0)]
            tot = 1.0
        per.append([(k, w / tot) for k, w in items])
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    groups = {j: ob.vertex_groups.new(name=j) for j in C.CORE}
    for vi, items in enumerate(per):
        for k, w in items:
            groups[k].add([vi], w, "REPLACE")


# ------------------------------------------------------------------------------------------------ 5 expressions
EXPR = {
    "expr_blink": {"EYE_Close": 1.0},
    "expr_angry": {"BRW_Angry": 1.0, "EYE_Angry": 0.8, "MTH_Angry": 0.8},
    "expr_shout": {"MTH_A": 1.0, "BRW_Angry": 1.0, "EYE_Angry": 0.7, "MTH_Angry": 0.3},
    "expr_pain": {"BRW_Sorrow": 1.0, "EYE_Close": 0.65, "MTH_I": 0.7, "MTH_Sorrow": 0.4},
    "expr_smile": {"MTH_Fun": 1.0, "EYE_Joy": 0.35, "BRW_Fun": 0.6},
    "expr_focus": {"EYE_Angry": 0.6, "BRW_Angry": 0.55},
}


def build_expressions(face):
    me = face.data
    kb = me.shape_keys.key_blocks
    basis = np.array([tuple(d.co) for d in kb[0].data])
    by_suffix = {}
    for k in list(kb)[1:]:
        i = k.name.find("Fcl_")
        if i >= 0:
            by_suffix[k.name[i + 4:]] = k
    made = {}
    for name, mix in EXPR.items():
        delta = np.zeros_like(basis)
        used = []
        for suf, w in mix.items():
            k = by_suffix.get(suf)
            if k is None:
                continue
            delta += w * (np.array([tuple(d.co) for d in k.data]) - basis)
            used.append(suf)
        made[name] = (delta, used)
    for k in list(kb)[1:]:
        face.shape_key_remove(k)
    for name, (delta, used) in made.items():
        nk = face.shape_key_add(name=name, from_mix=False)
        nk.data.foreach_set("co", (basis + delta).astype(np.float32).ravel())
        nk.value = 0.0
    REPORT["expressions"] = {n: u for n, (d, u) in made.items()}


# ------------------------------------------------------------------------------------------------ 6 materials
def mtoon(m):
    ext = m.vrm_addon_extension.mtoon1
    mt = ext.extensions.vrmc_materials_mtoon
    src = ext.pbr_metallic_roughness.base_color_texture.index.source
    return {"img": src, "base": list(ext.pbr_metallic_roughness.base_color_factor),
            "shade": list(mt.shade_color_factor), "shift": mt.shading_shift_factor, "toony": mt.shading_toony_factor,
            "alpha": ext.alpha_mode, "cutoff": ext.alpha_cutoff}


def atlas(name, slots, size):
    """slots: [(pixels (h, w, 4), (u0, v0, u1, v1), rgba_multiplier)] -> one new RGBA image (straight alpha)."""
    W, H = size
    out = np.zeros((H, W, 4), dtype=np.float32)
    for src, (u0, v0, u1, v1), mul in slots:
        w, h = int(round((u1 - u0) * W)), int(round((v1 - v0) * H))
        px = resized(src, w, h) * np.array(mul, dtype=np.float32)[None, None, :]
        x0, y0 = int(round(u0 * W)), int(round(v0 * H))
        out[y0:y0 + h, x0:x0 + w] = px
    return new_image(name, out)


def remap_uvs(ob, slot_of_mat):
    """Move each polygon's UVs into its material's atlas rectangle; returns the new material index per poly."""
    me = ob.data
    uv = me.uv_layers.active.data
    new_idx = []
    for p in me.polygons:
        mname = me.materials[p.material_index].name
        tgt, (u0, v0, u1, v1) = slot_of_mat[mname]
        for li in p.loop_indices:
            u, v = uv[li].uv
            u = min(max(u, 0.0), 1.0)
            v = min(max(v, 0.0), 1.0)
            uv[li].uv = (u0 + u * (u1 - u0), v0 + v * (v1 - v0))
        new_idx.append(tgt)
    return new_idx


def toon_material(name, img, extras, alpha="OPAQUE", cutoff=0.5, double=False):
    m = U.new_material(name)
    nt = m.node_tree
    b = U.principled(nt)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Linear"
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    if alpha == "MASK":                    # 1 - (alpha < cutoff): the glTF exporter writes MASK + alphaCutoff
        lt = nt.nodes.new("ShaderNodeMath")
        lt.operation = "LESS_THAN"
        nt.links.new(tex.outputs["Alpha"], lt.inputs[0])
        lt.inputs[1].default_value = cutoff
        inv = nt.nodes.new("ShaderNodeMath")
        inv.operation = "SUBTRACT"
        inv.inputs[0].default_value = 1.0
        nt.links.new(lt.outputs[0], inv.inputs[1])
        nt.links.new(inv.outputs[0], b.inputs["Alpha"])
        try:
            m.surface_render_method = "DITHERED"
        except Exception:
            m.blend_method = "CLIP"
    elif alpha == "BLEND":
        nt.links.new(tex.outputs["Alpha"], b.inputs["Alpha"])
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            m.blend_method = "BLEND"
    U.set_input(b, "Roughness", 0.9)
    U.set_input(b, "Specular IOR Level", 0.0)
    m.use_backface_culling = not double
    m["toon"] = extras
    m["sd_alpha_mode"] = alpha
    m["sd_alpha_cutoff"] = cutoff
    return m


def toon_extras(cfg, lit_hex, shade_hex, toony, shift=-0.1, rim=True, outline=0.0022, matcap="none", unlit=False,
                shade_mul=None, rim_scale=1.0):
    """shadeColor = linear shade / lit ratio (or shade_mul, a linear multiplier given directly, e.g. a warm brown
    for hair); rimColor = the character rim colour x rim_scale."""
    lit, shade = srgb_lin(lit_hex), srgb_lin(shade_hex)
    ratio = np.clip(shade / np.maximum(lit, 1e-4), 0, 1) if shade_mul is None else np.array(shade_mul, dtype=float)
    rim = rim and rim_scale > 0.0
    out_c = srgb_lin(cfg["outline_hex"])
    return {"shadeColor": [round(float(x), 4) for x in ratio], "shadeShift": shift, "shadeToony": toony,
            "rimColor": [round(float(x) * rim_scale, 4) for x in srgb_lin(cfg["rim_hex"])] if rim else None,
            "rimPower": 4.0, "outlineWidth": outline, "outlineColor": [round(float(x), 4) for x in out_c],
            "matcap": matcap, "unlit": unlit}


def img_of(rec):
    s_ = rec["img"]
    return s_.image if hasattr(s_, "image") else s_


def build_materials(cfg, cid, body, face, hair_objs, tex_dir, L=None, spots=None):
    """spots: {"body": [(centre, radius, strength)], "face": [...]} blush spots (cfg "blush")."""
    mats_before = {m.name: m for m in bpy.data.materials}
    info = {}
    bl = cfg.get("blush")
    fs = cfg.get("face_style") or {}
    # --- skin (body): opaque, warmed toward the character's skin
    sk = mtoon(body.data.materials[0])
    skin_px = image_px(img_of(sk))
    skin_px[..., 3] = 1.0
    if bl:            # flattened to the skin hue (painted value kept), blush only where the config puts it
        F.flatten_skin(skin_px, cfg["skin_lit"])
        H_, W_ = skin_px.shape[:2]
        w = F.blush_weights([v.co for v in body.data.vertices], spots["body"])
        F.apply_blush(skin_px, F.raster_weights(body, lambda p: True, w, W_, H_), bl["hex"], cfg["skin_lit"])
    else:
        info["skin_gain"] = tint_to(skin_px, cfg["skin_lit"], strength=0.85)
    skin_img = new_image("%s_skin" % cid, skin_px)
    # --- face materials -> MAT-face (skin, mouth, brows, lashes, eyeline) + MAT-eyes (white, iris, highlight)
    fm = {m.name: mtoon(m) for m in face.data.materials if m.name != "SD_beard"}

    def find(key):
        return next(n for n in fm if key in n)
    face_skin, mouth = find("_Face_00_SKIN"), find("FaceMouth")
    brow, lash, line = find("FaceBrow"), find("FaceEyelash"), find("FaceEyeline")
    white, iris, hl = find("EyeWhite"), find("EyeIris"), find("EyeHighlight")
    extra = next((n for n in fm if "EyeExtra" in n), None)
    face_px = image_px(img_of(fm[face_skin]))
    if bl:
        F.flatten_skin(face_px, cfg["skin_lit"])
        H_, W_ = face_px.shape[:2]
        si = next(i for i, m in enumerate(face.data.materials) if m.name == face_skin)
        w = F.blush_weights([v.co for v in face.data.vertices], spots["face"])
        F.apply_blush(face_px, F.raster_weights(face, lambda p: p.material_index == si, w, W_, H_), bl["hex"],
                      cfg["skin_lit"])
    else:
        info["face_gain"] = tint_to(face_px, cfg["skin_lit"], strength=0.85)
    if cfg.get("beard"):                     # painted beard on the face skin texture
        si = next(i for i, m in enumerate(face.data.materials) if m.name == face_skin)
        info["beard_texels"] = round(F.paint_beard_on_face(face, L, cfg, face_px, si))
    iris_px = image_px(img_of(fm[iris]))
    recolour_iris(iris_px, cfg["eye_iris"])
    brow_rgb = list(srgb_lin(cfg["brow_hex"])) + [1.0]
    lash_rgb = list(srgb_lin(fs.get("lash_hex", cfg["brow_hex"]))) + [1.0]
    brow_px, lash_px, line_px = (image_px(img_of(fm[n])) for n in (brow, lash, line))
    if fs:            # flat painted lines: heavier brows, thinner and lighter lashes / eyeline
        F.flat_line(brow_px, dilate=fs.get("brow_dilate", 0))
        F.flat_line(lash_px, cut=fs.get("lash_cut", 0.0))
        F.flat_line(line_px, cut=fs.get("lash_cut", 0.0))
    face_slots = [(face_px, (0.0, 0.5, 0.5, 1.0), (1, 1, 1, 1)),
                  (image_px(img_of(fm[mouth])), (0.5, 0.75, 0.75, 1.0), (1, 1, 1, 1)),
                  (brow_px, (0.0, 0.375, 0.5, 0.5), brow_rgb),
                  (lash_px, (0.0, 0.25, 0.5, 0.375), lash_rgb),
                  (line_px, (0.0, 0.125, 0.5, 0.25), lash_rgb)]
    beard_slot = None
    eye_slots = [(image_px(img_of(fm[white])), (0.0, 0.5, 0.5, 1.0), (1, 1, 1, 1)),
                 (iris_px, (0.5, 0.5, 1.0, 1.0), (1, 1, 1, 1)),
                 (image_px(img_of(fm[hl])), (0.0, 0.0, 0.5, 0.5), (1, 1, 1, 1))]
    if extra:
        eye_slots.append((image_px(img_of(fm[extra])), (0.5, 0.0, 1.0, 0.5), (1, 1, 1, 1)))
    face_img = atlas("%s_face" % cid, face_slots, (2048, 2048))
    eye_img = atlas("%s_eyes" % cid, eye_slots, (2048, 1024))
    m_face = toon_material("MAT-face", face_img, toon_extras(cfg, cfg["skin_lit"], cfg["skin_shade"], 0.55, -0.05,
                                                             rim=False, outline=0.0012), alpha="MASK", cutoff=0.5)
    m_eyes = toon_material("MAT-eyes", eye_img, toon_extras(cfg, 0xFFFFFF, 0xFFFFFF, 1.0, 0.0, rim=False, outline=0.0,
                                                            unlit=True), alpha="MASK", cutoff=0.5)
    slot_of = {}
    for n, (_, rect, _m) in zip((face_skin, mouth, brow, lash, line), face_slots):
        slot_of[n] = (0, rect)
    for n, (_, rect, _m) in zip([white, iris, hl] + ([extra] if extra else []), eye_slots):
        slot_of[n] = (1, rect)
    if beard_slot:
        slot_of["SD_beard"] = (0, beard_slot[1])
    new_idx = remap_uvs(face, slot_of)
    face.data.materials.clear()
    face.data.materials.append(m_face)
    face.data.materials.append(m_eyes)
    face.data.polygons.foreach_set("material_index", new_idx)
    # --- body skin
    m_skin = toon_material("MAT-skin", skin_img, toon_extras(cfg, cfg["skin_lit"], cfg["skin_shade"], 0.85, -0.1,
                                                             outline=0.0022))
    body.data.materials.clear()
    body.data.materials.append(m_skin)
    # --- hair
    m_hair = None
    hair_img = None
    for h in hair_objs:
        if m_hair is None:
            hpx = image_px(img_of(mtoon(h.data.materials[0])))
            recolour_ramp(hpx, cfg["hair_shade"], cfg["hair_lit"], cfg.get("hair_spec"), gamma=0.9)
            hair_img = new_image("%s_hair" % cid, hpx)
            m_hair = toon_material("MAT-hair", hair_img,
                                   toon_extras(cfg, cfg["hair_lit"], cfg["hair_shade"], 0.8, -0.05, outline=0.0018,
                                               matcap="hair", shade_mul=cfg.get("hair_shade_mul"),
                                               rim_scale=cfg.get("hair_rim_scale", 1.0)),
                                   alpha="MASK", cutoff=0.5, double=True)
        h.data.materials.clear()
        h.data.materials.append(m_hair)
    # textures saved as PNG sources (WebP at export)
    os.makedirs(tex_dir, exist_ok=True)
    for img, nm in ((skin_img, "skin"), (face_img, "face"), (eye_img, "eyes"), (hair_img, "hair")):
        if img is None:
            continue
        path = os.path.join(tex_dir, "%s_%s.png" % (cid, nm))
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        img.filepath = path
    for m in list(bpy.data.materials):
        if m.name in mats_before and m.users == 0:
            bpy.data.materials.remove(m)
    REPORT["materials"] = info


# ------------------------------------------------------------------------------------------------ 6b toon normals
def ellipsoid_normals(ob, centre, radii, factor, poly_filter=None):
    """Anime shading normals (the Guilty Gear Xrd trick): blend each corner normal toward the normal of an
    ellipsoid round the head, so the cel terminator draws clean shapes across face and hair instead of
    following every crease. Written as custom split normals (exported as the glTF normals)."""
    me = ob.data
    me.update()
    c = Vector(centre)
    a2 = Vector([r * r for r in radii])
    ns = []
    for p in me.polygons:
        f = factor if (poly_filter is None or poly_filter(p)) else 0.0
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            d = co - c
            en = Vector((d.x / a2.x, d.y / a2.y, d.z / a2.z)).normalized()
            n0 = me.corner_normals[li].vector.copy() if hasattr(me, "corner_normals") else me.loops[li].normal.copy()
            ns.append((n0 * (1.0 - f) + en * f).normalized())
    me.normals_split_custom_set(ns)


def head_ellipsoid(face, hair_objs):
    co = [v.co for v in face.data.vertices]
    lo = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
    hi = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
    centre = Vector(((lo.x + hi.x) / 2 - 0.01, (lo.y + hi.y) / 2, lo.z + (hi.z - lo.z) * 0.55))
    radii = ((hi.x - lo.x) / 2 + 0.01, (hi.y - lo.y) / 2 + 0.005, (hi.z - lo.z) / 2 + 0.02)
    return centre, radii


# ------------------------------------------------------------------------------------------------ 7 outline mask
def outline_mask(ob, fn):
    me = ob.data
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    ca = me.color_attributes.new("sd_outline", "BYTE_COLOR", "CORNER")
    vals = np.zeros(len(me.loops) * 4, dtype=np.float32)
    me.update()
    for p in me.polygons:
        for li in p.loop_indices:
            vi = me.loops[li].vertex_index
            r = fn(me.vertices[vi], p)
            vals[li * 4:li * 4 + 4] = (r, 1.0, 1.0, 1.0)
    ca.data.foreach_set("color", vals)
    me.color_attributes.active_color = ca


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", required=True)
    a = ap.parse_args(U.args_after_dashes())
    cid = a.char
    cfg = vroid_chars.get(cid)
    cdir = U.char_dir(cid)
    bpy.ops.wm.open_mainfile(filepath=os.path.join(cdir, "build", "cache", "%s_anime_fit.blend" % cid))
    arm = bpy.data.objects["ARM-vroid"]
    body = bpy.data.objects["GEO-%s_body" % cid]
    face = bpy.data.objects["GEO-%s_face" % cid]
    hairs = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("GEO-%s_hair" % cid)]
    fs, bd, hs, bl = cfg.get("face_style"), cfg.get("beard"), cfg.get("hair_style"), cfg.get("blush")
    clothes = keep_clothes(body, cid, cfg["keep_clothes"]) if cfg.get("keep_clothes") else None
    strip_clothes(body)
    if not hs:                               # A1: pose the VRoid hair joints (hair_style: restyled after the face)
        restyle_hair(arm, hairs, cfg)
    open_co, grips = make_fists(arm, body, REPORT, extra=[clothes] if clothes else [])
    l_names = [b.name for b in arm.data.bones if b.name.startswith("J_Bip_L_") and any(k in b.name for k in HAND_KEYS)]
    add_palm_open(body, open_co, l_names)
    build_expressions(face)
    L = F.landmarks(face) if (fs or bd or hs or bl) else None
    if fs:
        F.style_geometry(face, body, L, fs)
        L = F.landmarks(face)
        REPORT["face_style"] = {"eyes_z": round(L["ez"], 4), "chin_z": round(L["chin"].z, 4),
                                "mouth_z": round(L["mouth"].z, 4), "nose_z": round(L["nose"].z, 4)}
    head_model = None
    hair_outer, hair_cap = {}, {}
    if hs and hs.get("mode", "soft") == "soft":   # authored VRoid hair kept: ahoge removed, bang tips eased up
        for h in hairs:
            REPORT.setdefault("hair_soft", {})[h.name] = HR.soft_restyle(h, face, body, L, hs)
    elif hs:                                 # "comb": VRoid locks re-routed along a comb flow (experimental)
        for h in hairs:
            st = dict(hs)
            st["cap_uv"] = HR.dark_texel(image_px(img_of(mtoon(h.data.materials[0]))))
            rep_, head_model, hair_outer[h.name], hair_cap[h.name] = HR.comb_hair(h, face, body, L,
                                                                                  dict(cfg, hair_style=st))
            REPORT.setdefault("hair_comb", {})[h.name] = rep_
    spots = None
    if bl:
        spots = {"body": [], "face": []}
        for vs, cs, sg in SIDES:
            sh = Vector(C.joint_blender("shin" + cs))
            spots["body"].append((sh + Vector((0.055, 0.0, 0.015)), 0.065, bl.get("knee", 0.4)))
            for f_ in FINGERS:
                spots["body"].append((arm.matrix_world @ arm.data.bones["J_Bip_%s_%s1" % (vs, f_)].head_local, 0.022,
                                      bl.get("knuckle", 0.45)))
                spots["body"].append((arm.matrix_world @ arm.data.bones["J_Bip_%s_%s2" % (vs, f_)].head_local, 0.013,
                                      bl.get("knuckle", 0.45) * 0.7))
        for s_, E in L["eyes"].items():
            spots["face"].append((E + Vector((0.010, 0.012 * s_, -0.030)), 0.024, bl.get("cheek", 0.35)))
        for s_, e in L["ears"].items():
            spots["face"].append((e, 0.03, bl.get("ear", 0.35)))
        if bl.get("lip"):                      # lips a touch darker than the skin (not white under the beard)
            spots["face"].append((L["mouth"] + Vector((0.0, 0.0, -0.003)), 0.024, bl["lip"]))
    build_materials(cfg, cid, body, face, hairs, os.path.join(cdir, "textures", "anime_src"), L, spots)
    # contract skeleton + weights
    rig = R.build_contract_armature("ARM-%s" % cid)
    rig["gripCentreN"] = list(grips["N"])
    rig["gripCentreF"] = list(grips["F"])
    rig["gripRadius"] = GRIP_R
    rig["gripAxis"] = "hand-local +z (game z at rest)"
    for ob in [body, face] + hairs + ([clothes] if clothes else []):
        merge_to_contract(ob, arm=arm)
        for m in [m for m in ob.modifiers if m.type == "ARMATURE"]:
            ob.modifiers.remove(m)
        ob.parent = rig
        ob.matrix_parent_inverse = Matrix.Identity(4)
        mod = ob.modifiers.new("Armature", "ARMATURE")
        mod.object = rig
        U.move_to(ob, "COSTUME_SRC" if ob is clothes else "LOW")
    bpy.data.objects.remove(arm, do_unlink=True)
    # outline mask: silhouette 1; face interior 0 (front-facing face skin, eyes, brows, mouth); jaw / sides 1
    centre, radii = head_ellipsoid(face, hairs)
    ellipsoid_normals(face, centre, radii, 0.75, poly_filter=lambda p: p.material_index == 0)
    for h in hairs:
        if head_model is not None:             # procedural hair: the fitted skull ellipsoid, a little larger
            ellipsoid_normals(h, head_model.c, tuple(r * 1.12 for r in head_model.r), 0.75)
        else:
            ellipsoid_normals(h, centre, tuple(r * 1.15 for r in radii), 0.7)
    REPORT["toon_normals"] = {"centre": [round(x, 3) for x in centre], "radii": [round(x, 3) for x in radii]}
    outline_mask(body, lambda v, p: 1.0)
    for h in hairs:
        if h.name in hair_outer:             # combed hair: outer lock layer 1, inner layer 0, cap 0.4
            oset, cset = hair_outer[h.name], hair_cap[h.name]
            outline_mask(h, lambda v, p, oset=oset, cset=cset: 1.0 if v.index in oset else
                         (0.4 if v.index in cset else 0.0))
        else:
            outline_mask(h, lambda v, p: 1.0)
    hc = Vector(C.joint_blender("head"))

    def face_line(v, p):
        if p.material_index == 1:
            return 0.0
        if abs(v.co.y) > 0.097 and v.co.x < 0.05:            # ears: a line on the rim only, none at the root
            return 0.25 + 0.75 * U.smoothstep(0.104, 0.115, abs(v.co.y))
        n = v.normal
        front = U.smoothstep(0.25, 0.65, n.x)                # faces the camera head-on: no inner line
        jaw = 1.0 - U.smoothstep(hc.z - 0.02, hc.z + 0.06, v.co.z)
        return max(0.0, min(1.0, (1.0 - front) * 0.9 + jaw * 0.6 * (1.0 - front)))
    outline_mask(face, face_line)
    REPORT["tris"] = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in [body, face] + hairs}
    REPORT["tris_total"] = sum(REPORT["tris"].values())
    U.write_json(os.path.join(cdir, "review", PHASE, "finish_report.json"), REPORT)
    # hilt proxies for sd_review --hilts (same layout as the v4 body report)
    U.write_json(os.path.join(cdir, "review", PHASE, "grip_report.json"),
                 {"grip": {"r": {"grip_centre_offset_from_contract_wrist_game": list(grips["N"])},
                           "l": {"grip_centre_offset_from_contract_wrist_game": list(grips["F"])}}})
    U.log("FINISH", json.dumps(REPORT))
    U.save(os.path.join(cdir, "%s_anime_master.blend" % cid))


if __name__ == "__main__":
    main()
