import { clip, type KeySpec } from './clip';
import type { GaitSpec } from './gait';
import { makePose, NEUTRAL, type Pose, type PosePatch } from './pose';
import { lyingPose, sharedClips, type Physique } from './shared';
import type { AnimSet } from './types';

/**
 * THANE — masked temple warden with a double-bladed saberstaff (Jedi Temple Guard formality +
 * Darth Maul's wushu spins and kicks + Inquisitor staff throws). Ceremonial stillness in neutral,
 * then flowing staff wheels when attacking: the staff keeps turning through every move (hits
 * alternate end A and end B), mixed with kicks. The mask hides the face, so the chest and hips carry
 * the emotion. See artifacts/animation-reference.md §2.6 / §3.4.
 *
 * Staff rig: (gx, gy, gz) = staff centre, pitch/yaw = staff axis, blade A along +axis, B along -axis.
 * off 0 = both hands 0.15 either side of the centre; off 1 = sword hand at the centre (one-handed
 * spins), off hand free. World pitch of the staff = pitch + spin.
 *
 * Staff-wheel rules used throughout (checked frame by frame against the head/torso):
 * - wheels turn in the x–y plane on the camera side (gz ≥ 0.26) with the centre in front of the chest;
 * - while an end swings up-and-back past the mask the wheel tilts in yaw (±40–55°) so that end
 *   foreshortens toward the camera instead of crossing the face, and is back near yaw 0 on contact;
 * - horizontal (yaw) spins only happen overhead, at the hip in front of the body, or with the
 *   staff rotating together with the body (spinY), never through the torso.
 */

const DEG = Math.PI / 180;

/** A point `d` along the staff axis from its centre (to put the free hand on the shaft). */
function along(gx: number, gy: number, gz: number, pitch: number, yaw: number, d: number): PosePatch {
  const p = pitch * DEG;
  const y = yaw * DEG;
  return { ox: gx + d * Math.cos(p) * Math.cos(y), oy: gy + d * Math.sin(p), oz: gz + d * Math.cos(p) * Math.sin(y) };
}

