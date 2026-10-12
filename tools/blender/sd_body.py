"""BODY PHASE: an MPFB 2 human fitted to the Saber Duel contract skeleton (CHARACTER_PIPELINE.md sections 2-4).

  python tools/blender/run.py tools/blender/sd_body.py -- --char kael [--stage all|fit|finish]

stage "fit" (cached in art/characters/<id>/build/cache/<id>_fit.blend):
  1. MPFB human from sd_chars macros + length targets (anatomical joints land on the contract joints).
  2. Eyes (cornea shell removed), brows, lashes, hair as MPFB mhclo assets on the same game_engine rig.
  3. Fit pose: arms straight down, legs parallel, toes forward; applied as the new rest with dual-quaternion
     skinning plus a corrective smooth on the shoulders (the 50-degree A-pose drop does not collapse the deltoid).
  4. Forearm twist to the section 4 palm directions (right palm +X, left palm -X), distributed elbow->wrist
     like twist bones would.
stage "finish":
  5. palmOpen source pose (left): straight, slightly spread fingers, relaxed thumb, forearm supinated 180 deg.
  6. Fists: a grip cylinder (r = 0.0215, axis = game z) seated across the distal palm; the wrist rotates about that
     axis so the grip centre sits on the forearm axis (rest x = 0); each finger joint then closes, proximal to
     distal, until its own phalanx touches the cylinder; the thumb tip is placed by IK on the middle finger.
  7. Weights merged to the 17 contract groups (spine chain re-blended about the contract pivots), <= 4 influences.
  8. Everything rotated into the contract frame (faces +X); contract armature ARM-<id> (17 bones, all pointing +Z,
     roll 0, so every glTF joint rotation is identity); MPFB rig and helper geometry removed.
  9. Look-dev materials: MAT-skin (SSS, scalp darkened under the hair), MAT-eyes, MAT-hair (atlas of hair, brows,
     lashes; alpha MASK).
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
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sd_chars  # noqa: E402
import sd_contract as C  # noqa: E402
import sd_look  # noqa: E402
import sd_util as U  # noqa: E402

from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.locationservice import LocationService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402

PHASE = "03_body"
TAG = "phase:" + PHASE
DATA = LocationService.get_user_data()
SYS_DATA = LocationService.get_mpfb_data("")
FINGERS = ("index", "middle", "ring", "pinky")
GRIP_R = 0.0215                # target grip radius (contract 0.019-0.024)
GRIP_ALONG = 0.72              # hilt axis along wrist->middle knuckle: across the palm, proximal of the knuckles
# Clenched-grip flexion ratios (MCP, PIP, DIP, degrees at k = 1); the pinky curls hardest.
FIST_RATIO = {"index": (82, 95, 58), "middle": (86, 98, 60), "ring": (88, 98, 60), "pinky": (90, 95, 55)}
GRIP_FIRM = 0.012              # hilt channel radius of the clenched fist (pads compress 9.5 mm into the 21.5 mm grip)
REPORT = {}


# ------------------------------------------------------------------------------------------------ MPFB human
def find_target(name):
    root_dir = LocationService.get_mpfb_data("targets")
    for root, _, files in os.walk(root_dir):
        if name + ".target.gz" in files:
            return os.path.join(root, name + ".target.gz")
    raise FileNotFoundError(name)


def eval_points(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    eo = ob.evaluated_get(dg)
    me = eo.to_mesh()
    pts = [eo.matrix_world @ v.co for v in me.vertices]
    eo.to_mesh_clear()
    return pts


def make_human(cfg):
    macro = TargetService.get_default_macro_info_dict()
    mac = json.loads(json.dumps(cfg["macro"]))
    race = mac.pop("race", None)
    macro.update(mac)
    if race:
        macro["race"] = race
    body = HumanService.create_human(macro_detail_dict=macro, feet_on_ground=False, scale=0.1)
    for t, w in cfg["targets"].items():
        TargetService.load_target(body, find_target(t), weight=w)
    lo = min(p.z for p in eval_points(body))
    body.data.transform(Matrix.Translation((0, 0, -lo)), shape_keys=True)
    body.data.update()
    rig = HumanService.add_builtin_rig(body, "game_engine", import_weights=True)
    return body, rig


def add_asset(body, kind, name):
    folder = os.path.join(DATA, kind, name)
    mhclo = [f for f in os.listdir(folder) if f.endswith(".mhclo")][0]
    asset_type = {"eyes": "Eyes", "eyebrows": "Eyebrows", "eyelashes": "Eyelashes", "hair": "Hair"}[kind]
    U.set_active(body)
    return HumanService.add_mhclo_asset(os.path.join(folder, mhclo), body, asset_type=asset_type, subdiv_levels=0)


def strip_cornea(eyes, texture_path):
    """The MPFB high-poly eyes carry a cornea shell whose UVs sit in the texture's transparent corner; rendered
    opaque it turns the eye black. Delete faces whose UV centroid samples alpha < 0.5."""
    img = bpy.data.images.load(texture_path, check_existing=True)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    alpha = px.reshape(h, w, 4)[..., 3]
    uv = eyes.data.uv_layers.active.data
    bm = bmesh.new()
    bm.from_mesh(eyes.data)
    bm.faces.ensure_lookup_table()
    kill = []
    for poly in eyes.data.polygons:
        us = [uv[i].uv for i in poly.loop_indices]
        cu = sum(u.x for u in us) / len(us)
        cv = sum(u.y for u in us) / len(us)
        a = alpha[min(h - 1, max(0, int(cv * h))), min(w - 1, max(0, int(cu * w)))]
        if a < 0.5:
            kill.append(bm.faces[poly.index])
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(eyes.data)
    bm.free()
    eyes.data.update()
    return len(kill)


# ------------------------------------------------------------------------------------------------ posing
def wpose(rig, name):
    return rig.matrix_world @ rig.pose.bones[name].matrix


def set_wpose(rig, name, Mw):
    rig.pose.bones[name].matrix = rig.matrix_world.inverted() @ Mw
    bpy.context.view_layer.update()


def aim(rig, name, target_w=None, direction=None):
    """Swing a pose bone (minimal rotation, no added twist) to point at target_w or along direction."""
    bpy.context.view_layer.update()
    Mw = wpose(rig, name)
    head = Mw.translation.copy()
    R = Mw.to_3x3().normalized()
    cur = (R @ Vector((0, 1, 0))).normalized()
    want = (target_w - head).normalized() if direction is None else direction.normalized()
    q = cur.rotation_difference(want)
    set_wpose(rig, name, Matrix.Translation(head) @ (q.to_matrix() @ R).to_4x4())


def rotate_pose(rig, name, axis_w, angle, pivot_w=None):
    bpy.context.view_layer.update()
    Mw = wpose(rig, name)
    p = pivot_w if pivot_w is not None else Mw.translation.copy()
    set_wpose(rig, name, U.rot_about_line(p, axis_w, angle) @ Mw)


def reset_pose(rig, names=None):
    for pb in rig.pose.bones:
        if names and pb.name not in names:
            continue
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def rest_head(rig, name):
    return rig.matrix_world @ rig.data.bones[name].head_local


def fit_pose(rig):
    """Arms hang straight down onto the contract shoulder/elbow/wrist, legs parallel onto hip/knee/ankle."""
    J = lambda n: Vector(C.joint_mpfb(n))  # noqa: E731
    reset_pose(rig)
    foot_dirs = {s: (wpose(rig, "foot_" + s).to_3x3() @ Vector((0, 1, 0))).normalized() for s in ("r", "l")}
    for side, s in (("r", "N"), ("l", "F")):
        aim(rig, "upperarm_" + side, J("fore" + s))
        aim(rig, "lowerarm_" + side, J("hand" + s))
        aim(rig, "hand_" + side, direction=(J("hand" + s) - J("fore" + s)))
        aim(rig, "thigh_" + side, J("shin" + s))
        aim(rig, "calf_" + side, J("foot" + s))
        d0 = foot_dirs[side]       # toes straight forward (-Y in the MPFB frame), same pitch as MPFB's foot
        h = math.hypot(d0.x, d0.y)
        aim(rig, "foot_" + side, direction=Vector((0.0, -h, d0.z)))
    rep = {}
    for side, s in (("r", "N"), ("l", "F")):
        for mb, cj in (("upperarm", "upper"), ("lowerarm", "fore"), ("hand", "hand"), ("thigh", "thigh"),
                       ("calf", "shin"), ("foot", "foot")):
            got = wpose(rig, mb + "_" + side).translation
            rep["%s_%s" % (mb, side)] = {"mpfb_joint": [round(c, 4) for c in got],
                                         "contract": [round(c, 4) for c in J(cj + s)],
                                         "err_m": round((got - J(cj + s)).length, 4)}
    REPORT["fit_pose"] = rep


def shoulder_smooth_group(body):
    name = "_sd_shoulder_smooth"
    vg = body.vertex_groups.get(name) or body.vertex_groups.new(name=name)
    ua = {}
    for side in ("r", "l"):
        for grp in ("upperarm_" + side, "clavicle_" + side):
            for k, w in U.group_weights(body, [grp]).items():
                ua[k] = max(ua.get(k, 0.0), w)
    for k, w in ua.items():
        vg.add([k], 1.0 - abs(2.0 * min(w, 1.0) - 1.0) * 0.6, "REPLACE")
    return name


def apply_pose_as_rest(rig, meshes, dqs=True, smooth=None):
    """Bake the current pose into the meshes and the armature rest. smooth: {object name: (group, iterations)}."""
    bpy.context.view_layer.update()
    for ob in meshes:
        arm_mods = [m for m in ob.modifiers if m.type == "ARMATURE"]
        for m in arm_mods:
            m.use_deform_preserve_volume = dqs
        cs = None
        if smooth and ob.name in smooth:
            grp, iters = smooth[ob.name]
            cs = ob.modifiers.new("_sd_fit_smooth", "CORRECTIVE_SMOOTH")
            cs.rest_source = "ORCO"
            cs.smooth_type = "LENGTH_WEIGHTED"
            cs.iterations = iters
            cs.factor = 0.5
            cs.vertex_group = grp
        co = U.evaluated_coords(ob)
        if cs:
            ob.modifiers.remove(cs)
        U.write_coords(ob, co)
        for m in arm_mods:
            m.use_deform_preserve_volume = False
    U.set_active(rig)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    reset_pose(rig)


# ------------------------------------------------------------------------------------------------ hands
def hand_frame(rig, side, posed=False):
    """World wrist W, middle knuckle M, hand axis a, palm normal n, elbow E."""
    get = (lambda n: wpose(rig, n).translation.copy()) if posed else (lambda n: rest_head(rig, n))
    W, M = get("hand_" + side), get("middle_01_" + side)
    I, P = get("index_01_" + side), get("pinky_01_" + side)
    a = (M - W).normalized()
    n = (I - P).cross(a).normalized()
    if side == "l":
        n = -n
    return W, M, a, n, get("lowerarm_" + side)


def signed_angle(v_from, v_to, axis):
    a = v_from - axis * v_from.dot(axis)
    b = v_to - axis * v_to.dot(axis)
    return math.atan2(a.cross(b).dot(axis), a.dot(b))


PRONO = {"r": (Vector((1, 0, 0)), -1.0), "l": (Vector((-1, 0, 0)), 1.0)}   # neutral palm (medial), supination sense


def pronation_angle(rig, side):
    """0 = neutral (palm medial), +90 = supinated (palm forward), -90 = pronated (palm back)."""
    W, M, a, n, E = hand_frame(rig, side)
    neutral, sigma = PRONO[side]
    return sigma * signed_angle(neutral, n, (E - W).normalized())


def finger_bones(side):
    return ["%s_0%d_%s" % (f, i, side) for f in ("thumb",) + FINGERS for i in (1, 2, 3)]


def twist_coords(ob, rig, side, angle, coords, t0=0.0, t1=1.0):
    """Rotate forearm/hand vertices about the forearm axis: 0 at t0 (elbow = 0) rising smoothly to angle at t1
    (wrist = 1) and beyond, scaled by the vertex's forearm+hand weight (twist-bone style distribution)."""
    E = rest_head(rig, "lowerarm_" + side)
    Wr = rest_head(rig, "hand_" + side)
    L = (Wr - E).length
    down = (Wr - E).normalized()
    wts = U.group_weights(ob, ["lowerarm_" + side, "hand_" + side] + finger_bones(side))
    bones = {g.index for g in ob.vertex_groups if g.name in {b.name for b in rig.data.bones}}
    mw = ob.matrix_world
    inv = mw.inverted()
    out = list(coords)
    for i, w in wts.items():
        tot = sum(g.weight for g in ob.data.vertices[i].groups if g.group in bones) or 1.0
        share = min(1.0, w / tot)                  # MPFB weights are not normalised: use the share
        p = mw @ coords[i]
        t = (p - E).dot(down) / L
        f = 1.0 if t >= 0.98 else U.smoothstep(t0, t1, t) * share   # the hand turns rigidly past the wrist
        if f > 0:
            out[i] = inv @ (E + Matrix.Rotation(angle * f, 4, -down) @ (p - E))
    return out


