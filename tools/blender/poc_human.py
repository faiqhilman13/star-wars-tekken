# Proof of concept: one MPFB human (KAEL-like) with skin, eyes, brows, lashes, hair and the
# game_engine rig, rendered as a portrait + full body with EEVEE. Run via tools/blender/bl.py.
import math
import os

import bpy
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.locationservice import LocationService

OUT = ARGS.get("out", REPO + "/art/review/poc")
os.makedirs(OUT, exist_ok=True)

# Fresh scene (keep the window; MPFB needs a real viewport context).
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.cameras, bpy.data.lights, bpy.data.images):
    for d in list(coll):
        if d.users == 0:
            coll.remove(d)
win = bpy.context.window_manager.windows[0]
area = next(a for a in win.screen.areas if a.type == "VIEW_3D")
region = next(r for r in area.regions if r.type == "WINDOW")
CTX = dict(window=win, screen=win.screen, area=area, region=region, scene=win.scene, view_layer=win.view_layer)
scene = win.scene

data = LocationService.get_user_data()
macro = {
    "gender": 1.0, "age": 0.62, "muscle": 0.72, "weight": 0.52, "proportions": 0.75, "height": 0.7,
    "cupsize": 0.5, "firmness": 0.5, "race": {"asian": 0.1, "caucasian": 0.8, "african": 0.1},
}
with bpy.context.temp_override(**CTX):
    body = HumanService.create_human(macro_detail_dict=macro, feet_on_ground=True, scale=0.1)
    body.name = "GEO-kael_body"
    HumanService.add_builtin_rig(body, "game_engine", import_weights=True)
    HumanService.set_character_skin(os.path.join(data, "skins", "middleage_caucasian_male", "middleage_caucasian_male.mhmat"), body, skin_type="ENHANCED_SSS")
    for kind, name in (("eyes", "high-poly"), ("eyebrows", "eyebrow001"), ("eyelashes", "eyelashes01"), ("hair", "short02")):
        folder = os.path.join(data, kind, name)
        mhclo = [f for f in os.listdir(folder) if f.endswith(".mhclo")][0]
        asset_type = {"eyes": "Eyes", "eyebrows": "Eyebrows", "eyelashes": "Eyelashes", "hair": "Hair"}[kind]
        HumanService.add_mhclo_asset(os.path.join(folder, mhclo), body, asset_type=asset_type, subdiv_levels=0)

# Render setup: EEVEE, three-point light, two cameras.
try:
    scene.render.engine = "BLENDER_EEVEE"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.resolution_x = 900
scene.render.resolution_y = 1200
world = bpy.data.worlds.new("WLD-poc")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.05, 0.055, 0.065, 1)
bg.inputs["Strength"].default_value = 0.6


def light(name, kind, loc, energy, color=(1, 1, 1), size=1.0):
    d = bpy.data.lights.new(name, kind)
    d.energy = energy
    d.color = color
    if kind == "AREA":
        d.size = size
    o = bpy.data.objects.new(name, d)
    scene.collection.objects.link(o)
    o.location = loc
    direction = -o.location.normalized()
    o.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return o


light("LGT-key", "AREA", (2.2, -2.6, 2.6), 700, (1.0, 0.94, 0.86), 1.5)
light("LGT-fill", "AREA", (-2.6, -1.8, 1.6), 220, (0.8, 0.88, 1.0), 2.0)
light("LGT-rim", "AREA", (0.0, 2.8, 2.4), 500, (0.75, 0.85, 1.0), 1.0)


def shoot(name, loc, target, lens):
    cam_d = bpy.data.cameras.new(name)
    cam_d.lens = lens
    cam = bpy.data.objects.new(name, cam_d)
    scene.collection.objects.link(cam)
    cam.location = loc
    from mathutils import Vector
    direction = Vector(target) - Vector(loc)
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.filepath = os.path.join(OUT, name + ".png")
    with bpy.context.temp_override(**CTX):
        bpy.ops.render.render(write_still=True)


h = max(v.co.z for v in body.data.vertices) * body.scale.z
shoot("CAM-body", (1.2, -4.6, h * 0.55), (0, 0, h * 0.5), 50)
shoot("CAM-face", (0.35, -0.95, h * 0.94), (0, 0, h * 0.925), 85)
with bpy.context.temp_override(**CTX):
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "poc_human.blend"), copy=True)
objs = [(o.name, o.type, len(o.data.polygons) if o.type == "MESH" else 0) for o in scene.objects]
print("height_m", round(h, 3))
print("objects", objs)
print("renders", os.listdir(OUT))
