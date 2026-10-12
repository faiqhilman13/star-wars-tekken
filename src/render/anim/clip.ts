import { HEAD_KEYS, NEUTRAL, POSE_KEYS, TORSO_KEYS, applyPatch, copyPose, type Pose, type PosePatch } from './pose';

/**
 * Easing for the segment that *ends* at a key.
 * - io (default): C1 monotone cubic spline through the neighbouring keys — motion flows through
 *   poses instead of stopping on every key (no overshoot past a key's value)
 * - snap: very fast start, long settle (strikes — the blade arrives early and the body follows)
 * - outBack: overshoot then settle (recoveries, catches)
 * - inBack: dips backward before going (anticipation built into one segment)
 * - hold: stay on the previous key until this key's frame, then cut (impact frames, stances)
 */
export type Ease = 'lin' | 'in' | 'out' | 'io' | 'snap' | 'expo' | 'outBack' | 'inBack' | 'hold';

export function ease(t: number, e: Ease): number {
  switch (e) {
    case 'lin':
      return t;
    case 'in':
      return t * t;
    case 'out':
      return 1 - (1 - t) * (1 - t);
    case 'snap':
      return 1 - Math.pow(1 - t, 4);
    case 'expo':
      return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
    case 'outBack': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    case 'inBack': {
      const c1 = 1.4;
      return (c1 + 1) * t * t * t - c1 * t * t;
    }
    case 'hold':
      return t >= 1 ? 1 : 0;
    default:
      return t * t * (3 - 2 * t);
  }
}

export interface KeySpec {
  /** Frame (60 fps) of this key. */
  f: number;
  /** Channels that change at this key; everything else carries over from the previous key. */
  p?: PosePatch;
  e?: Ease;
  /** Start from the clip base instead of the previous key. */
  reset?: boolean;
}

export interface ClipOptions {
  /** Frames the torso / head trail the hips (successive breaking of joints). */
  lagTorso?: number;
  lagHead?: number;
  loop?: boolean;
}

interface ResolvedKey {
  f: number;
  pose: Pose;
  e: Ease;
}

const N = POSE_KEYS.length;
/** Segments that end at rest (velocity 0 at their end key). */
const ENDS_AT_REST: ReadonlySet<Ease> = new Set<Ease>(['hold', 'out', 'snap', 'expo', 'outBack']);
/** Segments that start from rest. */
const STARTS_AT_REST: ReadonlySet<Ease> = new Set<Ease>(['hold', 'in', 'inBack']);

