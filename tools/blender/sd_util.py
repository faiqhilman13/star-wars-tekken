"""Small bpy helpers shared by the Saber Duel character build scripts (headless-safe, no viewport needed)."""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

REPO = os.environ.get("SABER_REPO") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REPO = REPO.replace("\\", "/")
COLLECTIONS = ["REF", "HIGH", "LOW", "RIG_CTRL", "RIG_DEF", "COLLISION", "SOCKETS", "EXPORT"]


def args_after_dashes():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def char_dir(char_id):
    return os.path.join(REPO, "art", "characters", char_id).replace("\\", "/")


def log(*a):
    print("[sd]", *a, flush=True)


def col(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def move_to(ob, col_name):
    c = col(col_name)
    for uc in list(ob.users_collection):
        uc.objects.unlink(ob)
    c.objects.link(ob)


def remove_object(ob):
    data = ob.data
    bpy.data.objects.remove(ob, do_unlink=True)
    if data is not None and getattr(data, "users", 1) == 0:
        try:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Armature):
                bpy.data.armatures.remove(data)
            elif isinstance(data, bpy.types.Curve):
                bpy.data.curves.remove(data)
        except ReferenceError:
            pass


def clear_owned(tag):
    for ob in [o for o in bpy.data.objects if o.get("owner") == tag]:
        remove_object(ob)


def purge_orphans():
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures, bpy.data.actions,
                 bpy.data.node_groups, bpy.data.textures, bpy.data.curves):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)


def save(path):
    bpy.context.preferences.filepaths.save_version = 0
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path))
    log("saved", path)


def set_active(ob):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.hide_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def evaluated_coords(ob, disable_types=("MASK",), world=False):
    """Vertex positions after deform modifiers (topology-changing modifiers temporarily disabled)."""
    off = []
    for m in ob.modifiers:
        if m.type in disable_types and m.show_viewport:
            m.show_viewport = False
            off.append(m)
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    eo = ob.evaluated_get(dg)
    me = eo.to_mesh()
    if len(me.vertices) != len(ob.data.vertices):
        eo.to_mesh_clear()
        for m in off:
            m.show_viewport = True
        raise RuntimeError("topology changed while evaluating %s" % ob.name)
    mw = ob.matrix_world.copy()
    co = [(mw @ v.co) if world else v.co.copy() for v in me.vertices]
    eo.to_mesh_clear()
    for m in off:
        m.show_viewport = True
    return co


def write_coords(ob, coords):
    me = ob.data
    if me.shape_keys:
        raise RuntimeError("write_coords on a mesh with shape keys: " + ob.name)
    for v, c in zip(me.vertices, coords):
        v.co = c
    me.update()


def group_weights(ob, names):
    """{vertex index: summed weight of the named groups}."""
    idx = {ob.vertex_groups[n].index for n in names if n in ob.vertex_groups}
    out = {}
    for v in ob.data.vertices:
        w = sum(g.weight for g in v.groups if g.group in idx)
        if w > 0:
            out[v.index] = w
    return out


def smoothstep(e0, e1, x):
    if e1 == e0:
        return 1.0 if x >= e1 else 0.0
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def rot_about_line(point, axis, angle):
    """4x4 rotation by angle (rad) about the line through point with direction axis."""
    return Matrix.Translation(point) @ Matrix.Rotation(angle, 4, axis.normalized()) @ Matrix.Translation(-point)


def write_json(path, data):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def eevee(scene):
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = eng
            return eng
        except TypeError:
            continue
    raise RuntimeError("no EEVEE engine")


def set_input(node, name, value):
    for inp in node.inputs:
        if inp.name == name:
            inp.default_value = value
            return True
    return False


def principled(nt):
    return next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")


def output_node(nt):
    return next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")


def new_material(name):
    m = bpy.data.materials.get(name)
    if m:
        m.name = name + "_old"
    m = bpy.data.materials.new(name)
    if bpy.app.version < (5, 0, 0):
        m.use_nodes = True
    return m
