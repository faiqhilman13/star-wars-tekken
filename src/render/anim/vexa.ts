import { clip } from './clip';
import type { GaitSpec } from './gait';
import { makePose, NEUTRAL } from './pose';
import { sharedClips, type Physique } from './shared';
import type { AnimSet } from './types';

/**
 * VEXA — heavy dark marauder (Vader / Kylo / Anakin). Djem So power with Juyo bursts: slow, readable
 * anticipation, explosive release, long follow-through holds, then dead stillness. She never flips;
 * she stomps. See artifacts/animation-reference.md §2.2–2.3 / §3.2.
 */
export function vexaAnims(): AnimSet {
  const ph: Physique = { amp: 0.8, head: 0.6, dual: false };

  // Djem So high guard: both hands above the brow, blade angled back and down behind the helmet.
  const stance = makePose(NEUTRAL, {
    rootX: -0.02,
    hipY: 0.78,
    hipLean: -8,
    hipYaw: 4,
    spine: -2,
    chest: 5,
    twist: 6,
    head: -8,
    // Hands at the brow, not at full stretch: the elbows flare out so the pauldrons keep their shape.
    gx: 0.12,
    gy: 1.78,
    gz: 0.16,
    pitch: 200,
    yaw: 24,
    off: 0,
    palm: 0,
    fx: 0.4,
    fKnee: 12,
    bx: -0.48,
    bKnee: 18,
    nElbow: 30,
    fElbow: 20,
  });
  const guard = makePose(stance, { gx: 0.36, gy: 1.48, gz: 0.16, pitch: 118, yaw: 12, twist: 4, hipLean: -6, rootX: -0.04, chest: 4, head: -4, nElbow: 6 });
  const crouch = makePose(stance, { hipY: 0.56, hipLean: -18, spine: -6, chest: 2, head: 0, gx: 0.34, gy: 0.98, gz: 0.16, pitch: 52, yaw: 12, twist: 4, fx: 0.42, bx: -0.52, bKnee: 26, fKnee: 14, nElbow: 4 });
  const crouchGuard = makePose(crouch, { gx: 0.38, gy: 0.86, pitch: -60, yaw: 14, hipLean: -14, twist: 8 });

  const shared = sharedClips({ stance, guard, crouch, crouchGuard }, ph);

  // Measured stomp (Rogue One hallway): long flat-footed steps, a dip on each plant, blade dead still.
  const walk: GaitSpec = { kind: 'shuffle', base: stance, stride: 1.3, lift: 0.09, bob: 0.03, lean: 0, sway: 2, armPump: 0, bladeBob: 0.4, toe: 0 };
  const walkBack: GaitSpec = { ...walk, base: makePose(stance, { hipY: 0.8, gx: 0.14, pitch: 190 }), stride: 1.1, lift: 0.06, bob: 0.015, lean: 3 };
  // Charge: one hand, blade trailing low beside the legs with the tip skimming the deck, off fist pumping.
  const runBase = makePose(stance, {
    rootX: 0.02,
    hipY: 0.78,
    hipLean: -22,
    hipYaw: 0,
    spine: -6,
    chest: -6,
    twist: -4,
    head: 4,
    gx: -0.12,
    gy: 0.92,
    gz: 0.22,
    pitch: -42,
    yaw: 160,
    off: 1,
    ox: 0.24,
    oy: 1.1,
    oz: -0.12,
    palm: 0,
    fx: 0.06,
    bx: -0.04,
    fKnee: 0,
    bKnee: 0,
    nElbow: 0,
  });
  const run: GaitSpec = { kind: 'run', base: runBase, stride: 2.2, lift: 0.26, bob: 0.07, lean: -4, sway: 10, armPump: 0.2, bladeBob: 3, stance: 0.38, heelKick: 0.2 };

  const L = { lagTorso: 0.8, lagHead: 1.4 };
  // Blade lowered at her side, angled down and back (contempt) — never across the opponent.
  const lowGrip = { gx: 0.16, gy: 1.0, gz: 0.26, pitch: -118, yaw: -32 };
  // Clips that end from a low/back blade finish on -160 (≡ the guard's 200) so the blade keeps travelling back.
  const home = { ...stance, pitch: -160 };

  const clips = {
    ...shared,

    // Respirator rhythm: 1.6 s inhale (shoulders rise), a held beat, slow exhale; the blade trembles.
    idle: clip(
      stance,
      [
        { f: 96, e: 'io', p: { chest: stance.chest + 3, gy: stance.gy + 0.016, hipY: stance.hipY + 0.006, head: stance.head + 1 } },
        { f: 120, e: 'io', p: { pitch: stance.pitch + 1.5 } },
        { f: 150, e: 'io', p: { pitch: stance.pitch - 1.5 } },
        { f: 200, e: 'io', p: { chest: stance.chest + 1, gy: stance.gy + 0.004, hipY: stance.hipY, pitch: stance.pitch + 1, head: stance.head } },
        { f: 240, e: 'io', reset: true },
      ],
      { loop: true, lagTorso: 4, lagHead: 8 },
    ),

    // Short, low hop back that lands flat-footed with a stomp; the blade stays up.
    backdash: clip(stance, [
      { f: 3, e: 'out', p: { rootX: -0.05, hipY: 0.84, fy: 0.1, by: 0.12, fPitch: 10, bPitch: 10, chest: stance.chest + 4, head: stance.head - 4, hipLean: -4 } },
      { f: 10, e: 'io', p: { fy: 0.05, by: 0.04 } },
      { f: 13, e: 'in', p: { fy: 0, by: 0, fPitch: 0, bPitch: 0, hipY: 0.7, chest: stance.chest - 2 } },
      { f: 18, e: 'out', reset: true },
    ]),

    runStop: clip(runBase, [
      { f: 2, e: 'out', p: { hipLean: 8, spine: 2, chest: 6, head: -4, fx: 0.52, fPitch: -20, bx: -0.42, hipY: 0.7, rootX: -0.04 } },
      { f: 6, e: 'io', p: { gx: stance.gx, gy: stance.gy, gz: stance.gz, pitch: stance.pitch, yaw: stance.yaw, off: 0 } },
      { f: 9, e: 'io', reset: true, p: { ...stance } },
    ]),

    // No flips: heavy, bent-kneed hops with the blade held overhead.
    jumpUp: clip(stance, [
      { f: 0, p: { hipY: 0.92, fy: 0.12, by: 0.14, fPitch: 30, bPitch: 30, fKnee: 14, bKnee: 14, head: stance.head + 4 } },
      { f: 8, e: 'out', p: { fy: 0.28, by: 0.3, fx: 0.22, bx: -0.18, chest: stance.chest + 2 } },
      { f: 20, e: 'io', p: { fy: 0.3, by: 0.34, chest: stance.chest + 4, head: stance.head + 2 } },
      { f: 32, e: 'io', p: { fy: 0.08, by: 0.1, fx: 0.36, bx: -0.42, fKnee: 12, bKnee: 18, chest: stance.chest } },
      { f: 42, e: 'io', p: { fy: 0, by: 0, fPitch: 15, bPitch: 15 } },
    ]),

    // An arcing leap, body pitched forward, blade cocked back ready to cleave.
    jumpFwd: clip(stance, [
      { f: 0, p: { hipY: 0.92, spin: -6, fx: 0.3, fy: 0.1, bx: -0.4, by: 0.2, fPitch: 30, bPitch: 40 } },
      { f: 8, e: 'out', p: { spin: -15, fx: 0.42, fy: 0.3, bx: -0.3, by: 0.42, chest: stance.chest - 8, head: stance.head - 4, gx: 0.0, gy: 1.92, pitch: 214, yaw: 22, hipLean: -14 } },
      { f: 22, e: 'io', p: { spin: -10, fy: 0.36, by: 0.38, fx: 0.36, bx: -0.18, fKnee: 18, bKnee: 18 } },
      { f: 32, e: 'io', p: { spin: 0, fy: 0.1, by: 0.16, fx: 0.42, bx: -0.46, pitch: 202, hipLean: stance.hipLean } },
      { f: 42, e: 'io', p: { fy: 0, by: 0, fPitch: 15, bPitch: 15 } },
    ]),

    // A drifting hop back; the cape is thrown forward by the springs.
    jumpBack: clip(stance, [
      { f: 0, p: { hipY: 0.92, spin: 6, fx: 0.36, fy: 0.12, bx: -0.38, by: 0.06, fPitch: 30, chest: stance.chest + 4, head: stance.head + 4 } },
      { f: 8, e: 'out', p: { spin: 10, fy: 0.3, by: 0.18, fx: 0.44, bx: -0.3, chest: stance.chest + 8, gx: 0.14, gy: 1.8, pitch: 192 } },
      { f: 24, e: 'io', p: { spin: 6, fy: 0.24, by: 0.2 } },
      { f: 34, e: 'io', p: { spin: 0, fy: 0.06, by: 0.04, chest: stance.chest } },
      { f: 42, e: 'io', p: { fy: 0, by: 0 } },
    ]),

    // Out of the charge: a long two-handed leap, blade cocked overhead (Anakin, Mustafar).
    jumpRun: clip(runBase, [
      { f: 0, p: { hipY: 0.94, hipLean: -18, fx: 0.35, bx: -0.4, fy: 0.1, by: 0.24, fPitch: 40, bPitch: 40 } },
      { f: 8, e: 'out', p: { spin: -14, fx: 0.42, fy: 0.36, bx: -0.32, by: 0.48, gx: -0.04, gy: 1.92, gz: 0.14, pitch: 216, yaw: 22, off: 0, chest: 8, head: 2, hipLean: -12 } },
      { f: 22, e: 'io', p: { spin: -10, fy: 0.4, by: 0.4, fx: 0.32, bx: -0.12, fKnee: 16, bKnee: 16 } },
      { f: 30, e: 'io', p: { spin: -4, fy: 0.12, by: 0.2, fx: 0.46, bx: -0.46, pitch: 205 } },
      { f: 44, e: 'io', p: { fy: 0.02, by: 0.04, fPitch: 15, bPitch: 15 } },
    ]),

    // ----------------------------------------------------------- attacks
    // One-handed swat (Vader ESB / Kylo): the off hand lets go and flings back as an open claw.
    light: clip(
      stance,
      [
        { f: 4, e: 'out', p: { off: 1, ox: -0.12, oy: 1.5, oz: -0.22, palm: 0, gx: 0.02, gy: 1.9, pitch: 216, yaw: 26, twist: -12, hipYaw: -8, chest: stance.chest + 5, rootX: -0.03, fy: 0.07, fPitch: 14 } },
        { f: 6, e: 'lin', p: { gx: 0.42, gy: 1.64, pitch: 85, yaw: 14, twist: 10, hipYaw: 6, fx: 0.5, fy: 0, fPitch: 0 } },
        { f: 7, e: 'snap', p: { gx: 0.68, gy: 1.24, gz: 0.14, pitch: -14, yaw: 10, twist: 30, hipYaw: 16, hipLean: -14, chest: -6, head: -12, ox: -0.36, oy: 1.12, oz: -0.24, palm: 1, rootX: 0.06, nElbow: 0 } },
        { f: 9, e: 'out', p: { pitch: -32, gx: 0.7, gy: 1.14 } },
        { f: 13, e: 'hold', p: { pitch: -45, gy: 1.08, twist: 32 } },
        { f: 16, e: 'io', p: { gx: 0.3, gy: 1.12, gz: 0.26, pitch: -112, yaw: -34, twist: 14, hipYaw: 8, hipLean: -10, chest: stance.chest - 2, head: stance.head, ox: -0.1, oy: 1.3, oz: -0.2, rootX: 0.02 } },
        { f: 19, e: 'io', p: { ...stance, pitch: -160 } },
      ],
      L,
    ),

    // Falling Avalanche: stand tall, lift the front knee, tremble, then stomp and cleave into the deck.
    heavy: clip(
      stance,
      [
        { f: 6, e: 'io', p: { gx: -0.06, gy: 1.94, gz: 0.14, pitch: 212, yaw: 18, chest: stance.chest + 12, spine: 6, hipLean: 0, head: 4, hipY: 0.86, fx: 0.3, fy: 0.18, fPitch: 10, fKnee: 6, rootX: -0.04, twist: -10, hipYaw: -8 } },
        { f: 10, e: 'out', p: { pitch: 216, gy: 1.96, chest: stance.chest + 15 } },
        { f: 12, e: 'hold', p: { pitch: 213 } },
        { f: 13, e: 'hold', p: { pitch: 216 } },
        { f: 14, e: 'lin', p: { fx: 0.66, fy: 0, fPitch: 0, hipY: 0.74, gx: 0.36, gy: 1.8, pitch: 100, chest: stance.chest, spine: 0, twist: 6, rootX: 0.06 } },
        { f: 15, e: 'snap', p: { gx: 0.72, gy: 1.14, gz: 0.14, pitch: -36, yaw: 10, chest: -18, spine: -8, hipLean: -22, twist: 22, hipYaw: 14, head: -14, rootX: 0.12, hipY: 0.68, bKnee: 24 } },
        { f: 18, e: 'out', p: { pitch: -68, gx: 0.68, gy: 0.84 } },
        { f: 23, e: 'hold', p: { pitch: -74, gx: 0.64, gy: 0.74, hipY: 0.66 } },
        { f: 29, e: 'in', p: { chest: -6, hipLean: -12, spine: -2, head: -4, hipY: 0.72, gy: 0.82, pitch: -70 } },
        { f: 34, e: 'io', p: { gx: 0.26, gy: 1.0, gz: 0.28, pitch: -125, yaw: -34, twist: 10, hipYaw: 6, rootX: 0.08, hipY: 0.74, chest: stance.chest - 4, head: stance.head - 2, hipLean: -10 } },
        { f: 40, e: 'io', p: { ...stance, pitch: -160 } },
      ],
      L,
    ),

    // One-handed low stab, off hand braced on the thigh.
    crLight: clip(
      crouch,
      [
        { f: 4, e: 'out', p: { gx: 0.1, gy: 0.82, gz: 0.2, pitch: 0, yaw: 150, twist: -14, hipYaw: -8, off: 1, ox: 0.3, oy: 0.64, oz: -0.1, palm: 0 } },
        { f: 6, e: 'lin', p: { gx: 0.42, gy: 0.68, pitch: -6, yaw: 60, twist: 6 } },
        { f: 7, e: 'snap', p: { gx: 0.72, gy: 0.55, gz: 0.16, pitch: -18, yaw: 4, twist: 28, hipYaw: 14, rootX: 0.06, fx: crouch.fx + 0.08, head: -6 } },
        { f: 9, e: 'out', p: { gx: 0.74 } },
        { f: 12, e: 'hold', p: { gx: 0.72, pitch: -16 } },
        { f: 20, e: 'io', reset: true },
      ],
      L,
    ),

    // Juyo wild arc: winds back low, an ankle-height sweep that overswings across her body.
    sweep: clip(
      crouch,
      [
        { f: 8, e: 'io', p: { hipY: 0.54, hipLean: -14, twist: -40, hipYaw: -20, gx: -0.12, gy: 0.52, gz: 0.28, pitch: -15, yaw: 152, off: 1, ox: 0.26, oy: 0.62, oz: -0.1, palm: 0, bx: -0.6, bPitch: 20 } },
        { f: 10, e: 'hold', p: { yaw: 156 } },
        { f: 11, e: 'lin', p: { gx: 0.3, gy: 0.5, yaw: 90, twist: 0, hipYaw: 0, hipY: 0.52 } },
        { f: 12, e: 'snap', p: { gx: 0.6, gy: 0.34, gz: 0.18, pitch: -12, yaw: 0, twist: 44, hipYaw: 22, hipLean: -26, hipY: 0.5, by: 0.05, bPitch: 30, rootX: 0.05, head: -8 } },
        { f: 18, e: 'out', p: { yaw: -40, gx: 0.52, twist: 52, hipYaw: 26 } },
        { f: 26, e: 'io', p: { ox: 0.34, oy: 0.56, oz: -0.06, yaw: -36, chest: crouch.chest - 8, by: 0, bPitch: 0 } },
        { f: 33, e: 'io', p: { gx: 0.3, gy: 0.78, gz: 0.28, pitch: 34, yaw: 62, twist: 10, hipYaw: 4, off: 0 } },
        { f: 40, e: 'io', reset: true },
      ],
      L,
    ),

    airLight: clip(stance, [
      { f: 0, p: { hipY: 0.92, fy: 0.24, by: 0.3, fPitch: 30, bPitch: 30, fKnee: 14, bKnee: 14, gx: 0.04, gy: 1.84, pitch: 206, yaw: 20 } },
      { f: 5, e: 'out', p: { pitch: 216, chest: stance.chest + 6 } },
      { f: 6, e: 'lin', p: { gx: 0.4, gy: 1.56, pitch: 90 } },
      { f: 7, e: 'snap', p: { gx: 0.62, gy: 1.12, gz: 0.14, pitch: -30, twist: 26, chest: -12, head: -12, fy: 0.3, by: 0.38 } },
      { f: 11, e: 'out', p: { pitch: -60, gy: 1.0 } },
      { f: 24, e: 'io', p: { gx: 0.2, gy: 1.6, pitch: 150, chest: stance.chest - 2, fy: 0.14, by: 0.18 } },
      { f: 60, e: 'io', p: { fy: 0.02, by: 0.04, fPitch: 15, bPitch: 15 } },
    ]),

    // Two-handed hammer from overhead; legs extend to stomp down on landing.
    airHeavy: clip(stance, [
      { f: 0, p: { hipY: 0.92, fy: 0.24, by: 0.3, fPitch: 30, bPitch: 30, fKnee: 14, bKnee: 14, gx: 0.04, gy: 1.84, pitch: 206, yaw: 20 } },
      { f: 8, e: 'out', p: { gx: -0.06, gy: 1.98, pitch: 222, chest: stance.chest + 14, head: 6, fy: 0.36, by: 0.42, spin: 6 } },
      { f: 10, e: 'hold', p: { pitch: 224 } },
      { f: 11, e: 'snap', p: { gx: 0.58, gy: 0.94, gz: 0.14, pitch: -50, twist: 20, chest: -20, spine: -8, head: -14, spin: -6, fy: 0.16, by: 0.22, fKnee: 6, bKnee: 6 } },
      { f: 17, e: 'out', p: { pitch: -72, gy: 0.84 } },
      { f: 30, e: 'io', p: { gx: 0.2, gy: 1.5, pitch: 150, chest: stance.chest - 4, spine: 0, spin: 0, fy: 0.08, by: 0.12 } },
      { f: 60, e: 'io', p: { fy: 0.02, by: 0.04 } },
    ]),

    // Chain 2: one-handed rising backhand out of the low follow-through (Juyo: unlinked angles).
    light2: clip(
      stance,
      [
        { f: 2, e: 'out', p: { off: 1, ox: -0.2, oy: 1.32, oz: -0.22, palm: 0, gx: 0.3, gy: 1.0, gz: 0.28, pitch: -142, yaw: -44, twist: 18, hipYaw: 10, chest: stance.chest - 4, head: -10, rootX: -0.02, fy: 0.06, fPitch: 14, nElbow: 0 } },
        { f: 4, e: 'in', p: { gx: 0.34, gy: 0.96, pitch: -150, twist: 22, hipYaw: 12 } },
        { f: 5, e: 'lin', p: { gx: 0.5, gy: 1.1, pitch: -62, yaw: 18, twist: 6, fx: 0.5, fy: 0.02 } },
        { f: 6, e: 'lin', p: { gx: 0.62, gy: 1.26, pitch: -6, yaw: 12, twist: -4, fy: 0, fPitch: 0 } },
        { f: 7, e: 'snap', p: { gx: 0.7, gy: 1.46, gz: 0.16, pitch: 34, yaw: 8, twist: -14, hipYaw: -10, hipLean: -12, chest: stance.chest + 2, head: -6, rootX: 0.07, bPitch: 22, ox: -0.34, oy: 1.16, oz: -0.26, palm: 1 } },
        { f: 9, e: 'out', p: { pitch: 70, gy: 1.62, gx: 0.66, twist: -18, bPitch: 26 } },
        { f: 13, e: 'out', p: { pitch: 80, gy: 1.66, twist: -19 } },
        { f: 16, e: 'io', p: { off: 0, palm: 0, gx: 0.12, gy: 1.84, gz: 0.16, pitch: 192, yaw: 22, twist: 6, hipYaw: 4, hipLean: -8, chest: stance.chest, head: stance.head, rootX: 0.02, bPitch: 6 } },
        { f: 19, e: 'io', reset: true },
      ],
      L,
    ),

    // Chain 3: two-handed overhead hammer with a stomp (Kylo's double chops).
    light3: clip(
      stance,
      [
        { f: 3, e: 'out', p: { gx: -0.02, gy: 1.98, gz: 0.14, pitch: 218, yaw: 18, chest: stance.chest + 12, spine: 4, hipY: 0.84, hipLean: -2, head: 2, fx: 0.32, fy: 0.12, fPitch: 10, rootX: -0.03 } },
        { f: 5, e: 'out', p: { pitch: 222, gy: 2.0 } },
        { f: 6, e: 'lin', p: { gx: 0.38, gy: 1.8, pitch: 102, fx: 0.62, fy: 0, fPitch: 0, hipY: 0.74, chest: stance.chest, spine: 0 } },
        { f: 7, e: 'snap', p: { gx: 0.7, gy: 1.16, gz: 0.14, pitch: -34, yaw: 10, chest: -16, spine: -6, hipLean: -20, twist: 18, hipYaw: 12, head: -12, rootX: 0.1, hipY: 0.68, bKnee: 24, bPitch: 18 } },
        { f: 10, e: 'out', p: { pitch: -60, gy: 0.98, gx: 0.68 } },
        { f: 14, e: 'out', p: { pitch: -64, gy: 0.95 } },
        { f: 17, e: 'io', p: { gx: 0.3, gy: 1.04, gz: 0.26, pitch: -128, yaw: -34, chest: stance.chest - 4, hipLean: -12, spine: -2, head: -6, twist: 8, hipYaw: 4, hipY: 0.74, rootX: 0.06, bPitch: 6 } },
        { f: 19, e: 'io', p: { ...stance, pitch: -160 } },
      ],
      L,
    ),

    // Combo finisher: a full turn with the blade overhead, then the Falling Avalanche.
    heavyChain: clip(
      stance,
      [
        { f: 4, e: 'out', p: { gx: -0.04, gy: 1.94, gz: 0.14, pitch: 214, yaw: 18, twist: -20, hipYaw: -14, chest: stance.chest + 8, hipY: 0.82, head: 0, rootX: -0.04 } },
        { f: 8, e: 'in', p: { spinY: 60, fy: 0.08, fPitch: 15, by: 0.04, gx: 0.02, gy: 2.0, pitch: 150, yaw: 10 } },
        { f: 12, e: 'lin', p: { spinY: 290, gx: 0.06, gy: 2.02, pitch: 104, fx: 0.42, fy: 0.06, by: 0.08, bx: -0.36 } },
        { f: 14, e: 'lin', p: { spinY: 348, gx: 0.34, gy: 1.82, pitch: 96, fx: 0.62, fy: 0, by: 0, bx: -0.48, hipY: 0.76 } },
        { f: 15, e: 'snap', p: { spinY: 360, gx: 0.74, gy: 1.12, gz: 0.14, pitch: -40, yaw: 10, chest: -20, spine: -8, hipLean: -22, twist: 22, hipYaw: 14, head: -14, rootX: 0.14, hipY: 0.66, fx: 0.66, bKnee: 26 } },
        { f: 19, e: 'out', p: { pitch: -72, gx: 0.7, gy: 0.84 } },
        { f: 25, e: 'out', p: { pitch: -76, gx: 0.66, gy: 0.76, hipY: 0.64 } },
        { f: 30, e: 'in', p: { chest: -6, hipLean: -12, spine: -2, head: -4, hipY: 0.72, gy: 0.82, pitch: -72 } },
        { f: 35, e: 'io', p: { gx: 0.26, gy: 1.0, gz: 0.28, pitch: -125, yaw: -34, twist: 10, hipYaw: 6, rootX: 0.08, hipY: 0.74, chest: stance.chest - 4, head: stance.head - 2, hipLean: -10 } },
        { f: 40, e: 'io', p: { ...stance, pitch: -160, spinY: 360 } },
      ],
      L,
    ),

    // Chained low cut: a one-handed backhand at the shins, sweeping round the camera side.
    crLight2: clip(
      crouch,
      [
        { f: 3, e: 'out', p: { gx: 0.18, gy: 0.74, gz: 0.04, pitch: -10, yaw: 146, twist: 16, hipYaw: 8, off: 1, ox: 0.3, oy: 0.62, oz: -0.1, palm: 0 } },
        { f: 5, e: 'lin', p: { gx: 0.46, gy: 0.62, gz: 0.26, pitch: -12, yaw: 72, twist: 4 } },
        { f: 7, e: 'snap', p: { gx: 0.64, gy: 0.56, gz: 0.16, pitch: -16, yaw: 2, twist: -12, hipYaw: -8, rootX: 0.06, head: -6, hipLean: -22 } },
        { f: 10, e: 'out', p: { yaw: -30, gx: 0.6 } },
        { f: 13, e: 'out', p: { yaw: -33 } },
        { f: 17, e: 'io', p: { gx: 0.36, gy: 0.92, gz: 0.16, pitch: 40, yaw: 12, twist: 2, off: 0 } },
        { f: 20, e: 'io', reset: true },
      ],
      L,
    ),

    // Idle flourish 1: head tilt, then a one-handed wheel-twirl at her side, back to the high guard.
    idleBreak: clip(
      stance,
      [
        { f: 12, e: 'io', p: { off: 1, ox: 0.28, oy: 1.12, oz: -0.1, palm: 0, gx: 0.22, gy: 1.0, gz: 0.32, pitch: -55, yaw: 40, hipY: 0.82, hipLean: -4, chest: stance.chest + 2, head: -8, nElbow: 0 } },
        { f: 24, e: 'io', p: { headRoll: 14, head: -4 } },
        { f: 32, e: 'io', p: { pitch: 35, headRoll: 10 } },
        { f: 38, e: 'io', p: { pitch: 125, headRoll: 4 } },
        { f: 44, e: 'io', p: { pitch: 215 } },
        { f: 50, e: 'io', p: { pitch: 305, headRoll: 0, head: -10 } },
        { f: 58, e: 'out', p: { pitch: 372, gy: 1.04 } },
        { f: 72, e: 'io', p: { ...stance, pitch: stance.pitch + 360 } },
        { f: 84, e: 'io', p: { ...stance, pitch: stance.pitch + 360 } },
      ],
      { lagTorso: 2, lagHead: 4 },
    ),

    // Idle flourish 2: the free fist clenches in front of her chest; she cracks her neck.
    idleBreak2: clip(
      stance,
      [
        { f: 14, e: 'io', p: { off: 1, ox: 0.34, oy: 1.36, oz: -0.02, palm: 0, gx: 0.2, gy: 1.04, gz: 0.28, pitch: -82, yaw: 30, nElbow: 0, chest: stance.chest + 3, head: -4 } },
        { f: 22, e: 'io', p: { ox: 0.36, oy: 1.38 } },
        { f: 30, e: 'snap', p: { headRoll: 18 } },
        { f: 36, e: 'out', p: { headRoll: 14 } },
        { f: 42, e: 'snap', p: { headRoll: -18 } },
        { f: 48, e: 'out', p: { headRoll: -14 } },
        { f: 60, e: 'io', p: { headRoll: 0, ox: 0.3, oy: 1.3 } },
        { f: 74, e: 'io', reset: true },
      ],
      { lagTorso: 2, lagHead: 3 },
    ),

    // Charge push-off: stomp, release the off hand, blade drops to the low trail, first stride.
    runStart: clip(stance, [
      { f: 2, e: 'out', p: { hipY: 0.72, hipLean: -14, chest: stance.chest - 2, head: -4, fy: 0.04, by: 0.02, bPitch: 25 } },
      { f: 5, e: 'io', p: { hipY: 0.76, hipLean: -22, spine: -6, chest: -4, fx: 0.46, fy: 0.12, bx: -0.38, by: 0.02, bPitch: 40, off: 1, ox: 0.26, oy: 1.12, oz: -0.12, palm: 0, gx: -0.04, gy: 1.06, gz: 0.2, pitch: -36, yaw: 156, nElbow: 0 } },
      { f: 9, e: 'io', p: { ...runBase, fx: 0.3, fy: 0.02, bx: -0.3, by: 0.14 } },
    ]),

    // ----------------------------------------------------------- throws
    // Choke-slam (Vader lifting Antilles): claw to the throat, lift, drive them into the deck.
    throwStart: clip(stance, [
      { f: 3, e: 'snap', p: { off: 1, ox: 0.6, oy: 1.46, oz: 0, palm: 1, rootX: 0.08, hipLean: -8, twist: -16, hipYaw: -6, fx: 0.5, ...lowGrip, nElbow: 0 } },
      { f: 10, e: 'io', p: { ox: 0.56 } },
      { f: 26, e: 'io', p: home },
    ]),
    throwing: clip(stance, [
      { f: 0, p: { off: 1, ox: 0.6, oy: 1.46, oz: 0, palm: 0, rootX: 0.08, hipLean: -8, twist: -16, hipYaw: -6, fx: 0.5, ...lowGrip, nElbow: 0 } },
      { f: 12, e: 'out', p: { oy: 1.72, ox: 0.62, chest: stance.chest + 6, hipY: 0.82, head: stance.head - 2, headRoll: 8 } },
      { f: 18, e: 'in', p: { oy: 1.8, ox: 0.56, chest: stance.chest + 9, twist: -24 } },
      { f: 20, e: 'snap', p: { ox: 0.84, oy: 0.62, chest: -14, hipLean: -18, spine: -6, twist: -26, hipY: 0.68, rootX: 0.12, fx: 0.6, head: -12, headRoll: 0 } },
      { f: 25, e: 'out', p: { ox: 0.86, oy: 0.58 } },
      { f: 34, e: 'io', p: home },
    ]),

    // ----------------------------------------------------------- Force Grip
    // Reach (46 f, grab f16–19): the arm extends slowly, the open hand curls into a claw.
    special: clip(
      stance,
      [
        { f: 10, e: 'io', p: { off: 1, ox: 0.6, oy: 1.42, oz: -0.04, palm: 1, ...lowGrip, hipLean: -4, chest: stance.chest - 3, twist: -20, hipYaw: -10, head: -6, rootX: 0, nElbow: 0 } },
        { f: 14, e: 'io', p: { ox: 0.72, oy: 1.46 } },
        { f: 16, e: 'snap', p: { ox: 0.75, oy: 1.48, palm: 0, chest: stance.chest - 1 } },
        { f: 19, e: 'hold', p: { ox: 0.74 } },
        { f: 30, e: 'io', p: { ox: 0.5, oy: 1.3, palm: 0, twist: -10 } },
        { f: 46, e: 'io', p: home },
      ],
      L,
    ),
    // The hold (64 f, hurl at 46): the claw rises with the victim, tilts, cocks back and hurls.
    gripping: clip(
      stance,
      [
        { f: 0, p: { off: 1, ox: 0.75, oy: 1.48, oz: -0.04, palm: 0, ...lowGrip, hipLean: -4, chest: stance.chest - 1, twist: -20, hipYaw: -10, head: -6, nElbow: 0 } },
        { f: 18, e: 'out', p: { ox: 0.7, oy: 1.8, chest: stance.chest + 6, head: 0, hipLean: 0 } },
        { f: 26, e: 'io', p: { oy: 1.84, ox: 0.73, headRoll: -6 } },
        { f: 34, e: 'io', p: { oy: 1.82, ox: 0.7, headRoll: 6 } },
        { f: 42, e: 'in', p: { ox: 0.48, oy: 1.92, twist: -30, chest: stance.chest + 9, hipYaw: -16, headRoll: 0 } },
        { f: 46, e: 'snap', p: { ox: 0.98, oy: 1.22, palm: 1, hipLean: -14, chest: -8, twist: -36, hipYaw: 10, rootX: 0.08, fx: 0.56, head: -10 } },
        { f: 52, e: 'out', p: { ox: 1.0, oy: 1.18 } },
        { f: 64, e: 'io', p: home },
      ],
      L,
    ),

    // ----------------------------------------------------------- Force Lightning
    // Freeze: the blade snaps off, both hands pull in to the chest, Palpatine hunch.
    superCharge: clip(stance, [
      { f: 6, e: 'io', p: { blade: 0, gx: 0.14, gy: 1.16, gz: 0.14, pitch: -80, yaw: 10, off: 1, ox: 0.12, oy: 1.2, oz: -0.1, palm: 0, spine: -12, chest: -10, head: -15, hipY: 0.74, hipLean: -8, twist: -6, hipYaw: 0, nElbow: 0 } },
      { f: 30, e: 'io', p: { spine: -14, chest: -12, head: -18, hipY: 0.72, gx: 0.1, ox: 0.08 } },
      { f: 42, e: 'io', p: { chest: -8, head: -12 } },
    ]),
    super: clip(
      stance,
      [
        { f: 0, p: { blade: 0, gx: 0.1, gy: 1.16, gz: 0.14, pitch: -80, yaw: 10, off: 1, ox: 0.08, oy: 1.2, oz: -0.1, palm: 0, spine: -14, chest: -8, head: -12, hipY: 0.72, hipLean: -8, twist: -6, hipYaw: 0, nElbow: 0 } },
        { f: 10, e: 'in', p: { gx: 0.06, gy: 1.12, ox: 0.04, oy: 1.14, chest: -14, head: -18 } },
        { f: 13, e: 'snap', p: { gx: 0.72, gy: 1.44, gz: 0.14, pitch: -10, ox: 0.66, oy: 1.22, oz: -0.12, palm: 1, hipLean: -18, spine: -6, chest: -6, head: -8, hipY: 0.72, fx: 0.56, bx: -0.56, bKnee: 24, rootX: 0.06, twist: -4 } },
        { f: 17, e: 'io', p: { gx: 0.74, ox: 0.64, chest: -3 } },
        { f: 21, e: 'io', p: { gx: 0.7, ox: 0.68, chest: -7 } },
        { f: 25, e: 'io', p: { gx: 0.74, ox: 0.64, bx: -0.42, by: 0.07, rootX: 0.1, chest: -3 } },
        { f: 30, e: 'io', p: { gx: 0.71, ox: 0.68, bx: -0.36, by: 0, chest: -7 } },
        { f: 36, e: 'io', p: { gx: 0.75, ox: 0.64, chest: -3 } },
        { f: 42, e: 'io', p: { gx: 0.71, ox: 0.68, fx: 0.66, fy: 0.07, rootX: 0.14, chest: -7 } },
        { f: 47, e: 'io', p: { gx: 0.75, ox: 0.65, fy: 0, chest: -3 } },
        { f: 53, e: 'io', p: { gx: 0.8, gy: 1.5, ox: 0.78, oy: 1.32, chest: 8, spine: 4, hipLean: -10, head: 14 } },
        { f: 58, e: 'hold', p: { gx: 0.78, ox: 0.77 } },
        { f: 63, e: 'io', p: { gx: 0.3, gy: 1.2, pitch: -40, ox: 0.3, oy: 1.15, palm: 0, chest: 0, head: -4, spine: -2 } },
        { f: 66, e: 'lin', p: { blade: 1, gx: 0.22, gy: 1.3, pitch: 60, yaw: 20 } },
        { f: 74, e: 'io', reset: true },
      ],
      { lagTorso: 0.6, lagHead: 1.2 },
    ),

    // ----------------------------------------------------------- parry set
    // High two-handed slant, weight forward: absorb, then counter.
    parry: clip(
      stance,
      [
        { f: 1, e: 'snap', p: { gx: 0.34, gy: 1.62, gz: 0.16, pitch: 128, yaw: 12, hipY: stance.hipY - 0.02, chest: stance.chest + 1, twist: 4, hipLean: -10, rootX: 0.02, fx: stance.fx + 0.04, nElbow: 6 } },
        { f: 3, p: { pitch: 131 } },
        { f: 5, p: { pitch: 126 } },
        { f: 7, p: { pitch: 129 } },
        { f: 16, e: 'io', p: { pitch: 112, gx: 0.4, gy: 1.54, chest: stance.chest - 3, head: stance.head + 4 } },
        { f: 32, e: 'io', reset: true },
      ],
      { lagTorso: 0.3, lagHead: 1 },
    ),
    // Beats the blade down and away during the freeze, stomps in, straight back to the high guard.
    parrySuccess: clip(stance, [
      { f: 0, p: { gx: 0.34, gy: 1.62, gz: 0.16, pitch: 128, yaw: 12, hipY: stance.hipY - 0.02, twist: 4, hipLean: -10, rootX: 0.02, fx: stance.fx + 0.04, nElbow: 6 } },
      { f: 4, e: 'snap', p: { gx: 0.54, gy: 1.38, pitch: 38, yaw: 30, chest: -3, twist: 16, hipYaw: 10 } },
      { f: 6, e: 'hold', p: { pitch: 36 } },
      { f: 9, e: 'out', p: { rootX: 0.08, fx: stance.fx + 0.08, hipY: stance.hipY - 0.05 } },
      { f: 12, e: 'io', p: { gx: stance.gx, gy: stance.gy, pitch: 196, yaw: stance.yaw, twist: stance.twist, hipYaw: stance.hipYaw } },
      { f: 14, e: 'io', reset: true },
    ]),
    // The biggest stagger in the cast: blade flung past vertical, arms overhead, two stomps back.
    parried: clip(stance, [
      { f: 2, e: 'snap', p: { pitch: 206, gx: -0.06, gy: 1.9, chest: stance.chest + 20, spine: 10, hipLean: stance.hipLean + 16, head: stance.head + 25, fy: 0.15, fPitch: 20, rootX: -0.08 } },
      { f: 8, e: 'out', p: { bx: stance.bx - 0.2, fy: 0.1 } },
      { f: 14, e: 'io', p: { fy: 0, fPitch: 0, fx: stance.fx - 0.18, hipY: stance.hipY - 0.04, chest: stance.chest + 12, head: stance.head + 12 } },
      { f: 20, e: 'io', p: { bx: stance.bx - 0.1, chest: stance.chest + 6, spine: 4 } },
      { f: 28, e: 'in', reset: true },
    ]),

    // ----------------------------------------------------------- recovery / ceremony
    // "Nosferatu rise": rigid from the heels, no hands, the blade snaps back on at the top.
    getup: clip(stance, [
      { f: 0, p: { ...shared.knockdown.last } },
      { f: 3, e: 'in', p: { spin: 86, hipY: 0.18, rootX: -0.18, fx: -0.18, fy: -0.74, bx: -0.18, by: -0.74, fz: 0.02, bz: -0.02, fPitch: 10, bPitch: 10, fKnee: 0, bKnee: 0, hipLean: 0, hipYaw: 0, hipRoll: 0, spine: 0, chest: 0, twist: 0, head: 2, headYaw: 0, gx: -0.16, gy: 0.2, gz: 0.26, pitch: -88, yaw: 10, off: 1, ox: -0.16, oy: 0.2, oz: -0.26, palm: 0, blade: 0 } },
      { f: 9, e: 'in', p: { spin: 60, hipY: 0.5, rootX: -0.12, fx: -0.12, fy: -0.37, bx: -0.12, by: -0.37, gx: -0.1, gy: 0.52, ox: -0.1, oy: 0.52 } },
      { f: 14, e: 'lin', p: { spin: 28, hipY: 0.78, rootX: 0.02, fx: 0.02, fy: -0.09, bx: 0.02, by: -0.09, gx: 0.04, gy: 0.8, ox: 0.04, oy: 0.8 } },
      { f: 18, e: 'out', p: { spin: 0, hipY: 0.9, rootX: 0.1, fx: 0.16, fy: 0, bx: 0.0, by: 0, gx: 0.14, gy: 0.94, ox: 0.06, oy: 0.94, fPitch: 0, bPitch: 0, head: -10 } },
      { f: 20, e: 'snap', p: { blade: 1, gx: 0.22, gy: 1.0, pitch: -45, yaw: 20 } },
      { f: 26, e: 'io', reset: true },
    ]),

    // In shadow, breathing; the blade ignites pointing down-forward (crackling), then rises to guard.
    intro: (() => {
      const rest = makePose(stance, { hipY: 0.88, hipLean: 0, hipYaw: 0, spine: 0, chest: 2, twist: 0, head: -10, gx: 0.14, gy: 0.9, gz: 0.24, pitch: -45, yaw: 10, blade: 0, off: 1, ox: -0.04, oy: 0.92, oz: -0.26, palm: 0, fx: 0.2, bx: -0.24, bKnee: 4, fKnee: 4, nElbow: 0 });
      return clip(
        rest,
        [
          { f: 14, e: 'io', p: { chest: 5, hipY: 0.886 } },
          { f: 26, e: 'io', p: { chest: 2, hipY: 0.88, gx: 0.2, gy: 0.94 } },
          { f: 30, e: 'snap', p: { blade: 1 } },
          { f: 32, e: 'lin', p: { blade: 0.65 } },
          { f: 33, e: 'lin', p: { blade: 1 } },
          { f: 36, e: 'lin', p: { blade: 0.8 } },
          { f: 37, e: 'lin', p: { blade: 1 } },
          { f: 46, e: 'io', p: { gx: 0.3, gy: 1.3, pitch: 60, yaw: 16, off: 0, head: -6, hipY: 0.84 } },
          { f: 58, e: 'io', p: { gx: 0.12, gy: 1.82, pitch: 180, yaw: 22, chest: 4 } },
          { f: 70, e: 'io', p: { ...stance } },
        ],
        { lagTorso: 1.2, lagHead: 2.4 },
      );
    })(),

    // Blade lowered at her side, the free hand rises and squeezes, then she turns away and cuts the blade.
    victory: clip(stance, [
      { f: 10, e: 'io', p: { gx: 0.16, gy: 0.98, gz: 0.24, pitch: -60, yaw: 20, off: 1, ox: 0.3, oy: 1.1, oz: -0.1, palm: 1, hipY: 0.88, hipLean: 0, hipYaw: 0, spine: 0, chest: 4, twist: 0, head: -6, fx: 0.2, bx: -0.25, bKnee: 4, fKnee: 4, nElbow: 0 } },
      { f: 20, e: 'io', p: { ox: 0.44, oy: 1.42, head: -2 } },
      { f: 24, e: 'snap', p: { palm: 0, ox: 0.42, oy: 1.4 } },
      { f: 36, e: 'io', p: { chest: 6, head: 0 } },
      { f: 48, e: 'io', p: { spinY: 150, ox: 0.1, oy: 1.0, head: -4 } },
      { f: 52, e: 'lin', p: { blade: 0 } },
      { f: 64, e: 'io', p: { spinY: 160 } },
    ]),
  };

  return { stance, guard, crouch, crouchGuard, walk, walkBack, run, clips, turnFrames: 8 };
}
