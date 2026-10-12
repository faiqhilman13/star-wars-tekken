// Model Lab — orbit views of one fighter model for close-up review (faces, hands, joints, cloth).
// URL: /dev/model-lab.html?char=kael&clip=stance&t=0&az=0,90,180,270&el=10&dist=2.2&ty=1.1&w=360&h=420&facing=1&alt=0
//   clip=rest renders the bind pose with the blade along +z through the fist (compare with the GLB authoring).
//   toon=0 plain lit shading, outline=0 no ink outlines, expr=shout:1,blink:1 face morphs.
//   procedural=1 forces the procedural body; hide=solid,double,metal hides procedural layers; sil=1 silhouettes;
//   focus=<joint> centres the camera on a joint; flash=<amount>&flat=1&flashColor=<int> previews the hit flash.
//   az: camera azimuths in degrees around the fighter (0 = camera in front of the game camera's view,
//   i.e. the usual side view; 90 = looking at the fighter's face). Several clips/frames: clip=heavy&t=8,14.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { gaitPose } from '../src/render/anim/gait';
import { animsFor } from '../src/render/anim/index';
import { copyPose, NEUTRAL, type Pose } from '../src/render/anim/pose';
import type { ClipName } from '../src/render/anim/types';
import { lookFor } from '../src/render/characters';
import { modelOptions, requestCharacterModel } from '../src/render/characterModels';
import { FighterRig } from '../src/render/rig/FighterRig';
import type { CharacterId } from '../src/sim/types';

const q = new URLSearchParams(location.search);
const char = (q.get('char') ?? 'kael') as CharacterId;
const clipName = q.get('clip') ?? 'stance';
const times = (q.get('t') ?? '0').split(',').map(Number);
const azs = (q.get('az') ?? '0,90,180,270').split(',').map(Number);
const el = Number(q.get('el') ?? 8);
const dist = Number(q.get('dist') ?? 4.2);
const ty = Number(q.get('ty') ?? 1.0);
const tx = Number(q.get('tx') ?? 0);
const tz = Number(q.get('tz') ?? 0);
const W = Number(q.get('w') ?? 360);
const H = Number(q.get('h') ?? 440);
const facing = (Number(q.get('facing') ?? 1) < 0 ? -1 : 1) as 1 | -1;
const alt = q.get('alt') === '1';
const fov = Number(q.get('fov') ?? 30);
const flash = Number(q.get('flash') ?? 0);
const flat = q.get('flat') === '1';

const anims = animsFor(char);
const clip = (anims.clips as Record<string, (typeof anims.clips)[ClipName] | undefined>)[clipName];
const gait = clipName === 'walk' ? anims.walk : clipName === 'walkBack' ? anims.walkBack : clipName === 'run' ? anims.run : null;
/** Bind/rest pose: arms and legs straight down, blade along +z through the fist (the GLB authoring pose). */
function restPoseFor(): Pose {
  const p: Pose = { ...NEUTRAL };
  for (const k of ['hipLean', 'spine', 'chest', 'twist', 'head', 'hipYaw', 'hipRoll', 'spineYaw', 'chestRoll', 'headYaw', 'headRoll', 'roll', 'fPitch', 'bPitch', 'fKnee', 'bKnee', 'nElbow', 'fElbow', 'fz', 'bz', 'fx', 'bx', 'fy', 'by'] as const) p[k] = 0;
  p.hipY = 1.02;
  p.gx = 0;
  p.gy = 1.02 - 0.045;
  p.gz = 0.19;
  p.pitch = 0;
  p.yaw = 90;
  p.off = 1;
  p.ox = 0;
  p.oy = 1.02 - 0.045;
  p.oz = -0.19;
  p.g2x = 0;
  p.g2y = 1.02 - 0.045;
  p.g2z = -0.19;
  p.pitch2 = 0;
  p.yaw2 = 90;
  return p;
}
const staticPose: Pose | null =
  clipName === 'rest' ? restPoseFor() :
  clipName === 'stance' ? anims.stance : clipName === 'guard' ? anims.guard : clipName === 'crouch' ? anims.crouch : clipName === 'crouchGuard' ? anims.crouchGuard : null;

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
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.025;
key.shadow.camera.left = -3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 3;
key.shadow.camera.bottom = -1;
scene.add(key);
const rimLight = new THREE.DirectionalLight(0xff9a50, 1.6);
rimLight.position.set(1, 2, -6);
scene.add(rimLight);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.6, metalness: 0.3 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// GLB fighter models (public/models/<id>.glb) when present; procedural=1 forces the procedural body.
const procedural = q.get('procedural') === '1';
// slots=0: one draw per material (compare against the multi-material slot draws).
if (q.get('slots') === '0') modelOptions.slots = false;
// model=<id>: wear another character's GLB (e.g. char=asha&model=kael tests Kael's hands on dual hilts).
const modelId = (q.get('model') ?? char) as CharacterId;
if (!procedural) await requestCharacterModel(modelId);
const rig = new FighterRig(lookFor(char, alt), { procedural, modelId });
scene.add(rig.root);
// Toon / outline toggles (outline=0 hides the ink hulls, toon=0 swaps the toon shading for plain lit).
if (q.get('outline') === '0') rig.setOutlines(false);
if (q.get('toon') === '0') {
  rig.root.traverse((o) => {
    const m = o as THREE.Mesh;
    const mat = m.material as (THREE.ShaderMaterial & { isToon?: boolean }) | undefined;
    if (!m.isMesh || !mat?.isToon) return;
    const map = (mat.uniforms.uMap?.value as THREE.Texture | null) ?? null;
    m.material = new THREE.MeshStandardMaterial({ vertexColors: mat.vertexColors, map, side: mat.side, roughness: 0.8, alphaTest: mat.uniforms.uAlphaTest.value as number });
  });
}
// Hide mesh layers by name (fighter-solid, fighter-double, fighter-metal), e.g. hide=double,metal.
for (const name of (q.get('hide') ?? '').split(',').filter(Boolean)) {
  rig.root.traverse((o) => {
    if (o.name === `fighter-${name}`) o.visible = false;
  });
}
if (q.get('sil') === '1') {
  // Silhouette check: flat black shapes on white.
  scene.background = new THREE.Color(0xffffff);
  scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
  floor.visible = false;
}
if (flash > 0) rig.setFlash(flash, q.get('flashColor') ? Number(q.get('flashColor')) : 0xffffff, flat);
const camera = new THREE.PerspectiveCamera(fov, W / H, 0.05, 100);
const pose: Pose = { ...NEUTRAL };
const ctx = sheet.getContext('2d')!;
const cols = azs.length;
const rows = times.length;
sheet.width = cols * W;
sheet.height = rows * H + 22;
ctx.fillStyle = '#0b0d11';
ctx.fillRect(0, 0, sheet.width, sheet.height);
ctx.font = 'bold 14px system-ui, sans-serif';
ctx.fillStyle = '#e8edf4';
ctx.fillText(`${char}${alt ? ' (alt)' : ''} · ${rig.bodyKind} body · ${clipName} · facing ${facing} · ${rig.triangles} tris`, 8, 16);

