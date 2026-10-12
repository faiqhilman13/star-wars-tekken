import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CharacterId } from '../sim/types';

/**
 * Realistic fighter models (art/CHARACTER_PIPELINE.md): `public/models/<id>.glb`, authored around the
 * game's exact rest skeleton. Each GLB is fetched and parsed once into a template that every rig of that
 * character shares (geometry and textures); rigs clone the materials and bind the geometry to their own
 * joints (see rig/modelBody.ts).
 *
 * A missing or broken GLB is not an error: the rig keeps its procedural body. Missing files are detected
 * by the glTF magic number (dev servers answer unknown paths with index.html), so nothing is logged.
 */

export const MODEL_IDS: readonly CharacterId[] = ['kael', 'vexa', 'asha', 'thane'];

/** One drawable piece of a model (one glTF primitive / material), in rig-root bind space. */
export interface ModelPart {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Joint names in skinIndex order (rigid parts: just the bone they ride on, `rigidBone`). */
  skin: string[];
  rigidBone: string | null;
  morphs: Record<string, number> | null;
}

export interface ModelBone {
  name: string;
  /** Parent bone name in the GLB hierarchy (null at the root). */
  parent: string | null;
  /** Rest (bind) head position in rig-root space. */
  head: THREE.Vector3;
  /** Lowest point of the vertices weighted (>= 0.25) to this bone; +Infinity if none. */
  minY: number;
}

/** Ink-outline hull geometry (inverted hull), skinned like the parts it outlines. */
export interface ModelHull {
  geometry: THREE.BufferGeometry;
  skin: string[];
  /** Union of the outlined parts' morph targets (static parts carry zero deltas). */
  morphs: Record<string, number> | null;
}

/**
 * Many materials in one draw: parts sharing a skin and render state (side, cut-out) are merged, each
 * vertex carrying a `slot` index into per-material uniforms and textures (toon.ts slot mode).
 */
export interface ModelGroup {
  name: string;
  geometry: THREE.BufferGeometry;
  /** Source materials by slot index. */
  slots: THREE.Material[];
  skin: string[];
  doubleSided: boolean;
  cutout: boolean;
  /** Union of the members' morph targets. */
  morphs: Record<string, number> | null;
}

/** Most materials one slot draw handles (texture units stay well inside WebGL2 minimums). */
export const MAX_SLOTS = 8;

/** Loader options (dev): `slots: false` draws each material separately (regression comparisons). */
export const modelOptions = { slots: true };

/** Reference outline width (metres): per-material `outlineWidth` is folded into the per-vertex mask. */
export const OUTLINE_REF = 0.0065;

export interface CharacterModel {
  id: CharacterId;
  /** Parts drawn on their own (soft brows/lashes, glows, blended materials). */
  parts: ModelPart[];
  /** Multi-material slot draws (the bulk of the character). */
  groups: ModelGroup[];
  hulls: ModelHull[];
  bones: Map<string, ModelBone>;
  triangles: number;
  /**
   * Measured grip centres (hand-local offsets from the wrist joint, game axes) from the armature node's
   * extras `gripCentreN` / `gripCentreF` (pipeline §4 amendment); null when the GLB doesn't provide them.
   */
  grip: { N: THREE.Vector3; F: THREE.Vector3; radius: number } | null;
}

type Status = 'pending' | 'ready' | 'missing' | 'error';
interface Entry {
  status: Status;
  model: CharacterModel | null;
  promise: Promise<CharacterModel | null>;
}

const entries = new Map<CharacterId, Entry>();

function modelUrl(id: CharacterId): string {
  // Dev pages live under /dev/, so use a root path in dev; the build uses relative URLs (base './').
  return `${import.meta.env.DEV ? '/' : import.meta.env.BASE_URL}models/${id}.glb`;
}

function isGlb(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  return new DataView(buffer).getUint32(0, true) === 0x46546c67; // 'glTF'
}

