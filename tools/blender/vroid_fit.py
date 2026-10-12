"""ANIME A1 FIT: a CC0 VRoid base (VRM) fitted to the Saber Duel contract skeleton at heroic proportions.

  python tools/blender/run.py tools/blender/vroid_fit.py -- --char kael [--base art/vendor/vroid/.../X.vrm]
      [--stage all|fit]

Steps (each deterministic; settings in vroid_chars.py):
 1. Import the VRM (VRM add-on), drop colliders / spring-bone empties and the MToon outline geometry-node
    modifiers, rotate into the contract frame (faces +X, right side -Y: blender = Rz(+90) * vroid).
 2. Arms down: upper arm, forearm and hand swung from the T-pose to hang straight down (dual-quaternion skinning,
    baked as the new rest), then the forearm twisted progressively (elbow -> wrist) so the open palm faces
    forward with the thumb outward (section 4 palmOpen orientation).
 3. Proportions: every VRoid bone gets an affine map (move its joint onto the contract joint, stretch along the
    bone, widen across it); vertices are warped by the linear blend of those maps with the VRoid skin weights.
    The head keeps head_scale x its size, limbs are lengthened, chest / shoulders / arms widened.
 Output: art/characters/<id>/build/cache/<id>_anime_fit.blend (+ review/a1_fit/fit_report.json).
The later A1 steps (fists, palmOpen, contract weights, expressions, toon materials, outline mask) are in
vroid_finish.py.
"""
import argparse
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sd_contract as C  # noqa: E402
import sd_rig as R  # noqa: E402
import sd_util as U  # noqa: E402
import vroid_chars  # noqa: E402

PHASE = "a1_fit"
REPORT = {}
SIDES = (("R", "N", -1.0), ("L", "F", 1.0))           # VRoid side, contract side, sign of contract Y


