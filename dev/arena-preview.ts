import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createArena } from '../src/render/Arena';

/**
 * Standalone arena preview.
 * URL params: camX, camZ, w, h, dpr, quality=low|high, reduced=1, t (start time),
 *             anim=0 (hold time at t), fighters=0, hud=1, frames (frames before READY).
 */

declare global {
  interface Window {
    __READY__?: boolean;
    __STATS__?: Record<string, number | string>;
    __ARENA__?: unknown;
    __RENDERER__?: unknown;
  }
}

const params = new URLSearchParams(location.search);
const num = (key: string, def: number): number => {
  const v = params.get(key);
  const n = v === null ? Number.NaN : Number(v);
  return Number.isFinite(n) ? n : def;
};

const camX = num('camX', 0);
const camZ = num('camZ', 10.5);
const width = Math.round(num('w', window.innerWidth));
const height = Math.round(num('h', window.innerHeight));
const dpr = num('dpr', 1);
const quality = params.get('quality') === 'low' ? 'low' : 'high';
const reduced = params.get('reduced') === '1';
const startTime = num('t', 4.0);
const animate = params.get('anim') !== '0';
const showFighters = params.get('fighters') !== '0';
const readyFrames = num('frames', 24);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(dpr);
renderer.setSize(width, height);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = num('exposure', 1.0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 400);
camera.position.set(camX, 1.9, camZ);
camera.lookAt(camX, 1.25, 0);

const t0 = performance.now();
const arena = createArena(scene, renderer, mulberry32(0x5abe7d));
const createMs = Math.round(performance.now() - t0);
arena.setQuality(quality);
arena.setReducedMotion(reduced);
window.__ARENA__ = arena;
window.__RENDERER__ = renderer;

// ---------------------------------------------------------------------------
// Placeholder fighters
// ---------------------------------------------------------------------------
const fighters = new THREE.Group();
fighters.name = 'fighters';
function makeFighter(x: number, facing: 1 | -1, bodyColor: number, saberColor: number): void {
  const g = new THREE.Group();
  g.position.set(x, 0, 0);
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.72, metalness: 0.05 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.25, 6, 16), bodyMat);
  body.position.y = 0.925;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  // simple head bump + hilt so the silhouette reads like a duelist
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), bodyMat);
  head.position.set(0.04 * facing, 1.72, 0);
  head.castShadow = true;
  g.add(head);
  const saber = new THREE.Group();
  saber.position.set(0.38 * facing, 1.05, 0.28);
  saber.rotation.z = -facing * 0.75;
  const hilt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.26, 12),
    new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 1, roughness: 0.3 }),
  );
  hilt.castShadow = true;
  saber.add(hilt);
  const bladeLen = 1.0;
  const core = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.022, bladeLen, 4, 10),
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 4 }),
  );
  core.position.y = 0.13 + bladeLen / 2;
  saber.add(core);
  const glowMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.06, bladeLen, 4, 12),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(saberColor).multiplyScalar(1.6),
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glowMesh.position.copy(core.position);
  saber.add(glowMesh);
  const light = new THREE.PointLight(saberColor, 6, 5, 2);
  light.position.copy(core.position);
  saber.add(light);
  g.add(saber);
  fighters.add(g);
}
makeFighter(-1.6, 1, 0x5e4a36, 0x3aa0ff);
makeFighter(1.6, -1, 0x17171b, 0xff2a2a);
fighters.visible = showFighters;
scene.add(fighters);

// ---------------------------------------------------------------------------
// Post
// ---------------------------------------------------------------------------
const composer = new EffectComposer(renderer);
composer.setPixelRatio(dpr);
composer.setSize(width, height);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.6, 0.35, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------
function arenaTextureCount(): number {
  const set = new Set<THREE.Texture>();
  const arenaRoot = scene.getObjectByName('Arena');
  arenaRoot?.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.material) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of list) {
      for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture) set.add(v as THREE.Texture);
      const u = (m as THREE.ShaderMaterial).uniforms;
      if (u) for (const val of Object.values(u)) if (val.value && (val.value as THREE.Texture).isTexture) set.add(val.value as THREE.Texture);
    }
  });
  return set.size;
}

const stats: Record<string, number | string> = {};
function measureArenaOnly(): void {
  const prev = fighters.visible;
  fighters.visible = false;
  renderer.info.reset();
  renderer.render(scene, camera);
  stats.arenaCalls = renderer.info.render.calls;
  stats.arenaTriangles = renderer.info.render.triangles;
  stats.arenaPoints = renderer.info.render.points;
  fighters.visible = prev;
}

let frame = 0;
let time = startTime;
let last = performance.now();
const hud = document.getElementById('stats') as HTMLDivElement;
if (params.get('hud') === '1') hud.style.display = 'block';

function tick(): void {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (animate && !reduced) time += dt;
  arena.update(dt, time);

  if (frame === readyFrames - 2) measureArenaOnly();

  renderer.info.reset();
  composer.render();
  frame++;

  if (frame === readyFrames) {
    stats.frameCalls = renderer.info.render.calls;
    stats.frameTriangles = renderer.info.render.triangles;
    stats.textures = renderer.info.memory.textures;
    stats.geometries = renderer.info.memory.geometries;
    stats.arenaTextures = arenaTextureCount();
    stats.programs = renderer.info.programs?.length ?? 0;
    stats.shadowMap = arena.keyLight.shadow.mapSize.x;
    stats.camX = camX;
    stats.camZ = camZ;
    stats.size = `${width}x${height}`;
    stats.quality = quality;
    stats.createMs = createMs;
    window.__STATS__ = stats;
    hud.textContent = Object.entries(stats)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    console.log('[arena-preview]', JSON.stringify(stats));
    window.__READY__ = true;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
