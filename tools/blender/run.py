"""Run a Blender script headless with the VRM add-on (and MPFB) enabled (the contract's build command).

Usage:
  python tools/blender/run.py <script.py> [-- script args...]
  python tools/blender/run.py --skill review_render.py -- --blend ... (runs a blender-image-to-3d skill script)

Environment:
  BLENDER_BIN   path to blender.exe (default: Blender 5.2 install path)
  SKILL_DIR     blender-image-to-3d skill folder (default: ~/.claude/skills/blender-image-to-3d)
Exit code is Blender's.
"""
import os
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BLENDER = os.environ.get("BLENDER_BIN", r"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe")
SKILL_DIR = os.environ.get("SKILL_DIR", os.path.join(os.path.expanduser("~"), ".claude", "skills", "blender-image-to-3d"))
# add-ons the build scripts use: MPFB (v4 realistic, retired) and the VRM add-on (v5 anime, VRoid import / MToon)
ADDONS = ["bl_ext.user_default.vrm", "bl_ext.user_default.mpfb"]
if os.environ.get("SD_ADDONS"):
    ADDONS = os.environ["SD_ADDONS"].split(",")
ENABLE = ("import bpy\n"
          "for m in %r:\n"
          "    try:\n"
          "        bpy.ops.preferences.addon_enable(module=m)\n"
          "    except Exception as e:\n"
          "        print('addon', m, 'not enabled:', e)" % (ADDONS,))


def main() -> int:
    argv = sys.argv[1:]
    if not argv:
        print(__doc__)
        return 2
    rest = []
    if "--" in argv:
        i = argv.index("--")
        argv, rest = argv[:i], argv[i + 1:]
    if argv[0] == "--skill":
        script = os.path.join(SKILL_DIR, "scripts", argv[1])
        mpfb = False
    else:
        script = os.path.abspath(argv[0])
        mpfb = True
    cmd = [BLENDER, "--background", "--factory-startup", "-noaudio"]
    if mpfb:
        cmd += ["--python-expr", ENABLE]
    cmd += ["--python-exit-code", "1", "--python", script, "--"] + rest
    env = dict(os.environ)
    env["SABER_REPO"] = REPO.replace(os.sep, "/")   # scripts add tools/blender to sys.path themselves
    return subprocess.call(cmd, env=env)


if __name__ == "__main__":
    sys.exit(main())
