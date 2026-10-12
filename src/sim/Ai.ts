import { METER_BAR, METER_MAX } from './constants';
import type { Fighter } from './Fighter';
import type { Match } from './Match';
import { emptyInput, type FighterId, type FighterState, type InputFrame, type MoveId } from './types';

export type Difficulty = 'easy' | 'normal' | 'hard';

interface Profile {
  /** Frames between the opponent doing something and the CPU seeing it. */
  reaction: number;
  /** Frames between neutral decisions. */
  think: number;
  block: number;
  parry: number;
  punish: number;
  antiAir: number;
  aggression: number;
  combo: number;
  tech: number;
  special: number;
  jumpIn: number;
}

const PROFILES: Record<Difficulty, Profile> = {
  easy: { reaction: 24, think: 22, block: 0.3, parry: 0.04, punish: 0.2, antiAir: 0.15, aggression: 0.38, combo: 0.2, tech: 0.1, special: 0.25, jumpIn: 0.12 },
  normal: { reaction: 15, think: 14, block: 0.55, parry: 0.12, punish: 0.55, antiAir: 0.5, aggression: 0.5, combo: 0.6, tech: 0.35, special: 0.35, jumpIn: 0.14 },
  hard: { reaction: 9, think: 9, block: 0.72, parry: 0.24, punish: 0.85, antiAir: 0.82, aggression: 0.6, combo: 0.9, tech: 0.6, special: 0.45, jumpIn: 0.1 },
};

interface Snapshot {
  state: FighterState;
  move: MoveId | null;
  stateFrame: number;
  x: number;
  y: number;
  vx: number;
  airborne: boolean;
}

/** Facing-relative keys, resolved to screen keys when emitted so cross-ups keep the right direction. */
type RelKeys = { fwd?: boolean; back?: boolean; up?: boolean; down?: boolean; light?: boolean; heavy?: boolean; force?: boolean; parry?: boolean };

interface PlanStep {
  keys: RelKeys;
  frames: number;
}

export class CpuController {
  private readonly history: Snapshot[] = [];
  private plan: PlanStep[] = [];
  private readonly out: InputFrame = emptyInput();
  private thinkTimer = 0;
  private desiredRange = 2.1;
  private blockedCount = 0;
  private lastOppState: FighterState = 'idle';
  private techDecided = false;
  private comboDecided = false;
  private profile: Profile;

  constructor(
    private readonly match: Match,
    private readonly me: FighterId,
    private readonly rng: () => number,
    difficulty: Difficulty,
  ) {
    this.profile = PROFILES[difficulty];
  }

  setDifficulty(difficulty: Difficulty): void {
    this.profile = PROFILES[difficulty];
  }

  reset(): void {
    this.history.length = 0;
    this.plan = [];
    this.thinkTimer = 0;
    this.blockedCount = 0;
    this.techDecided = false;
    this.comboDecided = false;
  }