def twist_bones(rig, side, angle):
    E = rest_head(rig, "lowerarm_" + side)
    Wr = rest_head(rig, "hand_" + side)
    Rw = U.rot_about_line(E, (E - Wr).normalized(), angle)
    Ra = rig.matrix_world.inverted() @ Rw @ rig.matrix_world
    U.set_active(rig)
    bpy.ops.object.mode_set(mode="EDIT")
    for name in ["hand_" + side] + finger_bones(side):
        eb = rig.data.edit_bones[name]
        eb.matrix = Ra @ eb.matrix
    bpy.ops.object.mode_set(mode="OBJECT")


def palm_twist(body, rig, targets):
    co = [v.co.copy() for v in body.data.vertices]
    rep = {}
    for side, p_t in targets.items():
        p = math.degrees(pronation_angle(rig, side))
        ang = math.radians(PRONO[side][1] * (p_t - p))
        co = twist_coords(body, rig, side, ang, co)
        twist_bones(rig, side, ang)
        rep[side] = {"before_deg": round(p, 1), "target_deg": p_t, "twist_deg": round(math.degrees(ang), 1),
                     "after_deg": round(math.degrees(pronation_angle(rig, side)), 1)}
    U.write_coords(body, co)
    REPORT["forearm_twist"] = rep


