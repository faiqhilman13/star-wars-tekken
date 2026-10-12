import * as THREE from 'three';
import type { CharacterLook } from '../characters';
import type { Pose } from '../anim/pose';
import type { Secondary } from '../anim/springs';
import { characterModel, requestCharacterModel, type CharacterModel } from '../characterModels';
import { buildCostume, driveSkirt, floorClamp, type CostumeBuild, type CostumeParts } from './costumes';
import { buildModelBody } from './modelBody';
import { toonDefaults, toonMaterial, toonOutlineMaterial } from './toon';
import type { Expression } from '../anim/Animator';
import {
  ANKLE,
  CHEST_TO_NECK,
  CHEST_TO_SHOULDER,
  FIST,
  FOREARM,
  HIP_TO_SPINE,
  HIP_Z,
  NECK_TO_HEAD,
  PRESENT_YAW,
  SHIN,
  SHOULDER_Z,
  SPINE_TO_CHEST,
  THIGH,
  UPPER_ARM,
} from './dims';
import { Weapon } from './weapons';

const DEG = Math.PI / 180;
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const POLE_NEAR_ARM = new THREE.Vector3(-0.35, -1, 0.45).normalize();
const POLE_FAR_ARM = new THREE.Vector3(-0.35, -1, -0.45).normalize();
const POLE_KNEE = new THREE.Vector3(1, -0.05, 0).normalize();
/** Fallback hints used when a limb points along its primary pole (prevents elbow/knee flips). */
const POLE_NEAR_ARM_ALT = new THREE.Vector3(-1, -0.15, 0.55).normalize();
const POLE_FAR_ARM_ALT = new THREE.Vector3(-1, -0.15, -0.55).normalize();
const POLE_KNEE_ALT = new THREE.Vector3(0.2, 1, 0).normalize();

interface RimUniforms {
  uRimColor: { value: THREE.Color };
  uRimStrength: { value: number };
  uFlashColor: { value: THREE.Color };
  uFlash: { value: number };
  /** 0 = flash brightens the surface's own colours (hits), 1 = flat tint (parry / lightning). */
  uFlashFlat: { value: number };
}

