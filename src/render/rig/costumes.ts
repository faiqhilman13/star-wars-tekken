import * as THREE from 'three';
import type { CharacterLook } from '../characters';
import {
  ATHLETIC,
  BIND,
  armGeo,
  bandRows,
  bodySpec,
  bootGeo,
  capsule,
  clamp01,
  conform,
  deform,
  ellipsoid,
  fistGeo,
  frontX,
  headSections,
  jointBall,
  legGeo,
  lerp,
  loft,
  mirror,
  mixColor,
  neckGeo,
  palmGeo,
  plate,
  rigWeights,
  shade,
  shrinkWrap,
  SkinBuilder,
  smooth,
  surface,
  surfPoint,
  sweep,
  torsoGeo,
  torsoSecs,
  turn,
  type BodyPaint,
  type BodySpec,
  type BootStyle,
  type HeadShape,
  type Layer,
  type PartOptions,
  type RigWeights,
  type ToonClassifier,
  type ToonRole,
  type Sec,
  type Weights,
  type WeightFn,
  REST_HIP,
} from './body';
import { CHEST_TO_SHOULDER, HIP_Z, SHIN, SHOULDER_Z, THIGH, UPPER_ARM } from './dims';
import type { FighterRig, Joints } from './FighterRig';
import { addOutline } from './toon';
import type { Expression } from '../anim/Animator';

export type ExpressionKey = keyof Expression;

type V3 = THREE.Vector3;
const V = (x = 0, y = 0, z = 0): V3 => new THREE.Vector3(x, y, z);
const D2R = Math.PI / 180;
const HY = BIND.hip;

/** One swinging robe/coat panel anchor: two bones (upper at the waist, lower near the knee). */
export interface SkirtAnchor {
  upper: THREE.Bone;
  lower: THREE.Bone;
  /** Leg that pushes this panel: 1 near, -1 far, 0 both. */
  side: 1 | -1 | 0;
  /** Outward horizontal direction and swing axis (hips space). */
  dir: THREE.Vector3;
  axis: THREE.Vector3;
  pivot: THREE.Vector3;
  /** Lower pivot offset from the upper pivot at rest (hips space). */
  low: THREE.Vector3;
  rest: number;
  /** Long panels drape their lower half over the shins. */
  long: boolean;
  /** Lower segment length (hem distance below the lower pivot). */
  len2: number;
}

export interface SkirtRig {
  anchors: SkirtAnchor[];
  /** Clearance kept from the knee/ankle centres. */
  knee: number;
  ankle: number;
}

export interface CostumeParts {
  /** Legacy rigid skirt panels (unused by the skinned costumes; kept optional). */
  skirtFront?: THREE.Object3D;
  skirtBack?: THREE.Object3D;
  skirtNear?: THREE.Object3D;
  skirtFar?: THREE.Object3D;
  /** Skinned robe/coat panels driven by the legs (see driveSkirt). */
  skirt?: SkirtRig;
  cape: THREE.Object3D[];
  hair: THREE.Object3D[];
  tails: THREE.Object3D[];
  /** Off-hand fist / open palm (bones: hidden by scaling to ~0). */
  fistF?: THREE.Object3D;
  palmF?: THREE.Object3D;
  visor?: THREE.MeshBasicMaterial;
  /** Cape length (for keeping it off the floor). */
  capeLength?: number;
  /** Shoulder pads (pauldrons, mantle shoulders): bones that follow their upper arm by a fraction. */
  pads?: Array<{ bone: THREE.Object3D; arm: THREE.Object3D; follow: number }>;
  /** Model bodies: the off hand's `palmOpen` morph (influence set 0/1 by setPalm). */
  palmMorphs?: Array<{ influences: number[]; index: number }>;
  /** Model faces: `expr_*` morph indices per expression channel (driven by setExpression). */
  exprMorphs?: Array<{ influences: number[]; map: Array<[ExpressionKey, number]> }>;
}

export interface CostumeBuild {
  parts: CostumeParts;
  meshes: THREE.Mesh[];
  skeleton: THREE.Skeleton;
  triangles: number;
}

interface Ctx {
  rig: FighterRig;
  j: Joints;
  L: CharacterLook;
  b: number;
  sb: SkinBuilder;
  W: RigWeights;
  parts: CostumeParts;
  spec: BodySpec;
  secs: Sec[];
  rigid: THREE.Mesh[];
}

// ---------------------------------------------------------------------------------------------- helpers

