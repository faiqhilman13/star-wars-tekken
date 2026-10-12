import type { Pose } from './pose';

/** Damped spring (semi-implicit Euler with fixed substeps so it is stable at any frame rate). */
export class Spring {
  x = 0;
  v = 0;

  constructor(
    public k: number,
    public c: number,
  ) {}

  step(dt: number, target = 0): void {
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i += 1) {
      const a = -this.k * (this.x - target) - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
  }

  kick(dv: number): void {
    this.v += dv;
  }

  reset(): void {
    this.x = 0;
    this.v = 0;
  }
}

/**
 * Secondary motion layered on top of the keyed pose: impact whiplash, landing compression,
 * follow-through lean and cloth/hair lag. Everything is additive and decays to zero.
 */
export class Secondary {
  /** Chest lean (deg, + = back). */
  readonly lean = new Spring(170, 13);
  /** Head nod (deg). */
  readonly nod = new Spring(230, 11);
  /** Hip compression (units, + = lower). */
  readonly drop = new Spring(260, 17);
  /** Chest twist (deg). */
  readonly twist = new Spring(150, 12);
  /** Cloth / cape swing (deg). */
  readonly cloth = new Spring(38, 4.2);
  /** Hair / tails swing (deg). */
  readonly hair = new Spring(55, 3.6);
  /** Blade wobble after impacts (deg). */
  readonly blade = new Spring(320, 14);
  /** 0..1 radial cloth flare from whole-body spins (whirlwinds, corkscrews, turnarounds). */
  flare = 0;
  private lastVx = 0;
  private lastVy = 0;

  reset(): void {
    for (const s of [this.lean, this.nod, this.drop, this.twist, this.cloth, this.hair, this.blade]) s.reset();
    this.flare = 0;
    this.lastVx = 0;
    this.lastVy = 0;
  }

  /**
   * @param vx forward speed in the fighter's facing frame (units/s)
   * @param vy vertical speed (units/s)
   */
  update(dt: number, vx: number, vy: number, enabled: boolean): void {
    if (dt <= 0) return;
    if (!enabled) {
      this.reset();
      return;
    }
    const ax = (vx - this.lastVx) / dt;
    const ay = (vy - this.lastVy) / dt;
    this.lastVx = vx;
    this.lastVy = vy;
    // Cloth and hair trail behind motion and fall behind when stopping.
    this.cloth.kick(-ax * 0.9 * dt * 60);
    this.hair.kick(-ax * 1.3 * dt * 60 + ay * 0.4 * dt * 60);
    this.cloth.step(dt, Math.max(-28, Math.min(28, -vx * 6)));
    this.hair.step(dt, Math.max(-35, Math.min(35, -vx * 8 + vy * 3)));
    this.lean.step(dt);
    this.nod.step(dt);
    this.drop.step(dt);
    this.twist.step(dt);
    this.blade.step(dt);
  }

  /** Impact on this fighter: height 0 = legs .. 1 = head, strength 0..1, dir +1 = pushed backward. */
  hit(strength: number, height: number): void {
    const s = 0.35 + strength;
    if (height > 0.7) {
      this.nod.kick(260 * s);
      this.lean.kick(120 * s);
    } else if (height > 0.35) {
      this.lean.kick(-150 * s);
      this.nod.kick(-120 * s);
      this.drop.kick(1.2 * s);
    } else {
      this.drop.kick(2.2 * s);
      this.lean.kick(-60 * s);
    }
    this.blade.kick(400 * s);
  }

  block(strength: number): void {
    this.lean.kick(70 * (0.4 + strength));
    this.blade.kick(500 * (0.4 + strength));
    this.drop.kick(0.6 * (0.4 + strength));
  }

  land(speed: number): void {
    this.drop.kick(Math.min(4.5, speed * 0.55));
    this.lean.kick(-Math.min(160, speed * 22));
    this.nod.kick(-Math.min(120, speed * 16));
  }

  swing(strength: number): void {
    this.twist.kick(-160 * strength);
    this.lean.kick(-50 * strength);
  }

  /** Spin rate in degrees per frame drives the flare (fast in, slow settle). */
  spin(rate: number, dt: number): void {
    const target = Math.min(1, rate / 18);
    const k = target > this.flare ? 12 : 3;
    this.flare += (target - this.flare) * Math.min(1, dt * k);
  }

  apply(pose: Pose): void {
    pose.chest += this.lean.x;
    pose.spine += this.lean.x * 0.5;
    pose.head += this.nod.x;
    pose.hipY -= this.drop.x * 0.06;
    pose.twist += this.twist.x;
    pose.pitch += this.blade.x;
  }
}
