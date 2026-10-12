import { BACKDASH_INVULN, DOUBLE_TAP_WINDOW, INPUT_BUFFER } from './constants';
import type { CharacterStats, MoveDef } from './moves';
import { ROSTER } from './roster';
import {
  BUTTONS,
  emptyInput,
  type Box,
  type Button,
  type CharacterId,
  type FighterId,
  type FighterState,
  type HitReaction,
  type InputFrame,
  type LaunchKind,
  type ThrowKind,
  type WorldBox,
} from './types';

const NEVER = -100000;

export interface FighterStats {
  damageDealt: number;
  hitsLanded: number;
  blocks: number;
  clashes: number;
  parries: number;
  maxCombo: number;
  throws: number;
  specials: number;
  supers: number;
}

export class Fighter {
  def: CharacterStats;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  health = 1000;
  meter = 0;
  state: FighterState = 'intro';
  stateFrame = 0;
  move: MoveDef | null = null;
  crouching = false;
  guarding = false;
  stun = 0;
  slide = 0;
  hitsDone: boolean[] = [];
  connected = false;
  chain = 0;
  airAttackUsed = false;
  jumpDir: -1 | 0 | 1 = 0;
  /** True when the jump was taken out of a run (longer arc). */
  runJump = false;
  /** +1 walking forward, -1 walking back (for the walk cycle). */
  walkDir: -1 | 0 | 1 = 0;
  landLag = 3;
  comboCount = 0;
  comboDamage = 0;
  /** Frames the fighter has been simulated (frozen during hitstop/super freeze). */
  clock = 0;
  readonly input: InputFrame = emptyInput();
  readonly prevInput: InputFrame = emptyInput();
  private readonly pressTime: Record<Button, number> = {
    left: NEVER,
    right: NEVER,
    up: NEVER,
    down: NEVER,
    light: NEVER,
    heavy: NEVER,
    force: NEVER,
    parry: NEVER,
  };
  private tapDir: -1 | 0 | 1 = 0;
  private tapTime = NEVER;
  dashRequest: -1 | 0 | 1 = 0;
  dashTime = NEVER;
  /** Render cue frames. */
  flash = 0;
  blockFlash = 0;
  counterFlash = 0;
  parryFlash = 0;
  projectileActive = false;
  roundsWon = 0;
  noMeterCooldown = 0;
  techWindow = 0;
  throwKind: ThrowKind = 'throw';
  /** Last grounded hit reaction and whether it was a heavy hit (animation selection). */
  hitReact: HitReaction = 'body';
  hitHeavy = false;
  launchKind: LaunchKind = 'blowback';
  bounced = false;
  /** Height above the floor of the strike that launched this fighter (fall pose selection). */
  lastHitY = 1;
  readonly stats: FighterStats = {
    damageDealt: 0,
    hitsLanded: 0,
    blocks: 0,
    clashes: 0,
    parries: 0,
    maxCombo: 0,
    throws: 0,
    specials: 0,
    supers: 0,
  };

  constructor(
    readonly id: FighterId,
    character: CharacterId,
  ) {
    this.def = ROSTER[character];
    this.health = this.def.health;
  }

  setCharacter(character: CharacterId): void {
    this.def = ROSTER[character];
    this.health = this.def.health;
  }

  get maxHealth(): number {
    return this.def.health;
  }

  resetForRound(x: number, facing: 1 | -1): void {
    this.x = x;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing;
    this.health = this.def.health;
    this.state = 'intro';
    this.stateFrame = 0;
    this.move = null;
    this.crouching = false;
    this.guarding = false;
    this.stun = 0;
    this.slide = 0;
    this.hitsDone = [];
    this.connected = false;
    this.chain = 0;
    this.airAttackUsed = false;
    this.jumpDir = 0;
    this.runJump = false;
    this.walkDir = 0;
    this.landLag = 3;
    this.comboCount = 0;
    this.comboDamage = 0;
    this.flash = 0;
    this.blockFlash = 0;
    this.counterFlash = 0;
    this.parryFlash = 0;
    this.projectileActive = false;
    this.techWindow = 0;
    this.throwKind = 'throw';
    this.bounced = false;
    this.dashRequest = 0;
    this.dashTime = NEVER;
    this.noMeterCooldown = 0;
    this.clearBuffer();
    this.tapDir = 0;
    this.tapTime = NEVER;
  }

  resetForMatch(): void {
    this.meter = 0;
    this.roundsWon = 0;
    for (const key of Object.keys(this.stats) as Array<keyof FighterStats>) this.stats[key] = 0;
  }