function bone(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Bone {
  const b = new THREE.Bone();
  b.position.set(x, y, z);
  parent.add(b);
  return b;
}

/** Shoulder pad bone (child of the chest at the shoulder joint) following the upper arm by `follow`. */
function pad(c: Ctx, far: boolean, follow: number): THREE.Bone {
  const arm = far ? c.j.upperF : c.j.upperN;
  const existing = c.parts.pads?.find((p) => p.arm === arm && p.follow === follow);
  if (existing) return existing.bone as THREE.Bone;
  const b = bone(c.j.chest, arm.position.x, arm.position.y, arm.position.z);
  (c.parts.pads ??= []).push({ bone: b, arm, follow });
  return b;
}

/** Chain of bones (cape panels, ponytail, ribbons); bind rotations about z per segment. */
function chain(parent: THREE.Object3D, count: number, spacing: number, origin: V3, bindRot: number[] = []): THREE.Bone[] {
  const out: THREE.Bone[] = [];
  let p: THREE.Object3D = parent;
  for (let i = 0; i < count; i += 1) {
    const seg = i === 0 ? bone(p, origin.x, origin.y, origin.z) : bone(p, 0, -spacing, 0);
    seg.rotation.z = bindRot[i] ?? 0;
    out.push(seg);
    p = seg;
  }
  return out;
}

const atHead = (g: THREE.BufferGeometry): THREE.BufferGeometry => g.translate(0, BIND.head, 0);

/** Interpolate a value from [y, value] rows (y descending or ascending). */
function rowValue(rows: number[][], y: number, k = 1): number {
  for (let i = 0; i < rows.length - 1; i += 1) {
    const a = rows[i];
    const c = rows[i + 1];
    if ((y - a[0]) * (y - c[0]) <= 0) return lerp(a[k], c[k], (y - a[0]) / (c[0] - a[0] || 1));
  }
  return rows[y > rows[0][0] === rows[0][0] > rows[rows.length - 1][0] ? 0 : rows.length - 1][k];
}

/** Outward direction from the torso axis (for straps wrapping the torso). */
const torsoUp = (p: V3): V3 => V(p.x, p.y > HY + 0.5 ? (p.y - (HY + 0.45)) * 1.5 : 0, p.z).normalize();

/** Point on the torso surface (bind space) at hips-relative height and angle (deg), grown outward. */
function onTorso(c: Ctx, yRel: number, deg: number, grow: number): V3 {
  return surfPoint(c.secs, HY + yRel, deg * D2R, grow);
}

/** Thin flat strap swept over the torso through (yRel, deg) waypoints. */
function strap(c: Ctx, pts: Array<[number, number]>, width: number, color: THREE.ColorRepresentation, grow = 0.007, thick = 0.0045, layer: Layer = 'solid'): void {
  const points = pts.map(([y, d]) => onTorso(c, y, d, grow));
  c.sb.add(layer, sweep(points, () => thick, 6, Math.max(8, pts.length * 4), color, { upAt: torsoUp, flat: width / 2 / thick }), c.W.torso, { role: 'detail' });
}

/** Closed band around the torso (belts, sashes, plates). */
function torsoBand(c: Ctx, y0: number, y1: number, grow: number, color: THREE.ColorRepresentation | ((p: V3) => THREE.ColorRepresentation), layer: Layer = 'solid', inner = 1): void {
  const r = bandRows(HY + y0, HY + y1, inner, grow);
  c.sb.add(layer, conform(c.secs, r.ys, null, (i) => r.grow(i), typeof color === 'function' ? (p) => color(p) : color, 32), c.W.torso, { role: layer === 'metal' ? 'metal' : 'detail', outline: layer === 'metal' ? 0.7 : 0.45 });
}

function armRadius(spec: BodySpec, yRel: number): number {
  return rowValue(spec.arm, yRel, 1);
}

function legRadius(spec: BodySpec, yRel: number): number {
  return rowValue(spec.leg, yRel, 1);
}

/** Add a near-side arm part and its far-side mirror. */
function bothArms(c: Ctx, layer: Layer, g: THREE.BufferGeometry): void {
  const far = mirror(g, 'z');
  c.sb.add(layer, g, c.W.arm(false));
  c.sb.add(layer, far, c.W.arm(true));
}

function bothLegs(c: Ctx, layer: Layer, g: THREE.BufferGeometry, weight?: (far: boolean) => WeightFn | THREE.Bone): void {
  const far = mirror(g, 'z');
  c.sb.add(layer, g, weight ? weight(false) : c.W.leg(false));
  c.sb.add(layer, far, weight ? weight(true) : c.W.leg(true));
}

/** Sleeve-like shell around an arm segment (bind space, near side): rows [yRel below shoulder, radius]. */
function armShell(rows: number[][], color: THREE.ColorRepresentation | ((v: number) => THREE.ColorRepresentation), radial = 16, caps = false): THREE.BufferGeometry {
  const g = loft(
    rows.map(([y, r, ox = 0]) => ({ y: BIND.shoulder + y, ox, xf: r, xb: r, zw: r })),
    radial,
    2,
    typeof color === 'function' ? (_p, _u, v) => color(v) : color,
    [caps, caps],
  );
  g.translate(0, 0, SHOULDER_Z);
  return g;
}

/** Radial folds on a sleeve-like shell around a vertical axis at (0, z): deeper toward y1. */
function pleat(g: THREE.BufferGeometry, z: number, y0: number, y1: number, amp: number, n: number): THREE.BufferGeometry {
  return deform(g, (p) => {
    const dx = p.x;
    const dz = p.z - z;
    const r = Math.hypot(dx, dz);
    if (r < 1e-5) return;
    const a = Math.atan2(dz, dx);
    const k = 1 + (amp * smooth(y0, y1, p.y) * Math.sin(a * n)) / r;
    p.x = dx * k;
    p.z = z + dz * k;
  });
}

/** Shell around a leg segment (bind space, near side): rows [yRel below hip joint, radius, ox]. */
function legShell(rows: number[][], color: THREE.ColorRepresentation | ((v: number) => THREE.ColorRepresentation), radial = 16, caps = true): THREE.BufferGeometry {
  const g = loft(
    rows.map(([y, r, ox = 0]) => ({ y: BIND.thigh + y, ox, xf: r, xb: r, zw: r * 0.96 })),
    radial,
    2,
    typeof color === 'function' ? (_p, _u, v) => color(v) : color,
    [caps, caps],
  );
  g.translate(0, 0, HIP_Z);
  return g;
}

// ---------------------------------------------------------------------------------------------- body

interface BodyOpts {
  paint: BodyPaint;
  hand: THREE.ColorRepresentation;
  cuff?: THREE.ColorRepresentation;
  boot: BootStyle;
  /** Extra leg radius by yRel (boot shafts, trouser bloom). */
  legExtra?: (yRel: number) => number;
}

function body(c: Ctx, o: BodyOpts): void {
  const { sb, W, j, spec } = c;
  sb.add('solid', torsoGeo(spec, o.paint.torso, 28, 2), W.torso);
  sb.add('solid', neckGeo(spec, o.paint.neck), W.neck);

  bothArms(c, 'solid', armGeo(spec, o.paint.arm, 16, 2));
  const er = armRadius(spec, -UPPER_ARM) * 0.97;
  const ec = o.paint.arm(-UPPER_ARM, V(0, BIND.elbow, SHOULDER_Z));
  sb.add('solid', jointBall(BIND.elbow, SHOULDER_Z, er, ec), j.foreN);
  sb.add('solid', jointBall(BIND.elbow, -SHOULDER_Z, er, ec), j.foreF);

  const ext = o.legExtra;
  bothLegs(c, 'solid', legGeo(spec, o.paint.leg, 18, 2, ext));
  const kr = (legRadius(spec, -THIGH) + (ext ? ext(-THIGH) : 0)) * 0.98;
  const kc = o.paint.leg(-THIGH, V(0, BIND.knee, HIP_Z));
  sb.add('solid', jointBall(BIND.knee, HIP_Z, kr, kc, 0.004), j.shinN);
  sb.add('solid', jointBall(BIND.knee, -HIP_Z, kr, kc, 0.004), j.shinF);

  // Hands: near fist on handN; far fist / palm on their own bones so setPalm can swap them.
  const fist = fistGeo(o.hand, spec.hand, o.cuff);
  for (const g of fist) {
    const far = mirror(g, 'x');
    far.translate(0, BIND.wrist, -SHOULDER_Z);
    sb.add('solid', far, c.parts.fistF as THREE.Bone);
    g.translate(0, BIND.wrist, SHOULDER_Z);
    sb.add('solid', g, j.handN);
  }
  for (const g of palmGeo(o.hand, spec.hand, o.cuff)) {
    g.translate(0, BIND.wrist, -SHOULDER_Z);
    sb.add('solid', g, c.parts.palmF as THREE.Bone);
  }

  for (const far of [false, true]) {
    const g = bootGeo(o.boot, spec.foot);
    g.translate(0, BIND.ankle, far ? -HIP_Z : HIP_Z);
    sb.add('solid', g, far ? j.footF : j.footN);
  }
}

// ---------------------------------------------------------------------------------------------- faces

interface FaceOpts {
  shape: HeadShape;
  skin: THREE.ColorRepresentation;
  iris: THREE.ColorRepresentation;
  brow: THREE.ColorRepresentation;
  lips: THREE.ColorRepresentation;
  eye?: number;
  nose?: number;
  female?: boolean;
}

/** Stylized (Clone-Wars-like) head: angular skull, brow ridge, wedge nose, almond eyes, ears. */
function face(c: Ctx, o: FaceOpts): Sec[] {
  const { sb, j } = c;
  const secs = headSections(o.shape);
  const skin = new THREE.Color(o.skin);
  const add = (g: THREE.BufferGeometry, opts: PartOptions = { role: 'feature' }) => sb.add('solid', atHead(g), j.head, opts);
  add(loft(secs, 24, 3, (p) => shade(skin, 0.82 + 0.18 * smooth(-0.02, 0.07, p.y) + 0.04 * smooth(0.0, 0.1, p.x))), { role: 'face' });

  const es = o.eye ?? 1;
  const ey = 0.108 * o.shape.tall;
  for (const s of [1, -1]) {
    const ez = 0.034 * s * o.shape.width;
    const fx = frontX(secs, ey, ez);
    const eye = (g: THREE.BufferGeometry) => add(turn(g, 'y', -s * 20, [fx, ey, ez]));
    eye(ellipsoid([fx - 0.0055, ey + 0.001, ez], [0.006, 0.0115 * es, 0.0185 * es], shade(skin, 0.7), 8));
    eye(ellipsoid([fx - 0.0046, ey, ez], [0.0056, 0.0074 * es, 0.0138 * es], 0xe9e4da, 8));
    eye(ellipsoid([fx - 0.0016, ey - 0.0004, ez - 0.0018 * s], [0.0034, 0.0064 * es, 0.0064 * es], o.iris, 8));
    eye(ellipsoid([fx - 0.0012, ey - 0.0004, ez - 0.0018 * s], [0.0024, 0.0034 * es, 0.0034 * es], 0x0a0806, 6));
    // Upper lid / lash line.
    eye(turn(ellipsoid([fx - 0.002, ey + 0.0062 * es, ez], [0.0045, (o.female ? 0.0032 : 0.0024) * es, 0.0155 * es], o.female ? 0x120c0a : shade(skin, 0.45), 8), 'x', s * (o.female ? -8 : 4), [fx, ey, ez]));
    // Brow ridge and eyebrow.
    const by = 0.136 * o.shape.tall;
    const bx = frontX(secs, by, ez);
    add(turn(turn(ellipsoid([bx - 0.009, by, ez * 1.04], [0.013, 0.0085, 0.028], shade(skin, 0.97), 10), 'y', -s * 18, [bx, by, ez]), 'x', -s * 6, [bx, by, ez]), { role: 'face', outline: 0 });
    const browPts = [0.3, 0.62, 0.95, 1.25].map((k, i) => {
      const z = s * (0.012 + k * 0.034) * o.shape.width;
      const arch = o.female ? [0.0, 0.006, 0.0075, 0.003][i] : [0.0, 0.003, 0.003, -0.001][i];
      const y = by + 0.002 + arch + (o.female ? 0 : 0.0015 * (1 - i / 3));
      return V(frontX(secs, y, z) + 0.0025, y, z);
    });
    add(sweep(browPts, (t) => (o.female ? 0.0016 : 0.0024) * (1 - t * 0.55), 5, 8, o.brow, { up: V(1, 0, 0), flat: o.female ? 1.4 : 1.9 }));
    // Ear.
    const ezr = surfPoint(secs, 0.1, (s * Math.PI) / 2).z;
    const er: [number, number, number] = o.female ? [0.014, 0.022, 0.0105] : [0.017, 0.028, 0.0095];
    add(turn(ellipsoid([-0.006, 0.098, ezr - s * 0.002], er, shade(skin, 0.93), 10), 'z', -10, [-0.006, 0.098, ezr]), { role: 'face', outline: 0.5 });
  }
  // Wedge nose: narrow bridge, wider tip/nostrils.
  const ns = o.nose ?? 1;
  const nb = o.female ? 0.112 : 0.124;
  const nose: Sec[] = [
    { y: nb, ox: frontX(secs, nb, 0) - 0.012, xf: 0.01, xb: 0.008, zw: 0.007, nf: 1.5 },
    { y: 0.1, ox: frontX(secs, 0.1, 0) - 0.008, xf: 0.013 * ns, xb: 0.008, zw: 0.009 * ns, nf: 1.5 },
    { y: 0.08, ox: frontX(secs, 0.08, 0) - 0.006, xf: 0.019 * ns, xb: 0.01, zw: 0.014 * ns, nf: 1.8 },
    { y: 0.069, ox: frontX(secs, 0.069, 0) - 0.007, xf: 0.016 * ns, xb: 0.01, zw: 0.017 * ns, nf: 2.2 },
    { y: 0.062, ox: frontX(secs, 0.062, 0) - 0.01, xf: 0.007, xb: 0.006, zw: 0.011 * ns },
  ];
  add(loft(nose, 10, 2, (p) => shade(skin, p.y < 0.072 ? 0.9 : 1.0)), { role: 'face', outline: 0 });
  // Mouth.
  const my = 0.046;
  const mx = frontX(secs, my, 0);
  add(ellipsoid([mx - 0.004, my, 0], [0.0045, 0.0026, o.female ? 0.015 : 0.017], shade(o.lips, 0.6), 8));
  add(ellipsoid([mx - 0.0045, my - 0.006, 0], [0.005, o.female ? 0.0045 : 0.0036, o.female ? 0.0125 : 0.013], o.lips, 8));
  if (o.female) add(ellipsoid([mx - 0.0045, my + 0.0045, 0], [0.0045, 0.0032, 0.0135], o.lips, 8));
  return secs;
}

/** Hair shell: a puffed copy of the skull with everything below the hairline tucked under the scalp. */
function hairShell(secs: Sec[], line: (p: V3) => number, color: (p: V3) => THREE.ColorRepresentation, puff = 1, top = 0.012): THREE.BufferGeometry {
  const hs = secs.map((s) => {
    const t = smooth(0.1, 0.22, s.y);
    return {
      ...s,
      y: s.y + 0.004 + t * top,
      ox: (s.ox ?? 0) - 0.006 * puff,
      xf: s.xf * (1 + 0.04 * puff) + 0.006 * puff + t * 0.004,
      xb: (s.xb ?? s.xf) * (1 + 0.08 * puff) + 0.01 * puff,
      zw: s.zw * (1 + 0.06 * puff) + 0.006 * puff + t * 0.004,
    };
  });
  const g = loft(hs, 30, 3, color);
  return shrinkWrap(g, V(0.01, 0.11, 0), (p) => smooth(line(p) - 0.02, line(p) + 0.016, p.y), 0.84);
}

// ---------------------------------------------------------------------------------------------- skirts

interface SkirtSpec {
  /** Waistband height above the hips joint, top radii. */
  top: number;
  rx: number;
  rz: number;
  /** Vertical length by azimuth (deg; 0 = front, 90 = near side). */
  len: (az: number) => number;
  /** Outward flare per metre of drop. */
  flare: number;
  /** Upper segment length (lower segment starts here). */
  len1: number;
  anchors: Array<{ az: number; side: 1 | -1 | 0 }>;
  panels: Array<{ from: number; to: number; anchors: number[]; grow?: (u: number) => number; color?: (d: number, len: number, u: number) => THREE.ColorRepresentation }>;
  color: (d: number, len: number, u: number) => THREE.ColorRepresentation;
  pleats?: number;
  pleatDepth?: number;
  /** Columns per 90 degrees of panel and rows per panel. */
  density?: number;
  rows?: number;
}

function makeSkirt(c: Ctx, s: SkirtSpec): void {
  const j = c.j;
  const rest = Math.atan(s.flare);
  const maxLen = Math.max(...s.anchors.map((a) => s.len(a.az)), ...s.panels.map((p) => s.len((p.from + p.to) / 2)));
  const rig: SkirtRig = c.parts.skirt ?? { anchors: [], knee: 0.1 * c.b, ankle: 0.085 * c.b };
  const bones = s.anchors.map((a) => {
    const az = a.az * D2R;
    const dir = V(Math.cos(az), 0, Math.sin(az));
    const pivot = V(s.rx * Math.cos(az), s.top, s.rz * Math.sin(az));
    const upper = bone(j.hips, pivot.x, pivot.y, pivot.z);
    const low = V(s.flare * s.len1 * Math.cos(az), -s.len1, s.flare * s.len1 * Math.sin(az));
    const lower = bone(upper, low.x, low.y, low.z);
    const axis = V(0, -1, 0).cross(dir).normalize();
    rig.anchors.push({ upper, lower, side: a.side, dir, axis, pivot, low, rest, long: maxLen > 0.55, len2: Math.max(0.02, s.len(((a.az % 360) + 360) % 360) - s.len1) });
    return { upper, lower, az: a.az };
  });
  c.parts.skirt = rig;

  for (const panel of s.panels) {
    const span = panel.to - panel.from;
    const nu = Math.max(4, Math.round((Math.abs(span) / 90) * (s.density ?? 8)));
    const nv = s.rows ?? 10;
    // Panel anchors unwrapped into the panel's azimuth range.
    const anc = panel.anchors.map((i) => {
      let az = bones[i].az;
      while (az < Math.min(panel.from, panel.to) - 60) az += 360;
      while (az > Math.max(panel.from, panel.to) + 60) az -= 360;
      return { ...bones[i], az };
    });
    anc.sort((a, b) => a.az - b.az);
    const ws: Weights[] = [];
    const paint = panel.color ?? s.color;
    const geo = surface(
      nu,
      nv,
      false,
      (u, v, out) => {
        const azd = panel.from + span * u;
        const az = azd * D2R;
        const len = s.len(((azd % 360) + 360) % 360);
        const d = v * len;
        const pleat = (s.pleatDepth ?? 0) * smooth(0, 0.25, d) * Math.sin(az * (s.pleats ?? 0));
        const g = (panel.grow ? panel.grow(u) : 0) + pleat + d * s.flare;
        out.set((s.rx + g) * Math.cos(az), HY + s.top - d, (s.rz + g) * Math.sin(az));
        // Weights: hips at the waistband, then the anchors (blended around the panel), upper -> lower.
        const wTop = smooth(0.0, 0.1, d);
        const wLow = smooth(s.len1 - 0.09, s.len1 + 0.07, d);
        let ia = 0;
        let f = 0;
        if (anc.length > 1) {
          if (azd <= anc[0].az) ia = 0;
          else if (azd >= anc[anc.length - 1].az) {
            ia = anc.length - 2;
            f = 1;
          } else {
            while (ia < anc.length - 2 && azd > anc[ia + 1].az) ia += 1;
            f = smooth(0, 1, (azd - anc[ia].az) / (anc[ia + 1].az - anc[ia].az));
          }
        }
        const a0 = anc[ia];
        const a1 = anc[Math.min(anc.length - 1, ia + 1)];
        const m0 = anc.length > 1 ? 1 - f : 1;
        const m1 = anc.length > 1 ? f : 0;
        ws.push([
          [j.hips, 1 - wTop],
          [a0.upper, wTop * (1 - wLow) * m0],
          [a1.upper, wTop * (1 - wLow) * m1],
          [a0.lower, wTop * wLow * m0],
          [a1.lower, wTop * wLow * m1],
        ]);
      },
      (_p, u, v) => {
        const azd = panel.from + span * u;
        const len = s.len(((azd % 360) + 360) % 360);
        return paint(v * len, len, u);
      },
    );
    c.sb.add('double', geo, ws);
  }
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const kneeN = new THREE.Vector3();
const kneeF = new THREE.Vector3();
const ankN = new THREE.Vector3();
const ankF = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

/** Minimum outward swing (rad) for a panel pivoting at P to keep `m` clear of point Q (2D in its plane). */
function clearAngle(px: number, py: number, pz: number, Q: V3, dir: V3, m: number): number {
  const qx = Q.x - px;
  const qz = Q.z - pz;
  const out = qx * dir.x + qz * dir.z;
  const down = -(Q.y - py);
  const R = Math.hypot(out, down);
  if (R < m * 1.2) return -Infinity;
  return Math.atan2(out, down) + Math.asin(Math.min(1, m / R));
}

/** Angle nearest `ref` that is equivalent to `a` (mod 2pi). */
function near(a: number, ref: number): number {
  return ref + Math.atan2(Math.sin(a - ref), Math.cos(a - ref));
}

/**
 * Keep a hanging segment's end above the floor: with the segment at angle a its end height is
 * h + len * (sin(a) * uOut + cos(a) * uDown). Returns a, or the nearest angle that clears minH.
 */
export function floorClamp(a: number, h: number, len: number, uOut: number, uDown: number, minH: number): number {
  if (h + len * (Math.sin(a) * uOut + Math.cos(a) * uDown) >= minH) return a;
  const R = Math.hypot(uOut, uDown) * len;
  if (R < 1e-5) return a;
  const phi = Math.atan2(uDown, uOut);
  const k = (minH - h) / R;
  if (k >= 1) return near(Math.PI / 2 - phi, a);
  const s = Math.asin(Math.max(-1, k));
  const a1 = near(s - phi, a);
  const a2 = near(Math.PI - s - phi, a);
  return Math.abs(a1 - a) < Math.abs(a2 - a) ? a1 : a2;
}

const qHips = new THREE.Quaternion();
const vUp = new THREE.Vector3();

/**
 * Swing the skinned robe panels so they hang with gravity, part around the legs, never let a knee or
 * shin push through, and pool on the floor instead of sinking into it. Each panel pivots at the
 * waistband by the smallest angle that clears its leg. `floor` is the floor height in rig-root space.
 */
export function driveSkirt(sk: SkirtRig, j: Joints, sway: number, flare: number, floor = -Infinity): void {
  // Legs in hips space.
  kneeN.set(0, -THIGH, 0).applyQuaternion(j.thighN.quaternion).add(j.thighN.position);
  ankN.set(0, -SHIN, 0).applyQuaternion(tmpQ.copy(j.thighN.quaternion).multiply(j.shinN.quaternion)).add(kneeN);
  kneeF.set(0, -THIGH, 0).applyQuaternion(j.thighF.quaternion).add(j.thighF.position);
  ankF.set(0, -SHIN, 0).applyQuaternion(tmpQ.copy(j.thighF.quaternion).multiply(j.shinF.quaternion)).add(kneeF);
  // World down in hips space (root mirror / yaw leave "down" unchanged).
  qHips.copy(j.body.quaternion).multiply(j.hips.quaternion);
  tmpQ.copy(j.turn.quaternion).multiply(qHips).invert();
  const g = tmpV.copy(DOWN).applyQuaternion(tmpQ);
  // Root-space vertical components of hips-space directions (for the floor).
  const uDown = vUp.copy(DOWN).applyQuaternion(qHips).y;
  const bodyY = j.body.position.y;
  for (const a of sk.anchors) {
    const gOut = g.x * a.dir.x + g.z * a.dir.z;
    const grav = Math.max(-0.8, Math.min(0.8, Math.atan2(gOut, Math.max(0.15, -g.y))));
    let alpha = a.rest + grav * 0.6;
    const P = a.pivot;
    let clear = -Infinity;
    if (a.side >= 0) {
      clear = Math.max(clear, clearAngle(P.x, P.y, P.z, kneeN, a.dir, sk.knee));
      if (!a.long) clear = Math.max(clear, clearAngle(P.x, P.y, P.z, ankN, a.dir, sk.ankle) - 0.15);
    }
    if (a.side <= 0) {
      clear = Math.max(clear, clearAngle(P.x, P.y, P.z, kneeF, a.dir, sk.knee));
      if (!a.long) clear = Math.max(clear, clearAngle(P.x, P.y, P.z, ankF, a.dir, sk.ankle) - 0.15);
    }
    alpha = Math.max(alpha, clear) + sway * a.dir.x * 0.35 + flare * 0.85;
    alpha = Math.max(-0.4, Math.min(2.3, alpha));
    const uOut = vUp.copy(a.dir).applyQuaternion(qHips).y;
    const hP = bodyY + tmpV2.copy(P).applyQuaternion(qHips).y;
    const len1 = -a.low.y;
    alpha = Math.max(clear, floorClamp(alpha, hP, len1, uOut, uDown, floor + 0.035));
    a.upper.quaternion.setFromAxisAngle(a.axis, alpha - a.rest);

    // Lower half: pivot where the upper half ends, drape with gravity, clear the shins and the floor.
    const lo = a.low.x * a.dir.x + a.low.z * a.dir.z;
    const ld = -a.low.y;
    const lr = Math.hypot(lo, ld);
    const beta = Math.atan2(lo, ld) + (alpha - a.rest);
    const sb = Math.sin(beta);
    const cb = Math.cos(beta);
    const p2 = tmpV2.set(P.x + a.dir.x * sb * lr, P.y - cb * lr, P.z + a.dir.z * sb * lr);
    let alpha2 = a.rest + grav * (a.long ? 0.9 : 0.7);
    let clear2 = -Infinity;
    if (a.side >= 0) clear2 = Math.max(clear2, clearAngle(p2.x, p2.y, p2.z, ankN, a.dir, sk.ankle));
    if (a.side <= 0) clear2 = Math.max(clear2, clearAngle(p2.x, p2.y, p2.z, ankF, a.dir, sk.ankle));
    alpha2 = Math.max(alpha2, clear2);
    if (!a.long) alpha2 = Math.max(alpha2, alpha - 0.5);
    alpha2 = Math.max(alpha - 1.9, Math.min(alpha + 0.6, alpha2)) + flare * 0.4 + sway * a.dir.x * 0.25;
    const hP2 = hP + lr * (sb * uOut + cb * uDown);
    alpha2 = Math.max(clear2, floorClamp(alpha2, hP2, a.len2, uOut, uDown, floor + 0.02));
    a.lower.quaternion.setFromAxisAngle(a.axis, alpha2 - alpha);
  }
}

// ---------------------------------------------------------------------------------------------- capes

interface CapeSpec {
  segments: number;
  length: number;
  /** Attachment (chest-local): x behind the spine, y above the chest joint. */
  ox: number;
  oy: number;
  /** Half width at the top / bottom, and how far the edges wrap forward at the top. */
  wTop: number;
  wBot: number;
  wrap: number;
  /** Extra distance behind the body by drop (m), so the cape clears robes. */
  bow: (d: number) => number;
  outer: (d: number, u: number) => THREE.ColorRepresentation;
  lining?: (d: number, u: number) => THREE.ColorRepresentation;
}

function makeCape(c: Ctx, s: CapeSpec): void {
  const j = c.j;
  const seg = s.length / s.segments;
  c.parts.cape = chain(j.chest, s.segments, seg, V(s.ox, s.oy, 0));
  c.parts.capeLength = s.length;
  const bones = c.parts.cape as THREE.Bone[];
  const top = BIND.chest + s.oy;
  const nu = 14;
  const nv = s.segments * 4;
  const build = (inset: number, color: (d: number, u: number) => THREE.ColorRepresentation) => {
    const ws: Weights[] = [];
    const geo = surface(
      nu,
      nv,
      false,
      (u, v, out) => {
        const d = v * s.length;
        const k = u * 2 - 1;
        const w = lerp(s.wTop, s.wBot, Math.sqrt(v));
        const wrap = s.wrap * (1 - smooth(0, 0.35, v));
        const bow = 0.07 + s.bow(d);
        out.set(s.ox - bow * (1 - k * k) + wrap * k * k + inset, top - d, k * w);
        // Weights: chest at the collar, then hat-blends between chain segments.
        const sv = d / seg;
        const wc = 1 - smooth(0.0, 0.5, sv);
        const x = Math.max(0, sv - 0.5);
        const i0 = Math.min(s.segments - 1, Math.floor(x));
        const f = Math.min(1, x - i0);
        const i1 = Math.min(s.segments - 1, i0 + 1);
        ws.push([
          [j.chest, wc],
          [bones[i0], (1 - wc) * (1 - f)],
          [bones[i1], (1 - wc) * f],
        ]);
      },
      (_p, u, v) => color(v * s.length, u),
    );
    c.sb.add('double', geo, ws);
  };
  build(0, s.outer);
  if (s.lining) build(0.008, s.lining);
}

// ---------------------------------------------------------------------------------------------- characters

function kael(c: Ctx): void {
  const { L, sb, W, j } = c;
  const tunic = new THREE.Color(L.primary);
  const dark = new THREE.Color(L.primaryDark);
  const cream = new THREE.Color(L.secondary);
  body(c, {
    paint: {
      torso: (p, y) => (y < 0.03 ? L.trousers : p.x > 0.02 && y > 0.42 && Math.abs(p.z) < 0.006 + (y - 0.42) * 0.3 ? shade(cream, 0.82) : mixColor(dark, tunic, 0.55 + 0.45 * smooth(0.05, 0.4, y))),
      neck: L.skin,
      arm: (y) => (y < -0.3 ? cream : mixColor(dark, tunic, 0.75 + 0.25 * smooth(-0.3, 0, y))),
      leg: (y) => (y < -0.565 ? L.boots : L.trousers),
    },
    hand: L.skin,
    boot: { main: L.boots, sole: shade(L.boots, 0.55), toe: shade(L.boots, 1.25) },
    legExtra: (y) => 0.009 * smooth(-0.55, -0.6, y),
  });
  // Boot cuffs.
  bothLegs(c, 'solid', legShell([[-0.545, 0.061, 0.0], [-0.555, 0.068, -0.002], [-0.59, 0.07, -0.006], [-0.6, 0.064, -0.008]], shade(L.boots, 1.3), 18));

  // Cream crossed lapels, dark tabards over the shoulders, obi sash and leather belt.
  strap(c, [[0.62, -140], [0.625, -95], [0.6, -55], [0.52, -25], [0.44, -6], [0.39, 4]], 0.036, shade(cream, 0.9), 0.005);
  strap(c, [[0.62, 140], [0.625, 95], [0.6, 55], [0.52, 25], [0.43, 2], [0.34, -16], [0.22, -28], [0.12, -34]], 0.038, cream, 0.009);
  for (const s of [1, -1]) {
    strap(c, [[0.11, s * 28], [0.3, s * 26], [0.48, s * 32], [0.58, s * 52], [0.618, s * 88], [0.58, s * 126], [0.46, s * 145], [0.3, s * 150], [0.11, s * 151]], 0.062, dark, 0.012, 0.004);
  }
  torsoBand(c, 0.0, 0.135, 0.016, shade(dark, 0.95), 'solid', 2);
  torsoBand(c, 0.045, 0.092, 0.026, L.belt, 'solid', 1);
  // Buckle, pouches, saber clip.
  const beltPt = (deg: number, y = 0.068) => onTorso(c, y, deg, 0.03);
  const fb = beltPt(0);
  sb.add('metal', capsule(V(fb.x, fb.y - 0.018, 0), V(fb.x, fb.y + 0.018, 0), 0.012, 0.012, L.metal, 8, 2), W.torso);
  for (const [deg, w] of [[38, 0.05], [62, 0.045], [-40, 0.05], [118, 0.042]] as const) {
    const p = beltPt(deg, 0.055);
    const g = turn(turn(loft([{ y: -0.032, xf: 0.014, zw: w / 2, nf: 3 }, { y: 0.0, xf: 0.019, zw: w / 2 + 0.003, nf: 3 }, { y: 0.026, xf: 0.016, zw: w / 2, nf: 3 }, { y: 0.03, xf: 0.008, zw: w / 2 - 0.006, nf: 3 }], 10, 1, shade(L.belt, 1.35)), 'y', -deg), 'y', 0);
    g.translate(p.x, p.y, p.z);
    sb.add('solid', g, W.torso, { role: 'leather', outline: 0.5 });
  }
  // Rolled hood at the back of the neck.
  const hoodPts: V3[] = [];
  for (const deg of [-62, -95, -130, -160, 180, 160, 130, 95, 62]) hoodPts.push(onTorso(c, 0.6 - Math.abs(Math.cos(deg * D2R)) * 0.0, deg, 0.03).add(V(0, 0.022, 0)));
  sb.add('solid', sweep(hoodPts, (t) => 0.026 + 0.01 * Math.sin(t * Math.PI), 9, 20, (p) => mixColor(shade(dark, 0.8), tunic, smooth(HY + 0.6, HY + 0.66, p.y)), { up: V(0, 1, 0), flat: 1.35 }), j.chest);

  // Bell sleeves over the forearms.
  bothArms(
    c,
    'double',
    pleat(
      armShell(
        [
          [-0.25, 0.046],
          [-0.31, 0.054],
          [-0.42, 0.064],
          [-0.52, 0.074],
          [-0.58, 0.079],
        ],
        (v) => (v > 0.9 ? shade(dark, 0.9) : mixColor(tunic, dark, v * 0.4)),
        20,
      ),
      SHOULDER_Z,
      BIND.shoulder - 0.27,
      BIND.shoulder - 0.58,
      0.006,
      5,
    ),
  );

  // Tunic skirt wrapping over at the front, parting with the legs.
  makeSkirt(c, {
    top: 0.075,
    rx: 0.112,
    rz: 0.162,
    len: () => 0.43,
    flare: 0.16,
    len1: 0.26,
    anchors: [
      { az: 30, side: 1 },
      { az: 90, side: 1 },
      { az: 148, side: 1 },
      { az: 180, side: 0 },
      { az: 212, side: -1 },
      { az: 270, side: -1 },
      { az: 330, side: -1 },
    ],
    panels: [{ from: -16, to: 376, anchors: [0, 1, 2, 3, 4, 5, 6], grow: (u) => 0.013 * smooth(0.9, 1, u) }],
    color: (d, len, u) => (d > len - 0.025 || u > 0.985 ? shade(dark, 0.92) : mixColor(tunic, dark, 0.15 + (d / len) * 0.25)),
    pleats: 9,
    pleatDepth: 0.006,
    density: 9,
    rows: 9,
  });

  // Head: hair swept back, trimmed beard and moustache.
  const skin = L.skin;
  const secs = face(c, { shape: { width: 1, depth: 1, jaw: 1.02, chin: 0.006, tall: 1 }, skin, iris: 0x4a6478, brow: L.hair, lips: shade(skin, 0.8) });
  const hairCol = (p: V3) => shade(L.hair, 0.78 + 0.4 * smooth(0.04, 0.22, p.y));
  const hairLine = (p: V3) => lerp(lerp(0.13, 0.176, smooth(0.015, 0.085, p.x)), 0.025, smooth(0.0, -0.075, p.x));
  sb.add('solid', atHead(hairShell(secs, hairLine, hairCol, 1.25, 0.018)), j.head, { role: 'hair' });
  // Sculpted locks swept back over the crown (Clone-Wars-style clumps).
  for (const [z, x0, y0, r] of [[0.046, 0.066, 0.188, 0.019], [0.016, 0.078, 0.203, 0.022], [-0.016, 0.076, 0.203, 0.022], [-0.046, 0.062, 0.188, 0.019]] as const) {
    const a = V(x0, y0, z);
    const m = V(x0 - 0.07, y0 + 0.016, z * 1.08);
    const e = V(x0 - 0.15, y0 - 0.01, z * 1.1);
    sb.add('solid', atHead(sweep([a, m, e], (t) => r * (0.55 + 0.45 * Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.9 + 0.3)), 7, 8, hairCol, { up: V(0, 1, 0), flat: 1.25 })), j.head, { role: 'hair', outline: 0.6 });
  }
  const beardSecs = secs.map((s) => {
    const low = 1 - smooth(0.06, 0.12, s.y);
    return { ...s, y: s.y - 0.007 * low, ox: (s.ox ?? 0) + 0.004 * low, xf: s.xf + 0.009 * low + 0.002, xb: (s.xb ?? s.xf) + 0.003, zw: s.zw + 0.007 * low + 0.002 };
  });
  const beard = shrinkWrap(
    loft(beardSecs, 30, 3, (p) => shade(L.hair, 0.85 + 0.25 * smooth(0.0, 0.1, p.y))),
    V(0.02, 0.07, 0),
    (p) => {
      const top = lerp(0.13, 0.068, smooth(-0.01, 0.075, p.x));
      const mouth = smooth(0.06, 0.075, p.x) * (1 - smooth(0.012, 0.024, Math.abs(p.z))) * smooth(0.032, 0.04, p.y) * (1 - smooth(0.048, 0.058, p.y));
      return smooth(-0.05, -0.005, p.x) * (1 - smooth(top - 0.018, top + 0.014, p.y)) * (1 - mouth);
    },
    0.88,
  );
  sb.add('solid', atHead(beard), j.head, { role: 'hair', outline: 0.8 });
  for (const s of [1, -1]) {
    const mx = frontX(secs, 0.056, 0.012);
    sb.add('solid', atHead(turn(ellipsoid([mx - 0.001, 0.056, s * 0.013], [0.008, 0.0062, 0.017], shade(L.hair, 1.05), 8), 'x', -s * 22, [mx, 0.056, s * 0.013])), j.head, { role: 'hair', outline: 0 });
  }
}

function vexa(c: Ctx): void {
  const { L, sb, W, j } = c;
  const suit = new THREE.Color(L.primary);
  const metal = new THREE.Color(L.metal);
  const trim = new THREE.Color(L.trim);
  body(c, {
    paint: {
      torso: (_p, y) => (y < 0.03 ? L.trousers : mixColor(L.primaryDark, suit, smooth(0.0, 0.4, y))),
      neck: L.secondary,
      arm: (y) => (y < -0.5 ? L.glove ?? L.secondary : mixColor(L.primaryDark, suit, 0.6 + 0.4 * smooth(-0.3, 0, y))),
      leg: (y) => (y < -0.6 ? L.boots : L.trousers),
    },
    hand: L.glove ?? L.secondary,
    cuff: shade(metal, 0.8),
    boot: { main: L.boots, sole: shade(L.boots, 0.6), toe: shade(metal, 0.7), width: 1.08, height: 1.05 },
    legExtra: (y) => 0.01 * smooth(-0.58, -0.63, y),
  });
  const tor = W.torso;
  // Cuirass, segmented abdomen lames, gorget.
  const plateCol = (p: V3) => mixColor(shade(metal, 0.75), metal, smooth(HY + 0.2, HY + 0.5, p.y) * 0.6 + 0.4 * clamp01(p.x * 6 + 0.4));
  torsoBand(c, 0.33, 0.585, 0.02, plateCol, 'metal', 4);
  for (const [y0, y1] of [[0.25, 0.335], [0.175, 0.26], [0.1, 0.185]] as const) torsoBand(c, y0, y1, 0.016, plateCol, 'metal', 1);
  // Centre ridge on the breastplate.
  strap(c, [[0.35, 0], [0.45, 0], [0.56, 0]], 0.016, shade(metal, 1.2), 0.026, 0.004, 'metal');
  // Gorget.
  sb.add('metal', loft([{ y: BIND.neck + 0.07, xf: 0.05, zw: 0.054 }, { y: BIND.neck + 0.04, xf: 0.066, zw: 0.07 }, { y: BIND.neck - 0.01, xf: 0.088, xb: 0.08, zw: 0.1 }, { y: BIND.neck - 0.035, xf: 0.09, xb: 0.08, zw: 0.12 }], 20, 2, plateCol, [false, false]), (p) => [
    [j.chest, 1 - smooth(BIND.neck - 0.02, BIND.neck + 0.07, p.y) * 0.5],
    [j.neck, smooth(BIND.neck - 0.02, BIND.neck + 0.07, p.y) * 0.5],
  ]);
  // Belt: red sash and metal buckle.
  torsoBand(c, 0.03, 0.105, 0.024, L.belt, 'solid', 1);
  const fb = onTorso(c, 0.067, 0, 0.03);
  sb.add('metal', turn(loft([{ y: -0.026, xf: 0.008, zw: 0.022, nf: 4 }, { y: 0, xf: 0.012, zw: 0.03, nf: 4 }, { y: 0.026, xf: 0.008, zw: 0.022, nf: 4 }], 12, 1, shade(metal, 1.1)), 'x', 0).translate(fb.x, fb.y, 0), tor);

  // Layered pauldrons (three lames per shoulder), moving mostly with the upper arm.
  {
    const S = BIND.shoulder;
    const z0 = SHOULDER_Z + 0.012;
    const pc = (cy: number, edge: number) => (p: V3) => (p.y < cy - edge ? trim : mixColor(shade(metal, 0.78), shade(metal, 1.12), smooth(cy - 0.06, cy + 0.08, p.y)));
    const pieces = [
      turn(plate([0, S + 0.016, z0 + 0.012], [0.128, 0.1, 0.118], [-44, 224], [6, 96], 0.014, pc(S + 0.016, 0.034), 16, 7), 'x', 10, [0, S, z0]),
      turn(plate([0, S - 0.03, z0 + 0.03], [0.13, 0.066, 0.122], [-38, 218], [62, 112], 0.011, pc(S - 0.03, 0.02), 16, 3), 'x', 18, [0, S - 0.03, z0]),
      turn(plate([0, S - 0.068, z0 + 0.046], [0.13, 0.066, 0.124], [-32, 212], [64, 116], 0.011, pc(S - 0.068, 0.018), 16, 3), 'x', 26, [0, S - 0.068, z0]),
    ];
    // Haute-piece: a raised flange along the inner top of each pauldron.
    const hp: V3[] = [-0.075, -0.035, 0.0, 0.035, 0.07].map((x) => V(x, S + 0.098 - (x * x) * 3.2 + 0.012, z0 - 0.035));
    pieces.push(sweep(hp, () => 0.0045, 6, 10, (p) => (p.y > S + 0.12 ? trim : shade(metal, 1.05)), { up: V(0, 0, 1), flat: 7 }));
    const padN = pad(c, false, 0.45);
    const padF = pad(c, true, 0.45);
    for (const g of pieces) {
      const far = mirror(g, 'z');
      sb.add('metal', g, padN);
      sb.add('metal', far, padF);
    }
  }
  // Vambraces and gauntlet cuffs.
  bothArms(c, 'metal', armShell([[-0.33, 0.048], [-0.36, 0.055], [-0.45, 0.052], [-0.52, 0.045], [-0.535, 0.04]], (v) => mixColor(metal, shade(metal, 0.7), v), 14, true));
  // Knee cops and greaves.
  for (const far of [false, true]) {
    const z = far ? -HIP_Z : HIP_Z;
    const kc = plate([0.004, BIND.knee + 0.006, z], [0.072, 0.078, 0.068], [-80, 80], [32, 150], 0.012, (p) => (p.y < BIND.knee - 0.045 ? trim : metal), 12, 6);
    const kw: Weights = [
      [far ? j.thighF : j.thighN, 0.45],
      [far ? j.shinF : j.shinN, 0.55],
    ];
    sb.add('metal', kc, () => kw);
  }
  bothLegs(c, 'metal', legShell([[-0.53, 0.062, 0.004], [-0.56, 0.072, 0.006], [-0.66, 0.07, 0.004], [-0.78, 0.058, 0.002], [-0.83, 0.052, 0.0]], (v) => mixColor(metal, shade(metal, 0.72), v), 14));

  // Helmet with a glowing visor, under a hood.
  const hs: Sec[] = [
    { y: -0.04, ox: 0.07, xf: 0.02, xb: 0.03, zw: 0.035, nf: 1.5 },
    { y: -0.015, ox: 0.05, xf: 0.055, xb: 0.06, zw: 0.066, nf: 1.45 },
    { y: 0.04, ox: 0.027, xf: 0.088, xb: 0.088, zw: 0.09, nf: 1.6 },
    { y: 0.09, ox: 0.014, xf: 0.102, xb: 0.102, zw: 0.099, nf: 2.0, nb: 2.4 },
    { y: 0.13, ox: 0.008, xf: 0.108, xb: 0.113, zw: 0.102, nf: 2.3 },
    { y: 0.17, ox: 0.0, xf: 0.103, xb: 0.116, zw: 0.1, nf: 2.3 },
    { y: 0.21, ox: -0.004, xf: 0.083, xb: 0.102, zw: 0.084 },
    { y: 0.24, ox: -0.008, xf: 0.046, xb: 0.062, zw: 0.048 },
    { y: 0.252, ox: -0.008, xf: 0.01, xb: 0.012, zw: 0.01 },
  ];
  const hcol = (p: V3) => mixColor(shade(metal, 0.62), shade(metal, 1.05), smooth(-0.03, 0.2, p.y) * 0.7 + 0.3 * clamp01(p.x * 8));
  sb.add('metal', atHead(loft(hs, 28, 3, hcol)), j.head);
  // Visor recess (dark) and brow ridge.
  const visorPts = (y: number, grow: number) => [-0.07, -0.045, -0.02, 0, 0.02, 0.045, 0.07].map((z) => V(frontX(hs, y, z) + grow, y + Math.abs(z) * 0.12, z));
  sb.add('solid', atHead(sweep(visorPts(0.118, 0.001), () => 0.0035, 6, 16, 0x0b0b0e, { up: V(1, 0, 0), flat: 5.2 })), j.head, { role: 'feature' });
  sb.add('metal', atHead(sweep(visorPts(0.146, 0.006), () => 0.006, 6, 16, shade(metal, 1.15), { up: V(1, 0, 0), flat: 2.2 })), j.head);
  // Crest ridge over the dome, cheek guards.
  sb.add('metal', atHead(sweep([V(0.1, 0.16, 0), V(0.08, 0.22, 0), V(0.02, 0.258, 0), V(-0.06, 0.24, 0), V(-0.11, 0.17, 0)], (t) => 0.008 + 0.004 * Math.sin(t * Math.PI), 6, 14, shade(metal, 1.1), { up: V(0, 0, 1), flat: 1.4 })), j.head);
  for (const s of [1, -1]) {
    const g = ellipsoid([0.055, 0.03, s * 0.075], [0.045, 0.03, 0.022], shade(metal, 0.85), 12);
    turn(g, 'y', -s * 25, [0.055, 0.03, s * 0.075]);
    turn(g, 'z', -20, [0.055, 0.03, s * 0.075]);
    sb.add('metal', atHead(g), j.head);
  }
  for (const y of [0.012, 0.03, 0.048]) {
    const pts = [-0.026, -0.009, 0.009, 0.026].map((z) => V(frontX(hs, y, z) + 0.001, y, z));
    sb.add('solid', atHead(sweep(pts, () => 0.0026, 5, 6, 0x101014, { up: V(1, 0, 0), flat: 1.6 })), j.head, { role: 'feature' });
  }
  sb.add('solid', atHead(sweep([V(0.104, 0.17, 0), V(0.084, 0.222, 0), V(0.024, 0.262, 0), V(-0.058, 0.246, 0)], () => 0.0032, 5, 12, trim, { up: V(0, 0, 1), flat: 1.2 })), j.head, { role: 'detail', outline: 0 });
  const vis = new THREE.MeshBasicMaterial({ color: new THREE.Color(L.weapon.blade).multiplyScalar(2.4), toneMapped: false });
  c.parts.visor = vis;
  const visor = new THREE.Mesh(sweep(visorPts(0.118, 0.0045), () => 0.0016, 6, 16, 0xffffff, { up: V(1, 0, 0), flat: 4.4 }), vis);
  j.head.add(visor);
  c.rigid.push(visor);
  hood(c, hs, 1.16, 58, (p) => mixColor(L.primaryDark, suit, smooth(-0.1, 0.25, p.y)));

  // Long coat skirt open at the front, split at the back, red-trimmed edges.
  const coat = (d: number, len: number, u: number) => (d > len - 0.035 || u < 0.03 || u > 0.97 ? trim : mixColor(suit, L.primaryDark, 0.2 + (d / len) * 0.6));
  makeSkirt(c, {
    top: 0.07,
    rx: 0.118 * c.b,
    rz: 0.168 * c.b,
    len: () => 0.7,
    flare: 0.2,
    len1: 0.4,
    anchors: [
      { az: 45, side: 1 },
      { az: 98, side: 1 },
      { az: 158, side: 1 },
      { az: 202, side: -1 },
      { az: 262, side: -1 },
      { az: 315, side: -1 },
    ],
    panels: [
      { from: 26, to: 179, anchors: [0, 1, 2] },
      { from: 181, to: 334, anchors: [3, 4, 5] },
    ],
    color: coat,
    pleats: 7,
    pleatDepth: 0.008,
    density: 8,
    rows: 12,
  });

  makeCape(c, {
    segments: 4,
    length: 1.0,
    ox: -0.07,
    oy: 0.215,
    wTop: 0.2,
    wBot: 0.34,
    wrap: 0.06,
    bow: (d) => 0.03 + d * 0.16,
    outer: (d) => (d > 0.96 ? trim : mixColor(suit, L.primaryDark, d * 0.6)),
    lining: () => shade(trim, 0.55),
  });
}

/** Hood around a head/helmet (open at the front), draping onto the shoulders. */
function hood(c: Ctx, hs: Sec[], scale: number, open: number, color: (p: V3) => THREE.ColorRepresentation): void {
  const { j } = c;
  const secs: Sec[] = [
    ...hs
      .filter((s) => s.y > 0.02)
      .reverse()
      .map((s, i, arr) => {
        const up = i / (arr.length - 1);
        return { ...s, y: s.y + 0.012 + 0.012 * (1 - up), ox: (s.ox ?? 0) - 0.012, xf: s.xf * scale + 0.004, xb: (s.xb ?? s.xf) * scale + 0.01, zw: s.zw * scale + 0.006 };
      })
      .reverse(),
  ];
  secs.unshift(
    { y: -0.115, ox: -0.03, xf: 0.13, xb: 0.15, zw: 0.2 },
    { y: -0.07, ox: -0.025, xf: 0.1, xb: 0.135, zw: 0.15 },
    { y: -0.02, ox: -0.02, xf: 0.096, xb: 0.125, zw: 0.12 },
  );
  const a0 = open * D2R;
  const a1 = (360 - open) * D2R;
  const rows = secs.length;
  const ws: Weights[] = [];
  const geo = surface(
    16,
    (rows - 1) * 2,
    false,
    (u, v, out) => {
      const sIdx = v * (rows - 1);
      const i = Math.min(rows - 2, Math.floor(sIdx));
      const t = sIdx - i;
      const A = secs[i];
      const B = secs[i + 1];
      const L = (k: keyof Sec, dflt: number) => lerp((A[k] as number | undefined) ?? dflt, (B[k] as number | undefined) ?? dflt, t);
      const th = a0 + (a1 - a0) * u;
      const cth = Math.cos(th);
      const sth = Math.sin(th);
      const xf = L('xf', 0);
      const xb = (A.xb ?? A.xf) * (1 - t) + (B.xb ?? B.xf) * t;
      const n = 2.2;
      const e = 2 / n;
      out.set(L('ox', 0) + (cth >= 0 ? xf : xb) * Math.sign(cth) * Math.abs(cth) ** e, L('y', 0), L('oz', 0) + L('zw', 0) * Math.sign(sth) * Math.abs(sth) ** e);
      out.y += BIND.head;
      const yRel = out.y - BIND.head;
      const th2 = smooth(0.02, -0.08, yRel);
      ws.push([
        [j.head, 1 - th2],
        [j.chest, th2 * 0.7],
        [j.neck, th2 * 0.3],
      ]);
    },
    (p) => color(V(p.x, p.y - BIND.head, p.z)),
  );
  c.sb.add('double', geo, ws);
}

function asha(c: Ctx): void {
  const { L, sb, W, j } = c;
  const top = new THREE.Color(L.primary);
  const leather = new THREE.Color(L.secondary);
  body(c, {
    paint: {
      torso: (p, y) => (y < 0.02 ? L.trousers : y > 0.555 && Math.abs(p.z) > 0.1 ? L.skin : mixColor(L.primaryDark, top, 0.55 + 0.45 * smooth(0.05, 0.45, y))),
      neck: L.skin,
      arm: () => L.skin,
      leg: (y) => (y < -0.62 ? L.boots : L.trousers),
    },
    hand: L.skin,
    cuff: shade(L.belt, 1.2),
    boot: { main: L.boots, sole: shade(L.boots, 0.6), width: 0.92, height: 0.9, point: 0.6 },
    legExtra: (y) => 0.006 * smooth(-0.6, -0.64, y),
  });
  // Harness: crossing straps front and back, belt, pouches.
  for (const s of [1, -1]) {
    strap(c, [[0.6, s * 62], [0.52, s * 32], [0.4, s * 6], [0.28, -s * 22], [0.13, -s * 38]], 0.026, leather, 0.008);
    strap(c, [[0.6, s * 118], [0.52, s * 148], [0.4, s * 174], [0.28, s * 202], [0.13, s * 218]], 0.026, shade(leather, 0.9), 0.008);
  }
  const ring = onTorso(c, 0.4, 0, 0.016);
  sb.add('metal', capsule(V(ring.x, ring.y - 0.012, 0), V(ring.x, ring.y + 0.012, 0), 0.011, 0.011, L.metal, 8, 2), W.torso);
  torsoBand(c, 0.035, 0.085, 0.02, L.belt, 'solid', 1);
  for (const [deg, w] of [[48, 0.042], [-52, 0.04], [100, 0.036]] as const) {
    const p = onTorso(c, 0.048, deg, 0.032);
    const g = turn(loft([{ y: -0.03, xf: 0.013, zw: w / 2, nf: 3 }, { y: 0.0, xf: 0.017, zw: w / 2 + 0.003, nf: 3 }, { y: 0.022, xf: 0.014, zw: w / 2, nf: 3 }, { y: 0.026, xf: 0.006, zw: w / 2 - 0.006, nf: 3 }], 10, 1, shade(L.belt, 1.4)), 'y', -deg);
    g.translate(p.x, p.y, p.z);
    sb.add('solid', g, W.torso, { role: 'leather', outline: 0.5 });
  }
  // Far-shoulder leather guard and its strap.
  const sg = plate([0.0, BIND.shoulder + 0.008, SHOULDER_Z + 0.006], [0.074, 0.07, 0.07], [-40, 220], [8, 92], 0.009, (p) => (p.y < BIND.shoulder - 0.045 ? shade(leather, 0.75) : leather), 14, 6);
  sb.add('solid', mirror(sg, 'z'), pad(c, true, 0.6));
  sg.dispose();
  const sg2 = turn(plate([0.0, BIND.shoulder - 0.045, SHOULDER_Z + 0.014], [0.072, 0.045, 0.07], [-30, 210], [60, 112], 0.008, shade(leather, 0.85), 14, 3), 'x', 10, [0, BIND.shoulder - 0.045, SHOULDER_Z]);
  sb.add('solid', mirror(sg2, 'z'), pad(c, true, 0.8));
  sg2.dispose();
  // Arm wraps: biceps band, forearm wraps, wrist cuffs.
  const wrapC = (v: number) => (Math.floor(v * 6) % 2 === 0 ? leather : shade(leather, 0.82));
  bothArms(c, 'solid', armShell([[-0.12, 0.044], [-0.125, 0.051], [-0.15, 0.05], [-0.155, 0.044]], L.trim, 14, true));
  bothArms(c, 'solid', armShell([[-0.39, 0.04], [-0.4, 0.047], [-0.46, 0.043], [-0.52, 0.036], [-0.55, 0.033], [-0.56, 0.028]], wrapC, 14, true));
  // Leg wraps over the soft boots.
  bothLegs(c, 'solid', legShell([[-0.62, 0.05], [-0.63, 0.057], [-0.7, 0.053], [-0.78, 0.047], [-0.84, 0.043], [-0.85, 0.038]], wrapC, 14));

  // Short asymmetric skirt: short front, long back, slit at the sides.
  makeSkirt(c, {
    top: 0.06,
    rx: 0.1 * c.b + 0.012,
    rz: 0.152 * c.b + 0.012,
    len: (az) => {
      const back = smooth(0.2, -0.6, Math.cos(az * D2R));
      return lerp(0.19, 0.43, back);
    },
    flare: 0.2,
    len1: 0.22,
    anchors: [
      { az: 32, side: 1 },
      { az: -32, side: -1 },
      { az: 148, side: 1 },
      { az: 212, side: -1 },
    ],
    panels: [
      { from: -66, to: 66, anchors: [1, 0], color: (d, len) => (d > len - 0.022 ? L.trim : mixColor(top, L.primaryDark, (d / len) * 0.5)) },
      { from: 112, to: 248, anchors: [2, 3] },
    ],
    color: (d, len, u) => (d > len - 0.026 ? L.trim : u < 0.04 || u > 0.96 ? shade(leather, 0.9) : mixColor(L.primaryDark, top, 0.3 + 0.5 * (d / len))),
    pleats: 6,
    pleatDepth: 0.006,
    density: 9,
    rows: 10,
  });

  // Head: hair pulled back, headband, ponytail.
  const skin = L.skin;
  const secs = face(c, { shape: { width: 0.95, depth: 0.95, jaw: 0.8, chin: -0.004, tall: 0.96 }, skin, iris: 0x3a2618, brow: L.hair, lips: 0x8a4038, eye: 1.2, nose: 0.74, female: true });
  const hairCol = (p: V3) => shade(L.hair, 0.8 + 0.5 * smooth(0.05, 0.22, p.y));
  const line = (p: V3) => lerp(lerp(0.126, 0.166, smooth(0.02, 0.085, p.x)), 0.05, smooth(0.0, -0.085, p.x));
  sb.add('solid', atHead(hairShell(secs, line, hairCol, 0.55, 0.008)), j.head, { role: 'hair' });
  // Gathered knot at the crown-back where the ponytail starts.
  sb.add('solid', atHead(ellipsoid([-0.085, 0.2, 0], [0.036, 0.032, 0.034], hairCol, 12)), j.head, { role: 'hair' });
  // Headband with a knot at the back.
  const band: V3[] = [];
  for (let a = 0; a < 360; a += 30) {
    const th = a * D2R;
    const y = lerp(0.15, 0.128, (1 - Math.cos(th)) / 2) * 0.98;
    band.push(surfPoint(secs, y, th, 0.009));
  }
  sb.add('solid', atHead(sweep(band, () => 0.0036, 6, 28, L.primary, { closedCurve: true, upAt: (p) => V(p.x, 0, p.z).normalize(), flat: 2.6 })), j.head, { role: 'detail' });
  sb.add('solid', atHead(ellipsoid([-0.104, 0.135, -0.03], [0.012, 0.014, 0.016], shade(L.primary, 0.85), 8)), j.head, { role: 'detail' });

  // Ponytail chain (springs drive parts.hair) and headband tails (parts.tails).
  const hairBind = [-0.55, -0.12, -0.1];
  c.parts.hair = chain(j.head, 3, 0.11, V(-0.1, 0.19, 0), hairBind);
  c.parts.tails = chain(j.head, 2, 0.12, V(-0.106, 0.135, -0.04), [-0.7, -0.15]);
  c.rig.root.updateMatrixWorld(true);
  const hb = c.parts.hair as THREE.Bone[];
  const end = V(0, -0.13, 0);
  hb[2].localToWorld(end);
  const pts = [...hb.map((b) => b.getWorldPosition(V())), end];
  pts[0].add(V(0.012, 0.004, 0));
  {
    const ws: Weights[] = [];
    const pony = sweep(pts, (t) => 0.034 * (1 - t) ** 0.65 * (1 + 0.4 * Math.sin(Math.min(1, t * 1.8) * Math.PI)) + 0.005, 10, 20, (p) => shade(L.hair, 0.9 + 0.3 * clamp01((p.y - pts[3].y) / 0.3)), {
      up: V(0, 0, 1),
      flat: 0.82,
      onVertex: (t) => {
        const sv = t * 3;
        const wh = 1 - smooth(0, 0.18, sv);
        const x = Math.max(0, sv - 0.5);
        const i0 = Math.min(2, Math.floor(x));
        const f = Math.min(1, x - i0);
        ws.push([
          [j.head, wh],
          [hb[i0], (1 - wh) * (1 - f)],
          [hb[Math.min(2, i0 + 1)], (1 - wh) * f],
        ]);
      },
    });
    // Poles appended by the caps take the first/last weights.
    ws.push(ws[0], ws[ws.length - 1]);
    sb.add('solid', pony, ws, { role: 'hair' });
  }
  const tb = c.parts.tails as THREE.Bone[];
  for (const dz of [0.012, -0.012]) {
    const tend = V(0, -0.13, dz);
    tb[1].localToWorld(tend);
    const tp = [tb[0].getWorldPosition(V()).add(V(0, 0, dz)), tb[1].getWorldPosition(V()).add(V(0, 0, dz * 2)), tend];
    const ws: Weights[] = [];
    const rib = sweep(tp, () => 0.0028, 4, 10, L.primary, {
      up: V(0, 0, 1),
      flat: 4,
      onVertex: (t) => {
        const f = smooth(0.35, 0.65, t);
        ws.push([
          [tb[0], 1 - f],
          [tb[1], f],
        ]);
      },
    });
    ws.push(ws[0], ws[ws.length - 1]);
    sb.add('double', rib, ws);
  }
}

function thane(c: Ctx): void {
  const { L, sb, W, j } = c;
  const robe = new THREE.Color(L.primary);
  const dark = new THREE.Color(L.primaryDark);
  const gold = new THREE.Color(L.trim);
  const brown = new THREE.Color(L.secondary);
  body(c, {
    paint: {
      torso: (p, y) => (y < 0.03 ? L.trousers : Math.abs(p.z) < 0.04 && p.x > 0 && y < 0.5 ? (Math.abs(p.z) > 0.03 ? gold : brown) : mixColor(dark, robe, 0.5 + 0.5 * smooth(0.0, 0.45, y))),
      neck: dark,
      arm: (y) => (y < -0.54 ? L.glove ?? L.secondary : mixColor(dark, robe, 0.6 + 0.4 * smooth(-0.4, 0, y))),
      leg: (y) => (y < -0.62 ? L.boots : L.trousers),
    },
    hand: L.glove ?? L.secondary,
    boot: { main: L.boots, sole: shade(L.boots, 0.6), width: 1.04 },
    legExtra: (y) => 0.008 * smooth(-0.6, -0.64, y),
  });
  // Sash and buckle.
  torsoBand(c, 0.015, 0.125, 0.02, L.belt, 'solid', 2);
  torsoBand(c, 0.05, 0.09, 0.028, shade(L.belt, 0.75), 'solid', 1);
  const fb = onTorso(c, 0.07, 0, 0.034);
  sb.add('metal', loft([{ y: -0.03, xf: 0.008, zw: 0.022, nf: 4 }, { y: 0, xf: 0.014, zw: 0.03, nf: 4 }, { y: 0.03, xf: 0.008, zw: 0.022, nf: 4 }], 12, 1, gold).translate(fb.x, fb.y, 0), W.torso);

  // Wide sleeves with gold hems.
  bothArms(
    c,
    'double',
    pleat(
      armShell(
        [
          [-0.22, 0.062],
          [-0.3, 0.07],
          [-0.42, 0.086],
          [-0.52, 0.098],
          [-0.575, 0.102],
        ],
        (v) => (v > 0.86 ? gold : mixColor(robe, dark, v * 0.5)),
        20,
      ),
      SHOULDER_Z,
      BIND.shoulder - 0.26,
      BIND.shoulder - 0.575,
      0.008,
      5,
    ),
  );

  // Mantle: short shoulder cape, longer at the back, gold edge; the shoulders ride with the arms.
  const padN = pad(c, false, 0.45);
  const padF = pad(c, true, 0.45);
  {
    const ws: Weights[] = [];
    const top = BIND.neck + 0.03;
    const geo = surface(
      40,
      8,
      true,
      (u, v, out) => {
        const th = u * Math.PI * 2;
        const cth = Math.cos(th);
        const sth = Math.sin(th);
        const side = Math.abs(sth);
        const back = clamp01(-cth);
        const len = 0.17 + 0.08 * back + 0.04 * clamp01(cth) - 0.02 * side;
        const d = v * len;
        const rx = lerp(0.08, 0.2, Math.min(1, d / 0.1) ** 0.6) + d * 0.08;
        const rz = lerp(0.1, 0.32, Math.min(1, d / 0.05) ** 0.45) + d * 0.1;
        out.set(rx * Math.sign(cth) * Math.abs(cth) ** 0.9 - 0.01, top - d - 0.03 * smooth(0.5, 1, side) * Math.min(1, d / 0.08), rz * Math.sign(sth) * Math.abs(sth) ** 0.85);
        const arm = smooth(0.5, 0.95, side) * smooth(0.0, 0.08, d);
        ws.push([
          [j.chest, 1 - arm],
          [sth >= 0 ? padN : padF, arm],
        ]);
      },
      (_p, _u, v) => (v > 0.84 ? gold : mixColor(dark, shade(dark, 1.15), v)),
    );
    sb.add('double', geo, ws);
  }

  // Long robe: two halves split front and back, plus a front tabard; panels part around the legs.
  const robeCol = (d: number, len: number) => (d > len - 0.03 ? gold : mixColor(robe, dark, 0.15 + (d / len) * 0.45));
  makeSkirt(c, {
    top: 0.075,
    rx: 0.118 * c.b,
    rz: 0.17 * c.b,
    len: () => 0.86,
    flare: 0.17,
    len1: 0.44,
    anchors: [
      { az: 32, side: 1 },
      { az: 90, side: 1 },
      { az: 148, side: 1 },
      { az: 212, side: -1 },
      { az: 270, side: -1 },
      { az: 328, side: -1 },
    ],
    panels: [
      {
        from: -13,
        to: 177,
        anchors: [0, 1, 2],
        grow: (u) => 0.012 * (1 - smooth(0.0, 0.1, u)),
        color: (d, len, u) => (d > len - 0.03 || u < 0.022 ? gold : u < 0.07 ? brown : robeCol(d, len)),
      },
      { from: 183, to: 353, anchors: [3, 4, 5] },
    ],
    color: robeCol,
    pleats: 8,
    pleatDepth: 0.009,
    density: 8,
    rows: 14,
  });

  makeCape(c, {
    segments: 4,
    length: 0.86,
    ox: -0.09,
    oy: 0.19,
    wTop: 0.2,
    wBot: 0.29,
    wrap: 0.03,
    bow: (d) => 0.04 + d * 0.15,
    outer: (d) => (d > 0.83 ? gold : mixColor(dark, shade(dark, 0.8), d)),
  });

  // Ceremonial helmet: smooth mask, eye slit, centre ridge, tall forked crest; cowl over it.
  const metal = new THREE.Color(L.metal);
  const hs: Sec[] = [
    { y: -0.05, ox: 0.066, xf: 0.012, xb: 0.016, zw: 0.022 },
    { y: -0.028, ox: 0.055, xf: 0.036, xb: 0.042, zw: 0.052, nf: 1.7 },
    { y: 0.02, ox: 0.036, xf: 0.072, xb: 0.072, zw: 0.082, nf: 1.75 },
    { y: 0.07, ox: 0.02, xf: 0.096, xb: 0.096, zw: 0.098, nf: 2.0 },
    { y: 0.12, ox: 0.012, xf: 0.106, xb: 0.11, zw: 0.104, nf: 2.3 },
    { y: 0.17, ox: 0.006, xf: 0.104, xb: 0.116, zw: 0.104 },
    { y: 0.21, ox: 0.0, xf: 0.09, xb: 0.108, zw: 0.092 },
    { y: 0.245, ox: -0.004, xf: 0.06, xb: 0.08, zw: 0.064 },
    { y: 0.265, ox: -0.006, xf: 0.022, xb: 0.03, zw: 0.024 },
    { y: 0.27, ox: -0.006, xf: 0.005, xb: 0.006, zw: 0.005 },
  ];
  const hcol = (p: V3) => mixColor(shade(metal, 0.72), metal, smooth(-0.05, 0.18, p.y) * 0.7 + 0.3 * clamp01(p.x * 8));
  sb.add('metal', atHead(loft(hs, 28, 3, hcol)), j.head);
  sb.add('metal', atHead(sweep([V(frontX(hs, 0.2, 0) - 0.002, 0.2, 0), V(frontX(hs, 0.12, 0) + 0.002, 0.13, 0), V(frontX(hs, 0.05, 0) + 0.002, 0.05, 0), V(frontX(hs, -0.03, 0), -0.03, 0)], () => 0.005, 6, 16, gold, { up: V(1, 0, 0), flat: 1.6 })), j.head);
  const slit = (y: number, grow: number) => [-0.072, -0.05, -0.025, 0, 0.025, 0.05, 0.072].map((z) => V(frontX(hs, y, z) + grow, y - Math.abs(z) * 0.1 + (Math.abs(z) < 0.03 ? 0.0 : 0.0), z));
  sb.add('metal', atHead(sweep(slit(0.143, 0.006), () => 0.0055, 6, 16, gold, { up: V(1, 0, 0), flat: 1.8 })), j.head);
  const vis = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x0c0f14), toneMapped: true });
  c.parts.visor = vis;
  const visor = new THREE.Mesh(sweep(slit(0.122, 0.002), () => 0.002, 6, 16, 0xffffff, { up: V(1, 0, 0), flat: 5 }), vis);
  j.head.add(visor);
  c.rigid.push(visor);
  // Crest: stem with forward/back prongs (a "Y" in profile).
  const fin = (pts: V3[], w: number) => sb.add('metal', atHead(sweep(pts, (t) => 0.0065 * (1 - t * 0.3), 6, 10, gold, { up: V(0, 0, 1), flat: w })), j.head);
  fin([V(0.02, 0.24, 0), V(0.0, 0.3, 0), V(-0.012, 0.345, 0)], 3.4);
  fin([V(-0.012, 0.335, 0), V(0.02, 0.38, 0), V(0.06, 0.425, 0)], 2.6);
  fin([V(-0.012, 0.335, 0), V(-0.05, 0.375, 0), V(-0.085, 0.41, 0)], 2.6);
  hood(c, hs, 1.14, 62, (p) => mixColor(shade(dark, 0.8), dark, smooth(-0.1, 0.2, p.y)));
}

