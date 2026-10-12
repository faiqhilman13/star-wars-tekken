"""Look-dev materials shared by every fighter: skin (SSS), eyes, and the hair-card atlas (hair, brows, lashes,
beard) that ships as the single alpha-masked MAT-hair. Principled BSDF only, so bake_maps.py and the glTF exporter
read them directly. Colours come from sd_chars (which mirrors src/render/characters.ts)."""
import os

import bpy
import numpy as np

import sd_contract as C
import sd_util as U

HAIR_CUTOFF = 0.35          # glTF alphaCutoff of MAT-hair (MASK)

# Atlas layout of MAT-hair, in UV space (u0, v0, u1, v1). Rows of the 2048 image: scalp hair on top 3/4.
ATLAS = {
    "hair": (0.0, 0.25, 1.0, 1.0),
    "brows": (0.0, 0.0, 0.25, 0.25),
    "lashes": (0.25, 0.0, 0.5, 0.25),
    "beard": (0.5, 0.0, 1.0, 0.25),
}


def _srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _img_np(img):
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def image_mean_srgb(path, mask_alpha=False):
    img = bpy.data.images.load(path, check_existing=True)
    px = _img_np(img)
    if mask_alpha:
        m = px[..., 3] > 0.5
        rgb = px[..., :3][m]
    else:
        rgb = px[..., :3].reshape(-1, 3)
    return rgb.mean(axis=0)


# --- SKIN -----------------------------------------------------------------------------------------------
PRE_DESAT = 0.72


def skin_mean_linear(path, desat=1.0):
    """Mean linear albedo of the skin texels of an MPFB diffuse (texels with alpha > 0.5 and sRGB luminance > 0.12,
    i.e. not the empty atlas background), after an HSV saturation scale `desat` (c' = V - desat (V - c))."""
    img = bpy.data.images.load(path, check_existing=True)
    px = _img_np(img).reshape(-1, 4)
    lum = px[:, :3] @ np.array([0.2126, 0.7152, 0.0722])
    m = (px[:, 3] > 0.5) & (lum > 0.12)
    lin = _srgb_to_lin(px[m, :3])
    v = lin.max(axis=1, keepdims=True)
    lin = v - desat * (v - lin)
    return lin.mean(axis=0)
