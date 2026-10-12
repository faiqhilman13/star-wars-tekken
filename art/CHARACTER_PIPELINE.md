# Saber Duel — character pipeline (contract)

> **v5 — anime direction (current).** Read `art/ANIME_DIRECTION.md` first.
>
> The realistic MakeHuman/MPFB route (v4) is **retired**: its last build is parked at
> `art/characters/kael/exports/retired/`. The bases are now CC0 VRoid models (VRM), imported with the
> Blender VRM add-on.
>
> **Unchanged from v4:**
> - §2 frame;
> - §3 skeleton and rest pose;
> - §4 hands, plus the grip-centre extras amendment;
> - §5 extra bones;
> - §7 output paths and the ≤ 8 MB GLB limit;
> - §8 gates;
> - the runtime binding.
>
> **Changes for v5:**
> - **Budget:** ≤ 50k triangles. Anime faces and hair need geometry. The rest of §7 applies.
> - **Bone mapping:** map VRoid humanoid bones into the 17 joints:
>   - `J_Bip_C_Hips` → hips;
>   - `J_Bip_C_Spine` → spine;
>   - `J_Bip_C_Chest` and `J_Bip_C_UpperChest` → chest;
>   - `J_Bip_C_Neck` → neck;
>   - `J_Bip_C_Head` → head;
>   - `J_Bip_R_Shoulder` → chest, with some weight on upperN;
>   - `J_Bip_R_UpperArm` → upperN;
>   - `J_Bip_R_LowerArm` → foreN;
>   - `J_Bip_R_Hand` and the fingers → handN;
>   - `J_Bip_R_UpperLeg` → thighN;
>   - `J_Bip_R_LowerLeg` → shinN;
>   - `J_Bip_R_Foot` and `J_Bip_R_ToeBase` → footN;
>   - the L side → the `*F` joints.
>
>   VRoid secondary bones (`J_Sec_*` hair, skirt, coat and bust) become the §5 extras
>   (`hair_*`, `tail_*`, `skirt_<label>_<0|1>`, `cape_*`) or merge into their parent joint.
> - **Toon materials** replace §6's PBR set:
>   - Each material exports baseColor only (the lit colour, painted style).
>   - Each material also carries glTF material **extras**: `toon: { shadeColor: [r,g,b], shadeShift
>     (−1..1), shadeToony (0..1), rimColor: [r,g,b] | null, rimPower, outlineWidth (metres), outlineColor:
>     [r,g,b], matcap: "none"|"metal"|"hair" }`. Take the values from the VRoid MToon parameters where
>     the base has them.
>   - No realistic normal or ORM maps.
>   - Material names:
>     - `MAT-skin`, `MAT-face` (face skin: soft shadow and no inner outline), `MAT-eyes` (unlit),
>       `MAT-hair`;
>     - `MAT-<char>_primary`, `_secondary`, `_trim`, `_leather`, `_metal`;
>     - `MAT-visor`.
>   - Mirror-match tints on primary, secondary and trim are unchanged.
> - **Outline mask:** vertex colour `COLOR_0` R = outline width scale (0 = no line, 1 = full).
>   Use 0 inside the face (eyes, mouth, nose) and on the hair's inner cards, about 0.6 on inner costume
>   edges, and 1 on the silhouette.
> - **Face expressions:** morph targets on the face mesh, named `expr_blink`, `expr_angry`,
>   `expr_shout` (open mouth, fierce), `expr_pain`, `expr_smile` and `expr_focus` (narrowed eyes).
>   Build them from the VRoid `Fcl_*` blendshapes. Masked characters (Vexa, Thane) may ship
>   none.
> - **Face mesh:** separate, `GEO-<char>_face`, so the runtime can give it face-specific shading.


The goal: Bannerlord-class realistic fighters (bodies, faces, hair, layered costumes) authored in Blender
with MakeHuman/MPFB 2, exported as GLB, and driven at runtime by the game's existing skeleton,
animation system and IK, which stay unchanged.

