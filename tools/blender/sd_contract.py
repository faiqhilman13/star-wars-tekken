"""Saber Duel character contract (art/CHARACTER_PIPELINE.md), as constants for the Blender build scripts.

Frames
- game:    x = toward the opponent, y = up, z = toward the camera (near side). Metres.
- blender: the contract authoring frame. The character faces +X, up is +Z, its right (near, "N") side is -Y.
           blender (x, y, z) = game (x, -z, y). The glTF exporter (+Y up) maps it back to game exactly.
- mpfb:    MakeHuman/MPFB native frame. The character faces -Y, up is +Z, its right side is -X.
           blender = Rz(+90 deg) * mpfb, i.e. blender (x, y, z) = mpfb (-y, x, z).
"""
import math

# --- skeleton (section 3) -------------------------------------------------------------------------
# name: (parent, game position)
JOINTS = {
    "hips": (None, (0.0, 1.020, 0.0)),
    "spine": ("hips", (0.0, 1.120, 0.0)),
    "chest": ("spine", (0.0, 1.380, 0.0)),
    "neck": ("chest", (0.0, 1.630, 0.0)),
    "head": ("neck", (0.0, 1.730, 0.0)),
    "upperN": ("chest", (0.0, 1.580, 0.190)),
    "foreN": ("upperN", (0.0, 1.290, 0.190)),
    "handN": ("foreN", (0.0, 1.020, 0.190)),
    "upperF": ("chest", (0.0, 1.580, -0.190)),
    "foreF": ("upperF", (0.0, 1.290, -0.190)),
    "handF": ("foreF", (0.0, 1.020, -0.190)),
    "thighN": ("hips", (0.0, 0.980, 0.100)),
    "shinN": ("thighN", (0.0, 0.520, 0.100)),
    "footN": ("shinN", (0.0, 0.070, 0.100)),
    "thighF": ("hips", (0.0, 0.980, -0.100)),
    "shinF": ("thighF", (0.0, 0.520, -0.100)),
    "footF": ("shinF", (0.0, 0.070, -0.100)),
}
CORE = list(JOINTS.keys())
HEAD_TOP = (1.94, 1.96)          # top of the skull, game y
FIST_DROP = 0.045                # section 4: fist centre below the wrist along the arm
GRIP_RADIUS = (0.019, 0.024)

# MPFB game_engine bones -> contract groups (section 3 mapping). Fingers and twist merge into the limb.
_FINGERS = ["thumb", "index", "middle", "ring", "pinky"]


def mpfb_to_contract(bone):
    """Contract group for an MPFB game_engine bone name, or None."""
    side = None
    if bone.endswith("_r"):
        side, base = "N", bone[:-2]
    elif bone.endswith("_l"):
        side, base = "F", bone[:-2]
    else:
        base = bone
    table = {"Root": "hips", "pelvis": "hips", "spine_01": "spine", "spine_02": "chest", "spine_03": "chest",
             "neck_01": "neck", "head": "head"}
    if side is None:
        return table.get(base)
    if base == "clavicle":
        return "chest"
    if base == "upperarm":
        return "upper" + side
    if base == "lowerarm":
        return "fore" + side
    if base == "hand" or any(base.startswith(f + "_") for f in _FINGERS):
        return "hand" + side
    if base == "thigh":
        return "thigh" + side
    if base == "calf":
        return "shin" + side
    if base in ("foot", "ball"):
        return "foot" + side
    return None


# --- frames --------------------------------------------------------------------------------------
def game_to_blender(p):
    x, y, z = p
    return (x, -z, y)


def blender_to_mpfb(p):
    """Inverse of blender = Rz(+90) * mpfb."""
    x, y, z = p
    return (y, -x, z)


def mpfb_to_blender(p):
    x, y, z = p
    return (-y, x, z)


def joint_blender(name):
    return game_to_blender(JOINTS[name][1])


def joint_mpfb(name):
    return blender_to_mpfb(joint_blender(name))


# --- materials (section 6) -----------------------------------------------------------------------
def material_names(char):
    return {
        "skin": "MAT-skin", "eyes": "MAT-eyes", "hair": "MAT-hair",
        "primary": "MAT-%s_primary" % char, "secondary": "MAT-%s_secondary" % char,
        "trim": "MAT-%s_trim" % char, "leather": "MAT-%s_leather" % char, "metal": "MAT-%s_metal" % char,
        "visor": "MAT-visor",
    }


# --- budgets (section 7) -------------------------------------------------------------------------
BUDGET = {"tris": 40000, "materials": 8, "texture_px": 2048, "glb_mb": 8.0, "influences": 4}


def hex_to_linear(h):
    """0xRRGGBB (sRGB, as in src/render/characters.ts) -> linear RGBA for Blender colour sockets."""
    def lin(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin((h >> 16) & 255), lin((h >> 8) & 255), lin(h & 255), 1.0)


def hex_to_srgb(h):
    return (((h >> 16) & 255) / 255.0, ((h >> 8) & 255) / 255.0, (h & 255) / 255.0)


DEG = math.pi / 180.0