def skin_material(name, diffuse_path, target_hex, masks_dir=None, sss_weight=0.32, sss_scale=0.009, mix_to_target=1.0,
                  scalp_hex=None):
    """Warm, subsurface skin from the MPFB diffuse, re-tinted so its mean albedo moves mix_to_target of the way
    toward target_hex. scalp_hex: colour mixed in by the "sd_scalp" colour attribute (skin under hair cards).
    Roughness: 0.5 body, 0.42 face T-zone, 0.33 lips, 0.25 nails (MPFB UV masks). Micro pores as bump."""
    m = U.new_material(name)
    nt = m.node_tree
    bsdf = U.principled(nt)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(diffuse_path, check_existing=True)
    tex.image.colorspace_settings.name = "sRGB"
    tex.location = (-900, 300)
    # tint: per-channel gain in linear space from the (pre-desaturated) texture's skin mean to the palette albedo.
    # The mean skips the empty background texels (they would darken it and over-brighten the result) and is taken
    # after the same 0.72 HSV desaturation the node tree applies, so the tinted mean lands on target_hex.
    mean = skin_mean_linear(diffuse_path, PRE_DESAT)
    want = _srgb_to_lin(np.array(C.hex_to_srgb(target_hex)))
    want = mean * (1.0 - mix_to_target) + want * mix_to_target
    gain = np.clip(want / np.maximum(mean, 1e-4), 0.2, 2.0)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.location = (-550, 300)
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs[7].default_value = (float(gain[0]), float(gain[1]), float(gain[2]), 1.0)
    nt.links.new(tex.outputs["Color"], mix.inputs[6])
    # gentle contrast lift so the texture is not flat (redness in creases survives the tint)
    hsv = nt.nodes.new("ShaderNodeHueSaturation")
    hsv.location = (-350, 300)
    hsv.inputs["Saturation"].default_value = 1.0
    hsv.inputs["Value"].default_value = 1.0
    # the MPFB albedo has blotchy reds (cheeks, knees): desaturate before the tint re-warms it evenly
    pre = nt.nodes.new("ShaderNodeHueSaturation")
    pre.location = (-750, 300)
    pre.inputs["Saturation"].default_value = PRE_DESAT
    nt.links.new(tex.outputs["Color"], pre.inputs["Color"])
    nt.links.new(pre.outputs["Color"], mix.inputs[6])
    nt.links.new(mix.outputs[2], hsv.inputs["Color"])
    base = hsv.outputs["Color"]
    # localised redness: ears (MPFB UV mask), nose and knuckles (sd_red attribute)
    red_in = None
    if masks_dir and os.path.exists(os.path.join(masks_dir, "mpfb_ears.jpg")):
        em = nt.nodes.new("ShaderNodeTexImage")
        em.image = bpy.data.images.load(os.path.join(masks_dir, "mpfb_ears.jpg"), check_existing=True)
        em.image.colorspace_settings.name = "Non-Color"
        em.location = (-350, 760)
        red_in = em.outputs["Color"]
    ra = nt.nodes.new("ShaderNodeAttribute")
    ra.attribute_type = "GEOMETRY"
    ra.attribute_name = "sd_red"
    ra.location = (-350, 620)
    rmax = nt.nodes.new("ShaderNodeMath")
    rmax.operation = "MAXIMUM"
    rmax.location = (-150, 680)
    nt.links.new(ra.outputs["Fac"], rmax.inputs[0])
    if red_in is not None:
        nt.links.new(red_in, rmax.inputs[1])
    else:
        rmax.inputs[1].default_value = 0.0
    rsc = nt.nodes.new("ShaderNodeMath")
    rsc.operation = "MULTIPLY"
    rsc.inputs[1].default_value = 0.55
    nt.links.new(rmax.outputs[0], rsc.inputs[0])
    red = nt.nodes.new("ShaderNodeMix")
    red.data_type = "RGBA"
    red.blend_type = "MULTIPLY"
    red.location = (-10, 520)
    nt.links.new(rsc.outputs[0], red.inputs["Factor"])
    nt.links.new(base, red.inputs[6])
    red.inputs[7].default_value = (1.0, 0.72, 0.66, 1.0)
    base = red.outputs[2]
    if scalp_hex is not None:
        attr = nt.nodes.new("ShaderNodeAttribute")
        attr.attribute_type = "GEOMETRY"
        attr.attribute_name = "sd_scalp"
        attr.location = (-350, 520)
        sc = nt.nodes.new("ShaderNodeMix")
        sc.data_type = "RGBA"
        sc.blend_type = "MIX"
        sc.location = (-150, 420)
        nt.links.new(attr.outputs["Fac"], sc.inputs["Factor"])
        nt.links.new(base, sc.inputs[6])
        sc.inputs[7].default_value = C.hex_to_linear(scalp_hex)
        base = sc.outputs[2]
    nt.links.new(base, bsdf.inputs["Base Color"])
    U.set_input(bsdf, "Subsurface Weight", sss_weight)
    U.set_input(bsdf, "Subsurface Radius", (1.0, 0.38, 0.2))
    U.set_input(bsdf, "Subsurface Scale", sss_scale)
    U.set_input(bsdf, "Subsurface IOR", 1.4)
    U.set_input(bsdf, "Specular IOR Level", 0.5)
    U.set_input(bsdf, "IOR", 1.4)
    # roughness from masks
    rough = nt.nodes.new("ShaderNodeValue")
    rough.outputs[0].default_value = 0.5
    rough.location = (-900, -100)
    last = rough.outputs[0]
    y = -200
    if masks_dir:
        for mask, val in (("mpfb_face.jpg", 0.42), ("mpfb_lips.jpg", 0.33), ("mpfb_fingernails.jpg", 0.25),
                          ("mpfb_toenails.jpg", 0.28)):
            p = os.path.join(masks_dir, mask)
            if not os.path.exists(p):
                continue
            mt = nt.nodes.new("ShaderNodeTexImage")
            mt.image = bpy.data.images.load(p, check_existing=True)
            mt.image.colorspace_settings.name = "Non-Color"
            mt.location = (-900, y)
            mx = nt.nodes.new("ShaderNodeMix")
            mx.data_type = "FLOAT"
            mx.location = (-600, y)
            nt.links.new(mt.outputs["Color"], mx.inputs["Factor"])
            nt.links.new(last, mx.inputs[2])
            mx.inputs[3].default_value = val
            last = mx.outputs[0]
            y -= 260
    # pore-scale breakup of roughness
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.location = (-600, -900)
    noise.inputs["Scale"].default_value = 900.0
    noise.inputs["Detail"].default_value = 2.0
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (-850, -900)
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    radd = nt.nodes.new("ShaderNodeMath")
    radd.operation = "MULTIPLY_ADD"
    radd.location = (-300, -400)
    nt.links.new(noise.outputs["Fac"], radd.inputs[0])
    radd.inputs[1].default_value = 0.12
    nt.links.new(last, radd.inputs[2])
    rsub = nt.nodes.new("ShaderNodeMath")
    rsub.operation = "SUBTRACT"
    rsub.location = (-150, -400)
    nt.links.new(radd.outputs[0], rsub.inputs[0])
    rsub.inputs[1].default_value = 0.06
    nt.links.new(rsub.outputs[0], bsdf.inputs["Roughness"])
    # micro bump (pores); baked into the delivery normal map, never exported as a node
    bump = nt.nodes.new("ShaderNodeBump")
    bump.name = "skin_pores"
    bump.location = (-150, -700)
    bump.inputs["Strength"].default_value = 0.18
    bump.inputs["Distance"].default_value = 0.0004
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.location = (-450, -700)
    vor.inputs["Scale"].default_value = 1400.0
    nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
    nt.links.new(vor.outputs["Distance"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    m["sd_role"] = "skin"
    m["sd_tint_gain"] = [float(g) for g in gain]
    return m


# --- EYES -----------------------------------------------------------------------------------------------
def eye_texture(data_dir, mix, sclera_tint, out_path):
    """Blend MPFB eye textures (same layout) by weight, e.g. grey 0.55 + lightblue 0.45 = a muted grey-blue iris,
    and tint the bright, unsaturated sclera texels slightly off-white. Writes out_path (PNG)."""
    acc = None
    for name, w in mix:
        img = bpy.data.images.load(os.path.join(data_dir, name + "_eye.png"), check_existing=True)
        px = _img_np(img)
        acc = px * w if acc is None else acc + px * w
    rgb = acc[..., :3]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    sclera = (sat < 0.18) & (mx > 0.5)
    tint = np.array(sclera_tint, dtype=np.float32)
    rgb[sclera] = rgb[sclera] * tint
    acc[..., :3] = rgb
    h, w = acc.shape[:2]
    out = bpy.data.images.new(os.path.splitext(os.path.basename(out_path))[0], w, h, alpha=True)
    out.pixels.foreach_set(acc.astype(np.float32).ravel())
    out.filepath_raw = out_path
    out.file_format = "PNG"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    out.save()
    out.filepath = out_path
    return out_path


def eye_material(name, texture_path):
    m = U.new_material(name)
    nt = m.node_tree
    bsdf = U.principled(nt)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(texture_path, check_existing=True)
    tex.location = (-500, 200)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    U.set_input(bsdf, "Roughness", 0.06)
    U.set_input(bsdf, "Specular IOR Level", 0.6)
    U.set_input(bsdf, "IOR", 1.376)
    U.set_input(bsdf, "Coat Weight", 0.0)
    m["sd_role"] = "eyes"
    return m


# --- HAIR ATLAS -----------------------------------------------------------------------------------------
def _resize(img, w, h):
    c = img.copy()
    c.scale(w, h)
    a = _img_np(c)
    bpy.data.images.remove(c)
    return a


def _colorize(rgba, root_hex, tip_hex, gamma=1.0):
    """Recolour a strand texture by its luminance: dark strands -> root colour, light -> tip colour. Keeps alpha."""
    rgb = rgba[..., :3]
    lum = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2])
    valid = rgba[..., 3] > 0.3
    lo, hi = (np.percentile(lum[valid], 5), np.percentile(lum[valid], 97)) if valid.any() else (0.0, 1.0)
    t = np.clip((lum - lo) / max(hi - lo, 1e-4), 0, 1) ** gamma
    root = _srgb_to_lin(np.array(C.hex_to_srgb(root_hex)))
    tip = _srgb_to_lin(np.array(C.hex_to_srgb(tip_hex)))
    out = rgba.copy()
    for i in range(3):
        out[..., i] = root[i] * (1 - t) + tip[i] * t
    # strand-level value variation stays (multiply back a little of the original contrast)
    out[..., :3] *= (0.75 + 0.5 * t)[..., None]
    # transparent texels carry the root colour: mip-mapping and alpha-test fringes then never turn pale
    clear = rgba[..., 3] < 0.5
    for i in range(3):
        out[..., i] = np.where(clear, root[i] * 0.85, out[..., i])
    return out


