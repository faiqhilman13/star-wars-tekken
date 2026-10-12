import * as THREE from 'three';
import { WALL_X } from '../sim/constants';

const FOV = 32;
const MIN_HALF_WIDTH = 3.7;
const EDGE_MARGIN = 0.7;
const MIN_DIST = 7.2;
const MAX_DIST = 21;
const BASE_Y = 1.9;
const LOOK_Y = 1.25;

function pseudoNoise(t: number, seed: number): number {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Side-view fighting game camera: frames both fighters, dollies out as they separate,
 * never shows past the stage walls, plus trauma shake and dramatic focus for supers/KOs.
 */
export class CameraDirector {
  private x = 0;
  private dist = 10;
  private y = BASE_Y;
  private trauma = 0;
  private shakeTime = 0;
  private fovPunch = 0;
  private focus = 0;
  private focusX = 0;
  private focusY = 1.2;
  private focusDist = 6.5;
  private readonly look = new THREE.Vector3();
  shakeEnabled = true;

  constructor(readonly camera: THREE.PerspectiveCamera) {
    camera.fov = FOV;
    camera.near = 0.1;
    camera.far = 260;
    camera.updateProjectionMatrix();
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  punch(degrees: number): void {
    this.fovPunch = Math.min(6, this.fovPunch + degrees);
  }

  /** Blend toward a dramatic close-up (super freeze, KO). level 0..1. */
  setFocus(level: number, x: number, y: number, dist: number): void {
    this.focus = level;
    this.focusX = x;
    this.focusY = y;
    this.focusDist = dist;
  }

  private target(x0: number, x1: number, maxY: number): { x: number; dist: number; y: number } {
    const aspect = Math.max(0.5, this.camera.aspect);
    const tanHalfV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const tanHalfH = tanHalfV * aspect;
    const sep = Math.abs(x1 - x0);
    const minHalf = aspect < 1.4 ? 2.9 + (aspect - 0.8) * 1.5 : MIN_HALF_WIDTH;
    const halfWidth = Math.max(Math.min(MIN_HALF_WIDTH, minHalf), sep / 2 + 1.6);
    let dist = THREE.MathUtils.clamp(halfWidth / tanHalfH, MIN_DIST, MAX_DIST);
    // Keep jumps in frame vertically on narrow screens.
    const needUp = Math.max(0, maxY + 2.1 - LOOK_Y);
    dist = Math.max(dist, Math.min(MAX_DIST, needUp / tanHalfV));
    const visibleHalf = dist * tanHalfH;
    const limit = Math.max(0, WALL_X + EDGE_MARGIN - visibleHalf);
    const x = THREE.MathUtils.clamp((x0 + x1) / 2, -limit, limit);
    const y = BASE_Y + Math.max(0, maxY - 0.8) * 0.25;
    return { x, dist, y };
  }

  snap(x0: number, x1: number): void {
    const t = this.target(x0, x1, 0);
    this.x = t.x;
    this.dist = t.dist;
    this.y = t.y;
    this.trauma = 0;
    this.fovPunch = 0;
    this.apply(0);
  }

  update(dt: number, x0: number, x1: number, maxY: number): void {
    const t = this.target(x0, x1, maxY);
    const k = 1 - Math.exp(-dt * 5.5);
    this.x += (t.x - this.x) * k;
    this.dist += (t.dist - this.dist) * (1 - Math.exp(-dt * 3.5));
    this.y += (t.y - this.y) * k;
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    this.fovPunch *= Math.exp(-dt / 0.18);
    this.shakeTime += dt;
    this.apply(dt);
  }

  private apply(dt: number): void {
    void dt;
    const f = this.focus * this.focus * (3 - 2 * this.focus);
    const x = this.x + (this.focusX - this.x) * f;
    const dist = this.dist + (this.focusDist - this.dist) * f;
    const y = this.y + (this.focusY + 0.5 - this.y) * f;
    const lookY = LOOK_Y + (this.focusY - LOOK_Y) * f;
    this.camera.position.set(x, y, dist);
    this.look.set(x, lookY, 0);
    this.camera.lookAt(this.look);
    if (this.shakeEnabled && this.trauma > 0) {
      const s = this.trauma * this.trauma;
      const freq = this.shakeTime * 34;
      this.camera.position.x += 0.32 * s * pseudoNoise(freq, 1);
      this.camera.position.y += 0.24 * s * pseudoNoise(freq, 2);
      this.camera.rotation.z += 0.035 * s * pseudoNoise(freq, 3);
    }
    const fov = FOV + this.fovPunch;
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  get halfVisibleWidth(): number {
    return this.dist * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * this.camera.aspect;
  }
}