# ------------------------------------------------------------------------------------------------ import
def import_base(path, cid):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.vrm(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    for o in [o for o in new if o.type == "EMPTY"]:
        bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    names = {}
    for ob in meshes:
        for m in [m for m in ob.modifiers if m.type == "NODES"]:
            ob.modifiers.remove(m)
        low = ob.name.lower()
        role = "face" if "face" in low else ("hair" if "hair" in low else "body")
        n = "GEO-%s_%s" % (cid, role)
        k = 1
        while n in names.values():
            k += 1
            n = "GEO-%s_%s%d" % (cid, role, k)
        names[ob.name] = n
    for ob in meshes:
        ob.name = names[ob.name]
        ob.data.name = ob.name
    arm.name = "ARM-vroid"
    REPORT["meshes"] = {ob.name: {"tris": sum(len(p.vertices) - 2 for p in ob.data.polygons),
                                  "keys": len(ob.data.shape_keys.key_blocks) if ob.data.shape_keys else 0}
                        for ob in meshes}
    return arm, meshes


def to_contract_frame(arm, meshes):
    Rz = Matrix.Rotation(math.radians(90.0), 4, "Z")
    for ob in meshes:
        mw = ob.matrix_world.copy()
        ob.data.transform(mw, shape_keys=True)
        ob.matrix_world = Matrix.Identity(4)
        ob.data.transform(Rz, shape_keys=True)
        ob.data.update()
    am = arm.matrix_world.copy()
    U.set_active(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    for eb in arm.data.edit_bones:          # disconnected: moving one bone must never drag its neighbours
        eb.use_connect = False
    for eb in arm.data.edit_bones:
        eb.transform(Rz @ am)
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.matrix_world = Matrix.Identity(4)
    for ob in meshes:
        ob.parent = arm
        ob.matrix_parent_inverse = Matrix.Identity(4)
        mod = next((m for m in ob.modifiers if m.type == "ARMATURE"), None) or ob.modifiers.new("Armature", "ARMATURE")
        mod.object = arm


def rest(arm, name):
    b = arm.data.bones[name]
    return b.head_local.copy(), b.tail_local.copy()


# ------------------------------------------------------------------------------------------------ arms down
def arms_down(arm, meshes):
    R.reset_pose(arm)
    down = Vector((0.0, 0.0, -1.0))
    for vs, cs, sg in SIDES:
        for b in ("J_Bip_%s_UpperArm" % vs, "J_Bip_%s_LowerArm" % vs, "J_Bip_%s_Hand" % vs):
            R.aim(arm, b, direction=down)
        # legs straightened too (the VRoid legs converge toward the ankles; the contract legs hang plumb), so the
        # proportion warp below only stretches and never has to blend rotations at the knee
        for b in ("J_Bip_%s_UpperLeg" % vs, "J_Bip_%s_LowerLeg" % vs):
            R.aim(arm, b, direction=down)
    movers = [ob for ob in meshes if any(g.name.startswith(("J_Bip_R_UpperArm", "J_Bip_L_UpperArm", "J_Bip_R_UpperLeg"))
                                         for g in ob.vertex_groups)]
    R.apply_pose_as_rest(arm, movers, dqs=True)


def forearm_twist(arm, meshes):
    """Pronate/supinate each forearm so the open palm faces +X with the thumb outward, spread from elbow (0) to
    wrist (1) by the vertices' forearm/hand weight share; the hand and fingers turn rigidly."""
    out = {}
    for vs, cs, sg in SIDES:
        e, _ = rest(arm, "J_Bip_%s_LowerArm" % vs)
        w, _ = rest(arm, "J_Bip_%s_Hand" % vs)
        axis = (w - e).normalized()
        i1, _ = rest(arm, "J_Bip_%s_Index1" % vs)
        l1, _ = rest(arm, "J_Bip_%s_Little1" % vs)
        across = i1 - l1
        across -= axis * across.dot(axis)
        want = Vector((0.0, sg, 0.0))                     # index side (thumb side) points outward
        want -= axis * want.dot(axis)
        ang = math.atan2(axis.dot(across.normalized().cross(want.normalized())),
                         across.normalized().dot(want.normalized()))
        out[vs] = round(math.degrees(ang), 1)
        # the hand and finger bones only (not the legs, which share the J_Bip_<side>_ prefix)
        hand_names = {b.name for b in arm.data.bones if b.name.startswith("J_Bip_%s_" % vs) and
                      any(k in b.name for k in ("_Hand", "Thumb", "Index", "Middle", "Ring", "Little"))}
        fore = "J_Bip_%s_LowerArm" % vs
        L = (w - e).length
        Rm = U.rot_about_line(e, axis, ang)
        for ob in meshes:
            gi = {g.index: g.name for g in ob.vertex_groups}
            if not any(n == fore or n in hand_names for n in gi.values()):
                continue
            me = ob.data
            keys = me.shape_keys.key_blocks if me.shape_keys else None
            for v in me.vertices:
                ws = {gi[g.group]: g.weight for g in v.groups if g.group in gi}
                tot = sum(ws.values()) or 1.0
                share = (ws.get(fore, 0.0) + sum(x for n, x in ws.items() if n in hand_names)) / tot
                if share <= 0.0:
                    continue
                t = (v.co - e).dot(axis) / L
                f = 1.0 if (t >= 0.98 and share > 0.5) else U.smoothstep(0.05, 0.95, t) * share
                if f <= 0.0:
                    continue
                Rv = U.rot_about_line(e, axis, ang * f)
                if keys:
                    for kb in keys:
                        kb.data[v.index].co = Rv @ kb.data[v.index].co
                v.co = Rv @ v.co
            me.update()
        U.set_active(arm)
        bpy.ops.object.mode_set(mode="EDIT")
        for n in hand_names:
            eb = arm.data.edit_bones[n]
            eb.transform(Rm)
        bpy.ops.object.mode_set(mode="OBJECT")
    REPORT["forearm_twist_deg"] = out


# ------------------------------------------------------------------------------------------------ proportions
def piecewise(knots):
    xs = [k[0] for k in knots]
    ys = [k[1] for k in knots]

    def f(x):
        if x <= xs[0]:
            return ys[0] + (x - xs[0]) * (ys[1] - ys[0]) / (xs[1] - xs[0])
        if x >= xs[-1]:
            return ys[-1] + (x - xs[-1]) * (ys[-1] - ys[-2]) / (xs[-1] - xs[-2])
        for (x0, y0), (x1, y1) in zip(knots, knots[1:]):
            if x0 <= x <= x1:
                return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return f


def affine(h0, t0, h1, t1, s_depth=1.0, s_width=1.0, along=None):
    """4x4 map taking segment h0->t0 onto h1->t1 (minimal rotation), scaling across it by s_depth (world X
    projected) and s_width (world Y projected); along overrides the along-axis scale."""
    a0 = (t0 - h0)
    a1 = (t1 - h1)
    s = along if along is not None else (a1.length / max(a0.length, 1e-6))
    a0n, a1n = a0.normalized(), a1.normalized()
    d0 = Vector((1, 0, 0)) - a0n * a0n.x
    if d0.length < 1e-4:
        d0 = Vector((0, 0, 1)) - a0n * a0n.z
    d0.normalize()
    w0 = a0n.cross(d0).normalized()
    S = Matrix.Identity(3)
    for vec, k in ((a0n, s), (d0, s_depth), (w0, s_width)):
        o = Matrix(((vec.x * vec.x, vec.x * vec.y, vec.x * vec.z), (vec.y * vec.x, vec.y * vec.y, vec.y * vec.z),
                    (vec.z * vec.x, vec.z * vec.y, vec.z * vec.z)))
        S = S + o * (k - 1.0)
    Rq = a0n.rotation_difference(a1n).to_matrix()
    M3 = Rq @ S
    return Matrix.Translation(h1) @ M3.to_4x4() @ Matrix.Translation(-h0)


def proportion_maps(arm, cfg):
    """Affine map per VRoid bone (dict name -> 4x4) and the new rest heads/tails."""
    B = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones}
    J = {k: Vector(C.joint_blender(k)) for k in C.CORE}
    hip_z = B["J_Bip_R_UpperLeg"][0].z
    sh_z = B["J_Bip_R_UpperArm"][0].z
    neck_z = B["J_Bip_C_Neck"][0].z
    head_z = B["J_Bip_C_Head"][0].z
    zmap = piecewise([(hip_z, J["thighN"].z), (sh_z, J["upperN"].z), (neck_z, J["neck"].z), (head_z, J["head"].z)])
    REPORT["torso_stretch"] = round((J["upperN"].z - J["thighN"].z) / (sh_z - hip_z), 3)
    maps = {}
    newpos = {}

    def torso_pt(p, sw, sd):
        return Vector((p.x * sd, p.y * sw, zmap(p.z)))
    torso = [("J_Bip_C_Hips", cfg["hip_width"], cfg["hip_depth"]),
             ("J_Bip_C_Spine", cfg["waist_width"], cfg["waist_depth"]),
             ("J_Bip_C_Chest", 0.5 * (cfg["waist_width"] + cfg["chest_width"]), 0.5 * (cfg["waist_depth"] + cfg["chest_depth"])),
             ("J_Bip_C_UpperChest", cfg["chest_width"], cfg["chest_depth"]),
             ("J_Bip_C_Neck", cfg["neck_thick"], cfg["neck_thick"])]
    for name, sw, sd in torso:
        h0, t0 = B[name]
        h1, t1 = torso_pt(h0, 1.0, 1.0), torso_pt(t0, 1.0, 1.0)
        h1.x, h1.y, t1.x, t1.y = 0.0, 0.0, 0.0, 0.0
        h1.x, t1.x = h0.x * sd, t0.x * sd
        maps[name] = affine(h0, t0, h1, t1, sd, sw)
        newpos[name] = (h1, t1)
    # head (and everything parented under it): similarity about the head joint
    hs = cfg["head_scale"]
    h0, t0 = B["J_Bip_C_Head"]
    h1 = Vector((h0.x * cfg["neck_thick"], 0.0, J["head"].z))
    maps["J_Bip_C_Head"] = Matrix.Translation(h1) @ Matrix.Scale(hs, 4) @ Matrix.Translation(-h0)
    newpos["J_Bip_C_Head"] = (h1, h1 + (t0 - h0) * hs)
    for vs, cs, sg in SIDES:
        # clavicle: from its (widened) chest root to the contract shoulder
        h0, t0 = B["J_Bip_%s_Shoulder" % vs]
        h1 = torso_pt(h0, cfg["chest_width"], cfg["chest_depth"])
        t1 = J["upper" + cs].copy()
        maps["J_Bip_%s_Shoulder" % vs] = affine(h0, t0, h1, t1, cfg["chest_depth"], cfg.get("shoulder_thick", 1.0))
        newpos["J_Bip_%s_Shoulder" % vs] = (h1, t1)
        chain = [("J_Bip_%s_UpperArm" % vs, J["upper" + cs], J["fore" + cs]),
                 ("J_Bip_%s_LowerArm" % vs, J["fore" + cs], J["hand" + cs])]
        for name, a, b in chain:
            h0, t0 = B[name]
            if name.endswith("UpperArm"):
                t0 = B["J_Bip_%s_LowerArm" % vs][0]
            else:
                t0 = B["J_Bip_%s_Hand" % vs][0]
            k = cfg.get("upper_thick" if name.endswith("UpperArm") else "fore_thick", cfg["arm_thick"])
            maps[name] = affine(h0, t0, a, b, k, k)
            newpos[name] = (a.copy(), b.copy())
        # hand + fingers: similarity about the wrist
        h0, _ = B["J_Bip_%s_Hand" % vs]
        hsc = cfg["hand_scale"]
        maps["J_Bip_%s_Hand" % vs] = Matrix.Translation(J["hand" + cs]) @ Matrix.Scale(hsc, 4) @ Matrix.Translation(-h0)
        # legs: thigh -> knee -> anatomical ankle
        ank = Vector((J["foot" + cs].x, J["foot" + cs].y, cfg["ankle_mesh_z"]))
        chain = [("J_Bip_%s_UpperLeg" % vs, J["thigh" + cs], J["shin" + cs], "J_Bip_%s_LowerLeg" % vs),
                 ("J_Bip_%s_LowerLeg" % vs, J["shin" + cs], ank, "J_Bip_%s_Foot" % vs)]
        for name, a, b, child in chain:
            h0 = B[name][0]
            t0 = B[child][0]
            k = cfg["leg_thick"]
            maps[name] = affine(h0, t0, a, b, k, k)
            newpos[name] = (a.copy(), b.copy())
        # foot + toes: sole stays on the floor, height squashed to the new ankle, length x foot_scale
        h0 = B["J_Bip_%s_Foot" % vs][0]
        fs = cfg["foot_scale"]
        vz = cfg["ankle_mesh_z"] / max(h0.z, 1e-3)
        g0 = Vector((h0.x, h0.y, 0.0))
        g1 = Vector((ank.x, ank.y, 0.0))
        maps["J_Bip_%s_Foot" % vs] = Matrix.Translation(g1) @ Matrix.Diagonal((fs, fs, vz, 1.0)) @ Matrix.Translation(-g0)
    return maps, newpos


def mapped_ancestor(arm, name, maps):
    b = arm.data.bones[name]
    while b is not None:
        if b.name in maps:
            return b.name
        b = b.parent
    return None


def warp(arm, meshes, maps):
    names = [b.name for b in arm.data.bones]
    eff = {}
    for n in names:
        a = mapped_ancestor(arm, n, maps)
        eff[n] = maps[a] if a else Matrix.Identity(4)
    mats = np.array([np.array(eff[n]) for n in names])
    for ob in meshes:
        W, ok = R.vertex_weight_matrix(ob, names)
        me = ob.data
        co = np.array([tuple(v.co) for v in me.vertices])
        new = R.lbs_warp(co, W, mats)
        new[~ok] = co[~ok]
        data = {"__basis__": [Vector(c) for c in new]}
        if me.shape_keys:
            for kb in list(me.shape_keys.key_blocks)[1:]:
                kc = np.array([tuple(d.co) for d in kb.data])
                kn = R.lbs_warp(kc, W, mats)
                kn[~ok] = kc[~ok]
                data[kb.name] = [Vector(c) for c in kn]
        R.write_coords_keys(ob, data)
    # move the VRoid rest skeleton along (each bone by its effective map)
    U.set_active(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    for eb in arm.data.edit_bones:
        M = eff[eb.name]
        h, t = M @ eb.head, M @ eb.tail
        eb.head, eb.tail = h, t
    bpy.ops.object.mode_set(mode="OBJECT")


def landmarks(meshes):
    zs = []
    for ob in meshes:
        zs += [v.co.z for v in ob.data.vertices]
    face = next((o for o in meshes if o.name.endswith("_face")), None)
    out = {"top_z": round(max(zs), 4), "bottom_z": round(min(zs), 4)}
    if face:
        fz = [v.co.z for v in face.data.vertices]
        out["face_top"] = round(max(fz), 4)
        out["chin"] = round(min(fz), 4)
        out["heads_tall"] = round(max(fz) / max(max(fz) - min(fz), 1e-3), 2)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", required=True)
    ap.add_argument("--base", default="")
    a = ap.parse_args(U.args_after_dashes())
    cfg = vroid_chars.get(a.char)
    base = os.path.join(U.REPO, a.base or cfg["base"])
    cdir = U.char_dir(a.char)
    arm, meshes = import_base(base, a.char)
    to_contract_frame(arm, meshes)
    REPORT["before"] = landmarks(meshes)
    arms_down(arm, meshes)
    forearm_twist(arm, meshes)
    maps, newpos = proportion_maps(arm, cfg)
    warp(arm, meshes, maps)
    REPORT["after"] = landmarks(meshes)
    U.write_json(os.path.join(cdir, "review", PHASE, "fit_report.json"), REPORT)
    U.log("FIT", json.dumps(REPORT))
    U.save(os.path.join(cdir, "build", "cache", "%s_anime_fit.blend" % a.char))


if __name__ == "__main__":
    main()