async function load(id: CharacterId): Promise<CharacterModel | null> {
  const entry = entries.get(id) as Entry;
  try {
    const res = await fetch(modelUrl(id));
    const buffer = res.ok ? await res.arrayBuffer() : null;
    if (!buffer || !isGlb(buffer)) {
      entry.status = 'missing';
      return null;
    }
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    const model = prepare(id, gltf.scene);
    entry.status = 'ready';
    entry.model = model;
    return model;
  } catch (err) {
    entry.status = 'error';
    console.warn(`[models] ${id}.glb failed to load; using the procedural body.`, err);
    return null;
  }
}

/** Start loading a character's model (idempotent). */
export function requestCharacterModel(id: CharacterId): Promise<CharacterModel | null> {
  let entry = entries.get(id);
  if (!entry) {
    entry = { status: 'pending', model: null, promise: Promise.resolve(null) };
    entries.set(id, entry);
    entry.promise = load(id);
  }
  return entry.promise;
}

/** Preload every fighter model; resolves when all have loaded or fallen back. */
export function preloadCharacterModels(ids: readonly CharacterId[] = MODEL_IDS): Promise<void> {
  return Promise.all(ids.map((id) => requestCharacterModel(id))).then(() => undefined);
}

/** The loaded model, null when the character uses the procedural body, undefined while loading. */
export function characterModel(id: CharacterId): CharacterModel | null | undefined {
  const entry = entries.get(id);
  if (!entry) return null;
  return entry.status === 'pending' ? undefined : entry.model;
}

/** True once every requested model has loaded or fallen back. */
export function characterModelsSettled(): boolean {
  for (const e of entries.values()) if (e.status === 'pending') return false;
  return true;
}

export function characterModelStatus(): Record<string, Status> {
  const out: Record<string, Status> = {};
  for (const [id, e] of entries) out[id] = e.status;
  return out;
}

// ------------------------------------------------------------------------------------------- template

const m4 = new THREE.Matrix4();
const v3 = new THREE.Vector3();

/** Convert a loaded glTF scene into a shared, bind-space template. */
function prepare(id: CharacterId, scene: THREE.Object3D): CharacterModel {
  scene.updateMatrixWorld(true);
  const parts: ModelPart[] = [];
  const bones = new Map<string, ModelBone>();
  let triangles = 0;

  const noteBone = (b: THREE.Object3D, head: THREE.Vector3) => {
    if (bones.has(b.name)) return;
    const parent = b.parent && (b.parent as THREE.Bone).isBone ? b.parent.name : null;
    bones.set(b.name, { name: b.name, parent, head: head.clone(), minY: Infinity });
  };
  // Bone heads from the rest node transforms (overridden by the bind matrices of skinned meshes below).
  scene.traverse((o) => {
    if ((o as THREE.Bone).isBone) noteBone(o, o.getWorldPosition(v3));
  });

  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh ? (mesh as THREE.SkinnedMesh) : null;
    const geometry = mesh.geometry.clone();
    const bind = skinned ? skinned.bindMatrix : mesh.matrixWorld;
    bakeMatrix(geometry, bind);
    let skin: string[] | null = null;
    let rigidBone: string | null = null;
    if (skinned) {
      const sk = skinned.skeleton;
      skin = sk.bones.map((b) => b.name);
      // Bind-pose bone heads: the inverse bind matrices are authoritative.
      sk.bones.forEach((b, i) => {
        const head = v3.setFromMatrixPosition(m4.copy(sk.boneInverses[i]).invert());
        const prev = bones.get(b.name);
        if (prev) prev.head.copy(head);
        else noteBone(b, head);
      });
      trackExtents(geometry, skin, bones);
    } else {
      // A rigid mesh parented under a bone (eyes, buckles) rides on that bone: skin it 100% to it once,
      // here, so rigs share the geometry.
      let p: THREE.Object3D | null = mesh.parent;
      while (p && !(p as THREE.Bone).isBone) p = p.parent;
      rigidBone = p ? p.name : 'head';
      const n = geometry.getAttribute('position').count;
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
      const w = new Float32Array(n * 4);
      for (let i = 0; i < n; i += 1) w[i * 4] = 1;
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
      skin = [rigidBone];
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = Array.isArray(mesh.material) && geometry.groups.length ? geometry.groups : null;
    mats.forEach((material, mi) => {
      let g = geometry;
      if (groups) {
        // Split multi-material meshes so each part has one material (rare for glTF).
        g = geometry.clone();
        const grp = groups.find((x) => (x.materialIndex ?? 0) === mi);
        if (!grp || !g.index) return;
        g.setIndex(Array.from((g.index.array as ArrayLike<number>)).slice(grp.start, grp.start + grp.count));
        g.clearGroups();
      }
      const tri = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      triangles += tri;
      // glTF morph targets cover every primitive of a mesh; drop them where this primitive doesn't move.
      const morphs = mesh.morphTargetDictionary && hasMorphMotion(g) ? { ...mesh.morphTargetDictionary } : null;
      if (!morphs) {
        g.morphAttributes = {};
        g.morphTargetsRelative = false;
      }
      parts.push({ name: mesh.name, geometry: g, material, skin, rigidBone, morphs });
    });
  });
  const merged = mergeParts(parts);
  // Line widths relative to the model's boldest line: COLOR_0 R stays the main control, and per-material
  // `outlineWidth` only thins lines (face, hair) relative to the silhouette.
  let widest = 0;
  for (const p of merged) {
    const w = toonExtras(p.material)?.outlineWidth;
    if (typeof w === 'number' && w > widest) widest = w;
  }
  for (const p of merged) bakeOutline(p, widest > 0 ? widest : OUTLINE_REF);
  const hulls = buildHulls(merged);
  const { groups, rest } = buildGroups(merged);
  return { id, parts: rest, groups, hulls, bones, triangles, grip: readGrip(scene) };
}

