import * as THREE from 'three';
import { applyArenaFog, createEnvironment, createFogUniforms, createSkyDome } from './arena/atmosphere';
import { AtmosphereBuilder, blink, createEmbers, createPlasmaMaterial, GlowKind } from './arena/effects';
import { GeoBatch, type Tint } from './arena/geometry';
import {
  createArenaTextures,
  DECAL_REGIONS,
  DECK_TEX_X0,
  DECK_TEX_X1,
  DECK_TEX_Z0,
  DECK_TEX_Z1,
  HAZARD_TILE,
  PANEL_TILE,
  type DecalName,
} from './arena/textures';

/**
 * "Reactor Gantry" — a steel catwalk bridge spanning a vast reactor chamber.
 *
 * Layers: play (deck) / near (front edge beam + underside truss) / mid (back
 * railing, conduits, bulkhead gates, columns, secondary walkways) / far
 * (reactor core, chamber wall with window bands, cables, light shafts) /
 * motion (embers, haze drift, reactor pulse, rotating ring, blinking beacons).
 */

export interface ArenaHandle {
  /** Stage half-width: fighters are clamped to x ∈ [-wallX, wallX]. Must be 8.5. */
  readonly wallX: number;
  /** Animate ambient things (embers, haze drift, reactor pulse, flickering lights). time = accumulated seconds. */
  update(dt: number, time: number): void;
  /** When true, freeze ambient animation in a stable deterministic pose (for screenshot tests). */
  setReducedMotion(enabled: boolean): void;
  /** Lighting quality: 'high' = desktop (shadow map 2048), 'low' = mobile (shadow map 1024, fewer particles). Can be called anytime. */
  setQuality(quality: 'high' | 'low'): void;
  /** The directional light that casts fighter shadows (lead may tweak it). */
  readonly keyLight: THREE.DirectionalLight;
  dispose(): void;
}

const WALL_X = 8.5;
const BRIDGE_END = 92;
const REACTOR_Z = -52;
const CHAMBER_R = 100;
const FROZEN_TIME = 6.5;
const EMBERS_HIGH = 400;
const EMBERS_LOW = 150;

// Vertex tints (multiply the steel panel albedo). Cool steel-blue gunmetal family.
const T_OUTER_DECK: Tint = [0.38, 0.42, 0.5];
const T_BEAM: Tint = [0.36, 0.4, 0.5];
const T_TRUSS: Tint = [0.3, 0.32, 0.37];
const T_RAIL: Tint = [0.42, 0.46, 0.56];
const T_PYLON: Tint = [0.42, 0.48, 0.6];
const T_PYLON_DARK: Tint = [0.28, 0.31, 0.38];
const T_DOOR: Tint = [0.34, 0.38, 0.47];
const T_PIPE: Tint = [0.55, 0.43, 0.32];
const T_PIPE_DARK: Tint = [0.24, 0.24, 0.26];
const T_MID: Tint = [0.36, 0.38, 0.44];
const T_FAR: Tint = [0.2, 0.21, 0.25];
const T_CABLE: Tint = [0.06, 0.06, 0.07];

const AMBER = new THREE.Color(1.0, 0.56, 0.16);
const AMBER_DEEP = new THREE.Color(1.0, 0.36, 0.08);
const WARM_WHITE = new THREE.Color(1.0, 0.82, 0.6);
const COOL_WHITE = new THREE.Color(0.62, 0.74, 0.95);
/** Saturated amber for authored light strips (stays amber after ACES instead of washing to cream). */
const STRIP = new THREE.Color(1.0, 0.46, 0.08);

interface LampSpec {
  matrix: THREE.Matrix4;
  color: THREE.Color;
  anim?: { speed: number; phase: number };
}

type Facing = 'z' | '-z' | 'x' | '-x' | 'y' | '-y' | number;

function facingQuat(f: Facing, out: THREE.Quaternion): THREE.Quaternion {
  const e = new THREE.Euler();
  if (typeof f === 'number') e.set(0, f, 0);
  else if (f === 'z') e.set(0, 0, 0);
  else if (f === '-z') e.set(0, Math.PI, 0);
  else if (f === 'x') e.set(0, Math.PI / 2, 0);
  else if (f === '-x') e.set(0, -Math.PI / 2, 0);
  else if (f === 'y') e.set(-Math.PI / 2, 0, 0);
  else e.set(Math.PI / 2, 0, 0);
  return out.setFromEuler(e);
}

/** Reverse triangle winding and normals so a closed surface is seen from inside. */
function flipInside(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of ['position', 'normal', 'uv']) {
    const attr = g.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!attr) continue;
    const n = attr.itemSize;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < attr.count; i += 3) {
      for (let k = 0; k < n; k++) {
        const a = (i + 1) * n + k;
        const b = (i + 2) * n + k;
        const t = arr[a];
        arr[a] = arr[b];
        arr[b] = t;
      }
    }
  }
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < nrm.array.length; i++) (nrm.array as Float32Array)[i] *= -1;
  return g;
}

