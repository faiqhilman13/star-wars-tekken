# tools/blender — Saber Duel character build scripts

All scripts run headless through `run.py`, which starts Blender 5.2 with the VRM add-on (and the retired MPFB)
enabled:

```
python tools/blender/run.py tools/blender/<script>.py -- <args>
python tools/blender/run.py --skill validate.py -- ...      # blender-image-to-3d skill scripts
```

Builds are deterministic (no unseeded randomness). Outputs go to `art/characters/<id>/` and `public/models/<id>.glb`.
The contract is `art/CHARACTER_PIPELINE.md` (v5 header) plus `art/ANIME_DIRECTION.md`.

## Anime pipeline (v5, current)

| Step | Script | What it does |
|---|---|---|
| 1 | `vroid_fit.py --char <id> [--base <vrm>]` | Imports the VRoid VRM, drops helpers and the MToon outline modifiers, and rotates into the contract frame (faces +X). It swings the arms and legs plumb (DQS, baked as rest) and twists the forearms so the open palm faces forward. It then warps every VRoid bone onto the contract joints, at heroic proportions, with a linear blend of per-bone affine maps; the head keeps its size, the limbs are stretched and widened. Output: `build/cache/<id>_anime_fit.blend` and `review/a1_fit/fit_report.json`. |
| 2 | `vroid_finish.py --char <id>` | Strips the base clothes (the painted shorts stay as underwear) and restyles the hair by posing the VRoid hair joints. Recolours skin, hair and iris. Builds the fists (curl scan against the 21.5 mm hilt, thumb IK) and keeps the left open hand as `palmOpen`. Makes `expr_*` face morphs from the `Fcl_*` blendshapes, and the toon materials: face/eye atlases, baseColor-only, `toon` extras in linear RGB. Adds toon ellipsoid normals on face and hair, then the contract skeleton with merged weights (≤ 4 influences), the `COLOR_0` outline mask (`sd_outline`), and the grip extras on the armature. Output: `<id>_anime_master.blend`, `review/a1_finish/*.json`. |
| 2b | `kael_costume.py --char kael` (per-character costume script) | Reads `<id>_anime_master.blend`, writes `<id>_anime_a2.blend`. Kael's costume is the base's own VRoid outfit (kept by `keep_clothes`), recoloured and mildly reshaped:<br>• hoodie → tunic: the lower body stretched to a mid-thigh skirt on `skirt_*` bones, the sleeves flared, the hood folded down;<br>• slacks → trousers;<br>• shoes plus a shaft from the slacks' lower legs → boots.<br>Clean simple pieces are built with `toon_garment.py`: obi, belt, pouches, clip, tabard tails, and a half-cloak on `cape_0..3`. The crossover V, undertunic, tabards and forearm wraps are painted per texel through each mesh's UVs, and the covered skin is removed. |
| 2b | `thane_costume.py --char thane` | Reads `<id>_anime_master.blend`, writes `<id>_anime_a3.blend`. This is the masked character (no face, hair or skin shipped; dark gloves keep `palmOpen`). It reuses the hoodie as the robe top with wide pleated sleeves, the slacks and the boots. Clean pieces:<br>• a floor-length ivory robe split front and back over a dark under-robe, on 8 `skirt_*` panels with knee segments;<br>• a gold sash and buckle;<br>• a mantle on `pad_N` / `pad_F`;<br>• a deep hood, a faceted mask (flat-shaded planes, painted visor), a forked crest;<br>• a dark cape on `cape_0..3`. |
| 3 | `vroid_export.py --char <id> [--master <blend>]` | Writes the GLB: skins, morphs (no morph normals, so the toon normals hold), `export_extras` (toon and grip), `export_vertex_color='ACTIVE'` (`COLOR_0`), WebP textures. Copies it to `public/models/<id>.glb` and writes `art/characters/<id>/asset-manifest.json`. |
| gate | `sd_glb_check.py public/models/<id>.glb --char <id>` | Contract check (plain Python). v5 mode is automatic when `MAT-face` is present: ≤ 50k triangles, `COLOR_0` on every primitive, `toon` extras on every material, `expr_*` on the face. |
| gate | `--skill validate.py -- --blend <master> --collections LOW --budget-tris 50000 --require-uv`, then `--skill roundtrip.py -- --file public/models/<id>.glb --out <dir>` | Skill gates. Use absolute paths. |
| review | `sd_review.py -- --blend <master> --out <dir> --toon [--shots body,face,head,upper,hands,gamelook,turntable] [--poses crouch,lunge,overhead,high_kick,lying_back,twist90] [--hilts review/a1_finish/grip_report.json] [--light game] [--blade 2b8cff]` | EEVEE review renders. `--toon` swaps in a preview of the runtime toon shader (`sd_toon_preview.py`, which reads the same `toon` extras) and inverted-hull outlines from `COLOR_0`. The preview follows `src/render/rig/toon.ts`:<br>• shade colour 15% deeper;<br>• material rim as a narrow hard band, ×0.1 on hair;<br>• the hair angel ring;<br>• soft face band;<br>• no light shadows.<br>`head` gives the back, far side and top of the head; `upper` gives head to hips. The in-game check is `scripts/state-shots.mjs` against the review server. `gamelook` is the game's side camera at 300 and 600 px. |
| sheets | `sd_sheet.py --out <png> --cols N --height H <pngs...>` | Contact sheets. |