/** Render state of a part: cut-out (alpha test) and double-sided (hair cards, cloth panels). */
function renderState(p: ModelPart): { group: boolean; cutout: boolean; doubleSided: boolean } {
  const m = p.material;
  const name = m.name;
  const hair = name.startsWith('MAT-hair');
  const fine = /brow|lash/i.test(p.name);
  const blended = m.transparent && !(m.alphaTest > 0) && !hair;
  return {
    group: !fine && !blended && name !== 'MAT-visor',
    cutout: m.alphaTest > 0 || hair || (m.transparent && !blended),
    doubleSided: m.side === THREE.DoubleSide || hair,
  };
}

/** Merge parts into slot draws per skin + render state (up to MAX_SLOTS materials each). */
function buildGroups(parts: ModelPart[]): { groups: ModelGroup[]; rest: ModelPart[] } {
  const rest: ModelPart[] = [];
  const buckets = new Map<string, ModelPart[]>();
  for (const p of parts) {
    const st = renderState(p);
    if (!st.group || !modelOptions.slots) {
      rest.push(p);
      continue;
    }
    const key = `${p.skin.join(',')}|${st.cutout}|${st.doubleSided}`;
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }
  const groups: ModelGroup[] = [];
  for (const list of buckets.values()) {
    const st = renderState(list[0]);
    // Split into chunks of at most MAX_SLOTS distinct materials.
    const chunks: ModelPart[][] = [];
    let cur: ModelPart[] = [];
    let mats = new Set<THREE.Material>();
    for (const p of list) {
      if (!mats.has(p.material) && mats.size >= MAX_SLOTS) {
        chunks.push(cur);
        cur = [];
        mats = new Set();
      }
      mats.add(p.material);
      cur.push(p);
    }
    if (cur.length) chunks.push(cur);
    for (const chunk of chunks) {
      const slots: THREE.Material[] = [];
      const items = chunk.map((p) => {
        let si = slots.indexOf(p.material);
        if (si < 0) si = slots.push(p.material) - 1;
        const g = canonical(p.geometry, ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']);
        const n = g.getAttribute('position').count;
        g.setAttribute('slot', new THREE.BufferAttribute(new Float32Array(n).fill(si), 1));
        return { g, src: p.geometry, morphs: p.morphs };
      });
      const merged = mergeUnion(items);
      if (!merged) {
        rest.push(...chunk);
        continue;
      }
      groups.push({
        name: chunk.map((p) => p.name).join('+'),
        geometry: merged.geometry,
        slots,
        skin: chunk[0].skin,
        doubleSided: st.doubleSided,
        cutout: st.cutout,
        morphs: merged.morphs,
      });
    }
  }
  return { groups, rest };
}

/**
 * Copy of a geometry with plain (non-interleaved) attributes of fixed types, so parts from different glTF
 * primitives merge: Float32 for everything except Uint16 skin indices. Missing uv / normal get zeros.
 */
function canonical(src: THREE.BufferGeometry, names: string[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = src.getAttribute('position').count;
  for (const name of names) {
    const a = src.getAttribute(name);
    const size = name === 'uv' ? 2 : name === 'skinIndex' || name === 'skinWeight' ? 4 : name === 'outline' ? 1 : 3;
    const arr = name === 'skinIndex' ? new Uint16Array(n * size) : new Float32Array(n * size);
    if (a) {
      for (let i = 0; i < n; i += 1) {
        for (let k = 0; k < size; k += 1) arr[i * size + k] = a.getComponent(i, k);
      }
    } else if (name === 'skinWeight') {
      for (let i = 0; i < n; i += 1) arr[i * 4] = 1;
    }
    g.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array as ArrayLike<number>), 1));
  return g;
}

