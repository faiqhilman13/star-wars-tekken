import * as THREE from 'three';
import {
  ANKLE,
  CHEST_TO_NECK,
  CHEST_TO_SHOULDER,
  FIST,
  FOREARM,
  HIP_TO_SPINE,
  HIP_Z,
  NECK_TO_HEAD,
  SHIN,
  SHOULDER_Z,
  SPINE_TO_CHEST,
  THIGH,
  UPPER_ARM,
} from './dims';
import type { Joints } from './FighterRig';

/**
 * Smooth-skinned fighter bodies.
 *
 * Every body and costume part is modelled in the rig's rest (bind) pose — all joint rotations identity,
 * arms and legs hanging straight down, feet flat on the floor — directly in rig-root space. Each vertex
 * gets bone weights from its position along the bones (smooth blend zones around elbows, knees, waist,
 * neck), then all parts are merged per material into a few SkinnedMeshes that share one Skeleton whose
 * bones are the rig's joints.
 */

type V3 = THREE.Vector3;

// ---------------------------------------------------------------------------------------------- bind pose

/** Hip height in the rest pose (feet flat on the floor at y = 0). */
export const REST_HIP = ANKLE + SHIN + THIGH + 0.04;
const H = REST_HIP;
const CHEST = H + HIP_TO_SPINE + SPINE_TO_CHEST;
const NECK = CHEST + CHEST_TO_NECK;
const SHOULDER = CHEST + CHEST_TO_SHOULDER;
const THIGH_Y = H - 0.04;

/** Rest-pose joint heights (rig-root space). */
export const BIND = {
  hip: H,
  spine: H + HIP_TO_SPINE,
  chest: CHEST,
  neck: NECK,
  head: NECK + NECK_TO_HEAD,
  shoulder: SHOULDER,
  shoulderZ: SHOULDER_Z,
  elbow: SHOULDER - UPPER_ARM,
  wrist: SHOULDER - UPPER_ARM - FOREARM,
  grip: SHOULDER - UPPER_ARM - FOREARM - FIST,
  thigh: THIGH_Y,
  hipZ: HIP_Z,
  knee: THIGH_Y - THIGH,
  ankle: THIGH_Y - THIGH - SHIN,
} as const;

