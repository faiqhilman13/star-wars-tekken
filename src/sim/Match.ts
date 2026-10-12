import {
  CLASH_FRAMES,
  CLASH_HITSTOP,
  FIGHT_CALL_FRAME,
  GRAVITY,
  GRIP_RELEASE,
  GRIP_SEQUENCE,
  INPUT_BUFFER,
  INTRO_FRAMES,
  JUMP_SQUAT,
  LANDING_FRAMES,
  MAX_ROUNDS,
  MAX_SEPARATION,
  METER_BAR,
  METER_MAX,
  PARRY_CANCEL_FROM,
  PARRY_HITSTOP,
  PARRY_METER,
  PARRY_SUCCESS_FRAMES,
  PUSH_HALF_AIR,
  PUSH_HALF_GROUND,
  PUSH_HEIGHT,
  ROUND_OVER_FRAMES,
  ROUND_SECONDS,
  ROUNDS_TO_WIN,
  RUN_JUMP_VX,
  RUN_MIN_FRAMES,
  RUN_STOP_FRAMES,
  SIM_HZ,
  START_X,
  SUPER_FREEZE,
  THROW_RELEASE,
  THROW_SEQUENCE,
  THROW_TECH_WINDOW,
  WALL_X,
} from './constants';
import { Fighter, makeWorldBox, overlapCenter, overlaps } from './Fighter';
import type { HitSpec, MoveDef, ProjectileSpec } from './moves';
import {
  emptyInput,
  type CharacterId,
  type FighterId,
  type FighterState,
  type GuardHeight,
  type InputFrame,
  type LaunchKind,
  type MatchPhase,
  type MoveId,
  type ProjectileKind,
  type SimEvent,
  type WorldBox,
} from './types';

export interface Projectile {
  owner: FighterId;
  kind: ProjectileKind;
  spec: ProjectileSpec;
  x: number;
  y: number;
  dir: 1 | -1;
  age: number;
  alive: boolean;
  traveled: number;
  returning: boolean;
  hitThisLeg: boolean;
}

interface LiveHit {
  index: number;
  spec: HitSpec;
  box: WorldBox;
}

type HitResult = 'hit' | 'blocked' | 'parried';

const NO_INPUT: InputFrame = emptyInput();
/** Side-switch throw spacing: victim held this far in front, thrower lands this far behind them. */
const VAULT_HOLD = 0.86;
const VAULT_LAND = 1.05;

export class Match {
  readonly fighters: [Fighter, Fighter];
  projectiles: Projectile[] = [];
  /** Events accumulate until the caller drains them (several steps can run per rendered frame). */
  readonly events: SimEvent[] = [];
  phase: MatchPhase = 'intro';
  phaseFrame = 0;
  round = 1;
  timerFrames = ROUND_SECONDS * SIM_HZ;
  frame = 0;
  hitstop = 0;
  superFreeze = 0;
  superOwner: FighterId | -1 = -1;
  roundWinner: FighterId | -1 | null = null;
  roundReason: 'ko' | 'time' | 'double' | null = null;
  matchWinner: FighterId | -1 | null = null;
  perfect = false;

  private readonly prevX = [0, 0];
  private readonly gripDist = [1.6, 1.6];
  private readonly throwVictimX = [0, 0];
  private readonly throwOriginX = [0, 0];
  private readonly hitBoxes = [makeWorldBox(), makeWorldBox()];
  private readonly hurt = [makeWorldBox(), makeWorldBox()];
  private readonly projBox = makeWorldBox();
  private readonly projBox2 = makeWorldBox();
  private readonly grabBox = makeWorldBox();

  constructor(characters: [CharacterId, CharacterId] = ['kael', 'vexa']) {
    this.fighters = [new Fighter(0, characters[0]), new Fighter(1, characters[1])];
    this.resetMatch();
  }

  setCharacters(characters: [CharacterId, CharacterId]): void {
    this.fighters[0].setCharacter(characters[0]);
    this.fighters[1].setCharacter(characters[1]);
    this.resetMatch();
  }

  resetMatch(): void {
    this.round = 1;
    this.matchWinner = null;
    for (const f of this.fighters) f.resetForMatch();
    this.startRound();
  }

  startRound(): void {
    this.fighters[0].resetForRound(-START_X, 1);
    this.fighters[1].resetForRound(START_X, -1);
    this.projectiles = [];
    this.phase = 'intro';
    this.phaseFrame = 0;
    this.timerFrames = ROUND_SECONDS * SIM_HZ;
    this.hitstop = 0;
    this.superFreeze = 0;
    this.superOwner = -1;
    this.roundWinner = null;
    this.roundReason = null;
    this.perfect = false;
    const [a, b] = this.fighters;
    const finalRound = this.round >= MAX_ROUNDS || (a.roundsWon === ROUNDS_TO_WIN - 1 && b.roundsWon === ROUNDS_TO_WIN - 1);
    this.events.push({ type: 'roundIntro', round: this.round, finalRound });
  }

  /** Skip the intro and put both fighters in neutral (test hooks / quick restart). */
  skipIntro(): void {
    if (this.phase !== 'intro') return;
    this.phase = 'fight';
    this.phaseFrame = 0;
    for (const f of this.fighters) this.setState(f, 'idle');
  }

  get secondsLeft(): number {
    return Math.ceil(this.timerFrames / SIM_HZ);
  }

  get frozen(): boolean {
    return this.superFreeze > 0 || this.hitstop > 0;
  }

  opponent(f: Fighter): Fighter {
    return this.fighters[f.id === 0 ? 1 : 0];
  }

  /** Distance a Force Grip victim is held at (render needs it too). */
  gripDistance(f: Fighter): number {
    return this.gripDist[f.id];
  }

  step(input0: InputFrame, input1: InputFrame): void {
    this.frame += 1;
    const live = this.phase === 'fight';
    const [a, b] = this.fighters;
    a.feedInput(live ? input0 : NO_INPUT);
    b.feedInput(live ? input1 : NO_INPUT);

    for (const f of this.fighters) {
      if (f.flash > 0) f.flash -= 1;
      if (f.blockFlash > 0) f.blockFlash -= 1;
      if (f.counterFlash > 0) f.counterFlash -= 1;
      if (f.parryFlash > 0) f.parryFlash -= 1;
    }

    this.updatePhase();
    if (this.phase === 'intro') return;

    if (this.superFreeze > 0) {
      this.superFreeze -= 1;
      return;
    }
    if (this.hitstop > 0) {
      this.hitstop -= 1;
      return;
    }

    this.prevX[0] = a.x;
    this.prevX[1] = b.x;
    a.clock += 1;
    b.clock += 1;
    this.updateFighter(a, b);
    this.updateFighter(b, a);
    for (const f of this.fighters) {
      if (f.dashRequest !== 0 && f.clock - f.dashTime > INPUT_BUFFER) f.dashRequest = 0;
    }
    this.applyMotion();
    this.updateProjectiles();
    if (this.phase === 'fight') {
      this.resolveCombat();
      this.updateTimerAndKo();
    }
  }