// ---------------------------------------------------------------------------------------------- build

const SPECS: Record<CharacterLook['costume'], (b: number) => BodySpec> = {
  jedi: (b) => bodySpec(ATHLETIC, b),
  marauder: (b) => ({ ...bodySpec(ATHLETIC, b, b * 0.95), hand: 1.08, foot: 1.05 }),
  acrobat: (b) => ({
    ...bodySpec(
      {
        ...ATHLETIC,
        torso: [
          [-0.118, 0.0, 0.03, 0.03, 0.04, 2, 2],
          [-0.095, 0.0, 0.074, 0.082, 0.1, 2, 2],
          [-0.055, 0.0, 0.1, 0.116, 0.158, 2.3, 2.2],
          [0.0, 0.0, 0.104, 0.118, 0.172, 2.4, 2.3],
          [0.05, 0.004, 0.098, 0.108, 0.162, 2.4, 2.4],
          [0.11, 0.01, 0.088, 0.092, 0.128, 2.4, 2.4],
          [0.18, 0.012, 0.094, 0.094, 0.135, 2.4, 2.4],
          [0.26, 0.016, 0.106, 0.098, 0.148, 2.5, 2.4],
          [0.33, 0.03, 0.128, 0.1, 0.158, 2.6, 2.4],
          [0.4, 0.034, 0.13, 0.104, 0.162, 2.5, 2.4],
          [0.47, 0.016, 0.116, 0.104, 0.165, 2.5, 2.4],
          [0.545, 0.0, 0.094, 0.098, 0.168, 2.5, 2.5],
          [0.585, -0.008, 0.07, 0.078, 0.14, 2.4, 2.3],
          [0.612, -0.012, 0.046, 0.052, 0.08, 2, 2],
          [0.625, -0.012, 0.018, 0.02, 0.028, 2, 2],
        ],
        neck: [0.054, 0.045],
        arm: ATHLETIC.arm.map(([y, r, ez]) => [y, r * (y > -0.12 ? 0.86 + 0.14 * smooth(0.0, -0.12, y) : 1) * (y < -0.3 ? 0.95 : 1), ez]),
      },
      b,
    ),
    hand: 0.92,
    foot: 0.92,
  }),
  warden: (b) => ({
    ...bodySpec(
      {
        ...ATHLETIC,
        torso: [
          [-0.118, 0.0, 0.03, 0.03, 0.04, 2, 2],
          [-0.095, 0.0, 0.075, 0.08, 0.1, 2, 2],
          [-0.055, 0.0, 0.105, 0.115, 0.15, 2.3, 2.2],
          [0.0, 0.0, 0.112, 0.118, 0.165, 2.4, 2.3],
          [0.05, 0.004, 0.11, 0.112, 0.162, 2.4, 2.4],
          [0.11, 0.008, 0.106, 0.106, 0.158, 2.4, 2.4],
          [0.18, 0.012, 0.11, 0.104, 0.16, 2.4, 2.4],
          [0.26, 0.016, 0.118, 0.106, 0.166, 2.5, 2.4],
          [0.34, 0.019, 0.126, 0.108, 0.174, 2.6, 2.4],
          [0.42, 0.02, 0.13, 0.11, 0.18, 2.6, 2.4],
          [0.49, 0.012, 0.122, 0.11, 0.18, 2.6, 2.4],
          [0.545, 0.0, 0.1, 0.102, 0.172, 2.6, 2.5],
          [0.585, -0.008, 0.075, 0.085, 0.145, 2.4, 2.3],
          [0.612, -0.012, 0.052, 0.058, 0.09, 2, 2],
          [0.625, -0.012, 0.022, 0.024, 0.032, 2, 2],
        ],
        arm: ATHLETIC.arm.map(([y, r, ez]) => [y, r * (y > -0.3 ? 1.12 : 1.04), ez]),
      },
      b,
    ),
    hand: 1.04,
    foot: 1.02,
  }),
};

