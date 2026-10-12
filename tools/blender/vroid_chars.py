"""Per-character settings for the anime (VRoid) builds (art/ANIME_DIRECTION.md). Paths are repo-relative.

Proportions: the VRoid base is first scaled so its head (head joint to crown) keeps `head_scale` x its VRoid size,
then every limb segment is stretched to the contract joints (sd_contract.JOINTS) and widened by the *_width /
*_depth / *_thick factors (heroic ~7.5 heads on the 1.95 m skeleton).
Colours are sRGB hex (lit colour / hand-picked shadow colour) for the toon materials.
"""

KAEL = {
    "id": "kael",
    "base": "art/vendor/vroid/hairsample_male/HairSample_Male.vrm",
    "sex": "male",
    # proportions (A2: athletic - broader chest and shoulders, thicker forearms, V taper kept at the waist)
    "head_scale": 1.05,
    "neck_thick": 1.52,
    "chest_width": 1.52, "chest_depth": 1.34,
    "waist_width": 1.20, "waist_depth": 1.14,
    "hip_width": 1.12, "hip_depth": 1.10,
    "arm_thick": 1.32, "upper_thick": 1.55, "fore_thick": 1.52, "shoulder_thick": 1.30,
    "leg_thick": 1.10,
    "hand_scale": 1.12, "foot_scale": 1.08,
    "ankle_mesh_z": 0.092,                 # anatomical ankle height after the fit (contract joint stays 0.07)
    # look (sRGB hex)
    "skin_lit": 0xE9B48F, "skin_shade": 0xB9705A,
    "hair_lit": 0x8A4A2A, "hair_shade": 0x4A2216, "hair_spec": 0xE0A070,
    "hair_shade_mul": (0.45, 0.30, 0.25),  # linear: warm dark brown shade on the hair (GG shades hair warm)
    "hair_rim_scale": 0.0,                 # no material rim on the hair (its toon normals make the band wide)
    "eye_iris": 0x6F8FAD,                  # grey-blue
    "brow_hex": 0x2E170F,
    "rim_hex": 0x5FB4FF,                   # LOOKS.kael.rim
    "outline_hex": 0x2A160F,
    # A1 hair restyle (VRoid hair; unused when hair_style is set)
    "hair_sweep_deg": 55.0, "hair_loose": 1,
    # A2: early-30s face (vroid_face.py), authored VRoid hair softly restyled (vroid_hair.py), painted beard, blush
    "face_style": {"eye_height": 0.78, "iris_height": 0.86, "highlight": 0.6,
                   "brow_drop": 0.003, "brow_tilt_deg": 7.0,
                   "chin_drop": 0.008, "chin_fwd": 0.002, "chin_widen": 0.10, "jaw_widen": 0.005, "cheekbone": 0.0025,
                   "lash_cut": 0.35, "lash_hex": 0x4A2A1E, "brow_dilate": 3},
    "beard": {"tone": 0.72, "under_tone": 0.38},
    "hair_style": {"mode": "soft", "bang_lift": 0.024, "bang_top": 0.07, "bang_fwd": 0.004, "back_trim": 0.0},
    "blush": {"hex": 0xD9786A, "cheek": 0.35, "ear": 0.15, "knuckle": 0.45, "knee": 0.4, "lip": 0.3},
    # the base's own VRoid outfit kept for the costume script (kael_costume.py): hoodie, slacks, shoes
    "keep_clothes": ["Tops", "Bottoms", "Shoes"],
}