  // ---------------------------------------------------------------- phases

  private updatePhase(): void {
    this.phaseFrame += 1;
    if (this.phase === 'intro') {
      if (this.phaseFrame === FIGHT_CALL_FRAME) this.events.push({ type: 'fight' });
      if (this.phaseFrame >= INTRO_FRAMES) {
        this.phase = 'fight';
        this.phaseFrame = 0;
        for (const f of this.fighters) this.setState(f, 'idle');
      }
      return;
    }
    if (this.phase === 'roundOver') {
      for (const f of this.fighters) {
        if (this.phaseFrame > 50 && f.actionable && (this.roundWinner === f.id || this.roundWinner === -1) && f.health > 0) {
          this.setState(f, 'victory');
        }
      }
      if (this.phaseFrame >= ROUND_OVER_FRAMES) this.finishRound();
    }
  }

  private finishRound(): void {
    const [a, b] = this.fighters;
    if (a.roundsWon >= ROUNDS_TO_WIN || b.roundsWon >= ROUNDS_TO_WIN || this.round >= MAX_ROUNDS) {
      this.phase = 'matchOver';
      this.phaseFrame = 0;
      this.matchWinner = a.roundsWon > b.roundsWon ? 0 : b.roundsWon > a.roundsWon ? 1 : -1;
      this.events.push({ type: 'matchEnd', winner: this.matchWinner });
      return;
    }
    this.round += 1;
    this.startRound();
  }

  private updateTimerAndKo(): void {
    const [a, b] = this.fighters;
    const deadA = a.health <= 0;
    const deadB = b.health <= 0;
    if (deadA || deadB) {
      const winner: FighterId | -1 = deadA && deadB ? -1 : deadA ? 1 : 0;
      this.endRound(winner, deadA && deadB ? 'double' : 'ko');
      return;
    }
    this.timerFrames -= 1;
    if (this.timerFrames > 0 && this.timerFrames % SIM_HZ === 0) {
      const seconds = this.timerFrames / SIM_HZ;
      if (seconds <= 10) this.events.push({ type: 'timeWarning', seconds });
    }
    if (this.timerFrames <= 0) {
      this.timerFrames = 0;
      const ra = a.health / a.maxHealth;
      const rb = b.health / b.maxHealth;
      const winner: FighterId | -1 = ra > rb ? 0 : rb > ra ? 1 : -1;
      this.endRound(winner, 'time');
    }
  }

  private endRound(winner: FighterId | -1, reason: 'ko' | 'time' | 'double'): void {
    this.phase = 'roundOver';
    this.phaseFrame = 0;
    this.roundWinner = winner;
    this.roundReason = reason;
    if (winner !== -1) {
      const champ = this.fighters[winner];
      this.perfect = champ.health === champ.maxHealth;
      champ.roundsWon += 1;
    } else {
      this.fighters[0].roundsWon += 1;
      this.fighters[1].roundsWon += 1;
    }
    for (const f of this.fighters) {
      if (f.health <= 0 && f.state !== 'airHit' && f.state !== 'ko') {
        const o = this.opponent(f);
        this.launch(f, o.x <= f.x ? 1 : -1, 0.05, 0.1, 'ko');
      }
    }
    for (const p of this.projectiles) p.alive = false;
    this.cleanProjectiles();
    for (const f of this.fighters) f.clearBuffer();
    if (reason !== 'time') this.events.push({ type: 'ko', loser: winner === -1 ? -1 : winner === 0 ? 1 : 0 });
    this.events.push({ type: 'roundEnd', winner, reason, perfect: this.perfect });
  }

  // ---------------------------------------------------------- state machine

  private setState(f: Fighter, state: FighterState): void {
    f.state = state;
    f.stateFrame = 0;
    if (state !== 'attack') f.move = null;
    if (state !== 'crouch' && state !== 'block' && state !== 'hit' && state !== 'attack') f.crouching = false;
    f.guarding = false;
  }

  private toNeutral(f: Fighter, o: Fighter): void {
    if (f.y > 0) {
      // Still airborne (mid-air clash, takeoff-frame hit): fall instead of standing in the air.
      this.setState(f, 'air');
      f.airAttackUsed = true;
      f.jumpDir = 0;
      f.stun = 0;
      f.chain = 0;
      return;
    }
    this.setState(f, 'idle');
    f.stun = 0;
    f.chain = 0;
    f.comboCount = 0;
    f.comboDamage = 0;
    f.walkDir = 0;
    this.faceOpponent(f, o);
    if (this.phase === 'fight') this.neutral(f, o);
  }

  private faceOpponent(f: Fighter, o: Fighter): void {
    if (o.x > f.x + 0.001) f.facing = 1;
    else if (o.x < f.x - 0.001) f.facing = -1;
  }

