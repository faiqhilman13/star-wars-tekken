import { SUPER_FREEZE } from '../../sim/constants';
import type { Fighter } from '../../sim/Fighter';
import type { Match } from '../../sim/Match';
import type { FighterState, MoveId } from '../../sim/types';
import type { Clip } from './clip';
import { gaitPose } from './gait';
import { copyPose, NEUTRAL, POSE_KEYS, type Pose } from './pose';
import { Secondary } from './springs';
import type { AnimClipName, AnimSet, ClipName } from './types';

const N = POSE_KEYS.length;
const ANGLE_SET = new Set<string>(['spin', 'spinY', 'tilt', 'pitch', 'yaw', 'roll', 'pitch2', 'yaw2', 'hipYaw', 'twist']);
const IS_ANGLE = POSE_KEYS.map((k) => ANGLE_SET.has(k));

const MOVE_CLIP: Record<MoveId, ClipName> = {
  light: 'light',
  heavy: 'heavy',
  crLight: 'crLight',
  sweep: 'sweep',
  airLight: 'airLight',
  airHeavy: 'airHeavy',
  throw: 'throwStart',
  special: 'special',
  super: 'super',
  parry: 'parry',
};

/** States whose feet are planted on the deck (foot locking + automatic steps). */
const PLANTED: ReadonlySet<FighterState> = new Set<FighterState>(['idle', 'crouch', 'attack', 'throwing', 'land', 'intro', 'victory', 'parrySuccess']);
/** States that snap into their first pose even inside a hitstop freeze (impact reads instantly). */
const SNAP_ON_FREEZE: ReadonlySet<FighterState> = new Set<FighterState>(['hit', 'block', 'parried', 'parrySuccess', 'clash', 'airHit', 'thrown']);

const wrap180 = (a: number) => a - 360 * Math.round(a / 360);
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Face expression weights (0..1) for the `expr_*` morph targets. */
export interface Expression {
  blink: number;
  angry: number;
  shout: number;
  pain: number;
  smile: number;
  focus: number;
}

/**
 * Guilty Gear-style limited animation: the body pose is held and refreshed every N game frames
 * (on 2s = 30 fps, on 3s = 20 fps) while motion through space stays smooth. A new clip always
 * shows on its first frame, so inputs never feel late.
 */
const HOLD_FRAMES: Partial<Record<FighterState, number>> = {
  idle: 3,
  crouch: 3,
  intro: 3,
  victory: 3,
  walk: 2,
  run: 2,
  runStop: 2,
  attack: 2,
  throwing: 2,
  parrySuccess: 2,
  hit: 2,
  block: 2,
  parried: 2,
  air: 2,
  airHit: 2,
  knockdown: 3,
  getup: 2,
  ko: 3,
  thrown: 2,
  clash: 2,
  backdash: 2,
  land: 2,
  jumpSquat: 1,
};

export interface AnimFrame {
  match: Match;
  /** Interpolation between sim frames (0 while frozen). */
  alpha: number;
  /** Real seconds since last render. */
  dt: number;
  /** Ambient seconds (frozen under reduced motion). */
  time: number;
  /** Sim time scale (KO slow motion) — blends/springs follow game time. */
  timeScale: number;
  reducedMotion: boolean;
}

interface Selection {
  clip: Clip | null;
  t: number;
  key: string;
  /** Transition length in frames. */
  blend: number;
}

interface FootLock {
  locked: boolean;
  /** Anchor in world x. */
  w: number;
  stepT: number;
  from: number;
  to: number;
  dur: number;
  lift: number;
  /** Residual local offset after releasing the lock (decays). */
  release: number;
  /** Last output foot x (local). */
  out: number;
}

