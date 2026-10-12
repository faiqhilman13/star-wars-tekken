# Kael — build notes (M2: full costume)

## M2b status: paused 2026-10-12, 15:15 (lead's PAUSE; art direction under review)

> **WARNING: the live GLB is a broken M2b work in progress.**
> The last full rebuild finished just before the pause and exported over both `public/models/kael.glb` and
> `exports/kael.glb` (6.07 MB). It has not been through the gates. `sd_glb_check` fails it:
> - 45,707 triangles, over the 40k budget and just over the 45k allowance;
> - the joined costume meshes (`GEO-kael_primary`, `secondary`, `trim` and `leather`) export with no skin.
>
> In game the costume would not deform. The accepted M2 GLB (4.89 MB) was overwritten and there is no git copy.
> Nothing has been reverted. To fix: find the bug that loses the Armature modifier when `sd_bake.py` joins the
> pieces, cut about 1.5k triangles, then re-export. Or rebuild M2 from the M2 scripts.

Pipeline order now: body (finish) → costume → **drape (new)** → hair → assemble → bake → export.
All phases ran headless, and the masters are saved (`kael_master.blend` 15:05, `kael_baked.blend` 15:10).

**Done (code + one full build):**
1. **Cloth drape (`tools/blender/sd_drape.py`, new phase 04b).**
   - HIGH garments are subdivided costume pieces, draped with Blender cloth: pins per piece, body and inner-layer collision, gravity, and negative shrink so the slack folds. They sit in the `HIGH` collection, 328k triangles in total.
   - Ridged Perlin creases on the sash, cuffs and boot ankles.
   - LOW pieces are the HIGH decimated to per-piece budgets, with weights transferred from the base piece.
   - Rim-only solidify gives edge thickness.
   - Skin coverage is recomputed against the draped clothes.
   - Guard: an unstable sim result is discarded and logged.
2. **Construction (`sd_costume_kael.py`).**
   - The tunic is a loose fit, cinched under the sash.
   - The skirt is three panels split at the sides, with a front crossover.
   - Tabards are cut from the draped tunic and draped over it.
   - Folded collar bands are smoothed and resampled, and the tabards tuck under them.
   - The undertunic is trimmed to the neckline, so it can't poke through.
   - Sleeves taper toward wide cuffs and are draped with stiffer cloth.
   - The `lapel_shade` stripe banding is gone.
3. **Bake (`sd_assemble.py` / `sd_bake.py`).**
   - Each costume piece now bakes from its own HIGH twin with `bake_maps.py`: normal, AO, base colour and roughness, into a shared per-material UV layout. The results are composited by UV coverage and the pieces joined afterwards. This removes the cross-layer hits.
   - AO (6 cm distance, light blur) goes into ORM R.
   - `occlusionTexture` is written on every baked material through a "glTF Material Output" node; the WIP GLB shows it on all six.
   - A tiling plain weave is UDN-blended into the fabric normals.
   - Rim-strip UVs are collapsed onto the island edges to remove the "confetti" islands. That fix is in this last build but has not been inspected yet.
4. **Fabric look-dev (`sd_matlib.fabric`, v3).**
   - Mottling and slub colour variation.
   - Grime toward hems and cuffs (geodesic `sd_hem`).
   - Seam grooves at the shoulders, sides, inner sleeves and trouser sides.
   - Topstitch dashes 4 mm off the seams and 12 mm in from every hem.
   - The leather grain bump is roughly doubled.
5. **Hair, beard and eyes.**
   - About 2× finer hair cards (base, mid and top layers at half width and twice the count).
   - The isolated tuft below the hairline is removed, and the hairline is darkened into the skin with a 1.9 cm gradient plus a short-hair stipple.
   - The beard is denser and fuller (500 cards, more strands, stronger stubble tint).
   - The hair specular is tinted brown so the sheen isn't grey.
   - Eyes are grey-blue (a blend of MPFB grey and lightblue) with an off-white sclera tint.
6. **Review tooling (`sd_review.py`).**
   - `gamelook` shots: 300 and 600 px tall, az 73 side camera, arena light preset, and a `--blade` point light at the sword hand.
   - `turntable` shots.

**In progress / not verified:**
- No renders yet of the last build: the baked normal and AO after the rim fix, the face after hair v3 and the eyes, game-look, turntable, and the pose sheet.
- Speckle check on the new normal maps.
- The sleeve stretch with arms overhead has not been looked at.

**Not started:**
- Validate / roundtrip / in-game shots for M2b.
- The tiling weave in roughness.
- Final budget trim to ≤ 45k triangles.
- M3.

---

Delivered (M2, superseded by the WIP export above): `public/models/kael.glb` (4.89 MB), `art/characters/kael/asset-manifest.json`.
Look: Obi-Wan (ROTS), adapted to the `LOOKS.kael` palette in `src/render/characters.ts`.

## Rebuild (Blender 5.2 + MPFB 2, headless, deterministic)

```
python tools/blender/run.py tools/blender/sd_body.py         -- --char kael --stage fit      # slow: MPFB fit (cached)
python tools/blender/run.py tools/blender/sd_body.py         -- --char kael --stage finish   # fists, palmOpen, weights, skin
python tools/blender/run.py tools/blender/sd_costume_kael.py -- --char kael                  # 04 costume
python tools/blender/run.py tools/blender/sd_hair.py         -- --char kael                  # 05 hair/beard cards + atlas
python tools/blender/run.py tools/blender/sd_assemble.py     -- --char kael                  # 06 one mesh per material
python tools/blender/run.py tools/blender/sd_bake.py         -- --char kael                  # bake (plan: build/bake_plan.json)
python tools/blender/run.py tools/blender/sd_export.py       -- --char kael                  # GLB + manifest + public/models
python tools/blender/sd_glb_check.py public/models/kael.glb --char kael
```
Master: `kael_master.blend` (authoring, non-destructive coverage mask). Baked/delivery: `kael_baked.blend`.
All randomness uses fixed seeds (`hair_seed` 1977, numpy `default_rng`).