// ---------------------------------------------------------------------------------------------- math

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function smooth(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
const sgnPow = (v: number, e: number): number => Math.sign(v) * Math.abs(v) ** e;

/** Scale a colour's brightness (k < 1 darker). */
export function shade(c: THREE.ColorRepresentation, k: number): THREE.Color {
  return new THREE.Color(c).multiplyScalar(k);
}

export function mixColor(a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, t: number): THREE.Color {
  return new THREE.Color(a).lerp(new THREE.Color(b), clamp01(t));
}

/** Uniform Catmull-Rom across rows of numbers (index 0 is interpolated linearly to keep rings ordered). */
function sampleRows(rows: number[][], s: number, out: number[]): void {
  const n = rows.length;
  const i = Math.min(n - 2, Math.max(0, Math.floor(s)));
  const t = Math.min(1, Math.max(0, s - i));
  const p0 = rows[Math.max(0, i - 1)];
  const p1 = rows[i];
  const p2 = rows[i + 1];
  const p3 = rows[Math.min(n - 1, i + 2)];
  const t2 = t * t;
  const t3 = t2 * t;
  for (let k = 0; k < p1.length; k += 1) {
    if (k === 0) {
      out[k] = p1[k] + (p2[k] - p1[k]) * t;
      continue;
    }
    out[k] =
      0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
  }
}

// ---------------------------------------------------------------------------------------------- primitives

export type ColorSpec = THREE.ColorRepresentation | ((p: V3, u: number, v: number) => THREE.ColorRepresentation);

const tmpColor = new THREE.Color();
function colorAt(spec: ColorSpec, p: V3, u: number, v: number): THREE.Color {
  return tmpColor.set(typeof spec === 'function' ? spec(p, u, v) : spec);
}

/** Make a closed surface's normals face outward (flips winding when they don't). */
function orientOutward(g: THREE.BufferGeometry): void {
  g.computeBoundingBox();
  const c = (g.boundingBox as THREE.Box3).getCenter(new THREE.Vector3());
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  let s = 0;
  for (let i = 0; i < pos.count; i += 1) {
    s += (pos.getX(i) - c.x) * nor.getX(i) + (pos.getY(i) - c.y) * nor.getY(i) + (pos.getZ(i) - c.z) * nor.getZ(i);
  }
  if (s >= 0) return;
  flipWinding(g);
  g.computeVertexNormals();
}

function flipWinding(g: THREE.BufferGeometry): void {
  if (!g.index) g.setIndex([...Array(g.getAttribute('position').count).keys()]);
  const idx = g.index as THREE.BufferAttribute;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  idx.needsUpdate = true;
}

/**
 * Parametric grid surface. u wraps when `closed` (nu columns) else spans [0, 1] (nu + 1 columns);
 * v spans [0, 1] over nv bands. Optional pole caps close the first/last rows.
 */
export function surface(
  nu: number,
  nv: number,
  closed: boolean,
  at: (u: number, v: number, out: V3) => void,
  color: ColorSpec,
  capStart: boolean | V3 = false,
  capEnd: boolean | V3 = false,
): THREE.BufferGeometry {
  const cols = closed ? nu : nu + 1;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (let r = 0; r <= nv; r += 1) {
    for (let k = 0; k < cols; k += 1) {
      const u = k / nu;
      const v = r / nv;
      at(u, v, p);
      pos.push(p.x, p.y, p.z);
      const c = colorAt(color, p, u, v);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let r = 0; r < nv; r += 1) {
    for (let k = 0; k < nu; k += 1) {
      const a = r * cols + k;
      const b = r * cols + (closed ? (k + 1) % cols : k + 1);
      idx.push(a, a + cols, b, b, a + cols, b + cols);
    }
  }
  const cap = (row: number, spec: boolean | V3, end: boolean) => {
    if (spec === false) return;
    const pole = new THREE.Vector3();
    if (spec === true) {
      for (let k = 0; k < cols; k += 1) pole.add(new THREE.Vector3(pos[(row * cols + k) * 3], pos[(row * cols + k) * 3 + 1], pos[(row * cols + k) * 3 + 2]));
      pole.divideScalar(cols);
    } else pole.copy(spec);
    const pi = pos.length / 3;
    pos.push(pole.x, pole.y, pole.z);
    const c = colorAt(color, pole, 0, end ? 1 : 0);
    col.push(c.r, c.g, c.b);
    for (let k = 0; k < nu; k += 1) {
      const a = row * cols + k;
      const b = row * cols + (closed ? (k + 1) % cols : k + 1);
      if (end) idx.push(pi, b, a);
      else idx.push(pi, a, b);
    }
  };
  cap(0, capStart, false);
  cap(nv, capEnd, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (closed && (capStart !== false || capEnd !== false)) orientOutward(g);
  return g;
}

/** Cross-section of a loft: a super-ellipse with separate front/back depth and exponents. */
export interface Sec {
  y: number;
  ox?: number;
  oz?: number;
  /** Half depth toward +x (front) and -x (back). */
  xf: number;
  xb?: number;
  /** Half width along z. */
  zw: number;
  /** Super-ellipse exponents for the front and back halves (2 = ellipse, > 2 boxier, < 2 pointier). */
  nf?: number;
  nb?: number;
}

const SEC_LEN = 8;
function secRow(s: Sec): number[] {
  return [s.y, s.ox ?? 0, s.oz ?? 0, s.xf, s.xb ?? s.xf, s.zw, s.nf ?? 2, s.nb ?? s.nf ?? 2];
}

/** Point on an interpolated loft ring (row = [y, ox, oz, xf, xb, zw, nf, nb]). */
function ringPoint(r: number[], theta: number, out: V3): V3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const front = c >= 0;
  const n = Math.max(0.6, front ? r[6] : r[7]);
  const e = 2 / n;
  return out.set(r[1] + Math.max(1e-4, front ? r[3] : r[4]) * sgnPow(c, e), r[0], r[2] + Math.max(1e-4, r[5]) * sgnPow(s, e));
}

/** Smooth lofted solid along y through super-ellipse sections (Catmull-Rom between sections). */
export function loft(secs: Sec[], radial: number, perSpan: number, color: ColorSpec, caps: [boolean, boolean] = [true, true]): THREE.BufferGeometry {
  const rows = secs.map(secRow);
  const nv = (secs.length - 1) * perSpan;
  const r: number[] = new Array(SEC_LEN).fill(0);
  return surface(
    radial,
    nv,
    true,
    (u, v, out) => {
      sampleRows(rows, v * (secs.length - 1), r);
      ringPoint(r, u * Math.PI * 2, out);
    },
    color,
    caps[0],
    caps[1],
  );
}

/** Round tube along y from simple [y, r, ox?, ez?] rows (ez squashes z). */
export function tube(rows: number[][], radial: number, perSpan: number, color: ColorSpec, caps: [boolean, boolean] = [true, true]): THREE.BufferGeometry {
  return loft(
    rows.map(([y, r, ox = 0, ez = 1]) => ({ y, ox, xf: r, xb: r, zw: r * ez })),
    radial,
    perSpan,
    color,
    caps,
  );
}

/** Tube swept through control points (Catmull-Rom), radius per t; `flat` squashes the binormal axis. */
export function sweep(
  points: V3[],
  radius: (t: number) => number,
  radial: number,
  samples: number,
  color: ColorSpec,
  opts: { up?: V3; upAt?: (p: V3) => V3; flat?: number; caps?: boolean; closedCurve?: boolean; onVertex?: (t: number, u: number) => void } = {},
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, opts.closedCurve ?? false, 'centripetal');
  const up = opts.up ?? new THREE.Vector3(0, 0, 1);
  const flat = opts.flat ?? 1;
  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  const closedCurve = opts.closedCurve ?? false;
  const g = surface(
    radial,
    samples,
    true,
    (u, v, out) => {
      const t = closedCurve ? v % 1 : v;
      curve.getPointAt(t, P);
      curve.getTangentAt(t, T);
      const upv = opts.upAt ? opts.upAt(P) : up;
      N.copy(upv).addScaledVector(T, -upv.dot(T));
      if (N.lengthSq() < 1e-6) N.set(1, 0, 0).addScaledVector(T, -T.x);
      N.normalize();
      B.crossVectors(T, N).normalize();
      const a = u * Math.PI * 2;
      const rr = radius(t);
      out.copy(P).addScaledVector(N, Math.cos(a) * rr).addScaledVector(B, Math.sin(a) * rr * flat);
      opts.onVertex?.(t, u);
    },
    color,
    opts.caps ?? !closedCurve,
    opts.caps ?? !closedCurve,
  );
  return g;
}

/** Tapered capsule between two points. */
export function capsule(a: V3, b: V3, ra: number, rb: number, color: ColorSpec, radial = 8, capRings = 3): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const prof: Array<[number, number]> = [];
  for (let i = 1; i <= capRings; i += 1) {
    const ph = (Math.PI / 2) * (i / capRings);
    prof.push([ra * Math.sin(ph), -ra * Math.cos(ph)]);
  }
  for (let i = 0; i < capRings; i += 1) {
    const ph = (Math.PI / 2) * (i / capRings);
    prof.push([rb * Math.cos(ph), len + rb * Math.sin(ph)]);
  }
  const g = surface(
    radial,
    prof.length - 1,
    true,
    (u, v, out) => {
      const [r, y] = prof[Math.round(v * (prof.length - 1))];
      const t = u * Math.PI * 2;
      out.set(Math.cos(t) * r, y, Math.sin(t) * r);
    },
    color,
    new THREE.Vector3(0, -ra, 0),
    new THREE.Vector3(0, len + rb, 0),
  );
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate(a.x, a.y, a.z);
  return g;
}

export function ellipsoid(c: V3 | [number, number, number], r: [number, number, number], color: ColorSpec, seg = 12): THREE.BufferGeometry {
  const center = Array.isArray(c) ? new THREE.Vector3(...c) : c;
  const rings = Math.max(6, Math.round(seg * 0.7));
  return surface(
    seg,
    rings,
    true,
    (u, v, out) => {
      const th = u * Math.PI * 2;
      const ph = 0.0001 + v * (Math.PI - 0.0002);
      const s = Math.sin(ph);
      out.set(center.x + Math.cos(th) * s * r[0], center.y + Math.cos(ph) * r[1], center.z + Math.sin(th) * s * r[2]);
    },
    color,
    new THREE.Vector3(center.x, center.y + r[1], center.z),
    new THREE.Vector3(center.x, center.y - r[1], center.z),
  );
}

