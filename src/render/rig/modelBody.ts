import * as THREE from 'three';
import { LOOKS, type CharacterLook } from '../characters';
import { OUTLINE_REF, toonExtras, type CharacterModel } from '../characterModels';
import type { Expression } from '../anim/Animator';
import { REST_HIP } from './body';
import { restPose, type CostumeBuild, type CostumeParts, type SkirtAnchor } from './costumes';
import type { FighterRig, Joints } from './FighterRig';
import { toonDefaults, toonMaterial, toonOutlineMaterial, trackOutlineResolution, type ToonParams, type ToonSlot } from './toon';

/**
 * Bind a loaded character model (art/CHARACTER_PIPELINE.md) to a rig's own joints.
 *
 * The GLB is authored in the rig's rest pose, so the binding ignores the GLB armature's bone orientations:
 * the rig is put in its rest pose (identity joint rotations, hips at REST_HIP), the §5 extra bones are
 * created at the GLB's rest head positions, and a Skeleton is built from the rig's bones in the GLB's
 * joint order with bind inverses taken from that rest pose. applyPose / IK / cloth then drive the mesh
 * exactly as they drive the procedural body.
 */

const CORE: Array<keyof Joints> = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'upperN',
  'foreN',
  'handN',
  'upperF',
  'foreF',
  'handF',
  'thighN',
  'shinN',
  'footN',
  'thighF',
  'shinF',
  'footF',
];

/** Rest rotation (about z) of chain bones, matching updateCloth's neutral values so the authored shape is
 * what the game shows when the springs are at rest. */
function bindRotation(name: string): number {
  const hair = /^hair_(\d+)$/.exec(name);
  if (hair) return Number(hair[1]) === 0 ? -0.35 : -0.1;
  const tail = /^tail_(\d+)$/.exec(name);
  if (tail) return Number(tail[1]) === 0 ? -0.6 : -0.15;
  return 0;
}

/** Contract parent of an extra bone (§5), or null when the name isn't a known extra. */
function conventionParent(name: string): string | null {
  let m = /^skirt_(.+)_(\d+)$/.exec(name);
  if (m) return Number(m[2]) === 0 ? 'hips' : `skirt_${m[1]}_${Number(m[2]) - 1}`;
  m = /^(cape|hair|tail)_(\d+)$/.exec(name);
  if (m) {
    const k = Number(m[2]);
    if (k > 0) return `${m[1]}_${k - 1}`;
    return m[1] === 'cape' ? 'chest' : 'head';
  }
  if (name === 'pad_N' || name === 'pad_F') return 'chest';
  return null;
}

/** Order so that every bone comes after its parent. */
function parentFirst(names: string[], parentOf: (n: string) => string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string, depth: number) => {
    if (seen.has(n) || depth > 32) return;
    const p = parentOf(n);
    if (names.includes(p)) visit(p, depth + 1);
    seen.add(n);
    out.push(n);
  };
  for (const n of names) visit(n, 0);
  return out;
}