/**
 * Turns a fighter's sim state into a pose every rendered frame:
 * - picks the clip (with chain / hit / idle variants when a character provides them),
 * - samples it at the right time,
 * - transitions between clips with inertialization (the previous motion's offset and velocity
 *   decay smoothly into the new clip — no pops, no frozen cross-fades),
 * - runs procedural gaits and turnarounds,
 * - plants the feet on the deck with automatic steps when the body travels or a pose moves a
 *   grounded foot (no skating),
 * - layers springs.
 */
export class FighterAnimator {
  readonly pose: Pose = { ...NEUTRAL };
  /** The pose actually shown (held between limited-animation steps). */
  readonly shown: Pose = { ...NEUTRAL };
  readonly expression: Expression = { blink: 0, angry: 0, shout: 0, pain: 0, smile: 0, focus: 0 };
  /** Set false to disable held-pose limited animation (smooth 60 fps poses). */
  limited = true;
  private holdAcc = 99;
  private shownKey = '';
  private readonly exprTarget: Expression = { blink: 0, angry: 0, shout: 0, pain: 0, smile: 0, focus: 0 };
  private blinkClock = 0;
  readonly sec = new Secondary();
  /** World units per local unit along x (rig scale × cos(present yaw)); set by the game. */
  footScale = 0.955;
  private readonly target: Pose = { ...NEUTRAL };
  private readonly blended: Pose = { ...NEUTRAL };
  private readonly lastBlended: Pose = { ...NEUTRAL };
  private readonly vel = new Float64Array(N);
  private readonly ibX0 = new Float64Array(N);
  private readonly ibV0 = new Float64Array(N);
  private readonly ibA0 = new Float64Array(N);
  private readonly ibA = new Float64Array(N);
  private readonly ibB = new Float64Array(N);
  private readonly ibC = new Float64Array(N);
  private readonly ibT1 = new Float64Array(N);
  private ibActive = false;
  private ibElapsed = 0;
  private ibSnap = false;
  private key = '';
  private walkPhase = 0;
  private runPhase = 0;
  private lastX = 0;
  private lastRenderX = 0;
  private lastFacing: 1 | -1 = 1;
  private turnLeft = 0;
  private localFrames = 0;
  private bounceAt = -1;
  private lastState = '';
  private prevState = '';
  private lastStateFrame = 0;
  private hitParity = 0;
  private idleTime = 0;
  private idleBreaks = 0;
  private idleBreakAt = 420;
  private airFlip = false;
  private lastStepPhase = 0;
  private lastSpinY = 0;
  private showClip: Clip | null = null;
  private showName = '';
  private showT = 0;
  private showHold = false;
  private readonly feet: [FootLock, FootLock] = [this.newFoot(), this.newFoot()];
  onFootstep: ((run: boolean) => void) | null = null;

  constructor(
    readonly f: Fighter,
    public anims: AnimSet,
  ) {
    copyPose(this.pose, anims.stance);
    copyPose(this.blended, anims.stance);
    copyPose(this.lastBlended, anims.stance);
  }

  private newFoot(): FootLock {
    return { locked: false, w: 0, stepT: -1, from: 0, to: 0, dur: 4, lift: 0, release: 0, out: 0 };
  }

  setAnims(anims: AnimSet): void {
    this.anims = anims;
    this.reset();
  }

  /**
   * Play a clip outside sim control (select-screen previews). Returns to sim-driven poses when it
   * ends unless `hold` keeps the last frame.
   */
  showcase(name: AnimClipName | null, hold = false): void {
    this.showClip = name ? (this.anims.clips[name] ?? null) : null;
    this.showName = name ?? '';
    this.showT = 0;
    this.showHold = hold;
  }

  get showcasing(): string {
    return this.showClip ? this.showName : '';
  }