/**
 * Curved armour plate: a patch of an ellipsoid shell with thickness (pauldrons, knee cops, guards).
 * theta goes around y from +x (front) toward +z; phi from +y (top) downward; angles in degrees.
 */
export function plate(
  c: V3 | [number, number, number],
  r: [number, number, number],
  theta: [number, number],
  phi: [number, number],
  thick: number,
  color: ColorSpec,
  nTheta = 12,
  nPhi = 6,
): THREE.BufferGeometry {
  const center = Array.isArray(c) ? new THREE.Vector3(...c) : c;
  const D = Math.PI / 180;
  const ravg = (r[0] + r[1] + r[2]) / 3;
  const inner = 1 - thick / ravg;
  // u runs around the plate's cross-section (outer phi0->phi1, then inner phi1->phi0); v runs along theta.
  const ring = nPhi * 2 + 2;
  const g = surface(
    ring,
    nTheta,
    true,
    (u, v, out) => {
      const k = Math.round(u * ring) % ring;
      const outer = k <= nPhi;
      const pk = outer ? k : ring - 1 - k;
      const ph = (phi[0] + ((phi[1] - phi[0]) * pk) / nPhi) * D;
      const th = (theta[0] + (theta[1] - theta[0]) * v) * D;
      const s = outer ? 1 : inner;
      out.set(center.x + r[0] * Math.sin(ph) * Math.cos(th) * s, center.y + r[1] * Math.cos(ph) * s, center.z + r[2] * Math.sin(ph) * Math.sin(th) * s);
    },
    color,
    true,
    true,
  );
  // Orientation: the outer face must point away from the ellipsoid centre.
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const i = Math.round(nPhi / 2);
  const dx = pos.getX(i) - center.x;
  const dy = pos.getY(i) - center.y;
  const dz = pos.getZ(i) - center.z;
  if (dx * nor.getX(i) + dy * nor.getY(i) + dz * nor.getZ(i) < 0) {
    flipWinding(g);
    g.computeVertexNormals();
  }
  return g;
}

/** Rotate a geometry about an axis through a pivot (degrees). */
export function turn(g: THREE.BufferGeometry, axis: 'x' | 'y' | 'z', deg: number, pivot?: V3 | [number, number, number]): THREE.BufferGeometry {
  const p = pivot ? (Array.isArray(pivot) ? new THREE.Vector3(...pivot) : pivot) : new THREE.Vector3();
  g.translate(-p.x, -p.y, -p.z);
  const r = THREE.MathUtils.degToRad(deg);
  if (axis === 'x') g.rotateX(r);
  else if (axis === 'y') g.rotateY(r);
  else g.rotateZ(r);
  g.translate(p.x, p.y, p.z);
  return g;
}

/** Mirror a geometry across a coordinate plane (keeps triangles front-facing). */
export function mirror(g: THREE.BufferGeometry, axis: 'x' | 'y' | 'z'): THREE.BufferGeometry {
  const m = g.clone();
  m.applyMatrix4(new THREE.Matrix4().makeScale(axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1, axis === 'z' ? -1 : 1));
  flipWinding(m);
  return m;
}

/** Give a geometry a flat vertex colour (any existing colours are replaced). */
export function tint(g: THREE.BufferGeometry, color: ColorSpec): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    p.fromBufferAttribute(pos, i);
    const c = colorAt(color, p, 0, 0);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/**
 * Pull vertices toward `center` where keep(p) < 1 (tucks the unwanted parts of a shell under the
 * surface it wraps: hair caps, beards, cowls).
 */
export function shrinkWrap(g: THREE.BufferGeometry, center: V3, keep: (p: V3) => number, inner = 0.82): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    p.fromBufferAttribute(pos, i);
    const k = clamp01(keep(p));
    const s = inner + (1 - inner) * k;
    p.sub(center).multiplyScalar(s).add(center);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Displace vertices with a function (then recompute normals). */
export function deform(g: THREE.BufferGeometry, fn: (p: V3) => void): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    p.fromBufferAttribute(pos, i);
    fn(p);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------- skin builder

export type Layer = 'solid' | 'double' | 'metal';
export type Weights = Array<[THREE.Bone, number]>;
export type WeightFn = (p: V3) => Weights;

/**
 * Toon role of a part (procedural bodies): picks the shade colour, terminator and highlight. 'feature' =
 * small face features (no outline, always lit), 'detail' = straps, bands and pouches (thin inner lines).
 */
export type ToonRole = 'skin' | 'face' | 'hair' | 'cloth' | 'leather' | 'metal' | 'feature' | 'detail';

export interface PartOptions {
  role?: ToonRole;
  /** Outline width mask override (0..1). */
  outline?: number;
}

/** Per-vertex toon values: [shift, toony, matcap, face], shade multiplier, outline mask. */
export type ToonClassifier = (color: THREE.Color, layer: Layer, opts: PartOptions) => { toon: [number, number, number, number]; shade: [number, number, number]; outline: number };

interface LayerData {
  pos: number[];
  nor: number[];
  col: number[];
  si: number[];
  sw: number[];
  idx: number[];
  toon: number[];
  shade: number[];
  outline: number[];
}

/** Collects bind-space parts with per-vertex bone weights (and toon attributes) per material layer. */
export class SkinBuilder {
  readonly bones: THREE.Bone[] = [];
  private readonly boneIndex = new Map<THREE.Bone, number>();
  private readonly layers = new Map<Layer, LayerData>();

  constructor(private readonly classify?: ToonClassifier) {}

  private index(b: THREE.Bone): number {
    let i = this.boneIndex.get(b);
    if (i === undefined) {
      i = this.bones.length;
      this.bones.push(b);
      this.boneIndex.set(b, i);
    }
    return i;
  }

  /** Register bones that must be in the skeleton even when nothing is weighted to them. */
  use(...bones: THREE.Bone[]): void {
    for (const b of bones) this.index(b);
  }

