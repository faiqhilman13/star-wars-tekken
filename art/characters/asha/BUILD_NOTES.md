# ASHA "The Twin Fang": build notes (anime v5)

Delivered: `public/models/asha.glb` (2.03 MB, 7 materials) and `art/characters/asha/asset-manifest.json`.
Master: `art/characters/asha/asha_master.blend`. The finished VRoid base is `asha_anime_master.blend`.

## Rebuild (headless, deterministic)

```
bash art/characters/asha/build/build.sh          # all stages: base -> costume -> export + sd_glb_check
bash art/characters/asha/build/build.sh base     # vroid_fit.py, a1b_prep.py, vroid_finish.py
bash art/characters/asha/build/build.sh costume  # a2_costume.py
bash art/characters/asha/build/build.sh export   # vroid_export.py --master asha_master.blend, then sd_glb_check
```

| Step | Script | What it does |
|---|---|---|
| fit | `tools/blender/vroid_fit.py` (shared) | HairSample_Female, fitted with `vroid_chars.ASHA`: head 1.10, athletic widths, hands 1.20. About 7.6 heads tall. |
| prep | `build/a1b_prep.py` | **Hair:** drops the cat ears and the near twin tail; keeps the far twin tail as the ponytail source (`vr_pony*` attributes, chain heads in `review/a1b_prep/prep_report.json`). **Face:** bakes a small fixed blend of the VRoid lids and brows (EYE_Angry 0.22, EYE_Close 0.04, BRW_Angry 0.18) into the neutral face, with slimmer cheeks and smaller irises; the expression keys keep their deltas. **Body:** stores the VRoid hand and foot segment weights as attributes. |
| finish | `tools/blender/vroid_finish.py` (shared) | Fists, palmOpen, `expr_*`, toon materials, contract rig. `face_style` adds sharper adult eyes, a 5° brow tilt and a slightly longer chin; `blush` flattens the skin to a darker warm brown. |
| costume | `build/a2_costume.py` + `build/toonkit.py` | See below. |
| export | `tools/blender/vroid_export.py` (shared) | GLB with WebP textures, `toon` extras, `COLOR_0` outline mask and grip extras. |

## Design and construction
Everything is built clean and bold, with no procedural noise. Authored VRoid hair is kept and only moved and recoloured.

**Body garments.** These are body faces given costume materials over clean planar cuts, so nothing can poke through:
- teal halter crop top, filled across the cleavage and covering the sides of the bust;
- dark-teal leggings with a teal side stripe;
- orange spiral forearm wraps;
- fingerless dark-leather gloves.

**Top trims.** Ray-cast paths, not traced mesh edges:
- gold piping along the hem and the halter edge (armholes and neckline);
- a high dark-teal collar with a gold edge.

**Harness.** Two orange leather straps crossing in an X on the chest and the back, draped taut over the body, with gold rings at both crossings.

**Belt.** Stitched leather belt with a gold buckle.

**Skirt panels** (`skirt_<label>_0/_1`), teal with a darker lining and a gold V hem:
- `front`: short (to the thigh, V hem);
- `backN`, `backF`: long, hinged at 0.42;
- `back`: longest (calf), layered 7 mm outside the others.

The legs show at the sides.

**Boots** (procedural, clean lofts):
- a shin tube built from the ray-cast leg radius plus 9 mm, smoothed;
- a lofted D-section foot with a rounded toe box;
- a sole slab and a rolled cuff;
- painted tan X-wraps.

The leg skin under the boots is deleted.

**Far-shoulder guard** (`pad_F`). Two dark-leather lames over the left deltoid, with gold edges and painted rivets.

**Hair:**
- The VRoid bangs and side locks are kept; leftover cards of the removed tails and ears are dropped.
- **Ponytail:** the authored HairSample twin tail.
  - **Seat:** the root is at the upper back of the crown (ray at 62° from vertical), with a gold tie.
  - **Pose:** yawed 90° to the back, then given a progressive bend. It is pitched 16° back at the tie and eases to −4° from 15 % to 70 % of its length, so it is high but hangs (Ahsoka / Ibuki).
  - **Scale:** 1.36 along its length and 1.2 across.
  - **Bones:** `hair_0..2` come from its own VRoid chain weights.