def build_hair_atlas(out_path, parts, root_hex, tip_hex, size=2048):
    """parts: {"hair": path, "brows": path, "lashes": path, "beard": path or ndarray}. Writes a straight-alpha PNG
    (linear values are encoded back to sRGB by Blender on save). Returns the bpy image."""
    atlas = np.zeros((size, size, 4), dtype=np.float32)
    for key, src in parts.items():
        if src is None:
            continue
        u0, v0, u1, v1 = ATLAS[key]
        x0, x1 = int(u0 * size), int(u1 * size)
        y0, y1 = int(v0 * size), int(v1 * size)        # numpy rows from the bottom (Blender pixel order)
        if isinstance(src, np.ndarray):
            px = src
        else:
            img = bpy.data.images.load(src, check_existing=True)
            img.colorspace_settings.name = "sRGB"
            px = _resize(img, x1 - x0, y1 - y0)
        # Image.pixels of an 8-bit sRGB image are the stored (sRGB-encoded) values: linearise before colourising.
        lin = px.copy()
        lin[..., :3] = _srgb_to_lin(np.clip(px[..., :3], 0, 1))
        dark = key in ("brows", "lashes")
        col = _colorize(lin, root_hex if not dark else root_hex, tip_hex if not dark else root_hex, gamma=1.2)
        atlas[y0:y1, x0:x1] = col
    # back to sRGB for a byte PNG
    enc = atlas.copy()
    rgb = np.clip(enc[..., :3], 0, 1)
    enc[..., :3] = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    name = os.path.splitext(os.path.basename(out_path))[0]
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, size, size, alpha=True)
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(enc.ravel())
    img.filepath_raw = out_path
    img.file_format = "PNG"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img.save()
    img.filepath = out_path
    return img


