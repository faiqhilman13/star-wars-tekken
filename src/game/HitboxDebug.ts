import * as THREE from 'three';
import { PUSH_HALF_AIR, PUSH_HALF_GROUND, PUSH_HEIGHT } from '../sim/constants';
import { makeWorldBox } from '../sim/Fighter';
import type { Match } from '../sim/Match';
import type { WorldBox } from '../sim/types';

const MAX_BOXES = 16;

/** `?debug` overlay: hurtboxes (green), live hitboxes (red), push boxes (blue), Force waves (violet). */
export class HitboxDebug {
  private readonly positions = new Float32Array(MAX_BOXES * 8 * 3);
  private readonly colors = new Float32Array(MAX_BOXES * 8 * 3);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly lines: THREE.LineSegments;
  private readonly boxes: WorldBox[] = [makeWorldBox(), makeWorldBox(), makeWorldBox()];
  private readonly scratch = makeWorldBox();
  private count = 0;

  constructor(scene: THREE.Scene) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(this.geometry, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 99;
    scene.add(this.lines);
  }

  setVisible(visible: boolean): void {
    this.lines.visible = visible;
  }

  private push(box: WorldBox, r: number, g: number, b: number): void {
    if (this.count >= MAX_BOXES) return;
    const z = 0.6;
    const corners = [
      [box.minX, box.minY],
      [box.maxX, box.minY],
      [box.maxX, box.minY],
      [box.maxX, box.maxY],
      [box.maxX, box.maxY],
      [box.minX, box.maxY],
      [box.minX, box.maxY],
      [box.minX, box.minY],
    ];
    const o = this.count * 24;
    corners.forEach(([x, y], i) => {
      this.positions[o + i * 3] = x;
      this.positions[o + i * 3 + 1] = y;
      this.positions[o + i * 3 + 2] = z;
      this.colors[o + i * 3] = r;
      this.colors[o + i * 3 + 1] = g;
      this.colors[o + i * 3 + 2] = b;
    });
    this.count += 1;
  }

  update(match: Match): void {
    if (!this.lines.visible) return;
    this.count = 0;
    for (const f of match.fighters) {
      const n = f.hurtboxes(this.boxes);
      for (let i = 0; i < n; i += 1) this.push(this.boxes[i], 0.2, 1, 0.3);
      const half = f.grounded ? PUSH_HALF_GROUND : PUSH_HALF_AIR;
      this.push({ minX: f.x - half, maxX: f.x + half, minY: f.y, maxY: f.y + PUSH_HEIGHT }, 0.3, 0.5, 1);
      if (f.state === 'attack' && f.move) {
        f.move.hits.forEach((w, i) => {
          if (f.hitsDone[i] || f.stateFrame < w.from || f.stateFrame > w.to) return;
          this.push(f.toWorld(w.spec.box, this.scratch), 1, 0.15, 0.15);
        });
        const grab = f.move.grab;
        if (grab && f.stateFrame >= grab.from && f.stateFrame <= grab.to) this.push(f.toWorld(grab.box, this.scratch), 1, 0.6, 0.1);
      }
    }
    for (const p of match.projectiles) {
      this.push({ minX: p.x - p.spec.halfWidth, maxX: p.x + p.spec.halfWidth, minY: p.y - p.spec.halfHeight, maxY: p.y + p.spec.halfHeight }, 0.8, 0.4, 1);
    }
    this.positions.fill(0, this.count * 24);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }
}