  private updateFighter(f: Fighter, o: Fighter): void {
    f.stateFrame += 1;
    if (f.noMeterCooldown > 0) f.noMeterCooldown -= 1;

    switch (f.state) {
      case 'intro':
      case 'victory':
        break;
      case 'idle':
      case 'walk':
      case 'crouch':
        if (this.phase === 'fight') this.neutral(f, o);
        else {
          if (f.state !== 'idle') this.setState(f, 'idle');
          f.walkDir = 0;
        }
        break;
      case 'run':
        this.running(f, o);
        break;
      case 'runStop':
        if (this.phase === 'fight' && f.stateFrame > 2 && this.tryActions(f, null)) break;
        if (f.stateFrame >= RUN_STOP_FRAMES) this.toNeutral(f, o);
        break;
      case 'jumpSquat':
        if (f.stateFrame >= JUMP_SQUAT) this.takeoff(f);
        break;
      case 'air':
        this.airborne(f);
        break;
      case 'land':
        if (f.stateFrame >= f.landLag) this.toNeutral(f, o);
        break;
      case 'backdash':
        this.backdash(f, o);
        break;
      case 'attack':
        this.attack(f, o);
        break;
      case 'block':
        f.crouching = f.input.down;
        f.stun -= 1;
        if (f.stun <= 0) this.toNeutral(f, o);
        break;
      case 'hit':
      case 'parried':
        f.stun -= 1;
        if (f.stun <= 0) this.toNeutral(f, o);
        break;
      case 'parrySuccess':
        if (f.stateFrame >= PARRY_CANCEL_FROM && this.phase === 'fight' && this.tryActions(f, null)) break;
        if (f.stateFrame >= PARRY_SUCCESS_FRAMES) this.toNeutral(f, o);
        break;
      case 'airHit':
        this.airHit(f);
        break;
      case 'knockdown':
        if (f.stateFrame >= f.def.knockdownFrames) this.setState(f, 'getup');
        break;
      case 'getup':
        if (f.stateFrame >= f.def.getupFrames) this.toNeutral(f, o);
        break;
      case 'throwing':
        if (f.throwKind === 'grip') this.gripping(f, o);
        else this.throwing(f, o);
        break;
      case 'thrown':
        this.thrown(f, o);
        break;
      case 'clash':
        if (f.stateFrame >= CLASH_FRAMES) this.toNeutral(f, o);
        break;
      case 'ko':
        break;
    }
  }

  private neutral(f: Fighter, o: Fighter): void {
    this.faceOpponent(f, o);
    const input = f.input;
    f.guarding = f.backHeld && this.threatened(f, o);

    if (this.tryActions(f, null)) return;

    if (input.up) {
      const dir: -1 | 0 | 1 = f.forwardHeld ? 1 : f.backHeld ? -1 : 0;
      this.setState(f, 'jumpSquat');
      f.jumpDir = dir;
      f.runJump = false;
      return;
    }

    if (f.dashRequest !== 0) {
      const forward = f.dashRequest === f.facing;
      f.dashRequest = 0;
      if (forward) {
        this.setState(f, 'run');
        this.events.push({ type: 'run', fighter: f.id });
      } else {
        this.setState(f, 'backdash');
        this.events.push({ type: 'dash', fighter: f.id, back: true });
      }
      return;
    }

    if (input.down) {
      if (f.state !== 'crouch') this.setState(f, 'crouch');
      f.crouching = true;
      f.guarding = f.backHeld && this.threatened(f, o);
      f.walkDir = 0;
      return;
    }

    if (f.forwardHeld) {
      if (f.state !== 'walk' || f.walkDir !== 1) this.setState(f, 'walk');
      f.walkDir = 1;
      f.x += f.def.walkForward * f.facing;
      return;
    }
    if (f.backHeld) {
      if (f.guarding) {
        if (f.state !== 'idle') this.setState(f, 'idle');
        f.guarding = true;
        f.walkDir = 0;
        return;
      }
      if (f.state !== 'walk' || f.walkDir !== -1) this.setState(f, 'walk');
      f.walkDir = -1;
      f.x -= f.def.walkBack * f.facing;
      return;
    }
    if (f.state !== 'idle') this.setState(f, 'idle');
    f.walkDir = 0;
  }

  private running(f: Fighter, o: Fighter): void {
    if (this.phase !== 'fight') {
      this.setState(f, 'runStop');
      return;
    }
    if (this.tryActions(f, null)) {
      // Carry some of the sprint into the attack.
      f.slide = f.facing * f.def.runSpeed * 0.55;
      return;
    }
    if (f.input.up) {
      this.setState(f, 'jumpSquat');
      f.jumpDir = 1;
      f.runJump = true;
      return;
    }
    if (f.input.down) {
      this.setState(f, 'crouch');
      f.crouching = true;
      f.slide = f.facing * f.def.runSpeed * 0.4;
      return;
    }
    const keepRunning = f.forwardHeld || f.stateFrame < RUN_MIN_FRAMES;
    if (!keepRunning || f.backHeld) {
      this.setState(f, 'runStop');
      f.slide = f.facing * f.def.runSpeed * 0.75;
      this.events.push({ type: 'skid', fighter: f.id });
      return;
    }
    const accel = Math.min(1, 0.45 + f.stateFrame / 8);
    f.x += f.facing * f.def.runSpeed * accel;
    // Running past the opponent (they jumped over) ends the run so we turn around.
    if ((o.x - f.x) * f.facing < -0.2) this.setState(f, 'runStop');
  }

  /** True when the opponent has an attack coming or a projectile is closing in — holding back shows a guard. */
  private threatened(f: Fighter, o: Fighter): boolean {
    const dx = Math.abs(o.x - f.x);
    if (o.state === 'attack' && o.move && o.stateFrame <= o.move.activeTo + 2 && o.move.id !== 'throw' && o.move.id !== 'parry' && dx < 4.2) return true;
    if (o.state === 'air' && dx < 2.6) return true;
    for (const p of this.projectiles) {
      if (!p.alive || p.owner !== o.id) continue;
      const toward = (f.x - p.x) * (p.returning ? Math.sign(o.x - p.x) || 1 : p.dir);
      if (toward > -0.3 && toward < 4.5) return true;
    }
    return false;
  }

  private specialReady(f: Fighter): boolean {
    const kind = f.def.special;
    if (kind === 'wave' || kind === 'staff') return !f.projectileActive;
    return true;
  }