export interface ModelMaterials {
  owned: THREE.Material[];
  visor: THREE.MeshBasicMaterial | null;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const col3 = (v: unknown): THREE.Color | null => (Array.isArray(v) && v.length >= 3 && v.every((n) => typeof n === 'number') ? new THREE.Color(v[0], v[1], v[2]) : null);

/** Toon role from a contract material name (defaults when a GLB has no toon extras). */
function roleOf(name: string): Parameters<typeof toonDefaults>[0] {
  if (name === 'MAT-face') return 'face';
  if (name === 'MAT-skin') return 'skin';
  if (name === 'MAT-eyes') return 'eyes';
  if (name.startsWith('MAT-hair') || name === 'MAT-brows' || name === 'MAT-lashes') return 'hair';
  if (name.endsWith('_metal')) return 'metal';
  if (name.endsWith('_leather')) return 'leather';
  return 'cloth';
}

/** Toon parameters: contract defaults by role, overridden by the material's `toon` extras (pipeline v5). */
function toonParams(src: THREE.Material): ToonParams {
  const p = toonDefaults(roleOf(src.name));
  const t = toonExtras(src);
  if (t) {
    p.shadeColor = col3(t.shadeColor) ?? p.shadeColor;
    p.shadeShift = num(t.shadeShift, p.shadeShift);
    p.shadeToony = num(t.shadeToony, p.shadeToony);
    p.rimColor = col3(t.rimColor);
    p.rimPower = num(t.rimPower, p.rimPower);
    p.outlineWidth = num(t.outlineWidth, p.outlineWidth);
    p.outlineColor = col3(t.outlineColor) ?? p.outlineColor;
    if (t.matcap === 'metal' || t.matcap === 'hair' || t.matcap === 'none') p.matcap = t.matcap;
    // Deeper shade than VRoid/MToon defaults: figures must hold against the warm arena haze.
    p.shadeColor.multiplyScalar(0.85);
  }
  return p;
}

/**
 * Per-rig toon material for a template material: GG cel shading from the toon extras, hair cut-out,
 * unlit eyes, visor glow, mirror-match tints, and the rig's shared rim / hit-flash uniforms.
 * `fine` = brows / lashes: soft alpha-blended cards (cut-out makes them blocky).
 */
function rigMaterial(src: THREE.Material, rig: FighterRig, look: CharacterLook, mats: ModelMaterials, fine = false): THREE.Material {
  const name = src.name;
  if (name === 'MAT-visor') {
    if (!mats.visor) {
      mats.visor = new THREE.MeshBasicMaterial({ name: 'MAT-visor', color: new THREE.Color(look.weapon.blade).multiplyScalar(2.4), toneMapped: false });
      mats.owned.push(mats.visor);
    }
    return mats.visor;
  }
  const std = src as THREE.MeshStandardMaterial;
  const color = (std.color ?? new THREE.Color(1, 1, 1)).clone();
  // Mirror-match palettes: tint the tintable costume materials by alt / default palette colour.
  const tint = /_(primary|secondary|trim)$/.exec(name);
  let shadeTint: THREE.Color | null = null;
  if (tint) {
    const key = tint[1] as 'primary' | 'secondary' | 'trim';
    const base = new THREE.Color(LOOKS[look.id][key]);
    const want = new THREE.Color(look[key]);
    if (!base.equals(want)) {
      const r = (a: number, b: number) => Math.min(4, a / Math.max(0.02, b));
      shadeTint = new THREE.Color(r(want.r, base.r), r(want.g, base.g), r(want.b, base.b));
      color.multiply(shadeTint);
    }
  }
  const params = toonParams(src);
  if (shadeTint) params.shadeColor.multiply(shadeTint);
  const hair = roleOf(name) === 'hair';
  const cutout = std.alphaTest > 0 || std.transparent || hair;
  const m = toonMaterial(rig.toonUniforms(), {
    name,
    color,
    map: std.map ?? null,
    params,
    alphaTest: fine ? 0.04 : cutout ? Math.max(0.35, std.alphaTest || 0.5) : 0,
    side: hair || std.side === THREE.DoubleSide ? THREE.DoubleSide : THREE.FrontSide,
    transparent: fine,
    depthWrite: !fine,
  });
  mats.owned.push(m);
  return m;
}

/**
 * Per-rig slot material for a group: each slot's colour (mirror-tinted), map, toon params and cut-out, plus
 * the rig's shared rim / hit-flash uniforms.
 */
function slotMaterial(sources: THREE.Material[], doubleSided: boolean, rig: FighterRig, look: CharacterLook, mats: ModelMaterials): THREE.Material {
  const slots: ToonSlot[] = sources.map((src) => {
    const std = src as THREE.MeshStandardMaterial;
    const color = (std.color ?? new THREE.Color(1, 1, 1)).clone();
    const params = toonParams(src);
    const tint = /_(primary|secondary|trim)$/.exec(src.name);
    if (tint) {
      const key = tint[1] as 'primary' | 'secondary' | 'trim';
      const base = new THREE.Color(LOOKS[look.id][key]);
      const want = new THREE.Color(look[key]);
      if (!base.equals(want)) {
        const r = (a: number, b: number) => Math.min(4, a / Math.max(0.02, b));
        const k = new THREE.Color(r(want.r, base.r), r(want.g, base.g), r(want.b, base.b));
        color.multiply(k);
        params.shadeColor.multiply(k);
      }
    }
    const hair = roleOf(src.name) === 'hair';
    const cutout = std.alphaTest > 0 || std.transparent || hair;
    return { color, map: std.map ?? null, params, alphaTest: cutout ? Math.max(0.35, std.alphaTest || 0.5) : 0 };
  });
  const m = toonMaterial(rig.toonUniforms(), { name: `slots(${sources.map((x) => x.name).join(',')})`, slots, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide });
  mats.owned.push(m);
  return m;
}

export interface ModelBuild extends CostumeBuild {
  /** Meshes whose geometry belongs to the shared template (do not dispose with the rig). */
  borrowed: THREE.Mesh[];
  materials: THREE.Material[];
  skeletons: THREE.Skeleton[];
}

export function buildModelBody(rig: FighterRig, look: CharacterLook, model: CharacterModel): ModelBuild {
  const j = rig.j;
  restPose(rig);
  const byName = new Map<string, THREE.Bone>();
  for (const k of CORE) byName.set(k, j[k]);
  rig.root.updateMatrixWorld(true);

  // ---- §5 extras: created under their contract parents at the GLB rest heads.
  const extras = [...model.bones.keys()].filter((n) => !byName.has(n));
  const parentOf = (n: string) => conventionParent(n) ?? model.bones.get(n)?.parent ?? 'hips';
  for (const name of parentFirst(extras, parentOf)) {
    const info = model.bones.get(name);
    if (!info) continue;
    let parent = byName.get(parentOf(name));
    if (!parent) {
      if (!/^(skirt|cape|hair|tail|pad)_/.test(name) && model.bones.get(name)?.parent === null) continue; // armature root
      parent = j.hips;
    }
    const b = new THREE.Bone();
    b.name = name;
    parent.add(b);
    parent.updateMatrixWorld(true);
    b.position.copy(parent.worldToLocal(info.head.clone()));
    b.rotation.z = bindRotation(name);
    b.updateMatrixWorld(true);
    byName.set(name, b);
  }
  rig.root.updateMatrixWorld(true);

  // ---- Skeletons (one per GLB skin) from our bones in the GLB's joint order; bind = rest pose.
  const skeletons = new Map<string, THREE.Skeleton>();
  const skeletonFor = (names: string[]) => {
    const key = names.join('|');
    let s = skeletons.get(key);
    if (!s) {
      const missing = names.filter((n) => !byName.has(n));
      if (missing.length) console.warn(`[models] ${look.id}: unknown joints ${missing.join(', ')} bound to hips`);
      s = new THREE.Skeleton(names.map((n) => byName.get(n) ?? j.hips));
      skeletons.set(key, s);
    }
    return s;
  };

  const mats: ModelMaterials = { owned: [], visor: null };
  const borrowed: THREE.Mesh[] = [];
  const meshes: THREE.Mesh[] = [];
  const palmMorphs: Array<{ influences: number[]; index: number }> = [];
  const exprMorphs: NonNullable<CostumeParts['exprMorphs']> = [];
  /** Morph-driven meshes (fills and hulls) each get their own influences, registered for palm / face. */
  const registerMorphs = (mesh: THREE.Mesh, dict: Record<string, number> | null) => {
    if (!dict) return;
    mesh.morphTargetDictionary = { ...dict };
    mesh.morphTargetInfluences = new Array(Object.keys(dict).length).fill(0);
    if (dict.palmOpen !== undefined) palmMorphs.push({ influences: mesh.morphTargetInfluences, index: dict.palmOpen });
    const map: Array<[keyof Expression, number]> = [];
    for (const key of ['blink', 'angry', 'shout', 'pain', 'smile', 'focus'] as const) {
      const i = dict[`expr_${key}`];
      if (i !== undefined) map.push([key, i]);
    }
    if (map.length) exprMorphs.push({ influences: mesh.morphTargetInfluences, map });
  };
  const place = (mesh: THREE.SkinnedMesh, skin: string[]) => {
    mesh.frustumCulled = false;
    rig.root.add(mesh);
    mesh.bind(skeletonFor(skin), new THREE.Matrix4());
    borrowed.push(mesh);
  };

  // ---- Slot draws: every material of a render state in one draw (toon.ts slot mode).
  for (const group of model.groups) {
    const material = slotMaterial(group.slots, group.doubleSided, rig, look, mats);
    const mesh = new THREE.SkinnedMesh(group.geometry, material);
    mesh.name = `model-${group.cutout ? 'cutout' : 'solid'}${group.doubleSided ? '2' : ''}`;
    registerMorphs(mesh, group.morphs);
    // Shadow casters: the opaque draws only (cut-outs are face, eyes and hair cards).
    if (group.cutout) mesh.userData.noShadow = true;
    place(mesh, group.skin);
  }

  // ---- Parts drawn on their own (soft brows / lashes, glows, blended materials).
  const fineMats = new Map<THREE.Material, THREE.Material>();
  const cardMats = new Map<THREE.Material, THREE.Material>();
  for (const part of model.parts) {
    const fine = /brow|lash/i.test(part.name);
    const cache = fine ? fineMats : cardMats;
    let material = cache.get(part.material);
    if (!material) {
      material = rigMaterial(part.material, rig, look, mats, fine);
      cache.set(part.material, material);
    }
    const skin = part.rigidBone && !byName.has(part.rigidBone) ? ['head'] : part.skin;
    const mesh = new THREE.SkinnedMesh(part.geometry, material);
    mesh.name = `model-${part.name || 'part'}`;
    registerMorphs(mesh, part.morphs);
    if (fine) mesh.renderOrder = 1;
    // Shadow casters: only big opaque pieces (faces, eyes, trims, glows and small parts skip the pass).
    part.geometry.computeBoundingSphere();
    const small = (part.geometry.boundingSphere?.radius ?? 1) < 0.3;
    const mName = part.material.name;
    const cut = roleOf(mName) === 'hair' || part.material.alphaTest > 0;
    if (fine || small || cut || mName === 'MAT-eyes' || mName === 'MAT-visor' || mName === 'MAT-face' || mName.endsWith('_trim')) mesh.userData.noShadow = true;
    place(mesh, skin);
  }

  // ---- Ink outline: one inverted hull per skin (union of the parts' morphs), skinned like the parts.
  const ink = toonOutlineMaterial({ mask: true, vertexOutlineColor: true, width: OUTLINE_REF, minPx: 3.4, maxPx: 4.2 });
  mats.owned.push(ink);
  for (const h of model.hulls) {
    const hull = new THREE.SkinnedMesh(h.geometry, ink);
    hull.name = 'model-outline';
    hull.userData.outline = true;
    hull.userData.noShadow = true;
    trackOutlineResolution(hull);
    registerMorphs(hull, h.morphs);
    place(hull, h.skin);
  }

  // ---- Parts driven by updateCloth.
  const parts: CostumeParts = { cape: [], hair: [], tails: [] };
  const chain = (prefix: string) => {
    const out: THREE.Bone[] = [];
    for (let i = 0; byName.has(`${prefix}_${i}`); i += 1) out.push(byName.get(`${prefix}_${i}`) as THREE.Bone);
    return out;
  };
  parts.cape = chain('cape');
  parts.hair = chain('hair');
  parts.tails = chain('tail');
  if (parts.cape.length) {
    const minY = Math.min(...parts.cape.map((b) => model.bones.get(b.name)?.minY ?? Infinity));
    const top = model.bones.get('cape_0')?.head.y ?? 0;
    parts.capeLength = Number.isFinite(minY) ? Math.max(0.2, top - minY) : 0.3 * parts.cape.length;
  }
  for (const [name, arm] of [
    ['pad_N', j.upperN],
    ['pad_F', j.upperF],
  ] as const) {
    const b = byName.get(name);
    if (b) (parts.pads ??= []).push({ bone: b, arm, follow: 0.45 });
  }
  const anchors = skirtAnchors(rig, byName, model);
  if (anchors.length) parts.skirt = { anchors, knee: 0.1 * look.bulk, ankle: 0.085 * look.bulk };
  if (palmMorphs.length) parts.palmMorphs = palmMorphs;
  if (exprMorphs.length) parts.exprMorphs = exprMorphs;
  if (mats.visor) parts.visor = mats.visor;

  return {
    parts,
    meshes,
    borrowed,
    materials: mats.owned,
    skeleton: [...skeletons.values()][0] ?? new THREE.Skeleton([]),
    skeletons: [...skeletons.values()],
    triangles: model.triangles,
  };
}

/** Skirt panel anchors from `skirt_<label>_0` (+ optional `_1`) bones: azimuth from the rest head. */
function skirtAnchors(rig: FighterRig, byName: Map<string, THREE.Bone>, model: CharacterModel): SkirtAnchor[] {
  const out: SkirtAnchor[] = [];
  for (const [name, upper] of byName) {
    const m = /^skirt_(.+)_0$/.exec(name);
    if (!m) continue;
    const pivot = upper.position.clone(); // hips space (hips at identity in the rest pose)
    const az = Math.atan2(pivot.z, pivot.x);
    const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const axis = new THREE.Vector3(0, -1, 0).cross(dir).normalize();
    let lower = byName.get(`skirt_${m[1]}_1`);
    const hemUpper = model.bones.get(name)?.minY ?? Infinity;
    const hemLower = lower ? (model.bones.get(lower.name)?.minY ?? Infinity) : Infinity;
    const pivotY = REST_HIP + pivot.y;
    if (!lower) {
      // Single-segment panel: give it an unweighted lower bone so the solver can treat it uniformly.
      lower = new THREE.Bone();
      lower.name = `skirt_${m[1]}_1(auto)`;
      const drop = Number.isFinite(hemUpper) ? Math.max(0.1, pivotY - hemUpper) : 0.3;
      lower.position.set(0, -drop, 0);
      upper.add(lower);
    }
    const low = lower.position.clone();
    const rest = Math.max(0, Math.atan2(low.x * dir.x + low.z * dir.z, -low.y));
    const lowY = pivotY + low.y;
    const hem = Math.min(hemUpper, hemLower);
    const len2 = Number.isFinite(hemLower) ? Math.max(0.03, lowY - hemLower) : 0.05;
    const long = Number.isFinite(hem) ? pivotY - hem > 0.55 : false;
    const side: 1 | -1 | 0 = Math.abs(Math.sin(az)) < 0.26 ? 0 : Math.sin(az) > 0 ? 1 : -1;
    out.push({ upper, lower, side, dir, axis, pivot, low, rest, long, len2 });
  }
  void rig;
  return out;
}
