"""PHASE 9 EXPORT for a Saber Duel fighter, through the blender-image-to-3d skill's export_delivery.py.

  python tools/blender/run.py tools/blender/sd_export.py -- --char kael [--inferred "..."]

Opens <id>_baked.blend, strips build-only custom properties (owner tags) so they do not leak into glTF extras,
records the grip centres measured by the body phase as extras on the armature (gripCentreN / gripCentreF, game
coordinates relative to the hand joint), then runs export_delivery.main() (GLB, Y up, skins + morphs, modifiers not
applied because the body carries the palmOpen shape key, no animation). Writes art/characters/<id>/exports/<id>.glb
and the manifests; copies the GLB to public/models/<id>.glb and the manifest to art/characters/<id>/.
"""
import argparse
import importlib.util
import json
import os
import shutil
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sd_util as U  # noqa: E402

SKILL = os.environ.get("SKILL_DIR", os.path.join(os.path.expanduser("~"), ".claude", "skills", "blender-image-to-3d"))
STRIP = ("owner", "sd_part", "sd_tmp", "sd_role", "sd_tint_gain", "sd_alpha_mode", "sd_alpha_cutoff", "sd_piece", "sd_kind",
         "sd_tint_hex", "sd_tint_linear")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", required=True)
    ap.add_argument("--inferred", default="")
    a = ap.parse_args(U.args_after_dashes())
    cdir = U.char_dir(a.char)
    baked = os.path.join(cdir, "%s_baked.blend" % a.char)
    tmp = os.path.join(cdir, "build", "cache", "%s_export.blend" % a.char)
    out = os.path.join(cdir, "exports")
    bpy.ops.wm.open_mainfile(filepath=baked)
    for idb in list(bpy.data.objects) + list(bpy.data.materials) + list(bpy.data.meshes) + list(bpy.data.armatures):
        for k in STRIP:
            if k in idb.keys():
                del idb[k]
    rep_path = os.path.join(cdir, "review", "03_body", "body_report.json")
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    if os.path.exists(rep_path):
        rep = json.load(open(rep_path))
        for side, s in (("r", "N"), ("l", "F")):
            g = rep["grip"][side]["grip_centre_offset_from_contract_wrist_game"]
            arm["gripCentre" + s] = [round(x, 4) for x in g]
        arm["gripRadius"] = 0.0215
        arm["gripAxis"] = "hand-local +z (game z at rest)"
    U.save(tmp)
    spec = importlib.util.spec_from_file_location("export_delivery", os.path.join(SKILL, "scripts", "export_delivery.py"))
    ed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ed)
    ed.main(ed.parse(["--blend", tmp, "--out", out, "--name", a.char, "--format", "GLB",
                      "--collections", "LOW,RIG_DEF", "--no-apply", "--no-animation",
                      "--engine", "three.js GLTFLoader (Saber Duel runtime)", "--inferred", a.inferred]))
    glb = os.path.join(out, a.char + ".glb")
    dst = os.path.join(U.REPO, "public", "models")
    os.makedirs(dst, exist_ok=True)
    shutil.copyfile(glb, os.path.join(dst, a.char + ".glb"))
    shutil.copyfile(os.path.join(out, "asset-manifest.json"), os.path.join(cdir, "asset-manifest.json"))
    U.log("EXPORTED", glb, "->", os.path.join(dst, a.char + ".glb"), os.path.getsize(glb), "bytes")


if __name__ == "__main__":
    main()