  private tryActions(f: Fighter, cancelFrom: MoveDef | null): boolean {
    if (this.phase !== 'fight') return false;
    const lightP = f.pressed('light');
    const heavyP = f.pressed('heavy');
    const forceP = f.pressed('force');
    const parryP = f.pressed('parry');
    if (!lightP && !heavyP && !forceP && !parryP) return false;
    const down = f.input.down;
    const allowed = (id: MoveId): boolean => !cancelFrom || Boolean(cancelFrom.cancels?.includes(id));

    if (parryP && !cancelFrom) {
      f.consume('parry');
      this.startMove(f, 'parry', false);
      return true;
    }

    if (!cancelFrom && lightP && heavyP && Math.abs(f.pressAge('light') - f.pressAge('heavy')) <= 3) {
      f.consume('light');
      f.consume('heavy');
      this.startMove(f, 'throw', false);
      return true;
    }

    if (forceP) {
      if (down && f.meter >= METER_MAX && allowed('super')) {
        f.consume('force');
        this.startMove(f, 'super', Boolean(cancelFrom));
        return true;
      }
      if (f.meter >= METER_BAR && this.specialReady(f) && allowed('special')) {
        f.consume('force');
        this.startMove(f, 'special', Boolean(cancelFrom));
        return true;
      }
      if (!cancelFrom) {
        f.consume('force');
        if (f.noMeterCooldown === 0 && f.meter < METER_BAR) this.events.push({ type: 'noMeter', fighter: f.id });
        f.noMeterCooldown = 30;
      }
    }

    if (heavyP) {
      const id: MoveId = down ? 'sweep' : 'heavy';
      if (allowed(id)) {
        f.consume('heavy');
        this.startMove(f, id, Boolean(cancelFrom));
        return true;
      }
    }
    if (lightP) {
      const id: MoveId = down ? 'crLight' : 'light';
      if (allowed(id) && (!cancelFrom || f.chain < 2)) {
        f.consume('light');
        this.startMove(f, id, Boolean(cancelFrom));
        return true;
      }
    }
    return false;
  }

  private startMove(f: Fighter, id: MoveId, isCancel: boolean): void {
    const move = f.def.moves[id];
    if (move.meterCost) f.meter = Math.max(0, f.meter - move.meterCost);
    const keepAir = move.airborne;
    f.state = 'attack';
    f.stateFrame = 0;
    f.move = move;
    f.hitsDone = move.hits.map(() => false);
    f.connected = false;
    f.crouching = Boolean(move.crouching);
    f.guarding = false;
    f.walkDir = 0;
    f.chain = isCancel ? f.chain + 1 : 0;
    if (!keepAir) {
      f.vx = 0;
      f.vy = 0;
    }
    if (id === 'super') {
      this.superFreeze = SUPER_FREEZE;
      this.superOwner = f.id;
      f.stats.supers += 1;
      this.events.push({ type: 'superFlash', fighter: f.id });
    }
    if (id === 'special') f.stats.specials += 1;
  }

  private takeoff(f: Fighter): void {
    this.setState(f, 'air');
    f.vy = f.def.jumpVy;
    if (f.runJump) f.vx = RUN_JUMP_VX * f.facing;
    else f.vx = f.jumpDir === 0 ? 0 : f.jumpDir > 0 ? f.def.jumpVxForward * f.facing : -f.def.jumpVxBack * f.facing;
    f.y = 0.001;
    f.airAttackUsed = false;
    this.events.push({ type: 'jump', fighter: f.id, flip: f.jumpDir !== 0 });
  }

  private airborne(f: Fighter): void {
    if (this.airPhysics(f)) {
      this.land(f, LANDING_FRAMES);
      return;
    }
    if (this.phase === 'fight' && !f.airAttackUsed && (f.pressed('light') || f.pressed('heavy'))) {
      const heavy = f.pressed('heavy') && (!f.pressed('light') || f.pressAge('heavy') <= f.pressAge('light'));
      f.consume('light');
      f.consume('heavy');
      f.airAttackUsed = true;
      this.startMove(f, heavy ? 'airHeavy' : 'airLight', false);
    }
  }

  /** Integrates a jump arc; returns true on touchdown. */
  private airPhysics(f: Fighter): boolean {
    f.vy -= GRAVITY;
    f.y += f.vy;
    f.x += f.vx;
    if (f.y <= 0 && f.vy < 0) {
      f.y = 0;
      f.vy = 0;
      f.vx = 0;
      return true;
    }
    return false;
  }

  private land(f: Fighter, lag: number): void {
    this.setState(f, 'land');
    f.landLag = lag;
    f.runJump = false;
    this.faceOpponent(f, this.opponent(f));
    this.events.push({ type: 'land', fighter: f.id });
  }

  private backdash(f: Fighter, o: Fighter): void {
    const total = f.def.backdashFrames;
    const t = f.stateFrame;
    const step = f.def.backdashDistance * Math.sin((Math.PI * (t - 0.5)) / total) * (Math.PI / (2 * total));
    f.x -= f.facing * step;
    if (t >= total) this.toNeutral(f, o);
  }

  private attack(f: Fighter, o: Fighter): void {
    const move = f.move;
    if (!move) {
      this.toNeutral(f, o);
      return;
    }
    const t = f.stateFrame;

    if (move.holdWhileProjectile === t && f.projectileActive) {
      f.stateFrame -= 1;
      return;
    }

    if (move.travel) {
      for (const seg of move.travel) {
        if (t >= seg.from && t <= seg.to) f.x += seg.dx * f.facing;
      }
    }
    if (move.arc) {
      const { from, to, height } = move.arc;
      if (t === from) this.events.push({ type: 'leap', fighter: f.id });
      if (t >= from && t <= to) f.y = Math.max(0, height * Math.sin((Math.PI * (t - from)) / (to - from)));
      if (t === to) {
        f.y = 0;
        this.events.push({ type: 'land', fighter: f.id });
      }
    }
    if (t === move.activeFrom && move.swing > 0) {
      this.events.push({ type: 'swing', fighter: f.id, move: move.id, strength: move.swing });
    }
    if (move.id === 'special' && t === 1) this.events.push({ type: 'specialStart', fighter: f.id });
    if (move.projectile && move.projectile.frame === t) this.spawnProjectile(f, move.projectile.kind);

    if (move.airborne) {
      if (this.airPhysics(f)) this.land(f, LANDING_FRAMES + (f.connected ? 0 : 3));
      return;
    }

    if (f.connected && move.cancels && move.cancelWindow && t >= move.cancelWindow[0] && t <= move.cancelWindow[1]) {
      if (this.tryActions(f, move)) return;
    }

    // Light + heavy pressed a frame apart still reads as a throw (never from a chain).
    if ((move.id === 'light' || move.id === 'crLight') && f.chain === 0 && t <= 2 && f.pressed('heavy', 3)) {
      f.consume('heavy');
      this.startMove(f, 'throw', false);
      return;
    }

    if (t >= move.total) this.toNeutral(f, o);
  }

