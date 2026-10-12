"""Extreme-pose library for the contract skeleton (CHARACTER_PIPELINE.md section 8), FK only.

Joint rotations are given in the rest (world-aligned) frame of the contract: X forward, Y = character's left
(far), Z up. Because every contract bone rests with the same orientation (local Y = +Z), a local rotation
expressed in world axes converts to a pose quaternion with one constant change of basis.
Conventions (degrees): flexion of hip/shoulder/elbow = about -Y; knee flexion = about +Y; spine/chest bend
forward = about +Y; twist = about +Z (positive turns the chest toward the far side).
"""
import math

import bpy
from mathutils import Matrix, Quaternion, Vector

B = Matrix.Rotation(math.radians(90.0), 3, "X")          # bone rest rotation (local Y = world +Z)
BI = B.inverted()
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def q(*rots):
    """Compose world-frame rotations [(axis, deg), ...] applied in order."""
    out = Quaternion()
    for axis, deg in rots:
        out = Quaternion(axis, math.radians(deg)) @ out
    return out


def apply(arm, joints, hips_offset=(0, 0, 0)):
    """joints: {bone: Quaternion in rest world axes}. hips_offset: world translation of the hips (m)."""
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    for name, qw in joints.items():
        pb = arm.pose.bones[name]
        pb.rotation_quaternion = (BI @ qw.to_matrix() @ B).to_quaternion()
    # pose-space location of the root bone is in its local axes
    arm.pose.bones["hips"].location = BI @ Vector(hips_offset)
    bpy.context.view_layer.update()


def ground(arm, meshes, clearance=0.0):
    """Drop or raise the hips so the lowest evaluated vertex sits on z = clearance."""
    dg = bpy.context.evaluated_depsgraph_get()
    lo = 1e9
    for ob in meshes:
        eo = ob.evaluated_get(dg)
        me = eo.to_mesh()
        lo = min(lo, min((eo.matrix_world @ v.co).z for v in me.vertices))
        eo.to_mesh_clear()
    pb = arm.pose.bones["hips"]
    cur = B @ Vector(pb.location)
    cur.z += clearance - lo
    pb.location = BI @ cur
    bpy.context.view_layer.update()


def guard(side_flex=60, elbow=70, twist=0):
    """Two-handed mid guard: both upper arms forward, elbows bent, hands together in front of the navel."""
    return {
        "upperN": q((Y, -side_flex), (X, 12)), "foreN": q((Y, -elbow)),
        "upperF": q((Y, -side_flex), (X, -12)), "foreF": q((Y, -elbow)),
    }


POSES = {
    "rest": ({}, (0, 0, 0)),
    "crouch": ({**guard(55, 75), "spine": q((Y, 12)), "chest": q((Y, 10)), "neck": q((Y, -12)),
                "thighN": q((Y, -105), (X, -8)), "shinN": q((Y, 125)), "footN": q((Y, -20)),
                "thighF": q((Y, -100), (X, 8)), "shinF": q((Y, 130)), "footF": q((Y, -30))}, (-0.05, 0, -0.42)),
    "lunge": ({**guard(70, 40), "spine": q((Y, 10)), "chest": q((Y, 6), (Z, -15)),
               "thighN": q((Y, -80)), "shinN": q((Y, 85)), "footN": q((Y, -5)),
               "thighF": q((Y, 40)), "shinF": q((Y, 15)), "footF": q((Y, 25))}, (0.05, 0, -0.25)),
    "overhead": ({"upperN": q((Y, -165), (X, 10)), "foreN": q((Y, -35)),
                  "upperF": q((Y, -165), (X, -10)), "foreF": q((Y, -35)),
                  "chest": q((Y, -6)), "neck": q((Y, 5))}, (0, 0, 0)),
    "high_kick": ({**guard(45, 80), "spine": q((Y, -8)), "chest": q((Y, -6)),
                   "thighN": q((Y, -95)), "shinN": q((Y, 5)), "footN": q((Y, 20)),
                   "thighF": q((Y, 5)), "shinF": q((Y, 8))}, (0, 0, -0.02)),
    "lying_back": ({"hips": q((Y, -90)), "upperN": q((X, -35)), "upperF": q((X, 35)),
                    "foreN": q((Y, -20)), "foreF": q((Y, -20)),
                    "thighN": q((Y, -55)), "shinN": q((Y, 90)), "thighF": q((Y, -5))}, (0, 0, -0.85)),
    "twist90": ({**guard(60, 60), "spine": q((Z, 35)), "chest": q((Z, 55)), "neck": q((Z, -20)),
                 "thighN": q((Y, -20)), "shinN": q((Y, 25)), "thighF": q((Y, 15)), "shinF": q((Y, 10))},
                (0, 0, -0.03)),
    "splits": ({**guard(40, 60), "spine": q((Y, 15)),
                "thighN": q((Y, -90)), "shinN": q((Y, 0)), "footN": q((Y, 15)),
                "thighF": q((Y, 85)), "shinF": q((Y, 0)), "footF": q((Y, 60))}, (0, 0, -0.85)),
}
SECTION8 = ["crouch", "lunge", "overhead", "high_kick", "lying_back", "twist90", "splits"]


