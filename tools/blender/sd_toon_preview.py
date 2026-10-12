"""Review-only toon look for the anime (v5) masters in EEVEE: approximates the game's toon runtime from the same
material extras the GLB carries, so review renders show what ships.

  import sd_toon_preview; sd_toon_preview.apply()      (sd_review.py --toon)

Per material with a "toon" custom property:
  colour = mix(base x shadeColor, base, cel) where cel = a two-stop ramp on the diffuse light (Shader to RGB),
  centred by shadeShift, softness from shadeToony; + rim (layer-weight fresnel ^ rimPower x rimColor) on the lit
  side; unlit materials emit their base colour; MASK materials clip at their cutoff.
Outlines: inverted hull (Solidify, flipped normals, outline material with back-face culling), width = the
material's outlineWidth x the mesh's sd_outline colour attribute (R), via a vertex group.
"""
import bpy
import numpy as np


def _lin_hex(rgb):
    return tuple(list(rgb)[:3]) + (1.0,)


def toon_tree(m):
    t = m.get("toon")
    if not t:
        return False
    t = t.to_dict() if hasattr(t, "to_dict") else dict(t)
    nt = m.node_tree
    tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
    cutoff = m.get("sd_alpha_cutoff", 0.5)
    alpha_mask = any(l.to_socket.name == "Alpha" for n in nt.nodes for o in n.outputs for l in o.links) or \
        any(n.type == "MATH" and n.operation == "LESS_THAN" for n in nt.nodes)
    for n in list(nt.nodes):
        if tex is None or n.name != tex.name:
            nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emis = nt.nodes.new("ShaderNodeEmission")
    base = tex.outputs["Color"] if tex else None
    if t.get("unlit"):
        if base:
            nt.links.new(base, emis.inputs["Color"])
        col_sock = emis.outputs[0]
    else:
        diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
        s2r = nt.nodes.new("ShaderNodeShaderToRGB")
        nt.links.new(diff.outputs[0], s2r.inputs[0])
        bw = nt.nodes.new("ShaderNodeRGBToBW")
        nt.links.new(s2r.outputs["Color"], bw.inputs[0])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.interpolation = "LINEAR"
        centre = 0.12 + 0.25 * float(t.get("shadeShift", 0.0))
        soft = max(0.01, 0.25 * (1.0 - float(t.get("shadeToony", 0.9))))
        if m.name == "MAT-face":           # runtime: faces get a wide soft band biased toward the light
            centre, soft = max(0.02, centre - 0.08), 0.22
        e0, e1 = ramp.color_ramp.elements
        e0.position, e0.color = max(0.0, centre - soft / 2), (0, 0, 0, 1)
        e1.position, e1.color = min(1.0, centre + soft / 2), (1, 1, 1, 1)
        nt.links.new(bw.outputs[0], ramp.inputs["Fac"])
        shade = nt.nodes.new("ShaderNodeMix")
        shade.data_type = "RGBA"
        shade.blend_type = "MULTIPLY"
        shade.inputs["Factor"].default_value = 1.0
        if base:
            nt.links.new(base, shade.inputs[6])
        sc = [0.85 * float(x) for x in list(t.get("shadeColor", (0.6, 0.6, 0.6)))[:3]]   # runtime: 15 % deeper
        shade.inputs[7].default_value = _lin_hex(sc)
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        nt.links.new(ramp.outputs["Color"], mix.inputs["Factor"])
        nt.links.new(shade.outputs[2], mix.inputs[6])
        if base:
            nt.links.new(base, mix.inputs[7])
        col = mix.outputs[2]
        if t.get("rimColor"):
            # runtime (toon.ts): rimColor x smoothstep(0.5, 0.56, (1 - N.V) ^ (rimPower / 2)) x k (0.35 + 0.65 t),
            # k = 0.1 on hair (matcap "hair"), 0.28 elsewhere - a narrow hard band, never a glow
            lw = nt.nodes.new("ShaderNodeLayerWeight")
            lw.inputs["Blend"].default_value = 0.5
            pw = nt.nodes.new("ShaderNodeMath")
            pw.operation = "POWER"
            nt.links.new(lw.outputs["Facing"], pw.inputs[0])
            pw.inputs[1].default_value = max(0.5, float(t.get("rimPower", 4.0))) * 0.5
            band = nt.nodes.new("ShaderNodeMapRange")
            band.interpolation_type = "SMOOTHSTEP"
            nt.links.new(pw.outputs[0], band.inputs["Value"])
            band.inputs["From Min"].default_value = 0.5
            band.inputs["From Max"].default_value = 0.56
            k = 0.1 if t.get("matcap") == "hair" else 0.28
            kt = nt.nodes.new("ShaderNodeMath")
            kt.operation = "MULTIPLY_ADD"
            nt.links.new(ramp.outputs["Color"], kt.inputs[0])
            kt.inputs[1].default_value = 0.65 * k
            kt.inputs[2].default_value = 0.35 * k
            lit = nt.nodes.new("ShaderNodeMath")
            lit.operation = "MULTIPLY"
            nt.links.new(band.outputs["Result"], lit.inputs[0])
            nt.links.new(kt.outputs[0], lit.inputs[1])
            rim = nt.nodes.new("ShaderNodeMix")
            rim.data_type = "RGBA"
            rim.blend_type = "ADD"
            nt.links.new(lit.outputs[0], rim.inputs["Factor"])
            nt.links.new(col, rim.inputs[6])
            rim.inputs[7].default_value = _lin_hex(t["rimColor"])
            col = rim.outputs[2]
        if t.get("matcap") == "hair":      # runtime angel ring: a crisp band across the crown, facing the camera
            geo = nt.nodes.new("ShaderNodeNewGeometry")
            sep = nt.nodes.new("ShaderNodeSeparateXYZ")
            nt.links.new(geo.outputs["Normal"], sep.inputs[0])
            r0 = nt.nodes.new("ShaderNodeMapRange")
            r0.interpolation_type = "SMOOTHSTEP"
            nt.links.new(sep.outputs["Z"], r0.inputs["Value"])
            r0.inputs["From Min"].default_value, r0.inputs["From Max"].default_value = 0.34, 0.40
            r1 = nt.nodes.new("ShaderNodeMapRange")
            r1.interpolation_type = "SMOOTHSTEP"
            nt.links.new(sep.outputs["Z"], r1.inputs["Value"])
            r1.inputs["From Min"].default_value, r1.inputs["From Max"].default_value = 0.64, 0.58
            lw2 = nt.nodes.new("ShaderNodeLayerWeight")
            lw2.inputs["Blend"].default_value = 0.5
            fv = nt.nodes.new("ShaderNodeMapRange")
            fv.interpolation_type = "SMOOTHSTEP"
            nt.links.new(lw2.outputs["Facing"], fv.inputs["Value"])
            fv.inputs["From Min"].default_value, fv.inputs["From Max"].default_value = 0.8, 0.6   # N.V 0.2 -> 0.4
            m1 = nt.nodes.new("ShaderNodeMath")
            m1.operation = "MULTIPLY"
            nt.links.new(r0.outputs["Result"], m1.inputs[0])
            nt.links.new(r1.outputs["Result"], m1.inputs[1])
            m2 = nt.nodes.new("ShaderNodeMath")
            m2.operation = "MULTIPLY"
            nt.links.new(m1.outputs[0], m2.inputs[0])
            nt.links.new(fv.outputs["Result"], m2.inputs[1])
            kt2 = nt.nodes.new("ShaderNodeMath")
            kt2.operation = "MULTIPLY_ADD"                  # mix(0.5, 1, t)
            nt.links.new(ramp.outputs["Color"], kt2.inputs[0])
            kt2.inputs[1].default_value, kt2.inputs[2].default_value = 0.5, 0.5
            m3 = nt.nodes.new("ShaderNodeMath")
            m3.operation = "MULTIPLY"
            nt.links.new(m2.outputs[0], m3.inputs[0])
            nt.links.new(kt2.outputs[0], m3.inputs[1])
            hl = nt.nodes.new("ShaderNodeMix")             # lit x 1.1 + 0.07
            hl.data_type = "RGBA"
            hl.blend_type = "MULTIPLY"
            hl.inputs["Factor"].default_value = 1.0
            if base:
                nt.links.new(base, hl.inputs[6])
            hl.inputs[7].default_value = (1.1, 1.1, 1.1, 1.0)
            hl2 = nt.nodes.new("ShaderNodeMix")
            hl2.data_type = "RGBA"
            hl2.blend_type = "ADD"
            hl2.inputs["Factor"].default_value = 1.0
            nt.links.new(hl.outputs[2], hl2.inputs[6])
            hl2.inputs[7].default_value = (0.07, 0.06, 0.06, 1.0)
            add = nt.nodes.new("ShaderNodeMix")
            add.data_type = "RGBA"
            add.blend_type = "ADD"
            nt.links.new(m3.outputs[0], add.inputs["Factor"])
            nt.links.new(col, add.inputs[6])
            nt.links.new(hl2.outputs[2], add.inputs[7])
            col = add.outputs[2]
        nt.links.new(col, emis.inputs["Color"])
        col_sock = emis.outputs[0]
    if tex and alpha_mask:
        gt = nt.nodes.new("ShaderNodeMath")
        gt.operation = "GREATER_THAN"
        nt.links.new(tex.outputs["Alpha"], gt.inputs[0])
        gt.inputs[1].default_value = float(cutoff)
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        ms = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(gt.outputs[0], ms.inputs[0])
        nt.links.new(tr.outputs[0], ms.inputs[1])
        nt.links.new(col_sock, ms.inputs[2])
        col_sock = ms.outputs[0]
        try:
            m.surface_render_method = "DITHERED"
        except Exception:
            pass
    nt.links.new(col_sock, out.inputs["Surface"])
    return True