**Owners**
- Lead: this contract.
- Blender artist(s): `tools/blender/**`, `art/characters/**`, `public/models/*.glb`.
- Integration engineer: `src/render/rig/**` (loader and binding), `dev/model-lab*`.

Skill stack:
- **Blender side:** `text-to-blender` (orchestrator), `blender-skill-harmonizer`, `blender-image-to-3d`
  (gated phases, review renders, validate, bake, export, round trip), plus `blender-modeling`,
  `blender-materials`, `blender-uv-texturing` and `blender-export`.
- **Runtime:** `threejs-gltf-loading`.

## 1. Tools and environment
- Blender 5.2.1: `C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`.
  - MPFB 2.0.18 is installed (extension `bl_ext.user_default.mpfb`).
  - The MakeHuman CC0 system assets are installed (skins, eyes, brows, lashes, hair, proxies, base clothes and shoes).
- **Headless builds** (preferred, and needed for parallel work). Use `--factory-startup` to load MPFB:
  ```
  blender.exe --background --factory-startup -noaudio \
    --python-expr "import bpy; bpy.ops.preferences.addon_enable(module='bl_ext.user_default.mpfb')" \
    --python tools/blender/<script>.py -- <args>
  ```
- **Live GUI session** (the user can watch): `python tools/blender/bl.py <script.py>` runs code in the open
  Blender over the add-on socket on :9876.
  - MPFB calls there need a viewport context override (see `tools/blender/poc_human.py`).
  - Only one agent may use the live session at a time. Batch builds go headless.
- Proof of concept: `art/review/poc/` (`CAM-face.png`, `CAM-body.png`, `poc_human.blend`).

## 2. Coordinates and units
- 1 Blender unit = 1 m.
- **Authoring frame:** the character faces **+X**, up is **+Z**, and the character's **right** side
  (the sword arm, called "near" / `N` in the game) is on **-Y**.
- The glTF exporter (+Y up) maps Blender (x, y, z) to glTF (x, z, −y). That is exactly the game's body
  frame: x = toward the opponent, y = up, z = toward the camera (the near side).
- The origin is on the floor, under the hips. The soles of the boots rest on z = 0.

## 3. The skeleton (fixed; derived from `src/render/rig/dims.ts`)
Every GLB is authored around this exact rest skeleton at scale 1. The game scales the whole rig per
character at runtime (`look.scale`: kael 1, vexa 1.05, asha 0.95, thane 1.06), so do **not** bake
those scales into the GLB.

**Rest pose:** all joint rotations are identity. The legs and arms hang straight down and the spine
and neck are vertical. Joint positions in game coordinates (x fwd, y up, z near), metres:

| joint (bone / vertex group name) | parent | rest position (x, y, z) |
|---|---|---|
| `hips` | — | (0, 1.020, 0) |
| `spine` | hips | (0, 1.120, 0) |
| `chest` | spine | (0, 1.380, 0) |
| `neck` | chest | (0, 1.630, 0) |
| `head` | neck | (0, 1.730, 0) — top of the skull about 1.94–1.96 |
| `upperN` (right shoulder) | chest | (0, 1.580, +0.190) |
| `foreN` (right elbow) | upperN | (0, 1.290, +0.190) |
| `handN` (right wrist) | foreN | (0, 1.020, +0.190) |
| `upperF` (left shoulder) | chest | (0, 1.580, −0.190) |
| `foreF` (left elbow) | upperF | (0, 1.290, −0.190) |
| `handF` (left wrist) | foreF | (0, 1.020, −0.190) |
| `thighN` (right hip) | hips | (0, 0.980, +0.100) |
| `shinN` (right knee) | thighN | (0, 0.520, +0.100) |
| `footN` (right ankle) | shinN | (0, 0.070, +0.100) — sole on y = 0 |
| `thighF` / `shinF` / `footF` | … | same, with z = −0.100 |

In Blender frame (x, y, z): negate the game z to get Blender y. For example, `handN` = (0, −0.19, 1.02).

