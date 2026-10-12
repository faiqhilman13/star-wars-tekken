"""ASHA A1b PREP (between vroid_fit.py and vroid_finish.py): edits the fitted VRoid base in place.

  python tools/blender/run.py art/characters/asha/build/a1b_prep.py -- --char asha

 1. Hair: drops the HairSample twin tails and cat ears (whole HairJoint chains, picked by where the chain ends:
    below the jaw at the sides = twin tail, above the crown = ear). The bangs and the short side locks stay; the
    high ponytail is modelled in a2_costume.py.
 2. Face (adult, sharper eyes): a fixed blend of the VRoid lids (EYE_Angry / EYE_Close) and brows is baked into
    the basis, the irises shrink a little, the cheeks slim and the chin lengthens. The same offset is added to every
    Fcl_* key so the expressions vroid_finish.py builds keep their deltas; the eye-closing keys keep their absolute
    shape so a blink still lands exactly closed.
 3. Body: per-vertex VRoid part weights saved as float attributes (vr_palm, vr_f1, vr_f23, vr_thumb, vr_toe) so the
    costume step can cut fingerless gloves / boots after vroid_finish.py has merged the VRoid bones.
Settings per character in PREP below. Deterministic.
"""
import argparse
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.join(os.environ.get("SABER_REPO", "."), "tools", "blender"))
import sd_util as U  # noqa: E402

PREP = {
    "vexa": {
        # the hood hides the hair: only one authored lock (the swept front bang) is kept; it escapes the hood
        "keep_only": ["HairJoint-97f1861b-4225-48a8-82a7-83298efe6d1d"],
        "face_mix": None,
    },
    "asha": {
        "drop_chains": "twintails_ears",
        "keep_tail": "far",         # the far twin tail is kept and becomes the high ponytail (a2_costume.py)
        # face: fraction of each VRoid Fcl key baked into the neutral face
        "face_mix": {"EYE_Angry": 0.22, "EYE_Close": 0.04, "BRW_Angry": 0.18},
        "iris_scale": 0.95,
        "cheek_slim": 0.955,        # lateral scale of the lower face (below the eyes)
        "chin_drop": 0.002,         # m, chin lengthened (adult jaw; vroid_face.py adds more)
        "streak_lock": None,        # "near": recolour the near-side lock white (vr_streak); off - it read as a tuft
    },
}


def chain_root(arm, name):
    b = arm.data.bones.get(name)
    if b is None:
        return None
    while b.parent is not None and b.parent.name != "J_Bip_C_Head":
        b = b.parent
    return b if b.parent is not None else None


def chain_tip(b):
    while b.children:
        b = b.children[0]
    return b.tail_local


def chain_bones(root):
    out = [root]
    while out[-1].children:
        out.append(out[-1].children[0])
    return out