const ROLE_TOON: Record<ToonRole, { toon: [number, number, number, number]; shade: [number, number, number]; outline: number }> = {
  // [shadeShift, shadeToony, matcap (0 none / 1 metal / 2 hair), face]; shade = multiplier on the lit colour.
  skin: { toon: [0.08, 0.86, 0, 0], shade: [0.86, 0.56, 0.5], outline: 1 },
  face: { toon: [0.12, 0.85, 0, 1], shade: [0.9, 0.64, 0.58], outline: 1 },
  hair: { toon: [0.02, 0.9, 2, 0], shade: [0.52, 0.42, 0.52], outline: 0.85 },
  cloth: { toon: [0.0, 0.9, 0, 0], shade: [0.56, 0.47, 0.6], outline: 1 },
  leather: { toon: [0.0, 0.9, 0, 0], shade: [0.55, 0.42, 0.44], outline: 1 },
  metal: { toon: [0.05, 0.92, 1, 0], shade: [0.42, 0.42, 0.5], outline: 1 },
  feature: { toon: [1.5, 0.9, 0, 1], shade: [1, 1, 1], outline: 0 },
  detail: { toon: [0.0, 0.9, 0, 0], shade: [0.56, 0.47, 0.6], outline: 0.5 },
};

/** Procedural bodies: per-vertex toon role from the layer, the part's role, or its palette colour. */
function toonClassifier(L: CharacterLook): ToonClassifier {
  const skin = new THREE.Color(L.skin);
  const hair = new THREE.Color(L.hair);
  const near = (a: THREE.Color, b: THREE.Color) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 0.004;
  return (c, layer, opts) => {
    let role: ToonRole = opts.role ?? (near(c, skin) ? 'skin' : near(c, hair) ? 'hair' : layer === 'metal' ? 'metal' : 'cloth');
    if (layer === 'metal' && (role === 'cloth' || role === 'detail' || role === 'leather')) role = 'metal';
    if (!opts.role && role === 'cloth' && near(c, skin)) role = 'skin';
    const r = ROLE_TOON[role];
    return { toon: r.toon, shade: r.shade, outline: opts.outline ?? r.outline };
  };
}