export function thaneAnims(): AnimSet {
  const ph: Physique = { amp: 1, head: 0.6, dual: false };

  // Temple Guard: upright, square, staff diagonal across the body (A up-forward, B down-back).
  const stance = makePose(NEUTRAL, {
    rootX: 0,
    hipY: 0.82,
    hipLean: -2,
    hipYaw: 0,
    hipRoll: 0,
    spine: 0,
    chest: 2,
    twist: 0,
    head: 0,
    gx: 0.3,
    gy: 1.15,
    gz: 0.2,
    pitch: 55,
    yaw: -6,
    roll: 0,
    off: 0,
    ox: 0.3,
    oy: 1.3,
    oz: -0.1,
    palm: 0,
    fx: 0.3,
    fKnee: 4,
    bx: -0.36,
    bKnee: 16,
    nElbow: 0,
    fElbow: 0,
  });
  const S = (p: PosePatch): Pose => makePose(stance, p);
  const st = stance;

  // Standing block: the staff becomes a near-vertical wall in front, weight back.
  const guard = S({ rootX: -0.03, hipY: 0.8, gx: 0.38, gy: 1.27, gz: 0.22, pitch: 82, yaw: -4, twist: 6, chest: 5, hipLean: -4, head: -2, bKnee: 20 });
  // Feet stay close to the stance spacing so crouching never triggers a re-plant step.
  const crouch = S({
    hipY: 0.56,
    hipLean: -14,
    spine: -4,
    chest: 2,
    head: 4,
    gx: 0.36,
    gy: 0.88,
    gz: 0.26,
    pitch: 24,
    yaw: -4,
    twist: 4,
    fx: 0.34,
    bx: -0.42,
    fKnee: 12,
    bKnee: 28,
  });
  // Low block: staff a low bar in front, the A end near the floor.
  const crouchGuard = makePose(crouch, { gx: 0.46, gy: 0.8, gz: 0.3, pitch: -14, yaw: 4, twist: 8, hipLean: -10, chest: 4 });

  const shared = sharedClips({ stance, guard, crouch, crouchGuard }, ph);
  // Staff lies along the deck beside him on the camera side (never across his body).
  const lying = lyingPose(stance, ph, { gx: 0.0, gy: 0.42, gz: 0.46, pitch: 92, yaw: 0, bx: -0.12, fx: -0.06 });

  // Gliding procession: low lift, tiny bob, the staff steady.
  const walk: GaitSpec = { kind: 'shuffle', base: S({ pitch: 60 }), stride: 1.26, lift: 0.04, bob: 0.01, lean: 0, sway: 1.5, armPump: 0, bladeBob: 1, toe: 8 };
  const walkBack: GaitSpec = { ...walk, base: S({ pitch: 66, rootX: -0.02, chest: 4 }), stride: 1.06, lift: 0.035, lean: 1 };
  // Run: one hand, the staff carried level like a lance (A leading low, B trailing high), off arm pumping.
  const runBase = S({
    rootX: 0.02,
    hipY: 0.8,
    hipLean: -25,
    spine: -6,
    chest: -4,
    twist: 6,
    head: 8,
    gx: -0.16,
    gy: 0.98,
    gz: 0.28,
    pitch: -12,
    yaw: 6,
    off: 1,
    ox: 0.25,
    oy: 1.15,
    oz: -0.14,
    palm: 0,
    fx: 0.06,
    bx: -0.04,
    fKnee: 0,
    bKnee: 0,
  });
  // Robed run: lower heel kick so the robe's back panel doesn't wing up behind him.
  const run: GaitSpec = { kind: 'run', base: runBase, stride: 2.1, lift: 0.3, bob: 0.05, lean: -4, sway: 12, armPump: 0.24, bladeBob: 4, stance: 0.36, heelKick: 0.14 };

  /** Attack lag: hips lead, the torso trails ~1 f and the head ~2 f (successive breaking). */
  const L = { lagTorso: 0.9, lagHead: 1.8 };

  // ------------------------------------------------------------- idle: 3.5 s breath + figure-8
  const idleKeys: KeySpec[] = [];
  const PERIOD = 210;
  const N = 21;
  for (let i = 1; i <= N; i += 1) {
    const f = (i * PERIOD) / N;
    const th = (2 * Math.PI * f) / PERIOD;
    const inhale = 0.4 * PERIOD;
    const u = f <= inhale ? f / inhale : 1 - (f - inhale) / (PERIOD - inhale);
    const br = u * u * (3 - 2 * u);
    idleKeys.push({
      f,
      e: 'lin',
      p: {
        pitch: st.pitch + 8 * Math.sin(th),
        yaw: st.yaw + 4 * Math.sin(2 * th),
        gx: st.gx + 0.012 * Math.sin(2 * th),
        chest: st.chest + 1.6 * br,
        spine: st.spine + 0.6 * br,
        gy: st.gy + 0.014 * br,
        head: st.head - 0.8 * br,
        hipY: st.hipY - 0.004 * br,
      },
    });
  }

  // Idle flourish 1: one-handed figure-8 — the staff wheels forward twice, the wheel plane rocking
  // from one side to the other each half turn (Maul's flourish, but slow and ceremonial).
  const fig8: KeySpec[] = [
    { f: 10, p: { off: 1, ox: 0.1, oy: 1.0, oz: -0.24, palm: 0, gx: 0.5, gy: 1.12, gz: 0.36, pitch: 70, yaw: 0, chest: 3, head: 2 } },
  ];
  for (let i = 1; i <= 8; i += 1) {
    const side = i % 2 === 1 ? 1 : -1;
    fig8.push({ f: 10 + i * 7, p: { pitch: 70 - 90 * i, yaw: i % 2 === 1 ? -52 : -18, twist: 6 * side, hipYaw: 3 * side, gx: 0.5 + 0.03 * side } });
  }
  fig8.push(
    { f: 80, p: { pitch: st.pitch - 720 + 4, yaw: st.yaw, gx: 0.34, gy: 1.18, gz: 0.24, twist: 0, hipYaw: 0, off: 0, chest: 1, head: -5 } },
    { f: 92, p: { head: -2 } },
    { f: 104, reset: true, p: { pitch: st.pitch - 720 } },
  );

  // Idle flourish 2: helicopter twirl overhead, then the staff is planted vertical (Temple Guard
  // sentry pose) with a slight nod, then back to the diagonal.
  const twirl: KeySpec[] = [
    { f: 8, p: { off: 1, ox: 0.16, oy: 1.08, oz: -0.24, palm: 0, gx: 0.34, gy: 1.42, gz: 0.28, pitch: 88, yaw: 0, chest: 3, head: 3 } },
    { f: 14, p: { gx: 0.14, gy: 1.98, gz: 0.08, pitch: 6, yaw: 0, ox: -0.12, oy: 1.4, oz: -0.4, palm: 1, head: 6, chest: 4 } },
  ];
  for (let i = 1; i <= 6; i += 1) twirl.push({ f: 14 + i * 5, p: { yaw: -120 * i, hipYaw: i % 2 === 1 ? 4 : -4, gx: i % 2 === 1 ? 0.16 : 0.12 } });
  twirl.push(
    { f: 46, p: { gx: 0.44, gy: 1.92, gz: 0.2, yaw: -720 } },
    { f: 52, p: { gx: 0.44, gy: 1.24, gz: 0.3, pitch: 90, yaw: -720, hipYaw: 0, head: 0, ox: 0.18, oy: 1.08, oz: -0.24, palm: 0 } },
    { f: 56, e: 'out', p: { gy: 1.17, hipY: 0.81, head: -6, chest: 0 } },
    { f: 76, p: { head: -4, chest: 1 } },
    { f: 92, p: { off: 0, gx: 0.32, gy: 1.16, pitch: 62, head: 0 } },
    { f: 100, reset: true, p: { yaw: st.yaw - 720 } },
  );

  const clips = {
    ...shared,

    idle: clip(stance, idleKeys, { loop: true, lagTorso: 3, lagHead: 6 }),
    idleBreak: clip(stance, fig8, { lagTorso: 2, lagHead: 4 }),
    idleBreak2: clip(stance, twirl, { lagTorso: 2, lagHead: 4 }),

    // ------------------------------------------------------------- transitions
    crouchDown: clip(stance, [
      { f: 3, p: { hipY: 0.52, hipLean: -16, spine: -5, chest: 1, head: 5, gx: 0.36, gy: 0.86, gz: 0.25, pitch: 30, yaw: -4, twist: 4, fx: 0.34, bx: -0.42, fKnee: 14, bKnee: 30 } },
      { f: 5, e: 'out', p: { ...crouch } },
    ], { lagTorso: 0.6, lagHead: 1.2 }),
    standUp: clip(crouch, [
      { f: 3, p: { hipY: 0.74, hipLean: -7, spine: -2, chest: 2, head: 2, gx: 0.32, gy: 1.06, pitch: 44, twist: 2, fx: 0.32, bx: -0.38, fKnee: 6, bKnee: 20 } },
      { f: 5, p: { hipY: 0.84, hipLean: -1, pitch: 58, gy: 1.17 } },
      { f: 7, e: 'out', p: { ...stance } },
    ], { lagTorso: 0.6, lagHead: 1.2 }),
    runStart: clip(stance, [
      { f: 3, p: { hipLean: -14, hipY: 0.78, spine: -3, chest: -2, twist: 4, head: 4, off: 1, ox: 0.26, oy: 1.18, oz: -0.16, palm: 0, gx: 0.14, gy: 1.04, gz: 0.28, pitch: 22, yaw: 4, fx: 0.36, bx: -0.3, by: 0.12, bPitch: 30 } },
      { f: 6, p: { hipLean: -24, hipY: 0.79, spine: -5, chest: -4, head: 7, gx: -0.06, gy: 0.98, pitch: -6, yaw: 6, bx: 0.12, by: 0.3, bPitch: 20, fx: 0.12, fPitch: 30, ox: -0.02, oy: 1.08 } },
      { f: 9, p: { ...runBase, fx: 0.42, fy: 0, fPitch: 0, bx: -0.24, by: 0.2, bPitch: 30 } },
    ], { lagTorso: 0.6, lagHead: 1.2 }),

    // ------------------------------------------------------------- reactions (staff flavour)
    // The mask can't emote: chest/spine carry the hit, the head is damped (x0.6).
    hitHigh: clip(stance, [
      { f: 2, e: 'snap', p: { head: 14, headYaw: -8, headRoll: 5, chest: st.chest + 12, spine: 4, hipLean: st.hipLean + 7, rootX: -0.05, pitch: st.pitch + 22, gx: st.gx - 0.02, gy: st.gy + 0.06, off: 1, ox: 0.16, oy: 1.5, oz: 0.02, palm: 1 } },
      { f: 6, e: 'out', p: { head: 10, chest: st.chest + 9, rootX: -0.07 } },
      { f: 12, p: { head: 4, chest: st.chest + 4, pitch: st.pitch + 8, off: 0 } },
      { f: 20, e: 'in', reset: true },
    ], L),
    // Alternate high hit: snaps the other way, staff knocked down, free arm flung out back.
    hitHigh2: clip(stance, [
      { f: 2, e: 'snap', p: { head: 12, headYaw: 10, headRoll: -7, chest: st.chest + 11, spine: 3, chestRoll: -5, hipLean: st.hipLean + 6, twist: -10, rootX: -0.05, pitch: st.pitch - 22, gx: st.gx + 0.04, gy: st.gy - 0.04, off: 1, ox: -0.26, oy: 1.34, oz: -0.32, palm: 1 } },
      { f: 6, e: 'out', p: { head: 8, chest: st.chest + 8, rootX: -0.07, twist: -8 } },
      { f: 12, p: { head: 3, chest: st.chest + 3, chestRoll: 0, pitch: st.pitch - 6, twist: -3, off: 0 } },
      { f: 20, e: 'in', reset: true },
    ], L),
    // Alternate body hit: folds with a twist, staff snapped vertical to cover, hand to the ribs.
    hitBody2: clip(stance, [
      { f: 2, e: 'snap', p: { chest: st.chest - 16, spine: st.spine - 9, hipLean: st.hipLean + 7, twist: -16, hipYaw: -8, head: -6, hipY: st.hipY - 0.05, rootX: -0.06, gx: st.gx + 0.06, gy: st.gy + 0.04, pitch: 84, off: 1, ox: 0.08, oy: 1.08, oz: -0.12, palm: 0 } },
      { f: 6, e: 'out', p: { chest: st.chest - 13, rootX: -0.08, twist: -12 } },
      { f: 12, p: { chest: st.chest - 5, twist: -4, hipYaw: -2, pitch: 70, off: 0 } },
      { f: 20, e: 'in', reset: true },
    ], L),
    // Heavy high: chest heaves back, mask thrown up, the staff spins 90 degrees loose in one hand
    // (wheel tilted so the free end swings toward the camera, clear of the mask).
    hitHighHeavy: clip(stance, [
      { f: 2, e: 'snap', p: { head: 24, headYaw: -12, chest: st.chest + 24, spine: 12, hipLean: st.hipLean + 14, hipY: st.hipY - 0.03, rootX: -0.1, fy: 0.05, fPitch: 20, off: 1, ox: -0.4, oy: 1.42, oz: -0.24, palm: 1, gx: 0.4, gy: 1.38, gz: 0.32, pitch: 95, yaw: -30, twist: -10 } },
      { f: 8, e: 'out', p: { pitch: 140, yaw: -48, head: 18, chest: st.chest + 18, bx: st.bx - 0.16, fy: 0, fPitch: 0, rootX: -0.14, gx: 0.42, gy: 1.42 } },
      { f: 16, p: { head: 8, chest: st.chest + 7, spine: 4, hipLean: st.hipLean + 5, pitch: 118, yaw: -24, gx: 0.36, gy: 1.3, off: 0, palm: 0, twist: 0, bx: st.bx - 0.08, by: 0.04 } },
      { f: 21, p: { by: 0, bx: st.bx } },
      { f: 26, e: 'in', reset: true },
    ], L),
    // Heavy body: deep gut fold, the staff dips and spins 90 degrees loose the other way.
    hitBodyHeavy: clip(stance, [
      { f: 2, e: 'snap', p: { chest: st.chest - 34, spine: st.spine - 16, hipLean: st.hipLean + 16, head: -10, hipY: st.hipY - 0.12, rootX: -0.12, fPitch: 15, bPitch: 15, off: 1, ox: 0.14, oy: 0.98, oz: 0.1, palm: 0, gx: 0.4, gy: 0.98, gz: 0.3, pitch: 10 } },
      { f: 9, e: 'out', p: { chest: st.chest - 38, rootX: -0.16, hipY: st.hipY - 0.14, pitch: -35 } },
      { f: 18, p: { chest: st.chest - 12, spine: st.spine - 4, head: 6, hipY: st.hipY - 0.05, fPitch: 0, bPitch: 0, pitch: 20, gx: 0.34, gy: 1.08, off: 0 } },
      { f: 26, e: 'in', reset: true },
    ], L),
    // Heavy low: knee buckles, the A end planted in the floor like a crutch.
    hitLowHeavy: clip(stance, [
      { f: 2, e: 'snap', p: { hipY: 0.6, fx: st.fx - 0.04, fKnee: 12, bKnee: 20, chest: st.chest - 18, hipLean: st.hipLean - 6, head: -8, rootX: -0.1, gx: 0.55, gy: 1.05, gz: 0.3, pitch: -70, yaw: 6, off: 1, ox: -0.25, oy: 1.15, oz: -0.22, palm: 1 } },
      { f: 10, e: 'out', p: { hipY: 0.58, chest: st.chest - 20 } },
      { f: 18, p: { hipY: 0.72, chest: st.chest - 8, head: -2, pitch: -10, yaw: -30, gx: 0.48, gy: 1.12, off: 0 } },
      { f: 26, e: 'in', reset: true },
    ], L),
    // Spin-out: body wrenched round, the staff whirls a full turn loose before he regrips.
    stagger: clip(stance, [
      { f: 3, e: 'snap', p: { twist: -50, hipYaw: -40, headYaw: -30, chest: st.chest + 12, spine: 4, head: 10, off: 1, ox: -0.42, oy: 1.45, oz: -0.36, palm: 1, gx: 0.4, gy: 1.48, gz: 0.32, pitch: 120, yaw: -45, rootX: -0.08 } },
      { f: 10, e: 'out', p: { bx: st.bx - 0.2, by: 0.04, hipY: st.hipY - 0.04, twist: -40, pitch: 230, yaw: -20, gx: 0.24, gy: 1.2 } },
      { f: 14, p: { by: 0 } },
      { f: 18, p: { fx: st.fx - 0.15, fy: 0.06, hipYaw: -20, headYaw: -12, pitch: 300, yaw: -40, gx: 0.34, gy: 1.26 } },
      { f: 24, p: { fy: 0, hipY: st.hipY - 0.02, pitch: 380, yaw: -10, gx: 0.28, gy: 1.18, off: 0, palm: 0, twist: -10, chest: st.chest + 3, head: 2 } },
      { f: 32, e: 'in', reset: true, p: { pitch: st.pitch + 360 } },
    ], L),
    clash: clip(stance, [
      { f: 0, p: { rootX: 0.08, gx: 0.6, gy: 1.26, gz: 0.26, pitch: 24, yaw: 0, twist: 10, hipLean: -8, chest: -6, fx: st.fx + 0.12 } },
      { f: 4, e: 'hold', p: { pitch: 26 } },
      { f: 8, e: 'out', p: { rootX: -0.12, gx: 0.44, gy: 1.36, pitch: 96, hipLean: st.hipLean + 10, chest: st.chest + 8, head: 6, fx: st.fx - 0.02, bx: st.bx - 0.12, by: 0.04 } },
      { f: 11, p: { by: 0 } },
      { f: 18, reset: true },
    ], L),
    thrownVictim: clip(stance, [
      { f: 3, e: 'snap', p: { chest: st.chest - 20, spine: st.spine - 10, head: -8, hipY: st.hipY - 0.06, rootX: 0.03, gx: 0.4, gy: 0.98, gz: 0.32, pitch: -34, off: 1, ox: 0.16, oy: 1.25, oz: 0.04, palm: 0 } },
      { f: 12, p: { rootX: 0.07, chest: st.chest - 24 } },
      { f: 20, p: { rootX: 0.05 } },
    ], L),
    // Electrocuted: arched and convulsing, the staff held level at the hip (never across the mask).
    shocked: (() => {
      const k: KeySpec[] = [
        { f: 0, p: {} },
        { f: 13, e: 'snap', p: { chest: st.chest + 22, spine: st.spine + 10, hipLean: st.hipLean + 10, head: st.head + 20, headRoll: 8, hipY: st.hipY - 0.04, rootX: -0.06, gx: 0.46, gy: 0.98, gz: 0.34, pitch: -14, yaw: 10, off: 1, ox: 0.2, oy: 1.55, oz: -0.12, palm: 1, fKnee: 14, bKnee: 14 } },
      ];
      for (let f = 15, i = 0; f <= 57; f += 2, i += 1) {
        const u = (f - 13) / 45;
        const j = i % 2 === 0 ? 1 : -1;
        k.push({
          f,
          e: 'lin',
          p: {
            hipY: st.hipY - 0.04 - 0.22 * u,
            chest: st.chest + 22 + 4 * j,
            head: st.head + 20 + 3 * j,
            headRoll: 8 * j,
            hipLean: st.hipLean + 10 - 6 * u,
            ox: 0.2 + 0.03 * j,
            oy: 1.55 - 0.15 * u + 0.02 * j,
            gy: 0.98 - 0.2 * u,
            pitch: -14 + 4 * j,
            fx: st.fx + 0.06 * u,
            bx: st.bx + 0.1 * u,
            fKnee: 14 + 10 * u,
            bKnee: 14 + 10 * u,
          },
        });
      }
      k.push({ f: 62, e: 'out', p: { chest: st.chest + 30, head: st.head + 24, hipY: st.hipY - 0.2, rootX: -0.12 } });
      return clip(stance, k, { lagTorso: 0.3, lagHead: 0.6 });
    })(),
    // Choked: the free hand claws at the throat, the staff hangs vertical at his side, toes kicking.
    gripVictim: (() => {
      const kick = (f: number, s: number): KeySpec => ({ f, p: { fx: 0.12 * s, bx: -0.12 * s, fy: 0.05 + 0.04 * s, by: 0.05 - 0.04 * s } });
      return clip(stance, [
        { f: 6, e: 'snap', p: { head: 16, chest: st.chest + 10, hipLean: 4, spine: 3, gx: 0.36, gy: 1.12, gz: 0.34, pitch: -86, yaw: 10, off: 1, ox: 0.12, oy: 1.52, oz: 0.02, palm: 1, hipY: 0.94, fx: 0.08, bx: -0.08, fPitch: 50, bPitch: 50, fKnee: 6, bKnee: 6 } },
        { f: 9, p: { ox: 0.1, oy: 1.55, oz: 0.04, gx: 0.34, gy: 1.16, headRoll: 6 } },
        kick(12, 1),
        kick(18, -1),
        kick(24, 1),
        kick(30, -1),
        kick(36, 1),
        kick(42, -1),
        { f: 46, p: { fx: 0.05, bx: -0.05, head: 18 } },
      ]);
    })(),

    // Falls: the body pinwheels while the staff whirls like a propeller in the flung hand. It always
    // comes to rest level (world pitch = pitch + spin = 0 mod 360) so no blade spears the floor.
    fallBlowback: clip(stance, [
      { f: 0, p: { hipLean: st.hipLean + 20, head: 20, chest: st.chest + 16, spine: 4, spin: 10, off: 1, ox: 0.1, oy: 1.65, oz: -0.1, palm: 1, gx: 0.34, gy: 1.62, gz: 0.32, pitch: 120, yaw: -30, fx: st.fx + 0.08, fy: 0.08 } },
      { f: 8, e: 'out', p: { spin: 40, fx: 0.45, fy: 0.3, bx: 0.2, by: 0.16, hipY: 0.95, gx: 0.08, gy: 1.88, pitch: 330, yaw: -10, ox: -0.2, oy: 1.78, oz: -0.25 } },
      { f: 16, e: 'lin', p: { spin: 70, fx: 0.48, fy: 0.24, bx: 0.3, by: 0.24, head: 15, pitch: 520, yaw: -30 } },
      { f: 26, e: 'in', p: { spin: 92, fy: 0.2, by: 0.15, hipLean: 4, head: 12, pitch: 600, yaw: -10 } },
      { f: 40, p: { spin: 95, fy: 0.08, by: 0.06, pitch: 805, yaw: 0, gx: 0.1, gy: 1.2, gz: 0.46 } },
    ], { lagTorso: 1.2, lagHead: 2.2 }),
    fallSweep: clip(stance, [
      { f: 0, p: { spin: 25, fx: 0.45, fy: 0.35, bx: 0.25, by: 0.3, head: 8, gx: 0.3, gy: 1.6, gz: 0.32, pitch: 100, yaw: -30, off: 1, ox: -0.1, oy: 1.7, oz: -0.2, palm: 1 } },
      { f: 8, e: 'out', p: { spin: 70, fx: 0.5, fy: 0.3, pitch: 200, yaw: -20 } },
      { f: 16, e: 'in', p: { spin: 92, fy: 0.2, by: 0.18, pitch: 250, yaw: -6 } },
      { f: 30, p: { spin: 95, fy: 0.05, by: 0.05, pitch: 445, yaw: 0, gx: 0.1, gy: 1.2, gz: 0.46 } },
    ], { lagTorso: 1, lagHead: 2 }),
    fallSpin: clip(stance, [
      { f: 0, p: { spin: 20, hipLean: st.hipLean + 15, head: 18, gx: 0.08, gy: 1.85, gz: 0.3, pitch: 175, yaw: -10, off: 1, ox: -0.2, oy: 1.78, oz: -0.25, palm: 1 } },
      { f: 7, e: 'lin', p: { spin: 110, fx: 0.15, fy: 0.45, bx: -0.05, by: 0.5, hipY: 0.95, gx: 0.2, gy: 1.3, pitch: 120, ox: 0.1, oy: 1.2, oz: -0.15 } },
      { f: 15, e: 'lin', p: { spin: 230, fx: 0.3, fy: 0.35, bx: 0.1, by: 0.4, pitch: 90 } },
      { f: 24, e: 'lin', p: { spin: 350, fx: 0.4, fy: 0.3, gx: 0.08, gy: 1.85, pitch: 150, ox: -0.2, oy: 1.78, oz: -0.25 } },
      { f: 32, e: 'out', p: { spin: 448, fy: 0.15, by: 0.1, head: 12, pitch: 250, yaw: -30 } },
      { f: 42, p: { spin: 455, fy: 0.06, by: 0.05, pitch: 445, yaw: 0, gx: 0.1, gy: 1.2, gz: 0.46 } },
    ], { lagTorso: 0.8, lagHead: 1.6 }),
    fallThrow: clip(stance, [
      { f: 0, p: { spin: 30, tilt: 10, hipLean: st.hipLean + 10, gx: 0.08, gy: 1.85, gz: 0.3, pitch: 175, yaw: -10, off: 1, ox: -0.2, oy: 1.78, oz: -0.25, palm: 1, fx: 0.3, fy: 0.25 } },
      { f: 12, e: 'lin', p: { spin: 200, tilt: -20, fx: 0.1, fy: 0.45, bx: 0.2, by: 0.3, gx: 0.3, gy: 1.2, pitch: 90 } },
      { f: 26, e: 'out', p: { spin: 448, tilt: 0, fx: 0.4, fy: 0.15, bx: 0.15, by: 0.15, gx: 0.08, gy: 1.85, pitch: 255, yaw: -35 } },
      { f: 36, p: { spin: 455, fy: 0.05, by: 0.05, pitch: 445, yaw: 0, gx: 0.1, gy: 1.2, gz: 0.46 } },
    ], { lagTorso: 0.8, lagHead: 1.6 }),
    fallKo: clip(stance, [
      { f: 0, p: { spin: 15, hipLean: st.hipLean + 24, head: 27, chest: st.chest + 20, gx: 0.45, gy: 1.6, gz: 0.3, pitch: 120, yaw: -30, off: 1, ox: 0.35, oy: 1.5, oz: -0.1, palm: 1, fx: st.fx + 0.1, fy: 0.08, by: 0.06 } },
      { f: 12, e: 'out', p: { spin: 50, fx: 0.4, fy: 0.25, bx: 0.15, by: 0.12, hipY: 0.92, gx: -0.05, gy: 1.75, pitch: 200, yaw: -35, ox: -0.25, oy: 1.7, oz: -0.25 } },
      { f: 24, p: { spin: 80, head: 18, fy: 0.2, pitch: 240, yaw: -15 } },
      { f: 36, e: 'in', p: { spin: 95, fy: 0.08, by: 0.05, blade: 0.4, blade2: 0.4, pitch: 445, yaw: 0, gx: 0.1, gy: 1.2, gz: 0.46 } },
      { f: 50, p: { blade: 0, blade2: 0 } },
    ], { lagTorso: 1.6, lagHead: 3 }),

    // Floor clips rebuilt on Thane's lying pose (staff dropped beside him, not across the body).
    bounce: clip(stance, [
      { f: 0, p: { ...lying, spin: 80, hipY: 0.26, fx: lying.fx + 0.35, bx: lying.bx + 0.25, gx: lying.gx + 0.2, ox: lying.ox + 0.3 } },
      { f: 6, e: 'out', p: { spin: 90, hipY: 0.2, fx: lying.fx + 0.12, bx: lying.bx + 0.08, gx: lying.gx + 0.06 } },
      { f: 14, e: 'in', p: { ...lying } },
    ], { lagTorso: 1, lagHead: 2 }),
    knockdown: clip(stance, [
      { f: 0, p: { ...lying, fx: lying.fx + 0.22, bx: lying.bx + 0.12, gx: lying.gx + 0.14, spin: 92 } },
      { f: 5, e: 'out', p: { fx: lying.fx + 0.04, bx: lying.bx, gx: lying.gx, spin: 87 } },
      { f: 12, p: { ...lying } },
      { f: 40, p: { chest: lying.chest + 3, head: lying.head + 6 } },
    ], { lagTorso: 1, lagHead: 2 }),
    // KO: lies still, blades retract; the hilt rests in the open hand.
    koLie: clip(stance, [
      { f: 0, p: { ...lying, ox: -0.4, oy: 1.35, oz: -0.4, palm: 1 } },
      { f: 16, p: { blade: 0, blade2: 0, head: 6, headYaw: -40 } },
    ], { lagTorso: 0, lagHead: 0 }),

    // ------------------------------------------------------------- locomotion
    // Back-hop while the staff spins a full shield wheel in front (tilted so the top of the wheel
    // passes toward the camera, not across the mask).
    backdash: clip(stance, [
      { f: 2, e: 'out', p: { off: 1, ox: 0.18, oy: 1.28, oz: -0.2, palm: 1, gx: 0.52, gy: 1.3, gz: 0.3, pitch: 96, yaw: -10, hipY: 0.76, hipLean: 4, chest: 6, fx: 0.32, fPitch: 10 } },
      { f: 5, e: 'out', p: { pitch: 175, yaw: -45, rootX: -0.06, hipY: 0.9, fy: 0.16, by: 0.26, fPitch: 30, bPitch: 30, fx: 0.24, bx: -0.3 } },
      { f: 7, e: 'lin', p: { pitch: 255, yaw: -15, fy: 0.15, by: 0.22 } },
      { f: 9, e: 'lin', p: { pitch: 330, yaw: -5, fy: 0.12, by: 0.16 } },
      { f: 11, e: 'lin', p: { pitch: 400, yaw: -25, fy: 0.05, by: 0.06 } },
      { f: 13, e: 'out', p: { pitch: 450, yaw: -12, fy: 0, by: 0, fPitch: 0, bPitch: 0, hipY: 0.74, rootX: -0.02, chest: 2 } },
      { f: 18, reset: true, p: { pitch: st.pitch + 360 } },
    ]),

    runStop: clip(runBase, [
      { f: 2, e: 'out', p: { hipLean: 8, spine: 2, chest: 6, head: -2, fx: 0.46, fPitch: -25, bx: -0.4, hipY: 0.72, rootX: -0.04, pitch: 6, gx: 0.05, gy: 1.0 } },
      { f: 5, p: { pitch: 38, gx: 0.24, gy: 1.08, off: 0, palm: 0, bx: -0.38, by: 0.05, fPitch: -5, hipLean: 2 } },
      { f: 9, reset: true, p: { ...stance } },
    ]),

    jumpSquat: clip(stance, [{ f: 4, e: 'out', p: { hipY: 0.64, hipLean: -12, chest: -6, head: 6, gy: 1.02, gx: 0.3, pitch: 70, fPitch: 0, bPitch: 10, fKnee: 10, bKnee: 22 } }], { lagTorso: 0.4, lagHead: 0.8 }),

    // Neutral: tuck, staff vertical out in front, free hand back for balance.
    jumpUp: clip(stance, [
      { f: 0, p: { hipY: 0.95, fPitch: 45, bPitch: 45, fx: 0.12, bx: -0.12, gx: 0.42, gy: 1.32, gz: 0.28, pitch: 86, yaw: -4, off: 1, ox: -0.25, oy: 1.4, oz: -0.25, palm: 1, hipLean: 0, head: 4 } },
      { f: 8, e: 'out', p: { fy: 0.26, by: 0.3, fx: 0.2, bx: -0.06 } },
      { f: 20, p: { fy: 0.46, by: 0.5, fx: 0.24, bx: -0.02, fKnee: 10, bKnee: 10, chest: -8, hipLean: -8, gy: 1.26, pitch: 92 } },
      { f: 31, p: { fy: 0.06, by: 0.09, fx: 0.26, bx: -0.3, fKnee: 4, bKnee: 16, chest: 2, hipLean: -2, gx: 0.32, gy: 1.15, pitch: 62, off: 0, palm: 0 } },
      { f: 43, p: { fy: 0, by: 0, fPitch: 20, bPitch: 20, pitch: 55 } },
    ]),

    // Layout front flip; the staff counter-rotates so it holds its world angle while the body turns.
    jumpFwd: clip(stance, [
      { f: 0, p: { hipY: 0.96, fPitch: 45, bPitch: 45, fx: 0.15, bx: -0.15, gx: 0.36, gy: 1.4, gz: 0.3, pitch: 50, yaw: -10, off: 1, ox: -0.25, oy: 1.4, oz: -0.2, palm: 1, head: 6, hipLean: 0 } },
      { f: 6, e: 'out', p: { spin: -40, pitch: 90, fy: 0.12, by: 0.2, fx: 0.1, bx: -0.3, chest: -6, head: -4 } },
      { f: 15, e: 'lin', p: { spin: -180, pitch: 230, fy: 0.08, by: 0.14, fx: 0.06, bx: -0.36, chest: 4, spine: 4, head: 6, ox: -0.3, oy: 1.75 } },
      { f: 24, e: 'lin', p: { spin: -300, pitch: 350 } },
      { f: 30, e: 'out', p: { spin: -360, pitch: 400, fy: 0.18, by: 0.2, fx: 0.25, bx: -0.2, chest: -2, spine: 0, head: 0, gx: 0.32, gy: 1.2, ox: 0.2, oy: 1.25, oz: -0.2 } },
      { f: 36, p: { fy: 0.05, by: 0.08, bx: -0.3, pitch: 412, off: 0, palm: 0, gy: 1.15, yaw: -6 } },
      { f: 43, p: { fy: 0, by: 0, fPitch: 20, bPitch: 20, pitch: 415 } },
    ]),

    // Maul layout back-flip, staff vertical against the body.
    jumpBack: clip(stance, [
      { f: 0, p: { hipY: 0.96, fPitch: 40, bPitch: 40, gx: 0.24, gy: 1.35, gz: 0.3, pitch: 90, yaw: 0, off: 1, ox: 0.1, oy: 1.85, oz: -0.2, palm: 1, head: 12, hipLean: 4, chest: 6 } },
      { f: 8, e: 'out', p: { spin: 60, fy: 0.1, by: 0.14, fx: 0.24, bx: -0.12, chest: 12, head: 18 } },
      { f: 18, e: 'lin', p: { spin: 200, fy: 0.14, by: 0.18 } },
      { f: 28, e: 'out', p: { spin: 340, fy: 0.15, by: 0.15, chest: 2, head: 0, ox: 0.2, oy: 1.25, oz: -0.2 } },
      { f: 34, p: { spin: 360, fy: 0.05, by: 0.05, pitch: 60, gx: 0.3, gy: 1.15, off: 0, palm: 0 } },
      { f: 43, p: { fy: 0, by: 0, fPitch: 20, bPitch: 20, pitch: 55 } },
    ]),

    // Ray Park butterfly twist: the body goes flat (face down) and whirls round the vertical axis,
    // legs scissoring, around the staff held world-vertical in front (always reads full length).
    jumpRun: clip(stance, [
      { f: 0, p: { hipY: 0.94, hipLean: -24, fx: 0.3, bx: -0.35, fy: 0.1, by: 0.2, fPitch: 40, bPitch: 40, gx: -0.16, gy: 0.98, gz: 0.28, pitch: -12, yaw: 6, off: 1, ox: 0.25, oy: 1.15, oz: -0.14, palm: 0 } },
      { f: 2, p: { spin: -14, hipLean: -16, gx: 0.2, gy: 1.3, gz: 0.34, pitch: 60, yaw: 0, head: 6 } },
      { f: 4, p: { spin: -44, spinY: 20, hipLean: -10, gx: 0.32, gy: 1.7, gz: 0.3, pitch: 134, head: 9 } },
      // Flat twist: the staff stays world-vertical (pitch = 90 - spin) like a pole he whirls round.
      { f: 6, e: 'out', p: { spin: -72, spinY: 70, hipLean: -6, chest: 0, head: 10, gx: 0.36, gy: 1.84, gz: 0.26, pitch: 162, ox: 0.25, oy: 1.1, oz: -0.45, palm: 1, fx: 0.3, fy: 0.05, bx: -0.55, by: 0.25, fKnee: 0, bKnee: 0, fPitch: 50, bPitch: 50 } },
      { f: 12, e: 'lin', p: { spinY: 210, spin: -80, pitch: 170, fx: -0.5, fy: 0.22, bx: 0.3, by: 0.05 } },
      { f: 18, e: 'lin', p: { spinY: 330, spin: -64, pitch: 154, fx: 0.3, fy: 0.05, bx: -0.5, by: 0.25 } },
      { f: 20, p: { spinY: 352, spin: -36, pitch: 126, gy: 1.76 } },
      { f: 22, p: { spinY: 360, spin: -12, hipLean: -6, pitch: 100, gx: 0.36, gy: 1.5, gz: 0.28, fy: 0.2, by: 0.22 } },
      { f: 24, p: { spin: 0, pitch: 88, gx: 0.36, gy: 1.32 } },
      { f: 27, e: 'out', p: { hipLean: -4, head: 0, fx: 0.25, fy: 0.2, bx: -0.25, by: 0.18, gx: 0.32, gy: 1.2, gz: 0.26, pitch: 55, yaw: -6, ox: 0.2, oy: 1.25, oz: -0.2, palm: 0 } },
      { f: 43, p: { fy: 0.02, by: 0.05, fx: 0.3, bx: -0.36, fPitch: 20, bPitch: 20, off: 0 } },
    ]),

    // Knees absorb; the staff swings horizontal overhead like a balance pole.
    land: clip(stance, [
      { f: 0, p: { hipY: 0.68, hipLean: -10, chest: -6, gx: 0.16, gy: 1.76, gz: 0.2, pitch: 2, yaw: 0, off: 1, ...along(0.16, 1.76, 0.2, 2, 0, 0.42), fKnee: 10, bKnee: 22 } },
      { f: 3, e: 'out', p: { hipY: 0.72, gy: 1.72, pitch: -3 } },
      { f: 6, p: { hipY: 0.8, gx: 0.3, gy: 1.4, pitch: 30, off: 0 } },
      { f: 9, reset: true },
    ], { lagTorso: 1, lagHead: 1.6 }),
    // Heavy landing (flips, run jumps): deep absorb on one knee, B end planted beside the front
    // foot like a pole, off hand brushing the floor — then the warden rises.
    landHeavy: clip(stance, [
      { f: 0, p: { hipY: 0.54, hipLean: -22, spine: -6, chest: -8, head: 4, fx: 0.42, fKnee: 14, bx: -0.42, bKnee: 32, bPitch: 30, off: 1, ox: 0.3, oy: 0.06, oz: -0.22, palm: 1, gx: 0.5, gy: 1.12, gz: 0.32, pitch: 84, yaw: -6 } },
      { f: 3, e: 'out', p: { hipY: 0.5, hipLean: -24, chest: -10, gy: 1.1 } },
      { f: 7, p: { hipY: 0.68, hipLean: -10, spine: -2, chest: -2, head: 2, ox: 0.2, oy: 0.7, oz: -0.2, gx: 0.42, gy: 1.2, pitch: 72, bPitch: 10 } },
      { f: 10, p: { hipY: 0.8, hipLean: -4, off: 0, palm: 0, gx: 0.32, gy: 1.16, pitch: 58, bPitch: 0 } },
      { f: 13, reset: true },
    ], { lagTorso: 1, lagHead: 1.8 }),

    // ------------------------------------------------------------- attacks
    // Light 1 — pike jab: draw back with the tip raised, step and drive a long straight thrust.
    light: clip(stance, [
      { f: 2, p: { gx: 0.14, gy: 1.12, gz: 0.27, pitch: 38, yaw: -2, twist: -14, hipYaw: -9, chest: 4, rootX: -0.03, hipY: 0.81 } },
      { f: 4, e: 'out', p: { gx: -0.02, gy: 1.1, gz: 0.28, pitch: 30, yaw: 0, twist: -26, hipYaw: -16, chest: 6, rootX: -0.06, hipLean: 3, hipY: 0.8, fx: 0.36, fy: 0.05, fPitch: 12, bKnee: 22 } },
      { f: 5, e: 'lin', p: { gx: 0.42, gy: 1.16, pitch: 9, twist: 2, hipYaw: 2, fx: 0.5, fy: 0.03, rootX: 0.02, hipLean: -7, chest: -1 } },
      { f: 6, e: 'snap', p: { gx: 0.74, gy: 1.2, gz: 0.26, pitch: 3, twist: 18, hipYaw: 10, hipLean: -15, chest: -8, spine: -3, head: -3, fx: 0.56, fy: 0, fPitch: 0, rootX: 0.08, hipY: 0.78, by: 0.03, bPitch: 24 } },
      { f: 8, e: 'out', p: { gx: 0.78, pitch: 1, twist: 20 } },
      { f: 10, p: { gx: 0.58, gy: 1.17, pitch: 14, twist: 13 } },
      { f: 13, p: { gx: 0.38, gy: 1.16, pitch: 40, twist: 5, hipYaw: 3, hipLean: -6, chest: 0, spine: -1, head: -1, by: 0, bPitch: 0, fx: 0.44, fy: 0.04, rootX: 0.05 } },
      { f: 15, p: { fx: 0.32, fy: 0, gx: 0.31, pitch: 52, twist: 1, rootX: 0.02 } },
      { f: 18, reset: true },
    ], L),

    // Light 2 — end-B rising backhand: the staff wheels backward (wheel tilted toward the camera as
    // end A goes over), and the B end rips up from behind-low into the chest. Recovery keeps the
    // wheel turning under and round into stance.
    light2: clip(stance, [
      { f: 2, p: { gx: 0.24, gy: 1.06, gz: 0.28, pitch: 30, yaw: -10, twist: -16, hipYaw: -10, chest: 4, hipY: 0.79, rootX: -0.02 } },
      { f: 4, e: 'out', p: { gx: 0.14, gy: 0.98, gz: 0.3, pitch: 18, yaw: -14, twist: -26, hipYaw: -16, chest: 6, hipLean: 0, hipY: 0.76, rootX: -0.04, fx: 0.36, fy: 0.05, fPitch: 12 } },
      { f: 5, e: 'lin', p: { gx: 0.44, gy: 1.1, pitch: 104, yaw: -55, twist: 0, hipYaw: 0, chest: 0, hipY: 0.78, fx: 0.48, fy: 0.03, rootX: 0.02 } },
      { f: 6, e: 'snap', p: { gx: 0.62, gy: 1.12, gz: 0.28, pitch: 196, yaw: -8, twist: 24, hipYaw: 12, hipLean: -12, chest: -8, spine: -3, head: -2, fx: 0.54, fy: 0, fPitch: 0, rootX: 0.08, hipY: 0.77, by: 0.03, bPitch: 22 } },
      { f: 8, e: 'out', p: { pitch: 212, yaw: -14, gx: 0.64, gy: 1.16, twist: 27 } },
      { f: 11, p: { pitch: 258, yaw: -20, gx: 0.52, gy: 1.26, twist: 16, hipLean: -9 } },
      { f: 14, p: { pitch: 336, yaw: -12, gx: 0.42, gy: 1.22, twist: 6, hipYaw: 4, hipLean: -5, chest: -2, by: 0, bPitch: 0, fx: 0.44, fy: 0.04, rootX: 0.05 } },
      { f: 16, p: { pitch: 398, yaw: -7, gx: 0.33, gy: 1.17, fx: 0.32, fy: 0, rootX: 0.02 } },
      { f: 18, reset: true, p: { pitch: st.pitch + 360 } },
    ], L),

    // Light 3 — horizontal spinning cut with both ends: the body coils, end A sweeps round level at
    // shoulder height into the target, and the staff keeps spinning a full horizontal turn so end B
    // follows round before he returns to the diagonal.
    light3: clip(stance, [
      { f: 1, p: { gx: 0.32, gy: 1.3, gz: 0.34, pitch: 80, yaw: 0, off: 1, ox: -0.1, oy: 1.3, oz: -0.36, palm: 1, hipY: 0.78, twist: -10, fy: 0.03, by: 0.03 } },
      { f: 2, e: 'in', p: { spinY: 40, pitch: 62, fy: 0.06, by: 0.05, hipY: 0.8 } },
      { f: 4, e: 'lin', p: { spinY: 200, pitch: 10, gx: 0.34, fy: 0.08, by: 0.07, ox: -0.3, oy: 1.4, oz: -0.4 } },
      { f: 5, e: 'lin', p: { spinY: 300, gx: 0.48, fx: 0.46, fy: 0.05 } },
      { f: 6, e: 'snap', p: { spinY: 360, pitch: -4, yaw: -4, gx: 0.64, gy: 1.32, gz: 0.28, twist: 26, hipYaw: 14, hipLean: -10, chest: -6, head: -2, fx: 0.54, fy: 0, by: 0.03, bPitch: 26, rootX: 0.08, hipY: 0.78, ox: -0.36, oy: 1.38, oz: -0.36 } },
      { f: 8, e: 'out', p: { spinY: 372, yaw: -30, twist: 32 } },
      { f: 11, p: { spinY: 366, yaw: -40, pitch: 10, gx: 0.56, gy: 1.26, twist: 18, hipYaw: 8 } },
      { f: 14, p: { spinY: 361, yaw: -24, pitch: 36, gx: 0.44, gy: 1.2, twist: 6, hipYaw: 2, hipLean: -5, chest: -2, by: 0, bPitch: 0, fx: 0.42, fy: 0.04, rootX: 0.05, off: 0, palm: 0 } },
      { f: 16, p: { pitch: 50, yaw: -10, gx: 0.34, gy: 1.17, fx: 0.32, fy: 0, rootX: 0.02 } },
      { f: 18, reset: true, p: { spinY: 360 } },
    ], L),

    // Heavy — double-end windmill (Maul, TPM; Rey's staff, TFA). Cock back with the chest arched,
    // A chops over in front (hit 1), the wheel never stops: B comes over the top into a deep lunge
    // (hit 2), the wheel rolls on to vertical and he steps back to stance.
    heavy: clip(stance, [
      { f: 3, p: { pitch: 92, gx: 0.42, gy: 1.32, gz: 0.32, yaw: -10, twist: -10, chest: 4, hipYaw: -6 } },
      { f: 7, p: { pitch: 110, gx: 0.5, gy: 1.46, yaw: -15, twist: -26, hipYaw: -18, chest: 14, spine: 4, head: 6, rootX: -0.07, hipLean: 5, hipY: 0.76, fx: 0.34, fy: 0.05, fPitch: 18, bKnee: 26 } },
      { f: 10, e: 'hold', p: { pitch: 114, gy: 1.48, chest: 15 } },
      { f: 11, e: 'lin', p: { pitch: 58, gx: 0.54, gy: 1.4, yaw: -10, twist: 0, hipYaw: 0, chest: 0, spine: 0, head: 0, hipLean: -4, hipY: 0.77, fx: 0.5, fy: 0.03, fPitch: 0, rootX: 0.02 } },
      { f: 12, e: 'snap', p: { pitch: -10, yaw: -6, gx: 0.66, gy: 1.16, twist: 20, hipYaw: 12, chest: -12, spine: -3, hipLean: -14, rootX: 0.06, fx: 0.56, fy: 0, hipY: 0.75, head: -4 } },
      { f: 13, e: 'lin', p: { pitch: -48, yaw: -50, gx: 0.72, gy: 1.12 } },
      { f: 14, p: { pitch: -84, yaw: -60, gx: 0.74, gy: 1.12, bx: -0.44, by: 0.05 } },
      { f: 15, e: 'lin', p: { pitch: -122, yaw: -44, gx: 0.66, gy: 1.16, hipY: 0.72, bx: -0.54, by: 0.06, fx: 0.6, fy: 0.04 } },
      { f: 16, e: 'lin', p: { pitch: -156, yaw: -22 } },
      { f: 17, e: 'snap', p: { pitch: -184, yaw: -4, gx: 0.7, gy: 1.06, hipY: 0.66, bx: -0.64, by: 0.03, bPitch: 25, fx: 0.64, fy: 0, rootX: 0.12, twist: 30, hipYaw: 18, chest: -14, hipLean: -18, spine: -5, head: -6 } },
      { f: 19, e: 'out', p: { pitch: -206, yaw: -10, gx: 0.72, gy: 1.0 } },
      { f: 21, p: { pitch: -232, yaw: -58, gx: 0.76, gy: 1.14 } },
      { f: 24, p: { pitch: -260, yaw: -42, gx: 0.66, gy: 1.2, chest: -8, hipLean: -14, hipY: 0.7 } },
      { f: 28, p: { pitch: -284, yaw: -16, gx: 0.48, gy: 1.18, hipY: 0.76, bx: -0.46, by: 0.05, bPitch: 8, fx: 0.52, twist: 8, hipYaw: 2, chest: -3, hipLean: -8, spine: 0, rootX: 0.06, head: 0 } },
      { f: 31, p: { bx: -0.38, by: 0, bPitch: 0, fx: 0.42, fy: 0.04, pitch: -296, gx: 0.38 } },
      { f: 34, p: { fx: 0.32, fy: 0, pitch: -302, gx: 0.32, rootX: 0.02, twist: 2 } },
      { f: 37, reset: true, p: { pitch: st.pitch - 360 } },
    ], L),

    // Heavy finisher (combo ender): a full whirling turn with the staff ringing level (hit 1), then he
    // springs up and B comes over the top in an overhead smash to the floor (hit 2, front and back).
    heavyChain: clip(stance, [
      { f: 3, p: { spinY: -18, hipY: 0.78, twist: -14, gx: 0.36, gy: 1.26, gz: 0.4, pitch: 84, yaw: -4, off: 1, ox: -0.1, oy: 1.3, oz: -0.36, palm: 1, chest: 4 } },
      { f: 6, e: 'out', p: { spinY: -46, hipY: 0.74, twist: -24, hipYaw: -10, gx: 0.36, gy: 1.24, pitch: 92, ox: -0.3, oy: 1.38, oz: -0.42, fKnee: 16, bKnee: 26, hipLean: -6, fx: 0.36, fy: 0.04 } },
      { f: 8, e: 'in', p: { spinY: 60, pitch: 50, gx: 0.36, fy: 0.05, fx: 0.4, twist: -10 } },
      { f: 10, e: 'lin', p: { spinY: 230, pitch: 14, gx: 0.36, gy: 1.26 } },
      { f: 11, e: 'lin', p: { spinY: 310, pitch: 6, gx: 0.46 } },
      { f: 12, e: 'snap', p: { spinY: 360, pitch: -4, yaw: 0, gx: 0.62, gy: 1.28, gz: 0.28, twist: 24, hipYaw: 10, hipLean: -10, chest: -6, rootX: 0.06, fx: 0.52, fy: 0, bx: -0.42, ox: -0.2, oy: 1.36, oz: -0.36 } },
      { f: 14, e: 'out', p: { spinY: 368, yaw: -24, twist: 28 } },
      { f: 15, e: 'lin', p: { pitch: -80, yaw: -50, gx: 0.6, gy: 1.4, hipY: 0.86, by: 0.1, bx: -0.36, chest: 8, spine: 3, hipLean: -2, off: 0, palm: 0 } },
      { f: 16, e: 'lin', p: { pitch: -140, yaw: -36, gx: 0.6, gy: 1.5, hipY: 0.88, by: 0.12, fy: 0.04, chest: 12 } },
      { f: 17, e: 'snap', p: { pitch: -238, yaw: -8, gx: 0.8, gy: 1.1, gz: 0.28, hipY: 0.6, fx: 0.62, fy: 0, bx: -0.5, by: 0.03, bKnee: 34, bPitch: 30, fKnee: 18, rootX: 0.14, twist: 26, hipYaw: 14, hipLean: -22, chest: -18, spine: -7, head: -6 } },
      { f: 19, e: 'out', p: { pitch: -254, gx: 0.82, gy: 1.12, hipY: 0.58 } },
      { f: 25, e: 'hold', p: { pitch: -255 } },
      { f: 29, p: { pitch: -272, yaw: -30, gx: 0.66, gy: 1.2, hipY: 0.7, hipLean: -12, chest: -8, spine: -2, head: -2, twist: 12, hipYaw: 4, bx: -0.44, by: 0.05, bPitch: 10 } },
      { f: 33, p: { pitch: -290, yaw: -10, gx: 0.42, gy: 1.18, hipY: 0.8, hipLean: -5, chest: -1, spine: 0, twist: 4, hipYaw: 0, bx: -0.38, by: 0, bPitch: 0, fx: 0.4, fy: 0.04, rootX: 0.06 } },
      { f: 37, reset: true, p: { spinY: 360, pitch: st.pitch - 360 } },
    ], L),

    // Crouch light — rear-end poke: a horizontal wrist roll turns the staff over in front of the
    // knees so end B leads, low. The roll carries on round into the crouch.
    crLight: clip(crouch, [
      { f: 2, p: { gx: 0.4, gy: 0.82, pitch: 36, yaw: -30, twist: -10, hipYaw: -6, rootX: -0.02, chest: 3 } },
      { f: 4, p: { gx: 0.56, gy: 0.8, pitch: 90, yaw: -62, twist: -14 } },
      { f: 5, p: { gx: 0.56, gy: 0.72, pitch: 140, yaw: -36 } },
      { f: 6, e: 'lin', p: { gx: 0.54, gy: 0.66, pitch: 160, yaw: -8, twist: 6, fx: 0.42, fy: 0.03 } },
      { f: 7, e: 'snap', p: { gx: 0.66, gy: 0.62, gz: 0.28, pitch: 168, yaw: 0, twist: 24, hipYaw: 10, hipLean: -20, chest: -4, rootX: 0.05, fx: 0.48, fy: 0, bPitch: 18 } },
      { f: 9, e: 'out', p: { gx: 0.7 } },
      { f: 12, p: { gx: 0.6, gy: 0.7, twist: 10, pitch: 150, yaw: -20, bPitch: 6 } },
      { f: 15, p: { gx: 0.56, gy: 0.84, pitch: 80, yaw: -58, twist: 6, hipYaw: 2, hipLean: -16, rootX: 0.03, fx: 0.4, fy: 0.03, bPitch: 0 } },
      { f: 19, reset: true },
    ], L),
    // Crouch light 2 — low chop: A lifts, then cuts down across the shins with a sliding step.
    crLight2: clip(crouch, [
      { f: 3, p: { pitch: 60, gx: 0.3, gy: 0.98, yaw: -10, twist: -16, hipYaw: -8, chest: 4, rootX: -0.03 } },
      { f: 5, e: 'out', p: { pitch: 74, gx: 0.26, gy: 1.02, twist: -20, fx: 0.4, fy: 0.04 } },
      { f: 6, e: 'lin', p: { pitch: 20, gx: 0.42, gy: 0.86, twist: 0, hipYaw: 0, fx: 0.48, fy: 0.03 } },
      { f: 7, e: 'snap', p: { pitch: -22, yaw: -4, gx: 0.56, gy: 0.74, gz: 0.28, twist: 22, hipYaw: 10, hipLean: -22, chest: -6, rootX: 0.05, fx: 0.52, fy: 0, bPitch: 15 } },
      { f: 9, e: 'out', p: { pitch: -30, gx: 0.6 } },
      { f: 12, p: { pitch: -10, yaw: -20, gx: 0.52, gy: 0.8, twist: 12, bPitch: 6 } },
      { f: 15, p: { pitch: 12, yaw: -12, gx: 0.44, gy: 0.86, twist: 6, hipYaw: 2, hipLean: -16, rootX: 0.03, fx: 0.42, fy: 0.03, bPitch: 0 } },
      { f: 19, reset: true },
    ], L),

    // Sweep — wushu spinning low sweep: drop stance, a full whirling turn, the extended leg and the
    // low staff arrive together; the turn carries on through the follow-through, then he rises.
    sweep: clip(crouch, [
      { f: 2, p: { hipY: 0.5, spinY: -12, twist: -10, gx: 0.36, gy: 0.96, pitch: 48, hipLean: -14 } },
      { f: 5, p: { hipY: 0.44, hipLean: -14, spinY: -30, twist: -16, chest: 0, fx: 0.4, fy: 0.03, fKnee: 10, bx: -0.38, bKnee: 36, off: 1, ox: 0.34, oy: 0.06, oz: -0.12, palm: 1, gx: 0.36, gy: 1.0, gz: 0.3, pitch: 66, yaw: -6, head: 6 } },
      { f: 7, e: 'out', p: { spinY: -38, hipY: 0.42, fy: 0.03 } },
      { f: 8, e: 'in', p: { spinY: 10, fx: 0.46, fy: 0.04 } },
      { f: 9, e: 'lin', p: { spinY: 140, fx: 0.58, fy: 0.04, ox: 0.15, oy: 0.3, oz: -0.3, gx: 0.42, gy: 0.74, pitch: 110, yaw: -30 } },
      { f: 10, e: 'lin', p: { spinY: 270, fx: 0.74, fy: 0.03, gx: 0.48, gy: 0.56, pitch: 150, yaw: -15 } },
      { f: 11, e: 'lin', p: { spinY: 360, fx: 0.84, fy: 0.03, fPitch: 60, fKnee: 0, bKnee: 40, hipY: 0.4, hipLean: -30, spine: -8, chest: -4, twist: 14, gx: 0.52, gy: 0.44, pitch: 172, yaw: 0, ox: 0.08, oy: 0.04, oz: -0.16, head: 8 } },
      { f: 13, e: 'out', p: { spinY: 396 } },
      { f: 16, e: 'out', p: { spinY: 412, fx: 0.8 } },
      { f: 20, p: { spinY: 392, fx: 0.62, fy: 0.05, fPitch: 30 } },
      { f: 24, p: { spinY: 372, fx: 0.48, fy: 0, hipY: 0.46, gx: 0.54, gy: 0.6, pitch: 166, yaw: -6 } },
      { f: 29, p: { hipY: 0.6, spinY: 362, fx: 0.38, bx: -0.44, by: 0.03, bKnee: 26, fKnee: 8, fPitch: 0, hipLean: -12, spine: -4, twist: 4, head: 4, gx: 0.56, gy: 0.86, pitch: 92, yaw: -56, off: 0, palm: 0 } },
      { f: 33, p: { by: 0, bx: -0.42, gx: 0.42, gy: 0.88, yaw: -12, pitch: 40 } },
      { f: 38, reset: true, p: { spinY: 360 } },
    ], L),

    // Maul kick: knee chambers, the front foot snaps out at hip height, then end A chops down after it.
    airLight: clip(stance, [
      { f: 0, p: { hipY: 0.95, fy: 0.36, fx: 0.18, by: 0.32, bx: -0.18, fPitch: 30, bPitch: 30, gx: -0.24, gy: 1.42, gz: 0.3, pitch: 80, yaw: 0, off: 1, ox: 0.3, oy: 1.32, oz: -0.16, palm: 1, chest: 2, hipLean: 2 } },
      { f: 3, e: 'out', p: { fy: 0.66, fx: 0.24, fKnee: 6, hipLean: 8, chest: 4, pitch: 84, gx: -0.28, gy: 1.46 } },
      { f: 4, e: 'lin', p: { fx: 0.52, fy: 0.84, hipLean: 14 } },
      { f: 5, e: 'snap', p: { fx: 0.76, fy: 0.92, fPitch: 35, fKnee: 0, hipLean: 20, spine: 4, chest: -4, head: -6, by: 0.24, bx: -0.24, pitch: 90, ox: 0.05, oy: 1.15, oz: -0.3 } },
      { f: 6, e: 'out', p: { fy: 0.9, fx: 0.78 } },
      { f: 7, e: 'lin', p: { fx: 0.46, fy: 0.62, pitch: 40, yaw: -20, gx: 0.22, gy: 1.62, hipLean: 6, spine: 0 } },
      { f: 8, e: 'snap', p: { fx: 0.3, fy: 0.42, pitch: -32, yaw: -6, gx: 0.48, gy: 1.26, gz: 0.26, hipLean: -8, chest: -12, twist: 20, head: -4, ox: -0.2, oy: 1.3, oz: -0.25 } },
      { f: 10, e: 'out', p: { pitch: -46, gx: 0.5, gy: 1.2 } },
      { f: 16, p: { pitch: -10, yaw: -14, gx: 0.42, gy: 1.22, twist: 12, chest: -4, fy: 0.24, by: 0.22 } },
      { f: 24, p: { fy: 0.16, by: 0.18, fx: 0.25, bx: -0.25, pitch: 30, yaw: -6, gx: 0.34, gy: 1.2, chest: 0, twist: 6, hipLean: 0, head: 0, ox: 0.2, oy: 1.3, oz: -0.2 } },
      { f: 60, p: { fy: 0.02, by: 0.04, fPitch: 20, bPitch: 20, pitch: 50, off: 0, palm: 0 } },
    ]),

    // Air windmill: A comes over the top and chops at f8, the wheel keeps turning, B chops at f14.
    airHeavy: clip(stance, [
      { f: 0, p: { hipY: 0.95, fy: 0.34, by: 0.38, fx: 0.18, bx: -0.14, fPitch: 30, bPitch: 30, gx: 0.16, gy: 1.36, gz: 0.3, pitch: 190, yaw: 0, off: 1, ox: 0.32, oy: 1.4, oz: -0.18, palm: 1, chest: 6, spin: 6 } },
      { f: 5, e: 'out', p: { pitch: 204, gx: 0.1, gy: 1.3, chest: 12, spine: 3, head: 6, spin: 14, fy: 0.5, by: 0.5, fx: 0.24, bx: -0.06 } },
      { f: 7, e: 'in', p: { pitch: 110, yaw: -30, gx: 0.36, gy: 1.62, spin: 4, chest: 4 } },
      { f: 8, e: 'lin', p: { pitch: -30, yaw: -6, gx: 0.48, gy: 1.3, gz: 0.26, chest: -12, spine: -4, spin: -14, twist: 18, head: -6, fy: 0.24, by: 0.32, fx: 0.32, ox: -0.2, oy: 1.35, oz: -0.25 } },
      { f: 11, e: 'lin', p: { pitch: -112, yaw: -40, gx: 0.56, gy: 1.32, spin: -18 } },
      { f: 13, e: 'lin', p: { pitch: -170, yaw: -30, gx: 0.54, gy: 1.4, spin: -22 } },
      { f: 14, e: 'lin', p: { pitch: -212, yaw: -8, gx: 0.54, gy: 1.26, spin: -30, chest: -14, twist: 22, fx: 0.4, fy: 0.2 } },
      { f: 17, e: 'out', p: { pitch: -240, gx: 0.52, gy: 1.2 } },
      { f: 22, p: { pitch: -270, yaw: -30, gx: 0.46, gy: 1.24, spin: -12 } },
      { f: 28, p: { fy: 0.12, by: 0.16, fx: 0.25, bx: -0.25, spin: 0, chest: -2, spine: 0, head: 0, twist: 6, pitch: -295, yaw: -10, gx: 0.38, gy: 1.2, ox: 0.2, oy: 1.3, oz: -0.2 } },
      { f: 60, p: { fy: 0.02, by: 0.04, fPitch: 20, bPitch: 20, pitch: -305, yaw: -6, off: 0, palm: 0 } },
    ]),

    // ------------------------------------------------------------- throws
    throwStart: clip(stance, [
      { f: 2, p: { ox: 0.42, oy: 1.32, oz: -0.06, off: 1, palm: 0, gx: 0.0, gy: 1.24, gz: 0.3, pitch: 92, yaw: 0, twist: -8, fx: 0.38, fy: 0.04 } },
      { f: 3, e: 'snap', p: { off: 1, ox: 0.6, oy: 1.38, oz: 0.0, palm: 0, rootX: 0.06, hipLean: -8, twist: -14, chest: -2, fx: 0.44, fy: 0, gx: -0.1, gy: 1.26, gz: 0.3, pitch: 98, yaw: 0 } },
      { f: 10, p: { ox: 0.56 } },
      { f: 18, p: { ox: 0.36, oy: 1.3, rootX: 0.03, fx: 0.38, fy: 0.03 } },
      { f: 26, reset: true },
    ]),
    // Collar grab → knee to the gut → spinning back kick (victim launched f20) → staff twirl.
    throwing: clip(stance, [
      { f: 0, p: { off: 1, ox: 0.6, oy: 1.38, oz: 0.0, palm: 0, rootX: 0.06, hipLean: -8, twist: -14, chest: -2, fx: 0.44, gx: -0.1, gy: 1.26, gz: 0.3, pitch: 98, yaw: 0 } },
      { f: 4, p: { ox: 0.48, oy: 1.22, hipLean: -6, chest: -4, fx: 0.36, fy: 0.05 } },
      { f: 6, e: 'lin', p: { fx: 0.4, fy: 0.36, fPitch: 20, hipLean: -10, chest: -10 } },
      { f: 8, e: 'snap', p: { fx: 0.44, fy: 0.6, fPitch: 30, fKnee: 6, hipLean: -16, chest: -16, spine: -4, ox: 0.45, oy: 1.0, rootX: 0.1, hipY: 0.86, bKnee: 6 } },
      { f: 12, e: 'out', p: { fy: 0.54, oy: 0.98 } },
      { f: 14, p: { fx: 0.24, fy: 0.04, fPitch: 0, hipLean: -6, chest: -2, spine: 0, ox: 0.3, oy: 1.2, oz: -0.1, hipY: 0.82 } },
      { f: 16, p: { spinY: 80, hipLean: -14, bx: -0.3, by: 0.18, fx: 0.08, fy: 0.03, ox: 0.18, oy: 1.25, oz: -0.3, gx: -0.06 } },
      { f: 17, e: 'lin', p: { spinY: 130, hipLean: -24, bx: -0.5, by: 0.5 } },
      { f: 19, e: 'snap', p: { spinY: 180, hipLean: -42, spine: -4, chest: -6, bx: -0.78, by: 1.0, bPitch: -10, bKnee: 0, fx: 0.06, fy: 0.03, fKnee: 4, hipY: 0.86, rootX: -0.04, head: 14, ox: 0.3, oy: 1.05, oz: -0.25, palm: 1, gx: -0.1, gy: 1.15, pitch: 105 } },
      { f: 21, e: 'out', p: { bx: -0.82, by: 0.98 } },
      { f: 24, p: { spinY: 280, hipLean: -12, spine: 0, chest: 0, head: 4, bx: -0.48, by: 0.26, bPitch: 10, bKnee: 10, gx: 0.2, gy: 1.28, gz: 0.3, pitch: 95, yaw: -30 } },
      { f: 26, p: { spinY: 360, hipLean: -4, chest: 2, head: 0, bx: -0.36, by: 0.04, bPitch: 0, bKnee: 16, fx: 0.28, fy: 0, fKnee: 4, rootX: 0.02, hipY: 0.82, gx: 0.44, gy: 1.3, pitch: 150, yaw: -45, ox: 0.2, oy: 1.3, oz: -0.2, palm: 0 } },
      { f: 28, p: { by: 0, pitch: 230, yaw: -50, gx: 0.48 } },
      { f: 31, p: { pitch: 350, yaw: -25, gx: 0.4, gy: 1.22 } },
      { f: 34, reset: true, p: { spinY: 360, pitch: st.pitch + 360 } },
    ]),
    gripping: shared.thrownVictim,

    // ------------------------------------------------------------- staff throw
    // Helicopter spin overhead → wind-up behind at the shoulder → sidearm release (f14) → Force
    // guiding pose held at f16 while the staff flies → catch at f17, elbow absorbs, the spin decays
    // as a tilted vertical wheel at his side, regrip into stance.
    special: clip(stance, [
      { f: 2, p: { off: 1, ox: 0.3, oy: 1.28, oz: -0.22, palm: 1, gx: 0.3, gy: 1.72, gz: 0.2, pitch: 40, yaw: -40, twist: -6, hipY: 0.83, chest: 3, head: 3 } },
      { f: 4, p: { gx: 0.12, gy: 1.98, gz: 0.08, pitch: 4, yaw: -150, twist: -14, chest: 5 } },
      { f: 6, e: 'lin', p: { yaw: -330, twist: -24, hipYaw: -10, chest: 6, gx: 0.06, gy: 2.0, rootX: -0.03, ox: 0.4, oy: 1.4 } },
      { f: 8, e: 'lin', p: { yaw: -510, twist: -34, hipYaw: -18 } },
      { f: 10, p: { yaw: -540, gx: 0.0, gy: 1.72, gz: 0.36, pitch: 2, twist: -42, hipYaw: -24, chest: 4, rootX: -0.05 } },
      { f: 12, e: 'out', p: { yaw: -540, gx: -0.12, gy: 1.4, gz: 0.36, twist: -46, hipYaw: -26, hipY: 0.8, fx: 0.38, fy: 0.05 } },
      { f: 13, e: 'lin', p: { yaw: -630, gx: 0.36, gy: 1.36, gz: 0.26, twist: 6, hipYaw: -4, fx: 0.5, fy: 0.04 } },
      { f: 14, e: 'snap', p: { yaw: -740, gx: 0.74, gy: 1.32, gz: 0.1, twist: 42, hipYaw: 16, fx: 0.58, fy: 0, rootX: 0.08, hipLean: -12, chest: -8, ox: -0.05, oy: 1.2, oz: -0.3, head: -2 } },
      { f: 16, e: 'out', p: { gx: -0.08, gy: 1.0, gz: 0.24, twist: -18, hipYaw: -8, ox: 0.7, oy: 1.5, oz: -0.02, palm: 1, chest: -6, spine: -3, hipLean: -10, head: 6, hipY: 0.77, fx: 0.62, bx: -0.46, by: 0.04, bKnee: 22 } },
      { f: 17, e: 'snap', p: { gx: 0.52, gy: 1.34, gz: 0.3, pitch: 4, yaw: -740, twist: 6, hipYaw: 0, ox: 0.45, oy: 1.4, by: 0 } },
      { f: 19, e: 'out', p: { gx: 0.5, gy: 1.28, pitch: -70, yaw: -768, rootX: 0.02, chest: 6, spine: 0, hipLean: 0, twist: -6, head: 0, hipY: 0.8 } },
      { f: 22, p: { gx: 0.52, gy: 1.26, pitch: -180, yaw: -762, chest: 3 } },
      { f: 26, p: { gx: 0.42, gy: 1.2, pitch: -262, yaw: -740, off: 0, palm: 0, twist: 0, fx: 0.52, fy: 0.04, bx: -0.4, by: 0 } },
      { f: 30, p: { pitch: -296, yaw: -728, gx: 0.32, gy: 1.17, fx: 0.36, fy: 0 } },
      { f: 34, reset: true, p: { pitch: st.pitch - 360, yaw: st.yaw - 720 } },
    ], L),

    // ------------------------------------------------------------- whirlwind super
    superCharge: clip(stance, [
      { f: 10, e: 'out', p: { gx: 0.22, gy: 1.5, gz: 0.18, pitch: 90, yaw: 0, off: 0, hipY: 0.88, hipLean: 0, chest: 0, twist: 0, head: 0, fx: 0.18, fy: 0.03, bx: -0.2, by: 0.03, fKnee: 0, bKnee: 0 } },
      { f: 13, e: 'out', p: { fx: 0.12, fy: 0, bx: -0.14, by: 0 } },
      { f: 24, p: { hipLean: -16, spine: -4, chest: -8, head: -16, gx: 0.34, gy: 1.36 } },
      { f: 32, p: { hipLean: -18, head: -18 } },
      { f: 38, p: { hipLean: -6, chest: 0, head: -4, hipY: 0.84, fx: 0.26, fy: 0.04, bx: -0.32, by: 0.04, pitch: 94, gx: 0.26, gy: 1.4 } },
      { f: 42, p: { hipLean: -4, chest: 2, head: -2, hipY: 0.8, fx: 0.3, fy: 0, bx: -0.36, by: 0, twist: -30, hipYaw: -16, pitch: 100, off: 1, ox: -0.1, oy: 1.3, oz: -0.25, palm: 1 } },
    ]),
    super: (() => {
      const keys: KeySpec[] = [
        { f: 0, p: { gx: 0.26, gy: 1.4, gz: 0.18, pitch: 100, yaw: 0, hipY: 0.8, hipLean: -4, chest: 2, head: -2, fx: 0.3, bx: -0.36, twist: -30, hipYaw: -16, off: 1, ox: -0.1, oy: 1.3, oz: -0.25, palm: 1 } },
        // Coil: turned toward the camera, the staff held vertical at the side, free arm thrown wide.
        { f: 6, p: { spinY: -50, hipY: 0.72, gx: 0.26, gy: 1.24, gz: 0.36, pitch: 92, yaw: 0, twist: -20, hipYaw: -10, ox: -0.32, oy: 1.38, oz: -0.36, fx: 0.34, fy: 0.03, bx: -0.4, by: 0.03, fKnee: 16, bKnee: 26, hipLean: -8, chest: -2, head: 0 } },
        { f: 9, e: 'out', p: { spinY: -62, hipY: 0.7 } },
      ];
      // Five advancing spins (Constant Flux): the level staff rings the body, rocking ±14°, one leg
      // sweeping out like a tornado kick on each turn, then planting for the next push. Feet hover
      // 3 cm so the authored step pattern is followed exactly while the body whirls.
      const per = 36 / 5;
      for (let q = 1; q <= 20; q += 1) {
        const swing = q % 2 === 1;
        keys.push({
          f: 10 + (per * q) / 4,
          e: q === 1 ? 'in' : 'lin',
          p: {
            spinY: 90 * q,
            pitch: swing ? 24 : -4,
            twist: swing ? -12 : 8,
            hipY: swing ? 0.78 : 0.73,
            fx: swing ? 0.5 : 0.3,
            fy: swing ? 0.22 : 0.03,
            fPitch: swing ? 30 : 0,
            fKnee: swing ? 10 : 14,
            bx: swing ? -0.06 : -0.36,
            by: 0.03,
            bKnee: swing ? 6 : 24,
            hipLean: swing ? -4 : -10,
            gx: 0.2,
            gy: 1.2,
            gz: 0.36,
            yaw: 0,
          },
        });
      }
      keys.push(
        // Leap (the sim's arc lifts him f46–50): staff swings up overhead, end A cocked behind.
        { f: 48, e: 'lin', p: { pitch: 110, yaw: -30, gx: 0.2, gy: 1.8, gz: 0.24, hipY: 0.9, fy: 0.26, by: 0.3, fx: 0.2, bx: -0.16, fPitch: 40, bPitch: 40, fKnee: 6, bKnee: 6, hipLean: 6, chest: 12, twist: -6, head: 8, off: 0, palm: 0 } },
        { f: 49, e: 'lin', p: { pitch: 172, yaw: -8, gx: 0.05, gy: 1.95, gz: 0.2, chest: 16, hipLean: 8, head: 10 } },
        // Slam into the floor: deep horse stance.
        { f: 50, e: 'lin', p: { pitch: 70, yaw: -6, gx: 0.45, gy: 1.7, hipY: 0.82, fy: 0.04, by: 0.04, chest: 2, head: 0 } },
        { f: 51, e: 'snap', p: { pitch: -50, gx: 0.9, gy: 0.98, gz: 0.26, hipY: 0.55, fy: 0, by: 0, fx: 0.52, bx: -0.58, fPitch: 0, bPitch: 0, fKnee: 22, bKnee: 30, hipLean: -22, chest: -20, spine: -8, twist: 18, head: -6 } },
        { f: 53, e: 'out', p: { pitch: -53, hipY: 0.53 } },
        { f: 60, e: 'hold', p: { pitch: -54 } },
        { f: 63, p: { pitch: -20, yaw: -30, gx: 0.66, gy: 1.12, hipY: 0.68, hipLean: -12, chest: -8, spine: -3, head: -2, bx: -0.48, by: 0.05 } },
        { f: 66, p: { pitch: 30, yaw: -12, gx: 0.42, gy: 1.16, hipY: 0.79, hipLean: -5, chest: 0, spine: 0, twist: 4, bx: -0.38, by: 0, fx: 0.4, fy: 0.04 } },
        { f: 68, reset: true, p: { spinY: 1800 } },
      );
      return clip(stance, keys, { lagTorso: 0.5, lagHead: 1 });
    })(),

    // ------------------------------------------------------------- parry set
    parry: clip(stance, [
      { f: 1, e: 'snap', p: { gx: 0.5, gy: 1.22, gz: 0.24, pitch: 90, yaw: -2, hipY: st.hipY - 0.04, twist: 10, hipYaw: 4, chest: 2, spine: -2, rootX: 0.03, hipLean: -9, fx: 0.36, head: -2 } },
      { f: 3, e: 'lin', p: { pitch: 95 } },
      { f: 5, e: 'lin', p: { pitch: 86 } },
      { f: 7, e: 'lin', p: { pitch: 94 } },
      { f: 8, e: 'out', p: { pitch: 90 } },
      { f: 16, p: { pitch: 76, gx: 0.42, gy: 1.18, chest: 3, spine: 0, hipLean: -4, rootX: 0, headRoll: 6 } },
      { f: 30, reset: true },
    ], { lagTorso: 0.3, lagHead: 1 }),
    // Caught 45° into the turn (A meets the blade, held through the freeze), then the staff wheels
    // forward so B comes up from behind and over the top (wheel tilted toward the camera).
    parrySuccess: clip(stance, [
      { f: 0, p: { gx: 0.5, gy: 1.22, gz: 0.24, pitch: 90, yaw: -2, hipY: st.hipY - 0.04, twist: 10, hipYaw: 4, chest: 2, spine: -2, rootX: 0.03, hipLean: -9, fx: 0.36 } },
      { f: 3, e: 'snap', p: { pitch: 45, gx: 0.54, gy: 1.3, twist: 18, hipYaw: 8, chest: -2, hipLean: -12, rootX: 0.05 } },
      { f: 6, e: 'hold', p: { pitch: 43 } },
      { f: 8, e: 'lin', p: { pitch: -60, yaw: -40, gx: 0.54, gy: 1.32 } },
      { f: 10, e: 'snap', p: { pitch: -140, yaw: -36, gx: 0.5, gy: 1.36, twist: -4, hipYaw: -2, chest: 6, hipLean: -4, rootX: 0.02 } },
      { f: 12, e: 'lin', p: { pitch: -224, yaw: -16, gx: 0.44, gy: 1.24 } },
      { f: 14, e: 'out', reset: true, p: { pitch: st.pitch - 360 } },
    ]),
    // The staff spins loose in the hand; body twisted, mask tilted up.
    parried: clip(stance, [
      { f: 2, e: 'snap', p: { off: 1, ox: -0.32, oy: 1.42, oz: -0.26, palm: 1, pitch: 115, yaw: -40, gx: 0.36, gy: 1.5, gz: 0.3, twist: -26, hipYaw: -18, chest: st.chest + 14, spine: 4, head: 15, hipLean: st.hipLean + 8, rootX: -0.08, fy: 0.05, fPitch: 15 } },
      { f: 8, e: 'out', p: { pitch: 325, yaw: -30, gx: 0.3, gy: 1.36, bx: st.bx - 0.18, by: 0.04, fy: 0, fPitch: 0, hipY: st.hipY - 0.03 } },
      { f: 12, p: { by: 0, pitch: 350, yaw: -12 } },
      { f: 18, p: { pitch: 380, yaw: -6, fx: st.fx - 0.1, gx: 0.28, gy: 1.2, twist: -8, hipYaw: -6, chest: st.chest + 4, spine: 0, head: 4, ox: 0.1, oy: 1.25, oz: -0.2 } },
      { f: 28, reset: true, p: { pitch: st.pitch + 360 } },
    ]),

    // ------------------------------------------------------------- recovery / ceremony
    // Breakdance windmill on the floor → kneel with a staff twirl → stance.
    getup: clip(stance, [
      { f: 0, p: { ...lying } },
      { f: 3, e: 'out', p: { spin: 82, fx: 0.72, fy: -0.25, fz: 0.36, bx: 0.5, by: -0.45, bz: -0.36, fKnee: 0, bKnee: 0, fPitch: 40, bPitch: 40, hipY: 0.22, spinY: 30, tilt: 14, off: 1 } },
      { f: 6, e: 'lin', p: { spinY: 160, tilt: -18, fx: 0.5, fz: 0.42, bx: 0.76, bz: -0.3 } },
      { f: 9, e: 'lin', p: { spinY: 300, tilt: 6, fx: 0.76, fz: 0.3, bx: 0.48, bz: -0.3 } },
      { f: 10.5, e: 'lin', p: { spinY: 335, tilt: 2, spin: 24, hipY: 0.46, by: 0.08, bz: -0.12, bx: -0.12, fy: -0.06, fz: 0.12 } },
      { f: 12, e: 'out', p: { spinY: 360, tilt: 0, spin: 0, hipY: 0.46, rootX: -0.04, fx: 0.36, fy: 0, fz: 0, bx: -0.5, by: 0, bz: 0, bKnee: 30, fKnee: 10, fPitch: 0, bPitch: 40, hipLean: -8, spine: 0, chest: 0, head: 4, headYaw: 0, gx: 0.46, gy: 1.12, gz: 0.32, pitch: 90, yaw: -30, ox: 0.2, oy: 0.9, oz: -0.2, palm: 1 } },
      { f: 14, e: 'lin', p: { pitch: 210, yaw: -45, hipY: 0.48 } },
      { f: 16, e: 'lin', p: { hipY: 0.52, pitch: 330, yaw: -20, gx: 0.42 } },
      { f: 22, e: 'outBack', p: { ...stance, spinY: 360, pitch: st.pitch + 360 } },
    ]),

    // Hilt vertical before the mask; top blade ignites, then the second with a forward wheel (Maul, TPM).
    intro: (() => {
      const rest = S({ hipY: 0.9, hipLean: 0, spine: 0, chest: 0, twist: 0, head: -10, gx: 0.26, gy: 1.5, gz: 0.16, pitch: 90, yaw: 0, off: 0, blade: 0, blade2: 0, fx: 0.12, bx: -0.14, fKnee: 0, bKnee: 0 });
      return clip(
        rest,
        [
          { f: 24, p: { head: 4, chest: 1 } },
          { f: 30, e: 'hold' },
          { f: 33, e: 'out', p: { blade: 1, head: 6, chest: 3, spine: 1 } },
          { f: 40, p: { off: 1, ox: -0.05, oy: 1.25, oz: -0.25, palm: 1, gx: 0.4, gy: 1.42, gz: 0.28, head: 2 } },
          { f: 42, e: 'hold' },
          // Second blade ignites as the staff wheels forward (Maul's reveal), then settles into stance.
          { f: 45, e: 'out', p: { blade2: 1, pitch: 40, gx: 0.44, gy: 1.36 } },
          { f: 50, e: 'lin', p: { pitch: -110, yaw: -30, gx: 0.46, gy: 1.32, hipY: 0.86, fx: 0.2, fy: 0.04, bx: -0.24 } },
          { f: 55, e: 'lin', p: { pitch: -250, yaw: -40, gx: 0.42, gy: 1.3, hipY: 0.83, fx: 0.3, fy: 0, bx: -0.36, by: 0.04, bKnee: 14, twist: -6 } },
          { f: 61, e: 'out', p: { pitch: -300, yaw: -10, gx: 0.32, gy: 1.18, off: 0, palm: 0, twist: 0, by: 0 } },
          { f: 70, p: { ...stance, pitch: st.pitch - 360 } },
        ],
        { lagTorso: 1, lagHead: 2 },
      );
    })(),

    // Two twirls, plant the staff vertical, blades off, formal bow.
    victory: clip(stance, [
      { f: 4, p: { off: 1, ox: -0.1, oy: 1.2, oz: -0.25, palm: 0, gx: 0.44, gy: 1.32, gz: 0.3, pitch: 90, yaw: -30, hipY: 0.86 } },
      { f: 10, e: 'lin', p: { pitch: -90, yaw: -45 } },
      { f: 16, e: 'lin', p: { pitch: -270, yaw: -45 } },
      { f: 22, e: 'lin', p: { pitch: -450, yaw: -45 } },
      { f: 28, e: 'out', p: { pitch: 90 - 720, yaw: 0 } },
      // Plant it: B end to the floor, the free hand caps the top, feet together.
      { f: 33, e: 'out', p: { gx: 0.32, gy: 1.18, gz: 0.2, ox: 0.3, oy: 1.42, oz: 0.12, hipY: 0.9, fx: 0.16, fy: 0.03, bx: -0.18, fKnee: 0, bKnee: 0, hipLean: 0, chest: 0, twist: 0, head: 0 } },
      { f: 36, e: 'out', p: { fx: 0.12, fy: 0, bx: -0.14 } },
      { f: 44, e: 'lin', p: { blade: 0, blade2: 0 } },
      { f: 58, p: { hipLean: -15, spine: -2, chest: -4, head: -18 } },
      { f: 80, p: { hipLean: -14 } },
    ]),
  };

  return { stance, guard, crouch, crouchGuard, walk, walkBack, run, clips, turnFrames: 7 };
}
