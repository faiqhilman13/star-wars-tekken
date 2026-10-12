"""REVIEW RENDERS (EEVEE look-dev) for the Saber Duel fighters, matching the contract frame (faces +X).

  python tools/blender/run.py tools/blender/sd_review.py -- --blend <file> --out <dir> \
      [--shots body,face,hands,gameplay] [--poses crouch,lunge,...] [--light studio|game] [--hide-hair]

Azimuth is measured from the character's front (+X) toward its near/right side (-Y): 0 = front,
90 = the in-game side camera, 180 = back, 270 = far side. The in-game camera sees the fighter at about
az 73 (side view, fighter yawed PRESENT_YAW = 0.3 rad toward the camera), elevation ~4 deg.
Every shot is written as <out>/<name>.png; render_info.json lists them.
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sd_poses  # noqa: E402
import sd_util as U  # noqa: E402

RENDERABLE = {"MESH", "CURVES"}


def view_dir(az, el):
    az, el = math.radians(az), math.radians(el)
    return Vector((math.cos(az) * math.cos(el), -math.sin(az) * math.cos(el), math.sin(el)))


def scene_objects():
    return [o for o in bpy.data.objects if o.type in RENDERABLE and o.visible_get() and not o.hide_render
            and not o.name.startswith("_rv") and not any(c.name in ("REF", "HIGH", "COLLISION") for c in o.users_collection)]


def bbox(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objs:
        eo = o.evaluated_get(dg)
        pts += [eo.matrix_world @ Vector(c) for c in eo.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def camera(scene):
    cam = bpy.data.objects.get("_rv_cam")
    if cam is None:
        cam = bpy.data.objects.new("_rv_cam", bpy.data.cameras.new("_rv_cam"))
        scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def aim_camera(cam, target, az, el, lens, frame_h, aspect):
    """Place a perspective camera so a frame_h tall window around target fills the image height."""
    d = view_dir(az, el)
    cam.data.type = "PERSP"
    cam.data.lens = lens
    cam.data.sensor_fit = "VERTICAL"
    cam.data.sensor_height = 24.0
    dist = frame_h * lens / 24.0
    cam.location = Vector(target) + d * dist
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = (-d).to_track_quat("-Z", "Y")
    cam.data.clip_start = 0.01
    cam.data.clip_end = dist * 10 + 50


def lights(scene, preset):
    for o in [o for o in bpy.data.objects if o.name.startswith("_rv_lgt")]:
        bpy.data.objects.remove(o, do_unlink=True)
    world = scene.world or bpy.data.worlds.new("_rv_world")
    scene.world = world
    nt = world.node_tree
    bg = next((n for n in nt.nodes if n.type == "BACKGROUND"), None)
    if bg is None:
        bg = nt.nodes.new("ShaderNodeBackground")
        out = next((n for n in nt.nodes if n.type == "OUTPUT_WORLD"), None) or nt.nodes.new("ShaderNodeOutputWorld")
        nt.links.new(bg.outputs[0], out.inputs[0])
    if preset == "game":
        # mirrors src/render/Arena.ts: cool key DirectionalLight(0xe4eaff, 2.3) from game (-3.2, 10, 4.6), orange
        # rim DirectionalLight(0xff8a3c, 2.0) from (0, -3.2, -10) + two rim spots (0xff7a30, 360 cd at ~15 m) from
        # (+-12, -1.2, -9), HemisphereLight(0x7088b8, 0x8a4220, 0.8) + a dim environment as the world colour.
        # Sun strength = three.js directional intensity (both: radiance = E * albedo * cos / pi).
        bg.inputs[0].default_value = (0.075, 0.06, 0.07, 1)
        bg.inputs[1].default_value = 1.0
        import sd_contract as C
        suns = [("key", (-3.2, 10, 4.6), 2.3, 0xE4EAFF), ("rim", (0, -3.2, -10), 2.0, 0xFF8A3C),
                ("rimL", (-12, -1.2, -9), 1.6, 0xFF7A30), ("rimR", (12, -1.2, -9), 1.6, 0xFF7A30)]
        for name, gp, strength, hexc in suns:
            ld = bpy.data.lights.new("_rv_lgt_" + name, "SUN")
            ld.energy = strength
            ld.color = C.hex_to_linear(hexc)[:3]
            ld.angle = math.radians(2.0)
            lo = bpy.data.objects.new("_rv_lgt_" + name, ld)
            scene.collection.objects.link(lo)
            d = Vector(C.game_to_blender(gp)).normalized()        # direction toward the light
            lo.location = Vector((0, 0, 1.2)) + d * 4.0
            lo.rotation_mode = "QUATERNION"
            lo.rotation_quaternion = (-d).to_track_quat("-Z", "Y")
        return
    else:
        # neutral look-dev: exposed so mid skin sits mid-curve (the old 650 W key pushed skin into the tone-curve
        # shoulder and flattened every albedo difference)
        bg.inputs[0].default_value = (0.05, 0.055, 0.065, 1)
        bg.inputs[1].default_value = 0.7
        rig = [("key", (35, 35), 300, (1.0, 0.95, 0.88), 2.0), ("fill", (-60, 10), 100, (0.85, 0.9, 1.0), 3.0),
               ("rim", (170, 30), 400, (0.85, 0.9, 1.0), 1.5), ("bounce", (60, -35), 45, (1.0, 0.9, 0.8), 4.0)]
    for name, (az, el), power, colr, size in rig:
        ld = bpy.data.lights.new("_rv_lgt_" + name, "AREA")
        ld.energy = power
        ld.color = colr
        ld.size = size
        lo = bpy.data.objects.new("_rv_lgt_" + name, ld)
        scene.collection.objects.link(lo)
        d = view_dir(az, el)
        lo.location = Vector((0, 0, 1.2)) + d * 4.0
        lo.rotation_mode = "QUATERNION"
        lo.rotation_quaternion = (-d).to_track_quat("-Z", "Y")


def floor(scene, on):
    ob = bpy.data.objects.get("_rv_floor")
    if not on:
        if ob:
            bpy.data.objects.remove(ob, do_unlink=True)
        return
    if ob is None:
        me = bpy.data.meshes.new("_rv_floor")
        s = 6.0
        me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
        ob = bpy.data.objects.new("_rv_floor", me)
        scene.collection.objects.link(ob)
        m = bpy.data.materials.new("_rv_floor")
        b = U.principled(m.node_tree)
        b.inputs["Base Color"].default_value = (0.09, 0.09, 0.1, 1)
        b.inputs["Roughness"].default_value = 0.7
        me.materials.append(m)


def setup(scene, a):
    U.eevee(scene)
    ee = scene.eevee
    for attr, val in (("taa_render_samples", a.samples), ("use_shadows", True), ("use_raytracing", True)):
        if hasattr(ee, attr):
            try:
                setattr(ee, attr, val)
            except Exception:
                pass
    for name in ("ACES 2.0", "ACES 1.3", "AgX"):
        try:
            scene.view_settings.view_transform = name
            break
        except TypeError:
            continue
    scene.view_settings.look = "None"
    scene.render.film_transparent = a.transparent
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA" if a.transparent else "RGB"
    for o in bpy.data.objects:
        if o.type == "MESH" and any(c.name in ("REF",) for c in o.users_collection):
            o.hide_render = True
        if o.type == "EMPTY" and o.empty_display_type == "IMAGE":
            o.hide_render = True
    if a.hide:
        for n in a.hide.split(","):
            if n in bpy.data.objects:
                bpy.data.objects[n].hide_render = True


def add_hilts(scene, report_path, arm):
    """Saber-hilt proxies (r = 0.0215, 0.26 m, metal) through each fist along game z, parented to the hand bone."""
    import bmesh
    import sd_contract as C
    rep = json.load(open(report_path))
    m = bpy.data.materials.new("_rv_hilt")
    b = U.principled(m.node_tree)
    b.inputs["Base Color"].default_value = (0.55, 0.57, 0.6, 1)
    b.inputs["Metallic"].default_value = 1.0
    b.inputs["Roughness"].default_value = 0.3
    for side, s in (("r", "N"), ("l", "F")):
        g = rep["grip"][side]["grip_centre_offset_from_contract_wrist_game"]
        w = C.JOINTS["hand" + s][1]
        c = Vector(C.game_to_blender((w[0] + g[0], w[1] + g[1], w[2] + g[2])))
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.0215, radius2=0.0215, depth=0.26)
        me = bpy.data.meshes.new("_rv_hilt_" + s)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new("_rv_hilt_" + s, me)
        scene.collection.objects.link(ob)
        me.materials.append(m)
        from mathutils import Euler, Matrix
        mw = Matrix.LocRotScale(c, Euler((math.radians(90), 0, 0)), None)   # cylinder along Blender Y = game z
        ob.matrix_world = mw
        if arm:
            ob.parent = arm
            ob.parent_type = "BONE"
            ob.parent_bone = "hand" + s
            bpy.context.view_layer.update()
            ob.matrix_world = mw


def render(scene, path, w, h):
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("rendered", path, flush=True)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--shots", default="body,face,hands,gameplay")
    ap.add_argument("--poses", default="")
    ap.add_argument("--pose-views", default="73,20")
    ap.add_argument("--light", default="studio")
    ap.add_argument("--samples", type=int, default=48)
    ap.add_argument("--transparent", action="store_true")
    ap.add_argument("--floor", action="store_true")
    ap.add_argument("--hide", default="")
    ap.add_argument("--prefix", default="")
    ap.add_argument("--morph", default="", help="shape key name=value to set before rendering")
    ap.add_argument("--hilts", default="", help="body_report.json: add grip-radius hilt proxies at the measured grip centres")
    ap.add_argument("--blade", default="", help="hex colour: a point light at the sword hand standing in for the blade")
    ap.add_argument("--toon", action="store_true", help="v5 anime masters: toon look + inverted-hull outlines from "
                                                         "the materials' toon extras (sd_toon_preview)")
    ap.add_argument("--no-outline", action="store_true")
    a = ap.parse_args(U.args_after_dashes())
    a.out = os.path.abspath(a.out)
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a.blend))
    scene = bpy.context.scene
    setup(scene, a)
    if a.toon:
        import sd_toon_preview
        sd_toon_preview.apply(outlines=not a.no_outline)
        scene.view_settings.view_transform = "Standard"      # the runtime's toon output is not tone-mapped
    lights(scene, a.light)
    if a.toon:          # the runtime cel terminator has no self-shadowing (EEVEE shadow maps alias into blocks)
        for ld in bpy.data.lights:
            ld.use_shadow = False
    floor(scene, a.floor)
    os.makedirs(a.out, exist_ok=True)
    cam = camera(scene)
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE" and "RIG_DEF" in [c.name for c in o.users_collection]), None)
    if a.morph:
        k, v = a.morph.split("=")
        for o in bpy.data.objects:
            if o.type == "MESH" and o.data.shape_keys and k in o.data.shape_keys.key_blocks:
                o.data.shape_keys.key_blocks[k].value = float(v)
    if a.hilts:
        add_hilts(scene, a.hilts, arm)
        for n in a.hide.split(","):
            if n in bpy.data.objects:
                bpy.data.objects[n].hide_render = True
    objs = [o for o in scene_objects() if not o.name.startswith("_rv_hilt")]
    lo, hi = bbox(objs)
    H = hi.z - lo.z
    info = {"blend": a.blend, "renders": {}}
    shots = [s for s in a.shots.split(",") if s]
    pre = a.prefix

    def shoot(name, target, az, el, lens, frame_h, w, h):
        aim_camera(cam, target, az, el, lens, frame_h, w / h)
        p = render(scene, os.path.join(a.out, pre + name + ".png"), w, h)
        info["renders"][name] = {"file": p, "az": az, "el": el, "lens": lens, "frame_h": frame_h}

    mid = Vector((0.0, 0.0, (lo.z + hi.z) / 2))
    if "body" in shots:
        for name, az in (("front", 0), ("threequarter", 35), ("side", 90), ("back", 180), ("far_side", 270)):
            shoot("body_" + name, mid, az, 3, 70, H * 1.08, 800, 1300)
    if "face" in shots:
        head = Vector((0.03, 0.0, hi.z - 0.13))
        shoot("face_threequarter", head, 28, 4, 85, 0.36, 900, 1100)
        shoot("face_front", head, 0, 2, 85, 0.36, 900, 1100)
        shoot("face_profile", head, 90, 2, 85, 0.36, 900, 1100)
    if "upper" in shots:                # costume review: head to hips
        up = Vector((0.0, 0.0, hi.z - 0.42))
        shoot("upper_threequarter", up, 30, 4, 70, 0.95, 900, 1100)
        shoot("upper_backquarter", up, 150, 6, 70, 0.95, 900, 1100)
        shoot("upper_side", up, 90, 3, 70, 0.95, 900, 1100)
    if "head" in shots:                 # hair review: the back and the other side of the head
        head = Vector((0.0, 0.0, hi.z - 0.13))
        shoot("head_back", head, 180, 6, 85, 0.36, 900, 1100)
        shoot("head_backquarter", head, 140, 10, 85, 0.36, 900, 1100)
        shoot("head_far_side", head, 270, 2, 85, 0.36, 900, 1100)
        shoot("head_top", head, 20, 55, 85, 0.40, 900, 1100)
    if "hands" in shots:
        grips = {}
        if a.hilts:
            import sd_contract as C
            rep = json.load(open(a.hilts))
            for sd_, s_ in (("r", "N"), ("l", "F")):
                g = rep["grip"][sd_]["grip_centre_offset_from_contract_wrist_game"]
                w = C.JOINTS["hand" + s_][1]
                grips[s_] = Vector(C.game_to_blender((w[0] + g[0], w[1] + g[1], w[2] + g[2])))
        for side, y in (("N", -0.19), ("F", 0.19)):
            tgt = grips.get(side, Vector((0.0, y, 0.92))) + Vector((0, 0, 0.035))
            outer = 90 if side == "N" else 270
            shoot("hand%s_outer" % side, tgt, outer, 5, 85, 0.24, 800, 800)
            shoot("hand%s_front" % side, tgt, 0 + (25 if side == "N" else -25), 5, 85, 0.24, 800, 800)
            shoot("hand%s_back" % side, tgt, 180 + (-25 if side == "N" else 25), 5, 85, 0.24, 800, 800)
            shoot("hand%s_below" % side, tgt, outer, -70, 85, 0.24, 800, 800)
            shoot("hand%s_axis" % side, tgt - Vector((0, 0, 0.02)), outer, 0, 85, 0.16, 800, 800)
    if a.blade:
        import sd_contract as C
        ld = bpy.data.lights.new("_rv_lgt_blade", "POINT")
        ld.energy = 40.0
        ld.shadow_soft_size = 0.06
        ld.color = C.hex_to_linear(int(a.blade, 16))[:3]
        lo = bpy.data.objects.new("_rv_lgt_blade", ld)
        scene.collection.objects.link(lo)
        hand = Vector(C.joint_blender("handN")) if hasattr(C, "joint_blender") else Vector((0, -0.19, 1.02))
        lo.location = hand + Vector((0.10, -0.06, -0.02))          # just in front of the fist, toward the camera
    if "turntable" in shots:
        for az in range(0, 360, 45):
            shoot("turn_%03d" % az, mid, az, 3, 70, H * 1.06, 560, 900)
    if "gamelook" in shots:
        # the game's side camera: az 73 (side view with the 0.3 rad present yaw), elev 4, 35 mm; 300 / 600 px tall
        for px in (300, 600):
            hpx = int(px * 1.25)
            shoot("gamelook_%dpx" % px, mid, 73, 4, 35, H * 1.25, int(hpx * 0.8), hpx)
    if "gameplay" in shots:
        for px in (200, 300):
            hpx = int(px * 1.25)
            shoot("gameplay_%dpx" % px, mid, 73, 4, 35, H * 1.25, int(hpx * 0.8), hpx)
    if a.poses and arm:
        meshes = [o for o in objs if o.type == "MESH"]
        views = [float(v) for v in a.pose_views.split(",")]
        for pname in [p for p in a.poses.split(",") if p]:
            sd_poses.pose(arm, pname, meshes)
            plo, phi = bbox(objs)
            pc = (plo + phi) / 2
            ext = max(phi.z - plo.z, (phi.x - plo.x) * 1300 / 1100, 0.9)
            for v in views:
                shoot("pose_%s_az%d" % (pname, v), pc, v, 6, 50, ext * 1.15, 1100, 1300)
        sd_poses.pose(arm, "rest")
    U.write_json(os.path.join(a.out, pre + "render_info.json"), info)


if __name__ == "__main__":
    main()