  reset(): void {
    this.showClip = null;
    this.holdAcc = 99;
    this.shownKey = '';
    copyPose(this.shown, this.anims.stance);
    copyPose(this.pose, this.anims.stance);
    copyPose(this.blended, this.anims.stance);
    copyPose(this.lastBlended, this.anims.stance);
    this.vel.fill(0);
    this.ibActive = false;
    this.key = '';
    this.turnLeft = 0;
    this.lastFacing = this.f.facing;
    this.lastX = this.f.x;
    this.lastRenderX = this.f.x;
    this.sec.reset();
    this.bounceAt = -1;
    this.idleTime = 0;
    for (const foot of this.feet) Object.assign(foot, this.newFoot());
  }

  /** Physics kicks from sim events. */
  hitReaction(strength: number, heightRatio: number): void {
    this.sec.hit(strength, heightRatio);
  }

  blockReaction(strength: number): void {
    this.sec.block(strength);
  }

  landed(speed: number): void {
    this.sec.land(speed);
  }

  swung(strength: number): void {
    this.sec.swing(strength);
  }

  bounced(): void {
    this.bounceAt = 0;
    this.sec.drop.kick(1.5);
  }

  private variant(base: ClipName, alt: AnimClipName | null): { clip: Clip; key: string } {
    const c = this.anims.clips;
    const a = alt ? c[alt] : undefined;
    return a ? { clip: a, key: alt as string } : { clip: c[base], key: base };
  }

