import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Static geometry batch: every part is baked into world space, given world-space
 * box-projected UVs (consistent texel density across all structures) and a
 * per-vertex tint, then merged into one BufferGeometry → one draw call.
 */

export type Tint = number | [number, number, number];

export interface PartOptions {
  /** 'box' = world-space box projection (default); 'keep' = keep the geometry's UVs scaled by uvScale. */
  uv?: 'box' | 'keep';
  /** Multiplier applied to kept UVs ([u, v]). */
  uvScale?: [number, number];
  /** Vertical contact darkening: vertices below y1 fade toward `min` at y0. */
  ao?: { y0: number; y1: number; min: number };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function tintRgb(t: Tint): [number, number, number] {
  if (Array.isArray(t)) return t;
  return [t, t, t];
}

export class GeoBatch {
  private readonly parts: THREE.BufferGeometry[] = [];

  /** @param tile world units covered by one texture repeat for box UVs. */
  constructor(private readonly tile: number) {}

  get size(): number {
    return this.parts.length;
  }

  add(source: THREE.BufferGeometry, matrix: THREE.Matrix4 | null, tint: Tint, opts: PartOptions = {}): void {
    let g = source.index ? source.toNonIndexed() : source.clone();
    if (matrix) g.applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const count = pos.count;

    // UVs
    if ((opts.uv ?? 'box') === 'box') {
      const uv = new Float32Array(count * 2);
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const n = new THREE.Vector3();
      for (let i = 0; i < count; i += 3) {
        a.fromBufferAttribute(pos, i);
        b.fromBufferAttribute(pos, i + 1);
        c.fromBufferAttribute(pos, i + 2);
        n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
        const ax = Math.abs(n.x);
        const ay = Math.abs(n.y);
        const az = Math.abs(n.z);
        for (let k = 0; k < 3; k++) {
          const v = k === 0 ? a : k === 1 ? b : c;
          let u = 0;
          let w = 0;
          if (ax >= ay && ax >= az) {
            u = -v.z * Math.sign(n.x || 1);
            w = v.y;
          } else if (ay >= az) {
            u = v.x;
            w = -v.z;
          } else {
            u = v.x * Math.sign(n.z || 1);
            w = v.y;
          }
          uv[(i + k) * 2] = u / this.tile;
          uv[(i + k) * 2 + 1] = w / this.tile;
        }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    } else {
      let uvAttr = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
      if (!uvAttr) {
        uvAttr = new THREE.BufferAttribute(new Float32Array(count * 2), 2);
        g.setAttribute('uv', uvAttr);
      }
      const [su, sv] = opts.uvScale ?? [1, 1];
      for (let i = 0; i < count; i++) uvAttr.setXY(i, uvAttr.getX(i) * su, uvAttr.getY(i) * sv);
    }

    // Vertex tint (+ optional vertical contact AO)
    const [r, gg, bb] = tintRgb(tint);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      let k = 1;
      if (opts.ao) {
        const y = pos.getY(i);
        const t = THREE.MathUtils.clamp((y - opts.ao.y0) / (opts.ao.y1 - opts.ao.y0), 0, 1);
        k = opts.ao.min + (1 - opts.ao.min) * t * t * (3 - 2 * t);
      }
      col[i * 3] = r * k;
      col[i * 3 + 1] = gg * k;
      col[i * 3 + 2] = bb * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
  }

  /** Axis-aligned box given centre and size, optional Euler rotation (radians). */
  box(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    tint: Tint,
    rot?: [number, number, number],
    opts?: PartOptions & { segY?: number },
  ): void {
    const geo = new THREE.BoxGeometry(1, 1, 1, 1, opts?.segY ?? 1, 1);
    _e.set(rot?.[0] ?? 0, rot?.[1] ?? 0, rot?.[2] ?? 0);
    _q.setFromEuler(_e);
    _m.compose(_p.set(cx, cy, cz), _q, _s.set(sx, sy, sz));
    this.add(geo, _m, tint, opts);
    geo.dispose();
  }

  /** Box from min/max corners. */
  boxMinMax(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tint: Tint, opts?: PartOptions & { segY?: number }): void {
    this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), tint, undefined, opts);
  }

  /** Cylinder along an axis. */
  cylinder(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    length: number,
    axis: 'x' | 'y' | 'z',
    tint: Tint,
    radial = 12,
    open = false,
    opts?: PartOptions,
  ): void {
    const geo = new THREE.CylinderGeometry(radius, radius, length, radial, 1, open);
    if (axis === 'x') geo.rotateZ(Math.PI / 2);
    else if (axis === 'z') geo.rotateX(Math.PI / 2);
    geo.translate(cx, cy, cz);
    this.add(geo, null, tint, opts);
    geo.dispose();
  }

  /** Vertical chamfered prism (footprint x0..x1, z0..z1, chamfer c) between y0 and y1. */
  prism(x0: number, x1: number, z0: number, z1: number, c: number, y0: number, y1: number, tint: Tint, opts?: PartOptions): void {
    const shape = new THREE.Shape();
    // shape space: (x, -z) so that rotateX(-90°) maps shape y → world z
    shape.moveTo(x0 + c, -z0);
    shape.lineTo(x1 - c, -z0);
    shape.lineTo(x1, -z0 - c);
    shape.lineTo(x1, -z1 + c);
    shape.lineTo(x1 - c, -z1);
    shape.lineTo(x0 + c, -z1);
    shape.lineTo(x0, -z1 + c);
    shape.lineTo(x0, -z0 - c);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, steps: 1 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, y0, 0);
    this.add(geo, null, tint, opts);
    geo.dispose();
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    if (!merged) throw new Error('Arena: geometry merge failed');
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}
