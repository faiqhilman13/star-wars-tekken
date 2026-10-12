import { clip, type Clip, type KeySpec } from './clip';
import { lerpPose, makePose, NEUTRAL, type Pose, type PosePatch } from './pose';
import type { ClipName, OptionalClipName } from './types';

/**
 * Shared reaction/locomotion clips built from a fighter's stance. Characters override what makes
 * them unique (attacks, parries, jumps, get-ups, intros, victories) and inherit the rest.
 *
 * Reaction design follows the hit-reaction grid in artifacts/animation-reference.md §1.9–1.12:
 * high hits snap the head, body hits fold the torso into a "C", low hits buckle the leg; heavy
 * versions push further and step back; launches go impact → starfish → back-first landing.
 */
export interface Physique {
  /** Reaction amplitude (Kael 1, Vexa 0.8, Asha 1.25, Thane 1). */
  amp: number;
  /** Head reaction multiplier (masked characters emote with the body). */
  head: number;
  /** Dual wielder: second blade follows the free hand. */
  dual: boolean;
}

export interface SharedBases {
  stance: Pose;
  guard: Pose;
  crouch: Pose;
  crouchGuard: Pose;
}

/** On-the-back lying pose (authored upright, then rolled 88° about the hips). */
export function lyingPose(st: Pose, ph: Physique, patch: PosePatch = {}): Pose {
  return makePose(st, {
    rootX: -0.12,
    rootZ: 0,
    hipY: 0.2,
    spin: 88,
    spinY: 0,
    tilt: 0,
    hipLean: 0,
    hipYaw: 0,
    hipRoll: 0,
    spine: 3,
    spineYaw: 0,
    chest: 2,
    twist: 0,
    chestRoll: 0,
    head: 12,
    headYaw: -18,
    headRoll: 0,
    // Sword arm flung overhead: once rolled flat, the blade lies on the deck out past the head
    // (never across the body); the free hand lies by the hip.
    gx: 0.04,
    gy: 0.98,
    gz: 0.36,
    pitch: 96,
    yaw: 28,
    roll: 0,
    off: 1,
    ox: 0.02,
    oy: 0.3,
    oz: -0.34,
    palm: 0,
    ...(ph.dual ? { g2x: 0.02, g2y: 0.3, g2z: -0.34, pitch2: -20, yaw2: -40 } : {}),
    fx: -0.1,
    fy: -0.8,
    fz: 0.04,
    fPitch: 30,
    fKnee: 8,
    bx: -0.12,
    by: -0.74,
    bz: -0.06,
    bPitch: 22,
    bKnee: 14,
    nElbow: 0,
    fElbow: 0,
    ...patch,
  });
}

/** Free-hand patch that also moves a dual wielder's second saber with the hand. */
export function offHand(ph: Physique, x: number, y: number, z: number, palm = 1, pitch2 = 150, yaw2 = -10): PosePatch {
  const p: PosePatch = { off: 1, ox: x, oy: y, oz: z, palm };
  // Dual wielders: the second saber goes with the hand, always with an explicit direction.
  if (ph.dual) Object.assign(p, { g2x: x, g2y: y, g2z: z, pitch2, yaw2 });
  return p;
}

export type SharedClipSet = Record<ClipName, Clip> & Partial<Record<OptionalClipName, Clip>>;