**Fitting the MPFB body to the skeleton:**
- Pick MPFB macros (height, proportions, muscle, weight, gender) close to the target build.
- Use MPFB's `game_engine` rig.
- Fit the mesh to this skeleton by posing or stretching the MPFB bones so their heads and tails land on
  the joints above, then apply the pose as the new rest pose with the mesh.
- Transfer and merge weights into the 17 groups above. Mapping:

  | MPFB `game_engine` bones | our group |
  |---|---|
  | pelvis | hips |
  | spine_01 | spine |
  | spine_02, spine_03, clavicle_* | chest (clavicles may share some weight with upper*) |
  | neck_01 | neck |
  | head | head |
  | upperarm_r | upperN |
  | lowerarm_r | foreN |
  | hand_r + all right finger bones | handN |
  | thigh_r | thighN |
  | calf_r | shinN |
  | foot_r, ball_r | footN |
  | left side | the `*F` groups |

  At most 4 influences per vertex, normalised, with no unweighted vertices.
- Twist bones, if any, merge into their parent limb.

## 4. Hands
> **Amended after M1 (lead decision).** A realistic hand cannot centre the grip 0.045 below the wrist.
> - **Grip centre:** each GLB ships its measured grip centre as extras on the armature node: `gripCentreN`, `gripCentreF` (game axes, offset from the hand joint at rest; about [0, −0.104, −0.010]) and `gripRadius`. The wrist pivot stays anatomical.
> - **IK:** the runtime's IK end effector, weapon placement and `swordHandWorld()`/`offHandWorld()` use these values instead of FIST for GLB rigs.
> - **Superseded:** the "0.045 below the wrist" figure below applies only to the procedural fallback body.

The game holds the hilt with the hand bone oriented so its **local +z runs along the blade**, and with
local −y pointing from the wrist down the hand.
- **Fist centre (where the hilt passes):** 0.045 below the wrist along the arm (rest y = 0.975).
- **Hole diameter:** about 0.045 (grip radius 0.019–0.024).
- **Rest fists:**
  - **Right (`handN`):** palm facing forward (+x), the fist hole running along game z, the thumb and
    index on the **+z (outer)** side, so the blade exits outward.
  - **Left (`handF`):** palm facing backward (−x), hole along game z, the thumb and index on the
    **+z (inner)** side. In a two-handed grip, both thumbs point toward the blade.
- **Morph target `palmOpen`** (left hand and wrist only): an open, slightly spread hand used for Force
  gestures, in the hand's local frame: palm facing local +x, fingers extended along local −y, thumb
  relaxed. The game switches it 0/1.
- The integration engineer verifies the grip with the real hilts in `dev/model-lab.html` and reports
  any axis flip back to the artist. Do not change the convention unilaterally.

## 5. Cloth, capes and hair (extra driven bones)
Anything that must swing beyond what the limbs give it gets its own bone in the GLB skin, parented as
listed. The runtime creates and drives bones by these names; it re-implements the current `body.ts`
driven-skirt and cape logic.
- **Skirt, robe and coat panels:** `skirt_<label>_0` (parent `hips`, hinged at the waist), with an optional
  lower segment `skirt_<label>_1` (parent `skirt_<label>_0`, hinged near the knee).
  - Use as many panels around the waist as the costume needs (typically 6–8 for a long robe).
  - The runtime derives each panel's azimuth from its rest head position around the hips, and feeds
    it to the existing `driveSkirt` anchor logic (gravity, parting round the legs, flare, pooling on
    the floor).
  - Labels are free text (`front`, `frontN`, `near`, `back`, ...).
- **Cape:** `cape_0` … `cape_3` (a chain, parent `chest`, hanging from the shoulders).
- **Hair and tails:** `hair_0` … `hair_2` (ponytail chain, parent `head`) and `tail_0` / `tail_1`
  (headband tails, parent `head`).
- **Shoulder pads:** `pad_N`, `pad_F` (parent `chest`). The runtime makes them follow the upper arm part
  of the way.
- **Weights:** cloth vertices blend from the body bones (near the waist or shoulders) into the panel and
  chain bones, smoothly by height. No vertex may be rigid to a single panel bone at the hem if that tears.