def remap_uvs(ob, rect):
    """Squeeze the object's active UVs (assumed in 0..1) into the atlas rectangle."""
    u0, v0, u1, v1 = rect
    uv = ob.data.uv_layers.active
    for d in uv.data:
        u, v = d.uv
        u = min(max(u, 0.0), 1.0)
        v = min(max(v, 0.0), 1.0)
        d.uv = (u0 + u * (u1 - u0), v0 + v * (v1 - v0))


def hair_material(name, atlas_img, roughness=0.72, cutoff=HAIR_CUTOFF):
    """Alpha-masked (glTF MASK) double-sided hair-card material. The alpha clip is the exporter-recognised
    1 - (alpha < cutoff) node pair."""
    m = U.new_material(name)
    nt = m.node_tree
    bsdf = U.principled(nt)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = atlas_img
    tex.location = (-700, 200)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    lt = nt.nodes.new("ShaderNodeMath")
    lt.operation = "LESS_THAN"
    lt.location = (-450, -100)
    nt.links.new(tex.outputs["Alpha"], lt.inputs[0])
    lt.inputs[1].default_value = cutoff
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.location = (-250, -100)
    inv.inputs[0].default_value = 1.0
    nt.links.new(lt.outputs[0], inv.inputs[1])
    nt.links.new(inv.outputs[0], bsdf.inputs["Alpha"])
    U.set_input(bsdf, "Roughness", roughness)
    U.set_input(bsdf, "Specular IOR Level", 0.1)
    U.set_input(bsdf, "Specular Tint", tuple(list(C.hex_to_linear(0x6A4A30))[:3]) + (1.0,))     # brown, not grey sheen
    U.set_input(bsdf, "Sheen Weight", 0.0)
    U.set_input(bsdf, "Sheen Roughness", 0.35)
    m.use_backface_culling = False
    try:
        m.surface_render_method = "DITHERED"
    except Exception:
        m.blend_method = "CLIP"
    m["sd_role"] = "hair"
    m["sd_alpha_mode"] = "MASK"
    m["sd_alpha_cutoff"] = cutoff
    return m