# ASHA / VEXA: owned by the second character artist (build scripts in art/characters/<id>/build/). The costume,
# ponytail / headband / coat / mask and the final materials are added on top of the finished master there.
ASHA = {
    "id": "asha",
    "base": "art/vendor/vroid/hairsample_female/HairSample_Female.vrm",
    "sex": "female",
    # proportions: athletic adult woman, ~7.5 heads on the 1.95 m skeleton (runtime look.scale 0.95)
    "head_scale": 1.10,
    "neck_thick": 1.16,
    "chest_width": 1.24, "chest_depth": 1.08,
    "waist_width": 1.07, "waist_depth": 1.02,
    "hip_width": 1.14, "hip_depth": 1.08,
    "arm_thick": 1.30, "leg_thick": 1.18,
    "hand_scale": 1.20, "foot_scale": 1.06,
    "ankle_mesh_z": 0.090,
    # look (LOOKS.asha: skin 0x9a6248, hair 0x1a0d0a, rim 0x6dff9a)
    "skin_lit": 0xB27552, "skin_shade": 0x7C4232,
    "hair_lit": 0x3B2622, "hair_shade": 0x160B0B, "hair_spec": 0x9A6A58,
    "eye_iris": 0xFFA21C,                  # bright amber
    "brow_hex": 0x1E100C,
    "rim_hex": 0x6DFF9A,                   # LOOKS.asha.rim
    "outline_hex": 0x2A120C,
    "hair_sweep_deg": 24.0, "hair_loose": 1,
    "hair_rim_scale": 0.0,                 # a2_costume.py sets the final hair toon extras
    # adult, sharper eyes (vroid_face.py; on top of a2 prep's lid blend)
    "face_style": {"eye_height": 0.88, "iris_height": 0.94, "highlight": 0.75,
                   "brow_drop": 0.002, "brow_tilt_deg": 5.0,
                   "chin_drop": 0.005, "chin_fwd": 0.001, "cheekbone": 0.0015,
                   "lash_cut": 0.25, "brow_dilate": 2},
    "blush": {"hex": 0xB85A48, "cheek": 0.22, "ear": 0.12, "knuckle": 0.35, "knee": 0.0, "lip": 0.25},
}

VEXA = {
    "id": "vexa",
    "base": "art/vendor/vroid/avatarsample_f/AvatarSample_F.vrm",
    "sex": "female",
    # proportions: tall, broad-shouldered (runtime look.scale 1.05, bulk 1.14)
    "head_scale": 1.02,
    "neck_thick": 1.22,
    "chest_width": 1.30, "chest_depth": 1.14,
    "waist_width": 1.12, "waist_depth": 1.06,
    "hip_width": 1.12, "hip_depth": 1.06,
    "arm_thick": 1.24, "leg_thick": 1.10,
    "hand_scale": 1.22, "foot_scale": 1.08,
    "ankle_mesh_z": 0.090,
    # look (LOOKS.vexa: skin 0xb07c62, hair 0x0c0c10, rim 0xff4a4a)
    "skin_lit": 0xC08A6C, "skin_shade": 0x84483A,
    "hair_lit": 0x1E1B24, "hair_shade": 0x060508, "hair_spec": 0x4A3048,
    "eye_iris": 0xD02020,
    "brow_hex": 0x0C0C10,
    "rim_hex": 0xFF4A4A,                   # LOOKS.vexa.rim
    "outline_hex": 0x16080A,
    "hair_sweep_deg": 0.0, "hair_loose": 0,
}

# THANE - the Temple Warden: masked (no face / hair shipped), robed; the base's VRoid outfit is kept for the costume
# script (thane_costume.py), which removes the face, hair and the covered skin
THANE = {
    "id": "thane",
    "base": "art/vendor/vroid/hairsample_male/HairSample_Male.vrm",
    "sex": "male",
    # proportions: towering and heavy (runtime look.scale 1.06, bulk 1.04)
    "head_scale": 1.0,
    "neck_thick": 1.55,
    "chest_width": 1.54, "chest_depth": 1.36,
    "waist_width": 1.30, "waist_depth": 1.22,
    "hip_width": 1.18, "hip_depth": 1.14,
    "arm_thick": 1.40, "upper_thick": 1.55, "fore_thick": 1.50, "shoulder_thick": 1.30,
    "leg_thick": 1.14,
    "hand_scale": 1.16, "foot_scale": 1.10,
    "ankle_mesh_z": 0.092,
    # look (sRGB hex; LOOKS.thane): skin / hair unused under the mask and hood
    "skin_lit": 0xA8765C, "skin_shade": 0x6E4535,
    "hair_lit": 0x3A2C20, "hair_shade": 0x1A120C, "hair_spec": 0x6A5A48,
    "eye_iris": 0x6A6A6A,
    "brow_hex": 0x2A2018,
    "rim_hex": 0xFFD25A,                   # LOOKS.thane.rim
    "outline_hex": 0x241C14,
    "hair_sweep_deg": 0.0, "hair_loose": 0,
    "keep_clothes": ["Tops", "Bottoms", "Shoes"],
}

CHARS = {"kael": KAEL, "asha": ASHA, "vexa": VEXA, "thane": THANE}


def get(char_id):
    return CHARS[char_id]