  private select(fr: AnimFrame): Selection {
    const f = this.f;
    const c = this.anims.clips;
    const t = f.stateFrame + fr.alpha;
    if (this.showClip) return { clip: this.showClip, t: this.showT, key: `show:${this.showName}`, blend: 4 };
    const early = Math.max(t, Math.min(this.localFrames, 4));
    switch (f.state) {
      case 'intro':
        return { clip: c.intro, t: fr.match.phase === 'intro' ? fr.match.phaseFrame + fr.alpha : 999, key: 'intro', blend: 0 };
      case 'idle': {
        if (f.guarding) return { clip: null, t, key: 'guard', blend: 4 };
        if (this.prevState === 'crouch' && c.standUp && t < c.standUp.length) return { clip: c.standUp, t, key: 'standUp', blend: 2 };
        // Occasional idle flourish (character-specific), alternating between variants.
        const brk = this.idleBreaks % 2 === 1 && c.idleBreak2 ? c.idleBreak2 : c.idleBreak;
        if (brk && this.idleTime > this.idleBreakAt) {
          const bt = this.idleTime - this.idleBreakAt;
          if (bt < brk.length) return { clip: brk, t: bt, key: `idleBreak${this.idleBreaks % 2}`, blend: 8 };
          this.idleTime = 0;
          this.idleBreaks += 1;
          this.idleBreakAt = 420 + ((this.idleBreaks * 137 + f.id * 71) % 300);
        }
        return { clip: c.idle, t: fr.time * 60, key: 'idle', blend: 6 };
      }
      case 'walk':
        return { clip: null, t, key: f.walkDir < 0 ? 'walkBack' : 'walk', blend: 5 };
      case 'run':
        if (c.runStart && t < c.runStart.length) return { clip: c.runStart, t, key: 'runStart', blend: 2 };
        return { clip: null, t, key: 'run', blend: 5 };
      case 'runStop':
        return { clip: c.runStop, t, key: 'runStop', blend: 3 };
      case 'crouch': {
        if (f.guarding) return { clip: null, t, key: 'crouchGuard', blend: 3 };
        if (c.crouchDown && this.prevState !== 'crouch' && t < c.crouchDown.length) return { clip: c.crouchDown, t, key: 'crouchDown', blend: 2 };
        return { clip: null, t, key: 'crouch', blend: 4 };
      }
      case 'jumpSquat':
        return { clip: c.jumpSquat, t, key: 'jumpSquat', blend: 1.5 };
      case 'air': {
        if (f.airAttackUsed && f.jumpDir === 0 && !f.runJump) return { clip: c.airRecover, t, key: 'airRecover', blend: 3 };
        const name: ClipName = f.runJump ? 'jumpRun' : f.jumpDir > 0 ? 'jumpFwd' : f.jumpDir < 0 ? 'jumpBack' : 'jumpUp';
        return { clip: c[name], t, key: name, blend: 2 };
      }
      case 'land': {
        const v = this.variant('land', this.airFlip ? 'landHeavy' : null);
        return { clip: v.clip, t, key: v.key, blend: 1.5 };
      }
      case 'backdash':
        return { clip: c.backdash, t: (t * 18) / Math.max(1, f.def.backdashFrames), key: 'backdash', blend: 2 };
      case 'attack': {
        const id = f.move?.id ?? 'light';
        if (id === 'super' && fr.match.superFreeze > 0 && fr.match.superOwner === f.id) {
          return { clip: c.superCharge, t: SUPER_FREEZE - fr.match.superFreeze + fr.alpha, key: 'superCharge', blend: 3 };
        }
        // Combo strings: chained lights / crouch lights / heavy finishers use their own swings.
        let alt: AnimClipName | null = null;
        if (id === 'light' && f.chain >= 1) alt = f.chain >= 2 && c.light3 ? 'light3' : 'light2';
        else if (id === 'crLight' && f.chain >= 1) alt = 'crLight2';
        else if (id === 'heavy' && f.chain >= 1) alt = 'heavyChain';
        const v = this.variant(MOVE_CLIP[id], alt);
        return { clip: v.clip, t, key: v.key, blend: id === 'parry' ? 1 : 2 };
      }
      case 'block': {
        const total = f.stateFrame + Math.max(1, f.stun);
        return { clip: f.crouching ? c.crouchBlock : c.block, t: (early * c.block.length) / Math.max(1, total), key: f.crouching ? 'crouchBlock' : 'block', blend: 1 };
      }
      case 'hit': {
        const caster = fr.match.opponent(f);
        if (caster.state === 'attack' && caster.move?.id === 'super' && caster.def.superKind === 'lightning' && caster.stateFrame >= 11) {
          return { clip: c.shocked, t: caster.stateFrame + fr.alpha, key: 'shocked', blend: 2 };
        }
        let name: ClipName;
        if (f.hitReact === 'crouch') name = 'hitCrouch';
        else if (f.counterFlash > 0 && f.hitHeavy) name = 'stagger';
        else if (f.hitReact === 'high') name = f.hitHeavy ? 'hitHighHeavy' : 'hitHigh';
        else if (f.hitReact === 'low') name = f.hitHeavy ? 'hitLowHeavy' : 'hitLow';
        else name = f.hitHeavy ? 'hitBodyHeavy' : 'hitBody';
        const alt = this.hitParity === 1 && (name === 'hitHigh' || name === 'hitBody') ? ((name + '2') as AnimClipName) : null;
        const v = this.variant(name, alt);
        const total = f.stateFrame + Math.max(1, f.stun);
        return { clip: v.clip, t: (early * v.clip.length) / Math.max(1, total), key: `${v.key}#${this.hitParity}`, blend: 1 };
      }
      case 'parrySuccess':
        return { clip: c.parrySuccess, t: Math.max(t, Math.min(this.localFrames, 6)), key: 'parrySuccess', blend: 1 };
      case 'parried': {
        const total = f.stateFrame + Math.max(1, f.stun);
        return { clip: c.parried, t: (early * c.parried.length) / Math.max(1, total), key: 'parried', blend: 1 };
      }
      case 'airHit': {
        if (f.bounced && this.bounceAt >= 0) return { clip: c.bounce, t: this.bounceAt, key: 'bounce', blend: 2 };
        const name: ClipName = f.launchKind === 'sweep' ? 'fallSweep' : f.launchKind === 'spin' ? 'fallSpin' : f.launchKind === 'throw' ? 'fallThrow' : f.launchKind === 'ko' ? 'fallKo' : 'fallBlowback';
        return { clip: c[name], t: Math.max(t, Math.min(this.localFrames, 3)), key: name, blend: 2 };
      }
      case 'knockdown':
        return { clip: c.knockdown, t, key: 'knockdown', blend: 3 };
      case 'getup':
        return { clip: c.getup, t: (t * c.getup.length) / Math.max(1, f.def.getupFrames), key: 'getup', blend: 2 };
      case 'ko':
        return { clip: c.koLie, t, key: 'koLie', blend: 4 };
      case 'throwing':
        return f.throwKind === 'grip' ? { clip: c.gripping, t, key: 'gripping', blend: 2 } : { clip: c.throwing, t, key: 'throwing', blend: 2 };
      case 'thrown':
        return f.throwKind === 'grip' ? { clip: c.gripVictim, t, key: 'gripVictim', blend: 3 } : { clip: c.thrownVictim, t, key: 'thrownVictim', blend: 2 };
      case 'clash':
        return { clip: c.clash, t, key: 'clash', blend: 1 };
      case 'victory':
        return { clip: c.victory, t, key: 'victory', blend: 5 };
      default:
        return { clip: null, t, key: 'stance', blend: 4 };
    }
  }

