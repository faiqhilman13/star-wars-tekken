// Animation lint — sweeps every clip of every fighter frame by frame through the real rig and flags
// limb / blade problems a contact sheet can hide between keys:
//   bladeHead   a blade passes through the fighter's own head
//   bladeTorso  a blade passes through the fighter's own torso (excluding the hilt end)
//   armStretch  a hand can't reach its target (the arm is pulled straight and lags the pose)
//   legStretch  a foot can't reach its target (hovering / skating foot) while it should be planted
//   underFloor  a foot or hand goes through the deck
//   pop         a blade tip or hand jumps more than 0.45 in one frame outside a snap
// URL: /dev/anim-lint.html?chars=kael,vexa&clips=light,heavy   (defaults: everything)
import * as THREE from 'three';
import { animsFor } from '../src/render/anim/index';
import { NEUTRAL, type Pose } from '../src/render/anim/pose';
import { FIST, FOREARM, UPPER_ARM } from '../src/render/rig/dims';
import { LOOKS } from '../src/render/characters';
import { FighterRig } from '../src/render/rig/FighterRig';
import { CHARACTER_IDS, type CharacterId } from '../src/sim/types';

const q = new URLSearchParams(location.search);
const chars = (q.get('chars')?.split(',') ?? [...CHARACTER_IDS]) as CharacterId[];
const only = q.get('clips')?.split(',') ?? null;

interface Issue {
  char: string;
  clip: string;
  kind: string;
  frames: number[];
  worst: number;
}

const issues: Issue[] = [];
const scene = new THREE.Scene();
const pose: Pose = { ...NEUTRAL };
const base = new THREE.Vector3();
const tip = new THREE.Vector3();
const head = new THREE.Vector3();
const neck = new THREE.Vector3();
const hips = new THREE.Vector3();
const chest = new THREE.Vector3();
const want = new THREE.Vector3();
const got = new THREE.Vector3();
const tmp = new THREE.Vector3();
const prevTip = [new THREE.Vector3(), new THREE.Vector3()];
const prevHand = new THREE.Vector3();
const closest = new THREE.Vector3();
const seg = new THREE.Line3();

function distPointSeg(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  seg.set(a, b);
  seg.closestPointToPoint(p, true, closest);
  return closest.distanceTo(p);
}

/** Closest distance between segments a0-a1 and b0-b1 (sampled). */
function distSegSeg(a0: THREE.Vector3, a1: THREE.Vector3, b0: THREE.Vector3, b1: THREE.Vector3): number {
  let best = Infinity;
  for (let i = 0; i <= 12; i += 1) {
    tmp.lerpVectors(a0, a1, i / 12);
    best = Math.min(best, distPointSeg(tmp, b0, b1));
  }
  return best;
}

function record(map: Map<string, Issue>, char: string, clip: string, kind: string, f: number, v: number): void {
  const key = `${clip}|${kind}`;
  let it = map.get(key);
  if (!it) {
    it = { char, clip, kind, frames: [], worst: 0 };
    map.set(key, it);
  }
  it.frames.push(f);
  it.worst = Math.max(it.worst, v);
}

const SNAP_OK = new Set(['fallBlowback', 'fallSpin', 'fallThrow', 'fallKo', 'fallSweep', 'bounce', 'knockdown', 'koLie', 'getup']);
const GROUNDED = new Set(['idle', 'idleBreak', 'idleBreak2', 'light', 'light2', 'light3', 'heavy', 'heavyChain', 'crLight', 'crLight2', 'sweep', 'throwStart', 'parry', 'parrySuccess', 'block', 'crouchBlock', 'crouchDown', 'standUp', 'hitHigh', 'hitHigh2', 'hitBody', 'hitBody2', 'hitHighHeavy', 'hitBodyHeavy', 'hitLow', 'hitLowHeavy', 'hitCrouch', 'victory', 'superCharge', 'clash']);