def outline_material(rgb):
    name = "_rv_outline_%02x%02x%02x" % tuple(int(255 * min(1, c)) for c in rgb[:3])
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = _lin_hex(rgb)
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs[0], o.inputs["Surface"])
    m.use_backface_culling = True
    return m


def add_hull(ob):
    mats = [m for m in ob.data.materials if m]
    widths = [float(dict(m["toon"]).get("outlineWidth", 0.0)) if m.get("toon") else 0.0 for m in mats]
    w = max(widths) if widths else 0.0
    if w <= 0:
        return
    me = ob.data
    ca = me.color_attributes.get("sd_outline")
    vg = ob.vertex_groups.get("_rv_outline") or ob.vertex_groups.new(name="_rv_outline")
    vals = np.ones(len(me.vertices), dtype=np.float32)
    if ca is not None:
        c = np.empty(len(ca.data) * 4, dtype=np.float32)
        ca.data.foreach_get("color", c)
        c = c.reshape(-1, 4)[:, 0]
        if ca.domain == "CORNER":
            vi = np.empty(len(me.loops), dtype=np.int32)
            me.loops.foreach_get("vertex_index", vi)
            acc = np.zeros(len(me.vertices))
            cnt = np.zeros(len(me.vertices))
            np.add.at(acc, vi, c)
            np.add.at(cnt, vi, 1)
            vals = (acc / np.maximum(cnt, 1)).astype(np.float32)
        else:
            vals = c
    # per-material width: scale by the vertex's material width / max
    mw = np.zeros(len(me.vertices))
    for p in me.polygons:
        ww = widths[p.material_index] / w if p.material_index < len(widths) else 1.0
        for v in p.vertices:
            mw[v] = max(mw[v], ww)
    for i, x in enumerate(vals * mw):
        vg.add([i], float(x), "REPLACE")
    oc = next((dict(m["toon"]).get("outlineColor") for m in mats if m.get("toon")), (0.02, 0.01, 0.01))
    om = outline_material(oc)
    me.materials.append(om)
    s = ob.modifiers.new("_rv_outline", "SOLIDIFY")
    s.thickness = w
    s.offset = 1.0
    s.use_flip_normals = True
    s.use_rim = False
    s.material_offset = len(me.materials) - 1
    s.vertex_group = vg.name
    s.thickness_vertex_group = 0.0


def apply(outlines=True):
    for m in bpy.data.materials:
        if m.get("toon"):
            toon_tree(m)
    if outlines:
        for ob in [o for o in bpy.data.objects if o.type == "MESH" and o.visible_get() and not o.hide_render]:
            if any(m and m.get("toon") for m in ob.data.materials):
                add_hull(ob)