- **Penetration check:** cloth must not penetrate the legs in the extreme poses in §8.

## 6. Materials and textures (glTF metallic-roughness)
- Principled BSDF only, baked to textures for export (per `blender-image-to-3d` Phase 5,
  `bake_maps.py`):
  - baseColor (sRGB);
  - normal (OpenGL, +Y);
  - ORM (packed AO / roughness / metallic) or separate maps.
- Hair cards use alpha (MASK or BLEND; say which).
- **Texture size:** at most 2048² per map. WebP or JPEG in the GLB, PNG only where alpha needs it.
- **Material names** (the runtime keys off them):

  | name | use |
  |---|---|
  | `MAT-skin` | body skin; the runtime adds rim and flash |
  | `MAT-eyes` | eyes |
  | `MAT-hair` | alpha hair cards |
  | `MAT-<char>_primary` | main costume cloth (tinted for mirror-match palettes) |
  | `MAT-<char>_secondary` | second costume cloth (tinted) |
  | `MAT-<char>_trim` | trim (tinted) |
  | `MAT-<char>_leather` | leather (not tinted) |
  | `MAT-<char>_metal` | armour and buckles (not tinted) |
  | `MAT-visor` | the runtime replaces it with an emissive glow |

  Author the default palette from `src/render/characters.ts` `LOOKS`. Mirror-match alternate palettes
  are runtime tints of the `_primary`, `_secondary` and `_trim` materials, so keep those textures'
  colour mostly in the tintable channels (avoid baking the main hue into detail that must stay
  neutral).
- **Look:** realistic, with film-costume references:
  - Kael: Obi-Wan, ROTS.
  - Vexa: dark armoured Sith marauder (Vader / Kylo / Starkiller).
  - Asha: agile duelist (Ahsoka-inspired, human).
  - Thane: Jedi Temple Guard.

  Fabric gets weave and sheen detail in the normal and roughness maps; leather gets grain and wear;
  metal gets edge wear that follows construction. No baked directional lighting.

## 7. Budgets per character (GLB)
- **Triangles:** ≤ 40k total (body + costume + hair + eyes); a phone LOD is optional.
- **Materials:** ≤ 8. Textures ≤ 2048².
- **GLB size:** ≤ 8 MB.
- **Skinning:** ≤ 4 influences per vertex. Skeleton = the 17 core joints + the §5 extras, nothing else.
- **Output files:** `public/models/<id>.glb` (`kael`, `vexa`, `asha`, `thane`), plus
  `art/characters/<id>/asset-manifest.json` (from `export_delivery.py`) and a `BUILD_NOTES.md`.

## 8. Gates (evidence, every phase — `blender-image-to-3d` protocol)
**Review renders in `art/characters/<id>/review/`:**
- Front, side and three-quarter views; a face close-up; both hands; and a gameplay-size strip at about
  200 px tall.
- An extreme-pose sheet with the armature posed:
  - crouch;
  - lunge (front knee forward, rear leg extended);
  - arms overhead with a two-handed high guard;
  - a high kick (thigh at 90°);
  - lying on the back;
  - a 90° torso twist.
- In every pose: no collapsing joints, no cloth through legs, no skin poking through costume.

**Runtime renders:**
- `validate.py` and `roundtrip.py` must pass.
- Final acceptance is in-game: `scripts/state-shots.mjs` captures at 1280×720, plus a motion
  recording.

## 9. Milestones
1. **M1 — contract test (Kael body only):** fitted MPFB body, skin, eyes, brows, lashes and hair,
   skinned to the 17 joints with fists and `palmOpen`, exported to `public/models/kael.glb`. This
   unblocks integration.
2. **M2 — Kael full costume:** robes, tunic, tabards, belt and pouches, boots, beard, then the gates.
3. **M3 — Vexa, Asha, Thane** (can run in parallel, headless).
4. **M4 — in-game acceptance:** all four fighters, mirror palettes, perf budgets, motion review.
