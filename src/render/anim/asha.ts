import { clip, type KeySpec } from './clip';
import type { GaitSpec } from './gait';
import { makePose, NEUTRAL, type Pose, type PosePatch } from './pose';
import { lyingPose, sharedClips, type Physique } from './shared';
import type { AnimSet } from './types';

/**
 * ASHA — acrobatic Jar'Kai duelist (Ahsoka Tano reverse grip + Form IV Ataru acrobatics).
 * Two green sabers in reverse grip: the main (near hand, g*) and the shoto (far hand, g2*). Low,
 * springy, always whirling; ~15% quicker than KAEL, holds of 1–2 frames, attacks chained through
 * body rotation. See artifacts/animation-reference.md §2.4–2.5 / §3.3 and the v3 refinement brief.
 *
 * Reverse-grip rules used throughout (checked per frame against the rig):
 * - A blade either lies back along its forearm (pitch ~180–220 with the fist ahead of the elbow) or
 *   sits perpendicular to it. It never continues the forearm line out of the thumb side.
 * - Forward-reaching contacts keep the arm folded (fist in front of its shoulder, elbow under it) so
 *   a forward blade is perpendicular to an upright forearm.
 * - Blades that point UP need the elbow raised (nElbow / fElbow ~110–130: forearm horizontal).
 * - Spins and propeller cuts hold the fists out to the sides with the blades along ±x.
 * - Cuts travel either round the camera side (yaw 0 → −90 → −180 at pitch ~195: "hook"), or under
 *   (pitch 200 → 270 → 350: "rising"), or over with a raised elbow ("hammer").
 */

const XS = ['rootX', 'gx', 'g2x', 'ox', 'fx', 'bx'] as const;
const YS = ['hipY', 'gy', 'g2y', 'oy', 'fy', 'by'] as const;

/** Translate a full pose (all absolute positions move with the body). */
function shift(p: Pose, dx: number, dy = 0): Pose {
  const o = { ...p };
  for (const k of XS) o[k] += dx;
  for (const k of YS) o[k] += dy;
  return o;
}

/** Main saber (near hand). */
const m = (gx: number, gy: number, gz: number, pitch: number, yaw = 0): PosePatch => ({ gx, gy, gz, pitch, yaw });
/** Shoto (far hand, saber 2); the free-hand channels follow so shared reactions start from the same place. */
const s = (x: number, y: number, z: number, pitch2: number, yaw2 = 0): PosePatch => ({ g2x: x, g2y: y, g2z: z, pitch2, yaw2, ox: x, oy: y, oz: z });
/** Elbow steering (0 = natural, ~120 = raised so the forearm runs level). */
const el = (nElbow: number, fElbow = nElbow): PosePatch => ({ nElbow, fElbow });

