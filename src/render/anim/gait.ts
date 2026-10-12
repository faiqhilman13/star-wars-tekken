import { copyPose, type Pose } from './pose';

/**
 * Procedural locomotion with planted feet: while a foot is on the deck it moves backward in the
 * body frame at exactly the body's speed, so it stays still in the world (no skating).
 *
 * - shuffle: side-stance fighting walk — the lead foot steps, then the rear foot closes.
 * - run: alternating sprint with a flight phase, heel kick, knee drive and arm pump.
 */
export interface GaitSpec {
  kind: 'shuffle' | 'run';
  base: Pose;
  /** World distance the body covers per full cycle. */
  stride: number;
  /** Peak foot lift during a swing. */
  lift: number;
  /** Hip dip on each plant (units). */
  bob: number;
  /** Added forward lean (deg, negative = forward). */
  lean: number;
  /** Chest twist oscillation (deg). */
  sway: number;
  /** Free-hand pump amplitude (run). */
  armPump: number;
  /** Blade pitch wobble (deg). */
  bladeBob: number;
  /** Run: fraction of the cycle a foot is planted. */
  stance?: number;
  /** Run: how far the trailing foot kicks up behind. */
  heelKick?: number;
  /** Shuffle: toe-down angle while a foot is lifted. */
  toe?: number;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const frac = (x: number) => x - Math.floor(x);

export function gaitPose(spec: GaitSpec, phase: number, out: Pose): Pose {
  copyPose(out, spec.base);
  const u = frac(phase);
  const b = spec.base;
  if (spec.kind === 'shuffle') {
    const q = spec.stride / 4;
    const foot = (w: number): [number, number, number] => {
      // returns [x offset, lift, toe pitch]
      if (w < 0.5) {
        const s = w / 0.5;
        return [-q + 2 * q * smooth(s), spec.lift * Math.sin(Math.PI * s), (spec.toe ?? 12) * Math.sin(Math.PI * s)];
      }
      const s = (w - 0.5) / 0.5;
      return [q - 2 * q * s, 0, 0];
    };
    const [fx, fy, fp] = foot(u);
    const [bx, by, bp] = foot(frac(u + 0.5));
    out.fx = b.fx + fx;
    out.fy = b.fy + fy;
    out.fPitch = b.fPitch + fp;
    out.bx = b.bx + bx;
    out.by = b.by + by;
    out.bPitch = b.bPitch + bp;
    out.hipY = b.hipY - spec.bob * (0.5 + 0.5 * Math.cos(4 * Math.PI * u));
    out.hipLean = b.hipLean + spec.lean;
    out.twist = b.twist + spec.sway * Math.sin(2 * Math.PI * u);
    out.pitch = b.pitch + spec.bladeBob * Math.sin(2 * Math.PI * u + 1);
    out.gy = b.gy + spec.bob * 0.5 * Math.cos(4 * Math.PI * u);
    // Pelvis drops toward the swinging leg; the chest counter-tilts and the hips counter-rotate a
    // touch, so the walk reads as weight shifting rather than a sliding statue.
    const w = Math.sin(2 * Math.PI * u);
    out.hipRoll = b.hipRoll + 2.5 * w;
    out.chestRoll = b.chestRoll - 1.6 * w;
    out.hipYaw = b.hipYaw + spec.sway * 0.6 * w;
    out.spineYaw = b.spineYaw - spec.sway * 0.3 * w;
    return out;
  }

  // Run.
  const stance = spec.stance ?? 0.36;
  const half = (spec.stride * stance) / 2;
  const kick = spec.heelKick ?? 0.25;
  const leg = (w: number): [number, number, number] => {
    if (w < stance) {
      const s = w / stance;
      const toe = s > 0.65 ? ((s - 0.65) / 0.35) * 35 : 0;
      return [half - 2 * half * s, 0, toe];
    }
    const s = (w - stance) / (1 - stance);
    // Heel kicks up behind first, then the knee drives the foot forward and down.
    const forward = smooth(s);
    const x = -half + 2 * half * forward - kick * Math.sin(Math.PI * Math.min(1, s * 1.6)) * (1 - s);
    const y = spec.lift * Math.pow(Math.sin(Math.PI * s), 0.75) + kick * 0.6 * Math.sin(Math.PI * Math.min(1, s * 1.6)) * (1 - s);
    return [x, y, 40 * Math.sin(Math.PI * s) - 10 * s];
  };
  const [fx, fy, fp] = leg(u);
  const [bx, by, bp] = leg(frac(u + 0.5));
  out.fx = b.fx + fx;
  out.fy = b.fy + fy;
  out.fPitch = b.fPitch + fp;
  out.bx = b.bx + bx;
  out.by = b.by + by;
  out.bPitch = b.bPitch + bp;
  // Lowest at each mid-stance, highest in flight.
  const bounce = 0.5 + 0.5 * Math.cos(4 * Math.PI * (u - stance / 2));
  out.hipY = b.hipY - spec.bob * bounce;
  out.hipLean = b.hipLean + spec.lean;
  out.hipYaw = b.hipYaw + spec.sway * 0.5 * Math.sin(2 * Math.PI * u);
  out.twist = b.twist - spec.sway * Math.sin(2 * Math.PI * u);
  out.ox = b.ox + spec.armPump * Math.sin(2 * Math.PI * u + Math.PI);
  out.oy = b.oy + spec.armPump * 0.45 * Math.cos(2 * Math.PI * u + Math.PI);
  out.pitch = b.pitch + spec.bladeBob * Math.sin(4 * Math.PI * u);
  out.gy = b.gy - spec.bob * 0.6 * bounce;
  out.head = b.head + spec.bob * 20 * bounce;
  // Pelvis tilt + chest counter-roll, and the spine counter-rotates against the hips.
  const w = Math.sin(2 * Math.PI * u);
  out.hipRoll = b.hipRoll + 4 * w;
  out.chestRoll = b.chestRoll - 3 * w;
  out.spineYaw = b.spineYaw - spec.sway * 0.25 * w;
  return out;
}