def bone_vertex_set(ob, bone_names, thresh=0.35):
    idx = {ob.vertex_groups[n].index for n in bone_names if n in ob.vertex_groups}
    return [v.index for v in ob.data.vertices if sum(g.weight for g in v.groups if g.group in idx) >= thresh]


def world_coords(ob):
    return U.evaluated_coords(ob, disable_types=(), world=True)


def dist_to_axis(p, c, u):
    d = p - c
    return (d - u * d.dot(u)).length


def thumb_ik(rig, side, target, n, a):
    """Thumb metacarpal swung in front of the palm (opposition), then a 2-bone IK puts the thumb tip on target."""
    t1, t2, t3 = ["thumb_0%d_%s" % (j, side) for j in (1, 2, 3)]
    reset_pose(rig, [t1, t2, t3])
    base = wpose(rig, t1).copy()
    h0 = base.translation.copy()
    best = None
    for sgn in (1.0, -1.0):
        set_wpose(rig, t1, U.rot_about_line(h0, a, math.radians(sgn * 35.0)) @ base)
        val = (wpose(rig, t3).translation - h0).dot(n)
        if best is None or val > best[0]:
            best = (val, sgn)
    set_wpose(rig, t1, U.rot_about_line(h0, a, math.radians(best[1] * 35.0)) @ base)
    emp = bpy.data.objects.new("_sd_thumb_target", None)
    bpy.context.scene.collection.objects.link(emp)
    emp.location = target
    pb = rig.pose.bones[t3]
    con = pb.constraints.new("IK")
    con.target = emp
    con.chain_count = 2
    con.use_tail = True
    bpy.context.view_layer.update()
    mats = {nm: rig.pose.bones[nm].matrix.copy() for nm in (t2, t3)}
    pb.constraints.remove(con)
    bpy.data.objects.remove(emp, do_unlink=True)
    for nm in (t2, t3):
        rig.pose.bones[nm].matrix = mats[nm]
        bpy.context.view_layer.update()
    tip = rig.matrix_world @ rig.pose.bones[t3].tail
    return (tip - target).length, best[1] * 35.0