export function ashaAnims(): AnimSet {
  const ph: Physique = { amp: 1.25, head: 1, dual: true };

  // Low, wide, on the balls of the feet. Main fist forward-low with its blade lying back along the
  // forearm; shoto hand cocked by the ear with its blade swept back over the shoulder. Silhouette:
  // two bright back-swept diagonals.
  const stance = makePose(NEUTRAL, {
    rootX: -0.02,
    hipY: 0.68,
    hipLean: -26,
    hipYaw: -4,
    spine: -10,
    chest: -6,
    twist: 6,
    head: 2,
    ...m(0.46, 1.02, 0.22, 202, -14),
    off: 1,
    palm: 0,
    ...s(0.06, 1.36, -0.16, 162, 20),
    ...el(0),
    fx: 0.44,
    fPitch: 6,
    fKnee: 6,
    bx: -0.5,
    by: 0.04,
    bPitch: 36,
    bKnee: 16,
  });
  const st = stance;
  const bladesOf = (p: Pose): PosePatch => ({ ...m(p.gx, p.gy, p.gz, p.pitch, p.yaw), ...s(p.g2x, p.g2y, p.g2z, p.pitch2, p.yaw2), ...el(p.nElbow, p.fElbow) });

  // Shien forearm X: elbows raised, forearms level, blades standing up and crossed in front of the face.
  const X_GUARD: PosePatch = { ...m(0.5, 1.2, 0.12, 80, 10), ...s(0.56, 1.18, -0.04, 102, -10), ...el(130) };
  const guard = makePose(stance, { rootX: -0.04, hipY: 0.64, hipLean: -14, hipYaw: 0, spine: -4, chest: -2, twist: 0, head: 2, ...X_GUARD });
  const crouch = makePose(stance, {
    hipY: 0.46,
    hipLean: -26,
    spine: -6,
    chest: -4,
    head: 6,
    twist: 4,
    ...m(0.46, 0.76, 0.24, 198, -14),
    ...s(0.12, 1.08, -0.18, 168, 22),
    fx: 0.5,
    fKnee: 12,
    bx: -0.52,
    by: 0.04,
    bPitch: 40,
    bKnee: 30,
  });
  // Low X over the front shin, blades angled down past the knee.
  const crouchGuard = makePose(crouch, { hipLean: -18, twist: 0, ...m(0.32, 0.86, 0.2, -40, 10), ...s(0.58, 0.84, -0.1, -125, -10) });

  const shared = sharedClips({ stance, guard, crouch, crouchGuard }, ph);
  // Lying on the back with both arms out to the sides, blades flat on the deck along the body.
  const lying = lyingPose(stance, ph, { ...m(0.02, 1.14, 0.52, -90, 0), ...s(-0.02, 1.16, -0.52, -90, 0), ...el(0), fy: -0.76, by: -0.66 });

  // ----------------------------------------------------------------- gaits
  const walkBase = makePose(stance, { hipY: 0.7, fx: 0.38, bx: -0.42, fPitch: 14, bPitch: 34, by: 0.04 });
  const walk: GaitSpec = { kind: 'shuffle', base: walkBase, stride: 0.95, lift: 0.09, bob: 0.022, lean: -2, sway: 6, armPump: 0, bladeBob: 4, toe: 30 };
  const walkBack: GaitSpec = { ...walk, stride: 0.85, lift: 0.07, lean: 3, sway: 4, bob: 0.016 };
  // Naruto run: torso pitched far forward, both arms locked straight back, blades standing up off
  // the fists like fins (perpendicular to the trailing forearms).
  const runBase = makePose(stance, {
    rootX: 0.04,
    hipY: 0.8,
    hipLean: -48,
    hipYaw: 0,
    spine: -14,
    chest: -4,
    twist: 0,
    head: 25,
    ...m(-0.06, 0.98, 0.24, 100, -10),
    ...s(-0.08, 0.96, -0.24, 100, 10),
    fx: 0.1,
    fPitch: 0,
    fKnee: 0,
    bx: -0.04,
    by: 0,
    bPitch: 0,
    bKnee: 0,
  });
  const run: GaitSpec = { kind: 'run', base: runBase, stride: 2.36, lift: 0.36, bob: 0.05, lean: 0, sway: 8, armPump: 0, bladeBob: 4, stance: 0.3, heelKick: 0.4 };

  const L = { lagTorso: 0.6, lagHead: 1.2 };

  // ----------------------------------------------------------------- idle: 1.0 s bounce
  const low: PosePatch = { hipY: st.hipY - 0.025, fy: 0, fPitch: st.fPitch, by: st.by, bPitch: st.bPitch, gy: st.gy - 0.01, g2y: st.g2y - 0.012, chest: st.chest, head: st.head, pitch: st.pitch, pitch2: st.pitch2 };
  const high = (sway: number): PosePatch => ({ hipY: st.hipY + 0.022, fy: 0.012, fPitch: 18, by: 0.05, bPitch: 42, gy: st.gy + 0.012, g2y: st.g2y + 0.015, chest: st.chest + 1.5, head: st.head + 1, pitch: st.pitch + 5 * sway, pitch2: st.pitch2 - 5 * sway });
  const idle = clip(
    stance,
    [
      { f: 0, p: low },
      { f: 14, e: 'out', p: high(1) },
      { f: 30, e: 'in', p: low },
      { f: 44, e: 'out', p: high(-1) },
      { f: 60, e: 'in', p: low },
    ],
    { loop: true, lagTorso: 2, lagHead: 4 },
  );

  // Idle flourish 1: rolls the shoto twice through her fingers in front of her, snaps it back to the
  // ear, then rolls the main wrist.
  const idleBreak = clip(
    stance,
    [
      { f: 8, e: 'io', p: { rootX: -0.05, hipY: 0.7, hipLean: -20, spine: -8, head: -6, headYaw: -12, ...s(0.3, 1.18, -0.34, 200, 0), bx: -0.5, by: 0.05 } },
      { f: 12, e: 'in', p: { pitch2: 214, hipY: 0.69 } },
      { f: 24, e: 'lin', p: { pitch2: 214 + 360, hipY: 0.72, head: -8 } },
      { f: 36, e: 'lin', p: { pitch2: 214 + 720, hipY: 0.69 } },
      { f: 40, e: 'out', p: { pitch2: 162 + 720 + 40, headYaw: -4, head: -2 } },
      { f: 46, e: 'snap', p: { ...s(st.g2x, st.g2y + 0.04, st.g2z, 162 + 720, 20), headYaw: 6, head: 4, hipY: 0.66 } },
      { f: 52, e: 'io', p: { hipY: 0.7, head: 2, headYaw: 0 } },
      { f: 58, e: 'io', p: { yaw: -70, gy: 1.08, pitch: 196 } },
      { f: 64, e: 'out', p: { yaw: -14, gy: 1.02, pitch: 202 } },
      { f: 76, e: 'io', p: { rootX: st.rootX, hipY: st.hipY, hipLean: st.hipLean, spine: st.spine } },
      { f: 84, e: 'io', p: { ...stance, pitch2: st.pitch2 + 720 } },
    ],
    { lagTorso: 2, lagHead: 3 },
  );

  // Idle flourish 2: two springy bounces on the toes, blades cross into the X and she peeks over
  // them, then flicks them back out to the sides and drops into stance.
  const idleBreak2 = clip(
    stance,
    [
      { f: 6, e: 'out', p: { hipY: 0.74, fy: 0.03, fPitch: 24, by: 0.07, bPitch: 50, chest: -3 } },
      { f: 12, e: 'in', p: { hipY: 0.64, fy: 0, fPitch: 6, by: 0.04, bPitch: 36, chest: -6 } },
      { f: 18, e: 'out', p: { hipY: 0.74, fy: 0.03, fPitch: 24, by: 0.07, bPitch: 50, ...s(0.3, 1.16, -0.3, 200, 0), ...el(0) } },
      { f: 24, e: 'io', p: { hipY: 0.66, fy: 0, fPitch: 6, by: 0.04, bPitch: 36, hipLean: -16, spine: -6, chest: -2, twist: 0, hipYaw: 0, ...X_GUARD, pitch2: X_GUARD.pitch2! + 360 } },
      { f: 30, e: 'out', p: { head: -8, headRoll: 10, gy: 1.24, g2y: 1.22 } },
      { f: 44, e: 'io', p: { head: -6, headRoll: 12, hipY: 0.65 } },
      { f: 48, e: 'in', p: { headRoll: 4, gy: 1.18, g2y: 1.16 } },
      // Flick open: main out round the camera side and down, shoto back over the shoulder.
      { f: 52, e: 'snap', p: { headRoll: 0, head: 4, ...m(0.42, 1.1, 0.42, 232, -150), ...s(0.0, 1.3, -0.36, 186, 30), ...el(0), hipY: 0.7 } },
      { f: 60, e: 'io', p: { ...m(0.44, 1.04, 0.3, 216, -60), ...s(0.04, 1.36, -0.22, 170, 22) } },
      { f: 70, e: 'io', p: { ...stance } },
    ],
    { lagTorso: 1.5, lagHead: 2.5 },
  );

  // ----------------------------------------------------------------- movement
  // Push-off into the Naruto run: dip, lean in, rear leg drives, front knee comes through.
  const runStart = clip(
    stance,
    [
      { f: 2, e: 'io', p: { hipY: 0.6, hipLean: -38, spine: -12, chest: -6, head: 14, rootX: 0.0, ...m(0.24, 0.94, 0.28, 214, -10), ...s(0.04, 1.06, -0.26, 210, 14) } },
      { f: 5, e: 'out', p: { hipY: 0.74, hipLean: -46, spine: -14, chest: -4, head: 22, fx: 0.4, fy: 0.24, fPitch: 30, fKnee: 4, bx: -0.52, by: 0, bPitch: 10, ...m(0.02, 0.96, 0.26, 268, -10), ...s(-0.06, 0.96, -0.26, 268, 10) } },
      { f: 9, e: 'io', p: { ...runBase, pitch: 400, pitch2: 400, fx: 0.32, fy: 0.06, bx: -0.34, by: 0.22, fPitch: 20, bPitch: 40 } },
    ],
    { lagTorso: 0.5, lagHead: 1 },
  );

  // Heel-dig skid; the arms swing forward from the fins back into the reverse-grip stance.
  const runStop = clip(runBase, [
    { f: 2, e: 'out', p: { hipLean: 0, spine: -2, chest: 4, head: 2, hipY: 0.62, rootX: -0.06, fx: 0.54, fy: 0, fPitch: -25, bx: -0.46, by: 0.05, bPitch: 35, bKnee: 20, ...m(0.06, 1.0, 0.28, 150, -10), ...s(0.1, 1.18, -0.24, 140, 14) } },
    { f: 5, e: 'io', p: { hipLean: -14, spine: -6, chest: -4, hipY: 0.64, fPitch: 0, ...m(0.36, 1.02, 0.26, 192, -12), ...s(0.08, 1.28, -0.2, 160, 20) } },
    { f: 9, e: 'io', p: { ...stance } },
  ]);

  // Tucked back hop behind the X guard, toes first, springs out of it.
  const backdash = clip(stance, [
    { f: 1, e: 'io', p: { ...s(0.3, 1.2, -0.28, 150, 10), ...m(0.48, 1.12, 0.2, 150, 0), nElbow: 60, hipY: 0.72 } },
    { f: 3, e: 'out', p: { rootX: -0.04, hipY: 0.82, spin: 8, fy: 0.16, by: 0.24, fx: 0.32, bx: -0.3, fPitch: 30, bPitch: 35, hipLean: -12, spine: -4, chest: -2, head: 0, twist: 0, hipYaw: 0, ...X_GUARD } },
    { f: 7, e: 'io', p: { hipY: 0.9, fy: 0.36, by: 0.34, fx: 0.3, bx: -0.04, spin: 16, fKnee: 10, bKnee: 10, chest: -6, head: -2 } },
    { f: 10, e: 'in', p: { hipY: 0.7, fy: 0.08, by: 0.02, fx: 0.38, bx: -0.42, spin: 4, fPitch: 25, bPitch: 40 } },
    { f: 12, e: 'out', p: { hipY: 0.6, fy: 0, by: 0.03, fx: 0.42, bx: -0.48, spin: 0, hipLean: -20, spine: -8 } },
    { f: 14, e: 'io', p: { hipY: 0.7, ...m(0.48, 1.08, 0.24, 150, -6), ...s(0.36, 1.12, -0.28, 150, 14), ...el(40), hipLean: -22 } },
    { f: 18, e: 'io', p: { ...stance, pitch: st.pitch, pitch2: st.pitch2 } },
  ]);

  const crouchDown = clip(
    stance,
    [
      { f: 2, e: 'in', p: { hipY: 0.6, hipLean: -24, head: 0, ...m(0.46, 0.92, 0.24, 200, -14), ...s(0.1, 1.24, -0.17, 165, 21) } },
      { f: 4, e: 'out', p: { ...crouch, hipY: crouch.hipY - 0.04, hipLean: crouch.hipLean - 3, head: crouch.head - 2 } },
      { f: 7, e: 'io', p: { ...crouch } },
    ],
    { lagTorso: 0.6, lagHead: 1.2 },
  );
  const standUp = clip(
    stance,
    [
      { f: 0, p: { ...crouch } },
      { f: 3, e: 'out', p: { ...stance, hipY: st.hipY + 0.03, chest: st.chest + 2, head: st.head + 2, gy: st.gy + 0.02, g2y: st.g2y + 0.02 } },
      { f: 6, e: 'io', p: { ...stance } },
    ],
    { lagTorso: 0.6, lagHead: 1.2 },
  );

  const jumpSquat = clip(stance, [{ f: 4, e: 'out', p: { hipY: 0.48, hipLean: -30, spine: -12, chest: -8, head: 8, fPitch: 0, bPitch: 20, ...m(0.34, 0.84, 0.26, 196, -14), ...s(-0.02, 1.06, -0.22, 176, 20) } }], { lagTorso: 0.4, lagHead: 0.8 });

  // Arms ready to land: stance blades, slightly higher.
  const airReady: PosePatch = { hipLean: -12, spine: -4, chest: -4, head: 0, ...m(0.42, 1.14, 0.22, 205, -14), ...s(0.18, 1.32, -0.2, 182, 20), ...el(0) };
  // Corkscrew pencil: arms wrapped across the chest, main blade standing up, shoto pointing down.
  const pencil: PosePatch = { hipLean: -2, spine: 0, chest: 0, twist: 0, hipYaw: 0, head: 4, fx: 0.06, bx: -0.04, fy: 0.08, by: 0.12, fPitch: 50, bPitch: 50, fKnee: 0, bKnee: 0, ...m(0.18, 1.32, 0.22, 92, 14), ...s(0.22, 1.26, 0.04, 268, 0), ...el(120, 0) };
  const jumpUp = clip(stance, [
    { f: 0, p: { hipY: 0.96, hipLean: -8, spine: -4, chest: -2, fx: 0.12, bx: -0.14, fy: 0, by: 0, fPitch: 45, bPitch: 45, ...m(0.3, 1.24, 0.22, 200, -10), ...s(0.08, 1.3, -0.2, 180, 14), head: 8 } },
    { f: 4, e: 'io', p: { ...pencil, spinY: 30 } },
    { f: 14, e: 'lin', p: { spinY: 200, fy: 0.14, by: 0.18 } },
    { f: 22, e: 'lin', p: { spinY: 330 } },
    { f: 26, e: 'out', p: { spinY: 360, fy: 0.3, by: 0.34, fx: 0.16, bx: -0.04, fKnee: 8, bKnee: 8 } },
    { f: 29, e: 'io', p: { ...m(0.28, 1.3, 0.3, 150, -30), nElbow: 30, fy: 0.24, by: 0.28 } },
    { f: 33, e: 'io', p: { ...airReady, fy: 0.16, by: 0.2, fx: 0.24, bx: -0.24, fPitch: 30, bPitch: 30 } },
    { f: 46, e: 'io', p: { fy: 0.02, by: 0.05, fx: 0.34, bx: -0.36, fPitch: 20, bPitch: 25 } },
  ]);

  // Front flip, tucked tight and fast, blades out like a pinwheel (Yoda, AOTC): main points
  // forward-down off the knees, shoto back-up behind the shoulder.
  const jumpFwd = clip(stance, [
    { f: 0, p: { hipY: 0.96, hipLean: -8, spine: -4, chest: -2, fx: 0.14, bx: -0.16, fy: 0, by: 0, fPitch: 45, bPitch: 45, head: 8, ...m(0.3, 1.3, 0.22, -160, -10), ...s(0.0, 1.16, -0.22, 186, 12) } },
    { f: 4, e: 'io', p: { spin: -38, fy: 0.4, by: 0.44, fx: 0.22, bx: 0.06, fKnee: 8, bKnee: 8, hipLean: -10, chest: -18, spine: -6, head: -16, ...m(0.16, 1.2, 0.5, -42, 0), ...s(0.12, 1.2, -0.5, 138, 0) } },
    { f: 10, e: 'lin', p: { spin: -170 } },
    { f: 16, e: 'lin', p: { spin: -295 } },
    { f: 21, e: 'out', p: { spin: -360, fy: 0.2, by: 0.26, fx: 0.3, bx: -0.2, chest: -4, spine: -2, head: 0, ...airReady, pitch: 205 - 360 } },
    { f: 30, e: 'io', p: { fy: 0.08, by: 0.12 } },
    { f: 46, e: 'io', p: { fy: 0.02, by: 0.04, fx: 0.36, bx: -0.38, fPitch: 25, bPitch: 25 } },
  ]);

  // Layout back handspring, arms stretched overhead, the two blades a crossbar (main back, shoto forward).
  const jumpBack = clip(stance, [
    { f: 0, p: { hipY: 0.96, hipLean: 4, chest: 10, spine: 4, head: 16, fx: 0.1, bx: -0.12, fy: 0, by: 0, fPitch: 45, bPitch: 45, ...m(0.08, 1.84, 0.18, 180, 0), ...s(0.02, 1.82, -0.18, 0, 0) } },
    { f: 6, e: 'io', p: { spin: 55, fx: 0.06, bx: -0.06, fy: 0.04, by: 0.07, hipLean: 8, chest: 14, spine: 6 } },
    { f: 18, e: 'lin', p: { spin: 205 } },
    { f: 28, e: 'out', p: { spin: 345, fx: 0.24, bx: -0.2, fy: 0.14, by: 0.18, hipLean: -6, chest: 0, spine: 0, head: 2, ...airReady, pitch2: 162 - 360 } },
    { f: 34, e: 'io', p: { spin: 360, fy: 0.08, by: 0.12 } },
    { f: 46, e: 'io', p: { fy: 0.02, by: 0.04, fx: 0.34, bx: -0.36, fPitch: 25, bPitch: 25 } },
  ]);

  // From a run: superman dive with a barrel roll, blades out to the sides like wings; legs swing under.
  const jumpRun = clip(stance, [
    { f: 0, p: { ...runBase, hipY: 0.94, spin: -30, fx: 0.3, bx: -0.3, fy: 0.1, by: 0.25, fPitch: 40, bPitch: 40 } },
    { f: 7, e: 'io', p: { spin: -80, hipLean: -6, spine: -2, chest: 0, head: 10, fx: 0.04, bx: -0.08, fy: 0.02, by: 0.08, fPitch: 50, bPitch: 50, ...m(0.04, 0.88, 0.26, 200, -70), ...s(0.02, 0.9, -0.26, 200, 70) } },
    { f: 24, e: 'io', p: { tilt: 360 } },
    { f: 33, e: 'out', p: { spin: 0, tilt: 360, fx: 0.3, bx: -0.24, fy: 0.16, by: 0.22, fPitch: 30, bPitch: 30, ...airReady } },
    { f: 46, e: 'io', p: { fy: 0.02, by: 0.04, fx: 0.36, bx: -0.38, fPitch: 25, bPitch: 25 } },
  ]);

  // Three-point superhero landing: shoto fist on the deck, main arm swept back with its blade low.
  const threePoint: PosePatch = {
    hipY: 0.42,
    hipLean: -34,
    spine: -12,
    chest: -8,
    head: 18,
    twist: -4,
    hipYaw: 0,
    fx: 0.38,
    fKnee: 14,
    fPitch: 0,
    bx: -0.34,
    by: 0,
    bPitch: 50,
    bKnee: 34,
    ...m(-0.08, 0.96, 0.32, 236, -20),
    ...s(0.42, 0.1, -0.2, 150, 20),
    ...el(0),
  };
  const land = clip(
    stance,
    [
      { f: 0, p: { ...threePoint, hipY: 0.5, head: 10 } },
      { f: 2, e: 'out', p: { ...threePoint } },
      { f: 5, e: 'io', p: { hipY: 0.56, hipLean: -30, head: 8, ...m(0.24, 0.98, 0.28, 200, -16), ...s(0.24, 0.62, -0.2, 210, 20) } },
      { f: 9, e: 'io', p: { ...stance } },
    ],
    { lagTorso: 1, lagHead: 1.6 },
  );
  // Landing out of a flip or a running jump: the three-point slides and sinks deeper, then springs.
  const landHeavy = clip(
    stance,
    [
      { f: 0, p: { ...threePoint, hipY: 0.48, rootX: 0.04 } },
      { f: 3, e: 'out', p: { ...threePoint, hipY: 0.36, hipLean: -38, head: 20, rootX: 0.08, fKnee: 18, bKnee: 40, ...m(-0.04, 0.92, 0.32, 240, -22) } },
      { f: 7, e: 'io', p: { hipY: 0.5, hipLean: -32, head: 12, rootX: 0.04, ...m(0.18, 0.96, 0.3, 200, -18), ...s(0.26, 0.5, -0.2, 176, 20) } },
      { f: 12, e: 'io', p: { ...stance } },
    ],
    { lagTorso: 1, lagHead: 1.6 },
  );

  // Falling after an air attack: tuck, then open the legs toward the deck.
  const airRecover = clip(stance, [
    { f: 0, p: { hipY: 0.95, fy: 0.2, by: 0.28, fx: 0.2, bx: -0.1, fPitch: 30, bPitch: 30, ...airReady } },
    { f: 8, e: 'io', p: { fy: 0.34, by: 0.38, fx: 0.24, bx: 0.0, chest: -10, head: -4, fKnee: 8, bKnee: 8 } },
    { f: 22, e: 'io', p: { fy: 0.06, by: 0.1, fx: 0.32, bx: -0.32, chest: -4, head: 0, fKnee: 6, bKnee: 16 } },
  ]);

  // ----------------------------------------------------------------- attacks
  // Light 4/5 + 7/8 (string opener): reverse-grip hook with the main (round the camera side), then
  // the body unwinds and the shoto rips up from under (rising uppercut). One-two through rotation.
  const light = clip(
    stance,
    [
      // Anticipation: hips coil away, main fist drops to the hip, front foot lifts to step in.
      { f: 2, e: 'out', p: { twist: -18, hipYaw: -12, rootX: -0.02, ...m(0.22, 0.96, 0.3, 200, -4), ...s(0.02, 1.42, -0.2, 172, 22), fx: 0.5, fy: 0.05, fPitch: 18 } },
      // Smear: the wrist turns the blade out toward the camera as the fist rises.
      { f: 3, e: 'lin', p: { twist: 8, hipYaw: 2, ...m(0.44, 1.12, 0.34, 198, -92), fx: 0.57, fy: 0.02, fPitch: 6 } },
      // Contact 1: folded hook, front foot planted, rear heel peels up.
      { f: 4, e: 'snap', p: { twist: 30, hipYaw: 14, hipLean: -30, chest: -8, rootX: 0.05, ...m(0.56, 1.22, 0.2, 196, -168), ...s(0.0, 1.44, -0.22, 150, 22), fx: 0.58, fy: 0, fPitch: 0, bx: -0.62, by: 0.06, bPitch: 46, head: 0 } },
      { f: 5, e: 'out', p: { ...m(0.58, 1.2, 0.12, 196, -192) } },
      // Unwind: main pulls back to the hip, shoto fist drops low behind the knee.
      { f: 6, e: 'lin', p: { twist: 0, hipYaw: 0, ...m(0.36, 1.06, 0.26, 198, -110), ...s(0.26, 0.98, -0.22, 262, 8) } },
      // Contact 2: shoto uppercut — fist folded in front of the far shoulder, blade level.
      { f: 7, e: 'snap', p: { twist: -32, hipYaw: -14, chest: -10, hipLean: -32, rootX: 0.1, ...m(0.26, 1.0, 0.3, 200, -24), ...s(0.56, 1.2, -0.06, 354, -10), bx: -0.68, by: 0.08, bPitch: 52 } },
      { f: 8, e: 'out', p: { ...s(0.58, 1.28, -0.04, 364, -10) } },
      { f: 10, e: 'io', p: { ...s(0.54, 1.26, -0.06, 360, -8), chest: -12, head: 2 } },
      // Recover under: the shoto swings back down past the knee to the ear; rear foot steps in.
      { f: 12, e: 'io', p: { ...s(0.3, 1.04, -0.2, 290, 6), ...m(0.42, 1.04, 0.24, 202, -16), twist: -6, hipYaw: -4, chest: -6, hipLean: -24, bx: -0.58, by: 0.07, bPitch: 40, rootX: 0.04 } },
      { f: 14, e: 'io', p: { ...s(0.12, 1.26, -0.18, 200, 16), bx: -0.52, by: 0.05 } },
      { f: 17, e: 'io', p: { ...stance } },
    ],
    L,
  );

  // Light (2nd in a string): shoto hammer over the top with the elbow lifting then dropping, then the
  // main rips up from under (rising backhand) with a hop-step.
  const light2 = clip(
    stance,
    [
      { f: 2, e: 'out', p: { twist: 18, hipYaw: 8, rootX: -0.02, ...s(0.04, 1.46, -0.22, 196, 10), fElbow: 30, ...m(0.34, 0.98, 0.26, 200, -10), fx: 0.5, fy: 0.05, fPitch: 18, head: 4 } },
      { f: 3, e: 'lin', p: { twist: 0, hipYaw: 0, ...s(0.3, 1.42, -0.16, 150, -4), fElbow: 60, fx: 0.57, fy: 0.02 } },
      // Contact 1: elbow drops, blade chops forward-down.
      { f: 4, e: 'snap', p: { twist: -30, hipYaw: -14, hipLean: -32, chest: -10, rootX: 0.06, ...s(0.56, 1.2, -0.06, -30, -8), fElbow: 0, fx: 0.58, fy: 0, fPitch: 0, bx: -0.62, by: 0.06, bPitch: 46, head: -2 } },
      { f: 5, e: 'out', p: { ...s(0.6, 1.1, -0.06, -48, -8) } },
      // Main drops under to the hip, blade hanging straight down.
      { f: 6, e: 'lin', p: { twist: 0, hipYaw: 0, ...m(0.34, 0.92, 0.3, 240, -6) } },
      // Contact 2: rising backhand with the main.
      { f: 7, e: 'snap', p: { twist: 32, hipYaw: 14, hipLean: -32, chest: -8, rootX: 0.1, ...m(0.56, 1.2, 0.2, 352, 8), ...s(0.36, 1.0, -0.2, -100, 4), bx: -0.7, by: 0.08, bPitch: 52 } },
      { f: 8, e: 'out', p: { ...m(0.58, 1.28, 0.18, 362, 8) } },
      { f: 10, e: 'io', p: { ...m(0.52, 1.32, 0.18, 366, 6), head: 2 } },
      { f: 12, e: 'io', p: { ...m(0.4, 1.06, 0.26, 290, -6), ...s(0.2, 1.12, -0.2, -150, 12), twist: 4, hipLean: -24, bx: -0.58, by: 0.07, bPitch: 40, rootX: 0.04 } },
      { f: 14, e: 'io', p: { ...m(0.44, 1.02, 0.24, 232, -12), ...s(0.08, 1.3, -0.18, -184, 18), bx: -0.52, by: 0.05 } },
      { f: 17, e: 'io', p: { ...stance, pitch2: st.pitch2 - 360 } },
    ],
    L,
  );

  // Light (3rd in a string): whirl. Steps in onto the front foot and pirouettes 360 with the arms out
  // wide, blades along ±x like a propeller: main cuts on the way in, shoto as her back passes.
  const prop: PosePatch = { ...m(0.1, 1.2, 0.5, -6, 0), ...s(0.06, 1.18, -0.5, 188, 0), ...el(0) };
  const light3 = clip(
    stance,
    [
      { f: 2, e: 'out', p: { spinY: -50, rootX: 0.02, hipY: 0.62, hipLean: -20, spine: -6, chest: -4, twist: -10, headYaw: 36, fx: 0.06, fz: -0.1, fy: 0.05, fPitch: 20, ...m(0.28, 1.06, 0.3, 200, -10), ...s(0.12, 1.22, -0.3, 184, 14) } },
      { f: 3, e: 'lin', p: { spinY: -14, hipY: 0.7, fy: 0, fPitch: 30, by: 0.2, bx: -0.12, bKnee: 20, bPitch: 40, ...prop, pitch: 4, headYaw: 16 } },
      { f: 4, e: 'snap', p: { spinY: 26, hipY: 0.74, headYaw: 0, by: 0.32, bx: 0.0, chest: -2 } },
      { f: 5, e: 'lin', p: { spinY: 100 } },
      { f: 6, e: 'lin', p: { spinY: 168, headYaw: -40 } },
      { f: 7, e: 'snap', p: { spinY: 212, headYaw: -10 } },
      { f: 9, e: 'out', p: { spinY: 300, hipY: 0.7, pitch: -90, gx: 0.12, gy: 1.32, gz: 0.4, pitch2: 256, g2x: 0.3, g2y: 1.06, g2z: -0.36 } },
      { f: 11, e: 'out', p: { spinY: 360, hipY: 0.6, headYaw: 0, by: 0.12, bx: -0.3, ...m(0.12, 1.46, 0.2, -180, -10), ...s(0.5, 0.92, -0.1, 320, -10), ...el(0), hipLean: -24, twist: -14 } },
      { f: 13, e: 'io', p: { spinY: 360, by: 0.06, bx: -0.48, fz: 0, fx: 0.2, fy: 0.05, hipY: 0.62 } },
      { f: 15, e: 'io', p: { spinY: 360, fx: 0.42, fy: 0, by: 0.04, bx: -0.5, ...m(0.36, 1.08, 0.24, -168, -14), ...s(0.24, 1.14, -0.2, 220, 16), ...el(0), twist: 2, hipLean: -24 } },
      { f: 17, e: 'io', p: { ...stance, spinY: 360, pitch: st.pitch - 360 } },
    ],
    { lagTorso: 0.5, lagHead: 0.8 },
  );

  // Heavy 9–11 + 13–15: coil and spot, hop into a full spin with both arms thrown out (main cuts on
  // the way in, shoto as her back passes), land in a low flare — main up-back, shoto stabbed low.
  const heavy = clip(
    stance,
    [
      { f: 3, e: 'io', p: { fx: 0.5, fy: 0.06, fPitch: 20, hipY: 0.62 } },
      { f: 5, e: 'out', p: { spinY: -42, hipY: 0.54, twist: -24, hipYaw: -10, hipLean: -26, chest: -6, headYaw: 34, ...m(0.16, 1.0, 0.3, 200, -10), ...s(0.1, 1.2, -0.24, 180, 20), fx: 0.52, fy: 0, fPitch: 0, bx: -0.46, bPitch: 44 } },
      { f: 7, e: 'in', p: { spinY: -26, hipY: 0.62, twist: -14, headYaw: 20, by: 0.08 } },
      { f: 8, e: 'lin', p: { spinY: 4, hipY: 0.8, twist: 0, headYaw: 4, fx: 0.24, fy: 0.16, fPitch: 40, bx: -0.12, by: 0.24, bPitch: 40, fKnee: 6, bKnee: 10, ...prop, pitch: 6, hipLean: -16, chest: -2 } },
      { f: 9, e: 'snap', p: { spinY: 34, hipY: 0.86, fy: 0.22, by: 0.28 } },
      { f: 10, e: 'lin', p: { spinY: 92 } },
      { f: 11, e: 'lin', p: { spinY: 150 } },
      { f: 12, e: 'lin', p: { spinY: 200 } },
      { f: 13, e: 'snap', p: { spinY: 236, hipY: 0.82 } },
      { f: 14, e: 'lin', p: { spinY: 290, hipY: 0.74, fy: 0.08, by: 0.12, pitch: -40, pitch2: 236 } },
      { f: 16, e: 'out', p: { spinY: 350, hipY: 0.58, fx: 0.46, fy: 0, by: 0.03, bx: -0.52, fPitch: 0, bPitch: 44, hipLean: -26, pitch: -110, gx: 0.12, gy: 1.36, gz: 0.34, pitch2: 284, g2x: 0.4, g2y: 0.98, g2z: -0.26 } },
      // Flare (moving hold): main high-back with the elbow raised, shoto stabbed down by the front foot.
      { f: 18, e: 'out', p: { spinY: 360, hipY: 0.56, twist: -20, hipYaw: -6, ...m(0.1, 1.48, 0.2, -184, -10), ...s(0.54, 0.9, -0.1, 314, -10), ...el(0), by: 0.06, bPitch: 50 } },
      { f: 21, e: 'io', p: { hipY: 0.58, twist: -16, pitch: -188, pitch2: 310 } },
      { f: 25, e: 'io', p: { ...m(0.36, 1.12, 0.24, -168, -14), ...s(0.3, 1.0, -0.2, 240, 12), twist: -4, hipLean: -24, hipY: 0.64, bx: -0.5, by: 0.06 } },
      { f: 30, e: 'io', p: { ...stance, spinY: 360, pitch: st.pitch - 360 } },
    ],
    L,
  );

  // Heavy as a combo ender: butterfly twist. Swings low, launches into a near-horizontal aerial spin
  // (tilt) with both blades flung out as a disc, lands deep in a flare.
  const heavyChain = clip(
    stance,
    [
      { f: 3, e: 'io', p: { spinY: -30, hipY: 0.56, hipLean: -34, spine: -12, chest: -6, head: 10, headYaw: 30, twist: -16, ...m(0.02, 0.84, 0.32, 240, -10), ...s(-0.06, 0.88, -0.32, 236, 10), fx: 0.48, bx: -0.5 } },
      { f: 5, e: 'out', p: { spinY: -44, hipY: 0.5, hipLean: -40, twist: -22, ...m(-0.08, 0.86, 0.36, 244, -10), ...s(-0.12, 0.92, -0.36, 240, 10), by: 0.06, bPitch: 50 } },
      { f: 7, e: 'lin', p: { spinY: -8, tilt: -30, hipY: 0.86, hipLean: -12, spine: -2, chest: 0, head: 0, headYaw: 10, twist: 0, fx: 0.3, fy: 0.3, fPitch: 50, bx: -0.36, by: 0.42, bPitch: 50, fKnee: 0, bKnee: 10, ...prop, pitch: 366 } },
      { f: 9, e: 'snap', p: { spinY: 34, tilt: -62, hipY: 0.98, fx: 0.06, fy: 0.5, bx: -0.5, by: 0.52, headYaw: 0 } },
      { f: 11, e: 'lin', p: { spinY: 130, tilt: -66 } },
      { f: 13, e: 'snap', p: { spinY: 226, tilt: -64, fx: -0.3, fy: 0.46, bx: 0.1, by: 0.5 } },
      { f: 15, e: 'lin', p: { spinY: 320, tilt: -36, hipY: 0.8, fx: 0.24, fy: 0.2, bx: -0.2, by: 0.24 } },
      { f: 17, e: 'out', p: { spinY: 360, tilt: 0, hipY: 0.46, hipLean: -32, spine: -10, chest: -6, head: 12, fx: 0.48, fy: 0, fPitch: 0, bx: -0.52, by: 0.03, bPitch: 46, fKnee: 12, bKnee: 26, ...m(0.06, 1.42, 0.24, 176, -10), ...s(0.56, 0.74, -0.12, 310, -10), ...el(0), twist: -18 } },
      { f: 21, e: 'io', p: { hipY: 0.48, pitch: 172, pitch2: 306 } },
      { f: 25, e: 'io', p: { hipY: 0.62, hipLean: -26, ...m(0.36, 1.12, 0.24, 192, -14), ...s(0.3, 1.0, -0.2, 240, 12), twist: -4, by: 0.06 } },
      { f: 30, e: 'io', p: { ...stance, spinY: 360 } },
    ],
    { lagTorso: 0.5, lagHead: 1 },
  );

  // Crouch light 5–7: shoto flicks up from under, skimming the floor (low uppercut).
  const crLight = clip(
    crouch,
    [
      { f: 2, e: 'out', p: { twist: 12, rootX: -0.01, ...s(0.18, 0.86, -0.2, 222, 14), ...m(0.38, 0.8, 0.26, 198, -14) } },
      { f: 3, e: 'lin', p: { twist: 0, ...s(0.34, 0.66, -0.16, 268, 4) } },
      { f: 4, e: 'lin', p: { twist: -16, ...s(0.46, 0.66, -0.12, 300, -4) } },
      { f: 5, e: 'snap', p: { twist: -28, hipLean: -32, rootX: 0.05, ...s(0.52, 0.7, -0.08, 318, -6), ...m(0.32, 0.84, 0.28, 196, -14), fx: 0.56, bx: -0.56, by: 0.06, bPitch: 46 } },
      { f: 7, e: 'out', p: { ...s(0.54, 0.7, -0.08, 324, -6) } },
      { f: 9, e: 'io', p: { ...s(0.5, 0.72, -0.1, 302, -4), hipLean: -30 } },
      { f: 12, e: 'io', p: { twist: 0, hipLean: crouch.hipLean, rootX: crouch.rootX, ...s(0.3, 0.8, -0.18, 270, 12), ...m(crouch.gx, crouch.gy, crouch.gz, crouch.pitch, crouch.yaw), fx: crouch.fx, bx: crouch.bx, by: 0.05 } },
      { f: 15, e: 'io', p: { ...crouch, pitch2: crouch.pitch2 } },
    ],
    L,
  );
  // Crouch light (2nd): low reverse hook with the main round the camera side at shin height.
  const crLight2 = clip(
    crouch,
    [
      { f: 2, e: 'out', p: { twist: -16, hipYaw: -8, rootX: -0.01, ...m(0.26, 0.74, 0.3, 204, -6), ...s(0.08, 1.12, -0.2, 166, 22) } },
      { f: 3, e: 'lin', p: { twist: 0, hipYaw: 0, ...m(0.4, 0.76, 0.36, 214, -94) } },
      { f: 4, e: 'lin', p: { twist: 14, ...m(0.44, 0.8, 0.3, 222, -140) } },
      { f: 5, e: 'snap', p: { twist: 28, hipYaw: 12, hipLean: -32, rootX: 0.05, ...m(0.46, 0.82, 0.2, 226, -170), fx: 0.56, bx: -0.56, by: 0.06, bPitch: 46 } },
      { f: 7, e: 'out', p: { ...m(0.46, 0.8, 0.12, 228, -192) } },
      { f: 9, e: 'io', p: { ...m(0.44, 0.82, 0.14, 226, -186) } },
      { f: 12, e: 'io', p: { twist: 0, hipYaw: 0, hipLean: crouch.hipLean, rootX: crouch.rootX, ...m(0.46, 0.8, 0.26, 210, -90), fx: crouch.fx, bx: crouch.bx, by: 0.05 } },
      { f: 15, e: 'io', p: { ...crouch } },
    ],
    L,
  );

  // Sweep 9–13: Cossack drop, front leg out along the floor, then a full 360 on the planted back foot
  // with the leg and the main blade skimming the ankles together; pops up.
  const legOut: PosePatch = { rootX: -0.06, hipY: 0.36, hipLean: -22, bx: -0.06, bz: 0.08, by: 0, bPitch: 10, bKnee: 34, fx: 0.84, fy: 0.02, fPitch: -30, fKnee: 0 };
  const sweep = clip(
    crouch,
    [
      { f: 3, e: 'io', p: { hipY: 0.42, rootX: -0.03, fx: 0.62, fy: 0.05, fPitch: -10, bx: -0.3, bz: 0.04, bKnee: 32, hipLean: -24, ...m(0.34, 0.66, 0.36, 196, -16) } },
      { f: 6, e: 'out', p: { ...legOut, spinY: -42, twist: -12, ...m(0.06, 0.52, 0.5, 178, -4), ...s(-0.04, 1.06, -0.18, 150, 20) } },
      { f: 8, e: 'lin', p: { spinY: -16, ...m(0.08, 0.5, 0.52, 90, -4) } },
      { f: 9, e: 'snap', p: { spinY: 14, twist: 14, hipLean: -24, ...m(0.1, 0.46, 0.52, -6, 0) } },
      { f: 13, e: 'out', p: { spinY: 100, ...m(0.1, 0.46, 0.52, -10, 0) } },
      { f: 16, e: 'lin', p: { spinY: 200, ...m(0.1, 0.48, 0.52, -8, 0) } },
      { f: 20, e: 'lin', p: { spinY: 320, fx: 0.7, ...m(0.12, 0.5, 0.5, -4, 0) } },
      { f: 23, e: 'out', p: { spinY: 360, hipY: 0.4, fx: 0.56, ...m(0.3, 0.7, 0.4, 100, -6) } },
      { f: 26, e: 'io', p: { hipY: 0.58, hipLean: -22, twist: 4, fx: 0.48, fy: 0.05, fPitch: 10, bx: -0.38, bz: 0.02, by: 0.05, bPitch: 30, bKnee: 22, rootX: -0.03, ...bladesOf(stance) } },
      { f: 29, e: 'io', p: { hipY: 0.7, fx: 0.44, fy: 0, bx: -0.5, bz: 0, by: 0.04, bPitch: 36, bKnee: 16 } },
      { f: 32, e: 'io', p: { ...stance, spinY: 360 } },
    ],
    L,
  );

  // Air light 4–8: double hammer. Fists rise overhead with the blades laid back; elbows lift as both
  // fists come forward over the head, then drop as the blades chop forward-down together.
  const airLight = clip(stance, [
    { f: 0, p: { hipY: 0.95, hipLean: -6, fy: 0.28, by: 0.34, fx: 0.2, bx: -0.1, fPitch: 30, bPitch: 30, chest: 6, head: 4, ...m(0.14, 1.66, 0.18, 182, -6), ...s(0.08, 1.62, -0.16, 186, 6), ...el(0) } },
    { f: 2, e: 'out', p: { chest: 10, spine: 4, ...m(0.1, 1.7, 0.18, 186, -6), ...s(0.04, 1.66, -0.16, 190, 6) } },
    { f: 3, e: 'lin', p: { chest: 0, spine: 0, ...m(0.4, 1.52, 0.2, 96, -2), ...s(0.36, 1.5, -0.14, 100, 2), ...el(120) } },
    { f: 4, e: 'snap', p: { chest: -16, spine: -6, hipLean: -12, spin: -10, fy: 0.2, by: 0.28, ...m(0.36, 1.2, 0.22, -84, 6), ...s(0.34, 1.22, -0.16, -80, -6), ...el(0) } },
    { f: 8, e: 'out', p: { ...m(0.38, 1.14, 0.22, -92, 6), ...s(0.36, 1.16, -0.16, -88, -6) } },
    { f: 12, e: 'io', p: { ...m(0.36, 1.1, 0.24, -110, 0), ...s(0.3, 1.16, -0.18, -130, 4), spin: -4 } },
    { f: 18, e: 'io', p: { spin: 0, chest: -4, hipLean: -8, fy: 0.14, by: 0.2, ...airReady, pitch: 205 - 360, pitch2: 182 - 360 } },
    { f: 60, e: 'io', p: { fy: 0.03, by: 0.06, fx: 0.32, bx: -0.34, fPitch: 25, bPitch: 25 } },
  ]);

  // Air heavy 7–10 + 12–15: Water Wheel — forward somersault with both blades as opposite spokes
  // (main forward-down off the knees, shoto back-up); the shoto passes front-and-below first, then
  // the main, and the wheel opens toward the deck.
  const airHeavy = clip(stance, [
    { f: 0, p: { hipY: 0.95, fy: 0.3, by: 0.36, fx: 0.18, bx: -0.04, fPitch: 30, bPitch: 30, chest: -6, ...airReady, pitch: 205 - 360 } },
    // Tuck and fling the arms wide: fists out to the sides, the blades opposite spokes in the wheel plane.
    { f: 3, e: 'io', p: { spin: -20, fy: 0.42, by: 0.46, fx: 0.22, bx: 0.04, fKnee: 8, bKnee: 8, chest: -16, spine: -6, head: -14, ...m(0.16, 1.2, 0.5, -42, 0), ...s(0.12, 1.2, -0.5, 138, 0) } },
    { f: 8, e: 'lin', p: { spin: -198 } },
    { f: 13, e: 'lin', p: { spin: -376 } },
    { f: 16, e: 'out', p: { spin: -392 } },
    // The wheel opens: legs reach for the deck, arms fold back in to the ready guard.
    { f: 22, e: 'io', p: { spin: -366, fy: 0.12, by: 0.16, fx: 0.3, bx: -0.22, chest: -4, spine: -2, head: -4, ...airReady, pitch: 205 - 360 } },
    { f: 60, e: 'io', p: { spin: -360, fy: 0.03, by: 0.06, fPitch: 25, bPitch: 25 } },
  ]);

  // ----------------------------------------------------------------- throws
  // Grab: both fists on the opponent's shoulders, elbows raised, blades standing up and fanned clear.
  const grab: PosePatch = { rootX: 0.06, hipLean: -12, spine: -4, twist: 0, hipYaw: 0, head: 4, chest: 0, fx: 0.56, bx: -0.46, ...m(0.58, 1.36, 0.2, 180, -24), ...s(0.6, 1.34, -0.2, 180, 24), ...el(0) };
  const throwStart = clip(stance, [
    { f: 2, e: 'io', p: { fx: 0.54, fy: 0.05, fPitch: 18, rootX: 0.03 } },
    { f: 3, e: 'snap', p: { ...grab, fy: 0 } },
    { f: 6, e: 'io', p: { rootX: 0.08 } },
    // Whiff: the grab closes on air, she pulls the blades back in and resets.
    { f: 12, e: 'io', p: { rootX: 0.04, hipLean: -18, ...m(0.42, 1.14, 0.24, 186, -14), ...s(0.26, 1.24, -0.22, 188, 18), ...el(0), bx: -0.5, by: 0.05 } },
    { f: 18, e: 'io', p: { ...bladesOf(st), hipLean: -24 } },
    { f: 26, e: 'io', p: { ...stance } },
  ]);

  // Side-switch throw (sim: vault arc f11–18 carries her over the victim, release f24, total 40).
  // Grapple the shoulders, sink, handspring into a tucked front flip over their head, land facing
  // away, then a blind reverse-grip double stab back past her hips and a mule kick that launches
  // them the way she came (Ahsoka's backward stabs). She ends facing away; the game's turnaround
  // brings her round.
  const throwing = (() => {
    const tuck = (hipY: number): PosePatch => ({ fx: 0.24, fy: hipY - 0.44, bx: 0.06, by: hipY - 0.4, fKnee: 10, bKnee: 10, fPitch: 45, bPitch: 45 });
    const tucked = (hipY: number): PosePatch => ({ ...m(0.24, hipY + 0.36, 0.24, 200, -10), ...s(0.2, hipY + 0.4, -0.22, 196, 10), ...el(0) });
    const p0 = makePose(stance, grab);
    return clip(
      stance,
      [
        { f: 0, p: p0 },
        { f: 3, e: 'out', p: { rootX: 0.1, ...m(0.7, 1.4, 0.2, 180, -24), ...s(0.72, 1.38, -0.2, 180, 24) } },
        // Sink, pulling down on their shoulders; eyes up over their head (anticipation).
        { f: 7, e: 'io', p: { rootX: 0.09, hipY: 0.56, hipLean: -22, spine: -6, chest: -4, head: 12, fx: 0.44, bx: -0.38, by: 0.03, bPitch: 44, fKnee: 12, bKnee: 16 } },
        { f: 10, e: 'io', p: { rootX: 0.08, hipY: 0.48, hipLean: -28, spine: -8, chest: -6, head: 18, fKnee: 16, bKnee: 20, ...m(0.7, 1.28, 0.2, 184, -24), ...s(0.72, 1.26, -0.2, 184, 24) } },
        { f: 11, e: 'in', p: { hipY: 0.46, head: 20 } },
        // Handspring: arms straight down onto the shoulders, body stretched, legs whipping up behind.
        { f: 12, e: 'snap', p: { spin: -40, rootX: 0.1, hipY: 0.92, hipLean: -6, spine: 0, chest: -4, head: -8, fx: 0.06, fy: 0.12, bx: -0.3, by: 0.3, fPitch: 50, bPitch: 50, fKnee: 4, bKnee: 4, ...m(0.5, 1.32, 0.2, 190, -30), ...s(0.52, 1.3, -0.2, 190, 30) } },
        { f: 13, e: 'lin', p: { spin: -96, rootX: 0.07, hipY: 0.94, chest: -10, head: -14, fx: 0.16, fy: 0.3, bx: -0.08, by: 0.38, fKnee: 8, bKnee: 8, ...m(0.38, 1.28, 0.22, 190, -14), ...s(0.36, 1.3, -0.22, 190, 14), ...el(0) } },
        // Tucked front flip over their head.
        { f: 14, e: 'lin', p: { spin: -150, rootX: 0.04, hipY: 0.9, hipLean: -10, chest: -14, head: -20, ...tuck(0.9), ...tucked(0.9) } },
        { f: 16, e: 'lin', p: { spin: -270, hipLean: -8, chest: -12, head: -14 } },
        // Opening up to land.
        { f: 17, e: 'out', p: { spin: -330, rootX: 0, hipY: 0.84, chest: -4, head: 0, fx: 0.38, fy: 0.12, bx: -0.36, by: 0.14, fKnee: 8, bKnee: 14, fPitch: 30, bPitch: 30, ...m(0.4, 1.2, 0.24, 196, -14), ...s(0.16, 1.4, -0.18, 166, 18) } },
        // Land low, back to the victim, head turned back over the near shoulder.
        { f: 18, e: 'snap', p: { spin: -360, hipY: 0.48, hipLean: -28, spine: -8, chest: -6, head: 6, headYaw: 30, fx: 0.42, fy: 0, bx: -0.44, by: 0.03, fPitch: 0, bPitch: 40, fKnee: 12, bKnee: 18, ...m(0.42, 0.92, 0.26, 200, -14), ...s(0.12, 1.12, -0.2, 170, 18) } },
        { f: 20, e: 'out', p: { hipY: 0.52, head: 10, headYaw: 55 } },
        // Fists pulled forward: the anticipation for the blind backward stab.
        { f: 22, e: 'in', p: { hipY: 0.56, hipLean: -20, chest: 0, ...m(0.52, 1.02, 0.28, 186, -12), ...s(0.5, 1.06, -0.22, 186, 12) } },
        // Double reverse-grip stab back past her hips into the victim (who has turned to face her).
        { f: 23, e: 'lin', p: { hipLean: -24, ...m(0.18, 0.88, 0.32, 176, -8), ...s(0.16, 0.9, -0.3, 176, 8) } },
        // Release: blades buried, rear leg mule-kicks them away; torso pitches forward over the kick.
        { f: 24, e: 'snap', p: { hipY: 0.66, hipLean: -46, spine: -10, chest: -4, head: 18, headYaw: 40, fx: 0.46, bx: -0.8, by: 0.52, bPitch: 10, bKnee: 2, ...m(0.46, 0.66, 0.34, 174, -6), ...s(0.44, 0.68, -0.32, 174, 6) } },
        { f: 28, e: 'out', p: { by: 0.46, bx: -0.82, hipLean: -48 } },
        // Rip the blades out forward; the kicking leg folds back under her.
        { f: 32, e: 'io', p: { hipY: 0.58, hipLean: -28, spine: -8, chest: -6, head: 6, headYaw: 20, bx: -0.46, by: 0.08, bPitch: 36, bKnee: 16, ...m(0.36, 1.0, 0.24, 196, -14), ...s(0.16, 1.2, -0.2, 196, 18) } },
        { f: 36, e: 'io', p: { ...stance, spin: -360, headYaw: 8 } },
        { f: 40, e: 'io', p: { ...stance, spin: -360 } },
      ],
      { lagTorso: 0.5, lagHead: 1 },
    );
  })();

  // ----------------------------------------------------------------- Ataru leap (special)
  // Crouch wings → launch → tight forward tuck flip → arched open at the apex → double ice-pick drive
  // → three-point landing with the blades crossed low → spring up. Ref: Yoda (AOTC), Obi-Wan's leap (TPM).
  const special = clip(
    stance,
    [
      { f: 3, e: 'io', p: { hipY: 0.56, hipLean: -28, chest: -6, head: 10, ...m(0.3, 0.98, 0.26, 190, -12), ...s(0.04, 1.18, -0.22, 172, 20) } },
      { f: 6, e: 'out', p: { hipY: 0.48, hipLean: -32, spine: -12, chest: -8, head: 14, fx: 0.4, bx: -0.5, bPitch: 44, ...m(0.12, 0.96, 0.3, 184, -12), ...s(0.0, 1.0, -0.26, 188, 20) } },
      { f: 7, e: 'snap', p: { hipY: 0.95, spin: -20, hipLean: -10, spine: -2, chest: -2, head: 6, fx: 0.16, bx: -0.2, fy: 0, by: 0, fPitch: 50, bPitch: 50, ...m(0.3, 1.3, 0.22, 200, -8), ...s(0.2, 1.3, -0.2, 196, 10) } },
      { f: 9, e: 'io', p: { spin: -70, fy: 0.42, by: 0.46, fx: 0.24, bx: 0.08, fKnee: 8, bKnee: 8, chest: -18, spine: -6, head: -14, ...m(0.26, 1.1, 0.22, 205, -8), ...s(0.22, 1.12, -0.22, 205, 8) } },
      { f: 13, e: 'lin', p: { spin: -200 } },
      { f: 17, e: 'lin', p: { spin: -320 } },
      // Apex: open and arched like a drawn bow, both fists overhead, blades hanging back behind the head.
      { f: 19, e: 'out', p: { spin: -360, hipLean: 10, spine: 10, chest: 20, head: 8, fx: 0.06, fy: 0.24, bx: -0.3, by: 0.32, fKnee: 4, bKnee: 4, ...m(0.18, 1.9, 0.18, 200, -6), ...s(0.08, 1.86, -0.18, 204, 6) } },
      { f: 21, e: 'out', p: { chest: 24, spine: 12, ...m(0.1, 1.96, 0.18, 206, -6), ...s(0.02, 1.92, -0.18, 210, 6) } },
      // Contact: crunch over the drive — knees up, fists forward at chest height, blades driven straight down.
      { f: 22, e: 'snap', p: { hipLean: -40, spine: -14, chest: -24, head: -28, fx: 0.34, fy: 0.3, bx: 0.02, by: 0.36, ...m(0.58, 1.04, 0.24, 278, -4), ...s(0.54, 1.08, -0.18, 282, 4) } },
      { f: 26, e: 'out', p: { ...m(0.6, 0.94, 0.24, 274, -4), ...s(0.56, 0.98, -0.18, 278, 4), fy: 0.14, by: 0.2, fx: 0.38, bx: -0.2, head: -18 } },
      { f: 29, e: 'in', p: { fy: 0.02, by: 0.04, fx: 0.4, bx: -0.32, fPitch: 30, bPitch: 30, hipY: 0.8 } },
      // Three-point landing, blades crossed low in an X. Moving hold.
      { f: 30, e: 'out', p: { spin: -360, hipY: 0.4, hipLean: -32, spine: -8, chest: -6, head: 10, fx: 0.42, fy: 0, fPitch: 0, bx: -0.4, by: 0, bPitch: 50, bKnee: 34, fKnee: 10, ...m(0.3, 0.6, 0.3, 250, 6), ...s(0.58, 0.52, -0.14, 226, 8) } },
      { f: 34, e: 'io', p: { hipY: 0.42, head: 12 } },
      { f: 38, e: 'io', p: { hipY: 0.66, hipLean: -22, ...m(0.42, 0.96, 0.24, 226, -12), ...s(0.2, 1.06, -0.2, 204, 16) } },
      { f: 44, e: 'io', p: { ...stance, spin: -360 } },
    ],
    L,
  );

  // ----------------------------------------------------------------- Twin Tempest (super)
  // Charge: low iaido coil, both blades laid back along the forearms like drawn sheaths, head down.
  const coil: PosePatch = { rootX: -0.06, hipY: 0.45, hipLean: -54, spine: -16, chest: -10, twist: 0, hipYaw: 0, head: -20, fx: 0.52, fKnee: 10, bx: -0.6, by: 0.02, bPitch: 45, bKnee: 30, ...m(0.18, 0.8, 0.28, 178, -10), ...s(0.12, 0.84, -0.24, 180, 12), ...el(0) };
  const superCharge = clip(stance, [
    { f: 4, e: 'io', p: { hipY: 0.56, hipLean: -40, head: -6, ...m(0.3, 0.88, 0.28, 190, -10), ...s(0.08, 1.0, -0.24, 176, 14) } },
    { f: 8, e: 'out', p: coil },
    { f: 16, e: 'io', p: { pitch: 180, pitch2: 178, hipY: 0.44 } },
    { f: 24, e: 'io', p: { pitch: 177, pitch2: 181 } },
    { f: 32, e: 'io', p: { pitch: 179, pitch2: 179, hipY: 0.43 } },
    { f: 36, e: 'snap', p: { head: 4 } },
    { f: 42, e: 'io', p: { head: 2 } },
  ]);
  // Thunderclap and Flash: explode out of the coil, three whirlwind spins THROUGH the opponent (arms
  // out, blades a propeller), skid into a frozen low lunge with her back to them — main hanging
  // straight down off the extended fist, shoto standing up behind — hold in silence while the
  // delayed cuts detonate behind her (f32–35), chiburi flick, rise. The game's turnaround brings her
  // round afterwards.
  const lunge: PosePatch = { rootX: 0.0, hipY: 0.4, hipLean: -36, spine: -8, chest: -4, twist: 10, hipYaw: 0, head: -12, headYaw: 0, fx: 0.62, fy: 0, fKnee: 12, fPitch: 0, bx: -0.78, by: 0, bPitch: 45, bKnee: 10, ...m(0.72, 0.98, 0.28, -92, -6), ...s(-0.24, 0.92, -0.28, 435, 20), ...el(0) };
  const superMove = clip(
    stance,
    [
      { f: 0, p: coil },
      { f: 5, e: 'io', p: { hipY: 0.42, hipLean: -58, head: -10 } },
      { f: 8, e: 'snap', p: { hipY: 0.56, hipLean: -70, spine: -16, chest: -8, head: 20, bx: -0.82, by: 0.04, bPitch: 60, fx: 0.36, fy: 0.12 } },
      { f: 9, e: 'out', p: { hipY: 0.66, hipLean: -32, spine: -8, chest: -4, head: 10, fx: 0.22, fy: 0.2, bx: -0.24, by: 0.28, fPitch: 40, bPitch: 40, fKnee: 6, bKnee: 6, ...prop } },
      { f: 13, e: 'lin', p: { spinY: 360 } },
      { f: 17, e: 'lin', p: { spinY: 720 } },
      { f: 21, e: 'lin', p: { spinY: 1080 } },
      { f: 23, e: 'io', p: { spinY: 1080 + 40, hipY: 0.5, fx: 0.5, fy: 0.04, bx: -0.6, by: 0.08, ...m(0.5, 1.0, 0.36, -130, -30), ...s(-0.12, 0.96, -0.38, 330, 30) } },
      { f: 25, e: 'out', p: { ...lunge, spinY: 1080, rootX: 0.08 } },
      { f: 27, e: 'out', p: { rootX: 0 } },
      { f: 37, e: 'io', p: { hipY: 0.39, pitch: -90, pitch2: 437 } },
      // Chiburi: a sharp outward flick of both blades, as if shaking them clean.
      { f: 40, e: 'snap', p: { pitch: -60, pitch2: 418, gy: 0.92, g2y: 0.98 } },
      { f: 44, e: 'out', p: { pitch: -64, pitch2: 422 } },
      { f: 48, e: 'io', p: { hipY: 0.56, hipLean: -30, ...m(0.48, 0.98, 0.26, -120, -14), ...s(-0.04, 1.06, -0.26, 200, 20), headYaw: 30 } },
      { f: 54, e: 'io', p: { ...stance, spinY: 1080, headYaw: 30, pitch: st.pitch - 360 } },
    ],
    { lagTorso: 0.5, lagHead: 1 },
  );

  // ----------------------------------------------------------------- parry set
  const P_X: PosePatch = { rootX: -0.02, hipY: 0.64, hipLean: -12, spine: -4, chest: 0, twist: 0, hipYaw: 0, head: 2, ...X_GUARD };
  const parry = clip(
    stance,
    [
      { f: 1, e: 'snap', p: P_X },
      { f: 3, e: 'io', p: { hipY: 0.63, pitch: 83, pitch2: 99 } },
      { f: 5, e: 'io', p: { hipY: 0.645, pitch: 77, pitch2: 105 } },
      { f: 7, e: 'io', p: { hipY: 0.635, pitch: 82, pitch2: 100 } },
      { f: 9, e: 'io', p: { hipY: 0.64, pitch: 80, pitch2: 102 } },
      // Whiff: the X sags and drifts apart, head tilting, then back to stance.
      { f: 16, e: 'io', p: { gy: 1.14, g2y: 1.12, pitch: 96, pitch2: 116, head: 6, headRoll: 8, chest: -2, ...el(90) } },
      { f: 22, e: 'io', p: { ...bladesOf(st), ...s(0.3, 1.12, -0.32, 170, 24), hipLean: -22, headRoll: 2 } },
      { f: 28, e: 'io', p: { ...stance } },
    ],
    { lagTorso: 0.3, lagHead: 1 },
  );
  const parrySuccess = clip(stance, [
    { f: 0, p: P_X },
    { f: 3, e: 'snap', p: { rootX: 0.02, hipY: 0.68, chest: 6, ...m(0.54, 1.3, 0.12, 82, 10), ...s(0.6, 1.28, -0.04, 100, -10) } },
    { f: 6, e: 'hold', p: { pitch: 83 } },
    // Wrists roll out: the X splits, main thrown forward-down round the camera side, shoto back.
    { f: 8, e: 'lin', p: { twist: -14, ...m(0.54, 1.2, 0.32, 30, -50), ...s(0.4, 1.3, -0.22, 150, 12), ...el(70) } },
    { f: 9, e: 'snap', p: { spinY: -30, twist: -30, hipYaw: -10, chest: -4, hipLean: -18, ...m(0.48, 1.14, 0.26, -24, 10), ...s(0.16, 1.3, -0.22, 188, 16), ...el(0) } },
    { f: 11, e: 'io', p: { spinY: -20, ...m(0.46, 1.1, 0.24, -40, 6) } },
    { f: 14, e: 'io', p: { ...stance, pitch: st.pitch - 360 } },
  ]);
  // Being parried: spread-eagle spin-out (main flung up-back, shoto flung low-back), two stumbling hops.
  const parried = clip(stance, [
    { f: 2, e: 'snap', p: { spinY: 45, chest: 20, spine: 8, head: 24, hipLean: 12, rootX: -0.08, fy: 0.08, fPitch: 20, ...m(-0.04, 1.7, 0.3, 176, -10), ...s(-0.26, 0.76, -0.32, 236, 20) } },
    { f: 7, e: 'out', p: { spinY: 78, headYaw: -24, rootX: -0.12, hipY: 0.78, fx: st.fx - 0.08, fy: 0.12, bx: st.bx - 0.06, by: 0.12, ...m(-0.06, 1.74, 0.32, 172, -14), ...s(-0.3, 0.86, -0.36, 236, 24) } },
    { f: 11, e: 'in', p: { hipY: 0.6, fy: 0, by: 0.03, fPitch: 6, chest: 12, head: 14, gy: 1.62, gx: -0.02 } },
    { f: 16, e: 'out', p: { spinY: 55, hipY: 0.72, fy: 0.1, by: 0.08, ...m(0.12, 1.5, 0.3, 186, -14), ...s(-0.16, 1.16, -0.3, 214, 24), chest: 8 } },
    { f: 20, e: 'in', p: { spinY: 25, hipY: 0.62, fy: 0, by: 0.04, chest: 2, head: 6, headYaw: -8 } },
    { f: 28, e: 'io', p: { ...stance } },
  ]);

  // ----------------------------------------------------------------- kip-up
  // Roll back onto the shoulders with the knees to the chest and the fists by the ears, explode up
  // (legs whip down) into a crouch with the blades re-flared, bounce into stance.
  const getup = clip(
    stance,
    [
      { f: 0, p: { ...lying } },
      { f: 3, e: 'io', p: { spin: 100, hipY: 0.22, rootX: -0.16, fx: 0.06, fy: -0.06, bx: -0.04, by: -0.04, fKnee: 8, bKnee: 8, fPitch: 30, bPitch: 30, chest: -14, spine: -6, head: -14, ...m(0.02, 0.92, 0.3, -180, -10), ...s(-0.02, 0.94, -0.3, -180, 10), ...el(0) } },
      { f: 5, e: 'in', p: { spin: 124, hipY: 0.28, rootX: -0.2, fx: 0.0, fy: 0.02, bx: -0.08, by: 0.04 } },
      { f: 7, e: 'snap', p: { spin: 40, hipY: 0.66, rootX: -0.1, fx: 0.26, fy: 0.14, bx: -0.24, by: 0.16, fKnee: 6, bKnee: 10, chest: -6, spine: -4, head: 8, ...m(0.16, 1.06, 0.3, -164, -12), ...s(0.0, 1.16, -0.26, -184, 16) } },
      { f: 10, e: 'out', p: { spin: 0, hipY: 0.46, rootX: -0.04, fx: 0.46, fy: 0, fPitch: 0, bx: -0.5, by: 0.03, bPitch: 40, fKnee: 10, bKnee: 26, hipLean: -28, spine: -8, chest: -4, head: 6, headYaw: 0, ...m(0.3, 0.92, 0.3, -160, -40), ...s(0.06, 1.2, -0.22, -204, 22) } },
      { f: 14, e: 'io', p: { hipY: 0.72, hipLean: -20, ...bladesOf(st), pitch: st.pitch - 360, pitch2: st.pitch2 - 360 } },
      { f: 18, e: 'io', p: { ...stance, pitch: st.pitch - 360, pitch2: st.pitch2 - 360 } },
    ],
    { lagTorso: 0.6, lagHead: 1.2 },
  );

  // ----------------------------------------------------------------- intro / victory
  const intro = (() => {
    const off: PosePatch = { blade: 0, blade2: 0 };
    const tuckAir = (rootX: number, hipY: number, spin: number): Pose =>
      shift(makePose(stance, { spin, hipY: 0, hipLean: 0, spine: 0, chest: 6, head: 6, twist: 0, hipYaw: 0, fx: 0.18, fy: -0.5, bx: 0.06, by: -0.46, fPitch: 40, bPitch: 40, fKnee: 8, bKnee: 8, ...m(0.2, 0.32, 0.22, 200, -10), ...s(0.14, 0.36, -0.22, 200, 10), ...off }), rootX, hipY);
    const landed = makePose(stance, { ...threePoint, ...off });
    return clip(
      stance,
      [
        { f: 0, p: tuckAir(1.2, 2.2, 40) },
        { f: 6, e: 'lin', p: tuckAir(0.9, 2.5, 130) },
        { f: 12, e: 'lin', p: tuckAir(0.5, 2.1, 240) },
        { f: 17, e: 'lin', p: { ...tuckAir(0.14, 1.2, 340), fy: 1.2 - 0.82, by: 1.2 - 0.82, fx: 0.4, bx: -0.1 } },
        { f: 20, e: 'out', p: { ...landed, spin: 360 } },
        { f: 23, e: 'io', p: { hipY: 0.44 } },
        // Ignition: main snaps on swept back low, shoto flicks out forward off the planted fist.
        { f: 25, e: 'snap', p: { blade: 1, blade2: 1, ...m(-0.02, 0.98, 0.32, 214, -22), ...s(0.5, 0.12, -0.22, 58, -16) } },
        { f: 30, e: 'out', p: { hipY: 0.46, head: 12 } },
        { f: 36, e: 'io', p: { hipY: 0.54, ...m(0.3, 1.0, 0.28, 250, -6), ...s(0.42, 0.9, -0.12, 74, -10), ...el(0, 60) } },
        { f: 42, e: 'io', p: { ...guard, pitch: guard.pitch + 360, spin: 360, hipY: 0.62 } },
        { f: 52, e: 'io', p: { hipY: 0.64, head: 0 } },
        { f: 58, e: 'io', p: { hipY: 0.66, hipLean: -20, ...m(0.48, 1.04, 0.26, 250, -6), ...s(0.3, 1.1, -0.32, 180, 20), ...el(0) } },
        { f: 64, e: 'io', p: { ...stance, spin: 360 } },
        { f: 72, e: 'io', p: { hipY: st.hipY } },
      ],
      { lagTorso: 1, lagHead: 2 },
    );
  })();

  // Twirls both hilts (two full rolls), blades off, hilts to the hips, head tilt and a little bounce.
  const victory = clip(stance, [
    { f: 6, e: 'out', p: { hipY: 0.82, hipLean: -4, spine: 0, chest: 2, twist: 0, hipYaw: 0, head: 4, fx: 0.24, bx: -0.26, by: 0, bPitch: 10, bKnee: 6, fKnee: 4, ...m(0.26, 1.06, 0.4, 200, -20), ...s(0.14, 1.06, -0.4, 162, 20) } },
    { f: 26, e: 'io', p: { pitch: 200 - 720, pitch2: 162 + 720 } },
    { f: 28, e: 'io', p: { pitch: 205 - 720, pitch2: 158 + 720 } },
    { f: 33, e: 'lin', p: { blade: 0, blade2: 0 } },
    { f: 42, e: 'io', p: { hipY: 0.86, hipRoll: 6, headRoll: 10, head: 10, ...m(0.08, 0.92, 0.26, 250 - 720, -20), ...s(0.02, 0.92, -0.26, 250 + 720 - 360, 20) } },
    { f: 47, e: 'out', p: { hipY: 0.82 } },
    { f: 52, e: 'out', p: { hipY: 0.86 } },
    { f: 60, e: 'io' },
  ]);

  // ----------------------------------------------------------------- reaction overrides
  const R = (keys: KeySpec[], base = stance, lagTorso = 0.6, lagHead = 1.2) => clip(base, keys, { lagTorso, lagHead });
  // Flinch arms: fists jerk in front of the face with the elbows up, blades laid back.
  const FLINCH: PosePatch = { ...m(0.3, 1.36, 0.26, 176, -14), ...s(0.2, 1.42, -0.24, 172, 14), ...el(40) };

  // Counter-hit stagger: full spin-out pirouette with stumbling feet.
  const stagger = R([
    { f: 3, e: 'snap', p: { spinY: 60, twist: -40, chest: 12, head: 16, headYaw: -30, rootX: -0.08, ...m(0.04, 1.62, 0.4, 176, -10), ...s(-0.28, 1.0, -0.4, 250, 20) } },
    { f: 10, e: 'out', p: { spinY: 190, hipY: 0.72, fy: 0.06, rootX: -0.14 } },
    { f: 17, e: 'in', p: { spinY: 300, fy: 0, by: 0.08, hipY: 0.64, chest: 6, head: 6 } },
    { f: 24, e: 'out', p: { spinY: 360, by: 0.02, rootX: -0.2, twist: -10, headYaw: 0, ...bladesOf(st) } },
    { f: 32, e: 'io', p: { ...stance, spinY: 360 } },
  ]);
  // Light hits: more rotation, less hip drop (light body, amp 1.25). Blades flinch along their own
  // reverse-grip line so they never swing forward into the attacker.
  const hitHigh = R([
    { f: 2, e: 'snap', p: { spinY: 18, head: st.head + 32, headYaw: -14, chest: st.chest + 10, hipLean: st.hipLean + 8, rootX: -0.06, ...m(st.gx - 0.06, st.gy + 0.1, st.gz, 186, -14), ...s(0.0, 1.5, -0.12, 150, 20) } },
    { f: 6, e: 'out', p: { spinY: 12, head: st.head + 22, chest: st.chest + 7, rootX: -0.08 } },
    { f: 20, e: 'in', reset: true },
  ]);
  // Alternate high hit: head snaps the other way (toward the camera), the body corkscrews the other
  // way, both fists jerk up to shield the face.
  const hitHigh2 = R([
    { f: 2, e: 'snap', p: { spinY: -20, head: st.head + 26, headYaw: 18, headRoll: -10, chest: st.chest + 8, chestRoll: -6, twist: st.twist + 14, hipLean: st.hipLean + 7, rootX: -0.06, ...FLINCH } },
    { f: 6, e: 'out', p: { spinY: -14, head: st.head + 18, headRoll: -6, rootX: -0.08 } },
    { f: 20, e: 'in', reset: true },
  ]);
  const hitBody = R([
    { f: 2, e: 'snap', p: { spinY: -14, chest: st.chest - 22, spine: st.spine - 12, hipLean: st.hipLean + 10, head: st.head - 12, hipY: st.hipY - 0.04, rootX: -0.08, ...m(0.3, 0.9, 0.3, 222, -14), ...s(0.2, 1.06, -0.22, 196, 18) } },
    { f: 6, e: 'out', p: { spinY: -10, chest: st.chest - 18, rootX: -0.1 } },
    { f: 20, e: 'in', reset: true },
  ]);
  // Alternate body hit: folds sideways and twists open the other way; the main arm swings wide.
  const hitBody2 = R([
    { f: 2, e: 'snap', p: { spinY: 22, chest: st.chest - 16, chestRoll: 8, spine: st.spine - 8, twist: st.twist - 20, hipYaw: st.hipYaw - 10, hipLean: st.hipLean + 8, head: st.head - 8, headYaw: -12, hipY: st.hipY - 0.05, rootX: -0.08, ...m(0.24, 1.2, 0.46, 186, -20), ...s(0.16, 1.02, -0.24, 200, 16) } },
    { f: 6, e: 'out', p: { spinY: 16, chest: st.chest - 12, rootX: -0.1 } },
    { f: 20, e: 'in', reset: true },
  ]);
  const hitLow = R([
    { f: 2, e: 'snap', p: { spinY: -10, fx: st.fx - 0.12, fy: 0.08, fPitch: 20, hipRoll: 7, hipY: st.hipY - 0.06, chest: st.chest - 10, head: st.head - 6, rootX: -0.05, ...m(0.36, 1.12, 0.3, 196, -14), ...s(-0.18, 1.3, -0.26, 236, 20) } },
    { f: 6, e: 'out', p: { fy: 0.02, hipY: st.hipY - 0.05 } },
    { f: 20, e: 'in', reset: true },
  ]);
  const hitLowHeavy = R([
    { f: 2, e: 'snap', p: { spinY: -20, hipY: 0.54, fx: st.fx - 0.04, fKnee: 12, bKnee: 22, chest: st.chest - 20, hipLean: st.hipLean - 6, head: st.head - 14, rootX: -0.12, ...m(0.52, 0.7, 0.3, 236, -10), ...s(-0.2, 1.24, -0.24, 236, 20) } },
    { f: 10, e: 'out', p: { hipY: 0.52, spinY: -14 } },
    { f: 26, e: 'in', reset: true },
  ]);
  // Heavy hits twist her away (half spin-out) on top of the shared reaction shapes.
  const hitHighHeavy = R([
    { f: 2, e: 'snap', p: { spinY: 35, head: st.head + 45, headYaw: -14, chest: st.chest + 24, spine: st.spine + 14, hipLean: st.hipLean + 16, hipY: st.hipY - 0.02, rootX: -0.12, fy: 0.05, fPitch: 20, ...m(0.02, 1.62, 0.3, 176, -10), ...s(-0.36, 1.1, -0.24, 236, 20) } },
    { f: 8, e: 'out', p: { spinY: 55, head: st.head + 32, chest: st.chest + 16, bx: st.bx - 0.2, by: 0.06, fy: 0, fPitch: 0, rootX: -0.18 } },
    { f: 16, e: 'io', p: { spinY: 20, head: st.head + 12, chest: st.chest + 6, hipLean: st.hipLean + 6, by: 0.04 } },
    { f: 26, e: 'in', reset: true },
  ]);
  const hitBodyHeavy = R([
    { f: 2, e: 'snap', p: { spinY: -25, chest: st.chest - 34, spine: st.spine - 18, hipLean: st.hipLean + 20, head: st.head - 18, hipY: st.hipY - 0.1, rootX: -0.14, fPitch: 15, bPitch: 40, ...m(0.26, 0.84, 0.32, 232, -10), ...s(0.24, 1.0, -0.3, 214, 20) } },
    { f: 9, e: 'out', p: { spinY: -40, chest: st.chest - 38, rootX: -0.2, hipY: st.hipY - 0.12 } },
    { f: 18, e: 'io', p: { spinY: -10, chest: st.chest - 10, head: st.head + 12, hipY: st.hipY - 0.04, fPitch: st.fPitch } },
    { f: 26, e: 'in', reset: true },
  ]);
  const clash = R([
    { f: 0, p: { rootX: 0.08, twist: st.twist + 10, hipLean: st.hipLean + 10, chest: st.chest - 2, head: st.head + 8, fx: st.fx + 0.12, ...X_GUARD, gy: 1.12, g2y: 1.1, gx: 0.54, g2x: 0.6 } },
    { f: 4, e: 'hold', p: { pitch: 82 } },
    { f: 8, e: 'out', p: { rootX: -0.12, ...m(0.24, 1.5, 0.26, 182, -10), ...s(0.2, 1.46, -0.22, 186, 10), ...el(0), hipLean: st.hipLean + 14, chest: st.chest + 10, head: st.head + 12, fx: st.fx - 0.02, bx: st.bx - 0.12, by: 0.06 } },
    { f: 18, e: 'io', reset: true },
  ]);
  // Electrocuted (Vexa's lightning, timed by the caster's frame): arched back, fists clenched at the
  // chest with the blades jittering out to the sides, knees buckling, 2-frame tremor.
  const shock: KeySpec[] = [
    { f: 0, p: {} },
    { f: 13, e: 'snap', p: { chest: st.chest + 28, spine: st.spine + 12, hipLean: st.hipLean + 14, head: st.head + 34, headRoll: 8, hipY: st.hipY - 0.04, rootX: -0.06, ...m(0.24, 1.22, 0.4, 186, -40), ...s(0.16, 1.26, -0.4, 186, 40), ...el(30), fKnee: 14, bKnee: 14 } },
  ];
  for (let f = 15, k = 0; f <= 57; f += 2, k += 1) {
    const u = (f - 13) / 45;
    const j = k % 2 === 0 ? 1 : -1;
    shock.push({
      f,
      e: 'lin',
      p: {
        hipY: st.hipY - 0.04 - 0.18 * u,
        chest: st.chest + 28 + 4 * j,
        head: st.head + 34 + 5 * j,
        headRoll: 8 * j,
        hipLean: st.hipLean + 14 - 6 * u,
        gy: 1.22 - 0.16 * u + 0.02 * j,
        g2y: 1.26 - 0.16 * u - 0.02 * j,
        pitch: 186 + 6 * j,
        pitch2: 186 - 6 * j,
        fKnee: 14 + 10 * u,
        bKnee: 14 + 10 * u,
      },
    });
  }
  shock.push({ f: 62, e: 'out', p: { chest: st.chest + 34, head: st.head + 40, hipY: st.hipY - 0.2, rootX: -0.12 } });
  const shocked = R(shock, stance, 0.3, 0.6);

  // Force-gripped (Vexa): hands at the throat — the shoto turned out and away so it never runs down
  // through her own body; feet kick.
  const kick = (f: number, k: number): KeySpec => ({ f, e: 'io', p: { fx: 0.12 * k, bx: -0.12 * k, fy: 0.05 + 0.04 * k, by: 0.05 - 0.04 * k } });
  const gripVictim = R([
    { f: 6, e: 'snap', p: { head: st.head + 26, chest: st.chest + 10, hipLean: 4, spine: 2, twist: 0, hipYaw: 0, ...m(0.16, 1.44, 0.3, 180, -40), ...s(0.16, 1.48, -0.26, 180, 40), ...el(20), hipY: 0.94, fx: 0.08, bx: -0.08, fPitch: 50, bPitch: 50, fKnee: 6, bKnee: 6 } },
    kick(12, 1),
    kick(18, -1),
    kick(24, 1),
    kick(30, -1),
    kick(36, 1),
    kick(42, -1),
    { f: 46, e: 'io', p: { fx: 0.05, bx: -0.05, head: st.head + 32 } },
  ]);
  // Thrown (generic throws): doubled over the grab, arms drawn in with the blades laid back.
  const thrownVictim = R([
    { f: 3, e: 'snap', p: { chest: st.chest - 20, spine: st.spine - 10, head: st.head - 12, hipY: st.hipY - 0.06, rootX: 0.03, ...m(0.28, 1.0, 0.3, 214, -14), ...s(0.2, 1.08, -0.28, 206, 14) } },
    { f: 12, e: 'io', p: { rootX: 0.07, chest: st.chest - 24 } },
    { f: 20, e: 'io', p: { rootX: 0.05 } },
  ]);

  // ----------------------------------------------------------------- falls (frames since launch)
  // Arms flung out to the sides with the blades along the body's x axis: as she tumbles they draw rings.
  const WIDE: PosePatch = { ...m(0.06, 1.3, 0.5, 170, 0), ...s(0.0, 1.3, -0.5, 10, 0), ...el(0) };
  const fallBlowback = R(
    [
      { f: 0, p: { hipLean: st.hipLean + 24, head: st.head + 35, chest: st.chest + 14, spin: 10, ...m(0.12, 1.66, 0.3, 176, -10), ...s(0.04, 1.6, -0.3, 196, 10), fx: st.fx + 0.08, fy: 0.08 } },
      { f: 6, e: 'out', p: { spin: 60, fx: 0.45, fy: 0.3, bx: 0.2, by: 0.16, hipY: 0.95, ...WIDE } },
      { f: 12, e: 'lin', p: { spin: 170, fx: 0.2, fy: 0.45, bx: 0.0, by: 0.5, fKnee: 8, bKnee: 8 } },
      { f: 18, e: 'lin', p: { spin: 300, fx: 0.25, fy: 0.4, bx: 0.1, by: 0.42 } },
      { f: 25, e: 'out', p: { spin: 440, fx: 0.45, fy: 0.22, bx: 0.25, by: 0.16, hipLean: 4, head: 20, ...m(0.04, 1.2, 0.5, 270, 0), ...s(0.0, 1.2, -0.5, -90, 0) } },
      { f: 36, e: 'io', p: { spin: 452, fy: 0.08, by: 0.06 } },
    ],
    stance,
    1,
    2,
  );
  const fallSweep = R(
    [
      { f: 0, p: { spin: 25, fx: 0.45, fy: 0.35, bx: 0.25, by: 0.3, head: st.head + 10, ...WIDE } },
      { f: 8, e: 'out', p: { spin: 70, fx: 0.5, fy: 0.3 } },
      { f: 16, e: 'in', p: { spin: 92, fy: 0.2, by: 0.18, ...m(0.04, 1.2, 0.5, 270, 0), ...s(0.0, 1.2, -0.5, -90, 0) } },
      { f: 30, e: 'io', p: { spin: 95, fy: 0.05, by: 0.05 } },
    ],
    stance,
    1,
    2,
  );
  const fallSpin = R(
    [
      { f: 0, p: { spin: 20, hipLean: st.hipLean + 15, head: st.head + 30, ...WIDE } },
      { f: 7, e: 'lin', p: { spin: 110, fx: 0.15, fy: 0.45, bx: -0.05, by: 0.5, hipY: 0.95 } },
      { f: 15, e: 'lin', p: { spin: 230, fx: 0.3, fy: 0.35, bx: 0.1, by: 0.4 } },
      { f: 24, e: 'lin', p: { spin: 350, fx: 0.4, fy: 0.3 } },
      { f: 32, e: 'out', p: { spin: 448, fy: 0.15, by: 0.1, head: 20, ...m(0.04, 1.2, 0.5, 270, 0), ...s(0.0, 1.2, -0.5, -90, 0) } },
      { f: 42, e: 'io', p: { spin: 455, fy: 0.06, by: 0.05 } },
    ],
    stance,
    0.8,
    1.6,
  );
  const fallThrow = R(
    [
      { f: 0, p: { spin: 30, tilt: 10, hipLean: st.hipLean + 10, ...WIDE, fx: 0.3, fy: 0.25 } },
      { f: 12, e: 'lin', p: { spin: 200, tilt: -20, fx: 0.1, fy: 0.45, bx: 0.2, by: 0.3 } },
      { f: 26, e: 'out', p: { spin: 448, tilt: 0, fx: 0.4, fy: 0.15, bx: 0.15, by: 0.15, ...m(0.04, 1.2, 0.5, 270, 0), ...s(0.0, 1.2, -0.5, -90, 0) } },
      { f: 36, e: 'io', p: { spin: 455, fy: 0.05, by: 0.05 } },
    ],
    stance,
    0.8,
    1.6,
  );
  // KO: spin-out collapse — knees buckle through a full turn, blades die mid-spin, falls on her side.
  const sideLie = makePose(lying, { tilt: 72, spinY: 360, fKnee: 30, bKnee: 10, fx: 0.06, fy: -0.66, bx: -0.2, by: -0.74, ...m(0.16, 0.78, 0.04, 200, 0), ...s(-0.1, 1.3, -0.4, 180, 0), head: 4, headYaw: -10 });
  const fallKo = R(
    [
      { f: 0, p: { hipLean: st.hipLean + 24, head: st.head + 45, chest: st.chest + 20, ...m(0.2, 1.5, 0.3, 180, -10), ...s(-0.1, 1.4, -0.3, 180, 10), fx: st.fx + 0.1 } },
      { f: 7, e: 'out', p: { spinY: 140, spin: 14, hipY: 0.66, fx: 0.22, bx: -0.16, fy: 0.06, ...prop, pitch: 354, head: st.head + 20 } },
      { f: 13, e: 'lin', p: { spinY: 260, spin: 30, hipY: 0.56, blade: 0.5, blade2: 0.5 } },
      { f: 17, e: 'io', p: { blade: 0, blade2: 0 } },
      { f: 24, e: 'in', p: { ...sideLie, blade: 0, blade2: 0 } },
      { f: 40, e: 'io', p: { head: 6 } },
    ],
    stance,
    1.2,
    2.4,
  );
  const koLie = R([{ f: 0, p: { ...sideLie, blade: 0, blade2: 0, head: 6 } }, { f: 16, e: 'io', p: { headYaw: -30 } }], stance, 0, 0);
  const bounce = R(
    [
      { f: 0, p: { ...lying, spin: 80, hipY: 0.26, fx: lying.fx + 0.35, bx: lying.bx + 0.25 } },
      { f: 6, e: 'out', p: { spin: 90, hipY: 0.2, fx: lying.fx + 0.12, bx: lying.bx + 0.08 } },
      { f: 14, e: 'in', p: { ...lying } },
    ],
    stance,
    1,
    2,
  );
  const knockdown = R(
    [
      { f: 0, p: { ...lying, fx: lying.fx + 0.22, bx: lying.bx + 0.12, spin: 92 } },
      { f: 5, e: 'out', p: { fx: lying.fx + 0.04, bx: lying.bx, spin: 87 } },
      { f: 12, e: 'io', p: { ...lying } },
      { f: 40, e: 'io', p: { chest: lying.chest + 3, head: lying.head + 6 } },
    ],
    stance,
    1,
    2,
  );

  const clips = {
    ...shared,
    idle,
    idleBreak,
    idleBreak2,
    runStart,
    runStop,
    backdash,
    crouchDown,
    standUp,
    jumpSquat,
    jumpUp,
    jumpFwd,
    jumpBack,
    jumpRun,
    land,
    landHeavy,
    airRecover,
    light,
    light2,
    light3,
    heavy,
    heavyChain,
    crLight,
    crLight2,
    sweep,
    airLight,
    airHeavy,
    throwStart,
    throwing,
    gripping: thrownVictim,
    special,
    superCharge,
    super: superMove,
    parry,
    parrySuccess,
    parried,
    getup,
    intro,
    victory,
    stagger,
    clash,
    shocked,
    gripVictim,
    thrownVictim,
    hitHigh,
    hitHigh2,
    hitBody,
    hitBody2,
    hitLow,
    hitLowHeavy,
    hitHighHeavy,
    hitBodyHeavy,
    fallBlowback,
    fallSweep,
    fallSpin,
    fallThrow,
    fallKo,
    bounce,
    knockdown,
    koLie,
  };

  return { stance, guard, crouch, crouchGuard, walk, walkBack, run, clips, turnFrames: 5 };
}