/** A morph target of `src` as relative deltas (glTF targets are relative; absolute ones are converted). */
function relativeTarget(src: THREE.BufferGeometry, key: 'position' | 'normal', i: number): Float32Array | null {
  const list = src.morphAttributes[key];
  const a = list?.[i];
  if (!a) return null;
  const n = a.count;
  const out = new Float32Array(n * 3);
  const base = src.getAttribute(key);
  for (let v = 0; v < n; v += 1) {
    for (let k = 0; k < 3; k += 1) {
      const val = a.getComponent(v, k);
      out[v * 3 + k] = src.morphTargetsRelative || !base ? val : val - base.getComponent(v, k);
    }
  }
  return out;
}

/**
 * Merge canonical geometries whose morph sets may differ: the result carries the union of morph targets
 * (members without a target get zero deltas). Returns the merged geometry and its morph dictionary.
 */
function mergeUnion(items: Array<{ g: THREE.BufferGeometry; src: THREE.BufferGeometry; morphs: Record<string, number> | null }>): {
  geometry: THREE.BufferGeometry;
  morphs: Record<string, number> | null;
} | null {
  const names: string[] = [];
  for (const it of items) {
    if (!it.morphs) continue;
    for (const [nm] of Object.entries(it.morphs).sort((a, b) => a[1] - b[1])) if (!names.includes(nm)) names.push(nm);
  }
  const withNormals = items.some((it) => it.morphs && (it.src.morphAttributes.normal?.length ?? 0) > 0);
  for (const it of items) {
    if (!names.length) break;
    const n = it.g.getAttribute('position').count;
    const target = (key: 'position' | 'normal', nm: string) => {
      const i = it.morphs?.[nm];
      const arr = i !== undefined ? relativeTarget(it.src, key, i) : null;
      return new THREE.BufferAttribute(arr && arr.length === n * 3 ? arr : new Float32Array(n * 3), 3);
    };
    it.g.morphAttributes.position = names.map((nm) => target('position', nm));
    if (withNormals) it.g.morphAttributes.normal = names.map((nm) => target('normal', nm));
    it.g.morphTargetsRelative = true;
  }
  const geometry = items.length === 1 ? items[0].g : mergeGeometries(items.map((it) => it.g), false);
  if (!geometry) return null;
  geometry.morphTargetsRelative = names.length > 0;
  geometry.computeBoundingSphere();
  const morphs = names.length ? Object.fromEntries(names.map((nm, i) => [nm, i])) : null;
  return { geometry, morphs };
}

/** Toon extras of a material (glTF material extras land in userData). */
export function toonExtras(m: THREE.Material): Record<string, unknown> | null {
  const t = (m.userData as Record<string, unknown>).toon;
  return t && typeof t === 'object' ? (t as Record<string, unknown>) : null;
}

function colorOf(v: unknown, fallback: THREE.Color): THREE.Color {
  return Array.isArray(v) && v.length >= 3 && v.every((n) => typeof n === 'number') ? new THREE.Color(v[0], v[1], v[2]) : fallback;
}