def ring_hole(body, rig, side, u, guess):
    """The channel a straight hilt (axis u = game z) can pass through: project the palm, finger and thumb skin of
    the fist band (index..pinky along u) onto the plane normal to u and take the largest empty circle inside the
    section's convex hull whose centre is outside the hand mesh. Returns (centre, radius)."""
    from mathutils.geometry import convex_hull_2d
    cw = world_coords(body)
    hv = set(bone_vertex_set(body, ["hand_" + side] + ["%s_0%d_%s" % (f, j, side) for f in FINGERS
                                                        for j in (1, 2, 3)], 0.2))
    polys = [tuple(pl.vertices) for pl in body.data.polygons if all(i in hv for i in pl.vertices)]
    bvh = BVHTree.FromPolygons([tuple(p) for p in cw], polys)
    lo, hi = sorted((wpose(rig, "index_01_" + side).translation.dot(u), wpose(rig, "pinky_01_" + side).translation.dot(u)))
    um = 0.5 * (lo + hi)
    e1 = Vector((0, 1, 0))
    e1 = (e1 - u * e1.dot(u)).normalized()
    e2 = u.cross(e1)
    P = [(cw[i].dot(e1), cw[i].dot(e2)) for i in hv if lo - 0.004 < cw[i].dot(u) < hi + 0.004]
    pts = np.array(P)
    hull = np.array([P[i] for i in convex_hull_2d(P)])

    def inside_hull(c):
        x, y = c
        inside = False
        n = len(hull)
        for k in range(n):
            x1, y1 = hull[k]
            x2, y2 = hull[(k + 1) % n]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                inside = not inside
        return inside

    def outside_mesh(c):
        c3 = e1 * float(c[0]) + e2 * float(c[1]) + u * um
        loc, nrm, _, _ = bvh.find_nearest(c3)
        return loc is None or (c3 - loc).dot(nrm) > 0
    best = (None, -1.0)
    g = np.array([guess.dot(e1), guess.dot(e2)])
    for step, span in ((0.002, 0.07), (0.0004, 0.004)):
        c0 = g if best[0] is None else best[0]
        rng = np.arange(-span, span + 1e-9, step)
        for dx in rng:
            for dy in rng:
                c = c0 + np.array([dx, dy])
                r = float(np.hypot(pts[:, 0] - c[0], pts[:, 1] - c[1]).min())
                if r <= best[1] or not inside_hull(c) or not outside_mesh(c):
                    continue
                best = (c, r)
    if best[0] is None:
        return None, 0.0
    c = best[0]
    return e1 * float(c[0]) + e2 * float(c[1]) + u * um, best[1]


def make_fist(body, rig, side, report):
    """Clenched power grip. The fingers curl with MCP-heavy anatomical ratios (FIST_RATIO), one scale k solved so
    the hilt channel through the fist (largest empty circle in the fist section along game z, ring_hole) has
    radius GRIP_FIRM: the pads and palm compress GRIP_R - GRIP_FIRM into a GRIP_R hilt, which reads as gripped
    hard. The thumb tip goes by IK onto the outside of the index/middle middle phalanges (wrapped over them);
    the wrist then rotates about the grip axis so the channel centre sits on the forearm axis (rest x = 0)."""
    W, M, a, n, E = hand_frame(rig, side)
    fdir = (W - E).normalized()
    u = Vector((1, 0, 0))
    hand_len = (M - W).length
    names_all = ["%s_0%d_%s" % (f, j, side) for f in FINGERS for j in (1, 2, 3)]
    fr = {}
    for f in FINGERS:
        names = ["%s_0%d_%s" % (f, j, side) for j in (1, 2, 3)]
        d0 = (wpose(rig, names[0]).to_3x3() @ Vector((0, 1, 0))).normalized()
        axis = d0.cross(n).normalized()
        rest_curl, prev = [], a
        for nm in names:
            d = (wpose(rig, nm).to_3x3() @ Vector((0, 1, 0))).normalized()
            rest_curl.append(signed_angle(prev, d, axis))
            prev = d
        fr[f] = (names, axis, rest_curl)

    def pose_k(k):
        reset_pose(rig, names_all)
        for f in FINGERS:
            names, axis, rest_curl = fr[f]
            for j, nm in enumerate(names):
                rotate_pose(rig, nm, axis, math.radians(k * FIST_RATIO[f][j]) - rest_curl[j])
    guess = W + a * (0.85 * hand_len) + n * 0.04
    lo_k, hi_k = 0.55, 1.15
    c, r = None, 1.0
    for _ in range(10):
        k = 0.5 * (lo_k + hi_k)
        pose_k(k)
        c_, r = ring_hole(body, rig, side, u, guess)
        if c_ is not None:
            c, guess = c_, c_
        if c_ is None or r > GRIP_FIRM:
            lo_k = k
        else:
            hi_k = k
    k = 0.5 * (lo_k + hi_k)
    pose_k(k)
    c, r = ring_hole(body, rig, side, u, guess)
    report["finger_curl_scale"] = round(k, 3)
    report["finger_angles_deg"] = {f: [round(k * x, 1) for x in FIST_RATIO[f]] for f in FINGERS}
    report["channel_radius_m"] = round(r, 4)
    # thumb over the index and middle fingers
    _, _, a2, n2, _ = hand_frame(rig, side, posed=True)
    m2 = (wpose(rig, "middle_02_" + side).translation + rig.matrix_world @ rig.pose.bones["middle_02_" + side].tail) * 0.5
    i2 = (wpose(rig, "index_02_" + side).translation + rig.matrix_world @ rig.pose.bones["index_02_" + side].tail) * 0.5
    out = (m2 + i2) * 0.5 - c
    out = (out - u * out.dot(u)).normalized()
    miss, opp = thumb_ik(rig, side, (m2 * 0.55 + i2 * 0.45) + out * 0.013, n2, a2)
    report["thumb_ik_miss_m"] = round(miss, 4)
    report["thumb_opposition_deg"] = opp
    # wrist about the grip axis: channel centre onto the forearm axis
    phi = signed_angle(fdir, c - W, u)
    rotate_pose(rig, "hand_" + side, u, -phi, pivot_w=W)
    Cg = U.rot_about_line(W, u, -phi) @ c
    c2, r2 = ring_hole(body, rig, side, u, Cg)
    Cg = c2 if c2 is not None else Cg
    report["wrist_rotation_deg"] = round(math.degrees(-phi), 1)
    report["hole_radius_m"] = round(r2, 4)
    report["pad_compression_m"] = round(GRIP_R - r2, 4)
    cw = world_coords(body)
    palm_v = bone_vertex_set(body, ["hand_" + side, "thumb_01_" + side], 0.7)
    from mathutils import kdtree
    kd = kdtree.KDTree(len(palm_v))
    for kk, i in enumerate(palm_v):
        kd.insert(cw[i], kk)
    kd.balance()
    report["fingertip_to_palm_m"] = {f: round(kd.find(rig.matrix_world @ rig.pose.bones["%s_03_%s" % (f, side)].tail)[2], 4)
                                     for f in FINGERS}
    report["grip_centre_mpfb"] = [round(x, 4) for x in Cg]
    report["grip_drop_below_wrist_m"] = round((Cg - W).dot(fdir), 4)
    return Cg, r2


