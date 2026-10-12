"""Inspect the CC0 VRoid female bases (headless): one front body render + one face close-up per model, and a JSON
report of meshes, materials, hair joints and blendshapes. Used to pick the face / hair bases for ASHA and VEXA.

  python tools/blender/run.py art/characters/asha/build/inspect_bases.py -- --out art/characters/asha/review/a0_bases
"""
import json
import os
import sys

import bpy
from mathutils import Vector

REPO = os.environ.get("SABER_REPO", ".")
MODELS = ["base_female/Base_Female.vrm", "hairsample_female/HairSample_Female.vrm",
          "avatarsample_d_0/AvatarSample_D.vrm", "avatarsample_e/AvatarSample_E.vrm",
          "avatarsample_f/AvatarSample_F.vrm", "avatarsample_g/AvatarSample_G.vrm",
          "sendagaya_shino/Sendagaya Shino.vrm"]


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"out": "art/characters/asha/review/a0_bases"}
    for i in range(0, len(a) - 1, 2):
        out[a[i].lstrip("-")] = a[i + 1]
    return out


def setup(scene):
    scene.render.engine = "BLENDER_EEVEE"
    scene.view_settings.view_transform = "Standard"
    w = scene.world or bpy.data.worlds.new("w")
    scene.world = w
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.3, 0.32, 0.36, 1)
    bg.inputs["Strength"].default_value = 1.0
    ld = bpy.data.lights.new("sun", "SUN")
    ld.energy = 2.5
    lo = bpy.data.objects.new("sun", ld)
    scene.collection.objects.link(lo)
    lo.rotation_euler = (0.9, 0.0, 0.5)
    cd = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cd)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def look(cam, eye, tgt, lens):
    cam.location = eye
    cam.data.lens = lens
    cam.rotation_euler = (Vector(tgt) - Vector(eye)).to_track_quat("-Z", "Y").to_euler()


def main():
    a = args()
    out = os.path.join(REPO, a["out"])
    os.makedirs(out, exist_ok=True)
    scene = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    cam = setup(scene)
    report = {}
    for rel in MODELS:
        keep = {"cam", "sun"}
        for o in list(bpy.data.objects):
            if o.name not in keep:
                bpy.data.objects.remove(o, do_unlink=True)
        bpy.ops.import_scene.vrm(filepath=os.path.join(REPO, "art", "vendor", "vroid", rel))
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
        for ob in meshes:
            for m in [m for m in ob.modifiers if m.type == "NODES"]:
                ob.modifiers.remove(m)
        bpy.context.view_layer.update()
        head = arm.matrix_world @ arm.data.bones["J_Bip_C_Head"].head_local
        zs = [(ob.matrix_world @ v.co).z for ob in meshes for v in ob.data.vertices]
        name = os.path.splitext(os.path.basename(rel))[0].replace(" ", "_")
        hair_bones = [b.name for b in arm.data.bones if "Hair" in b.name]
        rec = {"meshes": {}, "height": round(max(zs) - min(zs), 3), "head_z": round(head.z, 3),
               "hair_bones": len(hair_bones), "hair_roots": [b.name for b in arm.data.bones
                                                             if b.parent and b.parent.name == "J_Bip_C_Head"
                                                             and "Hair" in b.name][:40]}
        for ob in meshes:
            rec["meshes"][ob.name] = {"tris": sum(len(p.vertices) - 2 for p in ob.data.polygons),
                                      "mats": [m.name for m in ob.data.materials if m],
                                      "keys": len(ob.data.shape_keys.key_blocks) if ob.data.shape_keys else 0}
        report[name] = rec
        # VRoid faces -Y in Blender after import (VRM 0.x) or +Y; detect from the nose (face mesh front)
        face = next((o for o in meshes if "face" in o.name.lower()), meshes[0])
        fy = [(face.matrix_world @ v.co).y for v in face.data.vertices]
        front = -1.0 if (min(fy) + max(fy)) / 2 < head.y else 1.0
        front = -1.0
        mid = (max(zs) + min(zs)) / 2
        H = max(zs) - min(zs)
        scene.render.resolution_x, scene.render.resolution_y = 600, 1000
        look(cam, (0.0, front * 5.0, mid), (0, 0, mid), 50 * 5.0 / (H * 1.1 / 0.036 * 1.0) * 1.0 if False else 85)
        # frame body: distance for 85 mm lens, sensor 36 horizontal -> use vertical fit
        cam.data.sensor_fit = "VERTICAL"
        cam.data.sensor_height = 24
        dist = H * 1.1 * 85 / 24
        look(cam, (0.0, front * dist, mid), (0, 0, mid), 85)
        scene.render.filepath = os.path.join(out, "%s_body.png" % name)
        bpy.ops.render.render(write_still=True)
        scene.render.resolution_x, scene.render.resolution_y = 700, 700
        fc = (head.x, head.y, head.z + 0.07)
        look(cam, (fc[0] + 0.25, fc[1] + front * 0.9, fc[2] + 0.02), fc, 85)
        scene.render.filepath = os.path.join(out, "%s_face.png" % name)
        bpy.ops.render.render(write_still=True)
        look(cam, (fc[0] + 0.9, fc[1] + 0.0, fc[2] + 0.02), fc, 85)
        scene.render.filepath = os.path.join(out, "%s_profile.png" % name)
        bpy.ops.render.render(write_still=True)
        look(cam, (fc[0], fc[1] - front * 0.9, fc[2] + 0.1), fc, 85)
        scene.render.filepath = os.path.join(out, "%s_back.png" % name)
        bpy.ops.render.render(write_still=True)
    with open(os.path.join(out, "bases.json"), "w") as f:
        json.dump(report, f, indent=1)
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