  /** Add a bind-space part. weight: a function of position, one bone, or per-vertex weights. */
  add(layer: Layer, g: THREE.BufferGeometry, weight: WeightFn | THREE.Bone | Weights[], opts: PartOptions = {}): void {
    let L = this.layers.get(layer);
    if (!L) {
      L = { pos: [], nor: [], col: [], si: [], sw: [], idx: [], toon: [], shade: [], outline: [] };
      this.layers.set(layer, L);
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const col = g.getAttribute('color');
    const base = L.pos.length / 3;
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    const fixed: Weights | null = typeof weight === 'function' || Array.isArray(weight) ? null : [[weight, 1]];
    const acc = new Map<THREE.Bone, number>();
    for (let i = 0; i < pos.count; i += 1) {
      p.fromBufferAttribute(pos, i);
      L.pos.push(p.x, p.y, p.z);
      L.nor.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      if (col) c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
      else c.setRGB(0.5, 0.5, 0.5);
      L.col.push(c.r, c.g, c.b);
      if (this.classify) {
        const t = this.classify(c, layer, opts);
        L.toon.push(...t.toon);
        L.shade.push(...t.shade);
        L.outline.push(t.outline);
      }
      const ws = fixed ?? (Array.isArray(weight) ? weight[Math.min(i, weight.length - 1)] : (weight as WeightFn)(p));
      acc.clear();
      for (const [b, w] of ws) if (w > 1e-4) acc.set(b, (acc.get(b) ?? 0) + w);
      const list = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
      const sum = list.reduce((s, [, w]) => s + w, 0) || 1;
      for (let k = 0; k < 4; k += 1) {
        const e = list[k];
        L.si.push(e ? this.index(e[0]) : 0);
        L.sw.push(e ? e[1] / sum : 0);
      }
    }
    if (g.index) for (let i = 0; i < g.index.count; i += 1) L.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < pos.count; i += 1) L.idx.push(base + i);
    g.dispose();
  }

  triangles(layer?: Layer): number {
    let n = 0;
    for (const [k, L] of this.layers) if (!layer || k === layer) n += L.idx.length / 3;
    return n;
  }

  build(layer: Layer): THREE.BufferGeometry | null {
    const L = this.layers.get(layer);
    if (!L || L.idx.length === 0) return null;
    return this.geometry([L]);
  }

  /** Every layer in one geometry (one toon draw + one outline hull per fighter). */
  buildMerged(): THREE.BufferGeometry | null {
    const list = [...this.layers.values()].filter((L) => L.idx.length > 0);
    return list.length ? this.geometry(list) : null;
  }