export function sharedClips(b: SharedBases, ph: Physique): SharedClipSet {
  const st = b.stance;
  const a = ph.amp;
  const h = ph.head * a;
  const lying = lyingPose(st, ph);
  const R = (keys: KeySpec[], base = st, lagTorso = 0.6, lagHead = 1.2) => clip(base, keys, { lagTorso, lagHead });

  const clips: Partial<Record<ClipName | OptionalClipName, Clip>> = {};

  // ---------------------------------------------------------------- hits (time-warped to stun)
  // Reaction grid: the head whips (high), the torso doubles over (body), the leg buckles (low).
  // Every reaction moves the whole body: weight goes back, a foot lifts and replants, the arms
  // flinch, then everything recovers hips-first.
  clips.hitHigh = R([
    { f: 1, e: 'snap', p: { head: st.head + 24 * h, headYaw: -12, chest: st.chest + 8 * a, spine: st.spine + 4 * a, hipLean: st.hipLean + 6 * a, rootX: -0.04 * a, gx: st.gx - 0.06, gy: st.gy + 0.06, pitch: st.pitch + 20 * a, ...offHand(ph, 0.14, 1.5, 0.02, 1) } },
    { f: 3, e: 'out', p: { head: st.head + 30 * h, chest: st.chest + 10 * a, rootX: -0.07 * a, fy: 0.035, fPitch: 12 } },
    { f: 7, e: 'io', p: { head: st.head + 14 * h, headYaw: -6, chest: st.chest + 5 * a, rootX: -0.08 * a, fy: 0, fPitch: 0, bx: st.bx - 0.05 } },
    { f: 12, e: 'io', p: { head: st.head + 4 * h, headYaw: 0, chest: st.chest + 2, spine: st.spine, hipLean: st.hipLean + 2, rootX: -0.05, gx: st.gx, gy: st.gy, pitch: st.pitch + 4 } },
    { f: 20, e: 'in', reset: true },
  ]);
  clips.hitHighHeavy = R([
    { f: 2, e: 'snap', p: { head: st.head + 40 * h, headYaw: -16, chest: st.chest + 20 * a, spine: st.spine + 12 * a, hipLean: st.hipLean + 14 * a, hipY: st.hipY - 0.03, rootX: -0.1 * a, fy: 0.07, fPitch: 20, gx: st.gx - 0.15, gy: Math.min(st.gy + 0.15, 1.82), pitch: 150, yaw: 10, ...offHand(ph, -0.4, 1.4, -0.2, 1, 170), yaw2: -10 } },
    { f: 6, e: 'out', p: { head: st.head + 32 * h, chest: st.chest + 16 * a, rootX: -0.15 * a, by: 0.06, bx: st.bx - 0.12, bPitch: 18 } },
    { f: 10, e: 'io', p: { by: 0, bPitch: 0, bx: st.bx - 0.2, fx: st.fx - 0.06, fy: 0.03, hipY: st.hipY - 0.04, head: st.head + 18 * h, chest: st.chest + 10 * a } },
    { f: 16, e: 'io', p: { fy: 0, fPitch: 0, fx: st.fx - 0.1, head: st.head + 8 * h, headYaw: -6, chest: st.chest + 4 * a, spine: st.spine + 2, hipLean: st.hipLean + 6, gx: st.gx - 0.05, gy: st.gy + 0.05, pitch: st.pitch + 40, ...offHand(ph, (st.ox + 0.1) / 2, (st.oy + 1.4) / 2, st.oz, st.palm, 160) } },
    { f: 21, e: 'io', p: { head: st.head + 2, headYaw: 0, chest: st.chest + 1, hipLean: st.hipLean + 2, hipY: st.hipY - 0.01, rootX: -0.07, bx: st.bx - 0.08, fx: st.fx - 0.04, gx: st.gx, gy: st.gy, pitch: st.pitch + 8 } },
    { f: 26, e: 'in', reset: true },
  ]);
  clips.hitBody = R([
    { f: 1, e: 'snap', p: { rootX: -0.06 * a, hipY: st.hipY - 0.05 * a, hipLean: st.hipLean - 4 * a, spine: st.spine - 10 * a, chest: st.chest - 14 * a, head: st.head - 10 * h, fKnee: st.fKnee + 6, bKnee: st.bKnee + 6, gx: st.gx - 0.05, gy: st.gy - 0.12, pitch: st.pitch - 20, ...offHand(ph, 0.12, 1.0, 0.1, 0, 120) } },
    { f: 4, e: 'out', p: { chest: st.chest - 18 * a, head: st.head - 14 * h, rootX: -0.08 * a, by: 0.03 } },
    { f: 9, e: 'io', p: { chest: st.chest - 8 * a, spine: st.spine - 4 * a, head: st.head - 2 * h, rootX: -0.09 * a, by: 0, bx: st.bx - 0.04, hipY: st.hipY - 0.03 } },
    { f: 14, e: 'io', p: { chest: st.chest - 2, spine: st.spine, hipLean: st.hipLean, head: st.head + 2, hipY: st.hipY - 0.01, rootX: -0.06, gx: st.gx, gy: st.gy - 0.02, pitch: st.pitch - 4 } },
    { f: 20, e: 'in', reset: true },
  ]);
  clips.hitBodyHeavy = R([
    { f: 2, e: 'snap', p: { rootX: -0.12 * a, hipY: st.hipY - 0.12 * a, hipLean: st.hipLean - 10 * a, spine: st.spine - 18 * a, chest: st.chest - 26 * a, head: st.head - 18 * h, fPitch: 15, bPitch: 15, fKnee: st.fKnee + 10, bKnee: st.bKnee + 12, gx: st.gx - 0.05, gy: st.gy - 0.25, pitch: -30, yaw: 20, ...offHand(ph, 0.14, 0.98, 0.1, 0, 110), yaw2: -20 } },
    { f: 6, e: 'out', p: { hipY: st.hipY - 0.15 * a, chest: st.chest - 32 * a, rootX: -0.17 * a, by: 0.05, bx: st.bx - 0.1 } },
    { f: 11, e: 'io', p: { by: 0, bx: st.bx - 0.16, chest: st.chest - 22 * a, spine: st.spine - 12 * a, head: st.head - 6 * h } },
    { f: 18, e: 'io', p: { hipY: st.hipY - 0.05, hipLean: st.hipLean - 2, spine: st.spine - 3, chest: st.chest - 6, head: st.head + 8 * h, fPitch: 0, bPitch: 0, gx: st.gx - 0.02, gy: st.gy - 0.08, pitch: st.pitch - 10, yaw: st.yaw, ...offHand(ph, (st.ox + 0.14) / 2, (st.oy + 1.0) / 2, st.oz, 0, 150), yaw2: st.yaw2 } },
    { f: 22, e: 'io', p: { hipY: st.hipY - 0.02, chest: st.chest - 1, head: st.head + 2, rootX: -0.1, bx: st.bx - 0.1 } },
    { f: 26, e: 'in', reset: true },
  ]);
  clips.hitLow = R([
    { f: 1, e: 'snap', p: { fx: st.fx - 0.1 * a, fy: 0.08, fPitch: 20, hipRoll: 6 * a, hipY: st.hipY - 0.06 * a, chest: st.chest - 10 * a, head: st.head - 6 * h, rootX: -0.04 * a, ...offHand(ph, -0.3, 1.2, -0.2, 1, 160) } },
    { f: 4, e: 'out', p: { fy: 0.06, hipY: st.hipY - 0.07 * a, head: st.head - 8 * h } },
    { f: 8, e: 'io', p: { fy: 0, fPitch: 0, hipY: st.hipY - 0.04, hipRoll: 3, chest: st.chest - 4, head: st.head - 2 } },
    { f: 13, e: 'io', p: { hipRoll: 0, fx: st.fx - 0.05, chest: st.chest - 1, ...offHand(ph, (st.ox - 0.3) / 2, (st.oy + 1.2) / 2, st.oz, st.palm, 160) } },
    { f: 20, e: 'in', reset: true },
  ]);
  clips.hitLowHeavy = R([
    { f: 2, e: 'snap', p: { hipY: Math.min(st.hipY, 0.6), fx: st.fx - 0.04, fKnee: 12, bKnee: 18, chest: st.chest - 18 * a, hipLean: st.hipLean - 6, head: st.head - 12 * h, rootX: -0.1 * a, gx: st.gx + 0.08, gy: 0.62, pitch: -62, yaw: -20, ...offHand(ph, -0.25, 1.15, -0.22, 1, 160), yaw2: 10 } },
    { f: 7, e: 'out', p: { hipY: Math.min(st.hipY, 0.6) - 0.04, head: st.head - 16 * h, rootX: -0.13 * a } },
    { f: 13, e: 'io', p: { hipY: Math.min(st.hipY, 0.6) - 0.01, chest: st.chest - 10, head: st.head - 4 } },
    { f: 19, e: 'io', p: { hipY: (Math.min(st.hipY, 0.6) + st.hipY) / 2, chest: st.chest - 4, head: st.head, gx: st.gx + 0.04, gy: (0.62 + st.gy) / 2, pitch: st.pitch - 30, yaw: st.yaw } },
    { f: 26, e: 'in', reset: true },
  ]);
  clips.hitCrouch = R(
    [
      { f: 1, e: 'snap', p: { hipY: b.crouch.hipY - 0.06 * a, head: b.crouch.head + 20 * h, chest: b.crouch.chest + 10 * a, hipRoll: 5, rootX: -0.08 * a, pitch: b.crouch.pitch + 20 } },
      { f: 4, e: 'out', p: { head: b.crouch.head + 24 * h, rootX: -0.1 * a } },
      { f: 10, e: 'io', p: { head: b.crouch.head + 8 * h, chest: b.crouch.chest + 4, hipRoll: 2, rootX: -0.1 * a } },
      { f: 20, e: 'in', reset: true },
    ],
    b.crouch,
  );
  // Counter-hit stagger: spun half round, stumbling back two steps with the arms windmilling.
  clips.stagger = R([
    { f: 2, e: 'snap', p: { twist: st.twist - 50 * a, hipYaw: -40 * a, headYaw: -40, chest: st.chest + 10 * a, head: st.head + 14 * h, pitch: 150, yaw: 10, gx: st.gx - 0.1, gy: Math.min(st.gy + 0.2, 1.82), rootX: -0.08, fy: 0.06, fPitch: 15, ...offHand(ph, -0.4, 1.45, -0.35, 1, 180), yaw2: -10 } },
    { f: 6, e: 'out', p: { rootX: -0.14, by: 0.08, bx: st.bx - 0.12, bPitch: 20, twist: st.twist - 56 * a, headYaw: -46, head: st.head + 18 * h } },
    { f: 10, e: 'io', p: { by: 0, bPitch: 0, bx: st.bx - 0.24, fx: st.fx - 0.08, fy: 0.07, hipY: st.hipY - 0.05, twist: st.twist - 40 * a, head: st.head + 6 * h, pitch: 120, ...offHand(ph, -0.1, 1.6, -0.3, 1, 150) } },
    { f: 15, e: 'io', p: { fy: 0, fPitch: 0, fx: st.fx - 0.18, hipYaw: -20 * a, headYaw: -15, chest: st.chest + 4, ...offHand(ph, 0.1, 1.3, -0.1, 1, 140), pitch: st.pitch + 30, gx: st.gx - 0.04, gy: Math.min(st.gy + 0.08, 1.82) } },
    { f: 20, e: 'io', p: { twist: st.twist - 12, hipYaw: -6, headYaw: -4, hipY: st.hipY - 0.03, head: st.head + 2, rootX: -0.12 } },
    { f: 26, e: 'io', p: { twist: st.twist - 2, hipYaw: st.hipYaw, headYaw: 0, hipY: st.hipY - 0.01, rootX: -0.08, gx: st.gx, gy: st.gy, pitch: st.pitch + 6, ...offHand(ph, st.ox, st.oy, st.oz, st.palm, 150) } },
    { f: 32, e: 'in', reset: true },
  ]);

  // Electrocuted (ROTJ: Luke under Palpatine's lightning): arched back, clawing hands, knees buckling
  // over the beam. Timed by the caster's super frame (beam ~f13–58), 2-frame tremor.
  const shock: KeySpec[] = [
    { f: 0, p: {} },
    { f: 13, e: 'snap', p: { chest: st.chest + 22 * a, spine: st.spine + 10 * a, hipLean: st.hipLean + 10 * a, head: st.head + 32 * ph.head, headRoll: 8, hipY: st.hipY - 0.04, rootX: -0.06, gx: st.gx - 0.1, gy: 1.2, gz: 0.24, pitch: -40, yaw: 30, ...offHand(ph, 0.2, 1.55, -0.12, 1, 160), fKnee: 14, bKnee: 14 } },
  ];
  for (let f = 15, k = 0; f <= 57; f += 2, k += 1) {
    const u = (f - 13) / 45;
    const j = k % 2 === 0 ? 1 : -1;
    shock.push({
      f,
      e: 'lin',
      p: {
        hipY: st.hipY - 0.04 - 0.22 * u,
        chest: st.chest + (22 + 4 * j) * a,
        head: st.head + (32 + 5 * j) * ph.head,
        headRoll: 8 * j,
        hipLean: st.hipLean + (10 - 6 * u) * a,
        ...offHand(ph, 0.2 + 0.03 * j, 1.55 - 0.15 * u + 0.02 * j, -0.12, 1, 160),
        gy: 1.2 - 0.25 * u,
        fx: st.fx + 0.06 * u,
        bx: st.bx + 0.1 * u,
        fKnee: 14 + 10 * u,
        bKnee: 14 + 10 * u,
      },
    });
  }
  shock.push({ f: 62, e: 'out', p: { chest: st.chest + 30 * a, head: st.head + 40 * ph.head, hipY: st.hipY - 0.2, rootX: -0.12 } });
  clips.shocked = R(shock, st, 0.3, 0.6);

  // ---------------------------------------------------------------- blocking (warped to blockstun)
  clips.block = R(
    [
      { f: 2, e: 'snap', p: { rootX: -0.07, hipY: b.guard.hipY - 0.025, chest: b.guard.chest + 5, pitch: b.guard.pitch + 10, bx: b.guard.bx - 0.02 } },
      { f: 12, e: 'out', reset: true },
    ],
    b.guard,
    0.4,
    0.8,
  );
  clips.crouchBlock = R(
    [
      { f: 2, e: 'snap', p: { rootX: -0.06, hipY: b.crouchGuard.hipY - 0.02, chest: b.crouchGuard.chest + 5, pitch: b.crouchGuard.pitch + 10 } },
      { f: 12, e: 'out', reset: true },
    ],
    b.crouchGuard,
    0.4,
    0.8,
  );

  // ---------------------------------------------------------------- being parried (warped)
  clips.parried = R([
    { f: 2, e: 'snap', p: { pitch: 150, yaw: 10, yaw2: -10, gx: st.gx - 0.08, gy: 1.62, chest: st.chest + 16 * a, head: st.head + 18 * h, hipLean: st.hipLean + 10, rootX: -0.1, fy: 0.06, ...offHand(ph, -0.35, 1.45, -0.25, 1, 180) } },
    { f: 10, e: 'out', p: { bx: st.bx - 0.2, fy: 0, hipY: st.hipY - 0.03 } },
    { f: 18, e: 'io', p: { fx: st.fx - 0.12, chest: st.chest + 6, head: st.head + 6, pitch: 120 } },
    { f: 28, e: 'in', reset: true },
  ]);

  // ---------------------------------------------------------------- falls (frames since launch)
  // Impact → whiplash and starfish → limbs flail and the legs scissor → arms and blade settle into
  // the lying pose just before the back hits the deck (no blade into the floor, no pop on landing).
  // Arm/leg targets are written relative to the hips so they read the same at any hip height.
  const atHip = (hipY: number, src: Pose): PosePatch => ({
    hipY,
    gx: src.gx,
    gy: hipY + (src.gy - src.hipY),
    gz: src.gz,
    pitch: src.pitch,
    yaw: src.yaw,
    ...offHand(ph, src.ox, hipY + (src.oy - src.hipY), src.oz, src.palm, src.pitch2),
    yaw2: src.yaw2,
  });
  const landArms = (hipY: number): PosePatch => ({ ...atHip(hipY, lying), fx: lying.fx + 0.25, fy: hipY + (lying.fy - lying.hipY) + 0.22, bx: lying.bx + 0.2, by: hipY + (lying.by - lying.hipY) + 0.18, fPitch: 30, bPitch: 25 });
  const starfish: PosePatch = { gx: 0.05, gy: 1.85, pitch: 175, yaw: -10, ...offHand(ph, -0.2, 1.78, -0.25, 1, 190), yaw2: -10 };
  clips.fallBlowback = R(
    [
      { f: 0, p: { hipLean: st.hipLean + 20, head: st.head + 35 * ph.head, chest: st.chest + 14, spin: 10, gx: st.gx + 0.05, gy: 1.7, pitch: 165, yaw: 10, ...offHand(ph, 0.1, 1.65, -0.1, 1, 170), yaw2: -10, fx: st.fx + 0.08, fy: 0.08 } },
      { f: 4, e: 'out', p: { spin: 26, hipY: 0.95, fx: 0.36, fy: 0.3, bx: 0.08, by: 0.12, fKnee: 10, bKnee: 6, head: st.head + 40 * ph.head, ...starfish } },
      { f: 9, e: 'io', p: { spin: 46, fx: 0.48, fy: 0.38, bx: 0.3, by: 0.24, fKnee: 4, bKnee: 14, head: 22, chest: 8, gx: 0.2, gy: 1.72, pitch: 140, ...offHand(ph, -0.3, 1.62, -0.3, 1, 200) } },
      { f: 15, e: 'io', p: { spin: 66, fx: 0.52, fy: 0.24, bx: 0.22, by: 0.36, fKnee: 12, bKnee: 4, head: 18, chest: 6, gx: 0.32, gy: 1.55, pitch: 115, ...offHand(ph, -0.1, 1.8, -0.28, 1, 170) } },
      { f: 21, e: 'io', p: { spin: 82, head: 8, chest: 2, hipLean: 6, ...landArms(0.95) } },
      { f: 27, e: 'in', p: { spin: 92, head: 10, hipLean: 2, ...landArms(0.95), fy: 0.95 + (lying.fy - lying.hipY) + 0.12, by: 0.95 + (lying.by - lying.hipY) + 0.08 } },
      { f: 40, e: 'io', p: { spin: 94, ...landArms(0.95), fy: 0.95 + (lying.fy - lying.hipY) + 0.04, by: 0.95 + (lying.by - lying.hipY) + 0.03 } },
    ],
    st,
    1.2,
    2.2,
  );
  clips.fallSweep = R(
    [
      { f: 0, p: { spin: 25, fx: 0.45, fy: 0.35, bx: 0.25, by: 0.3, head: st.head + 10, gy: 1.7, gx: st.gx, pitch: 140, yaw: 10, ...offHand(ph, -0.1, 1.7, -0.2, 1, 170), yaw2: -10 } },
      { f: 6, e: 'out', p: { spin: 58, fx: 0.52, fy: 0.34, bx: 0.3, by: 0.22, head: 18, gx: 0.15, gy: 1.65, pitch: 130, ...offHand(ph, -0.3, 1.5, -0.3, 1, 190) } },
      { f: 12, e: 'io', p: { spin: 80, head: 10, ...landArms(0.95) } },
      { f: 18, e: 'in', p: { spin: 92, ...landArms(0.95), fy: 0.95 + (lying.fy - lying.hipY) + 0.1, by: 0.95 + (lying.by - lying.hipY) + 0.08 } },
      { f: 30, e: 'io', p: { spin: 94, ...landArms(0.95), fy: 0.95 + (lying.fy - lying.hipY) + 0.03, by: 0.95 + (lying.by - lying.hipY) + 0.02 } },
    ],
    st,
    1,
    2,
  );
  clips.fallSpin = R(
    [
      { f: 0, p: { spin: 20, hipLean: st.hipLean + 15, head: st.head + 30, ...starfish } },
      { f: 7, e: 'lin', p: { spin: 110, fx: 0.15, fy: 0.45, bx: -0.05, by: 0.5, hipY: 0.95, gx: 0.2, gy: 1.3, pitch: 120, ...offHand(ph, 0.1, 1.2, -0.15, 1, 140) } },
      { f: 15, e: 'lin', p: { spin: 230, fx: 0.3, fy: 0.35, bx: 0.1, by: 0.4, gx: 0.28, gy: 1.45, pitch: 140, ...offHand(ph, -0.2, 1.5, -0.25, 1, 170) } },
      { f: 24, e: 'lin', p: { spin: 350, fx: 0.4, fy: 0.3, ...starfish } },
      { f: 31, e: 'out', p: { spin: 440, head: 14, ...landArms(0.95) } },
      { f: 42, e: 'io', p: { spin: 454, ...landArms(0.95), fy: 0.95 + (lying.fy - lying.hipY) + 0.04, by: 0.95 + (lying.by - lying.hipY) + 0.03 } },
    ],
    st,
    0.8,
    1.6,
  );
  clips.fallThrow = R(
    [
      { f: 0, p: { spin: 30, tilt: 10, hipLean: st.hipLean + 10, ...starfish, fx: 0.3, fy: 0.25 } },
      { f: 12, e: 'lin', p: { spin: 200, tilt: -20, fx: 0.1, fy: 0.45, bx: 0.2, by: 0.3, gx: 0.3, gy: 1.2, pitch: 90, yaw: 10 } },
      { f: 22, e: 'out', p: { spin: 380, tilt: -6, fx: 0.4, fy: 0.25, bx: 0.15, by: 0.2, ...starfish } },
      { f: 29, e: 'io', p: { spin: 440, tilt: 0, head: 12, ...landArms(0.95) } },
      { f: 36, e: 'io', p: { spin: 454, ...landArms(0.95), fy: 0.95 + (lying.fy - lying.hipY) + 0.04, by: 0.95 + (lying.by - lying.hipY) + 0.03 } },
    ],
    st,
    0.8,
    1.6,
  );
  clips.fallKo = R(
    [
      { f: 0, p: { spin: 15, hipLean: st.hipLean + 24, head: st.head + 45 * ph.head, chest: st.chest + 20, gx: st.gx + 0.15, gy: 1.6, pitch: 120, yaw: 10, ...offHand(ph, 0.35, 1.5, -0.1, 1, 130), yaw2: -10, fx: st.fx + 0.1 } },
      { f: 12, e: 'out', p: { spin: 50, fx: 0.4, fy: 0.25, bx: 0.15, by: 0.12, hipY: 0.92, gx: -0.05, gy: 1.75, pitch: 175, ...offHand(ph, -0.25, 1.7, -0.25, 1, 190) } },
      { f: 22, e: 'io', p: { spin: 76, head: 25, fy: 0.2, gx: 0.12, gy: 1.6, pitch: 140, ...offHand(ph, -0.1, 1.75, -0.3, 1, 170) } },
      { f: 30, e: 'io', p: { spin: 88, head: 16, ...landArms(0.92), blade: 0.5, blade2: 0.5 } },
      { f: 36, e: 'in', p: { spin: 94, ...landArms(0.92), fy: 0.92 + (lying.fy - lying.hipY) + 0.06, by: 0.92 + (lying.by - lying.hipY) + 0.04, blade: 0.25, blade2: 0.25 } },
      { f: 50, e: 'io', p: { blade: 0, blade2: 0, fy: 0.92 + (lying.fy - lying.hipY), by: 0.92 + (lying.by - lying.hipY) } },
    ],
    st,
    1.6,
    3,
  );
  clips.bounce = R(
    [
      { f: 0, p: { ...lying, spin: 80, hipY: 0.26, fx: lying.fx + 0.35, bx: lying.bx + 0.25, gx: lying.gx + 0.3, ox: lying.ox + 0.3, ...(ph.dual ? { g2x: lying.ox + 0.3 } : {}) } },
      { f: 6, e: 'out', p: { spin: 90, hipY: 0.2, fx: lying.fx + 0.12, bx: lying.bx + 0.08 } },
      { f: 14, e: 'in', p: { ...lying } },
    ],
    st,
    1,
    2,
  );
  clips.knockdown = R(
    [
      { f: 0, p: { ...lying, fx: lying.fx + 0.22, bx: lying.bx + 0.12, gx: lying.gx + 0.18, spin: 92 } },
      { f: 5, e: 'out', p: { fx: lying.fx + 0.04, bx: lying.bx, gx: lying.gx, spin: 87 } },
      { f: 12, e: 'io', p: { ...lying } },
      { f: 40, e: 'io', p: { chest: lying.chest + 3, head: lying.head + 6 } },
    ],
    st,
    1,
    2,
  );
  clips.koLie = R(
    [
      { f: 0, p: { ...lying, ...offHand(ph, -0.4, 1.35, -0.4, 1, 120) } },
      { f: 16, e: 'io', p: { blade: 0, blade2: 0, head: 6, headYaw: -40 } },
    ],
    st,
    0,
    0,
  );
  clips.getup = R(
    [
      { f: 0, p: { ...lying } },
      { f: 5, e: 'io', p: { spin: 70, fx: lying.fx + 0.35, fy: lying.fy + 0.45, bx: lying.bx + 0.35, by: lying.by + 0.45, hipY: 0.2 } },
      { f: 11, e: 'io', p: { spin: 20, rootX: -0.05, hipY: 0.48, hipLean: -10, spine: 0, chest: 0, head: 6, headYaw: 0, fx: 0.38, fy: 0, bx: -0.45, by: 0, fPitch: 0, bPitch: 0, gx: st.gx, gy: 0.75, gz: st.gz, pitch: 50, off: st.off, ox: st.ox, oy: 0.8, oz: st.oz, palm: 0 } },
      { f: 16, e: 'out', reset: true },
    ],
    st,
    0.8,
    1.6,
  );

  // ---------------------------------------------------------------- throws / grip victim
  clips.thrownVictim = R([
    { f: 3, e: 'snap', p: { chest: st.chest - 20, spine: st.spine - 10, head: st.head - 12, hipY: st.hipY - 0.06, rootX: 0.03, pitch: -70, gy: 0.95, ...offHand(ph, 0.16, 1.25, 0.04, 0, 120) } },
    { f: 12, e: 'io', p: { rootX: 0.07, chest: st.chest - 24 } },
    { f: 20, e: 'io', p: { rootX: 0.05 } },
  ]);
  const kick = (f: number, s: number): KeySpec => ({ f, e: 'io', p: { fx: 0.12 * s, bx: -0.12 * s, fy: 0.05 + 0.04 * s, by: 0.05 - 0.04 * s } });
  clips.gripVictim = R([
    // Choked (Needa, ESB): the free hand claws at the throat, the sword fist clutches the chest with
    // the blade dangling forward, head forced back, toes pointed.
    { f: 6, e: 'snap', p: { head: st.head + 26 * ph.head, chest: st.chest + 10, hipLean: 4, spine: 3, gx: 0.2, gy: 1.24, gz: 0.2, pitch: -64, yaw: 28, ...offHand(ph, 0.12, 1.52, 0.02, 1, -70), hipY: 0.94, fx: 0.08, bx: -0.08, fPitch: 50, bPitch: 50, fKnee: 6, bKnee: 6, nElbow: 0, fElbow: 0 } },
    { f: 9, e: 'io', p: { ...offHand(ph, 0.1, 1.55, 0.04, 1, -70), gx: 0.16, gy: 1.32, headRoll: 6 } },
    kick(12, 1),
    kick(18, -1),
    kick(24, 1),
    kick(30, -1),
    kick(36, 1),
    kick(42, -1),
    { f: 46, e: 'io', p: { fx: 0.05, bx: -0.05, head: st.head + 30 } },
  ]);

  // ---------------------------------------------------------------- generic movement
  clips.jumpSquat = R([{ f: 4, e: 'out', p: { hipY: st.hipY - 0.18, hipLean: st.hipLean - 14, chest: st.chest - 6, head: st.head + 10, gy: st.gy - 0.12, fPitch: 0, bPitch: 10 } }], st, 0.4, 0.8);
  clips.land = R(
    [
      { f: 0, p: { hipY: st.hipY - 0.12, hipLean: st.hipLean - 10, pitch: st.pitch - 15, chest: st.chest - 6 } },
      { f: 4, e: 'outBack', reset: true },
      { f: 8, e: 'io', reset: true },
    ],
    st,
    1,
    1.6,
  );
  clips.airRecover = R([
    { f: 0, p: { spin: 20, chest: st.chest + 12, head: st.head + 15, pitch: 140, gy: st.gy + 0.2, ...offHand(ph, -0.3, 1.5, -0.2, 1, 170), fy: 0.2, by: 0.3, hipY: 0.95 } },
    { f: 10, e: 'out', p: { spin: 0, chest: st.chest, head: st.head, fy: 0.35, by: 0.4, pitch: st.pitch } },
    { f: 22, e: 'io', p: { fy: 0.08, by: 0.1 } },
  ]);
  clips.clash = R([
    { f: 0, p: { rootX: 0.08, gx: 0.62, gy: 1.24, pitch: 28, yaw: 8, twist: st.twist + 10, hipLean: st.hipLean - 6, chest: st.chest - 6, fx: st.fx + 0.12 } },
    { f: 4, e: 'hold', p: { pitch: 30 } },
    { f: 8, e: 'out', p: { rootX: -0.12, gx: st.gx - 0.05, gy: Math.min(st.gy + 0.25, 1.82), pitch: 112, yaw: 0, hipLean: st.hipLean + 10, chest: st.chest + 8, head: st.head + 10, fx: st.fx - 0.02, bx: st.bx - 0.12 } },
    { f: 18, e: 'io', reset: true },
  ]);

  // ---------------------------------------------------------------- transitions & variety (defaults)
  // Characters override these with their own versions.
  const cr = b.crouch;
  const mid = (u: number): Pose => lerpPose({ ...NEUTRAL }, st, cr, u);
  clips.crouchDown = R(
    [
      { f: 3, e: 'in', p: { ...mid(0.55), head: st.head - 2 } },
      { f: 6, e: 'out', p: { ...cr, hipY: cr.hipY - 0.035, hipLean: cr.hipLean - 3 } },
      { f: 9, e: 'io', p: { ...cr } },
    ],
    st,
    0.5,
    1,
  );
  clips.standUp = R(
    [
      { f: 0, p: { ...cr } },
      { f: 4, e: 'io', p: { ...mid(0.35), hipY: (st.hipY + cr.hipY) / 2 + 0.06 } },
      { f: 7, e: 'out', p: { ...st, hipY: st.hipY + 0.02, chest: st.chest + 2, head: st.head + 2 } },
      { f: 10, e: 'io', p: { ...st } },
    ],
    st,
    0.5,
    1,
  );
  clips.landHeavy = R(
    [
      { f: 0, p: { hipY: st.hipY - 0.22, hipLean: st.hipLean - 20, spine: st.spine - 4, chest: st.chest - 8, head: st.head + 12, gy: Math.min(st.gy, 1.62) - 0.2, fKnee: st.fKnee + 10, bKnee: st.bKnee + 10 } },
      { f: 3, e: 'out', p: { hipY: st.hipY - 0.26, hipLean: st.hipLean - 24 } },
      { f: 7, e: 'io', p: { hipY: st.hipY - 0.08, hipLean: st.hipLean - 6, spine: st.spine, chest: st.chest - 2, head: st.head + 2, gy: st.gy - 0.04 } },
      { f: 12, e: 'io', reset: true },
    ],
    st,
    1,
    1.6,
  );
  // Alternates: the head snaps the other way, the torso twists instead of folding straight.
  clips.hitHigh2 = R([
    { f: 2, e: 'snap', p: { head: st.head + 22 * h, headYaw: 16, headRoll: -10, chest: st.chest + 6 * a, chestRoll: -6 * a, twist: st.twist + 12 * a, hipLean: st.hipLean + 5 * a, rootX: -0.05 * a, pitch: st.pitch + 18 * a, ...offHand(ph, 0.22, 1.32, 0.12, 1) } },
    { f: 6, e: 'out', p: { head: st.head + 14 * h, headRoll: -6, rootX: -0.07 * a } },
    { f: 20, e: 'in', reset: true },
  ]);
  clips.hitBody2 = R([
    { f: 2, e: 'snap', p: { chest: st.chest - 16 * a, spine: st.spine - 8 * a, twist: st.twist - 18 * a, hipYaw: st.hipYaw - 10 * a, hipLean: st.hipLean + 6 * a, head: st.head - 8 * h, headYaw: -12, hipY: st.hipY - 0.05 * a, rootX: -0.06 * a, pitch: st.pitch - 15, ...offHand(ph, 0.06, 1.05, 0.14, 0, 120) } },
    { f: 6, e: 'out', p: { chest: st.chest - 12 * a, rootX: -0.08 * a } },
    { f: 20, e: 'in', reset: true },
  ]);

  return clips as SharedClipSet;
}
