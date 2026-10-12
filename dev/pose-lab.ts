// Pose Lab — renders contact sheets of a fighter's animation clips for review.
// URL: /dev/pose-lab.html?char=kael&clip=heavy&from=0&to=33&step=2&cols=6&opp=1.7
// Clip names: any ClipName, plus walk / walkBack / run / stance / guard / crouch / crouchGuard.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { gaitPose } from '../src/render/anim/gait';
import { animsFor } from '../src/render/anim/index';
import { copyPose, NEUTRAL, type Pose } from '../src/render/anim/pose';
import type { ClipName } from '../src/render/anim/types';
import { LOOKS } from '../src/render/characters';
import { requestCharacterModel } from '../src/render/characterModels';
import { FighterRig } from '../src/render/rig/FighterRig';
import { GRAVITY } from '../src/sim/constants';
import { ROSTER } from '../src/sim/roster';
import type { CharacterId, MoveId } from '../src/sim/types';

const q = new URLSearchParams(location.search);
const char = (q.get('char') ?? 'kael') as CharacterId;
const oppChar = (q.get('oppChar') ?? 'kael') as CharacterId;
const clipName = q.get('clip') ?? 'stance';
const cols = Number(q.get('cols') ?? 6);
const W = Number(q.get('w') ?? 300);
const H = Number(q.get('h') ?? 300);
const oppDist = Number(q.get('opp') ?? 0);
const showHit = q.get('hit') !== '0';
const zoom = Number(q.get('zoom') ?? 5.2);
const camY = Number(q.get('camY') ?? 1.0);

const anims = animsFor(char);
const def = ROSTER[char];

const CLIP_MOVE: Partial<Record<string, MoveId>> = {
  light: 'light',
  light2: 'light',
  light3: 'light',
  heavy: 'heavy',
  heavyChain: 'heavy',
  crLight: 'crLight',
  crLight2: 'crLight',
  sweep: 'sweep',
  airLight: 'airLight',
  airHeavy: 'airHeavy',
  throwStart: 'throw',
  special: 'special',
  super: 'super',
  parry: 'parry',
};
const move = CLIP_MOVE[clipName] ? def.moves[CLIP_MOVE[clipName] as MoveId] : null;
const clip = (anims.clips as Record<string, (typeof anims.clips)[ClipName] | undefined>)[clipName];
const gait = clipName === 'walk' ? anims.walk : clipName === 'walkBack' ? anims.walkBack : clipName === 'run' ? anims.run : null;
const staticPose: Pose | null =
  clipName === 'stance' ? anims.stance : clipName === 'guard' ? anims.guard : clipName === 'crouch' ? anims.crouch : clipName === 'crouchGuard' ? anims.crouchGuard : null;

const length = clip ? clip.length : gait ? 40 : 0;
const from = Number(q.get('from') ?? 0);
const to = Number(q.get('to') ?? length);
const step = Number(q.get('step') ?? Math.max(1, Math.ceil((to - from) / 17)));
const frames: number[] = [];
for (let t = from; t <= to + 1e-6; t += step) frames.push(Math.round(t * 100) / 100);
if (staticPose) frames.splice(1);

// ------------------------------------------------------------------ scene
const glCanvas = document.querySelector<HTMLCanvasElement>('#gl')!;
const sheet = document.querySelector<HTMLCanvasElement>('#sheet')!;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x161a21);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
scene.add(new THREE.HemisphereLight(0x8899bb, 0x302820, 1.1));
const key = new THREE.DirectionalLight(0xe4eaff, 2.4);
key.position.set(-3, 8, 6);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -4;
key.shadow.camera.right = 4;
key.shadow.camera.top = 4;
key.shadow.camera.bottom = -1;
scene.add(key);
const rimLight = new THREE.DirectionalLight(0xff9a50, 1.6);
rimLight.position.set(1, 2, -6);
scene.add(rimLight);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 8), new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.6, metalness: 0.3 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(30, 60, 0x3a414c, 0x2a3038);
grid.position.y = 0.002;
scene.add(grid);

// Use the GLB fighter models when present (falls back to the procedural body).
await Promise.all([requestCharacterModel(char), requestCharacterModel(oppChar)]);
const rig = new FighterRig(LOOKS[char]);
scene.add(rig.root);
let opp: FighterRig | null = null;
if (oppDist > 0) {
  opp = new FighterRig(LOOKS[oppChar]);
  scene.add(opp.root);
}

const fighterX = oppDist > 0 ? -oppDist / 2 : 0;
const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
const camX = oppDist > 0 ? 0 : 0.3;
camera.position.set(camX, camY + 0.35, zoom);
camera.lookAt(camX, camY, 0);

// Hitbox overlay.
const boxGeo = new THREE.BufferGeometry();
const boxPos = new Float32Array(8 * 3 * 4);
boxGeo.setAttribute('position', new THREE.BufferAttribute(boxPos, 3));
const boxLines = new THREE.LineSegments(boxGeo, new THREE.LineBasicMaterial({ color: 0xff3344, depthTest: false }));
boxLines.renderOrder = 99;
scene.add(boxLines);