export function createArena(scene: THREE.Scene, renderer: THREE.WebGLRenderer, rng: () => number): ArenaHandle {
  const root = new THREE.Group();
  root.name = 'Arena';
  scene.add(root);

  const tex = createArenaTextures(rng, renderer.capabilities.getMaxAnisotropy());
  const fog = createFogUniforms();
  const uTime: THREE.IUniform<number> = { value: FROZEN_TIME };
  const uPulse: THREE.IUniform<number> = { value: 1 };

  // -------------------------------------------------------------------------
  // Materials (shared roles)
  // -------------------------------------------------------------------------
  const deckMat = applyArenaFog(
    new THREE.MeshStandardMaterial({
      name: 'arena.deck',
      map: tex.deckAlbedo,
      roughnessMap: tex.deckData,
      metalnessMap: tex.deckData,
      bumpMap: tex.deckData,
      bumpScale: 1.6,
      roughness: 1,
      metalness: 1,
      envMapIntensity: 0.75,
    }),
    fog,
    'deck',
  );
  const steelMat = applyArenaFog(
    new THREE.MeshStandardMaterial({
      name: 'arena.steel',
      map: tex.panelAlbedo,
      roughnessMap: tex.panelData,
      metalnessMap: tex.panelData,
      bumpMap: tex.panelData,
      bumpScale: 1.2,
      roughness: 1,
      metalness: 1,
      vertexColors: true,
      envMapIntensity: 0.95,
    }),
    fog,
    'steel',
  );
  const hazardMat = applyArenaFog(
    new THREE.MeshStandardMaterial({
      name: 'arena.hazard',
      map: tex.hazard,
      roughness: 0.58,
      metalness: 0.25,
      vertexColors: true,
      envMapIntensity: 0.6,
    }),
    fog,
    'hazard',
  );
  const decalMat = applyArenaFog(
    new THREE.MeshStandardMaterial({
      name: 'arena.decal',
      map: tex.decals,
      transparent: true,
      alphaTest: 0.04,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      roughness: 0.62,
      metalness: 0.1,
      vertexColors: true,
      envMapIntensity: 0.5,
    }),
    fog,
    'decal',
  );
  const lampMat = applyArenaFog(new THREE.MeshBasicMaterial({ name: 'arena.lamp', color: 0xffffff }), fog, 'lamp');
  const plasmaMat = createPlasmaMaterial(tex.noise, fog, uTime, uPulse);

  // -------------------------------------------------------------------------
  // Builders
  // -------------------------------------------------------------------------
  const steel = new GeoBatch(PANEL_TILE);
  const hazard = new GeoBatch(HAZARD_TILE);
  const glow = new AtmosphereBuilder();
  const quads: LampSpec[] = [];
  const bulbs: LampSpec[] = [];
  const decalParts: THREE.BufferGeometry[] = [];
  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3();

  const addQuad = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    facing: Facing,
    color: THREE.Color,
    intensity: number,
    anim?: { speed: number; phase: number },
  ): void => {
    const m = new THREE.Matrix4().compose(_v.set(x, y, z), facingQuat(facing, _q), _s.set(w, h, 1));
    quads.push({ matrix: m, color: color.clone().multiplyScalar(intensity), anim });
  };
  const addBulb = (x: number, y: number, z: number, r: number, color: THREE.Color, intensity: number, anim?: { speed: number; phase: number }): void => {
    const m = new THREE.Matrix4().compose(_v.set(x, y, z), _q.identity(), _s.set(r, r, r));
    bulbs.push({ matrix: m, color: color.clone().multiplyScalar(intensity), anim });
  };
  const addDecal = (name: DecalName, x: number, y: number, z: number, w: number, h: number, facing: Facing, color: THREE.Color): void => {
    const g = new THREE.PlaneGeometry(w, h).toNonIndexed();
    const [u0, v0, u1, v1] = DECAL_REGIONS[name];
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    g.applyQuaternion(facingQuat(facing, _q));
    g.translate(x, y, z);
    const col = new Float32Array(uv.count * 3);
    for (let i = 0; i < uv.count; i++) col.set([color.r, color.g, color.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    decalParts.push(g);
  };

  // -------------------------------------------------------------------------
  // PLAY: the deck plate (unique texture) — top surface exactly at y = 0
  // -------------------------------------------------------------------------
  const deckGeo = new THREE.PlaneGeometry(DECK_TEX_X1 - DECK_TEX_X0, DECK_TEX_Z1 - DECK_TEX_Z0);
  deckGeo.rotateX(-Math.PI / 2);
  deckGeo.translate((DECK_TEX_X0 + DECK_TEX_X1) / 2, 0, (DECK_TEX_Z0 + DECK_TEX_Z1) / 2);
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.name = 'arena.deck';
  deck.receiveShadow = true;
  root.add(deck);

  // Outer deck beyond the bulkheads (tiled steel), slightly lower to avoid z-fight at the seam.
  for (const s of [-1, 1]) {
    const x0 = s > 0 ? DECK_TEX_X1 : -BRIDGE_END;
    const x1 = s > 0 ? BRIDGE_END : DECK_TEX_X0;
    steel.boxMinMax(x0, -0.14, -2.5, x1, -0.001, 2.5, T_OUTER_DECK);
  }
  // Deck sub-plate under the textured deck (closes the slab edges).
  steel.boxMinMax(DECK_TEX_X0, -0.14, -2.5, DECK_TEX_X1, -0.02, 2.5, T_BEAM);

  // -------------------------------------------------------------------------
  // NEAR: front edge I-beam, curb, lamps, underside truss
  // -------------------------------------------------------------------------
  const L = BRIDGE_END * 2;
  for (const side of [1, -1]) {
    const z = 2.5 * side;
    // curb (≤ 0.15 high) — front face is the stage's leading edge
    steel.box(0, 0.045, z + 0.06 * side, L, 0.09, 0.14, T_RAIL);
    // top flange, web, bottom flange
    steel.box(0, -0.06, z + 0.09 * side, L, 0.12, 0.2, T_BEAM);
    steel.box(0, -0.36, z, L, 0.52, 0.08, T_BEAM);
    steel.box(0, -0.66, z + 0.08 * side, L, 0.1, 0.24, T_BEAM);
    // bottom chord + truss
    steel.box(0, -2.95, z, L, 0.18, 0.22, T_TRUSS);
    for (let x = -BRIDGE_END; x <= BRIDGE_END + 0.01; x += 2.5) {
      steel.box(x, -1.83, z, 0.15, 2.26, 0.15, T_TRUSS);
      if (x < BRIDGE_END) {
        const dir = Math.round((x + BRIDGE_END) / 2.5) % 2 === 0 ? 1 : -1;
        const ang = Math.atan2(2.26, 2.5) * dir;
        steel.box(x + 1.25, -1.83, z, Math.hypot(2.5, 2.26), 0.11, 0.11, T_TRUSS, [0, 0, ang]);
      }
    }
    if (side > 0) {
      // stiffeners + lamps on the web (camera-facing)
      for (let x = -BRIDGE_END; x < BRIDGE_END; x += 1.25) {
        steel.box(x, -0.36, z + 0.07, 0.06, 0.5, 0.1, T_BEAM);
      }
      for (let x = -BRIDGE_END + 0.625; x < BRIDGE_END; x += 2.5) {
        const near = Math.abs(x) < 24;
        addQuad(x, -0.36, z + 0.045, 0.16, 0.04, 'z', AMBER_DEEP, near ? 0.7 : 0.55);
      }
      // service lamps on the bottom chord
      for (let x = -BRIDGE_END + 1.25; x < BRIDGE_END; x += 5) {
        addQuad(x, -2.95, z + 0.115, 0.32, 0.06, 'z', AMBER_DEEP, 0.9);
      }
    }
  }
  // cross beams under the deck and at the bottom chord
  for (let x = -BRIDGE_END; x <= BRIDGE_END; x += 2.5) {
    steel.box(x, -0.72, 0, 0.14, 0.18, 5.0, T_TRUSS);
    if (Math.round(x / 2.5) % 2 === 0) steel.box(x, -2.95, 0, 0.14, 0.14, 5.0, T_TRUSS);
  }
  // longitudinal stringers under the deck (seen through the truss)
  for (const z of [-1.25, 0, 1.25]) steel.box(0, -0.42, z, L, 0.5, 0.1, T_TRUSS);

  // -------------------------------------------------------------------------
  // MID: back railing + conduits (kept low and thin so silhouettes stay clean)
  // -------------------------------------------------------------------------
  const railZ = -2.32;
  const gateGap = (x: number): boolean => Math.abs(x) > 8.3 && Math.abs(x) < 10.9;
  for (let x = -BRIDGE_END; x <= BRIDGE_END; x += 1.25) {
    if (gateGap(x)) continue;
    steel.box(x, 0.56, railZ, 0.07, 1.12, 0.07, T_RAIL);
    if (Math.round(x / 1.25) % 6 === 0 && Math.abs(x) < 40) addBulb(x, 1.18, railZ, 0.04, AMBER, 1.1);
  }
  const railSegments: Array<[number, number]> = [
    [-BRIDGE_END, -10.9],
    [-8.3, 8.3],
    [10.9, BRIDGE_END],
  ];
  for (const [a, b] of railSegments) {
    const cx = (a + b) / 2;
    const len = b - a;
    steel.box(cx, 1.13, railZ, len, 0.07, 0.1, T_RAIL);
    steel.box(cx, 0.64, railZ, len, 0.045, 0.05, T_RAIL);
    steel.box(cx, 0.08, railZ - 0.02, len, 0.14, 0.03, T_BEAM);
    // conduits hanging off the back edge
    steel.cylinder(cx, 0.24, -2.66, 0.075, len, 'x', T_PIPE, 10);
    steel.cylinder(cx, 0.42, -2.74, 0.05, len, 'x', T_PIPE_DARK, 8);
    for (let x = a + 1.25; x < b; x += 2.5) steel.box(x, 0.33, -2.62, 0.08, 0.36, 0.2, T_BEAM);
  }

  // -------------------------------------------------------------------------
  // MID: bulkhead gates at x = ±8.5 … ±10.7 (visible stage walls)
  // -------------------------------------------------------------------------
  for (const s of [-1, 1]) {
    const X = (a: number, b: number): [number, number] => (s > 0 ? [a, b] : [-b, -a]);
    const [px0, px1] = X(8.52, 10.7);
    // pylons (front + back), full height from the abyss up to the lintel
    steel.prism(px0, px1, 1.95, 3.15, 0.14, -74, 6.3, T_PYLON);
    steel.prism(px0, px1, -3.15, -1.95, 0.14, -74, 6.3, T_PYLON);
    // upper columns rising out of frame
    const [ux0, ux1] = X(8.75, 10.45);
    steel.prism(ux0, ux1, 2.05, 3.0, 0.1, 6.3, 80, T_PYLON_DARK);
    steel.prism(ux0, ux1, -3.0, -2.05, 0.1, 6.3, 80, T_PYLON_DARK);
    // lintel + cap
    steel.boxMinMax(px0, 5.15, -3.15, px1, 6.3, 3.15, T_PYLON);
    const [cx0, cx1] = X(8.5, 10.82);
    steel.boxMinMax(cx0, 6.3, -3.3, cx1, 6.52, 3.3, T_PYLON_DARK);
    // vertical rib on front faces (adds a shadow line)
    const [rx0, rx1] = X(10.0, 10.12);
    steel.boxMinMax(rx0, 1.0, 3.1, rx1, 5.1, 3.22, T_PYLON_DARK);
    // door (closed blast door) + frame + leaves + ribs
    const [dx0, dx1] = X(8.95, 10.3);
    steel.boxMinMax(dx0, 0, -1.95, dx1, 5.15, 1.95, T_DOOR);
    const [fx0, fx1] = X(8.68, 8.95);
    steel.boxMinMax(fx0, 0, -1.95, fx1, 5.15, -1.72, T_PYLON);
    steel.boxMinMax(fx0, 0, 1.72, fx1, 5.15, 1.95, T_PYLON);
    steel.boxMinMax(fx0, 4.9, -1.95, fx1, 5.15, 1.95, T_PYLON);
    const [lx0, lx1] = X(8.86, 8.95);
    steel.boxMinMax(lx0, 1.3, -1.6, lx1, 4.7, -0.1, T_DOOR);
    steel.boxMinMax(lx0, 1.3, 0.1, lx1, 4.7, 1.6, T_DOOR);
    const [bx0, bx1] = X(8.8, 8.95);
    for (const y of [1.22, 2.45, 3.6, 4.72]) steel.boxMinMax(bx0, y - 0.07, -1.72, bx1, y + 0.07, 1.72, T_PYLON_DARK);
    // collar + cross bracing below the deck
    const [kx0, kx1] = X(8.35, 10.85);
    steel.boxMinMax(kx0, -3.6, -3.35, kx1, -3.0, 3.35, T_PYLON_DARK);
    for (const y of [-6.5, -12.5]) {
      const ang = Math.atan2(5.0, 4.3);
      steel.box(s * 9.6, y, 0, 0.3, Math.hypot(5.0, 4.3), 0.3, T_PYLON_DARK, [ang, 0, 0]);
      steel.box(s * 9.6, y, 0, 0.3, Math.hypot(5.0, 4.3), 0.3, T_PYLON_DARK, [-ang, 0, 0]);
    }

    // hazard trim: pylon feet, lintel underside band, door kick band
    const [hx0, hx1] = X(8.5, 10.72);
    hazard.boxMinMax(hx0, 0, 1.93, hx1, 0.95, 3.17, 1);
    hazard.boxMinMax(hx0, 0, -3.17, hx1, 0.95, -1.93, 1);
    hazard.boxMinMax(hx0, 5.15, -3.17, hx1, 5.5, 3.17, 1);
    const [hd0, hd1] = X(8.84, 8.95);
    hazard.boxMinMax(hd0, 0.04, -1.72, hd1, 1.1, 1.72, 1);
    // front curb hazard near the gate
    const [hc0, hc1] = X(7.2, 8.5);
    hazard.boxMinMax(hc0, 0.0, 2.48, hc1, 0.092, 2.632, 1);

    // lights: vertical strips, door seam, beacon
    addQuad(s * 10.38, 3.05, 3.165, 0.1, 3.7, 'z', STRIP, 1.0);
    addQuad(s * 8.505, 3.05, 2.55, 0.08, 3.7, s > 0 ? '-x' : 'x', STRIP, 0.9);
    addQuad(s * 8.505, 3.05, -2.55, 0.08, 3.7, s > 0 ? '-x' : 'x', STRIP, 0.7);
    addQuad(s * 8.835, 3.0, 0, 0.05, 3.3, s > 0 ? '-x' : 'x', AMBER, 1.15);
    const beaconPhase = s > 0 ? 0 : Math.PI;
    addBulb(s * 9.6, 5.78, 3.22, 0.13, AMBER, 2.2, { speed: 3.2, phase: beaconPhase });
    glow.card(s * 9.6, 5.78, 3.32, 1.8, 1.8, GlowKind.Radial, 0.75, 3.2, beaconPhase, AMBER);
    // small lamps under the lintel (inner face)
    for (const z of [-1.9, -0.6, 0.6, 1.9]) addQuad(s * 8.505, 5.64, z, 0.3, 0.06, s > 0 ? '-x' : 'x', WARM_WHITE, 0.9);
    // decals
    addDecal(s > 0 ? 'num08' : 'num07', s * 9.3, 3.35, 3.16, 1.05, 1.05, 'z', new THREE.Color(0.55, 0.57, 0.58));
    addDecal('warnTri', s * 9.3, 2.15, 3.16, 0.62, 0.62, 'z', new THREE.Color(0.9, 0.62, 0.14));
    addDecal('voltage', s * 8.505, 5.98, 0, 2.2, 0.32, s > 0 ? '-x' : 'x', new THREE.Color(0.9, 0.62, 0.14));

    // authored light pool on the deck in front of the door (cheaper than a dynamic light)
    {
      const cx = s * 8.1;
      const y = 0.006;
      glow.quad(
        [
          new THREE.Vector3(cx - 1.7, y, 2.3),
          new THREE.Vector3(cx + 1.7, y, 2.3),
          new THREE.Vector3(cx + 1.7, y, -2.3),
          new THREE.Vector3(cx - 1.7, y, -2.3),
        ],
        GlowKind.Radial,
        0.16,
        0,
        0,
        AMBER,
      );
    }
  }

  // -------------------------------------------------------------------------
  // MID: support columns rising out of the abyss, pipes, secondary walkways
  // -------------------------------------------------------------------------
  const columns: Array<[number, number, number]> = [
    [-11.5, -11, 1.3],
    [11.5, -11, 1.3],
    [-21, -24, 1.7],
    [21, -24, 1.7],
    [-33, -36, 2.0],
    [33, -36, 2.0],
    [-47, -44, 2.2],
    [47, -44, 2.2],
    [-22, -66, 2.4],
    [22, -66, 2.4],
  ];
  for (const [x, z, r] of columns) {
    steel.cylinder(x, -20, z, r, 200, 'y', T_MID, 16, true);
    for (const y of [-16, -4.5, 9.5, 24]) {
      steel.cylinder(x, y, z, r * 1.22, 0.7, 'y', T_PYLON_DARK, 16);
    }
    addQuad(x, 1.5, z + r * 1.0 + 0.02, 0.14, 7.0, 'z', AMBER, 0.85);
    addBulb(x, 9.5, z + r * 1.22 + 0.05, 0.12, AMBER, 1.4, { speed: 1.4, phase: x * 0.7 });
  }
  // big conduit bundle behind/below the bridge
  steel.cylinder(0, -5.6, -12.5, 0.6, L, 'x', T_PIPE, 16);
  steel.cylinder(0, -4.7, -13.6, 0.38, L, 'x', T_PIPE_DARK, 12);
  steel.cylinder(0, -6.6, -13.8, 0.34, L, 'x', T_MID, 12);
  for (let x = -BRIDGE_END + 3; x < BRIDGE_END; x += 6) {
    steel.cylinder(x, -5.6, -12.5, 0.72, 0.3, 'x', T_PYLON_DARK, 16);
    steel.box(x, -5.5, -13.2, 0.25, 2.6, 2.2, T_TRUSS);
  }

  // Secondary walkways (upper: z=-20 y=8.6; lower: z=-28 y=-10.5)
  const walkways: Array<[number, number, number]> = [
    [8.6, -20, 120],
    [-10.5, -28, 150],
  ];
  for (const [y, z, len] of walkways) {
    steel.box(0, y, z, len, 0.28, 2.2, T_MID);
    steel.box(0, y - 0.45, z + 1.1, len, 0.62, 0.12, T_PYLON_DARK);
    steel.box(0, y + 0.55, z + 1.05, len, 0.06, 0.06, T_RAIL);
    steel.box(0, y + 0.55, z - 1.05, len, 0.06, 0.06, T_RAIL);
    for (let x = -len / 2; x <= len / 2; x += 2.0) {
      steel.box(x, y + 0.28, z + 1.05, 0.06, 0.56, 0.06, T_RAIL);
    }
    for (let x = -len / 2 + 1.5; x < len / 2; x += 3.0) {
      addQuad(x, y - 0.45, z + 1.17, 0.5, 0.08, 'z', y > 0 ? WARM_WHITE : AMBER, y > 0 ? 0.9 : 1.1);
    }
    // hangers up to the ceiling
    for (let x = -len / 2 + 5; x < len / 2; x += 10) {
      if (Math.abs(x) < 30) continue; // keep the centre of the backdrop clean
      steel.box(x, y + 40, z - 1.05, 0.1, 80, 0.1, T_TRUSS);
      steel.box(x, y + 40, z + 1.05, 0.1, 80, 0.1, T_TRUSS);
    }
  }

  // Hanging cables (catenaries between columns + long drops into the abyss)
  const catenary = (a: THREE.Vector3, b: THREE.Vector3, sag: number, radius: number): void => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const p = a.clone().lerp(b, t);
      p.y -= sag * 4 * t * (1 - t);
      pts.push(p);
    }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, radius, 5, false);
    steel.add(geo, null, T_CABLE, { uv: 'keep', uvScale: [8, 1] });
    geo.dispose();
  };
  catenary(new THREE.Vector3(-11.5, 14, -11), new THREE.Vector3(-21, 18, -24), 4.5, 0.09);
  catenary(new THREE.Vector3(-11.3, 12, -10.6), new THREE.Vector3(-21, 15, -23.6), 5.5, 0.06);
  catenary(new THREE.Vector3(11.5, 14, -11), new THREE.Vector3(21, 18, -24), 4.0, 0.09);
  catenary(new THREE.Vector3(11.3, 11, -10.7), new THREE.Vector3(21, 16, -23.6), 6.0, 0.06);
  catenary(new THREE.Vector3(-21, 22, -24), new THREE.Vector3(21, 22, -24), 9.0, 0.14);
  catenary(new THREE.Vector3(-33, 26, -36), new THREE.Vector3(-8.5, 28, -48), 7.0, 0.12);
  catenary(new THREE.Vector3(33, 26, -36), new THREE.Vector3(8.5, 28, -48), 7.0, 0.12);
  catenary(new THREE.Vector3(-47, 30, -44), new THREE.Vector3(-33, 20, -36), 5.0, 0.1);
  catenary(new THREE.Vector3(47, 30, -44), new THREE.Vector3(33, 20, -36), 5.0, 0.1);
  for (const [x, z] of [
    [-15, -15],
    [16.5, -17],
    [-27, -30],
    [28, -28],
    [-40, -40],
  ] as Array<[number, number]>) {
    steel.box(x, 0, z, 0.07, 140, 0.07, T_CABLE);
  }

  // -------------------------------------------------------------------------
  // FAR: reactor core
  // -------------------------------------------------------------------------
  const plasmaGeo = new THREE.CylinderGeometry(6.2, 6.2, 150, 48, 1, true);
  plasmaGeo.translate(0, -61, REACTOR_Z);
  const plasma = new THREE.Mesh(plasmaGeo, plasmaMat);
  plasma.name = 'arena.reactorPlasma';
  root.add(plasma);
  const RIBS = 28;
  for (let i = 0; i < RIBS; i++) {
    const a = (i / RIBS) * Math.PI * 2;
    steel.box(Math.sin(a) * 7.0, -40, REACTOR_Z + Math.cos(a) * 7.0, 0.75, 120, 1.3, T_FAR, [0, a, 0]);
  }
  // upper casing (closed) and containment bands
  steel.cylinder(0, 44, REACTOR_Z, 7.9, 64, 'y', T_FAR, 40, true, { uv: 'keep', uvScale: [20, 26] });
  for (const [y, r, h] of [
    [12.6, 9.4, 2.6],
    [24, 8.6, 1.3],
    [36, 8.6, 1.3],
    [3.5, 8.0, 0.7],
    [-7, 8.3, 1.1],
    [-20, 8.5, 1.6],
    [-34, 8.5, 1.6],
  ] as Array<[number, number, number]>) {
    steel.cylinder(0, y, REACTOR_Z, r, h, 'y', T_PYLON_DARK, 48, false, { uv: 'keep', uvScale: [24, 1] });
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = 9.45;
    if (Math.cos(a) < -0.2) continue; // back side never visible
    addBulb(Math.sin(a) * r, 12.6, REACTOR_Z + Math.cos(a) * r, 0.22, AMBER, 1.3, i % 3 === 0 ? { speed: 2.0, phase: i } : undefined);
    addBulb(Math.sin(a) * 8.65, -20, REACTOR_Z + Math.cos(a) * 8.65, 0.18, AMBER_DEEP, 1.2);
  }
  // Rotating gantry ring around the core
  const ringBatch = new GeoBatch(PANEL_TILE);
  const torus = new THREE.TorusGeometry(14, 0.45, 8, 120);
  torus.rotateX(Math.PI / 2);
  ringBatch.add(torus, null, T_PYLON_DARK, { uv: 'keep', uvScale: [60, 1] });
  torus.dispose();
  const torus2 = new THREE.TorusGeometry(13.2, 0.2, 6, 120);
  torus2.rotateX(Math.PI / 2);
  torus2.translate(0, -0.7, 0);
  ringBatch.add(torus2, null, T_TRUSS, { uv: 'keep', uvScale: [60, 1] });
  torus2.dispose();
  const ringLampSpecs: LampSpec[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    ringBatch.box(sn * 10.9, 0, c * 10.9, 0.5, 0.5, 6.2, T_PYLON_DARK, [0, a, 0]);
    ringBatch.box(sn * 14, -0.2, c * 14, 1.4, 1.1, 1.6, T_PYLON, [0, a, 0]);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(sn * 14.75, -0.15, c * 14.75), new THREE.Quaternion(), new THREE.Vector3(0.2, 0.2, 0.2));
    ringLampSpecs.push({ matrix: m, color: AMBER.clone().multiplyScalar(1.6) });
  }
  const ring = new THREE.Group();
  ring.name = 'arena.reactorRing';
  ring.position.set(0, 5.2, REACTOR_Z);
  const ringMesh = new THREE.Mesh(ringBatch.build(), steelMat);
  ring.add(ringMesh);
  root.add(ring);

  // -------------------------------------------------------------------------
  // FAR: chamber wall, buttresses, window bands
  // -------------------------------------------------------------------------
  const wallGeo = flipInside(new THREE.CylinderGeometry(CHAMBER_R, CHAMBER_R, 240, 72, 1, true));
  wallGeo.translate(0, -20, REACTOR_Z);
  steel.add(wallGeo, null, [0.22, 0.24, 0.28], { uv: 'keep', uvScale: [62, 24] });
  wallGeo.dispose();
  // Window "decks": pairs of rows of small lit ports, warm low (furnace levels), cool high.
  const windowDecks: Array<[number, THREE.Color, number, number]> = [
    [-47, AMBER_DEEP, 2.2, 0.75],
    [-33, AMBER, 1.7, 0.55],
    [-17, WARM_WHITE, 1.3, 0.4],
    [18, COOL_WHITE, 1.5, 0.45],
    [32, COOL_WHITE, 1.5, 0.5],
    [47, COOL_WHITE, 1.4, 0.45],
  ];
  for (let deg = -110; deg <= 110; deg += 10) {
    const th = THREE.MathUtils.degToRad(deg);
    const sx = Math.sin(th);
    const cz = -Math.cos(th);
    steel.box(sx * (CHAMBER_R - 1.5), -20, REACTOR_Z + cz * (CHAMBER_R - 1.5), 4.2, 240, 3.0, T_FAR, [0, -th, 0]);
    // vertical light strip on each buttress
    if (deg % 20 === 0) {
      addQuad(sx * (CHAMBER_R - 3.05), 0, REACTOR_Z + cz * (CHAMBER_R - 3.05), 0.35, 60, -th, AMBER, 0.6);
    }
  }
  for (const [y0, color, intensity, fill] of windowDecks) {
    for (const dy of [0, 1.15]) {
      let lit = rng() < fill;
      let run = 1 + Math.floor(rng() * 5);
      for (let deg = -106; deg <= 106; deg += 1.0) {
        const m10 = ((deg % 10) + 10) % 10;
        if (m10 < 2.2 || m10 > 7.8) continue; // buttress
        if (--run <= 0) {
          lit = rng() < fill;
          run = lit ? 2 + Math.floor(rng() * 7) : 1 + Math.floor(rng() * 5);
        }
        if (!lit) continue;
        const th = THREE.MathUtils.degToRad(deg);
        const r = CHAMBER_R - 0.2;
        const k = 0.65 + rng() * 0.35;
        addQuad(Math.sin(th) * r, y0 + dy, REACTOR_Z - Math.cos(th) * r, 1.05, 0.5, -th, color, intensity * k);
      }
    }
    // a continuous dim ledge strip under each deck gives the rows a readable structure
    for (let deg = -106; deg <= 106; deg += 2.5) {
      const th = THREE.MathUtils.degToRad(deg);
      const r = CHAMBER_R - 0.15;
      addQuad(Math.sin(th) * r, y0 - 0.75, REACTOR_Z - Math.cos(th) * r, 4.4, 0.12, -th, color, intensity * 0.35);
    }
  }

  // Lower ring catwalk around the reactor (depth layer for wide shots)
  {
    const ringY = -13;
    const deckRing = new THREE.RingGeometry(17.5, 20.5, 96, 1);
    deckRing.rotateX(-Math.PI / 2);
    deckRing.translate(0, ringY, REACTOR_Z);
    steel.add(deckRing, null, T_MID, { uv: 'box' });
    deckRing.dispose();
    const rimGeo = new THREE.CylinderGeometry(20.5, 20.5, 0.6, 96, 1, true);
    rimGeo.translate(0, ringY - 0.3, REACTOR_Z);
    steel.add(rimGeo, null, T_PYLON_DARK, { uv: 'keep', uvScale: [50, 1] });
    rimGeo.dispose();
    const railGeo = new THREE.TorusGeometry(20.3, 0.06, 4, 128);
    railGeo.rotateX(Math.PI / 2);
    railGeo.translate(0, ringY + 1.0, REACTOR_Z);
    steel.add(railGeo, null, T_RAIL, { uv: 'keep', uvScale: [60, 1] });
    railGeo.dispose();
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      if (Math.cos(a) < -0.3) continue;
      const sx = Math.sin(a);
      const cz = Math.cos(a);
      steel.box(sx * 20.3, ringY + 0.5, REACTOR_Z + cz * 20.3, 0.07, 1.0, 0.07, T_RAIL);
      if (i % 2 === 0) addQuad(sx * 20.52, ringY - 0.3, REACTOR_Z + cz * 20.52, 0.5, 0.1, a, AMBER, 1.3);
      if (i % 6 === 0) {
        // radial spokes back to the core casing
        steel.box(sx * 13.5, ringY - 0.5, REACTOR_Z + cz * 13.5, 0.5, 0.7, 8.5, T_TRUSS, [0, a, 0]);
      }
    }
  }

  // Hanging industrial lamps above the bridge background: cool counter-light to the orange abyss
  for (const [x, z, y] of [
    [-6.5, -10, 5.8],
    [6.0, -11, 6.1],
    [-17, -12, 6.4],
    [17.5, -13, 6.2],
  ] as Array<[number, number, number]>) {
    const shade = new THREE.CylinderGeometry(0.22, 0.6, 0.45, 14, 1, true);
    shade.translate(x, y, z);
    steel.add(shade, null, T_PYLON_DARK, { uv: 'keep', uvScale: [2, 1] });
    shade.dispose();
    steel.cylinder(x, y + 0.32, z, 0.12, 0.25, 'y', T_PYLON_DARK, 10);
    steel.box(x, y + 40, z, 0.035, 80, 0.035, T_CABLE);
    addBulb(x, y - 0.18, z, 0.15, COOL_WHITE, 1.25);
    glow.card(x, y - 0.25, z + 0.3, 2.4, 1.5, GlowKind.Radial, 0.2, 0, 0, COOL_WHITE);
    // soft downward light cone
    glow.quad(
      [
        new THREE.Vector3(x - 2.6, y - 7.5, z),
        new THREE.Vector3(x + 2.6, y - 7.5, z),
        new THREE.Vector3(x + 0.45, y - 0.2, z),
        new THREE.Vector3(x - 0.45, y - 0.2, z),
      ],
      GlowKind.Shaft,
      0.07,
      0.006,
      x,
      COOL_WHITE,
    );
  }

  // -------------------------------------------------------------------------
  // MOTION / ATMOSPHERE: haze sheets, abyss glow, shafts, halos
  // -------------------------------------------------------------------------
  const hazeWarm = new THREE.Color(1.0, 0.55, 0.3);
  const hazeCool = new THREE.Color(0.55, 0.62, 0.78);
  glow.card(0, -3, -7.5, 80, 24, GlowKind.Haze, 0.035, 0.006, 0.1, hazeWarm);
  glow.card(0, 1, -17, 120, 46, GlowKind.Haze, 0.045, 0.004, 0.53, hazeWarm);
  glow.card(0, 8, -31, 170, 70, GlowKind.Haze, 0.05, -0.003, 0.27, hazeCool);
  glow.card(0, -6, -46, 220, 90, GlowKind.Haze, 0.06, 0.0025, 0.71, hazeWarm);
  glow.floor(-150, 150, -160, 40, -8.5, GlowKind.AbyssGlow, 0.32, 0.004, 0.2, new THREE.Color(1.0, 0.4, 0.1));
  glow.floor(-170, 170, -170, 40, -21, GlowKind.AbyssGlow, 0.45, -0.003, 0.6, new THREE.Color(1.0, 0.36, 0.08));
  // reactor halo (pulses)
  glow.card(0, -6, REACTOR_Z + 10, 46, 70, GlowKind.Radial, 0.22, -1, 0, new THREE.Color(1.0, 0.38, 0.1));
  glow.card(0, -2, REACTOR_Z + 9, 22, 30, GlowKind.Radial, 0.2, -1, 0, new THREE.Color(1.0, 0.5, 0.18));
  // light shafts from ceiling vents
  const shaftColor = new THREE.Color(0.6, 0.72, 0.95);
  glow.card(-24, 14, -34, 7, 110, GlowKind.Shaft, 0.1, 0.01, 0.1, shaftColor, -0.14);
  glow.card(-9, 20, -41, 5, 110, GlowKind.Shaft, 0.085, 0.012, 0.4, shaftColor, -0.06);
  glow.card(13, 16, -37, 6, 110, GlowKind.Shaft, 0.095, 0.009, 0.7, shaftColor, 0.08);
  glow.card(30, 12, -28, 8, 110, GlowKind.Shaft, 0.085, 0.011, 0.9, shaftColor, 0.17);
  glow.card(-38, 10, -24, 7, 110, GlowKind.Shaft, 0.075, 0.008, 0.3, shaftColor, -0.2);
  // halos around column bulbs
  for (const [x, z, r] of columns) {
    glow.card(x, 9.5, z + r * 1.22 + 0.15, 2.2, 2.2, GlowKind.Radial, 0.35, 1.4, x * 0.7, AMBER);
  }

  // -------------------------------------------------------------------------
  // Assemble meshes
  // -------------------------------------------------------------------------
  const steelMesh = new THREE.Mesh(steel.build(), steelMat);
  steelMesh.name = 'arena.steel';
  steelMesh.receiveShadow = true;
  root.add(steelMesh);

  const hazardMesh = new THREE.Mesh(hazard.build(), hazardMat);
  hazardMesh.name = 'arena.hazard';
  hazardMesh.receiveShadow = true;
  root.add(hazardMesh);

  const decalGeo = new GeoBatchDecals(decalParts).build();
  for (const g of decalParts) g.dispose();
  const decals = new THREE.Mesh(decalGeo, decalMat);
  decals.name = 'arena.decals';
  decals.renderOrder = 5;
  root.add(decals);

  const quadGeo = new THREE.PlaneGeometry(1, 1);
  const lamps = new THREE.InstancedMesh(quadGeo, lampMat, quads.length);
  lamps.name = 'arena.lampQuads';
  quads.forEach((q, i) => {
    lamps.setMatrixAt(i, q.matrix);
    lamps.setColorAt(i, q.color);
  });
  lamps.instanceMatrix.needsUpdate = true;
  if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
  lamps.computeBoundingSphere();
  root.add(lamps);

  const bulbGeo = new THREE.SphereGeometry(1, 10, 6);
  const bulbMesh = new THREE.InstancedMesh(bulbGeo, lampMat, bulbs.length);
  bulbMesh.name = 'arena.bulbs';
  bulbs.forEach((b, i) => {
    bulbMesh.setMatrixAt(i, b.matrix);
    bulbMesh.setColorAt(i, b.color);
  });
  bulbMesh.instanceMatrix.needsUpdate = true;
  bulbMesh.computeBoundingSphere();
  root.add(bulbMesh);

  const ringLamps = new THREE.InstancedMesh(bulbGeo, lampMat, ringLampSpecs.length);
  ringLamps.name = 'arena.ringLamps';
  ringLampSpecs.forEach((b, i) => {
    ringLamps.setMatrixAt(i, b.matrix);
    ringLamps.setColorAt(i, b.color);
  });
  ringLamps.computeBoundingSphere();
  ring.add(ringLamps);

  const atmosphere = glow.build(tex.noise, fog, uTime, uPulse);
  root.add(atmosphere);

  const embers = createEmbers(rng, EMBERS_HIGH, fog, uTime);
  root.add(embers.points);

  const dome = createSkyDome(fog);
  root.add(dome);

  // -------------------------------------------------------------------------
  // Lighting rig
  // -------------------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0x7088b8, 0x8a4220, 0.8);
  hemi.name = 'arena.hemi';
  root.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xe4eaff, 2.3);
  keyLight.name = 'arena.keyLight';
  keyLight.position.set(-3.2, 10, 4.6);
  keyLight.target.position.set(0, 0, 0);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.025;
  keyLight.shadow.radius = 2.5;
  root.add(keyLight, keyLight.target);
  fitShadowCamera(keyLight);

  // Warm reactor rim: a directional from straight behind/below (no side spill onto the
  // bulkheads) plus two narrow spots from behind-left/right that wrap the silhouettes.
  const RIM_BASE = 2.0;
  const rimLight = new THREE.DirectionalLight(0xff8a3c, RIM_BASE);
  rimLight.name = 'arena.rimLight';
  rimLight.position.set(0, -3.2, -10);
  rimLight.target.position.set(0, 1, 0);
  root.add(rimLight, rimLight.target);

  const RIM_SPOT_BASE = 360;
  const rimSpots: THREE.SpotLight[] = [];
  for (const s of [-1, 1]) {
    const spot = new THREE.SpotLight(0xff7a30, RIM_SPOT_BASE, 0, 0.44, 0.85, 2);
    spot.name = `arena.rimSpot${s > 0 ? 'R' : 'L'}`;
    spot.position.set(s * 12, -1.2, -9);
    spot.target.position.set(0, 1.4, 0);
    root.add(spot, spot.target);
    rimSpots.push(spot);
  }

  // -------------------------------------------------------------------------
  // Scene-level settings
  // -------------------------------------------------------------------------
  const envRT = createEnvironment(renderer, fog);
  const prevBackground = scene.background;
  const prevFog = scene.fog;
  const prevEnv = scene.environment;
  const bgColor = fog.uFogMid.value.clone();
  scene.background = bgColor;
  const sceneFog = new THREE.FogExp2(bgColor.clone(), fog.uFogDensity.value);
  scene.fog = sceneFog;
  scene.environment = envRT.texture;

  // -------------------------------------------------------------------------
  // Animation
  // -------------------------------------------------------------------------
  let reduced = false;
  let quality: 'high' | 'low' = 'high';
  let lastApplied = Number.NaN;
  const animQuads = quads.map((q, i) => ({ q, i })).filter((e) => e.q.anim);
  const animBulbs = bulbs.map((b, i) => ({ b, i })).filter((e) => e.b.anim);
  const tmpColor = new THREE.Color();
  const bufSize = new THREE.Vector2();

  const apply = (t: number): void => {
    if (t === lastApplied) return;
    lastApplied = t;
    uTime.value = t;
    const pulse = 0.9 + 0.08 * Math.sin(t * 0.85) + 0.04 * Math.sin(t * 2.3 + 1.3);
    uPulse.value = pulse;
    ring.rotation.y = t * 0.045;
    rimLight.intensity = RIM_BASE * (0.92 + 0.1 * (pulse - 0.9) / 0.12);
    for (const sp of rimSpots) sp.intensity = RIM_SPOT_BASE * (0.92 + 0.1 * (pulse - 0.9) / 0.12);
    for (const { q, i } of animQuads) {
      const a = q.anim as { speed: number; phase: number };
      lamps.setColorAt(i, tmpColor.copy(q.color).multiplyScalar(blink(t, a.speed, a.phase)));
    }
    if (animQuads.length && lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    for (const { b, i } of animBulbs) {
      const a = b.anim as { speed: number; phase: number };
      bulbMesh.setColorAt(i, tmpColor.copy(b.color).multiplyScalar(blink(t, a.speed, a.phase)));
    }
    if (animBulbs.length && bulbMesh.instanceColor) bulbMesh.instanceColor.needsUpdate = true;
  };

  const syncViewport = (): void => {
    renderer.getDrawingBufferSize(bufSize);
    embers.uniforms.uViewH.value = Math.max(1, bufSize.y);
  };

  const setQuality = (q: 'high' | 'low'): void => {
    quality = q;
    const size = q === 'high' ? 2048 : 1024;
    if (keyLight.shadow.mapSize.x !== size) {
      keyLight.shadow.mapSize.set(size, size);
      if (keyLight.shadow.map) {
        keyLight.shadow.map.dispose();
        keyLight.shadow.map = null;
      }
    }
    embers.setCount(q === 'high' ? EMBERS_HIGH : EMBERS_LOW);
  };

  setQuality(quality);
  syncViewport();
  apply(FROZEN_TIME);

  let disposed = false;
  return {
    wallX: WALL_X,
    keyLight,
    update(_dt: number, time: number): void {
      if (disposed) return;
      syncViewport();
      apply(reduced ? FROZEN_TIME : time);
    },
    setReducedMotion(enabled: boolean): void {
      reduced = enabled;
      if (enabled) apply(FROZEN_TIME);
    },
    setQuality,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      scene.remove(root);
      const mats = new Set<THREE.Material>();
      const geos = new Set<THREE.BufferGeometry>();
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) geos.add(mesh.geometry);
        if (mesh.material) {
          const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of list) mats.add(m);
        }
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      });
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      for (const t of Object.values(tex)) t.dispose();
      keyLight.shadow.map?.dispose();
      keyLight.dispose();
      rimLight.dispose();
      rimSpots.forEach((l) => l.dispose());
      hemi.dispose();
      envRT.dispose();
      if (scene.background === bgColor) scene.background = prevBackground;
      if (scene.fog === sceneFog) scene.fog = prevFog;
      if (scene.environment === envRT.texture) scene.environment = prevEnv;
    },
  };
}