def open_hand_pose(rig, side, spread_deg=(6.0, 0.0, 6.0, 11.0), curl_keep=0.12):
    """Straighten the fingers (keep a little natural curl), spread them a few degrees, relax the thumb."""
    W, M, a, n, E = hand_frame(rig, side)
    Mm = rest_head(rig, "middle_01_" + side)
    flex_axis = a.cross(n).normalized()
    for f, spread in zip(FINGERS, spread_deg):
        names = ["%s_0%d_%s" % (f, j, side) for j in (1, 2, 3)]
        for name in names:
            d = (wpose(rig, name).to_3x3() @ Vector((0, 1, 0))).normalized()
            rotate_pose(rig, name, flex_axis, -signed_angle(a, d, flex_axis) * (1.0 - curl_keep))
        if spread:
            away = rest_head(rig, names[0]) - Mm
            away = away - a * away.dot(a)
            for sgn in (1.0, -1.0):
                d = wpose(rig, names[0]).to_3x3() @ Vector((0, 1, 0))
                test = Matrix.Rotation(math.radians(sgn * spread), 3, n) @ d
                if away.length < 1e-4 or test.dot(away.normalized()) > 0:
                    rotate_pose(rig, names[0], n, math.radians(sgn * spread))
                    break
    t1 = "thumb_01_" + side
    d = (wpose(rig, t1).to_3x3() @ Vector((0, 1, 0))).normalized()
    out = rest_head(rig, "thumb_02_" + side) - rest_head(rig, "index_01_" + side)
    rotate_pose(rig, t1, d.cross(out).normalized() if out.length > 1e-4 else n, math.radians(10.0))


# ------------------------------------------------------------------------------------------------ weights
def merge_weights(ob):
    names = {vg.index: vg.name for vg in ob.vertex_groups}
    per_vertex = []
    for v in ob.data.vertices:
        acc = {}
        for g in v.groups:
            c = C.mpfb_to_contract(names.get(g.group, ""))
            if c and g.weight > 0:
                acc[c] = acc.get(c, 0.0) + g.weight
        per_vertex.append(acc)
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    for j in C.CORE:
        ob.vertex_groups.new(name=j)
    return per_vertex


def reblend_torso(body, per_vertex):
    """Re-distribute the torso share (hips+spine+chest+neck) about the contract pivots by height, keeping MPFB's
    split between torso, head and limbs. World z is the height, |x| the lateral offset (MPFB frame)."""
    mw = body.matrix_world
    z_sp, z_ch, z_nk = (C.JOINTS[j][1][1] for j in ("spine", "chest", "neck"))
    for v, acc in zip(body.data.vertices, per_vertex):
        R = sum(acc.get(k, 0.0) for k in ("hips", "spine", "chest", "neck"))
        if R <= 0:
            continue
        p = mw @ v.co
        f_nk = U.smoothstep(z_nk - 0.045, z_nk + 0.035, p.z) * (1.0 - U.smoothstep(0.075, 0.12, abs(p.x)))
        f_ch = U.smoothstep(z_ch - 0.08, z_ch + 0.07, p.z)
        f_sp = U.smoothstep(z_sp - 0.07, z_sp + 0.07, p.z)
        neck = R * f_nk
        chest = (R - neck) * f_ch
        rem = R - neck - chest
        spine = rem * f_sp
        acc.update({"hips": rem - spine, "spine": spine, "chest": chest, "neck": neck})


def finalize_weights(ob, per_vertex, fallback="head", max_inf=4, min_w=0.01):
    groups = {vg.name: vg for vg in ob.vertex_groups}
    stats = {"unweighted_fixed": 0, "trimmed_to_4": 0}
    for v, acc in zip(ob.data.vertices, per_vertex):
        items = sorted(((k, w) for k, w in acc.items() if w > 0), key=lambda kv: -kv[1])
        if len(items) > max_inf:
            stats["trimmed_to_4"] += 1
        items = [(k, w) for k, w in items[:max_inf] if w >= min_w]
        if not items:
            items = [(fallback, 1.0)]
            stats["unweighted_fixed"] += 1
        tot = sum(w for _, w in items)
        for k, w in items:
            groups[k].add([v.index], w / tot, "REPLACE")
    return stats