times.forEach((t, r) => {
  if (staticPose) copyPose(pose, staticPose);
  else if (clip) clip.sample(t, pose);
  else if (gait) gaitPose(gait, t / 40, pose);
  // p.<key>=value overrides any pose channel (e.g. p.palm=1, p.yaw=-90).
  for (const [k, v] of q.entries()) if (k.startsWith('p.') && k.slice(2) in pose) (pose as unknown as Record<string, number>)[k.slice(2)] = Number(v);
  rig.applyPose(pose, 0, Number(q.get('y') ?? 0), facing, null, 0);
  // expr=shout:1,blink:0.5 drives the face's expr_* morphs.
  if (q.get('expr')) {
    const e = { blink: 0, angry: 0, shout: 0, pain: 0, smile: 0, focus: 0 };
    for (const kv of (q.get('expr') ?? '').split(',')) {
      const [k, v] = kv.split(':');
      if (k in e) e[k as keyof typeof e] = Number(v ?? 1);
    }
    rig.setExpression(e);
  }
  rig.weapon.setExtension(pose.blade, pose.blade2);
  if (q.get('noweapon') === '1') {
    rig.weapon.main.visible = false;
    rig.weapon.second.visible = false;
  }
  if (q.get('marker') === '1') {
    // Contract grip markers: a thin rod along the hand's local z through (0, -FIST, 0) of each hand.
    for (const hand of [rig.j.handN, rig.j.handF]) {
      if (!hand.getObjectByName('grip-marker')) {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 16).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3aa0ff, wireframe: true }));
        rod.name = 'grip-marker';
        rod.position.set(0, -0.045, 0);
        hand.add(rod);
      }
    }
  }
  // Optional focus on a joint (e.g. focus=handN, focus=head, focus=shinF), plus the tx/ty/tz offset.
  const focus = q.get('focus') as keyof FighterRig['j'] | null;
  const fp = new THREE.Vector3(tx, ty, tz);
  if (focus && rig.j[focus]) {
    rig.root.updateMatrixWorld(true);
    rig.j[focus].getWorldPosition(fp);
    fp.x += tx;
    fp.y += q.get('ty') ? ty : 0;
    fp.z += tz;
  }
  azs.forEach((az, c) => {
    const a = (az * Math.PI) / 180;
    const e = (el * Math.PI) / 180;
    camera.position.set(fp.x + Math.sin(a) * Math.cos(e) * dist, fp.y + Math.sin(e) * dist, fp.z + Math.cos(a) * Math.cos(e) * dist);
    camera.lookAt(fp);
    renderer.render(scene, camera);
    ctx.drawImage(glCanvas, c * W, 22 + r * H);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(`az${az} t${t}`, c * W + 6, 22 + r * H + 16);
    ctx.strokeStyle = '#000';
    ctx.strokeRect(c * W + 0.5, 22 + r * H + 0.5, W - 1, H - 1);
  });
});

if (q.get('info') === '1') {
  // Bound parts: mesh name, material (type), triangles, skinned bones.
  const lines: string[] = [];
  rig.root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material;
    const tris = (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
    lines.push(`${m.name || '(mesh)'} · ${mat.name || mat.type} (${mat.type}${mat.side === THREE.DoubleSide ? ', 2-sided' : ''}${mat.alphaTest ? `, alphaTest ${mat.alphaTest}` : ''}) · ${tris} tris${m.isSkinnedMesh ? ` · ${m.skeleton.bones.length} bones` : ''}${m.morphTargetDictionary ? ` · morphs ${Object.keys(m.morphTargetDictionary).join('/')}` : ''}`);
  });
  ctx.font = '12px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(4, 26, Math.min(sheet.width - 8, 900), lines.length * 15 + 8);
  ctx.fillStyle = '#d8e4f0';
  lines.forEach((l, i) => ctx.fillText(l, 10, 42 + i * 15));
}
(window as unknown as { __RIG__: FighterRig }).__RIG__ = rig;
(window as unknown as { __SHEET__: string; __READY__: boolean }).__SHEET__ = sheet.toDataURL('image/png');
(window as unknown as { __READY__: boolean }).__READY__ = true;