/** Merge decal quads (position/normal/uv/color) into one geometry. */
class GeoBatchDecals {
  constructor(private readonly parts: THREE.BufferGeometry[]) {}
  build(): THREE.BufferGeometry {
    const total = this.parts.reduce((n, g) => n + g.getAttribute('position').count, 0);
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const col = new Float32Array(total * 3);
    let o = 0;
    for (const g of this.parts) {
      const n = g.getAttribute('position').count;
      pos.set(g.getAttribute('position').array as Float32Array, o * 3);
      nrm.set(g.getAttribute('normal').array as Float32Array, o * 3);
      uv.set(g.getAttribute('uv').array as Float32Array, o * 2);
      col.set(g.getAttribute('color').array as Float32Array, o * 3);
      o += n;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    return geo;
  }
}

/**
 * Fit the key light's orthographic shadow camera tightly around the fight volume
 * x ∈ [-10, 10], y ∈ [0, 4.5], z ∈ [-2, 2] as seen from the light.
 * Call again after moving `keyLight` or its target.
 */
export function fitShadowCamera(light: THREE.DirectionalLight): void {
  light.updateMatrixWorld(true);
  light.target.updateMatrixWorld(true);
  const lp = new THREE.Vector3().setFromMatrixPosition(light.matrixWorld);
  const tp = new THREE.Vector3().setFromMatrixPosition(light.target.matrixWorld);
  const view = new THREE.Matrix4().lookAt(lp, tp, new THREE.Vector3(0, 1, 0));
  view.setPosition(lp);
  const inv = view.clone().invert();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const p = new THREE.Vector3();
  for (const x of [-10, 10]) {
    for (const y of [0, 4.5]) {
      for (const z of [-2, 2]) {
        p.set(x, y, z).applyMatrix4(inv);
        min.min(p);
        max.max(p);
      }
    }
  }
  const cam = light.shadow.camera;
  cam.left = min.x - 0.1;
  cam.right = max.x + 0.1;
  cam.bottom = min.y - 0.1;
  cam.top = max.y + 0.1;
  cam.near = Math.max(0.1, -max.z - 6); // extra room toward the light for jumping casters
  cam.far = -min.z + 0.5;
  cam.updateProjectionMatrix();
}