  /**
   * @param renderX the fighter's interpolated world x this frame (feet are planted against it).
   */
  update(fr: AnimFrame, renderX = this.f.x): Pose {
    const f = this.f;
    const a = this.anims;
    const frozen = fr.match.frozen;
    const real = fr.dt * 60;
    const frames = frozen ? 0 : real * fr.timeScale;

    if (f.state !== this.lastState) {
      this.prevState = this.lastState;
      this.lastState = f.state;
      this.localFrames = 0;
      if (f.state !== 'airHit') this.bounceAt = -1;
      if (f.state === 'hit') this.hitParity ^= 1;
    } else {
      this.localFrames += real;
      // A fresh hit while already reeling restarts the stun: alternate the reaction.
      if (f.state === 'hit' && f.stateFrame < this.lastStateFrame) this.hitParity ^= 1;
    }
    this.lastStateFrame = f.stateFrame;
    if (f.state === 'air') this.airFlip = f.runJump || f.jumpDir !== 0;
    if (this.bounceAt >= 0 && !frozen) this.bounceAt += frames;
    if (this.showClip) {
      this.showT += real;
      if (!this.showHold && this.showT > this.showClip.length + 12) this.showClip = null;
    }
    if (f.state === 'idle' && !f.guarding && !this.showClip && !frozen) this.idleTime += frames;
    else if (f.state !== 'idle') this.idleTime = 0;

    // Locomotion phases from actual displacement (feet stay planted).
    const dx = (f.x - this.lastX) * f.facing;
    this.lastX = f.x;
    if (f.state === 'walk') this.walkPhase += dx / (f.walkDir < 0 ? a.walkBack.stride : a.walk.stride);
    if (f.state === 'run') this.runPhase += dx / a.run.stride;
    this.footsteps(f.state === 'run');

    // Sample the target.
    const sel = this.select(fr);
    const T = this.target;
    if (sel.clip) sel.clip.sample(sel.t, T);
    else if (sel.key === 'walk') gaitPose(a.walk, this.walkPhase, T);
    else if (sel.key === 'walkBack') gaitPose(a.walkBack, this.walkPhase, T);
    else if (sel.key === 'run') gaitPose(a.run, this.runPhase, T);
    else if (sel.key === 'guard') copyPose(T, a.guard);
    else if (sel.key === 'crouch') copyPose(T, a.crouch);
    else if (sel.key === 'crouchGuard') copyPose(T, a.crouchGuard);
    else copyPose(T, a.stance);

    // Transition: inertialize from the previous pose and velocity into the new target.
    if (sel.key !== this.key) {
      if (this.key !== '' && sel.blend > 0) this.startInertial(T, sel.blend * 1.6 + 1);
      else this.ibActive = false;
      this.key = sel.key;
      this.ibElapsed = 0;
      this.ibSnap = SNAP_ON_FREEZE.has(f.state);
    }
    this.ibElapsed += frozen ? (this.ibSnap ? real : 0) : frames;
    const B = this.blended;
    if (this.ibActive) {
      let any = false;
      const te = this.ibElapsed;
      for (let k = 0; k < N; k += 1) {
        const key = POSE_KEYS[k];
        const t1 = this.ibT1[k];
        if (t1 <= 0 || te >= t1) {
          B[key] = T[key];
          continue;
        }
        any = true;
        const t = te;
        const t2 = t * t;
        const off = this.ibA[k] * t2 * t2 * t + this.ibB[k] * t2 * t2 + this.ibC[k] * t2 * t + this.ibA0[k] * 0.5 * t2 + this.ibV0[k] * t + this.ibX0[k];
        B[key] = T[key] + off;
      }
      if (!any) this.ibActive = false;
    } else {
      copyPose(B, T);
    }

    // Velocity of the authored motion (per frame) for the next transition.
    if (frames > 0) {
      for (let k = 0; k < N; k += 1) {
        const key = POSE_KEYS[k];
        let d = B[key] - this.lastBlended[key];
        if (IS_ANGLE[k]) d = wrap180(d);
        this.vel[k] = d / frames;
      }
      copyPose(this.lastBlended, B);
    }

    copyPose(this.pose, B);

    // Turnaround when sides switch while grounded and free (or while being held in a throw).
    if (f.facing !== this.lastFacing) {
      const free = f.state === 'idle' || f.state === 'walk' || f.state === 'crouch' || f.state === 'land' || f.state === 'runStop' || f.state === 'thrown';
      if (free && !fr.reducedMotion) this.turnLeft = a.turnFrames;
      this.lastFacing = f.facing;
      for (const foot of this.feet) foot.locked = false;
    }
    if (this.turnLeft > 0) {
      const k = this.turnLeft / a.turnFrames;
      const e = smooth(k);
      this.pose.spinY += 180 * e;
      this.pose.pitch += 30 * Math.sin(Math.PI * e);
      if (!frozen) this.turnLeft = Math.max(0, this.turnLeft - frames);
    }

    this.plantFeet(renderX, frames);

    // Springs: frozen with the body during hitstop, then whip loose.
    const vx = (f.vx * f.facing + f.slide * f.facing) * 60;
    this.sec.update(frozen ? 0 : fr.dt * fr.timeScale, vx + dx * 60, f.vy * 60, !fr.reducedMotion);
    this.sec.apply(this.pose);
    if (!frozen && frames > 0) {
      this.sec.spin(Math.abs(this.pose.spinY - this.lastSpinY) / frames, fr.dt * fr.timeScale);
    }
    this.lastSpinY = this.pose.spinY;

    this.updateExpression(fr, frames, real);

    // Limited animation: hold the shown pose between steps; a new clip shows immediately.
    const step = this.limited && !fr.reducedMotion ? (HOLD_FRAMES[f.state] ?? 2) : 1;
    if (!frozen) this.holdAcc += frames;
    const newClip = sel.key !== this.shownKey;
    if (newClip || this.holdAcc >= step || step <= 1 || this.showClip) {
      copyPose(this.shown, this.pose);
      this.shownKey = sel.key;
      this.holdAcc = newClip ? 0 : step > 1 ? this.holdAcc % step : 0;
    }
    return this.shown;
  }