/**
 * Build the fighter's skinned body and costume. Joints must be THREE.Bone; the rig is posed at rest
 * (identity joint rotations, hips at REST_HIP) while parts are modelled and the skeleton is bound.
 */
/** Put the rig in its bind pose: root at identity, joint rotations identity, hips at REST_HIP. */
export function restPose(rig: FighterRig): void {
  const j = rig.j;
  rig.root.position.set(0, 0, 0);
  rig.root.rotation.set(0, 0, 0);
  rig.root.scale.set(1, 1, 1);
  for (const k of Object.keys(j) as Array<keyof Joints>) j[k].quaternion.identity();
  j.body.position.set(0, REST_HIP, 0);
  j.upperN.position.set(0, CHEST_TO_SHOULDER, SHOULDER_Z);
  j.upperF.position.set(0, CHEST_TO_SHOULDER, -SHOULDER_Z);
}

export function buildCostume(rig: FighterRig, L: CharacterLook): CostumeBuild {
  const j = rig.j;
  const b = L.bulk;
  const parts: CostumeParts = { cape: [], hair: [], tails: [] };
  restPose(rig);
  // Off-hand fist / palm bones.
  const fistF = bone(j.handF);
  const palmF = bone(j.handF);
  parts.fistF = fistF;
  parts.palmF = palmF;
  rig.root.updateMatrixWorld(true);

  const spec = SPECS[L.costume](b);
  const sb = new SkinBuilder(toonClassifier(L));
  const c: Ctx = { rig, j, L, b, sb, W: rigWeights(j), parts, spec, secs: torsoSecs(spec), rigid: [] };
  sb.use(fistF, palmF);
  if (L.costume === 'jedi') kael(c);
  else if (L.costume === 'marauder') vexa(c);
  else if (L.costume === 'acrobat') asha(c);
  else thane(c);

  rig.root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(sb.bones);
  const meshes: THREE.Mesh[] = [];
  // One toon draw for body + costume (per-vertex toon params), plus its inverted-hull outline.
  const geo = sb.buildMerged();
  if (geo) {
    const mesh = new THREE.SkinnedMesh(geo, rig.cloth);
    mesh.name = 'fighter-body';
    mesh.frustumCulled = false;
    rig.root.add(mesh);
    mesh.bind(skeleton, new THREE.Matrix4());
    meshes.push(mesh);
    meshes.push(addOutline(mesh, rig.ink));
  }
  meshes.push(...c.rigid);
  palmF.scale.setScalar(1e-3);
  return { parts, meshes, skeleton, triangles: sb.triangles() };
}

