"""Armature helpers shared by the anime (VRoid) build scripts: world-space pose edits, pose-as-rest baking that keeps
shape keys, LBS vertex warps, and the contract armature. No MPFB dependency."""
import math

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

import sd_contract as C
import sd_util as U


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


def evaluated_coords_keys(ob):
    """Evaluated (modifier) coordinates of the basis and of every shape key at value 1 (others 0)."""
    me = ob.data
    keys = me.shape_keys.key_blocks if me.shape_keys else []
    saved = [(k.value, k.mute) for k in keys]
    for k in keys:
        k.value = 0.0
    out = {"__basis__": U.evaluated_coords(ob, disable_types=("MASK",))}
    for k in list(keys)[1:]:
        k.value = 1.0
        out[k.name] = U.evaluated_coords(ob, disable_types=("MASK",))
        k.value = 0.0
    for k, (v, m) in zip(keys, saved):
        k.value, k.mute = v, m
    return out


def write_coords_keys(ob, data):
    """Write basis + shape key coordinates (as returned by evaluated_coords_keys)."""
    me = ob.data
    basis = data["__basis__"]
    me.vertices.foreach_set("co", np.asarray([tuple(c) for c in basis], dtype=np.float32).ravel())
    if me.shape_keys:
        kb = me.shape_keys.key_blocks
        kb[0].data.foreach_set("co", np.asarray([tuple(c) for c in basis], dtype=np.float32).ravel())
        for name, co in data.items():
            if name == "__basis__":
                continue
            kb[name].data.foreach_set("co", np.asarray([tuple(c) for c in co], dtype=np.float32).ravel())
    me.update()


def apply_pose_as_rest(rig, meshes, dqs=True):
    """Bake the current pose into the meshes (shape keys included) and the armature rest."""
    bpy.context.view_layer.update()
    baked = {}
    for ob in meshes:
        arm_mods = [m for m in ob.modifiers if m.type == "ARMATURE"]
        for m in arm_mods:
            m.use_deform_preserve_volume = dqs
        baked[ob.name] = evaluated_coords_keys(ob)
        for m in arm_mods:
            m.use_deform_preserve_volume = False
    for ob in meshes:
        write_coords_keys(ob, baked[ob.name])
    U.set_active(rig)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    reset_pose(rig)


def vertex_weight_matrix(ob, bone_names):
    """(n_verts, n_bones) normalised deform weights of ob over bone_names (zeros where unweighted)."""
    idx = {g.index: bone_names.index(g.name) for g in ob.vertex_groups if g.name in bone_names}
    W = np.zeros((len(ob.data.vertices), len(bone_names)), dtype=np.float64)
    for v in ob.data.vertices:
        for g in v.groups:
            j = idx.get(g.group)
            if j is not None:
                W[v.index, j] += g.weight
    s = W.sum(axis=1, keepdims=True)
    return np.divide(W, s, out=np.zeros_like(W), where=s > 1e-9), (s[:, 0] > 1e-9)


def lbs_warp(coords, W, mats):
    """Linear blend of 4x4 affine maps: coords (n, 3), W (n, b), mats (b, 4, 4) -> (n, 3)."""
    P = np.c_[coords, np.ones(len(coords))]
    out = np.zeros((len(coords), 3))
    for j, M in enumerate(mats):
        w = W[:, j]
        if not w.any():
            continue
        out += w[:, None] * (P @ np.asarray(M).T)[:, :3]
    return out


def build_contract_armature(name, collection="RIG_DEF"):
    """The 17-joint contract skeleton: every bone points +Z with roll 0 (identity glTF joint rotations)."""
    arm_data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, arm_data)
    U.col(collection).objects.link(arm)
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
    return arm


def add_extra_bone(arm, name, head, parent, length=0.06):
    U.set_active(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones.new(name)
    eb.head = Vector(head)
    eb.tail = Vector(head) + Vector((0, 0, length))
    eb.roll = 0.0
    eb.parent = arm.data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