  /** Produce this frame's input. Call once per simulation step, before Match.step. */
  update(): InputFrame {
    const self = this.match.fighters[this.me];
    const opp = this.match.opponent(self);
    this.record(opp);
    this.clear();

    if (this.match.phase !== 'fight') {
      this.plan = [];
      return this.out;
    }

    if (opp.state === 'block' && this.lastOppState !== 'block') this.blockedCount += 1;
    if (opp.state === 'hit') this.blockedCount = Math.max(0, this.blockedCount - 1);
    this.lastOppState = opp.state;

    // Getting hit interrupts whatever the CPU had queued.
    if (self.state === 'hit' || self.state === 'airHit' || self.state === 'knockdown' || self.state === 'getup' || self.state === 'clash' || self.state === 'parried') {
      this.plan = [];
    }

    if (self.state === 'thrown') {
      if (!this.techDecided && self.throwKind === 'throw') {
        this.techDecided = true;
        if (this.rng() < this.profile.tech) this.plan = [{ keys: {}, frames: 2 + Math.floor(this.rng() * 3) }, { keys: { light: true, heavy: true }, frames: 2 }];
      }
    } else {
      this.techDecided = false;
    }

    // A successful parry opens the attacker up: punish immediately.
    if (self.state === 'parrySuccess' && self.stateFrame === 1) {
      const dx = Math.abs(opp.x - self.x);
      this.plan = dx < 1.8 ? [{ keys: {}, frames: 3 }, { keys: { light: true }, frames: 2 }, { keys: {}, frames: 6 }, { keys: { heavy: true }, frames: 2 }] : [{ keys: {}, frames: 3 }, { keys: { heavy: true }, frames: 2 }];
    }

    // Confirm a landed light into its follow-up.
    if (self.state === 'attack' && self.move && self.connected && !this.comboDecided) {
      this.comboDecided = true;
      if (opp.state === 'hit' && (self.move.id === 'light' || self.move.id === 'crLight') && this.rng() < this.profile.combo) {
        const useForce = self.meter >= METER_BAR && !self.projectileActive && self.def.special !== 'grip' && this.rng() < 0.35;
        const finisher: RelKeys = useForce ? { force: true } : self.move.id === 'crLight' ? { down: true, light: true } : { heavy: true };
        this.plan = [{ keys: {}, frames: 2 }, { keys: finisher, frames: 2 }];
      }
    }
    if (self.state !== 'attack') this.comboDecided = false;

    if (this.plan.length > 0) {
      this.runPlan(self);
      return this.out;
    }

    const seen = this.perceived();
    const dx = Math.abs(opp.x - self.x);

    if (self.actionable || self.state === 'block') {
      if (this.reactDefensively(self, opp, seen, dx)) {
        this.runPlan(self);
        return this.out;
      }
    }

    if (!self.actionable) return this.out;

    this.thinkTimer -= 1;
    if (this.thinkTimer > 0) {
      this.approachOrHold(self, dx);
      return this.out;
    }
    this.thinkTimer = this.profile.think + Math.floor(this.rng() * this.profile.think);
    this.decideNeutral(self, opp, seen, dx);
    this.runPlan(self);
    return this.out;
  }

  private record(opp: Fighter): void {
    this.history.push({
      state: opp.state,
      move: opp.move?.id ?? null,
      stateFrame: opp.stateFrame,
      x: opp.x,
      y: opp.y,
      vx: opp.vx,
      airborne: opp.y > 0.05,
    });
    if (this.history.length > 40) this.history.shift();
  }

  private perceived(): Snapshot {
    const index = Math.max(0, this.history.length - 1 - this.profile.reaction);
    return this.history[index];
  }

  private clear(): void {
    const o = this.out;
    o.left = o.right = o.up = o.down = o.light = o.heavy = o.force = o.parry = false;
  }

  private runPlan(self: Fighter): void {
    const step = this.plan[0];
    if (!step) return;
    const k = step.keys;
    const o = this.out;
    if (k.fwd) o[self.facing > 0 ? 'right' : 'left'] = true;
    if (k.back) o[self.facing > 0 ? 'left' : 'right'] = true;
    if (k.up) o.up = true;
    if (k.down) o.down = true;
    if (k.light) o.light = true;
    if (k.heavy) o.heavy = true;
    if (k.force) o.force = true;
    if (k.parry) o.parry = true;
    step.frames -= 1;
    if (step.frames <= 0) this.plan.shift();
  }

  private reachOf(f: Fighter, id: MoveId): number {
    const move = f.def.moves[id];
    let reach = 1.5;
    for (const w of move.hits) reach = Math.max(reach, w.spec.box.x1);
    return reach;
  }