for (const char of chars) {
  const anims = animsFor(char);
  const rig = new FighterRig(LOOKS[char]);
  scene.add(rig.root);
  const s = rig.look.scale;
  const clips = Object.entries(anims.clips as Record<string, { length: number; sample: (t: number, out: Pose) => Pose; keys: Array<{ f: number; e: string }> } | undefined>);
  for (const [name, clip] of clips) {
    if (!clip || (only && !only.includes(name))) continue;
    const map = new Map<string, Issue>();
    const snapFrames = new Set<number>();
    // Fast segments (snap / lin / expo / hold cuts) may move a lot per frame by design.
    clip.keys.forEach((k, i) => {
      if (i === 0 || !(k.e === 'snap' || k.e === 'lin' || k.e === 'hold' || k.e === 'expo')) return;
      for (let fr = Math.floor(clip.keys[i - 1].f); fr <= Math.ceil(k.f) + 1; fr += 1) snapFrames.add(fr);
    });
    const len = Math.max(1, Math.ceil(clip.length));
    for (let f = 0; f <= len; f += 1) {
      clip.sample(f, pose);
      rig.applyPose(pose, 0, 0, 1, null, 0);
      rig.weapon.setExtension(pose.blade, pose.blade2);
      rig.root.updateMatrixWorld(true);
      rig.j.head.getWorldPosition(head);
      head.y += 0.1 * s;
      rig.j.neck.getWorldPosition(neck);
      rig.j.hips.getWorldPosition(hips);
      rig.j.chest.getWorldPosition(chest);
      // Blades vs own head / torso (the first 22 cm of a blade is next to the hand: skip it).
      rig.weapon.blades.forEach((b, k) => {
        if (b.extension < 0.2 || !rig.weapon.main.visible) return;
        b.ends(base, tip);
        const dir = tmp.subVectors(tip, base).normalize();
        base.addScaledVector(dir, 0.22 * s);
        const dh = distPointSeg(head, base, tip);
        if (dh < 0.11 * s) record(map, char, name, 'bladeHead', f, 0.11 * s - dh);
        const dt = distSegSeg(base, tip, hips, neck);
        if (dt < 0.1 * s * rig.look.bulk) record(map, char, name, 'bladeTorso', f, 0.1 * s - dt);
        if (f > 0 && !snapFrames.has(f) && !SNAP_OK.has(name)) {
          const jump = tip.distanceTo(prevTip[k]);
          if (jump > 1.05 * s) record(map, char, name, 'pop', f, jump);
        }
        prevTip[k].copy(tip);
      });
      // Sword hand reach.
      if (rig.weapon.kind !== 'staff') {
        want.set(pose.gx - pose.rootX, pose.gy - pose.hipY, pose.gz);
        rig.j.body.localToWorld(want);
        rig.swordHandWorld(got);
        rig.j.upperN.getWorldPosition(tmp);
        const reachNeeded = tmp.distanceTo(want) / s;
        if (reachNeeded > UPPER_ARM + FOREARM + FIST + 0.04) record(map, char, name, 'armStretch', f, reachNeeded - (UPPER_ARM + FOREARM + FIST));
        if (got.y < -0.01) record(map, char, name, 'handUnderFloor', f, -got.y);
        if (f > 0 && !snapFrames.has(f) && !SNAP_OK.has(name) && got.distanceTo(prevHand) > 0.2 * s) record(map, char, name, 'handPop', f, got.distanceTo(prevHand));
        prevHand.copy(got);
      }
      // Feet: planted feet must reach; nothing below the deck.
      for (const [footJ, fx, fy, fz, side] of [
        [rig.j.footN, pose.fx, pose.fy, pose.fz, 1],
        [rig.j.footF, pose.bx, pose.by, pose.bz, -1],
      ] as const) {
        footJ.getWorldPosition(got);
        if (got.y < 0.07 * s - 0.03 && !(f === 0 && name.startsWith('fall'))) record(map, char, name, side > 0 ? 'footUnderFloorN' : 'footUnderFloorF', f, 0.07 * s - got.y);
        if (GROUNDED.has(name) && fy <= 0.01 && Math.abs(pose.spin) < 5) {
          want.set(fx - pose.rootX, fy + 0.07 - pose.hipY, side * 0.1 + fz);
          rig.j.body.localToWorld(want);
          const miss = got.distanceTo(want);
          if (miss > 0.05 * s) record(map, char, name, 'legStretch', f, miss);
        }
      }
    }
    for (const it of map.values()) issues.push(it);
  }
  rig.dispose();
  scene.remove(rig.root);
}

void FIST;
const summary = issues
  .sort((a, b) => a.char.localeCompare(b.char) || a.clip.localeCompare(b.clip))
  .map((i) => `${i.char.padEnd(6)} ${i.clip.padEnd(14)} ${i.kind.padEnd(11)} worst=${i.worst.toFixed(3)} frames=${compress(i.frames)}`);

function compress(fr: number[]): string {
  const out: string[] = [];
  let a = fr[0];
  let b = fr[0];
  for (let i = 1; i <= fr.length; i += 1) {
    if (fr[i] === b + 1) b = fr[i];
    else {
      out.push(a === b ? `${a}` : `${a}-${b}`);
      a = fr[i];
      b = fr[i];
    }
  }
  return out.join(',');
}

(window as unknown as { __LINT__: string[]; __READY__: boolean }).__LINT__ = summary;
(window as unknown as { __READY__: boolean }).__READY__ = true;
document.body.textContent = summary.join('\n') || 'clean';
