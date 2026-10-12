# Proof of concept: import CC0 VRoid models and render them with an anime look (EEVEE, toon-ish
# lighting) to judge the bases. Run via tools/blender/bl.py (live session).
import os

import bpy
from mathutils import Vector

OUT = ARGS.get("out", REPO + "/art/review/poc_anime")
os.makedirs(OUT, exist_ok=True)
names = ARGS.get("models", "base_male/Base_Male.vrm,hairsample_male/HairSample_Male.vrm,avatarsample_d_0/AvatarSample_D.vrm,sendagaya_shino/Sendagaya Shino.vrm").split(",")

win = bpy.context.window_manager.windows[0]
area = next(a for a in win.screen.areas if a.type == "VIEW_3D")
region = next(r for r in area.regions if r.type == "WINDOW")
CTX = dict(window=win, screen=win.screen, area=area, region=region, scene=win.scene, view_layer=win.view_layer)
scene = win.scene

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

report = []
for i, rel in enumerate(names):
    path = os.path.join(REPO, "art", "vendor", "vroid", rel)
    before = set(bpy.data.objects)
    with bpy.context.temp_override(**CTX):
        bpy.ops.import_scene.vrm(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    for r in roots:
        r.location.x += i * 1.2
    meshes = [o for o in new if o.type == "MESH"]
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    keys = sorted({k.name for o in meshes if o.data.shape_keys for k in o.data.shape_keys.key_blocks})
    arm = next((o for o in new if o.type == "ARMATURE"), None)
    report.append({"model": rel, "meshes": [o.name for o in meshes], "tris": tris, "bones": len(arm.data.bones) if arm else 0, "shape_keys": len(keys), "keys_sample": keys[:12], "materials": sorted({m.name for o in meshes for m in o.data.materials if m})[:10]})

try:
    scene.render.engine = "BLENDER_EEVEE"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.resolution_x = 1600
scene.render.resolution_y = 1000
scene.view_settings.view_transform = "Standard"
world = scene.world or bpy.data.worlds.new("WLD-poc")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = (0.08, 0.09, 0.11, 1)
bg.inputs["Strength"].default_value = 1.0
sun_d = bpy.data.lights.new("LGT-sun", "SUN")
sun_d.energy = 3.0
sun = bpy.data.objects.new("LGT-sun", sun_d)
scene.collection.objects.link(sun)
sun.rotation_euler = (0.9, 0.2, -0.6)

cam_d = bpy.data.cameras.new("CAM-line")
cam_d.lens = 50
cam = bpy.data.objects.new("CAM-line", cam_d)
scene.collection.objects.link(cam)
span = (len(names) - 1) * 1.2
cam.location = (span / 2, -6.2, 0.95)
cam.rotation_euler = (Vector((span / 2, 0, 0.85)) - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam
scene.render.filepath = os.path.join(OUT, "lineup.png")
with bpy.context.temp_override(**CTX):
    bpy.ops.render.render(write_still=True)
# Face close-up of the first two.
for j in range(min(2, len(names))):
    cam.location = (j * 1.2 + 0.18, -0.75, 1.42)
    cam.rotation_euler = (Vector((j * 1.2, 0, 1.38)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_d.lens = 70
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.filepath = os.path.join(OUT, f"face_{j}.png")
    with bpy.context.temp_override(**CTX):
        bpy.ops.render.render(write_still=True)
import json
print(json.dumps(report, indent=1))