  private airHit(f: Fighter): void {
    f.vy -= GRAVITY;
    f.y += f.vy;
    f.x += f.vx;
    if (f.y <= 0 && f.vy < 0 && f.stateFrame > 2) {
      f.y = 0;
      if (!f.bounced && f.vy < -0.075) {
        // Body slams the deck and bounces once.
        f.bounced = true;
        f.vy = -f.vy * 0.36;
        f.vx *= 0.55;
        f.y = 0.001;
        this.events.push({ type: 'bounce', fighter: f.id, x: f.x });
        return;
      }
      f.slide = f.vx * 0.9;
      f.vx = 0;
      f.vy = 0;
      if (f.health <= 0) this.setState(f, 'ko');
      else this.setState(f, 'knockdown');
      this.events.push({ type: 'knockdown', fighter: f.id, x: f.x });
    }
  }

  private launch(f: Fighter, away: number, vx: number, vy: number, kind: LaunchKind): void {
    this.setState(f, 'airHit');
    f.vx = away * vx;
    f.vy = vy;
    f.y = Math.max(f.y, 0.001);
    f.crouching = false;
    f.bounced = false;
    f.launchKind = f.health <= 0 ? 'ko' : kind;
  }

  private throwing(f: Fighter, o: Fighter): void {
    const t = f.stateFrame;
    const vault = f.def.throwVault;
    const release = vault?.release ?? THROW_RELEASE;
    const total = vault?.total ?? THROW_SEQUENCE;
    if (vault) {
      // Victim held in place (shifted off the wall if there is no room to land behind them).
      if (t <= 1) {
        const room = WALL_X - 0.05;
        const landX = Math.max(-room, Math.min(room, f.x + f.facing * (VAULT_HOLD + VAULT_LAND)));
        this.throwVictimX[f.id] = landX - f.facing * VAULT_LAND;
        this.throwOriginX[f.id] = f.x;
      }
      if (t < release && o.state === 'thrown') {
        const vx = this.throwVictimX[f.id];
        o.x += (vx - o.x) * Math.min(1, t / Math.max(1, vault.from - 1));
        o.y = 0;
      }
      if (t >= vault.from && t <= vault.to) {
        const u = (t - vault.from) / Math.max(1, vault.to - vault.from);
        const landX = this.throwVictimX[f.id] + f.facing * VAULT_LAND;
        const from = this.throwOriginX[f.id];
        f.x = from + (landX - from) * (u * u * (3 - 2 * u));
        f.y = t === vault.to ? 0 : vault.height * Math.sin(Math.PI * u);
        if (t === vault.from) this.events.push({ type: 'leap', fighter: f.id });
        if (t === vault.to) {
          this.events.push({ type: 'land', fighter: f.id });
          // The victim turns to face her as she lands behind them.
          if (o.state === 'thrown') o.facing = f.facing;
        }
      }
    } else if (t < release && o.state === 'thrown') {
      o.x = f.x + f.facing * 0.72;
      o.y = 0;
    }
    if (t === release && o.state === 'thrown' && this.phase !== 'fight') {
      this.toNeutral(o, f);
    } else if (t === release && o.state === 'thrown') {
      const dmg = f.def.throwDamage;
      o.health = Math.max(0, o.health - dmg);
      f.stats.damageDealt += dmg;
      f.stats.hitsLanded += 1;
      f.stats.throws += 1;
      f.meter = Math.min(METER_MAX, f.meter + 15);
      o.meter = Math.min(METER_MAX, o.meter + 12);
      o.flash = 10;
      this.launch(o, vault ? -f.facing : f.facing, 0.11, 0.13, 'throw');
      this.hitstop = Math.max(this.hitstop, 10);
      const x = (f.x + o.x) / 2;
      this.events.push({ type: 'throw', fighter: f.id, x, y: 1.2 });
      this.events.push({ type: 'hit', attacker: f.id, x, y: 1.2, damage: dmg, strength: 0.85, blocked: false, source: 'throw', counter: false, combo: 1 });
    }
    if (t >= total) {
      f.y = 0;
      this.toNeutral(f, o);
    }
  }

  /** Force Grip: lift the victim by the throat, choke, then hurl them. */
  private gripping(f: Fighter, o: Fighter): void {
    const t = f.stateFrame;
    const grip = f.def.grip ?? { lift: 0.8, ticks: 10, tickDamage: 10, hurlDamage: 40 };
    if (o.state === 'thrown' && o.throwKind === 'grip') {
      const u = Math.min(1, t / 18);
      const lift = grip.lift * (1 - (1 - u) * (1 - u));
      o.x = f.x + f.facing * this.gripDist[f.id];
      o.y = Math.max(0.001, lift);
      if (t >= 14 && t <= 14 + (grip.ticks - 1) * 3 && (t - 14) % 3 === 0 && this.phase === 'fight') {
        const dmg = Math.min(grip.tickDamage, Math.max(0, o.health - 1));
        o.health -= dmg;
        f.stats.damageDealt += dmg;
        o.flash = 4;
        this.events.push({ type: 'gripTick', fighter: f.id, x: o.x, y: o.y + 1.5 });
      }
      if (t === GRIP_RELEASE) {
        if (this.phase === 'fight') {
          const dmg = grip.hurlDamage;
          o.health = Math.max(0, o.health - dmg);
          f.stats.damageDealt += dmg;
          f.stats.hitsLanded += 1;
          o.flash = 10;
          this.launch(o, f.facing, 0.15, 0.09, 'blowback');
          this.hitstop = Math.max(this.hitstop, 12);
          this.events.push({ type: 'hit', attacker: f.id, x: o.x, y: o.y + 1.2, damage: dmg, strength: 0.9, blocked: false, source: 'special', counter: false, combo: 1 });
        } else {
          this.launch(o, f.facing, 0.04, 0.05, 'blowback');
        }
      }
    }
    if (t >= GRIP_SEQUENCE) this.toNeutral(f, o);
  }

  private thrown(f: Fighter, o: Fighter): void {
    if (f.throwKind === 'throw' && f.techWindow > 0) {
      f.techWindow -= 1;
      if (f.pressed('light', 4) && f.pressed('heavy', 4)) {
        f.consume('light');
        f.consume('heavy');
        this.techThrow(o, f);
        return;
      }
    }
    // Safety: if the thrower got interrupted, recover.
    if (o.state !== 'throwing' && f.stateFrame > 4) this.toNeutral(f, o);
  }

  private techThrow(a: Fighter, b: Fighter): void {
    this.setState(a, 'clash');
    this.setState(b, 'clash');
    const dir = b.x >= a.x ? 1 : -1;
    a.slide = -dir * 0.9 * 0.2;
    b.slide = dir * 0.9 * 0.2;
    this.hitstop = Math.max(this.hitstop, 8);
    this.events.push({ type: 'throwTech', x: (a.x + b.x) / 2, y: 1.2 });
  }