/**
 * Per-vertex outline attributes from COLOR_0 R (width mask) and the material's toon extras:
 * `outline` = mask * clamp(outlineWidth / widest, 0.45, 1), `outlineColor` = the ink colour.
 */
function bakeOutline(p: ModelPart, widest: number): void {
  const g = p.geometry;
  const n = g.getAttribute('position').count;
  const t = toonExtras(p.material);
  const name = p.material.name;
  const noLine = name === 'MAT-eyes' || name === 'MAT-visor' || /brow|lash/i.test(p.name);
  const width = noLine ? 0 : typeof t?.outlineWidth === 'number' ? t.outlineWidth : OUTLINE_REF;
  const base = (p.material as THREE.MeshStandardMaterial).color ?? new THREE.Color(0.5, 0.5, 0.5);
  const ink = colorOf(t?.outlineColor, base.clone().multiplyScalar(0.22));
  const col = g.getAttribute('color');
  const mask = new Float32Array(n);
  const inkArr = new Float32Array(n * 3);
  const k = width <= 0 ? 0 : Math.min(1, Math.max(0.45, width / widest));
  for (let i = 0; i < n; i += 1) {
    mask[i] = (col ? col.getX(i) : 1) * k;
    inkArr[i * 3] = ink.r;
    inkArr[i * 3 + 1] = ink.g;
    inkArr[i * 3 + 2] = ink.b;
  }
  g.setAttribute('outline', new THREE.BufferAttribute(mask, 1));
  g.setAttribute('outlineColor', new THREE.BufferAttribute(inkArr, 3));
}

/** One outline hull per skin over every outlined part, carrying the union of their morph targets. */
function buildHulls(parts: ModelPart[]): ModelHull[] {
  const outlined = parts.filter((p) => {
    const mask = p.geometry.getAttribute('outline');
    for (let i = 0; i < mask.count; i += 1) if (mask.getX(i) > 0.01) return true;
    return false;
  });
  const bySkin = new Map<string, ModelPart[]>();
  for (const p of outlined) {
    const key = p.skin.join(',');
    const list = bySkin.get(key);
    if (list) list.push(p);
    else bySkin.set(key, [p]);
  }
  const hulls: ModelHull[] = [];
  for (const list of bySkin.values()) {
    const items = list.map((p) => ({ g: canonical(p.geometry, ['position', 'normal', 'skinIndex', 'skinWeight', 'outline', 'outlineColor']), src: p.geometry, morphs: p.morphs }));
    const merged = mergeUnion(items);
    if (merged) hulls.push({ geometry: merged.geometry, skin: list[0].skin, morphs: merged.morphs });
  }
  return hulls;
}

/** Morph target signature (names in index order), '' when none. */
function morphKey(dict: Record<string, number> | null): string {
  if (!dict) return '';
  return Object.entries(dict)
    .sort((a, b) => a[1] - b[1])
    .map(([n]) => n)
    .join(',');
}

