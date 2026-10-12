import { clip } from './clip';
import type { GaitSpec } from './gait';
import { makePose, NEUTRAL } from './pose';
import { lyingPose, sharedClips, type Physique } from './shared';
import type { AnimSet } from './types';

/**
 * KAEL — compact Soresu guardian (Obi-Wan). Precise, small, fast settle: the blade returns to the
 * centre line before the feet do. See artifacts/animation-reference.md §2.1 / §3.1.
 */
export function kaelAnims(): AnimSet {
  const ph: Physique = { amp: 1, head: 1, dual: false };

  // Soresu high guard: blade over the head aimed at the opponent, off hand pointing.
  const stance = makePose(NEUTRAL, {
    rootX: -0.02,
    hipY: 0.81,
    hipLean: -5,
    hipYaw: -8,
    spine: -2,
    chest: 3,
    twist: -8,
    head: -4,
    gx: -0.02,
    gy: 1.74,
    gz: 0.2,
    pitch: -22,
    yaw: 8,
    off: 1,
    ox: 0.42,
    oy: 1.34,
    oz: -0.06,
    palm: 1,
    fx: 0.3,
    fKnee: 4,
    bx: -0.4,
    bKnee: 22,
    nElbow: 10,
  });
  const guard = makePose(stance, { gx: 0.4, gy: 1.3, gz: 0.14, pitch: 100, yaw: 14, off: 0, palm: 0, twist: 6, hipYaw: 0, hipLean: -2, rootX: -0.05, chest: 4, head: 0 });
  const crouch = makePose(stance, { hipY: 0.56, hipLean: -16, spine: -6, chest: 2, head: 2, gx: 0.36, gy: 0.9, gz: 0.14, pitch: 28, yaw: 12, off: 0, palm: 0, twist: 4, fx: 0.4, bx: -0.5, bKnee: 26, fKnee: 10 });
  // Hanging guard: blade points down in front of the legs.
  const crouchGuard = makePose(crouch, { gx: 0.4, gy: 0.86, pitch: -75, yaw: 15, twist: 8, hipLean: -12 });

  const shared = sharedClips({ stance, guard, crouch, crouchGuard }, ph);
  const lying = lyingPose(stance, ph);

  const walk: GaitSpec = { kind: 'shuffle', base: stance, stride: 1.2, lift: 0.07, bob: 0.012, lean: 0, sway: 2, armPump: 0, bladeBob: 1.5, toe: 10 };
  const walkBack: GaitSpec = { ...walk, stride: 1.0, lift: 0.06, lean: 2 };
  const runBase = makePose(stance, {
    rootX: 0.02,
    hipY: 0.8,
    hipLean: -22,
    hipYaw: 0,
    spine: -6,
    chest: -4,
    twist: 0,
    head: 4,
    gx: -0.15,
    gy: 0.95,
    gz: 0.15,
    pitch: -10,
    yaw: 175,
    off: 1,
    ox: 0.2,
    oy: 1.12,
    oz: -0.12,
    palm: 0,
    fx: 0.06,
    bx: -0.04,
    fKnee: 0,
    bKnee: 0,
    nElbow: 0,
  });
  const run: GaitSpec = { kind: 'run', base: runBase, stride: 2.4, lift: 0.34, bob: 0.05, lean: -6, sway: 14, armPump: 0.22, bladeBob: 6, stance: 0.34, heelKick: 0.3 };

  const L = { lagTorso: 0.6, lagHead: 1.2 };

  const clips = {
    ...shared,

    idle: clip(
      stance,
      [
        { f: 77, e: 'io', p: { chest: stance.chest + 1.5, gy: stance.gy + 0.012, oy: stance.oy + 0.01, head: stance.head - 1 } },
        { f: 192, e: 'io', p: { chest: stance.chest, gy: stance.gy, oy: stance.oy, head: stance.head } },
        { f: 269, e: 'io', p: { chest: stance.chest + 1.5, gy: stance.gy + 0.012 } },
        { f: 290, e: 'io', p: { pitch: -15, yaw: 14 } },
        { f: 320, e: 'io', p: { pitch: -25, yaw: 8, chest: stance.chest } },
        { f: 384, e: 'io', reset: true },
      ],
      { loop: true, lagTorso: 4, lagHead: 8 },
    ),

    backdash: clip(stance, [
      { f: 3, e: 'out', p: { rootX: -0.06, hipY: 0.86, fy: 0.12, by: 0.24, fPitch: 30, bPitch: 25, gx: 0.38, gy: 1.32, pitch: 92, yaw: 12, off: 0, palm: 0, hipLean: 2, chest: 6, head: -2 } },
      { f: 9, e: 'io', p: { fy: 0.07, by: 0.12 } },
      { f: 13, e: 'in', p: { fy: 0, by: 0, hipY: 0.74, fPitch: 0, bPitch: 0 } },
      { f: 18, e: 'out', reset: true },
    ]),

    runStop: clip(runBase, [
      { f: 2, e: 'out', p: { hipLean: 6, spine: 2, chest: 6, head: -2, fx: 0.45, fPitch: -25, bx: -0.35, by: 0.04, hipY: 0.74, rootX: -0.04 } },
      { f: 6, e: 'io', p: { gx: stance.gx, gy: stance.gy, gz: stance.gz, pitch: stance.pitch, yaw: stance.yaw, ox: stance.ox, oy: stance.oy, oz: stance.oz, palm: 1 } },
      { f: 9, e: 'io', reset: true, p: { ...stance } },
    ]),

    jumpUp: clip(stance, [
      { f: 0, p: { hipY: 0.95, fPitch: 45, bPitch: 45, fx: 0.12, bx: -0.12, gx: 0.2, gy: 1.68, pitch: 92, yaw: 10, off: 0, palm: 0, hipLean: 0, head: 6 } },
      { f: 8, e: 'out', p: { fy: 0.25, by: 0.3, fx: 0.18, bx: -0.08 } },
      { f: 20, e: 'io', p: { fy: 0.33, by: 0.37, fKnee: 10, bKnee: 10, chest: -6 } },
      { f: 32, e: 'io', p: { fy: 0.06, by: 0.09, fx: 0.26, bx: -0.3, fKnee: 4, bKnee: 18, gx: 0.3, gy: 1.45, pitch: 40, chest: 2 } },
      { f: 44, e: 'io', p: { fy: 0, by: 0, fPitch: 20, bPitch: 20 } },
    ]),

    jumpFwd: clip(stance, [
      { f: 0, p: { hipY: 0.96, fPitch: 45, bPitch: 45, fx: 0.15, bx: -0.15, gx: 0.15, gy: 1.72, pitch: 95, yaw: 10, off: 0, palm: 0, head: 8, hipLean: 0 } },
      { f: 6, e: 'out', p: { spin: -40, fy: 0.3, by: 0.35, gx: 0.2, gy: 1.22, pitch: 100, chest: -12, head: -10 } },
      { f: 14, e: 'lin', p: { spin: -170, fy: 0.43, by: 0.47, fx: 0.24, bx: 0.1, fKnee: 8, bKnee: 8, chest: -20, head: -22 } },
      { f: 22, e: 'lin', p: { spin: -290 } },
      { f: 28, e: 'out', p: { spin: -350, fy: 0.2, by: 0.22, fx: 0.25, bx: -0.2, pitch: 40, gx: 0.3, gy: 1.4, chest: -2, head: 0 } },
      { f: 34, e: 'io', p: { spin: -360, fy: 0.05, by: 0.08, bx: -0.3 } },
      { f: 44, e: 'io', p: { fy: 0, by: 0, fPitch: 20, bPitch: 20, pitch: 20 } },
    ]),

    jumpBack: clip(stance, [
      { f: 0, p: { hipY: 0.96, fPitch: 40, bPitch: 40, gx: 0.1, gy: 1.82, pitch: 100, yaw: 10, off: 1, ox: -0.08, oy: 1.82, oz: -0.2, palm: 1, head: 14, hipLean: 4 } },
      { f: 8, e: 'out', p: { spin: 60, fy: 0.16, by: 0.18, fx: 0.2, bx: -0.1, chest: 10, head: 20 } },
      { f: 18, e: 'lin', p: { spin: 200, fy: 0.2, by: 0.22 } },
      { f: 28, e: 'out', p: { spin: 340, fy: 0.15, by: 0.15, gx: 0.3, gy: 1.4, pitch: 70, off: 0, palm: 0, chest: 2, head: 0 } },
      { f: 34, e: 'io', p: { spin: 360, fy: 0.05, by: 0.05 } },
      { f: 44, e: 'io', p: { fy: 0, by: 0, fPitch: 20, bPitch: 20 } },
    ]),

    jumpRun: clip(stance, [
      { f: 0, p: { hipY: 0.94, hipLean: -20, fx: 0.3, bx: -0.35, fy: 0.1, by: 0.2, fPitch: 40, bPitch: 40, gx: -0.1, gy: 1.1, pitch: 175, yaw: 20, off: 1, ox: 0.3, oy: 1.3, oz: -0.1, palm: 1 } },
      { f: 6, e: 'out', p: { spin: -60, fy: 0.38, by: 0.42, fx: 0.2, bx: 0.0, chest: -14, head: -10, gx: 0.15, gy: 1.2, pitch: 110, off: 0, palm: 0 } },
      { f: 18, e: 'lin', p: { spin: -300 } },
      { f: 24, e: 'out', p: { spin: -360, fy: 0.12, by: 0.25, fx: 0.42, bx: -0.5, chest: -6, head: 0, gx: 0.35, gy: 1.45, pitch: 15, yaw: 10 } },
      { f: 44, e: 'io', p: { fy: 0.02, by: 0.05, fx: 0.3, bx: -0.38, fPitch: 20, bPitch: 20 } },
    ]),

    // ----------------------------------------------------------- attacks
    // Diagonal cut from the high guard: wrist cock, step in, snap through, then the blade keeps
    // circling down and back up the inside into guard (Obi-Wan's continuous loops).
    light: clip(
      stance,
      [
        { f: 1, e: 'out', p: { gy: 1.78, pitch: 2, twist: -12, hipYaw: -12, fy: 0.05, fPitch: 18, rootX: -0.02, ox: 0.34, oy: 1.32 } },
        { f: 3, e: 'out', p: { gx: 0.08, gy: 1.7, pitch: 42, twist: -16, hipYaw: -14, fx: 0.36, fy: 0.07, ox: 0.3, oy: 1.3 } },
        { f: 4, e: 'lin', p: { gx: 0.42, gy: 1.46, pitch: 2, fx: 0.42, fy: 0.02, fPitch: 6, rootX: 0.01, twist: 6, hipYaw: 4 } },
        { f: 5, e: 'snap', p: { gx: 0.62, gy: 1.28, gz: 0.16, pitch: -22, twist: 24, hipYaw: 14, hipLean: -10, chest: -4, head: -6, ox: 0.05, oy: 1.24, oz: -0.04, palm: 0, rootX: 0.05, fx: 0.44, fy: 0, fPitch: 0, bPitch: 18 } },
        { f: 7, e: 'out', p: { pitch: -44, gx: 0.67, gy: 1.17, twist: 30, bPitch: 26 } },
        { f: 9, e: 'io', p: { gx: 0.56, gy: 1.04, gz: 0.2, pitch: -72, yaw: 24, twist: 24, hipLean: -9, bPitch: 14 } },
        { f: 11, e: 'io', p: { gx: 0.32, gy: 1.12, gz: 0.24, pitch: -10, yaw: 60, twist: 12, hipYaw: 6, chest: 0, head: -4, ox: 0.2, oy: 1.25, palm: 1, bPitch: 4 } },
        { f: 13, e: 'io', p: { gx: 0.12, gy: 1.52, gz: 0.22, pitch: 58, yaw: 30, twist: 2, hipYaw: -2, hipLean: -6, fx: 0.34, fy: 0.04, ox: 0.34, oy: 1.32, rootX: 0.01 } },
        { f: 16, e: 'io', reset: true },
      ],
      L,
    ),

    // Chain 2: backhand horizontal from across the body, sweeping round the camera side.
    light2: clip(
      stance,
      [
        { f: 2, e: 'out', p: { gx: 0.1, gy: 1.52, gz: -0.12, pitch: 34, yaw: 172, twist: 26, hipYaw: 12, chest: 4, head: -4, rootX: -0.02, fy: 0.05, fPitch: 15, ox: 0.18, oy: 1.12, oz: -0.14, palm: 0, nElbow: 30 } },
        { f: 3, e: 'out', p: { gx: 0.14, gy: 1.5, gz: -0.08, pitch: 30, yaw: 178, twist: 30, fx: 0.38, fy: 0.06 } },
        { f: 4, e: 'lin', p: { gx: 0.42, gy: 1.38, gz: 0.26, pitch: 14, yaw: 92, twist: 12, hipYaw: 2, fx: 0.44, fy: 0.01, fPitch: 4 } },
        { f: 5, e: 'snap', p: { gx: 0.64, gy: 1.3, gz: 0.18, pitch: 2, yaw: 6, twist: -8, hipYaw: -10, hipLean: -9, chest: -2, head: -4, rootX: 0.05, fx: 0.46, fy: 0, fPitch: 0, bPitch: 16, ox: -0.12, oy: 1.28, oz: -0.24, palm: 1, nElbow: 6 } },
        { f: 7, e: 'out', p: { yaw: -40, gx: 0.6, gz: 0.08, twist: -16, hipYaw: -14, bPitch: 22 } },
        { f: 10, e: 'io', p: { gx: 0.4, gy: 1.4, gz: 0.12, pitch: 40, yaw: -30, twist: -8, hipYaw: -8, ox: 0.1, oy: 1.3, oz: -0.1, bPitch: 8 } },
        { f: 13, e: 'io', p: { gx: 0.1, gy: 1.62, gz: 0.2, pitch: 30, yaw: 8, twist: -6, hipYaw: -6, fx: 0.33, fy: 0.04, ox: 0.34, oy: 1.32, oz: -0.06, rootX: 0.01, nElbow: 10 } },
        { f: 16, e: 'io', reset: true },
      ],
      L,
    ),

    // Chain 3: rising cut from low, the body lifting onto the toes with it.
    light3: clip(
      stance,
      [
        { f: 2, e: 'out', p: { gx: 0.18, gy: 1.0, gz: 0.24, pitch: -128, yaw: -34, twist: -14, hipYaw: -10, hipY: 0.74, hipLean: -14, chest: -6, head: 2, fy: 0.05, fPitch: 15, ox: 0.28, oy: 1.15, palm: 1 } },
        { f: 3, e: 'out', p: { gx: 0.24, gy: 0.94, pitch: -136, fx: 0.38, fy: 0.06 } },
        { f: 4, e: 'lin', p: { gx: 0.46, gy: 1.1, gz: 0.2, pitch: -40, yaw: 12, twist: 8, hipYaw: 4, hipY: 0.78, fx: 0.45, fy: 0.01 } },
        { f: 5, e: 'snap', p: { gx: 0.62, gy: 1.42, gz: 0.16, pitch: 38, yaw: 6, twist: 26, hipYaw: 14, hipY: 0.86, hipLean: -2, chest: 6, head: 6, rootX: 0.05, fx: 0.46, fy: 0, fPitch: 0, bPitch: 30, by: 0.02, ox: 0.04, oy: 1.2, oz: -0.06, palm: 0 } },
        { f: 7, e: 'out', p: { gx: 0.6, gy: 1.6, pitch: 78, twist: 28, chest: 8, head: 8, bPitch: 34 } },
        { f: 10, e: 'io', p: { gx: 0.38, gy: 1.72, pitch: 112, twist: 12, hipY: 0.83, by: 0, bPitch: 10, ox: 0.3, oy: 1.32, palm: 1 } },
        { f: 13, e: 'io', p: { gx: 0.06, gy: 1.76, gz: 0.2, pitch: 20, yaw: 8, twist: -4, hipYaw: -6, hipY: 0.81, hipLean: -5, chest: 3, head: -4, fx: 0.32, fy: 0.03 } },
        { f: 16, e: 'io', reset: true },
      ],
      L,
    ),

    heavy: clip(
      stance,
      [
        { f: 4, e: 'io', p: { off: 0, palm: 0, gx: -0.02, gy: 1.8, gz: 0.16, pitch: 132, yaw: 26, twist: -14, hipYaw: -14, chest: 8, fy: 0.05, fPitch: 18, rootX: -0.04, head: 0, hipY: 0.84 } },
        { f: 7, e: 'out', p: { gx: -0.05, gy: 1.86, pitch: 146, yaw: 22, twist: -20, chest: 11, hipY: 0.86, fy: 0.08 } },
        { f: 9, e: 'hold', p: { pitch: 150, yaw: 20 } },
        { f: 10, e: 'lin', p: { fx: 0.58, fy: 0, fPitch: 0, gx: 0.4, gy: 1.68, pitch: 80, yaw: 14, twist: 8, hipYaw: 10, rootX: 0.08, hipY: 0.8 } },
        { f: 11, e: 'snap', p: { rootX: 0.16, gx: 0.66, gy: 1.2, gz: 0.16, pitch: -30, yaw: 8, twist: 34, hipYaw: 22, chest: -14, hipLean: -16, head: -10, hipY: 0.75, bPitch: 20 } },
        { f: 14, e: 'out', p: { pitch: -50, gx: 0.66, gy: 1.04 } },
        { f: 20, e: 'out', p: { gx: 0.58, gy: 0.9, pitch: -60, by: 0.04, bPitch: 30, chest: -16, twist: 38 } },
        { f: 23, e: 'io', p: { gx: 0.42, gy: 1.05, gz: 0.3, pitch: 10, yaw: 78, twist: 26, chest: -8 } },
        { f: 26, e: 'io', p: { gx: 0.24, gy: 1.25, pitch: 95, yaw: 14, by: 0, bPitch: 0, bx: -0.34, chest: -2, twist: 8, hipYaw: 0, rootX: 0.08, hipLean: -8 } },
        { f: 30, e: 'io', p: { gx: 0.06, gy: 1.68, pitch: 30, rootX: 0.02 } },
        { f: 33, e: 'io', reset: true },
      ],
      L,
    ),

    crLight: clip(
      crouch,
      [
        { f: 4, e: 'out', p: { gx: 0.2, gy: 0.82, pitch: 10, yaw: 30, twist: -6, off: 1, ox: 0.25, oy: 0.7, oz: -0.05, palm: 0 } },
        { f: 5, e: 'lin', p: { gx: 0.45, gy: 0.7, pitch: 0, yaw: 18, twist: 12 } },
        { f: 6, e: 'snap', p: { gx: 0.62, gy: 0.62, gz: 0.18, pitch: -12, yaw: 10, twist: 28, hipYaw: 12, ox: 0.3, oy: 0.56, oz: -0.02, palm: 1, rootX: 0.04 } },
        { f: 9, e: 'out', p: { gx: 0.66, pitch: -16 } },
        { f: 12, e: 'io', p: { gx: 0.5, gy: 0.72, pitch: 5, twist: 14 } },
        { f: 18, e: 'io', reset: true },
      ],
      L,
    ),

    sweep: clip(
      crouch,
      [
        { f: 6, e: 'io', p: { hipY: 0.5, bx: -0.56, by: 0, bKnee: 30, gx: -0.05, gy: 0.62, gz: 0.18, pitch: -10, yaw: 160, twist: -30, hipYaw: -18, hipLean: -16, off: 1, ox: 0.2, oy: 0.55, oz: -0.1, palm: 0 } },
        { f: 8, e: 'lin', p: { gx: 0.3, gy: 0.45, pitch: -12, yaw: 90, twist: 4, hipYaw: 0 } },
        { f: 10, e: 'snap', p: { gx: 0.66, gy: 0.36, gz: 0.2, pitch: -15, yaw: 0, twist: 38, hipYaw: 18, hipLean: -24, ox: 0.15, oy: 0.05, oz: -0.05, palm: 1, rootX: 0.03 } },
        { f: 14, e: 'out', p: { yaw: -14, gx: 0.66 } },
        { f: 25, e: 'io', p: { yaw: -10 } },
        { f: 30, e: 'io', p: { gx: 0.4, gy: 0.82, gz: 0.28, pitch: 52, yaw: 64, hipY: 0.6, hipLean: -14, twist: 16, ox: 0.25, oy: 0.9, oz: -0.06, palm: 1 } },
        { f: 36, e: 'io', reset: true },
      ],
      L,
    ),

    airLight: clip(stance, [
      { f: 0, p: { hipY: 0.95, fy: 0.3, by: 0.35, fPitch: 30, bPitch: 30, gx: 0.1, gy: 1.55, pitch: 115, yaw: 10, off: 0, palm: 0, chest: -4 } },
      { f: 4, e: 'lin', p: { gx: 0.35, gy: 1.45, pitch: 55, twist: 10 } },
      { f: 5, e: 'snap', p: { gx: 0.55, gy: 1.25, gz: 0.16, pitch: 0, twist: 28, chest: -10 } },
      { f: 10, e: 'out', p: { pitch: -28, gx: 0.55, gy: 1.15 } },
      { f: 22, e: 'io', p: { fy: 0.12, by: 0.15, pitch: 10, gx: 0.4, gy: 1.3 } },
      { f: 60, e: 'io', p: { fy: 0.02, by: 0.04, fPitch: 20, bPitch: 20 } },
    ]),

    airHeavy: clip(stance, [
      { f: 0, p: { hipY: 0.95, fy: 0.3, by: 0.35, fPitch: 30, bPitch: 30, gx: 0.0, gy: 1.62, pitch: 140, off: 0, palm: 0, chest: 4, spin: 8 } },
      { f: 6, e: 'out', p: { gx: -0.04, gy: 1.7, pitch: 150, chest: 8, head: 8 } },
      { f: 7, e: 'lin', p: { gx: 0.35, gy: 1.55, pitch: 60, spin: 0 } },
      { f: 8, e: 'snap', p: { gx: 0.5, gy: 1.12, gz: 0.16, pitch: -20, twist: 22, chest: -14, spin: -10, head: -10, fy: 0.22, by: 0.3 } },
      { f: 14, e: 'out', p: { pitch: -50, gx: 0.55, gy: 1.0 } },
      { f: 24, e: 'io', p: { fy: 0.08, by: 0.12, spin: 0, chest: -4 } },
      { f: 60, e: 'io', p: { fy: 0.02, by: 0.04 } },
    ]),

    // ----------------------------------------------------------- throws
    throwStart: clip(stance, [
      { f: 3, e: 'snap', p: { ox: 0.58, oy: 1.25, oz: 0.0, palm: 0, rootX: 0.06, hipLean: -10, twist: -14, fx: 0.44, gx: 0.05, gy: 1.4, pitch: 110 } },
      { f: 10, e: 'io', p: { ox: 0.55 } },
      { f: 26, e: 'io', reset: true },
    ]),
    throwing: clip(stance, [
      { f: 0, p: { ox: 0.58, oy: 1.25, oz: 0.0, palm: 0, rootX: 0.06, hipLean: -10, twist: -14, fx: 0.44, gx: 0.05, gy: 1.4, pitch: 110 } },
      { f: 10, e: 'io', p: { hipYaw: -40, twist: -30, ox: 0.4, oy: 1.05, hipLean: -16, chest: -10, rootX: 0.02 } },
      { f: 16, e: 'io', p: { hipYaw: -44, ox: 0.25, oy: 1.15, palm: 1 } },
      { f: 19, e: 'snap', p: { hipYaw: 10, twist: -40, rootX: 0.12, hipLean: -14, chest: -12, ox: 0.92, oy: 1.38, oz: 0, palm: 1, fx: 0.6 } },
      { f: 24, e: 'out', p: { ox: 0.95 } },
      { f: 34, e: 'io', reset: true },
    ]),
    gripping: shared.thrownVictim,

    // ----------------------------------------------------------- Force Push
    special: clip(
      stance,
      [
        { f: 7, e: 'io', p: { ox: -0.22, oy: 1.3, oz: -0.24, palm: 0, gx: 0.05, gy: 1.0, gz: 0.2, pitch: -55, yaw: 170, twist: -24, hipYaw: -16, chest: 8, rootX: -0.06, hipLean: 0 } },
        { f: 11, e: 'hold', p: { ox: -0.24, oy: 1.32 } },
        { f: 12, e: 'lin', p: { ox: 0.4, oy: 1.36, palm: 1, twist: -30, hipYaw: 0 } },
        { f: 14, e: 'snap', p: { ox: 0.86, oy: 1.38, oz: -0.02, palm: 1, fx: 0.55, rootX: 0.08, chest: -10, hipLean: -16, twist: -40, hipYaw: 10, head: 0 } },
        { f: 20, e: 'out', p: { ox: 0.88 } },
        { f: 28, e: 'io', p: { ox: 0.6, oy: 1.34, chest: -2, hipLean: -8 } },
        { f: 38, e: 'io', reset: true },
      ],
      L,
    ),

    // ----------------------------------------------------------- Saber Storm
    superCharge: clip(stance, [
      { f: 10, e: 'out', p: { gx: 0.2, gy: 1.35, gz: 0.16, pitch: -5, yaw: 4, ox: 0.5, oy: 1.45, oz: -0.06, palm: 1, hipY: 0.74, head: -12, chest: -2, twist: -4 } },
      { f: 26, e: 'io', p: { pitch: -3, head: -8 } },
      { f: 34, e: 'io', p: { pitch: -6, hipY: 0.72, head: 0 } },
      { f: 42, e: 'io', p: { hipLean: -18, chest: -8 } },
    ]),
    super: clip(
      stance,
      [
        { f: 0, p: { gx: 0.2, gy: 1.35, pitch: -5, ox: 0.5, oy: 1.45, palm: 1, hipY: 0.72, hipLean: -18, chest: -8 } },
        { f: 3, e: 'out', p: { hipLean: -35, rootX: 0.1, fx: 0.55, bx: -0.6, hipY: 0.66, gx: 0.05, gy: 1.6, pitch: 150, off: 0, palm: 0, twist: -12 } },
        { f: 11, e: 'snap', p: { gx: 0.62, gy: 1.02, pitch: -32, yaw: 18, twist: 36, chest: -12, hipLean: -20, rootX: 0.14, hipY: 0.72 } },
        { f: 14, e: 'io', p: { gx: 0.12, gy: 0.85, pitch: -150, yaw: 175, twist: -20, chest: -2 } },
        { f: 16, e: 'snap', p: { gx: 0.62, gy: 1.5, pitch: 45, yaw: 20, twist: 30, chest: -4 } },
        { f: 19, e: 'io', p: { gx: 0.15, gy: 1.25, pitch: 12, yaw: 192, twist: -32 } },
        { f: 21, e: 'snap', p: { gx: 0.68, gy: 1.2, gz: 0.22, pitch: 4, yaw: 0, twist: 40, hipLean: -14 } },
        { f: 24, e: 'lin', p: { spinY: 180, gx: 0.3, gy: 1.3, pitch: 10, yaw: 90 } },
        { f: 26, e: 'snap', p: { spinY: 360, gx: 0.66, gy: 1.05, pitch: -10, yaw: -6, twist: 38 } },
        { f: 30, e: 'io', p: { spinY: 360, hipY: 0.98, fy: 0.12, by: 0.1, gx: 0.02, gy: 1.86, pitch: 176, yaw: 0, twist: -18, chest: 14, hipLean: 2 } },
        { f: 32, e: 'hold', p: { pitch: 178 } },
        { f: 35, e: 'snap', p: { rootX: 0.22, hipY: 0.62, fy: 0, by: 0, bx: -0.58, bKnee: 30, gx: 0.72, gy: 0.72, pitch: -66, yaw: 20, twist: 42, chest: -18, hipLean: -26, spine: -8, head: -10 } },
        { f: 48, e: 'hold', p: { pitch: -64 } },
        { f: 62, e: 'io', reset: true, p: { spinY: 360 } },
      ],
      { lagTorso: 0.5, lagHead: 1 },
    ),

    // Combo finisher: a full spin cut (Obi-Wan vs Grievous), horizontal through the chest.
    heavyChain: clip(
      stance,
      [
        { f: 3, e: 'out', p: { gx: 0.1, gy: 1.44, gz: 0.36, pitch: 30, yaw: 150, twist: 28, hipYaw: 20, hipY: 0.76, hipLean: -8, chest: 2, head: -4, off: 0, palm: 0, rootX: -0.03, fy: 0.04, fPitch: 15 } },
        { f: 5, e: 'in', p: { spinY: 40, fx: 0.4, fy: 0.08, bPitch: 20 } },
        { f: 8, e: 'lin', p: { spinY: 200, gx: 0.36, gy: 1.3, gz: 0.36, pitch: 6, yaw: 162, hipY: 0.8, fy: 0.04, by: 0.06, bx: -0.3 } },
        { f: 10, e: 'lin', p: { spinY: 320, gx: 0.5, gz: 0.3, yaw: 70, fx: 0.5, fy: 0, by: 0, bx: -0.42 } },
        { f: 11, e: 'snap', p: { spinY: 360, gx: 0.68, gy: 1.3, gz: 0.18, pitch: 2, yaw: 4, twist: -10, hipYaw: -12, hipY: 0.74, hipLean: -14, chest: -6, head: -8, rootX: 0.12, fx: 0.56, bx: -0.48, bPitch: 24 } },
        { f: 14, e: 'out', p: { yaw: -46, gx: 0.62, gz: 0.06, twist: -20, hipYaw: -18 } },
        { f: 20, e: 'out', p: { yaw: -62, gx: 0.56, gy: 1.22, pitch: -8, twist: -24, hipYaw: -20, hipY: 0.76, chest: -8, head: -6, bPitch: 30 } },
        { f: 26, e: 'io', p: { gx: 0.24, gy: 1.4, gz: 0.18, pitch: 78, yaw: 10, twist: 0, hipYaw: -4, hipY: 0.79, hipLean: -6, chest: 2, head: -2, rootX: 0.08, fx: 0.42, fy: 0.03, bx: -0.42, bPitch: 6 } },
        { f: 33, e: 'io', reset: true, p: { spinY: 360 } },
      ],
      L,
    ),

    // Chained low cut: a backhand along the shins.
    crLight2: clip(
      crouch,
      [
        { f: 3, e: 'out', p: { gx: 0.14, gy: 0.72, gz: 0.16, pitch: -8, yaw: 150, twist: 18, hipYaw: 10, off: 1, ox: 0.2, oy: 0.62, oz: -0.12, palm: 0 } },
        { f: 5, e: 'lin', p: { gx: 0.4, gy: 0.6, gz: 0.24, pitch: -10, yaw: 80, twist: 6 } },
        { f: 6, e: 'snap', p: { gx: 0.6, gy: 0.56, gz: 0.18, pitch: -14, yaw: 4, twist: -10, hipYaw: -8, rootX: 0.04, ox: 0.06, oy: 0.7, oz: -0.2, palm: 1 } },
        { f: 9, e: 'out', p: { yaw: -36, gx: 0.56 } },
        { f: 13, e: 'io', p: { gx: 0.4, gy: 0.82, gz: 0.18, pitch: 20, yaw: 0, twist: 2, ox: crouch.ox, oy: crouch.oy, palm: 0 } },
        { f: 18, e: 'io', reset: true },
      ],
      L,
    ),

    // Idle flourish 1: a figure-eight twirl in front, settling back into the high guard.
    idleBreak: clip(
      stance,
      [
        { f: 10, e: 'io', p: { gx: 0.32, gy: 1.26, gz: 0.44, pitch: 80, yaw: 0, twist: 4, hipYaw: -2, head: -2, ox: 0.28, oy: 1.18, palm: 0 } },
        { f: 18, e: 'io', p: { gx: 0.34, gy: 1.22, pitch: 260, yaw: 4 } },
        { f: 26, e: 'io', p: { gx: 0.32, gy: 1.28, pitch: 440, yaw: -4 } },
        { f: 34, e: 'io', p: { gx: 0.34, gy: 1.22, pitch: 620, yaw: 4 } },
        { f: 42, e: 'out', p: { gx: 0.3, gy: 1.36, gz: 0.36, pitch: 800, yaw: 10, head: -6 } },
        { f: 54, e: 'io', p: { ...stance, pitch: stance.pitch + 720 } },
        { f: 70, e: 'io', p: { ...stance, pitch: stance.pitch + 720 } },
      ],
      { lagTorso: 2, lagHead: 4 },
    ),

    // Idle flourish 2: lowers the blade and strokes his beard, considering the opponent.
    idleBreak2: clip(
      stance,
      [
        { f: 14, e: 'io', p: { gx: 0.24, gy: 0.98, gz: 0.24, pitch: -78, yaw: 14, twist: 0, hipYaw: -2, hipY: 0.84, hipLean: -2, chest: 2, head: -6, ox: 0.16, oy: 1.6, oz: 0.02, palm: 0, nElbow: 0 } },
        { f: 30, e: 'io', p: { oy: 1.56, ox: 0.18, head: -9, headRoll: 6 } },
        { f: 46, e: 'io', p: { oy: 1.6, ox: 0.16, head: -5, headRoll: -4 } },
        { f: 58, e: 'io', p: { oy: 1.57, headRoll: 0 } },
        { f: 72, e: 'io', p: { gx: 0.1, gy: 1.4, pitch: 40, ox: 0.32, oy: 1.3, oz: -0.06, palm: 1, head: -4, hipY: stance.hipY } },
        { f: 86, e: 'io', reset: true },
      ],
      { lagTorso: 2, lagHead: 4 },
    ),

    // Push-off into the run: drop the hips, swing the blade back to the carry, first stride.
    runStart: clip(stance, [
      { f: 2, e: 'out', p: { hipY: 0.76, hipLean: -14, chest: -2, head: 2, by: 0.04, bPitch: 30, gx: 0.0, gy: 1.3, pitch: 120, yaw: 60 } },
      { f: 5, e: 'io', p: { hipY: 0.79, hipLean: -20, spine: -5, chest: -4, fx: 0.42, fy: 0.12, bx: -0.36, by: 0.02, bPitch: 40, gx: -0.12, gy: 1.0, gz: 0.16, pitch: 10, yaw: 172, ox: 0.24, oy: 1.12, oz: -0.12, palm: 0 } },
      { f: 9, e: 'io', p: { ...runBase, fx: 0.3, fy: 0.02, bx: -0.3, by: 0.16 } },
    ]),

    // ----------------------------------------------------------- parry set
    parry: clip(
      stance,
      [
        { f: 1, e: 'snap', p: { gx: 0.38, gy: 1.3, gz: 0.18, pitch: 95, yaw: 20, off: 0, palm: 0, hipY: stance.hipY - 0.03, twist: 6, hipYaw: 0, chest: 5, head: -2, rootX: -0.02 } },
        { f: 3, p: { pitch: 99 } },
        { f: 5, p: { pitch: 91 } },
        { f: 7, p: { pitch: 98 } },
        { f: 8, p: { pitch: 95 } },
        { f: 16, e: 'io', p: { pitch: 80, gx: 0.45, gy: 1.24, head: 6, headRoll: 6, chest: 2 } },
        { f: 30, e: 'io', reset: true },
      ],
      { lagTorso: 0.3, lagHead: 1 },
    ),
    parrySuccess: clip(stance, [
      { f: 0, p: { gx: 0.38, gy: 1.3, gz: 0.18, pitch: 95, yaw: 20, off: 0, palm: 0, hipY: stance.hipY - 0.03, twist: 6, hipYaw: 0, chest: 5 } },
      { f: 4, e: 'snap', p: { gx: 0.52, gy: 1.32, pitch: 58, yaw: 38, twist: 18, hipYaw: 12, chest: 0, rootX: 0.03 } },
      { f: 6, e: 'hold', p: { pitch: 56 } },
      { f: 10, e: 'io', p: { gx: 0.08, gy: 1.74, pitch: 150, yaw: 10, twist: -4, off: 1, ox: 0.38, oy: 1.32, palm: 1 } },
      { f: 14, e: 'io', reset: true },
    ]),
    parried: clip(stance, [
      { f: 2, e: 'snap', p: { pitch: 140, gx: 0.02, gy: 1.62, chest: stance.chest + 12, head: stance.head + 14, hipLean: stance.hipLean + 8, rootX: -0.08, fy: 0.05, off: 1, ox: -0.32, oy: 1.42, oz: -0.24, palm: 1 } },
      { f: 10, e: 'out', p: { bx: stance.bx - 0.18, fy: 0, hipY: stance.hipY - 0.03 } },
      { f: 18, e: 'io', p: { fx: stance.fx - 0.1, gx: 0.06, gy: 1.6, pitch: -10, chest: stance.chest + 4, head: stance.head + 4 } },
      { f: 28, e: 'io', reset: true },
    ]),

    // ----------------------------------------------------------- recovery / ceremony
    getup: clip(stance, [
      { f: 0, p: { ...lying } },
      // Back roll over the shoulder: the sword hand stays tucked by the chest with the blade kept
      // pointing up in the world (pitch counter-rotates the roll), so nothing cuts the deck.
      { f: 3, e: 'in', p: { spin: 120, fx: 0.15, fy: 0.42, bx: 0.05, by: 0.48, hipY: 0.22, rootX: -0.2, chest: -15, head: -20, gx: -0.05, gy: 0.6, gz: 0.32, pitch: -30, yaw: 10, off: 0 } },
      { f: 7, e: 'lin', p: { spin: 270, hipY: 0.68, rootX: -0.3, gx: -0.1, gy: 0.93, pitch: -180 } },
      { f: 8.5, e: 'lin', p: { spin: 315, hipY: 0.64, rootX: -0.25, fx: 0.12, fy: 0.34, bx: 0.0, by: 0.4, pitch: -250 } },
      { f: 10, e: 'out', p: { spin: 360, hipY: 0.5, rootX: -0.15, fx: 0.38, fy: 0, bx: -0.45, by: 0, bKnee: 20, fPitch: 0, bPitch: 0, hipLean: -8, spine: -2, chest: 0, head: 0, headYaw: 0, gx: 0.08, gy: 1.45, gz: 0.14, pitch: -380, yaw: 8, off: 1, ox: 0.25, oy: 1.0, oz: -0.06, palm: 1 } },
      { f: 15, e: 'io', p: { hipY: 0.56 } },
      { f: 22, e: 'outBack', p: { ...stance, spin: 360, pitch: stance.pitch - 360 } },
    ]),

    intro: (() => {
      const rest = makePose(stance, { hipY: 0.94, hipLean: 0, hipYaw: 0, spine: 0, chest: 0, twist: 0, head: 4, gx: 0.12, gy: 0.86, gz: 0.24, pitch: -84, yaw: 10, blade: 0, off: 1, ox: -0.02, oy: 0.9, oz: -0.26, palm: 0, fx: 0.16, bx: -0.18, bKnee: 0, fKnee: 0 });
      return clip(
        rest,
        [
          { f: 16 },
          { f: 22, e: 'io', p: { gx: 0.1, gy: 1.0, pitch: -100, yaw: 160, head: -6 } },
          { f: 25, e: 'lin', p: { blade: 1 } },
          { f: 34, e: 'io', p: { gx: 0.3, gy: 1.2, pitch: 20, yaw: 60 } },
          { f: 42, e: 'out', p: { gx: 0.26, gy: 1.36, pitch: 90, yaw: 20, head: 0 } },
          { f: 56, e: 'io' },
          { f: 72, e: 'io', p: { ...stance } },
        ],
        { lagTorso: 1, lagHead: 2 },
      );
    })(),

    // Salute: the blade raised vertical out in front of the near shoulder (clear of the face), a bow
    // over it, then the blade is switched off and the hilt hung at the belt.
    victory: clip(stance, [
      { f: 8, e: 'io', p: { gx: 0.36, gy: 1.3, gz: 0.34, pitch: 88, yaw: 8, off: 1, ox: -0.05, oy: 0.95, oz: -0.25, palm: 0, hipY: 0.92, hipLean: 0, hipYaw: 0, chest: 0, twist: 6, head: -2, fx: 0.18, bx: -0.2, bKnee: 2, fKnee: 2, nElbow: 0 } },
      { f: 14, e: 'out', p: { gy: 1.34, pitch: 92, hipY: 0.94 } },
      { f: 22, e: 'io', p: { head: -16, chest: -6, hipLean: -6, gy: 1.3 } },
      { f: 30, e: 'io', p: { head: -12, chest: -4, hipLean: -4 } },
      { f: 33, e: 'lin', p: { blade: 0 } },
      { f: 46, e: 'io', p: { gx: 0.14, gy: 0.98, gz: 0.2, pitch: -84, yaw: 10, ox: 0.1, oy: 0.98, oz: -0.05, head: 0, chest: 0, hipLean: 0 } },
      { f: 60 },
    ]),
  };

  return { stance, guard, crouch, crouchGuard, walk, walkBack, run, clips, turnFrames: 6 };
}