def drop_hair_chains(arm, hair, mode, keep_tail=None):
    """Delete whole HairJoint chains: the twin tails (chain ends below the jaw at the sides) and the cat ears (ends
    above the crown). keep_tail = "far" / "near": that twin tail is kept (it becomes the ponytail in a2_costume.py):
    its vertices get vr_pony = 1 and vr_pony0..2 (share of each of its chain joints), its joint heads go to the
    report."""
    head = arm.data.bones["J_Bip_C_Head"].head_local
    gi = {g.index: g.name for g in hair.vertex_groups}
    drop_roots, kept = set(), None
    for b in arm.data.bones:
        if b.parent is None or b.parent.name != "J_Bip_C_Head" or not b.name.startswith("HairJoint"):
            continue
        tip = chain_tip(b)
        twintail = tip.z < head.z - 0.15 and abs(b.head_local.y) > 0.05
        ear = tip.z > head.z + 0.28
        if mode == "twintails_ears" and (twintail or ear):
            side = "far" if b.head_local.y > 0 else "near"
            if twintail and keep_tail == side:
                kept = b
                continue
            drop_roots.add(b.name)
    me = hair.data
    kill = np.zeros(len(me.vertices), dtype=bool)
    pony = np.zeros(len(me.vertices), dtype=np.float32)
    seg = np.zeros((len(me.vertices), 3), dtype=np.float32)
    kept_chain = [c.name for c in chain_bones(kept)] if kept else []
    for v in me.vertices:
        acc = {}
        for g in v.groups:
            r = chain_root(arm, gi[g.group])
            key = r.name if r is not None else "_head"
            acc[key] = acc.get(key, 0.0) + g.weight
        if not acc:
            continue
        dom = max(acc, key=acc.get)
        if dom in drop_roots:
            kill[v.index] = True
        elif kept is not None and dom == kept.name:
            pony[v.index] = 1.0
            tot = sum(g.weight for g in v.groups) or 1.0
            for g in v.groups:
                nm = gi[g.group]
                if nm in kept_chain:
                    k = min(2, kept_chain.index(nm))
                    seg[v.index, k] += g.weight / tot
    for name, arr in (("vr_pony", pony), ("vr_pony0", seg[:, 0]), ("vr_pony1", seg[:, 1]), ("vr_pony2", seg[:, 2])):
        a = me.attributes.get(name) or me.attributes.new(name, "FLOAT", "POINT")
        a.data.foreach_set("value", arr)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    dv = [bm.verts[i] for i in np.nonzero(kill)[0]]
    bmesh.ops.delete(bm, geom=dv, context="VERTS")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me.update()
    out = {"dropped_chains": len(drop_roots), "dropped_verts": int(kill.sum()), "hair_verts": len(me.vertices)}
    if kept is not None:
        out["pony"] = {"chain": kept_chain, "verts": int(pony.sum()),
                       "heads": [[round(x, 4) for x in arm.data.bones[n].head_local] for n in kept_chain],
                       "tip": [round(x, 4) for x in chain_tip(kept)]}
    return out


def keep_only_chains(arm, hair, keep):
    """Delete every hair vertex whose dominant HairJoint chain is not in `keep` (the head-weighted cap goes too);
    the kept vertices get vr_lock = 1."""
    gi = {g.index: g.name for g in hair.vertex_groups}
    me = hair.data
    kill = np.ones(len(me.vertices), dtype=bool)
    for v in me.vertices:
        acc = {}
        for g in v.groups:
            r = chain_root(arm, gi[g.group])
            key = r.name if r is not None else "_head"
            acc[key] = acc.get(key, 0.0) + g.weight
        if acc and max(acc, key=acc.get) in keep:
            kill[v.index] = False
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.nonzero(kill)[0]], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me.update()
    return {"kept_chains": keep, "hair_verts": len(me.vertices)}


def key_coords(kb):
    a = np.empty(len(kb.data) * 3, dtype=np.float64)
    kb.data.foreach_get("co", a)
    return a.reshape(-1, 3)


def mark_streak(arm, hair, side):
    """vr_streak = 1 on the hair vertices of the short side lock on `side` (near = -Y)."""
    head = arm.data.bones["J_Bip_C_Head"].head_local
    sg = -1.0 if side == "near" else 1.0
    best = None
    for b in arm.data.bones:
        if b.parent is None or b.parent.name != "J_Bip_C_Head" or not b.name.startswith("HairJoint"):
            continue
        tip = chain_tip(b)
        hanging = tip.z < b.head_local.z - 0.05 and tip.z > head.z - 0.15
        if b.head_local.x - head.x > 0.03 and sg * b.head_local.y > 0.06 and hanging:
            if best is None or sg * b.head_local.y > sg * best.head_local.y:
                best = b
    me = hair.data
    gi = {g.index: g.name for g in hair.vertex_groups}
    val = np.zeros(len(me.vertices), dtype=np.float32)
    if best is not None:
        for v in me.vertices:
            acc = {}
            for g in v.groups:
                r = chain_root(arm, gi[g.group])
                key = r.name if r is not None else "_head"
                acc[key] = acc.get(key, 0.0) + g.weight
            if acc and max(acc, key=acc.get) == best.name:
                val[v.index] = 1.0
    a = me.attributes.get("vr_streak") or me.attributes.new("vr_streak", "FLOAT", "POINT")
    a.data.foreach_set("value", val)
    return {"chain": best.name if best else None, "verts": int(val.sum())}


