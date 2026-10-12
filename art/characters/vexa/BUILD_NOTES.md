# VEXA "The Crimson Marauder": build notes (anime v5)

Delivered: `public/models/vexa.glb` (1.39 MB) and `art/characters/vexa/asset-manifest.json`.
Master: `art/characters/vexa/vexa_master.blend`. The finished VRoid base is `vexa_anime_master.blend`.

## Rebuild (headless, deterministic)

```
bash art/characters/vexa/build/build.sh          # base (fit, prep, finish) -> costume -> export + sd_glb_check
bash art/characters/vexa/build/build.sh costume  # art/characters/vexa/build/a2_costume.py only
```

**Base (`vroid_chars.VEXA`):** AvatarSample_F, head 1.02 (about 8 heads), broad chest and shoulders, arms 1.24, hands 1.22.

**Prep (`art/characters/asha/build/a1b_prep.py --char vexa`):**
- Keeps only one authored VRoid lock (F's swept front bang); the hood covers the rest.
- Moves every `J_Sec_*` skin weight onto its `J_Bip` ancestor. AvatarSample_F's skin carries `J_Sec_*UpperArm/LowerArm/UpperLeg/LowerLeg` weights, and `vroid_finish.py` would otherwise send those to the chest.

**Costume:** `a2_costume.py` uses the shared toolkit `art/characters/asha/build/toonkit.py`. Every new piece is a clean, bold shape; there is no procedural noise.

| Piece | Construction | Material | Bones |
|---|---|---|---|
| Bodysuit | every body face (cylinder UVs, side seams), 1.5 mm proud | secondary | body |
| Gloves | hand faces | metal atlas (patent black) | body |
| Cuirass | ray-cast shell, sweetheart top and armpit cut-outs, crimson top and bottom strips; three abdominal lames (front and sides) | metal | body (arms excluded) |
| Pauldrons | big: three spherical lames (r 0.12–0.16) on the sword shoulder; small: two lames (r 0.09–0.10); crimson rims | metal + trim | `pad_N`, `pad_F` (at the shoulder joints) |
| Gauntlets | forearm tubes with a flared elbow cuff | metal | forearm surface |
| Waist | crimson sash, belt, round buckle | trim, metal | body |
| Coat | six long panels split front and back (frontN/F, sideN/F, backN/F): black outside, deep crimson lining, crimson edge strips | primary / trim | `skirt_<label>_0/1` |
| Cape | from the shoulders, torn sawtooth hem with long tears; black outside, charcoal inside | primary / secondary | `cape_0..3` |
| Boots | leather shin tube, lofted foot, sole and cuff; metal greaves and knee cops | metal atlas | legs |
| Hood | see below | primary / secondary, crimson edge | head → neck → chest |
| Mask | see below | metal + MAT-visor | head |
| Lock | the authored bang, turned to the near side so it falls from under the brim over the mask | hair | head |

**Hood.** One sheet with an arch opening:
- close and round over the skull;
- the brim is pulled forward and down into a peak over the brow;
- two clean vertical folds on each side;
- a cowl that settles on the shoulders over the cape top.

**Mask.** An envelope of every face vertex plus clearance, so nothing can poke through:
- an angular brow ridge over the visor;
- flat cheek planes that angle back (a 60° wedge from the centre ridge, clamped to the face);
- a narrow V jaw;
- a chevron visor slit;
- flat-shaded planes and no centre seam.

The face mesh is used only to fit the hood and mask, then dropped (masked fighter, no MAT-face or MAT-eyes, no `expr_*`).

## Numbers

| | |
|---|---|
| Triangles | 31,777: metal 11,892 · coat 7,868 · body 6,588 · trim 3,992 · mask 1,088 · hair 349 |
| Materials (6) | MAT-hair, MAT-vexa_primary, MAT-vexa_secondary, MAT-vexa_trim, MAT-vexa_metal, MAT-visor. Gloves, boots and belt are atlased into `_metal`. |
| Textures | WebP: primary, secondary and metal 1024², trim 512², hair 512×1024, visor 64² |
| Joints (35) | 17 core + `skirt_{frontN,frontF,sideN,sideF,backN,backF}_{0,1}`, `cape_0..3`, `pad_N`, `pad_F` |
| Morphs | `palmOpen` |
| Grip | gripCentreN [0.0017, -0.0422, 0.0068], radius 0.0215 |

**Toon extras:**
- **Rim:** `LOOKS.vexa.rim` × 0.3 on primary, secondary and metal; no material rim on `_trim` (lining, edges, sash), so the warm arena rim can't push it orange.
- **Crimson:** lit #8E0F1E, shade #4A0610.
- **Matcap:** `metal` on `_metal`.
- **Unlit:** `MAT-visor` (the runtime swaps it for its glow).
- **Outline mask:** 1.0 on silhouette pieces, 0.6 on edge strips and the buckle ring.

## Gates (`art/characters/vexa/review/`)
- `a3_export/sheet_body.png`, `sheet_face.png` (mask close-ups and the gamelook at 300 and 600 px), `sheet_hands.png`, `sheet_poses.png` (§8).
- Head working renders: `a2_costume/head/sheet.png`.
- `a3_export/glb_check.json`: v5 (detected from the toon extras), PASS (0 fail, 0 warn).
- `a3_export/validate.json`: 0 FAIL.
- `a3_roundtrip/roundtrip.json`: no errors, 35 bones, height 1.945 m.
- `a4_ingame/*.png` and `sheet_crops.png` (1080p).

## Known issues
- **Cape and coat at grazing angles:** in-game, the arena's orange rim (`rimHard` band) still warms the cape's charcoal inside where it is seen edge-on (trailing behind in a lunge). That light is the runtime arena rim, not a material setting.
- **Fist channel:** about 17 mm, against the 21.5 mm hilt (shared fist scan). Accepted under the gloves.
- **Pauldrons:** `sd_poses` doesn't drive pads, so the pose sheet shows them at rest. The runtime follows the arm at 0.45.