  private reactDefensively(self: Fighter, opp: Fighter, seen: Snapshot, dx: number): boolean {
    const p = this.profile;

    // Incoming projectile.
    for (const proj of this.match.projectiles) {
      if (proj.owner === self.id) continue;
      const dir = proj.returning ? Math.sign(this.match.fighters[proj.owner].x - proj.x) || 1 : proj.dir;
      const toward = (self.x - proj.x) * dir;
      if (toward < 0 || toward > 3.2) continue;
      const roll = this.rng();
      if (toward < 1.6 && roll < p.parry * 1.5) {
        this.plan = [{ keys: { parry: true }, frames: 2 }];
      } else if (toward > 2.5 && roll < p.antiAir * 0.5) {
        // Heavy cuts the projectile only if it is started early.
        this.plan = [{ keys: { heavy: true }, frames: 2 }];
      } else if (roll < p.block + 0.1) {
        this.plan = [{ keys: { back: true }, frames: 20 }];
      } else if (roll < p.block + 0.25 && dx < 5) {
        this.plan = [{ keys: { up: true, fwd: true }, frames: 4 }];
      } else {
        return false;
      }
      return true;
    }

    // Jump-in: anti-air, parry or guard high.
    if (seen.airborne && seen.state !== 'airHit' && dx < 3.0) {
      const approaching = (opp.x - self.x) * seen.vx < 0 || dx < 1.4;
      if (approaching) {
        const roll = this.rng();
        if (roll < p.antiAir && dx > 0.6) {
          this.plan = [{ keys: {}, frames: Math.max(0, Math.floor((dx - 1.4) * 4)) }, { keys: { heavy: true }, frames: 2 }];
        } else if (roll < p.antiAir + p.parry) {
          this.plan = [{ keys: {}, frames: Math.max(0, Math.floor((dx - 0.8) * 5)) }, { keys: { parry: true }, frames: 2 }];
        } else if (this.rng() < p.block) {
          this.plan = [{ keys: { back: true }, frames: 22 }];
        } else {
          return false;
        }
        return true;
      }
    }

    // Opponent swinging within reach → parry or guard the right height.
    if (seen.state === 'attack' && seen.move && seen.move !== 'throw' && seen.move !== 'parry' && seen.move !== 'special') {
      const move = opp.def.moves[seen.move];
      const reach = this.reachOf(opp, seen.move) + 0.6 + (move.travel ? 0.8 : 0);
      if (seen.stateFrame <= move.activeTo && dx < reach) {
        const roll = this.rng();
        const framesToActive = move.activeFrom - seen.stateFrame - this.profile.reaction;
        if (roll < p.parry && framesToActive > -4) {
          this.plan = [{ keys: {}, frames: Math.max(0, framesToActive - 3) }, { keys: { parry: true }, frames: 2 }];
          return true;
        }
        if (roll < p.parry + p.block) {
          const low = move.hits[0]?.spec.height === 'low';
          const frames = Math.max(8, move.activeTo - seen.stateFrame + 10);
          this.plan = [{ keys: { back: true, down: low }, frames }];
          return true;
        }
        return false;
      }
      const recovering = seen.stateFrame > move.activeTo && !opp.connected && opp.state === 'attack';
      if (recovering && dx < 2.5 && this.rng() < p.punish) {
        this.plan = dx < 1.75 && this.rng() < 0.5 ? [{ keys: { light: true }, frames: 2 }, { keys: {}, frames: 5 }, { keys: { heavy: true }, frames: 2 }] : [{ keys: { heavy: true }, frames: 2 }];
        return true;
      }
    }
    // Whiffed parry: free punish.
    if (seen.state === 'attack' && seen.move === 'parry' && seen.stateFrame > 9 && dx < 2.2 && this.rng() < p.punish) {
      this.plan = [{ keys: { heavy: true }, frames: 2 }];
      return true;
    }
    return false;
  }