  // --------------------------------------------------------------- motion

  private noPushActive(f: Fighter): boolean {
    const np = f.state === 'attack' ? f.move?.noPush : undefined;
    return Boolean(np && f.stateFrame >= np[0] && f.stateFrame <= np[1]);
  }

  private applyMotion(): void {
    const [a, b] = this.fighters;
    for (const f of this.fighters) {
      if (f.slide !== 0) {
        f.x += f.slide;
        f.slide *= 0.8;
        if (Math.abs(f.slide) < 0.0005) f.slide = 0;
      }
      f.x = Math.max(-WALL_X, Math.min(WALL_X, f.x));
    }

    // Push boxes: grounded bodies cannot overlap; an airborne fighter high enough passes over.
    if (a.state !== 'thrown' && b.state !== 'thrown' && !this.noPushActive(a) && !this.noPushActive(b)) {
      const ha = a.grounded ? PUSH_HALF_GROUND : PUSH_HALF_AIR;
      const hb = b.grounded ? PUSH_HALF_GROUND : PUSH_HALF_AIR;
      const verticalOverlap = a.y < b.y + PUSH_HEIGHT && b.y < a.y + PUSH_HEIGHT;
      const dx = b.x - a.x;
      const minDist = ha + hb;
      if (verticalOverlap && Math.abs(dx) < minDist) {
        const dir = dx > 0 ? 1 : dx < 0 ? -1 : this.prevX[1] >= this.prevX[0] ? 1 : -1;
        const push = (dir * minDist - dx) / 2;
        a.x -= push;
        b.x += push;
        if (a.x < -WALL_X) {
          a.x = -WALL_X;
          if (dir > 0) b.x = a.x + minDist;
        } else if (a.x > WALL_X) {
          a.x = WALL_X;
          if (dir < 0) b.x = a.x - minDist;
        }
        if (b.x < -WALL_X) {
          b.x = -WALL_X;
          if (dir < 0) a.x = b.x + minDist;
        } else if (b.x > WALL_X) {
          b.x = WALL_X;
          if (dir > 0) a.x = b.x - minDist;
        }
      }
    }

    // Camera-limited separation, like a classic fighter: the one moving away gets held.
    const dx = b.x - a.x;
    const excess = Math.abs(dx) - MAX_SEPARATION;
    if (excess > 0) {
      const sign = Math.sign(dx);
      const awayA = Math.max(0, -(a.x - this.prevX[0]) * sign);
      const awayB = Math.max(0, (b.x - this.prevX[1]) * sign);
      const total = awayA + awayB;
      const shareA = total > 0 ? awayA / total : 0.5;
      a.x += sign * excess * shareA;
      b.x -= sign * excess * (1 - shareA);
    }
  }

  // ---------------------------------------------------------- projectiles

  private spawnProjectile(f: Fighter, kind: ProjectileKind): void {
    const spec = f.def.projectile;
    if (!spec) return;
    const p: Projectile = {
      owner: f.id,
      kind,
      spec,
      x: f.x + f.facing * spec.spawnX,
      y: f.y + spec.spawnY,
      dir: f.facing,
      age: 0,
      alive: true,
      traveled: 0,
      returning: false,
      hitThisLeg: false,
    };
    this.projectiles.push(p);
    f.projectileActive = true;
    this.events.push({ type: 'projectile', fighter: f.id, kind, x: p.x, y: p.y });
  }

  private projectileBox(p: Projectile, out: WorldBox): WorldBox {
    out.minX = p.x - p.spec.halfWidth;
    out.maxX = p.x + p.spec.halfWidth;
    out.minY = p.y - p.spec.halfHeight;
    out.maxY = p.y + p.spec.halfHeight;
    return out;
  }

  /** Turn a projectile back toward its thrower (staff) or kill it (wave). */
  private breakProjectile(p: Projectile): void {
    if (p.kind === 'staff') {
      p.returning = true;
      p.hitThisLeg = true;
    } else p.alive = false;
  }

