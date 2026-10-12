"""PHASE 5 BAKE for a Saber Duel fighter, through the blender-image-to-3d skill's bake_maps.py.

  python tools/blender/run.py tools/blender/sd_bake.py -- --char kael [--res 2048] [--only GEO-kael_body,...]

1. Opens the master, writes a bake-prep copy: every object listed in BAKE_TARGETS gets a HIGH twin
   (<name>_high, same mesh, look-dev material with its procedural detail: skin pores, fabric weave, leather grain)
   so bake_maps.py can bake the tangent-space normal HIGH -> LOW (OpenGL +Y) and the base colour / roughness /
   metallic from the look-dev shaders.
2. Runs bake_maps.main() on that copy (maps per object from BAKE_TARGETS), --rebuild-material, saving
   <id>_baked.blend.
3. Renames each rebuilt "<object>_baked" material back to its contract name (MAT-skin, MAT-<id>_primary, ...),
   re-applies glTF metadata the rebuild loses (alpha mode etc.), packs textures to WebP (sRGB base colour,
   Non-Color data maps; data maps optionally downsized), and saves the delivery blend.
Objects whose material already is image-based and export-ready (eyes, hair atlas) keep their material; their
images are only converted to WebP.
"""
import argparse
import importlib.util
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sd_cloth as K  # noqa: E402
import sd_util as U  # noqa: E402

SKILL = os.environ.get("SKILL_DIR", os.path.join(os.path.expanduser("~"), ".claude", "skills", "blender-image-to-3d"))