def sharpen_face(face, cfg):
    me = face.data
    kbs = me.shape_keys.key_blocks
    basis = key_coords(kbs[0])
    by = {}
    for k in list(kbs)[1:]:
        i = k.name.find("Fcl_")
        if i >= 0:
            by[k.name[i + 4:]] = k
    D = np.zeros_like(basis)
    for suf, w in cfg["face_mix"].items():
        if suf in by:
            D += w * (key_coords(by[suf]) - basis)
    # material groups
    mats = [m.name for m in me.materials]
    vmat = np.full(len(me.vertices), -1)
    for p in me.polygons:
        for vi in p.vertices:
            vmat[vi] = p.material_index
    iris = [i for i, n in enumerate(mats) if "EyeIris" in n or "EyeHighlight" in n]
    skin = [i for i, n in enumerate(mats) if "Face_00_SKIN" in n]
    co = basis + D
    # irises: shrink about each eye's iris centre (left / right by sign of y)
    for side in (-1, 1):
        m = np.isin(vmat, iris) & (np.sign(co[:, 1]) == side)
        if m.any():
            c = co[m].mean(axis=0)
            D[m] += (co[m] - c) * (cfg["iris_scale"] - 1.0)
    # lower face: slimmer cheeks, longer chin (smooth falloff from the eye line down)
    eye_z = co[np.isin(vmat, iris)][:, 2].mean() if np.isin(vmat, iris).any() else co[:, 2].mean()
    zmin = co[np.isin(vmat, skin)][:, 2].min()
    front = co[:, 0] > np.percentile(co[:, 0], 35)
    t = np.clip((eye_z - 0.01 - co[:, 2]) / max(eye_z - zmin, 1e-3), 0.0, 1.0)
    t = t * t * (3 - 2 * t)
    D[:, 1] += co[:, 1] * (cfg["cheek_slim"] - 1.0) * t * front
    D[:, 2] -= cfg["chin_drop"] * t ** 2 * front
    # write: basis + D; every key + D except the eye-closing ones (absolute, so a blink stays a blink)
    absolute = ("EYE_Close", "EYE_Close_R", "EYE_Close_L", "EYE_Joy", "EYE_Joy_R", "EYE_Joy_L", "ALL_Joy", "ALL_Fun",
                "Eye_Fun")
    kbs[0].data.foreach_set("co", (basis + D).astype(np.float32).ravel())
    for suf, k in by.items():
        c = key_coords(k)
        if suf in absolute:
            # keep the closed lid where it was, but carry the chin / cheek / iris edits
            lid = np.linalg.norm(c - basis, axis=1) > 1e-5
            add = D.copy()
            add[lid] = 0.0
            k.data.foreach_set("co", (c + add).astype(np.float32).ravel())
        else:
            k.data.foreach_set("co", (c + D).astype(np.float32).ravel())
    for k in list(kbs)[1:]:
        if "Fcl_" not in k.name:
            k.data.foreach_set("co", (key_coords(k) + D).astype(np.float32).ravel())
    me.vertices.foreach_set("co", (basis + D).astype(np.float32).ravel())
    me.update()
    return {"face_offset_max_mm": round(float(np.linalg.norm(D, axis=1).max()) * 1000, 2)}


