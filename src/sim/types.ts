export type FighterId = 0 | 1;

export type CharacterId = 'kael' | 'vexa' | 'asha' | 'thane';
export const CHARACTER_IDS: readonly CharacterId[] = ['kael', 'vexa', 'asha', 'thane'];

/** One frame of buttons for one fighter, in screen terms (left/right, not forward/back). */
export interface InputFrame {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  light: boolean;
  heavy: boolean;
  force: boolean;
  parry: boolean;
}

export type Button = keyof InputFrame;
export const BUTTONS: readonly Button[] = ['left', 'right', 'up', 'down', 'light', 'heavy', 'force', 'parry'];

export function emptyInput(): InputFrame {
  return { left: false, right: false, up: false, down: false, light: false, heavy: false, force: false, parry: false };
}

export function copyInput(target: InputFrame, source: InputFrame): InputFrame {
  for (const b of BUTTONS) target[b] = source[b];
  return target;
}

/** Axis-aligned box in fighter-local space: x points toward the fighter's facing, y up from the feet. */
export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** World-space box. */
export interface WorldBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export type GuardHeight = 'mid' | 'low' | 'overhead';

export type MoveId =
  | 'light'
  | 'heavy'
  | 'crLight'
  | 'sweep'
  | 'airLight'
  | 'airHeavy'
  | 'throw'
  | 'special'
  | 'super'
  | 'parry';

/** How a launched fighter flies (drives the fall animation). */
export type LaunchKind = 'blowback' | 'sweep' | 'spin' | 'throw' | 'ko';

/** Where a grounded hit landed (drives the hit reaction). */
export type HitReaction = 'high' | 'body' | 'low' | 'crouch';

export type ThrowKind = 'throw' | 'grip';

export type FighterState =
  | 'intro'
  | 'idle'
  | 'walk'
  | 'run'
  | 'runStop'
  | 'crouch'
  | 'jumpSquat'
  | 'air'
  | 'land'
  | 'backdash'
  | 'attack'
  | 'block'
  | 'hit'
  | 'airHit'
  | 'knockdown'
  | 'getup'
  | 'throwing'
  | 'thrown'
  | 'clash'
  | 'parrySuccess'
  | 'parried'
  | 'ko'
  | 'victory';

export type MatchPhase = 'intro' | 'fight' | 'roundOver' | 'matchOver';

export type ProjectileKind = 'wave' | 'staff';

export type SimEvent =
  | {
      type: 'hit';
      attacker: FighterId;
      x: number;
      y: number;
      damage: number;
      strength: number;
      blocked: boolean;
      source: MoveId;
      counter: boolean;
      combo: number;
    }
  | { type: 'clash'; x: number; y: number }
  | { type: 'parry'; defender: FighterId; x: number; y: number; projectile: boolean }
  | { type: 'parried'; fighter: FighterId }
  | { type: 'swing'; fighter: FighterId; move: MoveId; strength: number }
  | { type: 'jump'; fighter: FighterId; flip: boolean }
  | { type: 'land'; fighter: FighterId }
  | { type: 'run'; fighter: FighterId }
  | { type: 'runStep'; fighter: FighterId }
  | { type: 'skid'; fighter: FighterId }
  | { type: 'dash'; fighter: FighterId; back: boolean }
  | { type: 'specialStart'; fighter: FighterId }
  | { type: 'projectile'; fighter: FighterId; kind: ProjectileKind; x: number; y: number }
  | { type: 'projectileClash'; x: number; y: number }
  | { type: 'staffCatch'; fighter: FighterId }
  | { type: 'deflect'; fighter: FighterId; x: number; y: number }
  | { type: 'grip'; fighter: FighterId }
  | { type: 'gripTick'; fighter: FighterId; x: number; y: number }
  | { type: 'leap'; fighter: FighterId }
  | { type: 'throw'; fighter: FighterId; x: number; y: number }
  | { type: 'throwTech'; x: number; y: number }
  | { type: 'bounce'; fighter: FighterId; x: number }
  | { type: 'knockdown'; fighter: FighterId; x: number }
  | { type: 'superFlash'; fighter: FighterId }
  | { type: 'noMeter'; fighter: FighterId }
  | { type: 'roundIntro'; round: number; finalRound: boolean }
  | { type: 'fight' }
  | { type: 'ko'; loser: FighterId | -1 }
  | { type: 'roundEnd'; winner: FighterId | -1; reason: 'ko' | 'time' | 'double'; perfect: boolean }
  | { type: 'matchEnd'; winner: FighterId | -1 }
  | { type: 'timeWarning'; seconds: number };
