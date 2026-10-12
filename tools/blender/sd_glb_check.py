"""Independent GLB contract check (plain Python, no Blender): reads the glTF JSON and binary of a fighter GLB and
checks it against art/CHARACTER_PIPELINE.md.

  python tools/blender/sd_glb_check.py public/models/kael.glb [--char kael] [--json out.json]

Checks: joint set = 17 core joints + section 5 extras (no Root), joint rest rotations identity, joint rest
positions vs the contract table, palmOpen morph present on the skinned body, material names, alpha modes,
texture formats/sizes, triangle count, <= 4 influences (no WEIGHTS_1), GLB size. Exit 1 on any FAIL.
"""
import argparse
import json
import math
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sd_contract as C  # noqa: E402

EXTRA = re.compile(r"^(skirt_[A-Za-z0-9]+_[01]|cape_[0-3]|hair_[0-2]|tail_[01]|pad_[NF])$")


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, ver, length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a GLB"
    off, js, binc = 12, None, None
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            binc = chunk
        off += 8 + clen
    return js, binc, len(data)


def image_size(blob, mime):
    if mime == "image/png":
        return struct.unpack(">II", blob[16:24])
    if mime == "image/webp":
        if blob[12:16] == b"VP8 ":
            w, h = struct.unpack("<HH", blob[26:30])
            return w & 0x3FFF, h & 0x3FFF
        if blob[12:16] == b"VP8L":
            b = blob[21:25]
            bits = int.from_bytes(b, "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        if blob[12:16] == b"VP8X":
            return int.from_bytes(blob[24:27], "little") + 1, int.from_bytes(blob[27:30], "little") + 1
    if mime == "image/jpeg":
        i = 2
        while i < len(blob):
            if blob[i] != 0xFF:
                i += 1
                continue
            m = blob[i + 1]
            if m in (0xC0, 0xC2):
                h, w = struct.unpack(">HH", blob[i + 5:i + 9])
                return w, h
            i += 2 + struct.unpack(">H", blob[i + 2:i + 4])[0]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glb")
    ap.add_argument("--char", default=None)
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    char = a.char or os.path.splitext(os.path.basename(a.glb))[0]
    js, binc, size = read_glb(a.glb)
    fails, warns, info = [], [], {}
    nodes = js["nodes"]
    skins = js.get("skins", [])
    if len(skins) != 1:
        (fails if not skins else warns).append("skins: %d (expected 1 shared skin)" % len(skins))
    joints = [nodes[i] for i in skins[0]["joints"]] if skins else []
    jn = [n.get("name") for n in joints]
    info["joints"] = jn
    missing = [j for j in C.CORE if j not in jn]
    extra = [j for j in jn if j not in C.CORE]
    bad_extra = [j for j in extra if not EXTRA.match(j or "")]
    if missing:
        fails.append("missing core joints: %s" % missing)
    if bad_extra:
        fails.append("joints outside the contract: %s" % bad_extra)
    info["extra_joints"] = [j for j in extra if j not in bad_extra]
    # rest transforms: world positions in game frame, identity rotations
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i
    idx = {n.get("name"): i for i, n in enumerate(nodes)}

    def world_pos(i):
        p = [0.0, 0.0, 0.0]
        chain = []
        while i is not None:
            chain.append(i)
            i = parent.get(i)
        for k in reversed(chain):
            n = nodes[k]
            r = n.get("rotation", [0, 0, 0, 1])
            if any(abs(r[t] - [0, 0, 0, 1][t]) > 1e-4 for t in range(4)) and nodes[k].get("name") in jn:
                pass
            t = n.get("translation", [0, 0, 0])
            p = [p[0] + t[0], p[1] + t[1], p[2] + t[2]]
        return p
    rot_bad, pos_err = [], {}
    for name in jn:
        n = nodes[idx[name]]
        r = n.get("rotation", [0, 0, 0, 1])
        if max(abs(r[0]), abs(r[1]), abs(r[2]), abs(abs(r[3]) - 1)) > 1e-4:
            rot_bad.append(name)
        if "scale" in n and any(abs(s - 1) > 1e-4 for s in n["scale"]):
            fails.append("joint %s has scale %s" % (name, n["scale"]))
        if name in C.JOINTS:
            wp = world_pos(idx[name])
            want = C.JOINTS[name][1]
            pos_err[name] = round(math.dist(wp, want), 5)
    if rot_bad:
        fails.append("joints with non-identity rest rotation: %s" % rot_bad)
    worst = max(pos_err.values()) if pos_err else 0
    info["joint_position_max_err_m"] = worst
    if worst > 1e-3:
        fails.append("joint rest positions off the contract by up to %.4f m" % worst)
    # ancestors of the skeleton root (armature node) must be identity
    roots = [i for i in skins[0]["joints"] if parent.get(i) not in skins[0]["joints"]] if skins else []
    for r_ in roots:
        k = parent.get(r_)
        while k is not None:
            n = nodes[k]
            if any(key in n for key in ("rotation", "scale")) or any(abs(t) > 1e-6 for t in n.get("translation", [0, 0, 0])):
                warns.append("skeleton ancestor %s has a transform %s" % (n.get("name"), {kk: n[kk] for kk in ("translation", "rotation", "scale") if kk in n}))
            k = parent.get(k)
    # meshes
    # v5: the anime contract - a face material, or (masked characters with no face, e.g. Thane) toon extras
    v5 = any(m.get("name") == "MAT-face" or "toon" in (m.get("extras") or {}) for m in js.get("materials", []))
    info["contract"] = "v5 anime" if v5 else "v4"
    budget_tris = 50000 if v5 else C.BUDGET["tris"]
    no_color0 = []
    tris, morphs, prims_mats = 0, {}, set()
    accessors = js["accessors"]
    for mi, m in enumerate(js["meshes"]):
        names = (m.get("extras") or {}).get("targetNames", [])
        if names:
            morphs[m.get("name")] = names
        for p in m["primitives"]:
            if "indices" in p:
                tris += accessors[p["indices"]]["count"] // 3
            else:
                tris += accessors[p["attributes"]["POSITION"]]["count"] // 3
            if "WEIGHTS_1" in p["attributes"]:
                fails.append("mesh %s has more than 4 influences (WEIGHTS_1)" % m.get("name"))
            if "material" in p:
                prims_mats.add(p["material"])
            if v5 and "COLOR_0" not in p["attributes"]:
                no_color0.append(m.get("name"))
    info["triangles"] = tris
    info["morphs"] = morphs
    if tris > budget_tris:
        fails.append("triangles %d > budget %d" % (tris, budget_tris))
    if v5:
        if no_color0:
            fails.append("primitives without COLOR_0 (outline mask): %s" % sorted(set(no_color0)))
        face = [n for n in morphs if n and n.endswith("_face")]
        want = {"expr_blink", "expr_angry", "expr_shout", "expr_pain", "expr_smile", "expr_focus"}
        got = set(morphs.get(face[0], [])) if face else set()
        info["expressions"] = sorted(got)
        if face and not want <= got:
            warns.append("face expressions missing: %s" % sorted(want - got))
    if not any("palmOpen" in v for v in morphs.values()):
        fails.append("palmOpen morph missing")
    # skinned meshes
    skinned = [n.get("name") for n in nodes if "mesh" in n and "skin" in n]
    unskinned = [n.get("name") for n in nodes if "mesh" in n and "skin" not in n]
    info["skinned_meshes"] = skinned
    if unskinned:
        warns.append("meshes without skin: %s" % unskinned)
    # materials
    mats = js.get("materials", [])
    allowed = set(C.material_names(char).values()) | {"MAT-face"}
    info["materials"] = []
    for m in mats:
        rec = {"name": m.get("name"), "alphaMode": m.get("alphaMode", "OPAQUE"), "alphaCutoff": m.get("alphaCutoff"),
               "doubleSided": m.get("doubleSided", False)}
        pbr = m.get("pbrMetallicRoughness", {})
        rec["maps"] = [k for k in ("baseColorTexture", "metallicRoughnessTexture") if k in pbr] + \
                      [k for k in ("normalTexture", "occlusionTexture", "emissiveTexture") if k in m]
        rec["baseColorFactor"] = pbr.get("baseColorFactor")
        info["materials"].append(rec)
        if m.get("name") not in allowed:
            fails.append("material name %r is not a contract name" % m.get("name"))
        if m.get("name") == "MAT-hair" and rec["alphaMode"] != "MASK":
            fails.append("MAT-hair alphaMode %s (contract: MASK)" % rec["alphaMode"])
        if v5:
            toon = (m.get("extras") or {}).get("toon")
            rec["toon"] = toon
            if not toon:
                fails.append("material %s has no toon extras" % m.get("name"))
            else:
                for key in ("shadeColor", "shadeShift", "shadeToony", "outlineWidth", "outlineColor", "matcap"):
                    if key not in toon:
                        fails.append("material %s toon extras lack %s" % (m.get("name"), key))
    if len(mats) > C.BUDGET["materials"]:
        fails.append("materials %d > %d" % (len(mats), C.BUDGET["materials"]))
    # images
    imgs = []
    for im in js.get("images", []):
        bv = js["bufferViews"][im["bufferView"]]
        blob = binc[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
        wh = image_size(blob, im.get("mimeType"))
        imgs.append({"name": im.get("name"), "mime": im.get("mimeType"), "size": wh, "kb": round(bv["byteLength"] / 1024, 1)})
        if wh and max(wh) > C.BUDGET["texture_px"]:
            fails.append("image %s %s > 2048" % (im.get("name"), wh))
        if im.get("mimeType") == "image/png":
            warns.append("PNG image %s (contract: WebP/JPEG unless alpha needs PNG)" % im.get("name"))
    info["images"] = imgs
    info["extensionsUsed"] = js.get("extensionsUsed", [])
    info["glb_mb"] = round(size / 1048576, 3)
    if size / 1048576 > C.BUDGET["glb_mb"]:
        fails.append("GLB %.2f MB > %.1f MB" % (size / 1048576, C.BUDGET["glb_mb"]))
    info["extras_armature"] = [n.get("extras") for n in nodes if n.get("extras") and "gripCentreN" in n.get("extras", {})]
    out = {"file": os.path.abspath(a.glb), "fail": fails, "warn": warns, "info": info}
    if a.json:
        with open(a.json, "w") as f:
            json.dump(out, f, indent=2)
    print(json.dumps(out, indent=1))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
