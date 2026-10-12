import type { Clip } from './clip';
import type { GaitSpec } from './gait';
import type { Pose } from './pose';

/**
 * Every clip a fighter needs. Frame-timed clips are sampled with the sim's state frame (60 fps);
 * jump clips by frames since takeoff; reaction clips are time-warped to their stun length.
 */
export type ClipName =
  | 'intro'
  | 'idle'
  | 'victory'
  | 'jumpSquat'
  | 'jumpUp'
  | 'jumpFwd'
  | 'jumpBack'
  | 'jumpRun'
  | 'airRecover'
  | 'land'
  | 'backdash'
  | 'runStop'
  | 'light'
  | 'heavy'
  | 'crLight'
  | 'sweep'
  | 'airLight'
  | 'airHeavy'
  | 'throwStart'
  | 'throwing'
  | 'gripping'
  | 'special'
  | 'superCharge'
  | 'super'
  | 'parry'
  | 'parrySuccess'
  | 'parried'
  | 'block'
  | 'crouchBlock'
  | 'hitHigh'
  | 'hitHighHeavy'
  | 'hitBody'
  | 'hitBodyHeavy'
  | 'hitLow'
  | 'hitLowHeavy'
  | 'hitCrouch'
  | 'stagger'
  | 'fallBlowback'
  | 'fallSweep'
  | 'fallSpin'
  | 'fallThrow'
  | 'fallKo'
  | 'bounce'
  | 'knockdown'
  | 'getup'
  | 'koLie'
  | 'clash'
  | 'shocked'
  | 'thrownVictim'
  | 'gripVictim';

/**
 * Optional variety clips. The animator uses them when present and falls back otherwise:
 * - light2 / light3: 2nd and 3rd chained lights (same frame data as `light`), crLight2 likewise,
 *   heavyChain: heavy used as a combo ender
 * - idleBreak / idleBreak2: occasional idle flourishes (played after ~7-12 s of idling)
 * - runStart: first frames of a run (lean in, push off) before the gait takes over
 * - crouchDown / standUp: transitions into / out of crouch
 * - landHeavy: landing from a flip or running jump
 * - hitHigh2 / hitBody2: alternate reactions (every other hit)
 */
export type OptionalClipName =
  | 'light2'
  | 'light3'
  | 'crLight2'
  | 'heavyChain'
  | 'idleBreak'
  | 'idleBreak2'
  | 'runStart'
  | 'crouchDown'
  | 'standUp'
  | 'landHeavy'
  | 'hitHigh2'
  | 'hitBody2';

export type AnimClipName = ClipName | OptionalClipName;

export interface AnimSet {
  /** Neutral fighting stance (idle loops around it). */
  stance: Pose;
  /** Holding back against a threat. */
  guard: Pose;
  crouch: Pose;
  crouchGuard: Pose;
  walk: import('./gait').GaitSpec;
  walkBack: GaitSpec;
  run: GaitSpec;
  clips: Record<ClipName, Clip> & Partial<Record<OptionalClipName, Clip>>;
  /** Frames a turnaround takes. */
  turnFrames: number;
}