  private updateProjectiles(): void {
    if (this.projectiles.length === 0) return;
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.age += 1;
      if (p.kind === 'staff') {
        const owner = this.fighters[p.owner];
        if (!p.returning) {
          p.x += p.dir * p.spec.speed;
          p.traveled += p.spec.speed;
          if (p.traveled >= p.spec.maxDistance || Math.abs(p.x) > WALL_X + 0.4) {
            p.returning = true;
            p.hitThisLeg = false;
          }
        } else {
          const tx = owner.x + owner.facing * 0.45;
          const dx = tx - p.x;
          const stepX = Math.min(Math.abs(dx), p.spec.returnSpeed);
          p.x += Math.sign(dx) * stepX;
          p.y += (owner.y + 1.2 - p.y) * 0.18;
          if (Math.abs(dx) < 0.3) {
            p.alive = false;
            this.events.push({ type: 'staffCatch', fighter: owner.id });
          }
        }
      } else {
        p.x += p.dir * p.spec.speed;
        if (Math.abs(p.x) > WALL_X + 3) p.alive = false;
      }
    }
    for (let i = 0; i < this.projectiles.length; i += 1) {
      const p = this.projectiles[i];
      if (!p.alive) continue;
      for (let j = i + 1; j < this.projectiles.length; j += 1) {
        const q = this.projectiles[j];
        if (!q.alive || q.owner === p.owner) continue;
        if (overlaps(this.projectileBox(p, this.projBox), this.projectileBox(q, this.projBox2))) {
          this.breakProjectile(p);
          this.breakProjectile(q);
          this.hitstop = Math.max(this.hitstop, 6);
          this.events.push({ type: 'projectileClash', x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
        }
      }
    }
    this.cleanProjectiles();
  }

  private cleanProjectiles(): void {
    if (this.projectiles.some((p) => !p.alive)) {
      this.projectiles = this.projectiles.filter((p) => p.alive);
    }
    this.fighters[0].projectileActive = this.projectiles.some((p) => p.owner === 0);
    this.fighters[1].projectileActive = this.projectiles.some((p) => p.owner === 1);
  }

  // --------------------------------------------------------------- combat

  private liveHit(f: Fighter, out: WorldBox): LiveHit | null {
    if (f.state !== 'attack' || !f.move) return null;
    const t = f.stateFrame;
    const hits = f.move.hits;
    for (let i = 0; i < hits.length; i += 1) {
      const w = hits[i];
      if (f.hitsDone[i] || t < w.from || t > w.to) continue;
      f.toWorld(w.spec.box, out);
      return { index: i, spec: w.spec, box: out };
    }
    return null;
  }

  private hurtContact(d: Fighter, box: WorldBox): { x: number; y: number } | null {
    const count = d.hurtboxes(this.hurt);
    for (let i = 0; i < count; i += 1) {
      if (overlaps(box, this.hurt[i])) return overlapCenter(box, this.hurt[i]);
    }
    return null;
  }

  private resolveCombat(): void {
    const [a, b] = this.fighters;
    const liveA = this.liveHit(a, this.hitBoxes[0]);
    const liveB = this.liveHit(b, this.hitBoxes[1]);

    // Blades meet: both committed attacks overlap → clash instead of a trade.
    if (liveA && liveB && a.move?.id !== 'super' && b.move?.id !== 'super' && overlaps(liveA.box, liveB.box)) {
      this.clash(a, b, overlapCenter(liveA.box, liveB.box));
      return;
    }

    // Saber cuts through an incoming projectile.
    for (const f of this.fighters) {
      const live = f.id === 0 ? liveA : liveB;
      if (!live || !f.move || (f.move.id !== 'heavy' && f.move.id !== 'super')) continue;
      for (const p of this.projectiles) {
        if (!p.alive || p.owner === f.id || (p.kind === 'staff' && p.returning)) continue;
        if (overlaps(live.box, this.projectileBox(p, this.projBox))) {
          this.breakProjectile(p);
          f.meter = Math.min(METER_MAX, f.meter + 20);
          this.hitstop = Math.max(this.hitstop, 7);
          this.events.push({ type: 'deflect', fighter: f.id, x: p.x, y: p.y });
        }
      }
    }

    const contactA = liveA ? this.hurtContact(b, liveA.box) : null;
    const contactB = liveB ? this.hurtContact(a, liveB.box) : null;
    const moveA = a.move?.id ?? 'light';
    const moveB = b.move?.id ?? 'light';
    if (liveA && contactA) this.applyHit(a, b, liveA.spec, liveA.index, moveA, contactA, false);
    if (liveB && contactB) this.applyHit(b, a, liveB.spec, liveB.index, moveB, contactB, false);

    for (const p of this.projectiles) {
      if (!p.alive || (p.kind === 'staff' && p.hitThisLeg)) continue;
      const owner = this.fighters[p.owner];
      const target = this.opponent(owner);
      const contact = this.hurtContact(target, this.projectileBox(p, this.projBox));
      if (!contact) continue;
      const travelDir = p.kind === 'staff' && p.returning ? Math.sign(owner.x - p.x) || 1 : p.dir;
      // Guard against the side the projectile came from, not where it touched.
      const result = this.applyHit(owner, target, p.spec.spec, -1, 'special', contact, true, p.x - travelDir * 1.5);
      if (result === 'parried') {
        if (p.kind === 'wave') {
          // Reflected back at its caster.
          p.dir = (p.dir * -1) as 1 | -1;
          p.owner = target.id;
          p.age = 0;
        } else {
          p.returning = true;
          p.hitThisLeg = true;
        }
      } else if (p.kind === 'wave') {
        p.alive = false;
      } else {
        p.hitThisLeg = true;
      }
    }
    this.cleanProjectiles();

    this.resolveGrabs();
    this.resolveThrows();
  }

  private clash(a: Fighter, b: Fighter, point: { x: number; y: number }): void {
    const dir = b.x >= a.x ? 1 : -1;
    for (const [f, side] of [
      [a, -dir],
      [b, dir],
    ] as const) {
      if (f.y > 0) {
        // Blades met in the air: bounce off and fall.
        this.setState(f, 'air');
        f.airAttackUsed = true;
        f.jumpDir = 0;
        f.vx = side * 0.035;
        f.vy = Math.min(f.vy, 0.02);
      } else {
        this.setState(f, 'clash');
        f.slide = side * 0.95 * 0.2;
      }
    }
    a.meter = Math.min(METER_MAX, a.meter + 20);
    b.meter = Math.min(METER_MAX, b.meter + 20);
    a.stats.clashes += 1;
    b.stats.clashes += 1;
    this.hitstop = Math.max(this.hitstop, CLASH_HITSTOP);
    this.events.push({ type: 'clash', x: point.x, y: point.y });
  }

  private canBlock(d: Fighter, attackerX: number): boolean {
    const ready = d.state === 'idle' || d.state === 'walk' || d.state === 'crouch' || d.state === 'block';
    return ready && d.grounded && d.holdingAwayFrom(attackerX);
  }

  private guardMatches(d: Fighter, height: GuardHeight): boolean {
    if (height === 'low') return d.input.down;
    if (height === 'overhead') return !d.input.down;
    return true;
  }

  private parrying(d: Fighter): boolean {
    if (!d.grounded) return false;
    if (d.state === 'parrySuccess') return true;
    const window = d.state === 'attack' ? d.move?.parry : undefined;
    return Boolean(window && d.stateFrame >= window[0] && d.stateFrame <= window[1]);
  }

  private applyHit(
    a: Fighter,
    d: Fighter,
    spec: HitSpec,
    index: number,
    source: MoveId,
    point: { x: number; y: number },
    projectile: boolean,
    sourceX = a.x,
  ): HitResult {
    if (index >= 0) {
      a.hitsDone[index] = true;
      a.connected = true;
    }

    // Parry: the blade is turned aside — no damage, attacker staggers (supers keep going).
    if (this.parrying(d)) {
      this.setState(d, 'parrySuccess');
      d.facing = sourceX >= d.x ? 1 : -1;
      d.parryFlash = 16;
      d.meter = Math.min(METER_MAX, d.meter + PARRY_METER);
      d.stats.parries += 1;
      d.slide = 0;
      if (!projectile && a.move?.id !== 'super') {
        const stagger = 20 + Math.round(spec.strength * 14);
        if (a.y > 0) {
          this.setState(a, 'air');
          a.airAttackUsed = true;
          a.jumpDir = 0;
          a.vx = Math.sign(a.x - d.x || -d.facing) * 0.04;
        } else {
          this.setState(a, 'parried');
          a.stun = stagger;
          a.slide = Math.sign(a.x - d.x || -d.facing) * 0.45 * 0.2;
        }
        this.events.push({ type: 'parried', fighter: a.id });
      }
      this.hitstop = Math.max(this.hitstop, PARRY_HITSTOP);
      this.events.push({ type: 'parry', defender: d.id, x: point.x, y: point.y, projectile });
      return 'parried';
    }

    const blocked = this.canBlock(d, sourceX) && this.guardMatches(d, spec.height);

    if (blocked) {
      d.health = Math.max(0, d.health - spec.chip);
      this.setState(d, 'block');
      d.stun = spec.blockstun;
      d.crouching = d.input.down;
      d.blockFlash = 10;
      d.stats.blocks += 1;
      a.meter = Math.min(METER_MAX, a.meter + spec.meterGain * 0.5);
      d.meter = Math.min(METER_MAX, d.meter + 5);
      this.hitstop = Math.max(this.hitstop, Math.max(4, spec.hitstop - 2));
      this.events.push({ type: 'hit', attacker: a.id, x: point.x, y: point.y, damage: spec.chip, strength: spec.strength * 0.7, blocked: true, source, counter: false, combo: 0 });
      this.applyPushback(a, d, spec.pushback, projectile, sourceX);
      return 'blocked';
    }

    const counter = d.state === 'attack' && d.move !== null && (d.stateFrame <= d.move.startup || d.move.id === 'parry');
    d.comboCount += 1;
    const scale = d.comboCount <= 2 ? 1 : Math.max(0.4, 1 - 0.12 * (d.comboCount - 2));
    const damage = Math.round(spec.damage * scale * (counter ? 1.2 : 1));
    d.health = Math.max(0, d.health - damage);
    d.comboDamage += damage;
    d.flash = 10;
    if (counter) d.counterFlash = 40;
    a.stats.damageDealt += damage;
    a.stats.hitsLanded += 1;
    a.stats.maxCombo = Math.max(a.stats.maxCombo, d.comboCount);
    a.meter = Math.min(METER_MAX, a.meter + spec.meterGain);
    d.meter = Math.min(METER_MAX, d.meter + damage * 0.12);
    d.lastHitY = point.y - d.y;
    d.hitHeavy = spec.strength >= 0.6;

    const airborne = !d.grounded;
    const away: 1 | -1 = d.x > sourceX ? 1 : d.x < sourceX ? -1 : a.facing;
    if (spec.knockdown || airborne || d.health <= 0) {
      const kind: LaunchKind = spec.launchKind ?? (airborne ? 'spin' : 'blowback');
      this.launch(d, away, spec.launchVx ?? 0.05, spec.launchVy ?? 0.1, kind);
    } else {
      const wasCrouching = d.crouching || d.input.down;
      this.setState(d, 'hit');
      d.crouching = wasCrouching;
      const rel = point.y - d.y;
      d.hitReact = wasCrouching ? 'crouch' : rel > d.def.height * 0.74 ? 'high' : rel < d.def.height * 0.36 ? 'low' : 'body';
      d.stun = spec.hitstun + (counter ? 4 : 0);
      this.applyPushback(a, d, spec.pushback, projectile, sourceX);
    }
    this.hitstop = Math.max(this.hitstop, spec.hitstop + (counter ? 3 : 0));
    this.events.push({ type: 'hit', attacker: a.id, x: point.x, y: point.y, damage, strength: spec.strength, blocked: false, source, counter, combo: d.comboCount });
    return 'hit';
  }

  private applyPushback(a: Fighter, d: Fighter, amount: number, projectile: boolean, sourceX: number): void {
    const dir = d.x > sourceX ? 1 : d.x < sourceX ? -1 : a.facing;
    const room = dir > 0 ? WALL_X - d.x : d.x + WALL_X;
    const defenderPart = Math.min(amount, Math.max(0, room));
    const attackerPart = projectile ? 0 : amount - defenderPart;
    d.slide = dir * defenderPart * 0.2;
    if (attackerPart > 0) a.slide = -dir * attackerPart * 0.2;
  }

  private throwable(f: Fighter): boolean {
    if (!f.grounded || f.isInvulnerable()) return false;
    switch (f.state) {
      case 'hit':
      case 'block':
      case 'clash':
      case 'air':
      case 'airHit':
      case 'knockdown':
      case 'getup':
      case 'ko':
      case 'thrown':
      case 'throwing':
        return false;
      default:
        return true;
    }
  }

  private resolveGrabs(): void {
    for (const f of this.fighters) {
      const grab = f.state === 'attack' ? f.move?.grab : undefined;
      if (!grab || f.stateFrame < grab.from || f.stateFrame > grab.to) continue;
      const o = this.opponent(f);
      if (!this.throwable(o)) continue;
      f.toWorld(grab.box, this.grabBox);
      if (!this.hurtContact(o, this.grabBox)) continue;
      this.setState(f, 'throwing');
      f.throwKind = 'grip';
      this.setState(o, 'thrown');
      o.throwKind = 'grip';
      o.techWindow = 0;
      o.vx = 0;
      o.vy = 0;
      this.gripDist[f.id] = Math.max(1.15, Math.min(2.3, Math.abs(o.x - f.x)));
      this.events.push({ type: 'grip', fighter: f.id });
      return;
    }
  }

  private resolveThrows(): void {
    const [a, b] = this.fighters;
    const throwingA = a.state === 'attack' && a.move?.id === 'throw' && a.stateFrame >= 4 && a.stateFrame <= 5;
    const throwingB = b.state === 'attack' && b.move?.id === 'throw' && b.stateFrame >= 4 && b.stateFrame <= 5;
    if (!throwingA && !throwingB) return;
    const dist = Math.abs(a.x - b.x);
    if (throwingA && throwingB && dist <= Math.max(a.def.throwRange, b.def.throwRange)) {
      this.techThrow(a, b);
      return;
    }
    const thrower = throwingA ? a : b;
    const target = throwingA ? b : a;
    if (dist > thrower.def.throwRange) return;
    if (target.state === 'attack' && target.move?.id === 'throw' && target.stateFrame < 4) {
      this.techThrow(thrower, target);
      return;
    }
    if (!this.throwable(target)) return;
    this.setState(thrower, 'throwing');
    thrower.throwKind = 'throw';
    this.setState(target, 'thrown');
    target.throwKind = 'throw';
    target.techWindow = THROW_TECH_WINDOW;
    target.vx = 0;
    target.vy = 0;
  }
}
