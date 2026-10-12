import type { Box, GuardHeight, LaunchKind, MoveId, ProjectileKind } from './types';

export interface HitSpec {
  box: Box;
  damage: number;
  chip: number;
  hitstun: number;
  blockstun: number;
  height: GuardHeight;
  /** Total slide distance applied to the defender (or the attacker when the defender is cornered). */
  pushback: number;
  hitstop: number;
  /** Knocks the defender down (airborne launch) on hit. */
  knockdown: boolean;
  launchVx?: number;
  launchVy?: number;
  launchKind?: LaunchKind;
  meterGain: number;
  /** 0..1 strength for VFX/audio and hit-reaction weight. */
  strength: number;
}

export interface HitWindow {
  /** First and last move frame (1-based) the hitbox is live. */
  from: number;
  to: number;
  spec: HitSpec;
}

export interface MoveDef {
  id: MoveId;
  /** Total frames; air moves end on landing instead. */
  total: number;
  /** Frames before the first hitbox (counter-hit window, AI reads). */
  startup: number;
  activeFrom: number;
  activeTo: number;
  hits: HitWindow[];
  crouching?: boolean;
  airborne?: boolean;
  /** Forward travel per frame over a frame range. */
  travel?: Array<{ from: number; to: number; dx: number }>;
  /** Scripted hop: y follows a sine arc of this height between the frames (leap strikes). */
  arc?: { from: number; to: number; height: number };
  /** Push boxes are ignored in this frame range (pass-through dashes). */
  noPush?: [number, number];
  hurtExtend?: { from: number; to: number; box: Box };
  cancels?: MoveId[];
  cancelWindow?: [number, number];
  meterCost?: number;
  invuln?: [number, number];
  projectile?: { frame: number; kind: ProjectileKind };
  /** Hold on this frame while the fighter's own projectile is still out (staff throw). */
  holdWhileProjectile?: number;
  /** Command grab window (unblockable, unparryable, grounded targets). */
  grab?: { from: number; to: number; box: Box };
  /** Parry window for the parry move. */
  parry?: [number, number];
  /** Strength of the swing whoosh (0 = silent). */
  swing: number;
}

export interface ProjectileSpec {
  speed: number;
  returnSpeed: number;
  maxDistance: number;
  halfWidth: number;
  halfHeight: number;
  spawnX: number;
  spawnY: number;
  spec: HitSpec;
}

export type SpecialKind = 'wave' | 'grip' | 'leap' | 'staff';
export type SuperKind = 'storm' | 'lightning' | 'tempest' | 'whirlwind';
export type WeaponKind = 'single' | 'dual' | 'staff';

export interface CharacterStats {
  id: import('./types').CharacterId;
  name: string;
  title: string;
  style: string;
  weapon: WeaponKind;
  special: SpecialKind;
  superKind: SuperKind;
  specialName: string;
  superName: string;
  health: number;
  walkForward: number;
  walkBack: number;
  runSpeed: number;
  jumpVy: number;
  jumpVxForward: number;
  jumpVxBack: number;
  backdashDistance: number;
  backdashFrames: number;
  knockdownFrames: number;
  getupFrames: number;
  throwRange: number;
  throwDamage: number;
  /** Standing hurtbox height. */
  height: number;
  moves: Record<MoveId, MoveDef>;
  projectile?: ProjectileSpec;
  /** Command grab (Force Grip) tuning. */
  grip?: { lift: number; ticks: number; tickDamage: number; hurlDamage: number };
  /**
   * Side-switch throw: the thrower vaults over the held victim (frames from→to, arc height), lands
   * behind them, and at `release` launches them back the way she came. Replaces the forward throw.
   */
  throwVault?: { from: number; to: number; height: number; release: number; total: number };
}

/** Hit spec helper with sensible defaults. */
export function hit(o: Partial<HitSpec> & { box: Box; damage: number }): HitSpec {
  return {
    chip: Math.round(o.damage * 0.12),
    hitstun: 16,
    blockstun: 12,
    height: 'mid',
    pushback: 0.4,
    hitstop: 9,
    knockdown: false,
    meterGain: Math.round(o.damage * 0.16),
    strength: 0.4,
    ...o,
  };
}

/** Evenly spaced multi-hit windows (flurries, spins, beams). */
export function windows(from: number, to: number, every: number, length: number, spec: HitSpec): HitWindow[] {
  const out: HitWindow[] = [];
  for (let f = from; f <= to; f += every) out.push({ from: f, to: Math.min(to, f + length - 1), spec });
  return out;
}