## Numbers

| | |
|---|---|
| Triangles | 38,573 (budget 40k): body 15,572 · primary 9,229 · hair+beard 5,726 · leather 2,960 · secondary 2,274 · eyes 1,060 · trim 880 · lashes 368 · metal 312 · brows 192 |
| Materials | 8: MAT-skin, MAT-eyes, MAT-hair, MAT-kael_primary, MAT-kael_secondary, MAT-kael_trim, MAT-kael_leather, MAT-kael_metal |
| Textures | 19 WebP (EXT_texture_webp), largest 2048²: skin base/normal 2048, skin ORM 1024; hair atlas 2048 RGBA; primary base 2048, normal 1024, ORM 512; secondary/trim base 1024, normal 512, ORM 256; leather base/normal 1024, ORM 512; metal base 512, ORM 256; eyes 512 |
| Joints | 17 core + 14 skirt (`skirt_{frontN,near,backN,back,backF,far,frontF}_{0,1}` on the game's 7 anchors); identity rest rotations, contract positions (max error 0.0 mm); no Root |
| Morphs | `palmOpen` on GEO-kael_body (left hand + wrist, 1,768 vertices) |
| Influences | ≤ 4 (no WEIGHTS_1) |
| Armature extras | gripCentreN [-0.002, -0.0562, -0.0177], gripCentreF [0.0024, -0.0566, -0.0178], gripRadius 0.0215, gripAxis "hand-local +z" |

## Costume
Cream undertunic (visible in the V and collar only; the hidden rest is trimmed so it cannot poke through), wrapped
tunic with tabards and smoothed folded collar bands, wide bell sleeves over the forearm cuffs, obi sash, leather belt
with buckle, five pouches and a hilt clip with D-ring, trousers bloused into tall boots, pleated skirt on the 14 skirt
bones (weights mirror the runtime's makeSkirt). Trimmed full beard + moustache as cards over a stubble tint in the
skin; layered swept-back hair cards (base / mid / crown / soft hairline layers) with real strand-alpha clumps.

## Runtime notes
- **Alpha:** MAT-hair is `MASK`, cutoff 0.35, double-sided. Brows and lashes are separate meshes
  (`GEO-kael_brows`, `GEO-kael_lashes`) so the runtime's `/brow|lash/` soft-blend path finds them; their transparent
  texels carry the strand colour (no dark fringe when blended). Hair cards + beard are one mesh (`GEO-kael_hair`), cutout.
- **Tint:** primary/secondary/trim base colour textures are neutral (baked with the palette colour white);
  the palette colour is `baseColorFactor` (primary 0x86643F, secondary 0xCABD9F, trim 0x8C6A44 in linear), so
  `color.multiply()` mirror tints work unchanged. Tabard/trousers darkness is baked into the neutral map.
- **Colour spaces:** base colour WebP = sRGB; ORM (R=1, G=roughness, B=metallic) and normal = linear.
- **Normals:** tangent-space, OpenGL (+Y), from Cycles self-bakes of the look-dev bump (no HIGH->LOW for the
  costume). MAT-metal is metallic 1 (ORM B=1).
- **Sides:** fabrics and leather are `doubleSided` (single-layer skirt/sleeves/tabards); skin, eyes, metal single.
  The runtime forces leather to FrontSide; boots/belt/pouches are closed so that is safe.
- **Coverage:** skin under the costume is deleted in the delivery mesh (only head, neck, hands, wrists and the V
  of the chest remain), so no skin can poke through clothes in any pose.
- **Skirt:** the pose sheet drives the skirt with a Python port of `driveSkirt`/`skirtAnchors`
  (`tools/blender/sd_poses.py`), so it shows what the game will do.
- **Axes:** authored facing +X (game x), Z up; GLB is Y up with the character facing game +x, near side +z.
  Height with hair 1.979 m (body 1.95 m + hair volume).

## Review evidence (`art/characters/kael/review/`)
- `05_hair/sheet_face.png` — face in studio + arena light; `05_hair/atlas_view.png`.
- `03_body/sheet_hands_hilt.png` (fists on the 0.0215 hilt proxy), `03_body/sheet_hands_palmopen.png`.
- `07_poses/sheet_poses.png` — crouch, lunge, overhead, high kick, lying back, twist 90, splits (az 73 + az 20).
- `08_baked/sheet_body.png`, `08_baked/sheet_gameplay.png` — baked materials, gameplay 200/300 px, faces.
- `09_export/sheet_glb.png` (re-imported GLB, arena + studio light), `glb_check.json`, `validate.json`,
  `09_roundtrip/roundtrip.json`; `10_ingame/` (dev-server captures, Kael vs Vexa).

## Known issues
- Collar sides at the back of the neck still show small stair steps in extreme close-ups (invisible at gameplay size).
- Hair cards show their card structure in close-ups under hard light; the hairline is soft but fairly straight.
- The bell sleeves are tubes over the tunic; with arms overhead the sleeve tops stretch rather than fold.
- `scripts/state-shots.mjs` could not launch Playwright's Chromium on this machine (`spawn UNKNOWN`), so the
  in-game captures were taken in the browser pane at a 1280×720 viewport, saved at 800×450.
