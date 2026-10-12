# Saber Duel — anime art direction (v5)

The user rejected the realistic MakeHuman look ("like original RuneScape") and chose an
**anime cel-shaded** direction. The target is **Guilty Gear Strive / Xrd × Star Wars: Visions**: a
fighting game famous for character design and animation, combined with Star Wars anime.

## Pillars
1. **Silhouette first.** Each fighter is recognisable as a black shape at 200 px. That means one
   oversized signature element per character: Kael's cloak, Vexa's tattered coat and pauldron,
   Asha's ponytail and headband tails, Thane's crest and long robes.
2. **Cel shading, not realism.**
   - Hard two-tone light and shadow with a hand-chosen shadow colour per material (warm red-brown
     for skin, never grey).
   - Crisp rim light in the character's colour.
   - Hard specular "angel ring" on hair.
   - Painted, not photographic, textures: flat colour plus a few painted shading gradients, like the
     VRoid textures.
3. **Ink outlines.** Inverted-hull outlines:
   - thicker on the outer silhouette and thinner inside;
   - none across the face interior except the jaw;
   - tinted from the surface colour, never pure black, as in Arc System Works' own GG Toon Line talk.
4. **Heroic proportions.** Adult, about 7.5 heads tall, fitted to the game's 1.95 m skeleton, not chibi
   or teen. VRoid bases get lengthened legs and arms and a slightly smaller head relative to the body.
5. **Expressive faces.** Blink, angry focus when attacking, a shout on heavy hits and supers, pain when
   hit, and a grin or smile in victory. The VRoid blendshapes provide these.
6. **Limited animation** (GG's signature):
   - poses are held on 2s or 3s (20–30 fps pose updates) while motion through space stays smooth;
   - snappy key poses with smear frames on swings;
   - impact holds.

## Cast design sheets (palette = `src/render/characters.ts` LOOKS)

### KAEL — "The Jedi Guardian" (blue blade)
- **Who:** Jedi knight in his early 30s, calm and dry-humoured; Obi-Wan meets a Star Wars: Visions ronin.
- **Head:** swept auburn hair with a couple of loose strands over the forehead, and a short trimmed
  beard and moustache (stylised anime beard shapes, not realistic hair cards). Grey-blue eyes with
  strong highlights.
- **Costume:**
  - cream undertunic visible at the collar;
  - brown crossover tunic with darker tabards over the shoulders, hanging front and back;
  - wide obi sash plus a leather belt with pouches and a hilt clip;
  - wide sleeves over forearm wraps;
  - tall boots;
  - a **brown hooded half-cloak** (hood down) on `cape_0..3`, which flares in motion.
- **Silhouette:** the cloak and the wide sleeves.

### VEXA — "The Crimson Marauder" (red curved blade)
- **Who:** a Sith warrior woman, tall and broad-shouldered, menacing; Kylo Ren meets the Ronin from
  Star Wars: Visions "The Duel" and the Ninth Sister.
- **Head:** hood over a sculpted black **half-mask with a glowing red visor slit** (`MAT-visor`). A
  lock of dark hair escapes the hood. The face is hidden, so expression comes from the visor glow and
  body language.
- **Costume:**
  - segmented black armour cuirass over a dark bodysuit;
  - a big **asymmetric pauldron on the sword shoulder** (`pad_N`) and a smaller one on the other
    (`pad_F`);
  - armoured gauntlets;
  - a long black coat split front and back with **crimson lining and trim** (`skirt_*` panels);
  - a **tattered cape** (`cape_0..3`) with torn hem shapes;
  - armoured boots.
- **Silhouette:** the pauldron, hood and tattered coat and cape.

### ASHA — "The Twin Fang" (two green blades)
- **Who:** an acrobatic duelist in her early 20s, cocky and fast; Ahsoka-inspired but human.
- **Head:** darker skin and bright amber eyes. A **high ponytail** with a white streak (`hair_0..2`),
  short side locks, and a headband with long trailing **tails** (`tail_0..1`).
- **Costume:**
  - teal cropped top with an orange leather cross-harness;
  - bare toned arms with wrist wraps and fingerless gloves;
  - short front / long back asymmetric skirt panels;
  - leggings, and wrapped soft boots;
  - a small shoulder guard on the far shoulder.
- **Silhouette:** the ponytail, the headband tails and the split skirt.

### THANE — "The Temple Warden" (yellow saberstaff)
- **Who:** a towering Jedi Temple Guard, silent and ceremonial.
- **Head:** a **stylised ivory and gold mask** with sharp anime planes and a dark visor slit, a tall
  forked crest, and a deep hood. No face shown.
- **Costume:**
  - long layered white and cream robes split front and back (6–8 `skirt_*` panels with knee segments);
  - a gold-trimmed **mantle**;
  - wide sash with gold buckle;
  - dark gloves, under wide pleated sleeves;
  - a long **cape** (`cape_0..3`).
- **Silhouette:** the crest, mantle and floor-length robes.

## Sources (all legitimately licensed)
- **Bases:** VRoid Studio CC0 sample models (OpenGameArt "VRoid Studio CC0 models"): `Base_Male`,
  `Base_Female`, `HairSample_Male`, `HairSample_Female`, `AvatarSample_D–G` and `Sendagaya Shino`.
  - Location: `art/vendor/vroid/<name>/<name>.vrm`.
  - Licence: CC0. They were released by VRoid from the alpha versions of VRoid Studio.
- **Blender:** VRM add-on 4.10.2 (installed) for import and MToon. MPFB is no longer used.
- **Technique references** (techniques only, never assets):
  - Arc System Works, "Guilty Gear Toon Line Control Techniques";
  - Junya Motomura, GDC "GuiltyGearXrd's Art Style: The X Factor Between 2D and 3D".
- **Never** use assets ripped from commercial games.
