"""Render an exported fighter GLB as the engine receives it (re-imported, baked materials only), EEVEE, with the
game-like light preset, optional pose from sd_poses and morph values. Evidence for the runtime look after bake.

  python tools/blender/run.py tools/blender/sd_glb_render.py -- --glb public/models/kael.glb --out <dir>
      [--poses crouch,...] [--morph palmOpen=1] [--light game|studio]
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sd_poses  # noqa: E402
import sd_review as R  # noqa: E402
import sd_util as U  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--poses", default="")
    ap.add_argument("--morph", default="")
    ap.add_argument("--light", default="game")
    ap.add_argument("--prefix", default="glb_")
    a = ap.parse_args(U.args_after_dashes())
    a.out = os.path.abspath(a.out)
    os.makedirs(a.out, exist_ok=True)
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.glb))
    scene = bpy.context.scene

    class S:
        samples = 48
        transparent = False
        hide = ""
    R.setup(scene, S)
    R.lights(scene, a.light)
    cam = R.camera(scene)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if a.morph:
        k, v = a.morph.split("=")
        for o in meshes:
            if o.data.shape_keys and k in o.data.shape_keys.key_blocks:
                o.data.shape_keys.key_blocks[k].value = float(v)
    # the glTF importer gives bones its own orientation: drive the pose in world terms through the armature
    shots = [("front", 0), ("threequarter", 35), ("side", 90)]

    def frame_all(prefix):
        lo, hi = R.bbox(meshes)
        c = (lo + hi) / 2
        H = max(hi.z - lo.z, 0.9)
        for name, az in shots:
            R.aim_camera(cam, c, az, 4, 60, H * 1.1, 900 / 1300)
            R.render(scene, os.path.join(a.out, "%s%s%s.png" % (a.prefix, prefix, name)), 900, 1300)
        hpx = 250
        R.aim_camera(cam, c, 73, 4, 35, H * 1.25, 0.8)
        R.render(scene, os.path.join(a.out, "%s%sgameplay_200px.png" % (a.prefix, prefix)), int(hpx * 0.8), hpx)
    frame_all("")
    head = Vector((0.03, 0.0, 1.83))
    R.aim_camera(cam, head, 28, 4, 85, 0.36, 900 / 1100)
    R.render(scene, os.path.join(a.out, "%sface.png" % a.prefix), 900, 1100)


if __name__ == "__main__":
    main()