### Optional config blocks (`vroid_chars.py`, opt-in; characters without them build as in A1)
- **`upper_thick`, `fore_thick`, `shoulder_thick`** (`vroid_fit`): per-segment arm and clavicle widening. Each defaults to `arm_thick` (the shoulder to 1).
- **`face_style`** (`vroid_face.py`): eye, iris and highlight scale, brow drop and tilt, lower-face stretch, chin and jaw widening, cheekbone, and lash and brow line styling. These are smooth spatial warps on the face and body, applied to the basis and every shape key.
- **`beard`** (`vroid_face.py`): a painted short beard and moustache on the face texture. It has crisp field edges, pointed notches along the cheek line, mouth-corner shade lines and an under-jaw band, and follows every expression.
- **`blush`**: the painted skin is flattened to the skin hue, then blush is painted only at the cheek, ear, knuckle, knee and lip spots.
- **`hair_style`** (`vroid_hair.py`):
  - `{"mode": "soft"}` keeps the authored VRoid hair. It deletes the ahoge islands and eases the bang tips up with one smooth field.
  - `"comb"` (re-routing every lock) is experimental and not used: deformed VRoid assets look worse than the originals. Preserve the authored quality.
- **`hair_shade_mul`**: a linear hair shade multiplier; warm, as Guilty Gear shades hair.
- **`hair_rim_scale`**: 0 gives a null `rimColor` on the hair. Ellipsoid toon normals make the rim band wide on hair.
- **`J_Sec_*` groups**: `merge_to_contract` follows each secondary bone up to its nearest `J_Bip` ancestor, so limb twist helpers stay on the limb.
- **`keep_clothes`**: a list of material keywords. The base's clothing is kept as `GEO-<id>_clothes` in `COSTUME_SRC`, with the same fit and the same warp. Physics parts are remembered as `sd_sec_hood` / `sd_sec_hoodstring` attributes, for a costume script.

### Adding a character (Vexa, Asha, Thane…)
1. Add a config to `vroid_chars.py`:
   - `base` VRM;
   - proportions: `head_scale`, `*_width`, `*_depth`, `*_thick`, `hand_scale`, `foot_scale`, `ankle_mesh_z`;
   - colours as sRGB hex: `skin_lit`/`skin_shade`, `hair_lit`/`hair_shade`/`hair_spec`, `eye_iris`, `brow_hex`, `rim_hex` (`LOOKS.<id>.rim`), `outline_hex`;
   - the hair restyle (`hair_sweep_deg`, `hair_loose`).

   The female bases (`Base_Female`, `HairSample_Female`, `AvatarSample_*`) use the same J_Bip bone names.
2. Run `vroid_fit.py`, look at `sd_review.py --shots body` on `build/cache/<id>_anime_fit.blend`, tune the
   proportions, then run `vroid_finish.py` and `vroid_export.py`, and the gates.
3. Costume pieces (A2 onward) go in their own `<id>` costume script on top of the anime master. Prefer the samples' authored garments (`keep_clothes`, or a donor VRM fitted through `vroid_fit`), recoloured and mildly reshaped. Add clean bold pieces only where no sample garment exists, using `toon_garment.py`: `MeshBuilder` (grids and thick sheets with auto winding), rounded boxes, `NearestWeights`, `Canvas` painters (flat colour plus one gradient, edge bands, stitches) and `recolour_luma`, `calm_normals` (authored clothing shading normals blended toward cylinders round the torso and arms, so the cel terminator draws clean shapes instead of fold smudges).
4. In-game check: `bash scripts/review-server.sh`, then `scripts/state-shots.mjs --url http://127.0.0.1:5190`. Run with `PLAYWRIGHT_BROWSERS_PATH` set. **Restart the review server after creating a new `public/models/<id>.glb`.** The no-HMR server doesn't index new public files, and the runtime silently falls back to the procedural body. Name the
   materials `MAT-<id>_primary`, `_secondary`, `_trim`, `_leather`, `_metal` (≤ 8 materials in total). Each needs
   `toon` extras and `sd_outline` (R = 0.6 on inner costume edges, 1 on the silhouette).

### Conventions
- **Frame:** the character faces +X, up is +Z, and the right side ("N") is −Y. glTF export maps this to the game
  frame (x forward, y up, z near).
- **Toon extras** (material custom property `toon`):
  - `shadeColor` multiplies the base colour in shadow (linear RGB).
  - `shadeShift` and `shadeToony` (0..1) set the terminator position and hardness.
  - `rimColor` (linear RGB, or null) and `rimPower` set the rim light.
  - `outlineWidth` (m) and `outlineColor` (linear RGB) set the outline.
  - `matcap` is `none`, `metal` or `hair`; `unlit` is a bool.
- **Grip extras** on the armature node: `gripCentreN` / `gripCentreF` (game axes, offset from the hand joint),
  `gripRadius` 0.0215 and `gripAxis`.

## Realistic pipeline (v4, retired; kept for reference)
The realistic pipeline was MPFB based:
- body: `sd_body.py`;
- costume: `sd_costume_kael.py`, `sd_cloth.py`, `sd_matlib.py`;
- cloth drape: `sd_drape.py`;
- hair cards: `sd_hair.py`, `sd_look.py`;
- assembly and HIGH→LOW bake: `sd_assemble.py`, `sd_bake.py`;
- export: `sd_export.py`.

The cloth drape and the HIGH→LOW bake helpers can be reused for anime costume folds.
`proc_export.mjs` dumps the game's procedural costumes as JSON blockouts (`node tools/blender/proc_export.mjs`).