  /** Record this frame's buttons. Called every sim frame, including hitstop, so presses buffer through freezes. */
  feedInput(next: InputFrame): void {
    for (const button of BUTTONS) {
      this.prevInput[button] = this.input[button];
      const value = next[button];
      if (value && !this.input[button]) {
        this.pressTime[button] = this.clock;
        if (button === 'left' || button === 'right') this.registerTap(button === 'right' ? 1 : -1);
      }
      this.input[button] = value;
    }
  }

  private registerTap(dir: -1 | 1): void {
    if (this.tapDir === dir && this.clock - this.tapTime <= DOUBLE_TAP_WINDOW) {
      this.dashRequest = dir;
      this.dashTime = this.clock;
      this.tapDir = 0;
      this.tapTime = NEVER;
      return;
    }
    this.tapDir = dir;
    this.tapTime = this.clock;
  }

  /** Forget buffered presses (round end) so nothing fires into the next phase. */
  clearBuffer(): void {
    for (const button of BUTTONS) this.pressTime[button] = NEVER;
    this.dashRequest = 0;
  }

  pressed(button: Button, window = INPUT_BUFFER): boolean {
    return this.clock - this.pressTime[button] <= window;
  }

  pressAge(button: Button): number {
    return this.clock - this.pressTime[button];
  }

  consume(button: Button): void {
    this.pressTime[button] = NEVER;
  }

  get forwardHeld(): boolean {
    return this.facing > 0 ? this.input.right && !this.input.left : this.input.left && !this.input.right;
  }

  get backHeld(): boolean {
    return this.facing > 0 ? this.input.left && !this.input.right : this.input.right && !this.input.left;
  }

  holdingAwayFrom(x: number): boolean {
    const awayRight = x < this.x || (x === this.x && this.facing < 0);
    return awayRight ? this.input.right && !this.input.left : this.input.left && !this.input.right;
  }

  get grounded(): boolean {
    return this.y <= 0;
  }

  get actionable(): boolean {
    return this.state === 'idle' || this.state === 'walk' || this.state === 'crouch';
  }

  isInvulnerable(): boolean {
    switch (this.state) {
      case 'knockdown':
      case 'getup':
      case 'airHit':
      case 'ko':
      case 'intro':
      case 'victory':
      case 'thrown':
      case 'throwing':
        return true;
      case 'backdash':
        return this.stateFrame <= BACKDASH_INVULN;
      case 'attack': {
        const inv = this.move?.invuln;
        return Boolean(inv && this.stateFrame >= inv[0] && this.stateFrame <= inv[1]);
      }
      default:
        return false;
    }
  }

  toWorld(box: Box, out: WorldBox): WorldBox {
    const a = this.x + this.facing * box.x0;
    const b = this.x + this.facing * box.x1;
    out.minX = Math.min(a, b);
    out.maxX = Math.max(a, b);
    out.minY = this.y + box.y0;
    out.maxY = this.y + box.y1;
    return out;
  }

  private readonly bodyBox: Box = { x0: -0.32, x1: 0.32, y0: 0, y1: 1.78 };

  /** Writes current hurtboxes into `out` and returns how many were written. */
  hurtboxes(out: WorldBox[]): number {
    if (this.isInvulnerable()) return 0;
    let count = 0;
    const h = this.def.height;
    const b = this.bodyBox;
    if (!this.grounded && this.state !== 'land') {
      b.x0 = -0.3;
      b.x1 = 0.3;
      b.y0 = 0.25;
      b.y1 = h * 0.9;
    } else if (this.crouching) {
      b.x0 = -0.36;
      b.x1 = 0.36;
      b.y0 = 0;
      b.y1 = h * 0.63;
    } else {
      b.x0 = -0.32;
      b.x1 = 0.32;
      b.y0 = 0;
      b.y1 = h;
    }
    this.toWorld(b, out[count++]);
    const ext = this.move?.hurtExtend;
    if (this.state === 'attack' && ext && this.stateFrame >= ext.from && this.stateFrame <= ext.to) {
      this.toWorld(ext.box, out[count++]);
    }
    return count;
  }
}

export function overlaps(a: WorldBox, b: WorldBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

export function overlapCenter(a: WorldBox, b: WorldBox): { x: number; y: number } {
  const minX = Math.max(a.minX, b.minX);
  const maxX = Math.min(a.maxX, b.maxX);
  const minY = Math.max(a.minY, b.minY);
  const maxY = Math.min(a.maxY, b.maxY);
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

export function makeWorldBox(): WorldBox {
  return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
}
