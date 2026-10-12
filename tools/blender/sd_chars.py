"""Per-character build parameters (bodies, faces, hair, palettes). Palettes mirror src/render/characters.ts LOOKS.

Each entry is everything the shared pipeline (sd_body.py, sd_costume_*.py, sd_bake.py, sd_export.py) needs,
so a second artist can add or re-run a character by editing only this table.

MPFB macro values: gender 0 female .. 1 male; age 0.5 = 25 y, 1.0 = 90 y (45 y ~ 0.65);
height, muscle, weight, proportions 0..1. Targets are MPFB target names with weights (measured, see
art/characters/kael/BUILD_NOTES.md "Body fit"): they move the mesh's anatomical joints onto the contract
skeleton so the fit pose only has to rotate limbs, never stretch them.
"""

# Shared leg/arm length targets that move MPFB's joints onto the contract skeleton (measured on the kael
# build; linear: lowerlegs 1.0 = -5.9 cm shin, upperlegs 1.0 = -7.5 cm thigh, torso-scale-vert 1.0 = +10.3 cm,
# lowerarm-length 1.0 = -4.5 cm, shoulder-dist 1.0 = -1.3 cm half width).
KAEL = {
    "id": "kael",
    "asset": "CH_Kael",
    "macro": {"gender": 1.0, "age": 0.68, "muscle": 0.86, "weight": 0.58, "proportions": 0.6, "height": 0.66,
              "race": {"asian": 0.05, "caucasian": 0.9, "african": 0.05}},
    "targets": {"lowerlegs-height-decr": 0.80, "upperlegs-height-decr": 0.13, "torso-scale-vert-incr": 0.63, "measure-neck-height-decr": 0.25,
                "measure-lowerarm-length-decr": 0.27, "measure-shoulder-dist-decr": 1.0,
                # athletic V torso, mature lean face (mid-40s, Obi-Wan-like oval with defined cheekbones)
                "torso-vshape-incr": 0.45, "torso-muscle-pectoral-incr": 0.3, "head-age-incr": 0.55,
                "head-oval": 0.45, "l-cheek-volume-decr": 0.45, "r-cheek-volume-decr": 0.45,
                "l-cheek-bones-incr": 0.35, "r-cheek-bones-incr": 0.35, "mouth-laugh-lines-out": 0.35,
                "chin-prominent-incr": 0.2, "nose-scale-vert-incr": 0.15, "forehead-nubian-incr": 0.25},
    "skin": "middleage_caucasian_male",
    # Albedo target for the look-dev skin: LOOKS.kael.skin = 0xc28a68 is a flat game colour; the realistic albedo
    # is pulled 90% of the way from the (desaturated) MPFB texture mean toward it: warm light-tan skin.
    "skin_hex": 0xC28A68,
    "skin_mix": 1.0,
    "eyes": "grey",
    "eyes_mix": [["grey", 0.55], ["lightblue", 0.45]],
    "sclera_tint": [0.93, 0.9, 0.86],
    "brows": "eyebrow009",
    "lashes": "eyelashes01",
    "hair": "short02",
    "hair_hex": 0x3A2414,          # LOOKS.kael.hair; tips lift toward auburn
    "hair_tip_hex": 0x4A2C18,
    # layered hair cards (sd_hair.py): head frame, hairline / beard line by azimuth round the skull (deg, z)
    "hair_seed": 1977,
    "head_centre": (0.055, 0.0, 1.86),
    "part_y": 0.032,                                     # side part on the far (left) side
    "hairline": [(0, 1.893), (30, 1.889), (50, 1.882), (64, 1.862), (71, 1.800), (77, 1.796), (83, 1.862),
                 (100, 1.862), (115, 1.830), (135, 1.785), (160, 1.745), (180, 1.728)],
    "hair_layers": [
        {"kind": "base", "n": 380, "length": (0.055, 0.085), "width": (0.013, 0.017), "h": (0.0015, 0.003), "climb": 0.0009,
         "segs": 4, "strips": [0, 1, 2]},
        {"kind": "mid", "n": 240, "length": (0.065, 0.095), "width": (0.012, 0.015), "h": (0.003, 0.005), "climb": 0.0014,
         "segs": 4, "strips": [2, 3, 4]},
        {"kind": "top", "n": 110, "length": (0.075, 0.105), "width": (0.011, 0.014), "h": (0.004, 0.007), "climb": 0.002,
         "segs": 4, "strips": [3, 4, 5]},
        {"kind": "hairline", "n": 170, "length": (0.020, 0.036), "width": (0.006, 0.009), "h": (0.0006, 0.0012),
         "climb": 0.0005, "segs": 3, "strips": [6, 7]},
    ],
    "beard_skin_hex": 0x2E1C10,        # stubble shadow on the skin under the beard cards
    "beard_skin_mix": 0.9,
    "beard_tip_hex": 0x2E1C10,          # beard strand roots (darker than the hair)
    "beard_hex": 0x4A2E1C,              # beard strand tips
    "beard_line": [(0, 1.768), (15, 1.770), (30, 1.758), (45, 1.764), (60, 1.776), (72, 1.792), (78, 1.80)],
    "beard_neck_z": 1.672,
    "beard_min_dx": -0.005,
    "lips": (0.027, 1.727, 1.7535, 0.148),               # |y| <, z between, x > : lips stay clear
    "moustache": (0.036, 1.7535, 1.769),                 # |y| <, z between: upper-lip moustache band
    "beard_cards": 500,
    "beard_strands": 320,
    "moustache_cards": 44,
    "look": {"primary": 0x86643F, "primaryDark": 0x563F29, "secondary": 0xCABD9F, "trousers": 0x4B3B2B,
             "belt": 0x2E2016, "boots": 0x22170F, "metal": 0xB7BEC8, "trim": 0x8C6A44},
    "scale": 1.0,
}

CHARS = {"kael": KAEL}


def get(char_id):
    return CHARS[char_id]