  private decideNeutral(self: Fighter, opp: Fighter, seen: Snapshot, dx: number): void {
    const p = this.profile;
    let aggression = p.aggression;
    if (self.health / self.maxHealth < opp.health / opp.maxHealth - 0.25) aggression += 0.15;
    if (this.match.secondsLeft < 15 && self.health / self.maxHealth < opp.health / opp.maxHealth) aggression += 0.2;
    const reach = this.reachOf(self, 'heavy');
    this.desiredRange = Math.max(1.7, reach - 0.1) + this.rng() * 0.6;

    if (seen.state === 'knockdown' || seen.state === 'getup') {
      if (dx > 2.0) this.plan = [{ keys: { fwd: true }, frames: 12 }];
      else this.plan = [{ keys: {}, frames: 8 }];
      return;
    }

    if (self.meter >= METER_MAX && dx < (self.def.superKind === 'lightning' ? 4.2 : 2.6) && (this.rng() < 0.25 || seen.state === 'land')) {
      this.plan = [{ keys: { down: true }, frames: 2 }, { keys: { down: true, force: true }, frames: 2 }];
      return;
    }

    if (self.meter >= METER_BAR && this.rng() < p.special) {
      const kind = self.def.special;
      if ((kind === 'wave' || kind === 'staff') && !self.projectileActive && dx > 3.2) {
        this.plan = [{ keys: { force: true }, frames: 2 }];
        return;
      }
      if (kind === 'grip' && dx > 1.3 && dx < 2.7 && opp.grounded && opp.state !== 'attack') {
        this.plan = [{ keys: { force: true }, frames: 2 }];
        return;
      }
      if (kind === 'leap' && dx > 2.6 && dx < 4.0) {
        this.plan = [{ keys: { force: true }, frames: 2 }];
        return;
      }
    }

    // Throw a turtle: walk in if needed, then grab.
    const throwRange = self.def.throwRange;
    if (dx < throwRange - 0.05 && (this.blockedCount >= 2 || this.rng() < 0.15)) {
      this.blockedCount = 0;
      this.plan = [{ keys: { light: true, heavy: true }, frames: 2 }];
      return;
    }
    if (dx < 2.7 && this.blockedCount >= 2 && this.rng() < 0.6) {
      this.blockedCount = 0;
      const walk = Math.max(1, Math.ceil((dx - (throwRange - 0.25)) / self.def.walkForward));
      this.plan = [{ keys: { fwd: true }, frames: walk }, { keys: { light: true, heavy: true }, frames: 2 }];
      return;
    }

    if (dx > 2.5 && dx < 3.9 && this.rng() < p.jumpIn) {
      const heavy = this.rng() < 0.5;
      this.plan = [{ keys: { up: true, fwd: true }, frames: 4 }, { keys: {}, frames: 17 }, { keys: heavy ? { heavy: true } : { light: true }, frames: 2 }];
      return;
    }

    if (dx > this.desiredRange + 0.5) {
      if (dx > 4.4 && this.rng() < 0.45) {
        // Sprint in.
        const runFrames = Math.max(8, Math.floor((dx - this.desiredRange) / self.def.runSpeed));
        this.plan = [{ keys: { fwd: true }, frames: 2 }, { keys: {}, frames: 2 }, { keys: { fwd: true }, frames: runFrames }];
      } else {
        this.plan = [{ keys: { fwd: true }, frames: 10 + Math.floor(this.rng() * 14) }];
      }
      return;
    }

    const roll = this.rng();
    const lightReach = this.reachOf(self, 'light') + 0.25;
    if (roll < aggression) {
      const pick = this.rng();
      if (dx < lightReach) {
        if (pick < 0.35) this.plan = [{ keys: { light: true }, frames: 2 }];
        else if (pick < 0.62) this.plan = [{ keys: { down: true }, frames: 2 }, { keys: { down: true, light: true }, frames: 2 }];
        else if (pick < 0.82) this.plan = [{ keys: { heavy: true }, frames: 2 }];
        else this.plan = [{ keys: { down: true }, frames: 2 }, { keys: { down: true, heavy: true }, frames: 2 }];
      } else if (dx < reach + 0.3) {
        if (pick < 0.55) this.plan = [{ keys: { heavy: true }, frames: 2 }];
        else if (pick < 0.8) this.plan = [{ keys: { down: true }, frames: 2 }, { keys: { down: true, heavy: true }, frames: 2 }];
        else this.plan = [{ keys: { fwd: true }, frames: 6 }, { keys: { light: true }, frames: 2 }];
      } else {
        this.plan = [{ keys: { fwd: true }, frames: 8 + Math.floor(this.rng() * 8) }];
      }
      return;
    }

    if (roll < aggression + 0.25) {
      this.plan = [{ keys: { back: true }, frames: 6 + Math.floor(this.rng() * 10) }];
      return;
    }
    this.plan = [{ keys: { back: dx < 1.6 }, frames: 6 + Math.floor(this.rng() * 8) }];
  }

  private approachOrHold(self: Fighter, dx: number): void {
    if (dx > this.desiredRange + 0.9) {
      const key = self.facing > 0 ? 'right' : 'left';
      this.out[key] = true;
    }
  }
}