function addRim(material: THREE.MeshStandardMaterial, uniforms: RimUniforms): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform vec3 uFlashColor;\nuniform float uFlash;\nuniform float uFlashFlat;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimFacing = 1.0 - saturate(abs(dot(normal, normalize(vViewPosition))));
        totalEmissiveRadiance += uRimColor * pow(rimFacing, 3.0) * uRimStrength
          + uFlashColor * uFlash * mix(diffuseColor.rgb * 3.0 + 0.03, vec3(1.0), uFlashFlat);`,
      );
  };
  material.customProgramCacheKey = () => 'fighter-rim';
}

/** Rig joints. They are the bones of the fighter's skinned body (Bone extends Object3D). */
export interface Joints {
  turn: THREE.Bone;
  body: THREE.Bone;
  hips: THREE.Bone;
  spine: THREE.Bone;
  chest: THREE.Bone;
  neck: THREE.Bone;
  head: THREE.Bone;
  upperN: THREE.Bone;
  foreN: THREE.Bone;
  handN: THREE.Bone;
  upperF: THREE.Bone;
  foreF: THREE.Bone;
  handF: THREE.Bone;
  thighN: THREE.Bone;
  shinN: THREE.Bone;
  footN: THREE.Bone;
  thighF: THREE.Bone;
  shinF: THREE.Bone;
  footF: THREE.Bone;
}

const g = () => new THREE.Bone();

/** Body, costume and hilt meshes cast shadows; outlines, glows, blades and tagged parts don't. */
function castsShadow(mesh: THREE.Mesh): boolean {
  if (mesh.userData.noShadow || mesh.userData.outline) return false;
  const m = mesh.material as THREE.Material;
  return !(m instanceof THREE.ShaderMaterial) || (m as THREE.ShaderMaterial & { isToon?: boolean }).isToon === true;
}

/**
 * Procedural fighter rig. A pose (see anim/pose.ts) drives the spine directly and places hands,
 * weapon and feet as IK targets; knees/elbows can be steered, fists rotate to grip their hilts,
 * shoulders shrug toward high targets, and cloth/hair dangle with spring lag.
 */
export class FighterRig {
  readonly root = new THREE.Group();
  readonly j: Joints = {
    turn: g(),
    body: g(),
    hips: g(),
    spine: g(),
    chest: g(),
    neck: g(),
    head: g(),
    upperN: g(),
    foreN: g(),
    handN: g(),
    upperF: g(),
    foreF: g(),
    handF: g(),
    thighN: g(),
    shinN: g(),
    footN: g(),
    thighF: g(),
    shinF: g(),
    footF: g(),
  };
  readonly weapon: Weapon;
  /** Driven costume parts (cloth anchors, chains, pads, hands). Replaced when the body is upgraded. */
  parts: CostumeParts;
  /** Toon body material (procedural body + costume: per-vertex toon params). */
  readonly cloth: THREE.Material;
  /** Same as cloth (kept for API compatibility: the toon body is one double-sided draw). */
  readonly clothDouble: THREE.Material;
  /** Toon hilt material (vertex-coloured metal). */
  readonly metal: THREE.Material;
  /** Ink outline (inverted hull) material for the procedural body. */
  readonly ink: THREE.ShaderMaterial;
  /** Main skeleton of the fighter's skinned body. */
  skeleton: THREE.Skeleton;
  /** Triangles in the body + costume (excluding the weapon). */
  triangles: number;
  /** 'model' once the authored GLB body is bound, else the procedural body. */
  bodyKind: 'model' | 'procedural' = 'procedural';
  private readonly rim: RimUniforms;
  /** Meshes whose geometry this rig owns (procedural body, rigid parts). */
  private readonly meshes: THREE.Mesh[] = [];
  /** Model meshes sharing the template geometry (not disposed with the rig). */
  private readonly borrowed: THREE.Mesh[] = [];
  private bodyMaterials: THREE.Material[] = [];
  private skeletons: THREE.Skeleton[] = [];
  private shadowsOn = true;
  /** The character's GLB is still loading: swap the body in when it lands (see upgradeBody). */
  private awaitingModel = false;
  /** Which character's GLB this rig wears (normally look.id; dev tools may override). */
  private readonly modelId: CharacterLook['id'];
  /**
   * Grip centres in hand-local space (where the hilt passes through each fist). Procedural bodies use
   * (0, -FIST, 0); GLB bodies use the measured centres from the model (realistic fists are longer).
   */
  private readonly gripN = new THREE.Vector3(0, -FIST, 0);
  private readonly gripF = new THREE.Vector3(0, -FIST, 0);
  /** Distance along the hilt from the sword hand's grip to the off hand's (two-handed holds). */
  private twoHandGap = 0.12;

  // Scratch.
  private readonly chestM = new THREE.Matrix4();
  private readonly hipsM = new THREE.Matrix4();
  private readonly invChest = new THREE.Matrix4();
  private readonly parentQ = new THREE.Quaternion();
  private readonly invQ = new THREE.Quaternion();
  private readonly chainQ = new THREE.Quaternion();
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();
  private readonly S = new THREE.Vector3();
  private readonly D = new THREE.Vector3();
  private readonly E = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly bend = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly hand = new THREE.Vector3();
  private readonly hand2 = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();
  private readonly reached = new THREE.Vector3();
  private readonly bladeDir = new THREE.Vector3();
  private readonly blade2Dir = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly bx = new THREE.Vector3();
  private readonly by = new THREE.Vector3();
  private readonly bz = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);

  /**
   * @param opts.procedural force the procedural body (dev comparison); by default the rig uses the
   * character's GLB model when it has loaded, and upgrades itself in place if it is still loading.
   * @param opts.modelId wear another character's model (dev: test grips across weapon kinds).
   */
  constructor(
    readonly look: CharacterLook,
    opts: { procedural?: boolean; modelId?: CharacterLook['id'] } = {},
  ) {
    this.modelId = opts.modelId ?? look.id;
    this.rim = {
      uRimColor: { value: new THREE.Color(look.rim) },
      uRimStrength: { value: 0.3 },
      uFlashColor: { value: new THREE.Color(1, 1, 1) },
      uFlash: { value: 0 },
      uFlashFlat: { value: 0 },
    };
    // Guilty Gear-style cel shading (toon.ts): one double-sided body draw, toon hilts, ink outlines.
    this.cloth = toonMaterial(this.rim, { vertexParams: true, side: THREE.DoubleSide, name: 'toon-body' });
    this.clothDouble = this.cloth;
    this.metal = toonMaterial(this.rim, { vertexColors: true, params: toonDefaults('metal'), name: 'toon-hilt' });
    this.ink = toonOutlineMaterial({ mask: true, fromVertexColor: true, width: 0.0068, minPx: 3.4, maxPx: 4.2 });

    this.buildSkeleton();
    // Body: the authored GLB model when loaded (modelBody.ts), else the procedural skinned body
    // (body.ts / costumes.ts), upgraded in place once the model arrives.
    if (!opts.procedural) void requestCharacterModel(this.modelId);
    const model = opts.procedural ? null : characterModel(this.modelId);
    this.awaitingModel = model === undefined;
    const built = model ? this.bindModel(model) : buildCostume(this, look);
    this.parts = built.parts;
    this.skeleton = built.skeleton;
    this.triangles = built.triangles;
    this.meshes.push(...built.meshes);
    if (!model) this.skeletons = [built.skeleton];
    const w = look.weapon;
    this.weapon = new Weapon(w.kind, w.blade, w.blade2, w.hilt, this.metal);
    this.j.body.add(this.weapon.main);
    this.j.body.add(this.weapon.second);
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && castsShadow(mesh)) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }

  add(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    parent.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  /** Inject the rim light and hit flash into a body material (used for loaded model materials). */
  /** Rim / hit-flash uniforms shared by every toon material of this rig. */
  toonUniforms(): RimUniforms {
    return this.rim;
  }

  /** Show or hide the ink outlines (dev comparison). */
  setOutlines(visible: boolean): void {
    this.root.traverse((o) => {
      if (o.userData.outline) o.visible = visible;
    });
  }

  /** Face expression weights (FighterAnimator.expression) for the `expr_*` morphs of a model face. */
  setExpression(e: Expression): void {
    const morphs = this.parts.exprMorphs;
    if (!morphs) return;
    for (const m of morphs) for (const [key, index] of m.map) m.influences[index] = e[key];
  }

  decorateMaterial(material: THREE.MeshStandardMaterial): void {
    addRim(material, this.rim);
  }

  /** Bind a loaded model; registers its shared meshes, materials and skeletons with the rig. */
  private bindModel(model: CharacterModel): CostumeBuild {
    const built = buildModelBody(this, this.look, model);
    if (model.grip) {
      this.gripN.copy(model.grip.N);
      this.gripF.copy(model.grip.F);
      // Realistic fists are ~9 cm wide along the hilt.
      this.twoHandGap = 0.11;
    }
    this.borrowed.push(...built.borrowed);
    this.bodyMaterials = built.materials;
    this.skeletons = built.skeletons;
    this.bodyKind = 'model';
    for (const mesh of [...built.meshes, ...built.borrowed]) {
      mesh.castShadow = this.shadowsOn && castsShadow(mesh);
      mesh.receiveShadow = !mesh.userData.outline;
    }
    return built;
  }

  /**
   * Swap the procedural body for the GLB model once it has loaded. Runs inside the pose update, so the
   * current frame's joint transforms are kept while the model is bound in the rest pose.
   */
  private upgradeBody(): void {
    const model = characterModel(this.modelId);
    if (model === undefined) return;
    this.awaitingModel = false;
    if (!model) return;
    const nodes: THREE.Object3D[] = [this.root, ...Object.values(this.j)];
    const snap = nodes.map((o) => [o.position.clone(), o.quaternion.clone(), o.scale.clone()] as const);
    this.removeBody();
    this.gripN.set(0, -FIST, 0);
    this.gripF.set(0, -FIST, 0);
    this.twoHandGap = 0.12;
    const built = this.bindModel(model);
    this.parts = built.parts;
    this.skeleton = built.skeleton;
    this.triangles = built.triangles;
    this.meshes.push(...built.meshes);
    nodes.forEach((o, i) => {
      o.position.copy(snap[i][0]);
      o.quaternion.copy(snap[i][1]);
      o.scale.copy(snap[i][2]);
    });
  }

  /** Remove the current body: meshes, materials, skeletons and the costume's extra bones. */
  private removeBody(): void {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.meshes.length = 0;
    for (const mesh of this.borrowed) mesh.removeFromParent();
    this.borrowed.length = 0;
    for (const s of this.skeletons) s.dispose();
    this.skeletons = [];
    if (this.parts.visor && !this.bodyMaterials.includes(this.parts.visor)) this.parts.visor.dispose();
    for (const m of this.bodyMaterials) m.dispose();
    this.bodyMaterials = [];
    const core = new Set<THREE.Object3D>(Object.values(this.j));
    const extra: THREE.Object3D[] = [];
    this.root.traverse((o) => {
      if ((o as THREE.Bone).isBone && !core.has(o)) extra.push(o);
    });
    for (const b of extra) b.removeFromParent();
  }

  private buildSkeleton(): void {
    const j = this.j;
    this.root.add(j.turn);
    j.turn.add(j.body);
    j.body.add(j.hips);
    j.hips.rotation.order = 'YXZ';
    j.hips.add(j.spine);
    j.spine.position.y = HIP_TO_SPINE;
    j.spine.rotation.order = 'YXZ';
    j.spine.add(j.chest);
    j.chest.position.y = SPINE_TO_CHEST;
    j.chest.rotation.order = 'YXZ';
    j.chest.add(j.neck);
    j.neck.position.y = CHEST_TO_NECK;
    j.neck.rotation.order = 'YXZ';
    j.neck.add(j.head);
    j.head.position.y = NECK_TO_HEAD;
    j.head.rotation.order = 'YXZ';

    j.chest.add(j.upperN, j.upperF);
    j.upperN.position.set(0, CHEST_TO_SHOULDER, SHOULDER_Z);
    j.upperF.position.set(0, CHEST_TO_SHOULDER, -SHOULDER_Z);
    j.upperN.add(j.foreN);
    j.upperF.add(j.foreF);
    j.foreN.position.y = -UPPER_ARM;
    j.foreF.position.y = -UPPER_ARM;
    j.foreN.add(j.handN);
    j.foreF.add(j.handF);
    j.handN.position.y = -FOREARM;
    j.handF.position.y = -FOREARM;

    j.hips.add(j.thighN, j.thighF);
    j.thighN.position.set(0, -0.04, HIP_Z);
    j.thighF.position.set(0, -0.04, -HIP_Z);
    j.thighN.add(j.shinN);
    j.thighF.add(j.shinF);
    j.shinN.position.y = -THIGH;
    j.shinF.position.y = -THIGH;
    j.shinN.add(j.footN);
    j.shinF.add(j.footF);
    j.footN.position.y = -SHIN;
    j.footF.position.y = -SHIN;
  }

  /**
   * Apply a pose. x/y = sim feet position, facing mirrors the rig, sec = secondary springs
   * (cloth/hair lag), time = ambient seconds.
   */
  applyPose(p: Pose, x: number, y: number, facing: 1 | -1, sec: Secondary | null, time: number): void {
    const j = this.j;
    const s = this.look.scale;
    this.root.position.set(x, y, 0);
    this.root.scale.set(facing * s, s, s);
    this.root.rotation.set(0, -PRESENT_YAW * facing, 0);

    j.turn.rotation.set(0, p.spinY * DEG, 0);
    j.body.position.set(p.rootX, p.hipY, p.rootZ);
    j.body.rotation.set(p.tilt * DEG, 0, p.spin * DEG);
    j.hips.rotation.set(p.hipRoll * DEG, p.hipYaw * DEG, p.hipLean * DEG);
    j.spine.rotation.set(0, p.spineYaw * DEG, p.spine * DEG);
    j.chest.rotation.set(p.chestRoll * DEG, p.twist * DEG, p.chest * DEG);
    const headLocal = p.head - (p.hipLean + p.spine + p.chest);
    const headYaw = p.headYaw - (p.twist + p.hipYaw + p.spineYaw) * 0.5;
    j.neck.rotation.set(p.headRoll * 0.4 * DEG, headYaw * 0.4 * DEG, headLocal * 0.4 * DEG);
    j.head.rotation.set(p.headRoll * 0.6 * DEG, headYaw * 0.6 * DEG, headLocal * 0.6 * DEG);

    j.hips.updateMatrix();
    j.spine.updateMatrix();
    j.chest.updateMatrix();
    this.hipsM.copy(j.hips.matrix);
    this.chestM.multiplyMatrices(j.hips.matrix, j.spine.matrix).multiply(j.chest.matrix);
    this.invChest.copy(this.chestM).invert();

    // Blade directions (upright frame = body-local pre-roll).
    this.dirFrom(p.pitch, p.yaw, this.bladeDir);
    this.dirFrom(p.pitch2, p.yaw2, this.blade2Dir);
    const w = this.weapon;
    const kind = w.kind;
    const off = Math.max(0, Math.min(1, p.off));

    // ---- Sword arm.
    this.target.set(p.gx - p.rootX, p.gy - p.hipY, p.gz);
    if (kind === 'staff') this.target.addScaledVector(this.bladeDir, -w.staffHand * (1 - off));
    this.solveArm(j.upperN, j.foreN, this.target, POLE_NEAR_ARM, p.nElbow, SHOULDER_Z, this.hand);
    const elbowN = this.elbow.clone();

    if (kind === 'staff') {
      w.main.position.copy(this.hand).addScaledVector(this.bladeDir, w.staffHand * (1 - off));
    } else {
      w.main.position.copy(this.hand);
    }
    w.main.quaternion.setFromUnitVectors(UP, this.bladeDir);
    w.main.rotateY(Math.PI / 2 + p.roll * DEG);
    this.orientGrip(j.handN, j.upperN, j.foreN, elbowN, this.hand, this.bladeDir, false);
    // The IK end is the grip centre on the forearm line; its small hand-local z offset slides the hilt.
    w.main.position.addScaledVector(this.bz, this.gripN.z);

    // ---- Off arm.
    if (kind === 'dual') {
      this.target.set(p.g2x - p.rootX, p.g2y - p.hipY, p.g2z);
      this.solveArm(j.upperF, j.foreF, this.target, POLE_FAR_ARM, p.fElbow, -SHOULDER_Z, this.hand2);
      w.second.position.copy(this.hand2);
      w.second.quaternion.setFromUnitVectors(UP, this.blade2Dir);
      w.second.rotateY(Math.PI / 2);
      this.orientGrip(j.handF, j.upperF, j.foreF, this.elbow, this.hand2, this.blade2Dir, false);
      w.second.position.addScaledVector(this.bz, this.gripF.z);
      this.setPalm(0);
    } else {
      // On the weapon (pommel / far end of the staff) or free.
      const onWeapon = this.tmp2;
      if (kind === 'staff') onWeapon.copy(w.main.position).addScaledVector(this.bladeDir, w.staffHand);
      else onWeapon.copy(w.main.position).addScaledVector(this.bladeDir, -this.twoHandGap);
      // Aim the off arm's IK end so its own grip centre (hand-local z offset) lands on the hilt.
      onWeapon.addScaledVector(this.bladeDir, -this.gripF.z);
      this.target.set(p.ox - p.rootX, p.oy - p.hipY, p.oz);
      this.target.lerpVectors(onWeapon, this.target, off);
      this.solveArm(j.upperF, j.foreF, this.target, POLE_FAR_ARM, p.fElbow, -SHOULDER_Z, this.hand2, off > 0.5);
      if (off < 0.5) {
        this.orientGrip(j.handF, j.upperF, j.foreF, this.elbow, this.hand2, this.bladeDir, false);
        this.setPalm(0);
      } else if (p.palm > 0.5) {
        this.orientGrip(j.handF, j.upperF, j.foreF, this.elbow, this.hand2, X, true);
        this.setPalm(1);
      } else {
        j.handF.quaternion.identity();
        this.setPalm(0);
      }
    }

    // ---- Legs (knees steerable, feet pitch).
    this.target.set(p.fx - p.rootX, p.fy + ANKLE - p.hipY, HIP_Z + p.fz);
    this.solveLeg(j.thighN, j.shinN, this.target, p.fKnee);
    this.levelFoot(j.thighN, j.shinN, j.footN, p.fPitch, p.fKnee * 0.4);
    this.target.set(p.bx - p.rootX, p.by + ANKLE - p.hipY, -HIP_Z + p.bz);
    this.solveLeg(j.thighF, j.shinF, this.target, -p.bKnee);
    this.levelFoot(j.thighF, j.shinF, j.footF, p.bPitch, -p.bKnee * 0.4);

    this.updateCloth(p, sec, time);
    this.root.updateMatrixWorld(true);
  }

  private dirFrom(pitchDeg: number, yawDeg: number, out: THREE.Vector3): THREE.Vector3 {
    const pitch = pitchDeg * DEG;
    const yaw = yawDeg * DEG;
    return out.set(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)).normalize();
  }

  /** Swap the off hand between fist and open palm (skinned: the hidden one collapses to ~0 scale). */
  private setPalm(open: 0 | 1): void {
    const { fistF, palmF, palmMorphs } = this.parts;
    if (fistF) fistF.scale.setScalar(open === 0 ? 1 : 1e-3);
    if (palmF) palmF.scale.setScalar(open === 1 ? 1 : 1e-3);
    // Model bodies: the off hand's `palmOpen` morph.
    if (palmMorphs) for (const m of palmMorphs) m.influences[m.index] = open;
  }

  /** Arm IK in body space with shoulder shrug toward the target. */
  private solveArm(
    upper: THREE.Object3D,
    lower: THREE.Object3D,
    target: THREE.Vector3,
    basePole: THREE.Vector3,
    elbowDeg: number,
    shoulderZ: number,
    outEnd: THREE.Vector3,
    avoidTorso = true,
  ): void {
    // Hands never pass through the torso: push the target out of an ellipse around the chest.
    this.tmp.copy(target).applyMatrix4(this.invChest);
    if (avoidTorso && this.keepOutOfTorso(this.tmp, shoulderZ)) target.copy(this.tmp).applyMatrix4(this.chestM);
    // Shoulder shrug: raise/advance the joint a little toward high or far targets.
    const up = Math.max(-0.3, Math.min(1, (this.tmp.y - CHEST_TO_SHOULDER) / 0.45)) * 0.045;
    const fwd = Math.max(-0.6, Math.min(1, this.tmp.x / 0.5)) * 0.035;
    upper.position.set(fwd, CHEST_TO_SHOULDER + up, shoulderZ);
    this.S.copy(upper.position).applyMatrix4(this.chestM);
    this.dir.subVectors(target, this.S).normalize();
    this.stablePole(basePole, shoulderZ > 0 ? POLE_NEAR_ARM_ALT : POLE_FAR_ARM_ALT);
    if (elbowDeg !== 0) this.pole.applyQuaternion(this.qa.setFromAxisAngle(this.dir, elbowDeg * DEG * Math.sign(shoulderZ)));
    const grip = shoulderZ > 0 ? this.gripN : this.gripF;
    this.solveLimb(this.chestM, upper, lower, UPPER_ARM, FOREARM - grip.y, target, this.pole, outEnd, 0.05);
  }

  private solveLeg(thigh: THREE.Object3D, shin: THREE.Object3D, target: THREE.Vector3, kneeDeg: number): void {
    this.S.copy(thigh.position).applyMatrix4(this.hipsM);
    this.dir.subVectors(target, this.S).normalize();
    this.stablePole(POLE_KNEE, POLE_KNEE_ALT);
    if (kneeDeg !== 0) this.pole.applyQuaternion(this.qa.setFromAxisAngle(this.dir, -kneeDeg * DEG));
    this.solveLimb(this.hipsM, thigh, shin, THIGH, SHIN, target, this.pole, this.reached, 0.025);
  }

  /**
   * Bend direction for a limb aimed along this.dir: the primary hint projected off the limb axis,
   * blended toward a secondary hint as the limb lines up with the primary (no sudden flips).
   */
  private stablePole(primary: THREE.Vector3, secondary: THREE.Vector3): void {
    this.pole.copy(primary).addScaledVector(this.dir, -primary.dot(this.dir));
    const m = this.pole.length();
    if (m < 0.45) {
      this.tmp2.copy(secondary).addScaledVector(this.dir, -secondary.dot(this.dir));
      const w = (0.45 - m) / 0.45;
      this.pole.multiplyScalar(1 - w).addScaledVector(this.tmp2, w * 0.6);
    }
  }

  /** Push a chest-space hand target out of the torso volume. Returns true when it moved. */
  private keepOutOfTorso(t: THREE.Vector3, side: number): boolean {
    if (t.y < -0.5 || t.y > 0.3) return false;
    const b = this.look.bulk;
    const rx = 0.2 * b;
    const rz = 0.24 * b;
    const e = (t.x * t.x) / (rx * rx) + (t.z * t.z) / (rz * rz);
    if (e >= 1) return false;
    if (e < 1e-4) {
      t.z = Math.sign(side) * rz;
      return true;
    }
    const k = 1 / Math.sqrt(e);
    t.x *= k;
    t.z *= k;
    return true;
  }

  /** Two-bone IK; writes the reached end and leaves the elbow/knee in this.elbow. */
  private solveLimb(
    parentM: THREE.Matrix4,
    upper: THREE.Object3D,
    lower: THREE.Object3D,
    l1: number,
    l2: number,
    target: THREE.Vector3,
    pole: THREE.Vector3,
    outEnd: THREE.Vector3,
    softness = 0,
  ): void {
    this.parentQ.setFromRotationMatrix(parentM);
    this.S.copy(upper.position).applyMatrix4(parentM);
    this.D.subVectors(target, this.S);
    let dist = this.D.length();
    if (dist < 1e-5) {
      this.D.set(0, -1, 0);
      dist = 1e-5;
    }
    this.dir.copy(this.D).divideScalar(dist);
    // Soft IK: ease into full extension instead of snapping straight (no elbow/knee pop).
    const chain = l1 + l2;
    const soft = softness * chain;
    if (soft > 0 && dist > chain - soft) dist = chain - soft + soft * (1 - Math.exp(-(dist - (chain - soft)) / soft));
    const reach = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-4);
    const a = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    this.bend.copy(pole).addScaledVector(this.dir, -pole.dot(this.dir));
    if (this.bend.lengthSq() < 1e-8) this.bend.set(0, 0, 1);
    this.bend.normalize();
    this.E.copy(this.S).addScaledVector(this.dir, a).addScaledVector(this.bend, h);
    outEnd.copy(this.S).addScaledVector(this.dir, reach);
    this.elbow.copy(this.E);

    this.invQ.copy(this.parentQ).invert();
    this.tmp.subVectors(this.E, this.S).normalize().applyQuaternion(this.invQ);
    upper.quaternion.setFromUnitVectors(DOWN, this.tmp);
    this.chainQ.multiplyQuaternions(this.parentQ, upper.quaternion).invert();
    this.tmp.subVectors(outEnd, this.E).normalize().applyQuaternion(this.chainQ);
    lower.quaternion.setFromUnitVectors(DOWN, this.tmp);
  }

  /**
   * Rotate a hand so its grip channel (local z) lines up with `axis` (a hilt or staff), or — for an
   * open palm — so the palm faces `axis` with fingers up (Force gestures).
   */
  private orientGrip(
    handJ: THREE.Object3D,
    upper: THREE.Object3D,
    lower: THREE.Object3D,
    elbow: THREE.Vector3,
    handPos: THREE.Vector3,
    axis: THREE.Vector3,
    palm: boolean,
  ): void {
    const forearm = this.tmp.subVectors(handPos, elbow).normalize();
    if (palm) {
      this.bx.copy(axis).addScaledVector(forearm, 0).normalize();
      this.by.copy(UP).addScaledVector(this.bx, -UP.dot(this.bx)).normalize().negate();
      this.bz.crossVectors(this.bx, this.by).normalize();
    } else {
      this.by.copy(forearm).negate();
      this.bz.copy(axis).addScaledVector(forearm, -axis.dot(forearm));
      if (this.bz.lengthSq() < 1e-6) this.bz.copy(this.zAxis);
      this.bz.normalize();
      this.bx.crossVectors(this.by, this.bz).normalize();
    }
    this.basis.makeBasis(this.bx, this.by, this.bz);
    this.qb.setFromRotationMatrix(this.basis);
    // Forearm's body-space orientation = chest * upper * lower.
    this.parentQ.setFromRotationMatrix(this.chestM);
    this.qa.copy(this.parentQ).multiply(upper.quaternion).multiply(lower.quaternion).invert();
    handJ.quaternion.copy(this.qa).multiply(this.qb);
  }

  private levelFoot(thigh: THREE.Object3D, shin: THREE.Object3D, foot: THREE.Object3D, pitchDeg: number, yawDeg: number): void {
    this.parentQ.setFromRotationMatrix(this.hipsM);
    this.chainQ.copy(this.parentQ).multiply(thigh.quaternion).multiply(shin.quaternion).invert();
    this.qa.setFromAxisAngle(this.zAxis, -pitchDeg * DEG);
    this.qb.setFromAxisAngle(UP, yawDeg * DEG);
    foot.quaternion.copy(this.chainQ).multiply(this.qb).multiply(this.qa);
  }

  private limbAngle(limbJoint: THREE.Object3D): number {
    this.tmp.copy(DOWN).applyQuaternion(limbJoint.quaternion);
    return Math.atan2(this.tmp.x, -this.tmp.y);
  }

  private updateCloth(p: Pose, sec: Secondary | null, time: number): void {
    if (this.awaitingModel) this.upgradeBody();
    const parts = this.parts;
    const j = this.j;
    const sway = (sec?.cloth.x ?? 0) * DEG;
    const flutter = Math.sin(time * 3.1) * 0.03 + Math.sin(time * 5.3) * 0.015;
    // Spins throw the robe panels outward like a dervish's robe.
    const fl = (sec?.flare ?? 0) * 0.85;
    // Shoulder pads (pauldrons, mantle shoulders) follow their upper arm part of the way.
    if (parts.pads) {
      for (const pad of parts.pads) {
        pad.bone.position.copy(pad.arm.position);
        pad.bone.quaternion.identity().slerp(pad.arm.quaternion, pad.follow);
      }
    }
    // Floor height in rig-root space (cloth pools on it instead of sinking through).
    const floor = -this.root.position.y / this.look.scale;
    // Skinned robe/coat panels part around the legs and hang with gravity.
    if (parts.skirt) driveSkirt(parts.skirt, j, sway, sec?.flare ?? 0, floor);
    // Legacy rigid panels (optional).
    if (parts.skirtFront || parts.skirtBack) {
      const aN = this.limbAngle(j.thighN);
      const aF = this.limbAngle(j.thighF);
      if (parts.skirtFront) parts.skirtFront.rotation.z = Math.max(0, Math.max(aN, aF)) * 0.55 + Math.min(0, sway) * 0.3 + fl;
      if (parts.skirtBack) parts.skirtBack.rotation.z = Math.min(0, Math.min(aN, aF)) * 0.55 + sway * 0.35 - fl;
    }

    // Cape hangs toward world-down from the chest (exact chest tilt in any pose) and trails motion.
    if (parts.cape.length) {
      this.qa.copy(j.turn.quaternion).multiply(j.body.quaternion).multiply(j.hips.quaternion).multiply(j.spine.quaternion).multiply(j.chest.quaternion).invert();
      this.tmp.copy(DOWN).applyQuaternion(this.qa);
      const hang = Math.max(-1.7, Math.atan2(this.tmp.x, -this.tmp.y));
      const k = 3 / parts.cape.length;
      parts.cape.forEach((seg, i) => {
        const base = i === 0 ? hang * 0.85 : 0;
        seg.rotation.z = Math.min(i === 0 ? 0.12 : 0.2, base + sway * (0.6 + i * 0.5) * k - 0.04 * k + flutter * (1 + i) * k - fl * (i === 0 ? 0.9 : 0.3 * k));
      });
      // Lying down: keep the cape on the floor, not through it.
      const seg0 = parts.cape[0];
      this.qa.copy(j.body.quaternion).multiply(j.hips.quaternion).multiply(j.spine.quaternion).multiply(j.chest.quaternion);
      const ux = this.tmp.set(1, 0, 0).applyQuaternion(this.qa).y;
      const uy = this.tmp.set(0, 1, 0).applyQuaternion(this.qa).y;
      this.tmp2.copy(seg0.position).applyMatrix4(this.chestM).applyQuaternion(j.body.quaternion);
      const h = j.body.position.y + this.tmp2.y;
      seg0.rotation.z = floorClamp(seg0.rotation.z, h, parts.capeLength ?? 0.9, ux, -uy, floor + 0.03);
    }
    const headAbs = (p.spin + p.head) * DEG;
    const hairSwing = (sec?.hair.x ?? 0) * DEG;
    parts.hair.forEach((seg, i) => {
      seg.rotation.z = (i === 0 ? -headAbs * 0.75 - 0.35 : -0.1) + hairSwing * (0.5 + i * 0.4) + flutter * 1.5 * (i + 1);
    });
    parts.tails.forEach((seg, i) => {
      seg.rotation.z = (i === 0 ? -headAbs * 0.7 - 0.6 : -0.15) + hairSwing * (0.7 + i * 0.5) + Math.sin(time * 6 + i) * 0.06;
    });
  }

  /** Low quality: skip the fighter's shadow pass (the contact shadow still grounds them). */
  setShadows(enabled: boolean): void {
    this.shadowsOn = enabled;
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      // Parts inside or against the head (eyes, brows, lashes) never cast shadows (saves shadow draws).
      if (mesh.isMesh && castsShadow(mesh)) mesh.castShadow = enabled;
    });
  }

  /** World-space hand anchors for VFX. */
  offHandWorld(out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.gripF);
    return this.j.handF.localToWorld(out);
  }

  swordHandWorld(out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.gripN);
    return this.j.handN.localToWorld(out);
  }

  chestWorld(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0.12, 0);
    return this.j.chest.localToWorld(out);
  }

  neckWorld(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0.06, 0);
    return this.j.neck.localToWorld(out);
  }

  /**
   * Hit flash. By default it brightens the surface's own colours (albedo-relative, so dark costumes
   * don't wash out to white); flat = true gives a uniform tint (parry / lightning).
   */
  setFlash(amount: number, color: THREE.ColorRepresentation = 0xffffff, flat = false): void {
    this.rim.uFlash.value = amount;
    this.rim.uFlashColor.value.set(color);
    this.rim.uFlashFlat.value = flat ? 1 : 0;
  }

  setRim(color: THREE.ColorRepresentation, strength: number): void {
    this.rim.uRimColor.value.set(color);
    this.rim.uRimStrength.value = strength;
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.geometry.dispose();
    for (const s of this.skeletons) s.dispose();
    for (const m of this.bodyMaterials) m.dispose();
    this.cloth.dispose();
    this.metal.dispose();
    this.ink.dispose();
    if (this.parts.visor && !this.bodyMaterials.includes(this.parts.visor)) this.parts.visor.dispose();
    this.weapon.dispose();
  }
}