/** Give a geometry zero-delta morph targets so it can merge with (and morph like) `ref`. */
function padMorphs(g: THREE.BufferGeometry, ref: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const out: Record<string, THREE.BufferAttribute[]> = {};
  for (const [key, list] of Object.entries(ref.morphAttributes)) {
    out[key] = list.map(() => new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  }
  g.morphAttributes = out;
  g.morphTargetsRelative = ref.morphTargetsRelative;
  return g;
}

/** Merge geometries that may mix morphing and static members (static ones get zero deltas). */
function mergeMixed(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const ref = geos.find((g) => Object.keys(g.morphAttributes).length > 0) ?? null;
  const indexed = geos.every((g) => g.index);
  const prepared = geos.map((g) => {
    let h = indexed ? g : g.index ? g.toNonIndexed() : g;
    if (ref && Object.keys(h.morphAttributes).length === 0) h = padMorphs(h === g ? g.clone() : h, ref);
    return h;
  });
  const merged = mergeGeometries(prepared, false);
  // mergeGeometries doesn't carry the morph mode over (glTF morph targets are relative).
  if (merged && ref) merged.morphTargetsRelative = ref.morphTargetsRelative;
  return merged;
}

/**
 * Merge parts that draw identically (same material, joints and render class): e.g. a body primitive and
 * the costume mesh sharing its material, or brows + lashes. Static members of a morphing group get
 * zero morph deltas, so one draw keeps the morphs. Fewer draw calls per fighter.
 */
function mergeParts(parts: ModelPart[]): ModelPart[] {
  const fine = (p: ModelPart) => /brow|lash/i.test(p.name);
  const groups = new Map<string, ModelPart[]>();
  for (const p of parts) {
    const key = `${p.material.uuid}|${p.skin.join(',')}|${fine(p)}`;
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }
  const out: ModelPart[] = [];
  for (const list of groups.values()) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    // Members with different morph sets can't share a draw.
    const keys = new Set(list.filter((p) => p.morphs).map((p) => morphKey(p.morphs)));
    const names = new Set(Object.keys(list[0].geometry.attributes));
    const same = list.every((p) => Object.keys(p.geometry.attributes).length === names.size && Object.keys(p.geometry.attributes).every((n) => names.has(n)));
    const merged = same && keys.size <= 1 ? mergeMixed(list.map((p) => p.geometry)) : null;
    if (!merged) {
      out.push(...list);
      continue;
    }
    for (const p of list) p.geometry.dispose();
    const morphs = list.find((p) => p.morphs)?.morphs ?? null;
    // Keep the brow/lash marker in the name so the runtime gives the merge the soft-card material.
    out.push({ ...list[0], name: list.map((p) => p.name).join('+'), geometry: merged, morphs: morphs ? { ...morphs } : null });
  }
  return out;
}

/** Grip centres from node extras (glTF extras land in userData). */
function readGrip(scene: THREE.Object3D): CharacterModel['grip'] {
  let found: CharacterModel['grip'] = null;
  const vec = (v: unknown): THREE.Vector3 | null =>
    Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number') ? new THREE.Vector3(v[0], v[1], v[2]) : null;
  scene.traverse((o) => {
    if (found) return;
    const u = o.userData as Record<string, unknown>;
    const n = vec(u.gripCentreN);
    const f = vec(u.gripCentreF);
    if (n && f) found = { N: n, F: f, radius: typeof u.gripRadius === 'number' ? u.gripRadius : 0.0215 };
  });
  return found;
}

/** Apply a bind matrix to positions/normals and the (relative) morph deltas. */
function bakeMatrix(g: THREE.BufferGeometry, m: THREE.Matrix4): void {
  if (m.equals(new THREE.Matrix4())) return;
  g.applyMatrix4(m);
  const linear = new THREE.Matrix3().setFromMatrix4(m);
  const normalM = new THREE.Matrix3().getNormalMatrix(m);
  const morphPos = g.morphAttributes.position ?? [];
  const morphNor = g.morphAttributes.normal ?? [];
  for (const a of morphPos as THREE.BufferAttribute[]) {
    if (g.morphTargetsRelative) a.applyMatrix3(linear);
    else a.applyMatrix4(m);
    a.needsUpdate = true;
  }
  for (const a of morphNor as THREE.BufferAttribute[]) {
    a.applyMatrix3(normalM);
    a.needsUpdate = true;
  }
}

/** True when any morph target moves this geometry's vertices. */
function hasMorphMotion(g: THREE.BufferGeometry): boolean {
  for (const a of g.morphAttributes.position ?? []) {
    const arr = (a as THREE.BufferAttribute).array as ArrayLike<number>;
    for (let i = 0; i < arr.length; i += 1) if (Math.abs(arr[i]) > 1e-5) return true;
  }
  return false;
}

/** Lowest vertex per bone (hem extents for skirt panels and capes). */
function trackExtents(g: THREE.BufferGeometry, skin: string[], bones: Map<string, ModelBone>): void {
  const pos = g.getAttribute('position');
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  if (!si || !sw) return;
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i);
    for (let k = 0; k < 4; k += 1) {
      if (sw.getComponent(i, k) < 0.25) continue;
      const b = bones.get(skin[si.getComponent(i, k)]);
      if (b && y < b.minY) b.minY = y;
    }
  }
}