def load_skill(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(SKILL, "scripts", name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def webp(img, path, size=None, quality=90, alpha=False):
    """Save an image as WebP (raw pixels, no view transform; optionally resized) and relink it."""
    if size and tuple(img.size) != (size, size):
        img.scale(size, size)
    cs = img.colorspace_settings.name
    src = img
    if alpha is False and img.channels == 4:
        # drop alpha: copy RGB into an RGB buffer so the WebP carries no alpha plane
        import numpy as np
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(-1, 4)
        px[:, 3] = 1.0
        src = bpy.data.images.new("_webp_tmp", w, h, alpha=False, float_buffer=False)
        src.colorspace_settings.name = cs
        src.pixels.foreach_set(px.ravel())
    src.file_format = "WEBP"
    src.filepath_raw = path
    src.save(filepath=path, quality=quality)
    if src is not img:
        bpy.data.images.remove(src)
    new = bpy.data.images.load(path, check_existing=False)
    new.colorspace_settings.name = cs
    new.name = os.path.splitext(os.path.basename(path))[0]
    img.user_remap(new)
    bpy.data.images.remove(img)
    return new


def gltf_occlusion(nt, socket):
    """Wire `socket` into a "glTF Material Output" group node's Occlusion input: the glTF exporter then writes
    occlusionTexture (sharing the ORM image when it is the same texture as metallicRoughness)."""
    name = "glTF Material Output"
    grp = bpy.data.node_groups.get(name)
    if grp is None:
        grp = bpy.data.node_groups.new(name, "ShaderNodeTree")
        grp.interface.new_socket("Occlusion", socket_type="NodeSocketFloat")
        for nm in ("Thickness", "Dispersion", "Iridescence Factor"):
            s_ = grp.interface.new_socket(nm, socket_type="NodeSocketFloat")
            s_.default_value = 0.0
    node = nt.nodes.new("ShaderNodeGroup")
    node.node_tree = grp
    node.location = (300, -500)
    nt.links.new(socket, node.inputs["Occlusion"])
    return node


def weave_blend(img, period=5.0, strength=0.35, seed=7):
    """Composite a tiling plain-weave relief into a baked tangent-space normal image (UDN blend): coarse wool /
    linen threads, over-under alternating every `period` texels, with per-thread thickness jitter (seeded)."""
    import numpy as np
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    n1 = px[..., :3] * 2.0 - 1.0
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = x / period, y / period
    iu, iv = np.floor(u).astype(int), np.floor(v).astype(int)
    fu, fv = u - iu, v - iv
    jit_u = rng.uniform(0.75, 1.15, w // int(period) + 2)[np.clip(iu, 0, None) % (w // int(period) + 2)]
    jit_v = rng.uniform(0.75, 1.15, h // int(period) + 2)[np.clip(iv, 0, None) % (h // int(period) + 2)]
    warp = np.sin(np.pi * fu) * jit_u * (0.75 + 0.25 * np.cos(np.pi * (2 * fv - 1)))
    weft = np.sin(np.pi * fv) * jit_v * (0.75 + 0.25 * np.cos(np.pi * (2 * fu - 1)))
    over = ((iu + iv) % 2) == 0
    hgt = np.where(over, np.maximum(warp, 0.6 * weft), np.maximum(weft, 0.6 * warp))
    gy, gx = np.gradient(hgt)
    n2 = np.stack([-gx * strength, -gy * strength, np.ones_like(hgt)], axis=-1)
    n = np.stack([n1[..., 0] + n2[..., 0], n1[..., 1] + n2[..., 1], n1[..., 2]], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    px[..., :3] = n * 0.5 + 0.5
    img.pixels.foreach_set(px.ravel())
    img.update()


def orm_from(m, path, size=None, ao_path=None):
    """Replace separate roughness/metallic image links on the material's Principled BSDF with one ORM image
    (R = baked ambient occlusion when ao_path is given, else 1) and wire R to the glTF occlusion output."""
    import numpy as np
    nt = m.node_tree
    bsdf = U.principled(nt)
    srcs = {}
    for sock in ("Roughness", "Metallic"):
        if bsdf.inputs[sock].links:
            srcs[sock] = bsdf.inputs[sock].links[0].from_node
    if not srcs:
        return None
    ref = next(iter(srcs.values())).image
    w, h = (size, size) if size else tuple(ref.size)

    def chan(sock, default):
        node = srcs.get(sock)
        if node is None or node.type != "TEX_IMAGE":
            return np.full(w * h, bsdf.inputs[sock].default_value if not bsdf.inputs[sock].links else default, dtype=np.float32)
        img = node.image.copy()
        if tuple(img.size) != (w, h):
            img.scale(w, h)
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        bpy.data.images.remove(img)
        return px.reshape(-1, 4)[:, 0]
    r = np.ones(w * h, dtype=np.float32)
    if ao_path and os.path.exists(ao_path):
        ao = bpy.data.images.load(ao_path, check_existing=False)
        ao.colorspace_settings.name = "Non-Color"
        if tuple(ao.size) != (w, h):
            ao.scale(w, h)
        apx = np.empty(w * h * 4, dtype=np.float32)
        ao.pixels.foreach_get(apx)
        r = apx.reshape(-1, 4)[:, 0].copy()
        bpy.data.images.remove(ao)
    g = chan("Roughness", 0.5)
    b = chan("Metallic", 0.0)
    orm = bpy.data.images.new("_orm", w, h, alpha=False, float_buffer=False)
    orm.colorspace_settings.name = "Non-Color"
    orm.pixels.foreach_set(np.stack([r, g, b, np.ones_like(r)], axis=1).ravel())
    orm = webp(orm, path, quality=95)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = orm
    tex.location = (-700, -300)
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    sep.location = (-400, -300)
    nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    if ao_path and os.path.exists(ao_path):
        gltf_occlusion(nt, sep.outputs["Red"])
    for node in srcs.values():
        if node.type == "TEX_IMAGE":
            img = node.image
            nt.nodes.remove(node)
            if img and img.users == 0:
                bpy.data.images.remove(img)
    return orm


def raster_uv(ob, res):
    """Boolean coverage (res x res, Blender pixel order: row 0 = v 0) of the mesh's UV triangles."""
    import numpy as np
    me = ob.data
    uv = me.uv_layers.active.data
    mask = np.zeros((res, res), dtype=bool)
    for poly in me.polygons:
        pts = [tuple(uv[li].uv) for li in poly.loop_indices]
        for k in range(1, len(pts) - 1):
            t = np.array([pts[0], pts[k], pts[k + 1]], dtype=np.float64) * res
            x0, y0 = np.floor(t.min(axis=0)).astype(int)
            x1, y1 = np.ceil(t.max(axis=0)).astype(int)
            x0, y0 = max(x0, 0), max(y0, 0)
            x1, y1 = min(x1, res - 1), min(y1, res - 1)
            if x1 < x0 or y1 < y0:
                continue
            ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
            px, py = xs + 0.5, ys + 0.5
            (ax, ay), (bx, by), (cx, cy) = t
            d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(d) < 1e-12:
                continue
            l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d
            l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d
            l3 = 1.0 - l1 - l2
            e = -0.02
            inside = (l1 >= e) & (l2 >= e) & (l3 >= e)
            mask[y0:y1 + 1, x0:x1 + 1] |= inside
    return mask


def composite_group(pieces, kinds, res, piece_dir, texdir, target, margin=12):
    """Per-piece bakes (each from its own HIGH twin, same shared UV layout) -> one image per map: every texel
    takes the piece whose UV triangles cover it, then the islands are bled `margin` texels outward."""
    import numpy as np
    masks = {p: raster_uv(bpy.data.objects[p], res) for p in pieces}
    defaults = {"normal": (0.5, 0.5, 1.0), "ao": (1.0, 1.0, 1.0), "roughness": (0.8, 0.8, 0.8),
                "basecolor": (0.6, 0.6, 0.6), "metallic": (0.0, 0.0, 0.0)}
    out_paths = {}
    for kind in kinds:
        out = np.zeros((res, res, 4), dtype=np.float32)
        out[..., 3] = 1.0
        got = np.zeros((res, res), dtype=bool)
        data = kind != "basecolor"
        for p in pieces:
            path = os.path.join(piece_dir, "%s_%s.png" % (p, kind))
            if not os.path.exists(path):
                continue
            img = bpy.data.images.load(path, check_existing=False)
            img.colorspace_settings.name = "Non-Color" if data else "sRGB"
            px = np.empty(res * res * 4, dtype=np.float32)
            img.pixels.foreach_get(px)
            bpy.data.images.remove(img)
            px = px.reshape(res, res, 4)
            sel = masks[p] & ~got
            out[sel] = px[sel]
            got |= sel
        for _ in range(margin):                                   # bleed the islands outward
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                src = np.roll(np.roll(got, dy, 0), dx, 1)
                val = np.roll(np.roll(out, dy, 0), dx, 1)
                sel = src & ~got
                out[sel] = val[sel]
                got |= sel
        out[~got, :3] = defaults.get(kind, (0.5, 0.5, 0.5))
        if kind == "ao":                                          # 32-sample AO grain: light 3x3 box blur
            acc = np.zeros_like(out[..., :3])
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    acc += np.roll(np.roll(out[..., :3], dy, 0), dx, 1)
            out[..., :3] = acc / 9.0
        name = "%s_%s" % (target, kind)
        img = bpy.data.images.get(name)
        if img:
            bpy.data.images.remove(img)
        img = bpy.data.images.new(name, res, res, alpha=False, float_buffer=False)
        img.colorspace_settings.name = "Non-Color" if data else "sRGB"
        img.pixels.foreach_set(out.ravel())
        path = os.path.join(texdir, name + ".png")
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        img.filepath = path
        out_paths[kind] = img
    return out_paths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", required=True)
    ap.add_argument("--res", type=int, default=2048)
    ap.add_argument("--samples", type=int, default=32)
    a = ap.parse_args(U.args_after_dashes())
    cdir = U.char_dir(a.char)
    master = os.path.join(cdir, "build", "cache", "%s_assembled.blend" % a.char)     # sd_assemble output
    if not os.path.exists(master):
        master = os.path.join(cdir, "%s_master.blend" % a.char)
    prep = os.path.join(cdir, "build", "cache", "%s_bakeprep.blend" % a.char)
    baked = os.path.join(cdir, "%s_baked.blend" % a.char)
    texdir = os.path.join(cdir, "textures")
    plan_path = os.path.join(cdir, "build", "bake_plan.json")
    plan = json.load(open(plan_path))
    # plan: {"targets": {"GEO-kael_body": {"material": "MAT-skin", "maps": "basecolor,roughness,normal",
    #                                      "data_size": 1024}}, "convert": {"GEO-kael_eyes": 512, ...}}

    # 1. bake prep: HIGH twins (targets with "twin": false bake their surface from the LOW itself), tintable
    # fabrics baked neutral (sd_tint white; the palette colour returns as baseColorFactor after the rebuild)
    bpy.ops.wm.open_mainfile(filepath=master)
    high = U.col("HIGH")
    groups_path = os.path.join(cdir, "build", "cache", "%s_groups.json" % a.char)
    groups0 = json.load(open(groups_path)) if os.path.exists(groups_path) else {}
    members = {name: [bpy.data.objects[p] for p in groups0[name]] if name in groups0 else [bpy.data.objects[name]]
               for name in plan["targets"]}
    tints = {}
    for name, t in plan["targets"].items():
        m = members[name][0].data.materials[0]
        tn = m.node_tree.nodes.get("sd_tint")
        if t.get("tint") and tn is not None:
            tints[name] = tuple(tn.inputs[7].default_value)
            tn.inputs[7].default_value = (1.0, 1.0, 1.0, 1.0)
        if t.get("metallic_constant") is not None:      # Cycles' colour pass is black on metals: bake at metallic 0
            U.principled(m.node_tree).inputs["Metallic"].default_value = 0.0
    for name, t in plan["targets"].items():
        if not t.get("twin", True):
            continue
        lo = bpy.data.objects[name]
        tw = bpy.data.objects.get(name + "_high")
        if tw:
            bpy.data.objects.remove(tw, do_unlink=True)
        tw = lo.copy()
        tw.data = lo.data.copy()
        tw.name = name + "_high"
        tw.parent = None
        tw.matrix_world = lo.matrix_world.copy()
        for m in list(tw.modifiers):
            tw.modifiers.remove(m)
        if tw.data.shape_keys:
            tw.shape_key_clear()
        high.objects.link(tw)
    for o in high.objects:
        o.hide_render = False
        o.hide_viewport = False
    # AO: occlusion from geometry within 6 cm (crevices, layers, collars), not from the whole figure
    if bpy.context.scene.world is None:
        bpy.context.scene.world = bpy.data.worlds.new("bake_world")
    bpy.context.scene.world.light_settings.distance = 0.06
    # LOW bake targets never occlude: AO rays meet the HIGH set (and the hair, eyes, brows and lashes, which have
    # no twins); the selected-to-active rays start from the LOW cage, which needs no ray visibility
    for name in plan["targets"]:
        for lo in members[name]:
            for attr in ("visible_camera", "visible_diffuse", "visible_glossy", "visible_transmission",
                         "visible_volume_scatter", "visible_shadow"):
                if hasattr(lo, attr):
                    setattr(lo, attr, False)
    U.save(prep)

    # 2a. "self_normal" targets: the tangent normal of the object's own look-dev shading (bump/micro detail),
    # baked without selected-to-active rays. Used where the rest mesh interpenetrates itself (the arms hang
    # into the lats and the fists against the hips at rest), which makes HIGH->LOW cage rays hit other skin.
    bm = load_skill("bake_maps")
    self_normals = {}
    if any(t.get("self_normal") for t in plan["targets"].values()):
        bpy.ops.wm.open_mainfile(filepath=prep)
        scene = bpy.context.scene
        scene.render.engine = "CYCLES"
        scene.cycles.samples = a.samples
        scene.render.bake.target = "IMAGE_TEXTURES"
        for name, t in plan["targets"].items():
            if not t.get("self_normal"):
                continue
            lo = bpy.data.objects[name]
            img = bm.new_image(name + "_normal", t.get("res", a.res), True)
            ns = argparse.Namespace(extrusion=0.0, ray_dist=0.0, margin=16)
            bm.bake(scene, "NORMAL", lo, None, img, ns)
            path = os.path.join(texdir, name + "_normal.png")
            img.filepath_raw = path
            img.file_format = "PNG"
            img.save()
            self_normals[name] = path
            U.log("self normal", path)

    # 2b. bake_maps: single-object targets (the body) bake and rebuild in place; costume groups bake piece by piece
    # (each piece from its own HIGH twin, into the material's shared UV layout) and are composited, joined and
    # given the rebuilt material afterwards
    groups_path = os.path.join(cdir, "build", "cache", "%s_groups.json" % a.char)
    groups = json.load(open(groups_path)) if os.path.exists(groups_path) else {}
    piece_dir = os.path.join(cdir, "build", "cache", "bake_pieces")
    os.makedirs(piece_dir, exist_ok=True)
    if os.path.exists(baked + ".tmp"):
        os.remove(baked + ".tmp")
    for name, t in plan["targets"].items():
        common = ["--low", "LOW", "--high", "HIGH", "--res", str(t.get("res", a.res)), "--maps", t["maps"],
                  "--extrusion", str(t.get("extrusion", 0.004)), "--ray-dist", str(t.get("ray_dist", 0.01)),
                  "--margin", "16", "--samples", str(a.samples), "--match-by-name"]
        if name in groups:
            for piece in groups[name]:
                bm.main(bm.parse(["--blend", prep, "--only", piece, "--out", piece_dir] + common))
            continue
        src = prep if not os.path.exists(baked + ".tmp") else baked + ".tmp"
        bm.main(bm.parse(["--blend", src, "--only", name, "--out", texdir, "--rebuild-material",
                          "--save", baked + ".tmp"] + common))
    if not os.path.exists(baked + ".tmp"):
        import shutil
        shutil.copyfile(prep, baked + ".tmp")
    bpy.ops.wm.open_mainfile(filepath=baked + ".tmp")
    for name, pieces in groups.items():
        t = plan["targets"].get(name)
        if t is None:
            continue
        kinds = [k for k in t["maps"].split(",") if k]
        imgs = composite_group(pieces, kinds, t.get("res", a.res), piece_dir, texdir, name)
        objs = [bpy.data.objects[p] for p in pieces]
        ob = K.join(objs, name)
        bm.rebuild_material(ob, {k: v for k, v in imgs.items() if k != "ao"})
        U.log("GROUP", name, len(pieces), "pieces", K.tris(ob), "tris")
    U.save(baked + ".tmp")
    os.replace(baked + ".tmp", baked)

    # 3. contract names, metadata, WebP
    bpy.ops.wm.open_mainfile(filepath=baked)
    for name, t in plan["targets"].items():
        ob = bpy.data.objects[name]
        m = ob.data.materials[0]
        if name in self_normals:
            nt = m.node_tree
            bsdf = U.principled(nt)
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = bpy.data.images.load(self_normals[name], check_existing=True)
            tex.image.colorspace_settings.name = "Non-Color"
            tex.image.name = name + "_normal"
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nt.links.new(tex.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        old = bpy.data.materials.get(t["material"])
        if old and old != m:
            old.name = t["material"] + "_lookdev"
        m.name = t["material"]
        for n in m.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                key = n.image.name.rsplit("_", 1)[-1]
                size = t.get("data_size") if key in ("roughness", "metallic", "ao") else None
                if key == "normal":
                    size = t.get("normal_size")
                    if t.get("weave"):
                        weave_blend(n.image, **t["weave"])
                n.image = webp(n.image, os.path.join(texdir, "%s_%s.webp" % (t["material"].replace("MAT-", ""), key)),
                               size=size, quality=t.get("quality", 90), alpha=False)
    # palette tint back as a constant MULTIPLY after the baked base colour: glTF baseColorFactor
    for name, col in tints.items():
        m = bpy.data.objects[name].data.materials[0]
        nt = m.node_tree
        bsdf = U.principled(nt)
        src = bsdf.inputs["Base Color"].links[0].from_socket
        mx = nt.nodes.new("ShaderNodeMix")
        mx.name = mx.label = "sd_tint"
        mx.data_type = "RGBA"
        mx.blend_type = "MULTIPLY"
        mx.inputs["Factor"].default_value = 1.0
        mx.inputs[7].default_value = col
        nt.links.new(src, mx.inputs[6])
        nt.links.new(mx.outputs[2], bsdf.inputs["Base Color"])
        m["sd_tint_linear"] = [round(c, 5) for c in col[:3]]
    # ORM packing (R = occlusion 1.0 or baked AO, G = roughness, B = metallic) so the glTF exporter passes the
    # WebP through as metallicRoughnessTexture instead of compositing a PNG
    for name, t in plan["targets"].items():
        m = bpy.data.objects[name].data.materials[0]
        if t.get("metallic_constant") is not None:
            U.principled(m.node_tree).inputs["Metallic"].default_value = float(t["metallic_constant"])
        ao_path = os.path.join(texdir, "%s_ao.png" % name) if "ao" in t["maps"] else None
        orm_from(m, os.path.join(texdir, "%s_orm.webp" % t["material"].replace("MAT-", "")), t.get("data_size"),
                 ao_path=ao_path)
        m.use_backface_culling = not t.get("double_sided", False)
    for name, conv in plan.get("convert", {}).items():
        ob = bpy.data.objects[name]
        for m in ob.data.materials:
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image and not n.image.filepath.lower().endswith(".webp"):
                    n.image = webp(n.image, os.path.join(texdir, "%s.webp" % m.name.replace("MAT-", "")),
                                   size=conv["size"], quality=conv.get("quality", 90), alpha=conv.get("alpha", False))
            m.use_backface_culling = not conv.get("alpha", False)
    # HIGH twins and look-dev leftovers stay out of the delivery file
    for o in list(U.col("HIGH").objects):
        bpy.data.objects.remove(o, do_unlink=True)
    U.purge_orphans()
    U.save(baked)
    U.log("BAKED", baked, sorted(m.name for m in bpy.data.materials if m.users))


if __name__ == "__main__":
    main()