- **White streak:** only the outer cards on the near side (mean lateral offset beyond 0.42 of the tail's half width at that height) use a white recolour of the same VRoid strand texture (atlas slot).

**Headband.** Orange band ray-fitted round the hair, with a knot at the near-back side and two swallowtail ribbons on `tail_0/1`.

## Numbers

| | |
|---|---|
| Triangles | 35,203 (budget 50k): body 7,480 · hair 8,960 · ponytail 1,489 · face 3,158 · leather 6,304 · trim 3,228 · primary 2,368 · secondary 2,216 |
| Materials (7) | MAT-skin, MAT-face, MAT-eyes, MAT-hair, MAT-asha_primary, MAT-asha_secondary, MAT-asha_leather. The gold trim (bands, rings, buckle) is atlased into `MAT-asha_leather`. It no longer has a metal matcap and isn't tinted in mirror matches. There is no `_trim` or `_metal`. |
| Textures | WebP: skin and face 2048², eyes 2048×1024, hair atlas 512×2048, primary, secondary and leather 1024², trim 512² |
| Joints | 17 core + `skirt_front_0`, `skirt_backN_0/1`, `skirt_backF_0/1`, `skirt_back_0/1`, `hair_0..2`, `tail_0/1`, `pad_F` (30) |
| Morphs | `palmOpen` (body); `expr_blink/angry/shout/pain/smile/focus` (GEO-asha_face) |
| Grip | gripCentreN [-0.0001, -0.0412, 0.0066], gripCentreF [-0.0001, -0.0412, -0.0066], radius 0.0215 |

**Toon extras** (linear RGB):
- **Rim:** `LOOKS.asha.rim` × 0.3 on skin and costume; none on hair and face (the runtime adds the character rim).
- **Shade colours:**
  - skin: warm red-brown;
  - teal: shifts to blue-violet;
  - orange: shifts to red-brown;
  - gold: shifts to rust.
- **Matcap:** hair uses `hair`.
- **Outline mask (`COLOR_0`):**
  - 1.0 on silhouette pieces (body, skirt, boots, belt, guard, hair, band);
  - 0.6 on inner pieces (piping, straps, rings, buckle, hem bands);
  - 0.85 on the ponytail;
  - the face keeps its own mask from the finish step.

## Gates and evidence (`art/characters/asha/review/`)
- `a3_export/sheet_body.png`: front, three-quarter, side, back and far side.
- `a3_export/sheet_face.png`: face close-ups, plus the gamelook at 300 and 600 px.
- `a3_export/sheet_hands.png`: both fists on the 21.5 mm hilt proxies.
- `a3_export/sheet_poses.png`: crouch, lunge, overhead, high kick, lying back and twist 90, at az 73 and az 20, with the skirt solver running.
- `a3_export/glb_check.json`: `sd_glb_check` v5, PASS (0 fail, 0 warn).
- `a3_export/validate.json`: 0 FAIL. The warnings are VRoid seam doubles, zero-area hair cards, and modifiers alongside shape keys (expected).
- `a3_roundtrip/roundtrip.json`: no errors, 30 bones, height 1.98 m.
- `a4_ingame/*.png`: the five state shots; `sheet_crops.png` shows close crops.
- Working renders: `a2_costume/` (head, detail, poses).

## Known issues
- **Ponytail root** clips slightly into the crown hair, visible as a crease in the profile close-up only.
- **Glove edge** at the knuckles follows triangles and is jagged up close; invisible at gameplay size.
- **Shoulder guard** follows the arm only in the runtime (`pad_F`, follow 0.45). `sd_poses` doesn't drive pads, so the pose sheet shows it at rest.
- **Boots** are clean procedural lofts rather than an adapted VRoid boot. AvatarSample_E's lace-up boots were tried (fitted with Asha's proportions) and not adopted. E's "Shoes" mesh is only the foot and platform sole (z < 0.13). The laced shaft and bow are painted into E's skin texture, so adapting them would mean transplanting skin-texture regions. They also read cute rather than wrapped.