function setBoxes(boxes: Array<{ x0: number; x1: number; y0: number; y1: number }>, x: number, y: number): void {
  boxPos.fill(0);
  boxes.slice(0, 4).forEach((b, i) => {
    const pts = [
      [b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y0], [b.x1, b.y1],
      [b.x1, b.y1], [b.x0, b.y1], [b.x0, b.y1], [b.x0, b.y0],
    ];
    pts.forEach(([px, py], k) => {
      const o = (i * 8 + k) * 3;
      boxPos[o] = x + px;
      boxPos[o + 1] = y + py;
      boxPos[o + 2] = 0.6;
    });
  });
  boxGeo.attributes.position.needsUpdate = true;
}

// ------------------------------------------------------------------ sampling helpers
const jumpNames = new Set(['jumpUp', 'jumpFwd', 'jumpBack', 'jumpRun']);
const fallNames = new Set(['fallBlowback', 'fallSweep', 'fallSpin', 'fallThrow', 'fallKo', 'airRecover']);
function heightAt(t: number): number {
  if (q.get('y')) return Number(q.get('y'));
  if (jumpNames.has(clipName)) return Math.max(0, def.jumpVy * t - 0.5 * GRAVITY * t * t);
  if (clipName === 'airLight' || clipName === 'airHeavy') return Math.max(0, 1.5 - 0.5 * GRAVITY * t * t);
  if (fallNames.has(clipName)) return Math.max(0, 0.12 * t - 0.5 * GRAVITY * t * t);
  if (clipName === 'gripVictim') return 0.8;
  if (clipName === 'special' && def.moves.special.arc) {
    const { from: a, to: b, height } = def.moves.special.arc;
    return t >= a && t <= b ? height * Math.sin((Math.PI * (t - a)) / (b - a)) : 0;
  }
  return 0;
}
function travelAt(t: number): number {
  if (!move?.travel) return 0;
  let x = 0;
  for (let f = 1; f <= t; f += 1) for (const s of move.travel) if (f >= s.from && f <= s.to) x += s.dx;
  return x;
}

const pose: Pose = { ...NEUTRAL };
const ctx = sheet.getContext('2d')!;
const rows = Math.ceil(frames.length / cols);
sheet.width = cols * W;
sheet.height = rows * H + 26;
ctx.fillStyle = '#0b0d11';
ctx.fillRect(0, 0, sheet.width, sheet.height);
ctx.font = 'bold 15px system-ui, sans-serif';
ctx.fillStyle = '#e8edf4';
ctx.fillText(`${def.name} · ${clipName}${move ? `  (startup ${move.startup} · active ${move.activeFrom}-${move.activeTo} · total ${move.total})` : ''}`, 8, 18);

frames.forEach((t, i) => {
  if (staticPose) copyPose(pose, staticPose);
  else if (clip) clip.sample(t, pose);
  else if (gait) gaitPose(gait, t / 40, pose);
  const x = fighterX + travelAt(t) + (gait ? (t / 40) * gait.stride * (clipName === 'walkBack' ? -1 : 1) : 0);
  const y = heightAt(t);
  rig.applyPose(pose, x, y, 1, null, 0);
  rig.weapon.setExtension(pose.blade, pose.blade2);
  if (opp) {
    const oa = animsFor(oppChar);
    opp.applyPose(oa.stance, fighterX + oppDist, 0, -1, null, 0);
    opp.weapon.setExtension(1, 1);
  }
  const active: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  if (showHit && move) {
    for (const w of move.hits) if (t >= w.from && t <= w.to) active.push(w.spec.box);
    if (move.grab && t >= move.grab.from && t <= move.grab.to) active.push(move.grab.box);
  }
  setBoxes(active, x, y);
  // Follow the fighter for travelling clips.
  const cx = (gait || (move?.travel && oppDist === 0) ? x + 0.3 : camX);
  camera.position.x = cx;
  camera.lookAt(cx, camY, 0);
  renderer.render(scene, camera);
  const col = i % cols;
  const row = Math.floor(i / cols);
  ctx.drawImage(glCanvas, col * W, 26 + row * H);
  let phase = '#7a8696';
  if (move) phase = t < move.activeFrom ? '#d0a040' : t <= move.activeTo ? '#ff4455' : '#4a90e0';
  ctx.fillStyle = phase;
  ctx.fillRect(col * W, 26 + row * H, W, 4);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.fillText(`f${t}`, col * W + 6, 26 + row * H + 20);
  ctx.strokeStyle = '#000';
  ctx.strokeRect(col * W + 0.5, 26 + row * H + 0.5, W - 1, H - 1);
});

(window as unknown as { __SHEET__: string; __READY__: boolean }).__SHEET__ = sheet.toDataURL('image/png');
(window as unknown as { __READY__: boolean }).__READY__ = true;