/** Fritsch–Carlson monotone tangent from the two neighbouring slopes. */
function monotoneTangent(d0: number, d1: number, h0: number, h1: number): number {
  if (d0 * d1 <= 0) return 0;
  return (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
}

export class Clip {
  readonly keys: ResolvedKey[];
  readonly length: number;
  readonly loop: boolean;
  private readonly lagTorso: number;
  private readonly lagHead: number;
  private readonly tmp: Pose = { ...NEUTRAL };
  /** Per-key, per-channel spline tangents (units per frame). */
  private readonly tangents: Float64Array[];

  constructor(keys: ResolvedKey[], opts: ClipOptions) {
    this.keys = keys;
    this.length = keys[keys.length - 1].f;
    this.loop = Boolean(opts.loop);
    this.lagTorso = opts.lagTorso ?? 0.8;
    this.lagHead = opts.lagHead ?? 1.6;
    this.tangents = this.computeTangents();
  }

  private computeTangents(): Float64Array[] {
    const keys = this.keys;
    const n = keys.length;
    const out = keys.map(() => new Float64Array(N));
    for (let i = 0; i < n; i += 1) {
      let prev = i - 1;
      let next = i + 1;
      if (this.loop && n > 2) {
        if (i === 0) prev = n - 2;
        if (i === n - 1) next = 1;
      }
      if (prev < 0 || next >= n) continue;
      const incoming = keys[i === 0 ? n - 1 : i].e;
      const outgoing = keys[next].e;
      if (ENDS_AT_REST.has(incoming) || STARTS_AT_REST.has(outgoing)) continue;
      const fp = i === 0 ? keys[prev].f - this.length : keys[prev].f;
      const fn = i === n - 1 ? keys[next].f + this.length : keys[next].f;
      const h0 = Math.max(1e-6, keys[i].f - fp);
      const h1 = Math.max(1e-6, fn - keys[i].f);
      const a = keys[prev].pose;
      const b = keys[i].pose;
      const c = keys[next].pose;
      const m = out[i];
      for (let k = 0; k < N; k += 1) {
        const key = POSE_KEYS[k];
        m[k] = monotoneTangent((b[key] - a[key]) / h0, (c[key] - b[key]) / h1, h0, h1);
      }
    }
    return out;
  }

  /** Final key pose (e.g. the held end of a fall). */
  get last(): Pose {
    return this.keys[this.keys.length - 1].pose;
  }

  sample(t: number, out: Pose): Pose {
    this.raw(t, out);
    if (this.lagTorso > 0) {
      this.raw(t - this.lagTorso, this.tmp);
      for (const k of TORSO_KEYS) out[k] = this.tmp[k];
    }
    if (this.lagHead > 0) {
      this.raw(t - this.lagHead, this.tmp);
      for (const k of HEAD_KEYS) out[k] = this.tmp[k];
    }
    return out;
  }

  /** Sample so the clip's full length is stretched over `duration` frames (hit stun, stagger). */
  sampleWarped(t: number, duration: number, out: Pose): Pose {
    const scale = this.length / Math.max(1, duration);
    return this.sample(t * scale, out);
  }

  private raw(t: number, out: Pose): Pose {
    const keys = this.keys;
    if (this.loop && this.length > 0) t = ((t % this.length) + this.length) % this.length;
    if (t <= keys[0].f) return copyPose(out, keys[0].pose);
    for (let i = 1; i < keys.length; i += 1) {
      const k = keys[i];
      if (t <= k.f) {
        const prev = keys[i - 1];
        const h = Math.max(1e-6, k.f - prev.f);
        const u = (t - prev.f) / h;
        const a = prev.pose;
        const b = k.pose;
        if (k.e === 'io') {
          // Cubic Hermite with monotone tangents: C1 through the keys.
          const u2 = u * u;
          const u3 = u2 * u;
          const h00 = 2 * u3 - 3 * u2 + 1;
          const h10 = (u3 - 2 * u2 + u) * h;
          const h01 = -2 * u3 + 3 * u2;
          const h11 = (u3 - u2) * h;
          const ma = this.tangents[i - 1];
          const mb = this.tangents[i];
          for (let c = 0; c < N; c += 1) {
            const key = POSE_KEYS[c];
            out[key] = h00 * a[key] + h10 * ma[c] + h01 * b[key] + h11 * mb[c];
          }
          return out;
        }
        const w = ease(u, k.e);
        for (const key of POSE_KEYS) out[key] = a[key] + (b[key] - a[key]) * w;
        return out;
      }
    }
    return copyPose(out, keys[keys.length - 1].pose);
  }
}

/** Build a clip from cumulative key patches over a base pose. */
export function clip(base: Pose, keys: KeySpec[], opts: ClipOptions = {}): Clip {
  const resolved: ResolvedKey[] = [];
  let prev: Pose = { ...base };
  const list = keys.length === 0 || keys[0].f > 0 ? [{ f: 0 }, ...keys] : keys;
  for (const k of list) {
    const pose = applyPatch({ ...(k.reset ? base : prev) }, k.p ?? {});
    resolved.push({ f: k.f, pose, e: k.e ?? 'io' });
    prev = pose;
  }
  return new Clip(resolved, opts);
}

/** A held single pose as a clip. */
export function still(pose: Pose): Clip {
  return new Clip([{ f: 0, pose: { ...pose }, e: 'lin' }], { lagTorso: 0, lagHead: 0 });
}