  /** Face: blink rhythm, focus/anger while fighting, shout on big swings, pain when hit. */
  private updateExpression(fr: AnimFrame, frames: number, real: number): void {
    const f = this.f;
    const t = this.exprTarget;
    t.blink = 0;
    t.angry = 0;
    t.shout = 0;
    t.pain = 0;
    t.smile = 0;
    t.focus = 0;
    const id = f.move?.id;
    switch (f.state) {
      case 'attack': {
        const big = id === 'heavy' || id === 'special' || id === 'super' || id === 'sweep' || id === 'airHeavy';
        const active = f.move ? f.stateFrame >= f.move.startup - 2 && f.stateFrame <= f.move.activeTo + 4 : false;
        t.angry = 0.85;
        t.shout = big && active ? 1 : id === 'light' && active ? 0.35 : 0;
        if (id === 'parry') {
          t.angry = 0;
          t.focus = 1;
        }
        break;
      }
      case 'throwing':
        t.angry = 1;
        t.shout = 0.6;
        break;
      case 'hit':
      case 'airHit':
      case 'parried':
      case 'thrown':
        t.pain = 1;
        t.shout = f.state === 'airHit' ? 0.4 : 0.2;
        break;
      case 'knockdown':
      case 'getup':
        t.pain = 0.6;
        break;
      case 'ko':
        t.blink = 1;
        t.pain = 0.4;
        break;
      case 'block':
      case 'clash':
        t.focus = 1;
        t.angry = 0.4;
        break;
      case 'parrySuccess':
        t.focus = 0.6;
        t.smile = 0.35;
        break;
      case 'victory':
        t.smile = 1;
        break;
      case 'run':
      case 'air':
        t.focus = 0.7;
        break;
      default:
        t.focus = f.guarding ? 0.8 : 0.35;
    }
    // Blink: every 2.6–4.6 s (deterministic per fighter), 7 frames, not while shouting/in pain.
    if (!fr.match.frozen) this.blinkClock += real;
    const period = 156 + ((f.id * 53 + Math.floor(this.blinkClock / 300) * 37) % 120);
    const ph = this.blinkClock % period;
    if (ph < 7 && t.shout < 0.5 && t.pain < 0.5 && t.blink < 1) t.blink = Math.sin((Math.PI * ph) / 7);
    // Ease toward the targets (fast attack on, slower release).
    const e = this.expression;
    const k = (to: number, from: number) => (to > from ? 0.45 : 0.18);
    for (const key of ['angry', 'shout', 'pain', 'smile', 'focus'] as const) {
      const a = Math.min(1, k(t[key], e[key]) * Math.max(1, frames));
      e[key] += (t[key] - e[key]) * a;
    }
    e.blink = t.blink;
    void frames;
  }