# ------------------------------------------------------------------------------------------------ contract rig
def build_contract_armature(name):
    arm_data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, arm_data)
    U.col("RIG_DEF").objects.link(arm)
    arm["owner"] = TAG
    arm_data.display_type = "STICK"
    U.set_active(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    lengths = {"hips": 0.10, "spine": 0.26, "chest": 0.25, "neck": 0.10, "head": 0.22}
    for j in C.CORE:
        eb = arm_data.edit_bones.new(j)
        h = Vector(C.joint_blender(j))
        eb.head = h
        eb.tail = h + Vector((0, 0, lengths.get(j, 0.08)))
        eb.roll = 0.0
    for j in C.CORE:
        parent = C.JOINTS[j][0]
        if parent:
            arm_data.edit_bones[j].parent = arm_data.edit_bones[parent]
            arm_data.edit_bones[j].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    want = Matrix.Rotation(math.radians(90), 3, "X")   # local Y = +Z, local X = +X -> glTF identity rotation
    worst = 0.0
    for b in arm_data.bones:
        R = b.matrix_local.to_3x3()
        worst = max(worst, max(abs(R[r][c] - want[r][c]) for r in range(3) for c in range(3)))
    REPORT["armature_rest_axis_error"] = round(worst, 6)
    return arm


# ------------------------------------------------------------------------------------------------ helpers
def delete_helpers(body):
    gi = body.vertex_groups["body"].index
    bm = bmesh.new()
    bm.from_mesh(body.data)
    dl = bm.verts.layers.deform.active
    kill = [v for v in bm.verts if v[dl].get(gi, 0.0) < 0.5]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(body.data)
    bm.free()
    for m in list(body.modifiers):
        if m.type == "MASK":
            body.modifiers.remove(m)
    body.data.update()
    return len(kill)


def scalp_attribute(body, hair, reach=0.035, feather_iters=6):
    """Float attribute sd_scalp = 1 on skin that hair cards cover (a ray along the skin normal hits the hair within
    reach), feathered over a few rings of neighbours, so the bake paints the scalp in the hair colour and sparse
    cards never show bare skin, while the forehead below the hairline stays skin."""
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(hair, dg)
    me = body.data
    mw = body.matrix_world
    hinv = hair.matrix_world.inverted()
    n3 = mw.to_3x3()
    vals = [0.0] * len(me.vertices)
    for v in me.vertices:
        p = mw @ v.co
        if p.z < 1.55:
            continue
        o = hinv @ p
        d = (hinv.to_3x3() @ (n3 @ v.normal)).normalized()
        hit = bvh.ray_cast(o, d, reach)
        if hit[0] is not None:
            vals[v.index] = 1.0
    nbr = [[] for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices
        nbr[a].append(b)
        nbr[b].append(a)
    for _ in range(feather_iters):
        vals = [max(0.0, min(1.0, 0.5 * x + 0.5 * (sum(vals[j] for j in nb) / len(nb) if nb else x)))
                for x, nb in zip(vals, nbr)]
    attr = me.attributes.get("sd_scalp") or me.attributes.new("sd_scalp", "FLOAT", "POINT")
    attr.data.foreach_set("value", vals)
    return sum(1 for x in vals if x > 0.5)


def red_attribute(body, knuckles):
    """sd_red: warm flush on the nose tip and alae and on the finger knuckles (ears come from the MPFB UV mask)."""
    from mathutils import kdtree
    me = body.data
    head = [v for v in me.vertices if v.co.z > 1.72 and abs(v.co.y) < 0.03]
    tip = max(head, key=lambda v: v.co.x).co.copy()
    kd = kdtree.KDTree(len(knuckles))
    for i, k in enumerate(knuckles):
        kd.insert(k, i)
    kd.balance()
    vals = []
    for v in me.vertices:
        rn = 1.0 - U.smoothstep(0.010, 0.032, (v.co - tip).length)
        rk = 0.8 * (1.0 - U.smoothstep(0.009, 0.024, kd.find(v.co)[2]))
        vals.append(max(rn, rk))
    a = me.attributes.get("sd_red") or me.attributes.new("sd_red", "FLOAT", "POINT")
    a.data.foreach_set("value", vals)
    return sum(1 for x in vals if x > 0.3)


def drop_stray_weights(ob, rig, max_dist=0.30):
    """MPFB weights contain a few strays (e.g. a body vertex weighted 0.96 to index_01_r half a metre from the
    hand), which turn into spikes as soon as that bone moves. Drop every weight to a bone whose segment is more
    than max_dist from the vertex at rest; vertices left with nothing keep their nearest bone."""
    segs = {b.name: (rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local) for b in rig.data.bones}
    gname = {g.index: g.name for g in ob.vertex_groups}
    co = U.evaluated_coords(ob, world=True)       # shaped (targets applied), rest pose; not the base-mesh basis

    def dseg(p, a, b):
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
        return (a + ab * t - p).length
    dropped = 0
    for v in ob.data.vertices:
        p = co[v.index]
        bonew = [(gname[g.group], g.weight) for g in v.groups if gname.get(g.group) in segs and g.weight > 0]
        far = [n for n, w in bonew if dseg(p, *segs[n]) > max_dist]
        if far and len(far) < len(bonew):
            for n in far:
                ob.vertex_groups[n].remove([v.index])
                dropped += 1
        elif far:                                   # every weight is a stray: bind to the nearest bone
            near = min(segs, key=lambda n: dseg(p, *segs[n]))
            for n in far:
                ob.vertex_groups[n].remove([v.index])
                dropped += 1
            (ob.vertex_groups.get(near) or ob.vertex_groups.new(name=near)).add([v.index], 1.0, "REPLACE")
    return dropped


def measure_landmarks(body, rig):
    co = eval_points(body)
    crotch = min(p.z for p in co if abs(p.x) < 0.012 and 0.6 < p.z < 1.2)
    J = {n: rest_head(rig, n) for n in ("upperarm_r", "lowerarm_r", "hand_r", "thigh_r", "calf_r", "foot_r", "neck_01", "head")}
    return {"top": round(max(p.z for p in co), 4), "crotch": round(crotch, 4), "hip_est_crotch_plus_0.065": round(crotch + 0.065, 4),
            **{k + "_head": [round(c, 4) for c in v] for k, v in J.items()}}


def tagged(part):
    return next(o for o in bpy.data.objects if o.get("sd_part") == part)


# ------------------------------------------------------------------------------------------------ stages
def stage_fit(cfg, cache):
    bpy.ops.wm.read_homefile(use_empty=True)
    body, rig = make_human(cfg)
    parts = {"eyes": add_asset(body, "eyes", "high-poly"), "brows": add_asset(body, "eyebrows", cfg["brows"]),
             "lashes": add_asset(body, "eyelashes", cfg["lashes"]), "hair": add_asset(body, "hair", cfg["hair"])}
    REPORT["cornea_faces_removed"] = strip_cornea(parts["eyes"], os.path.join(DATA, "eyes", "materials", cfg["eyes"] + "_eye.png"))
    REPORT["stray_weights_dropped"] = {o.name: drop_stray_weights(o, rig) for o in [body] + list(parts.values())}
    REPORT["landmarks_mpfb"] = measure_landmarks(body, rig)
    TargetService.bake_targets(body)
    if body.data.shape_keys:
        body.shape_key_clear()
    meshes = [body] + list(parts.values())
    fit_pose(rig)
    grp = shoulder_smooth_group(body)
    apply_pose_as_rest(rig, meshes, dqs=True, smooth={body.name: (grp, 12)})
    body.vertex_groups.remove(body.vertex_groups[grp])
    REPORT["helper_verts_deleted"] = delete_helpers(body)
    # re-ground: the leg swing can push a heel a few mm through the floor
    lo = min(p.z for p in eval_points(body))
    for ob in meshes:
        ob.data.transform(Matrix.Translation((0, 0, -lo)))
    U.set_active(rig)
    bpy.ops.object.mode_set(mode="EDIT")
    for eb in rig.data.edit_bones:
        eb.head.z -= lo
        eb.tail.z -= lo
    bpy.ops.object.mode_set(mode="OBJECT")
    REPORT["reground_m"] = round(-lo, 4)
    palm_twist(body, rig, {"r": 90.0, "l": -90.0})
    body["sd_part"], rig["sd_part"] = "body", "rig"
    for k, ob in parts.items():
        ob["sd_part"] = k
    U.save(cache)


def stage_finish(cfg, cache, master, char_id):
    bpy.ops.wm.open_mainfile(filepath=cache)
    body, rig = tagged("body"), tagged("rig")
    parts = {k: tagged(k) for k in ("eyes", "brows", "lashes", "hair")}
    meshes = [body] + list(parts.values())

    # palmOpen source (left): open hand from the twisted rest, then supinate 180 deg -> palm +X, fingers down
    reset_pose(rig)
    open_hand_pose(rig, "l")
    co_open = U.evaluated_coords(body)
    reset_pose(rig)
    co_open = twist_coords(body, rig, "l", math.radians(PRONO["l"][1] * 180.0), co_open, t0=0.30, t1=1.0)
    left_region = U.group_weights(body, ["lowerarm_l", "hand_l"] + finger_bones("l"))
    # check: palm direction of the palmOpen shape (pronation angle of its knuckle frame, +90 = palm forward)
    rest_co = [v.co.copy() for v in body.data.vertices]
    near = {}
    for bn in ("hand_l", "index_01_l", "pinky_01_l", "middle_01_l", "lowerarm_l"):
        h = rest_head(rig, bn)
        near[bn] = min(left_region, key=lambda i: (body.matrix_world @ rest_co[i] - h).length)

    def prono_of(co):
        P = {k: body.matrix_world @ co[i] for k, i in near.items()}
        a_ = (P["middle_01_l"] - P["hand_l"]).normalized()
        n_ = -(P["index_01_l"] - P["pinky_01_l"]).cross(a_).normalized()
        return round(math.degrees(PRONO["l"][1] * signed_angle(PRONO["l"][0], n_, (P["lowerarm_l"] - P["hand_l"]).normalized())), 1)
    REPORT["palmOpen_check"] = {"rest_pronation_deg": prono_of(rest_co), "palmOpen_pronation_deg": prono_of(co_open)}

    grip = {}
    for side, s in (("r", "N"), ("l", "F")):
        rep = {}
        c2, r2 = make_fist(body, rig, side, rep)
        cb = Vector(C.mpfb_to_blender(c2))
        d = cb - Vector(C.joint_blender("hand" + s))
        rep["grip_centre_offset_from_contract_wrist_game"] = [round(d.x, 4), round(d.z, 4), round(-d.y, 4)]
        grip[side] = rep
    REPORT["grip"] = grip
    apply_pose_as_rest(rig, [body], dqs=True)

    body.shape_key_add(name="Basis", from_mix=False)
    sk = body.shape_key_add(name="palmOpen", from_mix=False)
    moved = 0
    for i in left_region:
        if (co_open[i] - sk.data[i].co).length > 1e-5:
            sk.data[i].co = co_open[i]
            moved += 1
    sk.value = 0.0
    REPORT["palmOpen_vertices"] = moved

    stats = {}
    pv = merge_weights(body)
    reblend_torso(body, pv)
    stats["body"] = finalize_weights(body, pv, fallback="hips")
    for key, ob in parts.items():
        stats[key] = finalize_weights(ob, merge_weights(ob), fallback="head")
    REPORT["weights"] = stats

    knuckles = [rig.matrix_world @ rig.pose.bones["%s_0%d_%s" % (f, j, sd)].head for sd in ("r", "l")
                for f in FINGERS for j in (1, 2)]
    Rz = Matrix.Rotation(math.radians(90.0), 4, "Z")
    knuckles = [Rz @ k for k in knuckles]
    for ob in meshes:
        mw = ob.matrix_world.copy()
        ob.parent = None
        ob.data.transform(Rz @ mw, shape_keys=True)
        ob.matrix_world = Matrix.Identity(4)
        for m in list(ob.modifiers):
            ob.modifiers.remove(m)
    U.remove_object(rig)

    # into the master: replace what this phase owned before
    tmp = os.path.join(os.path.dirname(cache), "_finish_tmp.blend")
    for ob in meshes:
        ob["sd_tmp"] = True
    bpy.data.libraries.write(tmp, set(meshes), fake_user=True)
    bpy.ops.wm.open_mainfile(filepath=master)
    U.clear_owned(TAG)
    U.purge_orphans()
    with bpy.data.libraries.load(tmp, link=False) as (src, dst):
        dst.objects = list(src.objects)
    os.remove(tmp)
    loaded = {o.get("sd_part"): o for o in dst.objects}
    body = loaded["body"]
    parts = {k: loaded[k] for k in ("eyes", "brows", "lashes", "hair")}
    meshes = [body] + list(parts.values())
    arm = build_contract_armature("ARM-" + char_id)
    for key, ob in [("body", body)] + list(parts.items()):
        ob.name = ob.data.name = "GEO-%s_%s" % (char_id, key)
        ob["owner"] = TAG
        if "sd_tmp" in ob:
            del ob["sd_tmp"]
        U.col("LOW").objects.link(ob)
        ob.parent = arm
        mod = ob.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
        ob.data.use_fake_user = False
        ob.use_fake_user = False

    REPORT["scalp_verts"] = scalp_attribute(body, parts["hair"])
    REPORT["red_verts"] = red_attribute(body, knuckles)
    mats = C.material_names(char_id)
    skin_dir = os.path.join(DATA, "skins", cfg["skin"])
    diffuse = os.path.join(skin_dir, [f for f in os.listdir(skin_dir) if f.endswith(".png")][0])
    skin = sd_look.skin_material(mats["skin"], diffuse, cfg["skin_hex"], masks_dir=os.path.join(SYS_DATA, "textures"),
                                 mix_to_target=cfg.get("skin_mix", 1.0), scalp_hex=cfg["hair_hex"])
    body.data.materials.clear()
    body.data.materials.append(skin)
    eye_tex = os.path.join(DATA, "eyes", "materials", cfg["eyes"] + "_eye.png")
    if cfg.get("eyes_mix"):
        eye_tex = sd_look.eye_texture(os.path.join(DATA, "eyes", "materials"), cfg["eyes_mix"],
                                      cfg.get("sclera_tint", (1, 1, 1)),
                                      os.path.join(U.char_dir(char_id), "textures", "src", "eyes_%s.png" % char_id))
    eyes = sd_look.eye_material(mats["eyes"], eye_tex)
    parts["eyes"].data.materials.clear()
    parts["eyes"].data.materials.append(eyes)

    def tex_of(kind, name):
        folder = os.path.join(DATA, kind, name)
        return os.path.join(folder, [f for f in os.listdir(folder) if f.endswith(".png") and "normal" not in f][0])
    cdir = U.char_dir(char_id)
    atlas = sd_look.build_hair_atlas(os.path.join(cdir, "textures", "src", "hair_atlas.png"),
                                     {"hair": tex_of("hair", cfg["hair"]), "brows": tex_of("eyebrows", cfg["brows"]),
                                      "lashes": tex_of("eyelashes", cfg["lashes"])}, cfg["hair_hex"], cfg["hair_tip_hex"])
    hair = sd_look.hair_material(mats["hair"], atlas)
    for key in ("hair", "brows", "lashes"):
        sd_look.remap_uvs(parts[key], sd_look.ATLAS[key])
        parts[key].data.materials.clear()
        parts[key].data.materials.append(hair)
    for ob in meshes:
        for p in ob.data.polygons:
            p.use_smooth = True
    U.purge_orphans()

    scene = bpy.context.scene
    scene["authoring_forward"] = "+X"
    scene["authoring_right"] = "-Y"
    zs = [v.co.z for v in body.data.vertices]
    scene["target_height_m"] = round(max(zs), 4)
    REPORT["landmarks_final"] = {"top": round(max(zs), 4), "min_z": round(min(zs), 4)}
    REPORT["tris"] = {ob.name: sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in meshes}
    REPORT["tris_total"] = sum(REPORT["tris"].values())
    U.save(master)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", required=True)
    ap.add_argument("--stage", default="all", choices=["all", "fit", "finish"])
    a = ap.parse_args(U.args_after_dashes())
    cfg = sd_chars.get(a.char)
    cdir = U.char_dir(a.char)
    master = os.path.join(cdir, "%s_master.blend" % a.char)
    cache = os.path.join(cdir, "build", "cache", "%s_fit.blend" % a.char)
    rpath = os.path.join(cdir, "review", "03_body", "body_report.json")
    if a.stage == "finish" and os.path.exists(rpath):
        with open(rpath) as f:
            REPORT.update({k: v for k, v in json.load(f).items() if k in ("fit_pose", "forearm_twist", "landmarks_mpfb",
                                                                          "helper_verts_deleted", "cornea_faces_removed", "reground_m")})
    if a.stage in ("all", "fit"):
        stage_fit(cfg, cache)
    if a.stage in ("all", "finish"):
        stage_finish(cfg, cache, master, a.char)
    U.write_json(rpath, REPORT)
    U.log("REPORT", json.dumps({k: v for k, v in REPORT.items() if k != "fit_pose"}, indent=1))


if __name__ == "__main__":
    main()
