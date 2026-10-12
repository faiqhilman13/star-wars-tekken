"""Ad-hoc toon review shots (same look as sd_review.py --toon) for close-ups the standard set doesn't frame.

  python tools/blender/run.py art/characters/asha/build/shots.py -- --blend <master> --out <dir>
      --shot name:tx,ty,tz:az:el:frame_h[:w:h] [--shot ...] [--pose crouch] [--light studio|game] [--morph k=v]
"""
import argparse
import os
import sys
import types

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.join(os.environ.get("SABER_REPO", "."), "tools", "blender"))
import sd_poses  # noqa: E402
import sd_review as RV  # noqa: E402
import sd_toon_preview  # noqa: E402
import sd_util as U  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--shot", action="append", default=[])
    ap.add_argument("--pose", default="")
    ap.add_argument("--light", default="studio")
    ap.add_argument("--morph", action="append", default=[])
    ap.add_argument("--hide", default="")
    a = ap.parse_args(U.args_after_dashes())
    a.out = os.path.abspath(a.out)
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a.blend))
    scene = bpy.context.scene
    opts = types.SimpleNamespace(samples=32, transparent=False, hide=a.hide)
    RV.setup(scene, opts)
    sd_toon_preview.apply(outlines=True)
    scene.view_settings.view_transform = "Standard"
    for lt in [l for l in bpy.data.lights]:
        if hasattr(lt, "use_shadow"):
            lt.use_shadow = False
    RV.lights(scene, a.light)
    for lt in [l for l in bpy.data.lights]:
        if hasattr(lt, "use_shadow"):
            lt.use_shadow = False
    cam = RV.camera(scene)
    for m in a.morph:
        k, v = m.split("=")
        for o in bpy.data.objects:
            if o.type == "MESH" and o.data.shape_keys and k in o.data.shape_keys.key_blocks:
                o.data.shape_keys.key_blocks[k].value = float(v)
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if a.pose and arm:
        meshes = [o for o in bpy.data.objects if o.type == "MESH" and not o.name.startswith("_rv")]
        sd_poses.pose(arm, a.pose, meshes)
    os.makedirs(a.out, exist_ok=True)
    for spec in a.shot:
        parts = spec.split(":")
        name = parts[0]
        tgt = Vector(tuple(float(x) for x in parts[1].split(",")))
        az, el, fh = float(parts[2]), float(parts[3]), float(parts[4])
        w, h = (int(parts[5]), int(parts[6])) if len(parts) > 6 else (900, 900)
        RV.aim_camera(cam, tgt, az, el, 60, fh, w / h)
        RV.render(scene, os.path.join(a.out, name + ".png"), w, h)


if __name__ == "__main__":
    main()