  /**
   * Inertialization (Bollo, GDC 2018): the offset between the old pose and the new target, with the
   * old motion's velocity, decays to zero along a quintic that ends with zero velocity/acceleration.
   */
  private startInertial(T: Pose, frames: number): void {
    let any = false;
    for (let k = 0; k < N; k += 1) {
      const key = POSE_KEYS[k];
      let x0 = this.blended[key] - T[key];
      if (IS_ANGLE[k]) x0 = wrap180(x0);
      if (Math.abs(x0) < 1e-5) {
        this.ibT1[k] = 0;
        continue;
      }
      let v0 = this.vel[k];
      // Velocity heading away from the target is dropped (it would overshoot).
      if (x0 * v0 > 0) v0 = 0;
      let t1 = frames;
      if (v0 !== 0) t1 = Math.min(t1, (-5 * x0) / v0);
      t1 = Math.max(1, t1);
      const t1s = t1 * t1;
      const a0 = (-8 * v0 * t1 - 20 * x0) / t1s;
      this.ibX0[k] = x0;
      this.ibV0[k] = v0;
      this.ibA0[k] = a0;
      this.ibA[k] = -(a0 * t1s + 6 * v0 * t1 + 12 * x0) / (2 * t1s * t1s * t1);
      this.ibB[k] = (3 * a0 * t1s + 16 * v0 * t1 + 30 * x0) / (2 * t1s * t1s);
      this.ibC[k] = -(3 * a0 * t1s + 12 * v0 * t1 + 20 * x0) / (2 * t1s * t1);
      this.ibT1[k] = t1;
      any = true;
    }
    this.ibActive = any;
  }