# ------------------------------------------------------------------------------------------------ skirt
# Port of driveSkirt / skirtAnchors (src/render/rig/costumes.ts, modelBody.ts): the runtime swings the GLB's
# skirt_<label>_0/_1 bones so the panels hang with gravity, part around the legs and stay above the floor. The
# pose sheet runs the same solver so it shows the cloth exactly as the game will drive it.
def _g(v):
    """Blender vector -> game axes (x fwd, y up, z near)."""
    return Vector((v.x, v.z, -v.y))


def _b(v):
    """game axes -> Blender."""
    return Vector((v.x, -v.z, v.y))


def skirt_anchors(arm, meshes):
    import re
    bones = arm.data.bones
    hips = bones["hips"].head_local
    minz = {}
    for ob in meshes or []:
        names = {g.index: g.name for g in ob.vertex_groups if g.name.startswith("skirt_")}
        if not names:
            continue
        mw = ob.matrix_world
        for v in ob.data.vertices:
            for gr in v.groups:
                if gr.group in names and gr.weight > 0.01:
                    z = (mw @ v.co).z
                    n = names[gr.group]
                    minz[n] = min(minz.get(n, 1e9), z)
    out = []
    for b in bones:
        m = re.match(r"^skirt_(.+)_0$", b.name)
        if not m:
            continue
        lower = bones.get("skirt_%s_1" % m.group(1))
        P = _g(b.head_local - hips)
        az = math.atan2(P.z, P.x)
        d = Vector((math.cos(az), 0.0, math.sin(az)))
        axis = Vector((0, -1, 0)).cross(d).normalized()
        low = _g(lower.head_local - b.head_local) if lower else Vector((0, -0.3, 0))
        rest = max(0.0, math.atan2(low.x * d.x + low.z * d.z, -low.y))
        pivot_y = hips.z + P.y
        hem_u, hem_l = minz.get(b.name, 1e9), minz.get(lower.name, 1e9) if lower else 1e9
        hem = min(hem_u, hem_l)
        len2 = max(0.03, pivot_y + low.y - hem_l) if hem_l < 1e8 else 0.05
        side = 0 if abs(math.sin(az)) < 0.26 else (1 if math.sin(az) > 0 else -1)
        out.append(dict(upper=b.name, lower=lower.name if lower else None, P=P, dir=d, axis=axis, low=low,
                        rest=rest, long=(pivot_y - hem > 0.55) if hem < 1e8 else False, len2=len2, side=side))
    return out


def _clear_angle(P, Q, d, m):
    qx, qz = Q.x - P.x, Q.z - P.z
    out = qx * d.x + qz * d.z
    down = -(Q.y - P.y)
    R = math.hypot(out, down)
    if R < m * 1.2:
        return -math.inf
    return math.atan2(out, down) + math.asin(min(1.0, m / R))


def _near(a, ref):
    return ref + math.atan2(math.sin(a - ref), math.cos(a - ref))


def _floor_clamp(a, h, length, u_out, u_down, min_h):
    if h + length * (math.sin(a) * u_out + math.cos(a) * u_down) >= min_h:
        return a
    R = math.hypot(u_out, u_down) * length
    if R < 1e-5:
        return a
    phi = math.atan2(u_down, u_out)
    k = (min_h - h) / R
    if k >= 1:
        return _near(math.pi / 2 - phi, a)
    s_ = math.asin(max(-1.0, k))
    a1, a2 = _near(s_ - phi, a), _near(math.pi - s_ - phi, a)
    return a1 if abs(a1 - a) < abs(a2 - a) else a2


