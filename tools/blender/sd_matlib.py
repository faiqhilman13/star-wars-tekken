"""Look-dev materials for costumes (Principled BSDF, procedural detail that bake_maps.py turns into textures).

Tintable fabrics (MAT-<id>_primary / _secondary / _trim):
  Base Color = sd_tint (palette colour, node "sd_tint", a MULTIPLY mix with a constant) x neutral detail, where the
  neutral detail = woven micro-pattern x slub noise x the piece's "sd_shade" attribute (tabards 0.64, trousers 0.58).
  sd_bake bakes the neutral detail (sd_tint temporarily white) and re-inserts the same constant multiply after the
  baked image, which the glTF exporter writes as baseColorFactor: the runtime re-tints mirror palettes by changing
  baseColorFactor only. Roughness 0.78-0.9; normal detail = weave + vertical drape folds (shader bump, self-baked).
Leather (not tinted): colour per piece from "sd_tone" (0 boots, 0.5 belt, 1 pouches), grain bump, edge wear by
  pointiness (Cycles), creases. Metal: metallic 1, brushed roughness, cavity darkening and bright edge wear.
"""
import bpy

import sd_contract as C
import sd_util as U

TINTABLE = ("primary", "secondary", "trim")
VERSION = 3          # bump when a builder changes: ensure_costume_materials rebuilds older look-dev materials


def _n(nt, kind, x, y, **props):
    n = nt.nodes.new(kind)
    n.location = (x, y)
    for k, v in props.items():
        setattr(n, k, v)
    return n


def _attr(nt, name, x, y):
    a = _n(nt, "ShaderNodeAttribute", x, y)
    a.attribute_type = "GEOMETRY"
    a.attribute_name = name
    return a


def _mul(nt, a, b, x, y, blend="MULTIPLY", fac=1.0):
    m = _n(nt, "ShaderNodeMix", x, y)
    m.data_type = "RGBA"
    m.blend_type = blend
    m.inputs["Factor"].default_value = fac
    if isinstance(a, tuple):
        m.inputs[6].default_value = a
    else:
        nt.links.new(a, m.inputs[6])
    if isinstance(b, tuple):
        m.inputs[7].default_value = b
    else:
        nt.links.new(b, m.inputs[7])
    return m


def _math(nt, op, a, b, x, y):
    m = _n(nt, "ShaderNodeMath", x, y, operation=op)
    for i, v in enumerate((a, b)):
        if isinstance(v, (int, float)):
            m.inputs[i].default_value = v
        else:
            nt.links.new(v, m.inputs[i])
    return m.outputs[0]