  /**
   * Foot planting: while a foot is down it stays where it was put in the world. When the body
   * travels or the pose moves a grounded foot past a threshold, the foot takes a quick lifted step
   * to its new spot (landing slightly ahead of continuing travel). Authored lifts (kicks, hops) are
   * followed directly; releasing a lock eases the foot back onto the authored path.
   */
  private plantFeet(renderX: number, frames: number): void {
    const f = this.f;
    const p = this.pose;
    const k = this.footScale * f.facing;
    const rootVel = frames > 0 ? (renderX - this.lastRenderX) / frames : 0;
    if (frames > 0) this.lastRenderX = renderX;
    const eligible =
      PLANTED.has(f.state) &&
      f.y <= 0.001 &&
      !(f.state === 'attack' && f.move?.airborne) &&
      Math.abs(wrap180(p.spin)) < 10 &&
      Math.abs(p.tilt) < 10 &&
      p.hipY > 0.4;
    // Only one foot starts a step at a time (feet alternate); a big error lets both go.
    let stepping = this.feet[0].stepT >= 0 || this.feet[1].stepT >= 0;
    const order = Math.abs(this.feet[0].out - p.fx) >= Math.abs(this.feet[1].out - p.bx) ? [0, 1] : [1, 0];
    for (const i of order) {
      const foot = this.feet[i];
      const desired = i === 0 ? p.fx : p.bx;
      const lift = i === 0 ? p.fy : p.by;
      let outX = desired;
      let addLift = 0;
      if (!eligible || lift > 0.025 || Math.abs(k) < 1e-6) {
        if (foot.locked) foot.release = foot.out - desired;
        foot.locked = false;
        foot.stepT = -1;
        if (frames > 0) foot.release *= Math.exp(-frames / 2.2);
        outX = desired + foot.release;
      } else {
        const desiredW = renderX + k * desired;
        if (!foot.locked) {
          foot.locked = true;
          foot.w = renderX + k * (desired + foot.release);
          foot.release = 0;
        }
        if (foot.stepT >= 0) {
          foot.stepT += frames / foot.dur;
          foot.to = desiredW + rootVel * Math.max(0, (1 - foot.stepT) * foot.dur) * 1.4;
          if (foot.stepT >= 1) {
            foot.w = desiredW;
            foot.stepT = -1;
          } else {
            const u = smooth(foot.stepT);
            foot.w = foot.from + (foot.to - foot.from) * u;
            addLift = Math.sin(Math.PI * foot.stepT) * foot.lift;
          }
        } else {
          const err = desiredW - foot.w;
          const big = Math.abs(err) > 0.32 * Math.abs(k);
          if (Math.abs(err) > 0.075 * Math.abs(k) && (!stepping || big)) {
            const dist = Math.min(Math.abs(err) + Math.abs(rootVel) * 6, 0.5);
            foot.stepT = 0;
            foot.from = foot.w;
            foot.to = desiredW;
            foot.dur = Math.max(3, Math.min(7, 3 + dist * 9));
            foot.lift = Math.max(0.03, Math.min(0.1, dist * 0.32));
            stepping = true;
          }
        }
        outX = (foot.w - renderX) / k;
      }
      foot.out = outX;
      if (i === 0) {
        p.fx = outX;
        p.fy += addLift;
        p.fPitch += addLift * 160;
      } else {
        p.bx = outX;
        p.by += addLift;
        p.bPitch += addLift * 160;
      }
    }
  }

  private footsteps(running: boolean): void {
    const phase = running ? this.runPhase : this.walkPhase;
    const steps = Math.floor(phase * 2);
    if (steps !== this.lastStepPhase) {
      this.lastStepPhase = steps;
      if (this.f.state === 'run' || this.f.state === 'walk') this.onFootstep?.(running);
    }
  }
}