def _set_local(pb, axis_game, angle):
    qw = Quaternion(_b(axis_game), angle)
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = (BI @ qw.to_matrix() @ B).to_quaternion()


def drive_skirt(arm, anchors, sway=0.0, flare=0.0, floor=0.0, knee=0.1, ankle=0.085):
    pbs = arm.pose.bones
    for a in anchors:                     # solve from the hanging rest of the panels
        for n in (a["upper"], a["lower"]):
            if n:
                pbs[n].rotation_quaternion = (1, 0, 0, 0)
    bpy.context.view_layer.update()
    ph = pbs["hips"]
    R = (ph.matrix.to_3x3() @ arm.data.bones["hips"].matrix_local.to_3x3().inverted()).normalized()
    Ri = R.inverted()
    h0 = ph.head.copy()

    def hs(p):                            # armature-space point -> hips space, game axes
        return _g(Ri @ (p - h0))
    kN, kF = hs(pbs["shinN"].head), hs(pbs["shinF"].head)
    aN, aF = hs(pbs["footN"].head), hs(pbs["footF"].head)
    g = _g(Ri @ Vector((0, 0, -1)))
    u_down = (R @ Vector((0, 0, -1))).z
    for a in anchors:
        d, P, low = a["dir"], a["P"], a["low"]
        g_out = g.x * d.x + g.z * d.z
        grav = max(-0.8, min(0.8, math.atan2(g_out, max(0.15, -g.y))))
        alpha = a["rest"] + grav * 0.6
        clear = -math.inf
        if a["side"] >= 0:
            clear = max(clear, _clear_angle(P, kN, d, knee))
            if not a["long"]:
                clear = max(clear, _clear_angle(P, aN, d, ankle) - 0.15)
        if a["side"] <= 0:
            clear = max(clear, _clear_angle(P, kF, d, knee))
            if not a["long"]:
                clear = max(clear, _clear_angle(P, aF, d, ankle) - 0.15)
        alpha = max(alpha, clear) + sway * d.x * 0.35 + flare * 0.85
        alpha = max(-0.4, min(2.3, alpha))
        u_out = (R @ _b(d)).z
        hP = (h0 + R @ _b(P)).z
        len1 = -low.y
        alpha = max(clear, _floor_clamp(alpha, hP, len1, u_out, u_down, floor + 0.035))
        _set_local(pbs[a["upper"]], a["axis"], alpha - a["rest"])
        if not a["lower"]:
            continue
        lo, ld = low.x * d.x + low.z * d.z, -low.y
        lr = math.hypot(lo, ld)
        beta = math.atan2(lo, ld) + (alpha - a["rest"])
        sb, cb = math.sin(beta), math.cos(beta)
        p2 = Vector((P.x + d.x * sb * lr, P.y - cb * lr, P.z + d.z * sb * lr))
        alpha2 = a["rest"] + grav * (0.9 if a["long"] else 0.7)
        clear2 = -math.inf
        if a["side"] >= 0:
            clear2 = max(clear2, _clear_angle(p2, aN, d, ankle))
        if a["side"] <= 0:
            clear2 = max(clear2, _clear_angle(p2, aF, d, ankle))
        alpha2 = max(alpha2, clear2)
        if not a["long"]:
            alpha2 = max(alpha2, alpha - 0.5)
        alpha2 = max(alpha - 1.9, min(alpha + 0.6, alpha2)) + flare * 0.4 + sway * d.x * 0.25
        hP2 = hP + lr * (sb * u_out + cb * u_down)
        alpha2 = max(clear2, _floor_clamp(alpha2, hP2, a["len2"], u_out, u_down, floor + 0.02))
        _set_local(pbs[a["lower"]], a["axis"], alpha2 - alpha)
    bpy.context.view_layer.update()


def pose(arm, name, meshes=None, skirt=True, bulk=1.0):
    joints, off = POSES[name]
    apply(arm, joints, off)
    if meshes and name != "rest":
        ground(arm, meshes, 0.0)
    if skirt and name != "rest" and any(b.name.startswith("skirt_") for b in arm.data.bones):
        anchors = skirt_anchors(arm, meshes)
        drive_skirt(arm, anchors, floor=0.0, knee=0.1 * bulk, ankle=0.085 * bulk)