def fabric(name, tint_hex, rough=0.84, sheen=0.35, **_):
    """Coarse homespun wool/linen look-dev for the HIGH garments (baked onto the LOW):
    colour = palette tint (sd_tint, baseColorFactor after the bake) x neutral value, where the neutral value carries
    large-scale mottling, slub streaks along the warp (object Z), the piece shade (sd_shade), grime and wear at
    hems and cuffs (sd_hem), darker seam lines (sd_seam) and lighter thread on the topstitching (sd_stitch).
    Bump: seam grooves, raised stitches and a fine fibre noise; the woven texture itself is composited into the
    baked normal map in UV space (sd_bake weave), the folds are real HIGH geometry."""
    m = U.new_material(name)
    nt = m.node_tree
    b = U.principled(nt)
    tc = _n(nt, "ShaderNodeTexCoord", -1800, 0)
    # mottling (5-10 cm) and slubs (streaks along the warp: noise squashed in Z)
    mo = _n(nt, "ShaderNodeTexNoise", -1500, 450)
    mo.inputs["Scale"].default_value = 14.0
    mo.inputs["Detail"].default_value = 4.0
    nt.links.new(tc.outputs["Object"], mo.inputs["Vector"])
    mp = _n(nt, "ShaderNodeMapping", -1700, 150)
    mp.inputs["Scale"].default_value = (260.0, 260.0, 18.0)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    sl = _n(nt, "ShaderNodeTexNoise", -1500, 150)
    sl.inputs["Scale"].default_value = 1.0
    sl.inputs["Detail"].default_value = 3.0
    nt.links.new(mp.outputs["Vector"], sl.inputs["Vector"])
    fib = _n(nt, "ShaderNodeTexNoise", -1500, -500)
    fib.inputs["Scale"].default_value = 900.0
    fib.inputs["Detail"].default_value = 2.0
    nt.links.new(tc.outputs["Object"], fib.inputs["Vector"])
    hem = _attr(nt, "sd_hem", -1500, 750)
    seam = _attr(nt, "sd_seam", -1500, -800)
    stitch = _attr(nt, "sd_stitch", -1500, -1000)
    shade = _attr(nt, "sd_shade", -900, 650)
    # neutral value 0.82: mottling +-0.05, slubs +-0.06
    v = _math(nt, "MULTIPLY_ADD", mo.outputs["Fac"], 0.10, -1200, 400)
    nt.nodes[-1].inputs[2].default_value = 0.77
    vs = _math(nt, "MULTIPLY_ADD", sl.outputs["Fac"], 0.12, -1200, 200)
    nt.nodes[-1].inputs[2].default_value = -0.06
    val = _math(nt, "ADD", v, vs, -1000, 300)
    # grime toward the hems (squared falloff, broken up by the mottling), seams darker, stitches lighter
    h2 = _math(nt, "MULTIPLY", hem.outputs["Fac"], hem.outputs["Fac"], -1200, 750)
    grime = _math(nt, "MULTIPLY", h2, mo.outputs["Fac"], -1000, 750)
    gk = _math(nt, "MULTIPLY_ADD", grime, -0.55, -800, 750)
    nt.nodes[-1].inputs[2].default_value = 1.0
    val = _math(nt, "MULTIPLY", val, gk, -800, 300)
    sk = _math(nt, "MULTIPLY_ADD", seam.outputs["Fac"], -0.18, -800, 100)
    nt.nodes[-1].inputs[2].default_value = 1.0
    val = _math(nt, "MULTIPLY", val, sk, -650, 300)
    tk = _math(nt, "MULTIPLY_ADD", stitch.outputs["Fac"], 0.18, -800, -50)
    nt.nodes[-1].inputs[2].default_value = 1.0
    val = _math(nt, "MULTIPLY", val, tk, -500, 300)
    val = _math(nt, "MULTIPLY", val, shade.outputs["Fac"], -350, 300)
    neutral = _n(nt, "ShaderNodeCombineColor", -200, 300)
    for i in range(3):
        nt.links.new(val, neutral.inputs[i])
    # grime also desaturates toward a grey-brown (applied before the tint: it stays in the neutral map)
    tint = _mul(nt, neutral.outputs["Color"], C.hex_to_linear(tint_hex), -20, 300)
    tint.name = "sd_tint"
    tint.label = "sd_tint (baseColorFactor)"
    nt.links.new(tint.outputs[2], b.inputs["Base Color"])
    r = _math(nt, "MULTIPLY_ADD", sl.outputs["Fac"], 0.10, -350, -100)
    nt.nodes[-1].inputs[2].default_value = rough - 0.05
    r = _math(nt, "MULTIPLY_ADD", grime, 0.08, -200, -100)
    nt.links.new(nt.nodes[-2].outputs[0], nt.nodes[-1].inputs[2])
    nt.links.new(r, b.inputs["Roughness"])
    U.set_input(b, "Sheen Weight", sheen)
    U.set_input(b, "Sheen Roughness", 0.45)
    U.set_input(b, "Specular IOR Level", 0.35)
    # bump: seam groove (-), stitches (+), fibre fuzz
    hgt = _math(nt, "MULTIPLY_ADD", seam.outputs["Fac"], -1.0, -900, -800)
    nt.links.new(stitch.outputs["Fac"], nt.nodes[-1].inputs[2])
    hgt = _math(nt, "MULTIPLY_ADD", fib.outputs["Fac"], 0.25, -700, -700)
    nt.links.new(nt.nodes[-2].outputs[0], nt.nodes[-1].inputs[2])
    bump = _n(nt, "ShaderNodeBump", -300, -600)
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = 0.0008
    nt.links.new(hgt, bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    m["sd_kind"] = "fabric"
    m["sd_tint_hex"] = tint_hex
    m["sd_ver"] = VERSION
    return m


def leather(name, tones_hex, rough=0.5):
    """tones_hex: (boots, belt, pouches) colours, picked by the sd_tone attribute (0, 0.5, 1)."""
    m = U.new_material(name)
    nt = m.node_tree
    b = U.principled(nt)
    tc = _n(nt, "ShaderNodeTexCoord", -1600, 0)
    tone = _attr(nt, "sd_tone", -1300, 450)
    ramp = _n(nt, "ShaderNodeValToRGB", -1100, 450)
    ramp.color_ramp.interpolation = "LINEAR"
    ramp.color_ramp.elements[0].color = C.hex_to_linear(tones_hex[0])
    ramp.color_ramp.elements[1].color = C.hex_to_linear(tones_hex[2])
    e = ramp.color_ramp.elements.new(0.5)
    e.color = C.hex_to_linear(tones_hex[1])
    nt.links.new(tone.outputs["Fac"], ramp.inputs["Fac"])
    grain = _n(nt, "ShaderNodeTexVoronoi", -1300, -200)
    grain.inputs["Scale"].default_value = 900.0
    nt.links.new(tc.outputs["Object"], grain.inputs["Vector"])
    mott = _n(nt, "ShaderNodeTexNoise", -1300, 150)
    mott.inputs["Scale"].default_value = 18.0
    mott.inputs["Detail"].default_value = 8.0
    nt.links.new(tc.outputs["Object"], mott.inputs["Vector"])
    geo = _n(nt, "ShaderNodeNewGeometry", -1300, -500)
    wear = _n(nt, "ShaderNodeMapRange", -1100, -500)
    # Cycles pointiness on the game-res mesh flags every hard edge: keep the scuffing to the sharpest ridges
    wear.inputs["From Min"].default_value = 0.6
    wear.inputs["From Max"].default_value = 0.75
    nt.links.new(geo.outputs["Pointiness"], wear.inputs["Value"])
    # colour: tone x mottling, lighter scuffed edges
    mv = _math(nt, "MULTIPLY_ADD", mott.outputs["Fac"], 0.35, -900, 150)
    nt.nodes[-1].inputs[2].default_value = 0.82
    col = _mul(nt, ramp.outputs["Color"], (1, 1, 1, 1), -700, 300)
    nt.links.new(_n(nt, "ShaderNodeCombineColor", -850, 50).outputs[0], col.inputs[7])
    cc = col.inputs[7].links[0].from_node
    for i in range(3):
        nt.links.new(mv, cc.inputs[i])
    edge = _mul(nt, col.outputs[2], (1.0, 0.85, 0.7, 1), -500, 300, blend="SCREEN")
    nt.links.new(wear.outputs["Result"], edge.inputs["Factor"])
    edge.inputs["Factor"].default_value = 0.0
    sc = _math(nt, "MULTIPLY", wear.outputs["Result"], 0.1, -650, 450)
    nt.links.new(sc, edge.inputs["Factor"])
    nt.links.new(edge.outputs[2], b.inputs["Base Color"])
    r = _math(nt, "MULTIPLY_ADD", mott.outputs["Fac"], 0.25, -700, -100)
    nt.nodes[-1].inputs[2].default_value = rough - 0.1
    r2 = _math(nt, "MULTIPLY_ADD", wear.outputs["Result"], -0.1, -500, -100)
    nt.links.new(r, nt.nodes[-1].inputs[2])
    nt.links.new(r2, b.inputs["Roughness"])
    U.set_input(b, "Specular IOR Level", 0.45)
    U.set_input(b, "Coat Weight", 0.15)
    U.set_input(b, "Coat Roughness", 0.35)
    # bump: grain + creases (horizontal bands, strongest round the ankle)
    mp = _n(nt, "ShaderNodeMapping", -1500, -800)
    mp.inputs["Scale"].default_value = (30.0, 30.0, 140.0)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    cr = _n(nt, "ShaderNodeTexNoise", -1300, -800)
    cr.inputs["Scale"].default_value = 1.0
    cr.inputs["Detail"].default_value = 3.0
    nt.links.new(mp.outputs["Vector"], cr.inputs["Vector"])
    h = _math(nt, "MULTIPLY_ADD", grain.outputs["Distance"], 0.6, -900, -700)
    nt.links.new(cr.outputs["Fac"], nt.nodes[-1].inputs[2])
    bump = _n(nt, "ShaderNodeBump", -300, -600)
    bump.inputs["Strength"].default_value = 0.7
    bump.inputs["Distance"].default_value = 0.0008
    nt.links.new(h, bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    m["sd_kind"] = "leather"
    m["sd_ver"] = VERSION
    return m


def metal(name, hex_):
    m = U.new_material(name)
    nt = m.node_tree
    b = U.principled(nt)
    tc = _n(nt, "ShaderNodeTexCoord", -1300, 0)
    mp = _n(nt, "ShaderNodeMapping", -1100, -300)
    mp.inputs["Scale"].default_value = (2000.0, 60.0, 60.0)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    br = _n(nt, "ShaderNodeTexNoise", -900, -300)
    br.inputs["Scale"].default_value = 1.0
    nt.links.new(mp.outputs["Vector"], br.inputs["Vector"])
    geo = _n(nt, "ShaderNodeNewGeometry", -1100, 300)
    cav = _n(nt, "ShaderNodeMapRange", -900, 300)
    cav.inputs["From Min"].default_value = 0.42
    cav.inputs["From Max"].default_value = 0.6
    cav.inputs["To Min"].default_value = 0.55
    cav.inputs["To Max"].default_value = 1.15
    nt.links.new(geo.outputs["Pointiness"], cav.inputs["Value"])
    base = _mul(nt, C.hex_to_linear(hex_), (1, 1, 1, 1), -600, 300)
    cc = _n(nt, "ShaderNodeCombineColor", -750, 150)
    for i in range(3):
        nt.links.new(cav.outputs["Result"], cc.inputs[i])
    nt.links.new(cc.outputs[0], base.inputs[7])
    nt.links.new(base.outputs[2], b.inputs["Base Color"])
    U.set_input(b, "Metallic", 1.0)
    r = _math(nt, "MULTIPLY_ADD", br.outputs["Fac"], 0.22, -600, -200)
    nt.nodes[-1].inputs[2].default_value = 0.16
    nt.links.new(r, b.inputs["Roughness"])
    m["sd_kind"] = "metal"
    m["sd_ver"] = VERSION
    return m


def ensure_costume_materials(cfg):
    L = cfg["look"]
    mats = C.material_names(cfg["id"])
    out = {}
    for key in ("primary", "secondary", "trim", "leather", "metal"):     # stale look-dev: rebuild
        m = bpy.data.materials.get(mats[key])
        if m and m.get("sd_ver") != VERSION:
            m.name = m.name + "_old"
    for key, hexv in (("primary", L["primary"]), ("secondary", L["secondary"]), ("trim", L["trim"])):
        m = bpy.data.materials.get(mats[key])
        out[key] = m if m and m.get("sd_kind") == "fabric" else fabric(mats[key], hexv,
                                                                          rough=0.86 if key != "trim" else 0.8)
    m = bpy.data.materials.get(mats["leather"])
    out["leather"] = m if m and m.get("sd_kind") == "leather" else leather(mats["leather"], (L["boots"], L["belt"], cfg.get("pouch_hex", 0x4A3220)))
    m = bpy.data.materials.get(mats["metal"])
    out["metal"] = m if m and m.get("sd_kind") == "metal" else metal(mats["metal"], L["metal"])
    return out