  private geometry(list: LayerData[]): THREE.BufferGeometry {
    const cat = (k: keyof LayerData) => list.flatMap((L) => L[k]);
    const idx: number[] = [];
    let base = 0;
    for (const L of list) {
      for (const i of L.idx) idx.push(base + i);
      base += L.pos.length / 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(cat('pos'), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(cat('nor'), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cat('col'), 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(cat('si'), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(cat('sw'), 4));
    if (this.classify) {
      g.setAttribute('toon', new THREE.Float32BufferAttribute(cat('toon'), 4));
      g.setAttribute('shade', new THREE.Float32BufferAttribute(cat('shade'), 3));
      g.setAttribute('outline', new THREE.Float32BufferAttribute(cat('outline'), 1));
    }
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------------------------------------- weights

export interface RigWeights {
  torso: WeightFn;
  neck: WeightFn;
  head: WeightFn;
  arm: (far: boolean) => WeightFn;
  leg: (far: boolean) => WeightFn;
  hand: (far: boolean) => THREE.Bone;
  foot: (far: boolean) => THREE.Bone;
  /** Shoulder pieces (pauldrons, mantle edges): chest blended toward the upper arm. */
  shoulder: (far: boolean, armShare: number) => WeightFn;
}

export function rigWeights(j: Joints): RigWeights {
  const torso: WeightFn = (p) => {
    const t1 = smooth(H + 0.03, H + 0.17, p.y);
    const t2 = smooth(H + 0.27, H + 0.45, p.y);
    const t3 = smooth(NECK - 0.05, NECK + 0.03, p.y);
    return [
      [j.hips, 1 - t1],
      [j.spine, t1 * (1 - t2)],
      [j.chest, t2 * (1 - t3)],
      [j.neck, t3],
    ];
  };
  const neck: WeightFn = (p) => {
    const t1 = smooth(NECK - 0.05, NECK + 0.02, p.y);
    const t2 = smooth(NECK + 0.05, NECK + 0.12, p.y);
    return [
      [j.chest, 1 - t1],
      [j.neck, t1 * (1 - t2)],
      [j.head, t2],
    ];
  };
  const arm = (far: boolean): WeightFn => {
    const [up, fo, ha] = far ? [j.upperF, j.foreF, j.handF] : [j.upperN, j.foreN, j.handN];
    return (p) => {
      const t = smooth(BIND.elbow + 0.05, BIND.elbow - 0.05, p.y);
      const tw = smooth(BIND.wrist + 0.012, BIND.wrist - 0.03, p.y) * 0.6;
      return [
        [up, 1 - t],
        [fo, t * (1 - tw)],
        [ha, t * tw],
      ];
    };
  };
  const leg = (far: boolean): WeightFn => {
    const [th, sh, fo] = far ? [j.thighF, j.shinF, j.footF] : [j.thighN, j.shinN, j.footN];
    return (p) => {
      const t = smooth(BIND.knee + 0.05, BIND.knee - 0.05, p.y);
      const ta = smooth(BIND.ankle + 0.06, BIND.ankle - 0.02, p.y) * 0.5;
      return [
        [th, 1 - t],
        [sh, t * (1 - ta)],
        [fo, t * ta],
      ];
    };
  };
  const shoulder = (far: boolean, share: number): WeightFn => {
    const up = far ? j.upperF : j.upperN;
    return (p) => {
      const zOut = Math.abs(p.z);
      const t = smooth(SHOULDER_Z - 0.07, SHOULDER_Z + 0.02, zOut) * share;
      return [
        [j.chest, 1 - t],
        [up, t],
      ];
    };
  };
  return {
    torso,
    neck,
    head: () => [[j.head, 1]],
    arm,
    leg,
    hand: (far) => (far ? j.handF : j.handN),
    foot: (far) => (far ? j.footF : j.footN),
    shoulder,
  };
}

// ---------------------------------------------------------------------------------------------- body spec

/** Anatomy per fighter. Torso rows: [y above hips, ox, xf, xb, zw, nf, nb]. */
export interface BodySpec {
  torso: number[][];
  /** Arm rows: [y below the shoulder joint (negative), r, ez]. */
  arm: number[][];
  /** Leg rows: [y below the hip joint (negative), r, ox, ez]. */
  leg: number[][];
  neck: [number, number];
  /** Hand and foot size multipliers. */
  hand: number;
  foot: number;
}

export const ATHLETIC: BodySpec = {
  torso: [
    [-0.118, 0.0, 0.03, 0.03, 0.035, 2, 2],
    [-0.095, 0.0, 0.07, 0.075, 0.09, 2, 2],
    [-0.055, 0.0, 0.097, 0.108, 0.142, 2.3, 2.2],
    [0.0, 0.0, 0.104, 0.112, 0.16, 2.4, 2.3],
    [0.05, 0.004, 0.102, 0.104, 0.156, 2.4, 2.4],
    [0.11, 0.01, 0.096, 0.095, 0.141, 2.4, 2.4],
    [0.18, 0.013, 0.103, 0.096, 0.147, 2.4, 2.4],
    [0.26, 0.017, 0.115, 0.1, 0.158, 2.5, 2.4],
    [0.34, 0.021, 0.126, 0.105, 0.17, 2.6, 2.4],
    [0.42, 0.022, 0.131, 0.108, 0.176, 2.7, 2.4],
    [0.49, 0.013, 0.12, 0.108, 0.175, 2.6, 2.4],
    [0.545, 0.0, 0.097, 0.1, 0.168, 2.6, 2.5],
    [0.585, -0.008, 0.072, 0.082, 0.14, 2.4, 2.3],
    [0.612, -0.012, 0.05, 0.056, 0.085, 2, 2],
    [0.625, -0.012, 0.02, 0.022, 0.03, 2, 2],
  ],
  arm: [
    [0.048, 0.022, 1],
    [0.042, 0.042, 1],
    [0.026, 0.058, 1],
    [0.0, 0.065, 1],
    [-0.04, 0.062, 0.95],
    [-0.09, 0.053, 0.92],
    [-0.15, 0.05, 0.9],
    [-0.21, 0.046, 0.9],
    [-0.255, 0.04, 0.92],
    [-0.29, 0.038, 0.95],
    [-0.325, 0.041, 0.92],
    [-0.37, 0.044, 0.88],
    [-0.43, 0.039, 0.86],
    [-0.49, 0.032, 0.86],
    [-0.54, 0.028, 0.88],
    [-0.565, 0.023, 0.9],
    [-0.578, 0.012, 1],
  ],
  leg: [
    [0.078, 0.03, 0, 1],
    [0.064, 0.062, 0, 1],
    [0.036, 0.088, 0, 1],
    [0.0, 0.097, 0.0, 0.96],
    [-0.06, 0.094, 0.005, 0.92],
    [-0.15, 0.086, 0.008, 0.9],
    [-0.25, 0.076, 0.007, 0.9],
    [-0.35, 0.066, 0.005, 0.92],
    [-0.42, 0.058, 0.004, 0.95],
    [-0.46, 0.056, 0.006, 0.96],
    [-0.51, 0.055, 0.0, 0.95],
    [-0.57, 0.06, -0.012, 0.9],
    [-0.64, 0.058, -0.012, 0.9],
    [-0.72, 0.05, -0.008, 0.9],
    [-0.8, 0.042, -0.004, 0.92],
    [-0.87, 0.037, 0, 0.95],
    [-0.92, 0.035, 0, 1],
    [-0.955, 0.018, 0, 1],
  ],
  neck: [0.058, 0.048],
  hand: 1,
  foot: 1,
};

/** Scale a spec's widths (bulk) and optionally override parts. */
export function bodySpec(base: BodySpec, bulk: number, limbBulk = bulk): BodySpec {
  return {
    // The shoulder joints don't move with bulk, so the shoulder line keeps reaching the deltoids.
    torso: base.torso.map(([y, ox, xf, xb, zw, nf, nb]) => [y, ox * bulk, xf * bulk, xb * bulk, y >= 0.5 && y < 0.6 ? Math.max(zw * bulk, zw * 0.94) : zw * bulk, nf, nb]),
    arm: base.arm.map(([y, r, ez]) => [y, r * limbBulk, ez]),
    leg: base.leg.map(([y, r, ox, ez]) => [y, r * limbBulk, ox * limbBulk, ez]),
    neck: [base.neck[0] * bulk, base.neck[1] * bulk],
    hand: base.hand,
    foot: base.foot,
  };
}

// ---------------------------------------------------------------------------------------------- body parts

export interface BodyPaint {
  /** Torso colour from a bind-space point (y relative to the hips). */
  torso: (p: V3, yRel: number) => THREE.ColorRepresentation;
  /** Arm colour by distance below the shoulder joint (negative y). */
  arm: (yRel: number, p: V3) => THREE.ColorRepresentation;
  /** Leg colour by distance below the hip joint (negative y). */
  leg: (yRel: number, p: V3) => THREE.ColorRepresentation;
  neck: THREE.ColorRepresentation | ((yRel: number) => THREE.ColorRepresentation);
}

export function torsoGeo(spec: BodySpec, paint: BodyPaint['torso'], radial = 28, perSpan = 3): THREE.BufferGeometry {
  return loft(torsoSecs(spec), radial, perSpan, (p) => paint(p, p.y - H));
}

export function neckGeo(spec: BodySpec, color: BodyPaint['neck']): THREE.BufferGeometry {
  const [r0, r1] = spec.neck;
  const rows = [
    [NECK + 0.135, r1 * 0.5, 0.012],
    [NECK + 0.12, r1 * 0.95, 0.012],
    [NECK + 0.07, r1, 0.008],
    [NECK + 0.0, (r0 + r1) / 2, 0.0],
    [NECK - 0.045, r0, -0.006],
    [NECK - 0.075, r0 * 1.05, -0.01],
    [NECK - 0.09, r0 * 0.6, -0.01],
  ];
  return loft(
    rows.map(([y, r, ox]) => ({ y, ox, xf: r, xb: r * 1.02, zw: r * 1.04 })),
    16,
    2,
    typeof color === 'function' ? (p) => color(p.y - NECK) : color,
  );
}

/** Near-side arm (z = +SHOULDER_Z) in bind space; mirror(…, 'z') for the far arm. */
export function armGeo(spec: BodySpec, paint: BodyPaint['arm'], radial = 18, perSpan = 3): THREE.BufferGeometry {
  const g = tube(
    spec.arm.map(([y, r, ez]) => [SHOULDER + y, r, 0, ez]),
    radial,
    perSpan,
    (p) => paint(p.y - SHOULDER, p),
  );
  g.translate(0, 0, SHOULDER_Z);
  return g;
}

/** Near-side leg (z = +HIP_Z) in bind space. */
export function legGeo(spec: BodySpec, paint: BodyPaint['leg'], radial = 20, perSpan = 3, extra?: (yRel: number) => number): THREE.BufferGeometry {
  const g = tube(
    spec.leg.map(([y, r, ox, ez]) => [THIGH_Y + y, r + (extra ? extra(y) : 0), ox, ez]),
    radial,
    perSpan,
    (p) => paint(p.y - THIGH_Y, p),
  );
  g.translate(0, 0, HIP_Z);
  return g;
}

/** Joint fillers (elbow/knee): rotation-invariant spheres at the pivots that fill LBS volume loss. */
export function jointBall(y: number, z: number, r: number, color: ColorSpec, ox = 0): THREE.BufferGeometry {
  return ellipsoid([ox, y, z], [r, r, r], color, 12);
}

// ---------------------------------------------------------------------------------------------- hands

/**
 * Gripping fist in hand-local space: wrist at the origin, the hilt passes along z through (0, -FIST, 0),
 * back of the hand toward -x (near hand; mirror x for the far hand), fingers wrap toward +x.
 */
export function fistGeo(color: ColorSpec, size = 1, cuff?: THREE.ColorRepresentation): THREE.BufferGeometry[] {
  const s = size;
  const gy = -FIST;
  const zc = -0.012;
  const parts: THREE.BufferGeometry[] = [];
  // Wrist bridge (rotation-invariant around the wrist pivot).
  parts.push(ellipsoid([0, 0.002, 0], [0.029 * s, 0.03 * s, 0.033 * s], cuff ?? color, 10));
  // Back of the hand / metacarpals: a rounded slab behind the hilt.
  parts.push(
    loft(
      [
        { y: -0.004, ox: -0.018 * s, xf: 0.016 * s, xb: 0.014 * s, zw: 0.03 * s, oz: zc * 0.3 },
        { y: -0.03 * s, ox: -0.022 * s, xf: 0.017 * s, xb: 0.014 * s, zw: 0.038 * s, nf: 2.6, nb: 3, oz: zc },
        { y: -0.058 * s, ox: -0.024 * s, xf: 0.016 * s, xb: 0.013 * s, zw: 0.042 * s, nf: 2.6, nb: 3, oz: zc },
        { y: -0.076 * s, ox: -0.02 * s, xf: 0.012 * s, xb: 0.011 * s, zw: 0.04 * s, nf: 2.4, nb: 3, oz: zc },
        { y: -0.083 * s, ox: -0.018 * s, xf: 0.006 * s, xb: 0.006 * s, zw: 0.03 * s, oz: zc },
      ],
      12,
      2,
      color,
    ),
  );
  // Four curled fingers wrapping the hilt (index nearest the blade, +z).
  const fingers: Array<[number, number, number]> = [
    [0.0185, 0.0108, 1.0],
    [0.0, 0.0115, 1.0],
    [-0.0185, 0.0108, 0.97],
    [-0.035, 0.0096, 0.92],
  ];
  const R = 0.031 * s;
  for (const [fz, fr, k] of fingers) {
    const z = zc + fz * s;
    const pts: V3[] = [];
    // Knuckle at the back-bottom of the grip, curling under and around to the front-top.
    const a0 = THREE.MathUtils.degToRad(-150);
    const a1 = THREE.MathUtils.degToRad(48 * k);
    for (let i = 0; i <= 6; i += 1) {
      const a = a0 + ((a1 - a0) * i) / 6;
      const rr = R * (i === 0 ? 1.05 : 1);
      pts.push(new THREE.Vector3(Math.cos(a) * rr, gy + Math.sin(a) * rr, z));
    }
    parts.push(sweep(pts, (t) => fr * s * (1 - t * 0.15), 6, 7, color, { up: new THREE.Vector3(0, 0, 1), flat: 1.0 }));
    // Knuckle bump.
    parts.push(ellipsoid([pts[0].x - 0.002, pts[0].y - 0.003, z], [fr * 1.15 * s, fr * 1.05 * s, fr * 1.05 * s], color, 7));
  }
  // Thumb: thenar pad plus a two-segment thumb wrapping over the index finger toward the blade side.
  parts.push(ellipsoid([-0.004 * s, -0.024 * s, zc + 0.028 * s], [0.017 * s, 0.022 * s, 0.014 * s], color, 10));
  const t0 = new THREE.Vector3(-0.004 * s, -0.024 * s, zc + 0.034 * s);
  const t1 = new THREE.Vector3(0.022 * s, -0.024 * s, zc + 0.036 * s);
  const t2 = new THREE.Vector3(0.035 * s, -0.04 * s, zc + 0.03 * s);
  parts.push(capsule(t0, t1, 0.0115 * s, 0.0105 * s, color, 8, 2));
  parts.push(capsule(t1, t2, 0.0105 * s, 0.0088 * s, color, 8, 2));
  return parts;
}

/**
 * Open palm (Force gestures) in hand-local space: palm faces +x, fingers extend along -y,
 * thumb toward -z (the body's midline for the far hand).
 */
export function palmGeo(color: ColorSpec, size = 1, cuff?: THREE.ColorRepresentation): THREE.BufferGeometry[] {
  const s = size;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(ellipsoid([0, 0.002, 0], [0.028 * s, 0.03 * s, 0.033 * s], cuff ?? color, 10));
  parts.push(
    loft(
      [
        { y: -0.002, xf: 0.012 * s, xb: 0.014 * s, zw: 0.03 * s },
        { y: -0.03 * s, ox: 0.001, xf: 0.013 * s, xb: 0.014 * s, zw: 0.039 * s, nf: 2.6, nb: 3 },
        { y: -0.065 * s, ox: 0.002, xf: 0.012 * s, xb: 0.012 * s, zw: 0.043 * s, nf: 2.6, nb: 3 },
        { y: -0.085 * s, ox: 0.001, xf: 0.009 * s, xb: 0.009 * s, zw: 0.04 * s, nf: 2.4, nb: 2.6 },
        { y: -0.092 * s, xf: 0.004 * s, xb: 0.004 * s, zw: 0.03 * s },
      ],
      12,
      2,
      color,
    ),
  );
  // Fingers: index (nearest the thumb, -z) .. pinky; slight spread and a relaxed curl toward the palm.
  const fingers: Array<[number, number, number, number]> = [
    [-0.028, 0.068, 0.0088, -6],
    [-0.0095, 0.076, 0.0094, -1],
    [0.0095, 0.071, 0.009, 4],
    [0.027, 0.057, 0.0078, 10],
  ];
  for (const [fz, len, fr, spread] of fingers) {
    const sp = THREE.MathUtils.degToRad(spread);
    const base = new THREE.Vector3(0.0, -0.086 * s, fz * s);
    const mid = base.clone().add(new THREE.Vector3(0.006 * s, -Math.cos(sp) * len * 0.55 * s, Math.sin(sp) * len * 0.55 * s));
    const tip = mid.clone().add(new THREE.Vector3(0.014 * s, -Math.cos(sp) * len * 0.45 * s, Math.sin(sp) * len * 0.45 * s));
    parts.push(capsule(base, mid, fr * s, fr * 0.92 * s, color, 7, 2));
    parts.push(capsule(mid, tip, fr * 0.92 * s, fr * 0.78 * s, color, 7, 2));
  }
  // Thumb splayed toward -z.
  parts.push(ellipsoid([0.006 * s, -0.03 * s, -0.026 * s], [0.012 * s, 0.022 * s, 0.014 * s], color, 10));
  const t0 = new THREE.Vector3(0.006 * s, -0.035 * s, -0.032 * s);
  const t1 = new THREE.Vector3(0.016 * s, -0.058 * s, -0.058 * s);
  const t2 = new THREE.Vector3(0.022 * s, -0.08 * s, -0.07 * s);
  parts.push(capsule(t0, t1, 0.011 * s, 0.0098 * s, color, 7, 2));
  parts.push(capsule(t1, t2, 0.0098 * s, 0.0082 * s, color, 7, 2));
  return parts;
}

// ---------------------------------------------------------------------------------------------- feet

export interface BootStyle {
  main: THREE.ColorRepresentation;
  sole: THREE.ColorRepresentation;
  /** Toe cap / heel accent (armour, leather patch); defaults to main. */
  toe?: THREE.ColorRepresentation;
  /** Width and height multipliers (soft wraps vs heavy boots). */
  width?: number;
  height?: number;
  /** Pointed toe (0 = round, 1 = pointed). */
  point?: number;
}

/**
 * Boot in foot-local space: ankle pivot at the origin, sole flat on the floor at y = -ANKLE,
 * heel at -x, toe toward +x. Built as a loft along x with super-ellipse sections (flat sole).
 */
export function bootGeo(style: BootStyle, size = 1): THREE.BufferGeometry {
  const w = (style.width ?? 1) * size;
  const hgt = style.height ?? 1;
  const pt = style.point ?? 0;
  const floor = -ANKLE;
  // [x, top above floor, half width, roundness of the top half]
  const st: number[][] = [
    [-0.078, 0.032, 0.026, 2.2],
    [-0.07, 0.07, 0.038, 2.2],
    [-0.05, 0.112, 0.045, 2.3],
    [-0.02, 0.128, 0.048, 2.3],
    [0.015, 0.118, 0.05, 2.3],
    [0.05, 0.088, 0.051, 2.4],
    [0.09, 0.064, 0.05, 2.5],
    [0.13, 0.05, 0.046 - pt * 0.006, 2.5],
    [0.16, 0.042, 0.038 - pt * 0.01, 2.4],
    [0.178, 0.03, 0.026 - pt * 0.01, 2.2],
    [0.186, 0.014, 0.012, 2],
  ].map(([x, top, hw, n]) => [x * size, top * hgt * size, hw * w, n]);
  const rows = st;
  const r: number[] = [0, 0, 0, 0];
  const nv = (rows.length - 1) * 2;
  const g = surface(
    14,
    nv,
    true,
    (u, v, out) => {
      sampleRows(rows, v * (rows.length - 1), r);
      const th = u * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const halfH = Math.max(0.004, r[1] / 2);
      const cy = floor + halfH;
      const up = s >= 0;
      const e = 2 / (up ? r[3] : 5);
      out.set(r[0], cy + halfH * sgnPow(s, e), Math.max(0.003, r[2]) * sgnPow(c, e));
    },
    (p) => (p.y < floor + 0.012 ? style.sole : p.x > 0.12 * size && style.toe !== undefined ? style.toe : style.main),
    true,
    true,
  );
  return g;
}

// ---------------------------------------------------------------------------------------------- heads

/** Head sections in head-local space (head joint at origin, face toward +x). */
export interface HeadShape {
  width: number;
  depth: number;
  /** Jaw width relative to the cranium. */
  jaw: number;
  /** Chin forward offset and height. */
  chin: number;
  /** Overall height multiplier. */
  tall: number;
}

export function headSections(h: HeadShape): Sec[] {
  const w = h.width;
  const d = h.depth;
  const j = h.jaw;
  const t = h.tall;
  return [
    { y: -0.024 * t, ox: 0.058 * d + h.chin, xf: 0.012 * d, xb: 0.012, zw: 0.014 * j * w },
    { y: -0.013 * t, ox: 0.05 * d + h.chin, xf: 0.03 * d, xb: 0.03 * d, zw: 0.032 * j * w, nf: 2.2 },
    { y: 0.01 * t, ox: 0.034 * d + h.chin * 0.6, xf: 0.056 * d, xb: 0.05 * d, zw: 0.054 * j * w, nf: 2.1, nb: 2.4 },
    { y: 0.04 * t, ox: 0.02 * d + h.chin * 0.2, xf: 0.075 * d, xb: 0.07 * d, zw: 0.071 * j * w, nf: 2.0, nb: 2.6 },
    { y: 0.075 * t, ox: 0.01 * d, xf: 0.088 * d, xb: 0.088 * d, zw: 0.08 * w, nf: 2.3, nb: 2.6 },
    { y: 0.11 * t, ox: 0.006 * d, xf: 0.094 * d, xb: 0.1 * d, zw: 0.084 * w, nf: 2.6, nb: 2.5 },
    { y: 0.145 * t, ox: 0.004 * d, xf: 0.095 * d, xb: 0.106 * d, zw: 0.086 * w, nf: 2.6, nb: 2.4 },
    { y: 0.18 * t, ox: 0.0, xf: 0.088 * d, xb: 0.104 * d, zw: 0.084 * w, nf: 2.4, nb: 2.3 },
    { y: 0.21 * t, ox: -0.005 * d, xf: 0.066 * d, xb: 0.086 * d, zw: 0.068 * w },
    { y: 0.228 * t, ox: -0.01 * d, xf: 0.032 * d, xb: 0.046 * d, zw: 0.036 * w },
    { y: 0.235 * t, ox: -0.01 * d, xf: 0.008 * d, xb: 0.01 * d, zw: 0.008 * w },
  ];
}

/** Interpolated loft ring parameters at height y ([y, ox, oz, xf, xb, zw, nf, nb]). */
function rowAt(secs: Sec[], y: number): number[] {
  const rows = secs.map(secRow);
  let s = y > rows[0][0] === rows[0][0] > rows[rows.length - 1][0] ? 0 : rows.length - 1;
  for (let i = 0; i < rows.length - 1; i += 1) {
    const y0 = rows[i][0];
    const y1 = rows[i + 1][0];
    if ((y - y0) * (y - y1) <= 0) {
      s = i + (y - y0) / (y1 - y0 || 1);
      break;
    }
  }
  const r: number[] = new Array(SEC_LEN).fill(0);
  sampleRows(rows, s, r);
  r[0] = y;
  return r;
}

/** Section of a loft at height y (grown outward by `grow`). */
export function secAt(secs: Sec[], y: number, grow = 0): Sec {
  const r = rowAt(secs, y);
  return { y, ox: r[1], oz: r[2], xf: r[3] + grow, xb: r[4] + grow, zw: r[5] + grow, nf: r[6], nb: r[7] };
}

/** Point on a loft surface at height y and angle theta (0 = front, +90deg = near side), grown outward. */
export function surfPoint(secs: Sec[], y: number, theta: number, grow = 0, out = new THREE.Vector3()): V3 {
  const r = rowAt(secs, y);
  r[3] += grow;
  r[4] += grow;
  r[5] += grow;
  return ringPoint(r, theta, out);
}

/** Front-surface x of a loft at height y and lateral z (for placing facial features). */
export function frontX(secs: Sec[], y: number, z: number): number {
  const r = rowAt(secs, y);
  const zw = Math.max(1e-4, r[5]);
  const e = 2 / Math.max(0.6, r[6]);
  const sv = Math.min(1, Math.abs((z - r[2]) / zw)) ** (1 / e);
  const c = Math.sqrt(Math.max(0, 1 - sv * sv));
  return r[1] + r[3] * c ** e;
}

/** Back-surface x of a loft at height y and lateral z. */
export function backX(secs: Sec[], y: number, z: number): number {
  const r = rowAt(secs, y);
  const zw = Math.max(1e-4, r[5]);
  const e = 2 / Math.max(0.6, r[7]);
  const sv = Math.min(1, Math.abs((z - r[2]) / zw)) ** (1 / e);
  const c = Math.sqrt(Math.max(0, 1 - sv * sv));
  return r[1] - r[4] * c ** e;
}

/**
 * Layer that conforms to a loft (belts, plates, bands): rows at the given heights, columns at the given
 * angles (null = full ring of `radial` columns). grow(i, k) is the offset of row i / column k; edge rows
 * tucked below the surface give clean bevelled edges.
 */
export function conform(
  secs: Sec[],
  ys: number[],
  thetas: number[] | null,
  grow: number | ((i: number, k: number) => number),
  color: ColorSpec,
  radial = 28,
): THREE.BufferGeometry {
  const closed = thetas === null;
  const nu = closed ? radial : thetas.length - 1;
  const nv = ys.length - 1;
  const rowCache = ys.map((y) => rowAt(secs, y));
  const r: number[] = new Array(SEC_LEN).fill(0);
  return surface(
    nu,
    nv,
    closed,
    (u, v, out) => {
      const i = Math.round(v * nv);
      const k = Math.round(u * nu);
      const th = closed ? u * Math.PI * 2 : (thetas as number[])[k];
      const g = typeof grow === 'function' ? grow(i, k) : grow;
      const src = rowCache[i];
      for (let q = 0; q < SEC_LEN; q += 1) r[q] = src[q];
      r[3] += g;
      r[4] += g;
      r[5] += g;
      ringPoint(r, th, out);
    },
    color,
  );
}

/** Rows for a band from y0 to y1 with tucked edges: returns heights and a matching grow function. */
export function bandRows(y0: number, y1: number, inner: number, grow: number, bevel = 0.004): { ys: number[]; grow: (i: number) => number } {
  const ys = [y0, y0 + bevel];
  for (let i = 1; i <= inner; i += 1) ys.push(y0 + bevel + ((y1 - y0 - 2 * bevel) * i) / (inner + 1));
  ys.push(y1 - bevel, y1);
  const last = ys.length - 1;
  return { ys, grow: (i) => (i === 0 || i === last ? -0.003 : grow) };
}

/** Torso sections in bind space. */
export function torsoSecs(spec: BodySpec): Sec[] {
  return spec.torso.map(([y, ox, xf, xb, zw, nf, nb]) => ({ y: H + y, ox, xf, xb, zw, nf, nb }));
}

export { H as REST_HIP_Y, SHOULDER as SHOULDER_Y, THIGH_Y };
