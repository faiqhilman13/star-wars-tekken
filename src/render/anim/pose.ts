/**
 * Full-body pose in the fighter's upright frame: x = toward the opponent, y = up from the feet,
 * z = toward the camera. Angles in degrees. Hands and feet are IK targets; the rig solves the limbs.
 *
 * Positions (grip, off hand, feet) are authored in the *pre-roll* frame: whole-body roll (`spin`,
 * `tilt`) and turns (`spinY`) rotate everything about the hip centre, so a flip or a fall is authored
 * as an upright pose plus a roll.
 */
export interface Pose {
  /** Body offset from the sim position (forward / toward camera). */
  rootX: number;
  rootZ: number;
  /** Hip centre height above the feet. */
  hipY: number;
  /** Whole-body roll about z through the hips (+ = falls backward / back flip, - = forward flip). */
  spin: number;
  /** Whole-body yaw (turnarounds, corkscrews, spins). */
  spinY: number;
  /** Whole-body roll about x (cartwheel / side tilt). */
  tilt: number;
  hipLean: number;
  hipYaw: number;
  hipRoll: number;
  spine: number;
  spineYaw: number;
  chest: number;
  /** Chest yaw (+ = sword shoulder forward). */
  twist: number;
  /** Chest side bend. */
  chestRoll: number;
  /** Head pitch in the upright frame (+ = look up). */
  head: number;
  headYaw: number;
  headRoll: number;
  /** Main weapon grip (staff: staff centre). */
  gx: number;
  gy: number;
  gz: number;
  /** Blade direction: pitch 0 forward / 90 up / 180 back / negative down; yaw 0 forward / 90 toward camera. */
  pitch: number;
  yaw: number;
  /** Weapon spin about its own axis. */
  roll: number;
  /** 0 = off hand on the weapon, 1 = off hand free at (ox, oy, oz). Dual wielders ignore this. */
  off: number;
  ox: number;
  oy: number;
  oz: number;
  /** 0 = fist, 1 = open palm (Force gestures). Applies to the free off hand. */
  palm: number;
  /** Second saber (dual wield): grip and blade direction. */
  g2x: number;
  g2y: number;
  g2z: number;
  pitch2: number;
  yaw2: number;
  /** Front (near-side) foot: forward, lift, depth offset, toe pitch (+ = pointed), knee splay (+ = outward). */
  fx: number;
  fy: number;
  fz: number;
  fPitch: number;
  fKnee: number;
  /** Back (far-side) foot. */
  bx: number;
  by: number;
  bz: number;
  bPitch: number;
  bKnee: number;
  /** Elbow direction offsets (deg) for the near (sword) and far arm. */
  nElbow: number;
  fElbow: number;
  /** Blade extension 0..1 (main, second). */
  blade: number;
  blade2: number;
}

export const POSE_KEYS = [
  'rootX', 'rootZ', 'hipY', 'spin', 'spinY', 'tilt',
  'hipLean', 'hipYaw', 'hipRoll', 'spine', 'spineYaw', 'chest', 'twist', 'chestRoll',
  'head', 'headYaw', 'headRoll',
  'gx', 'gy', 'gz', 'pitch', 'yaw', 'roll',
  'off', 'ox', 'oy', 'oz', 'palm',
  'g2x', 'g2y', 'g2z', 'pitch2', 'yaw2',
  'fx', 'fy', 'fz', 'fPitch', 'fKnee',
  'bx', 'by', 'bz', 'bPitch', 'bKnee',
  'nElbow', 'fElbow', 'blade', 'blade2',
] as const satisfies readonly (keyof Pose)[];

/** Channel groups for overlapping action (torso and head trail the hips). */
export const TORSO_KEYS = ['spine', 'spineYaw', 'chest', 'twist', 'chestRoll'] as const satisfies readonly (keyof Pose)[];
export const HEAD_KEYS = ['head', 'headYaw', 'headRoll'] as const satisfies readonly (keyof Pose)[];

export const NEUTRAL: Pose = {
  rootX: 0,
  rootZ: 0,
  hipY: 0.88,
  spin: 0,
  spinY: 0,
  tilt: 0,
  hipLean: -4,
  hipYaw: 0,
  hipRoll: 0,
  spine: -2,
  spineYaw: 0,
  chest: 2,
  twist: 14,
  chestRoll: 0,
  head: 2,
  headYaw: 0,
  headRoll: 0,
  gx: 0.36,
  gy: 1.06,
  gz: 0.1,
  pitch: 60,
  yaw: 10,
  roll: 0,
  off: 0,
  ox: -0.1,
  oy: 1.0,
  oz: -0.2,
  palm: 0,
  g2x: 0.2,
  g2y: 1.0,
  g2z: -0.12,
  pitch2: 60,
  yaw2: -10,
  fx: 0.27,
  fy: 0,
  fz: 0,
  fPitch: 0,
  fKnee: 0,
  bx: -0.35,
  by: 0,
  bz: 0,
  bPitch: 0,
  bKnee: 0,
  nElbow: 0,
  fElbow: 0,
  blade: 1,
  blade2: 1,
};

export type PosePatch = Partial<Pose>;

export function makePose(base: Pose = NEUTRAL, patch: PosePatch = {}): Pose {
  return { ...base, ...patch };
}

export function copyPose(out: Pose, a: Pose): Pose {
  for (const k of POSE_KEYS) out[k] = a[k];
  return out;
}

export function lerpPose(out: Pose, a: Pose, b: Pose, t: number): Pose {
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export function applyPatch(out: Pose, patch: PosePatch): Pose {
  for (const k of Object.keys(patch) as (keyof Pose)[]) {
    const v = patch[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Add a patch on top of a pose (offsets, not absolutes). */
export function addPatch(out: Pose, patch: PosePatch, scale = 1): Pose {
  for (const k of Object.keys(patch) as (keyof Pose)[]) {
    const v = patch[k];
    if (v !== undefined) out[k] += v * scale;
  }
  return out;
}