def sec_to_bip(arm, ob):
    """Move every J_Sec_* (VRoid secondary: bust, skirt, ribbon, sleeve) weight of the skinned mesh onto its nearest
    J_Bip_ ancestor, so vroid_finish.py's bone merge (which sends all J_Sec_* to the chest) can't pin leg or arm
    skin to the chest."""
    moved = {}
    gi = {g.index: g.name for g in ob.vertex_groups}
    target = {}
    for idx, nm in gi.items():
        if not nm.startswith("J_Sec_") or nm not in arm.data.bones:
            continue
        b = arm.data.bones[nm]
        while b is not None and not b.name.startswith("J_Bip_"):
            b = b.parent
        if b is not None:
            target[idx] = b.name
    if not target:
        return moved
    for nm in set(target.values()):
        if nm not in ob.vertex_groups:
            ob.vertex_groups.new(name=nm)
    for v in ob.data.vertices:
        for g in list(v.groups):
            t = target.get(g.group)
            if t is None or g.weight <= 0:
                continue
            ob.vertex_groups[t].add([v.index], g.weight, "ADD")
            moved[gi[g.group]] = moved.get(gi[g.group], 0) + 1
            g.weight = 0.0
    return {k: v for k, v in sorted(moved.items(), key=lambda t: -t[1])[:12]}


def part_attributes(body):
    """Float point attributes with the VRoid hand / foot segment weights (survive vroid_finish's bone merge)."""
    me = body.data
    gi = {g.index: g.name for g in body.vertex_groups}
    n = len(me.vertices)
    out = {k: np.zeros(n, dtype=np.float32) for k in ("vr_palm", "vr_f1", "vr_f23", "vr_thumb", "vr_toe", "vr_foot")}
    for v in me.vertices:
        tot = sum(g.weight for g in v.groups) or 1.0
        for g in v.groups:
            nm = gi[g.group]
            w = g.weight / tot
            if not nm.startswith("J_Bip_"):
                continue
            if nm.endswith("_Hand"):
                out["vr_palm"][v.index] += w
            elif "Thumb" in nm:
                out["vr_thumb"][v.index] += w
            elif any(f in nm for f in ("Index", "Middle", "Ring", "Little")):
                seg = nm.rstrip("_end")[-1]
                out["vr_f1" if seg == "1" else "vr_f23"][v.index] += w
            elif "ToeBase" in nm:
                out["vr_toe"][v.index] += w
            elif nm.endswith("_Foot"):
                out["vr_foot"][v.index] += w
    for k, arr in out.items():
        a = me.attributes.get(k) or me.attributes.new(k, "FLOAT", "POINT")
        a.data.foreach_set("value", arr)
    return {k: int((a > 0.5).sum()) for k, a in out.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", required=True)
    a = ap.parse_args(U.args_after_dashes())
    cid = a.char
    cfg = PREP[cid]
    cdir = U.char_dir(cid)
    path = os.path.join(cdir, "build", "cache", "%s_anime_fit.blend" % cid)
    bpy.ops.wm.open_mainfile(filepath=path)
    if bpy.data.objects.get("ARM-vroid") is None or "sd_prep" in bpy.data.objects["ARM-vroid"].keys():
        raise SystemExit("fit file missing or already prepped: rerun vroid_fit.py first")
    arm = bpy.data.objects["ARM-vroid"]
    rep = {}
    hair = bpy.data.objects.get("GEO-%s_hair" % cid)
    if hair is not None and cfg.get("keep_only"):
        rep["hair"] = keep_only_chains(arm, hair, cfg["keep_only"])
    if hair is not None and cfg.get("drop_chains"):
        rep["hair"] = drop_hair_chains(arm, hair, cfg["drop_chains"], cfg.get("keep_tail"))
    if hair is not None and cfg.get("streak_lock"):
        rep["streak"] = mark_streak(arm, hair, cfg["streak_lock"])
    face = bpy.data.objects["GEO-%s_face" % cid]
    if cfg.get("face_mix") is not None:
        rep["face"] = sharpen_face(face, cfg)
    rep["sec_to_bip"] = sec_to_bip(arm, bpy.data.objects["GEO-%s_body" % cid])
    rep["parts"] = part_attributes(bpy.data.objects["GEO-%s_body" % cid])
    arm["sd_prep"] = 1
    U.write_json(os.path.join(cdir, "review", "a1b_prep", "prep_report.json"), rep)
    U.log("PREP", rep)
    U.save(path)


if __name__ == "__main__":
    main()
