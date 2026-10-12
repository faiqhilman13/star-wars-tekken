import * as THREE from 'three';
import { at, ball, limb, merge, paint, rbox, riser, rotY, rotZ } from '../geo';
import { addOutline, hiltOutlineMaterial } from './toon';
import type { WeaponKind } from '../../sim/moves';

const GLOW_VERTEX = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const GLOW_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uPower;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  void main() {
    float facing = clamp(abs(dot(normalize(vNormalV), normalize(vViewDir))), 0.0, 1.0);
    float a = pow(facing, uPower) * uIntensity;
    gl_FragColor = vec4(uColor * a, 1.0);
  }
`;

function glowMaterial(color: THREE.Color, intensity: number, power: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uIntensity: { value: intensity }, uPower: { value: power } },
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

/** One glowing blade growing along +y of its group from the emitter. */
export class BladeVisual {
  readonly group = new THREE.Group();
  readonly color: THREE.Color;
  private readonly meshes: THREE.Mesh[] = [];
  private readonly inner: THREE.ShaderMaterial;
  private readonly outer: THREE.ShaderMaterial;
  private readonly core: THREE.MeshBasicMaterial;
  /** Bright hues (yellow / green) glow less so every blade blooms about the same. */
  private readonly glowScale: number;
  extension = 1;

  constructor(
    color: THREE.ColorRepresentation,
    readonly length: number,
    readonly thickness = 1,
  ) {
    this.color = new THREE.Color(color);
    const lum = 0.2126 * this.color.r + 0.7152 * this.color.g + 0.0722 * this.color.b;
    this.glowScale = Math.max(0.36, Math.min(1, 0.3 / Math.max(0.05, lum)));
    const coreColor = this.color.clone().lerp(new THREE.Color(1, 1, 1), 0.78).multiplyScalar(2.6);
    this.core = new THREE.MeshBasicMaterial({ color: coreColor, toneMapped: false });
    this.inner = glowMaterial(this.color, 2.2, 1.1);
    this.outer = glowMaterial(this.color, 0.75, 2.4);
    const t = thickness;
    const parts: Array<[THREE.BufferGeometry, THREE.Material]> = [
      [new THREE.CapsuleGeometry(0.015 * t, length, 4, 10), this.core],
      [new THREE.CapsuleGeometry(0.034 * t, length, 4, 12), this.inner],
      [new THREE.CapsuleGeometry(0.085 * t, length + 0.04, 4, 14), this.outer],
    ];
    for (const [g, m] of parts) {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.y = length / 2;
      mesh.renderOrder = 10;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
  }

  setExtension(value: number): void {
    this.extension = Math.max(0, Math.min(1, value));
    this.group.visible = this.extension > 0.01;
    this.group.scale.set(1, Math.max(0.001, this.extension), 1);
  }

  setIntensity(boost: number, flicker: number): void {
    this.inner.uniforms.uIntensity.value = (2.2 + boost * 2.5) * flicker * this.glowScale;
    this.outer.uniforms.uIntensity.value = (0.75 + boost * 1.2) * flicker * this.glowScale;
  }

  /** World-space emitter and tip. */
  ends(base: THREE.Vector3, tip: THREE.Vector3): void {
    base.set(0, 0, 0);
    tip.set(0, this.length * this.extension, 0);
    this.group.localToWorld(base);
    this.group.localToWorld(tip);
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    this.core.dispose();
    this.inner.dispose();
    this.outer.dispose();
  }
}

export interface HiltStyle {
  metal: THREE.ColorRepresentation;
  grip: THREE.ColorRepresentation;
  accent: THREE.ColorRepresentation;
  shape?: 'classic' | 'curved';
}

const BUTTON = 0xc01a14;
const DARK = 0x0d0e10;

function classicHilt(s: HiltStyle, gripLen = 0.2): THREE.BufferGeometry {
  const parts = [
    paint(at(limb(0.019, 0.019, gripLen, 12), 0, 0.0, 0), s.grip),
    ...[0.03, 0.07, 0.11, 0.15].filter((y) => y < gripLen).map((y) => paint(at(new THREE.TorusGeometry(0.019, 0.004, 6, 14).rotateX(Math.PI / 2), 0, -y, 0), s.metal)),
    // Grip T-tracks down the back.
    paint(at(rbox(0.008, gripLen * 0.8, 0.006, 0.002), -0.019, -gripLen * 0.5, 0), s.metal),
    paint(at(riser(0.021, 0.021, 0.06, 12), 0, 0, 0), s.metal),
    // Emitter: dark window band, flared shroud, crown vents.
    paint(at(riser(0.0215, 0.0215, 0.012, 12), 0, 0.046, 0), DARK),
    paint(at(riser(0.021, 0.027, 0.045, 12), 0, 0.055, 0), s.metal),
    paint(at(new THREE.TorusGeometry(0.025, 0.004, 6, 14).rotateX(Math.PI / 2), 0, 0.1, 0), s.accent),
    // Activation box with a red button, pommel with a groove.
    paint(at(rbox(0.016, 0.03, 0.022, 0.005), 0.022, 0.03, 0), s.accent),
    paint(at(ball(0.0055, 1, 1, 1, 8), 0.031, 0.034, 0), BUTTON),
    paint(at(limb(0.022, 0.024, 0.035, 12), 0, -gripLen, 0), s.metal),
    paint(at(new THREE.TorusGeometry(0.0235, 0.003, 6, 14).rotateX(Math.PI / 2), 0, -gripLen - 0.018, 0), DARK),
    paint(at(ball(0.012, 1, 0.6, 1, 8), 0, -gripLen - 0.036, 0), s.accent),
  ];
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    parts.push(paint(at(rotY(rbox(0.004, 0.018, 0.007, 0.0015), (-a * 180) / Math.PI), Math.cos(a) * 0.0265, 0.084, Math.sin(a) * 0.0265), DARK));
  }
  return merge(parts);
}

function curvedHilt(s: HiltStyle): THREE.BufferGeometry {
  // Elegant curved pommel (a duelist's hilt): the lower grip bends away.
  const lower = rotZ(limb(0.02, 0.019, 0.1, 12), 16);
  return merge([
    paint(at(limb(0.02, 0.02, 0.12, 12), 0, 0, 0), s.grip),
    paint(at(lower, 0, -0.115, 0), s.grip),
    paint(at(rotZ(limb(0.024, 0.02, 0.04, 12), 18), 0.028, -0.21, 0), s.metal),
    paint(at(riser(0.022, 0.022, 0.05, 12), 0, 0, 0), s.metal),
    paint(at(riser(0.022, 0.03, 0.05, 12), 0, 0.048, 0), s.metal),
    paint(at(new THREE.TorusGeometry(0.028, 0.005, 6, 14).rotateX(Math.PI / 2), 0, 0.1, 0), s.accent),
    paint(at(rbox(0.05, 0.012, 0.02, 0.004), 0.0, 0.004, 0), s.accent),
    paint(at(riser(0.0225, 0.0225, 0.01, 12), 0, 0.03, 0), DARK),
    paint(at(rbox(0.014, 0.026, 0.02, 0.005), 0.022, -0.035, 0), s.metal),
    paint(at(ball(0.005, 1, 1, 1, 8), 0.03, -0.032, 0), BUTTON),
    ...[-0.06, -0.08, -0.1].map((y) => paint(at(new THREE.TorusGeometry(0.0205, 0.0035, 6, 14).rotateX(Math.PI / 2), 0, y, 0), s.metal)),
  ]);
}

function staffHilt(s: HiltStyle, half: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [paint(at(limb(0.021, 0.021, half * 2, 14), 0, half, 0), s.grip)];
  for (const sign of [1, -1]) {
    parts.push(paint(at(riser(0.024, 0.03, 0.06, 12).rotateX(sign < 0 ? Math.PI : 0), 0, sign * (half - 0.06), 0), s.metal));
    parts.push(paint(at(new THREE.TorusGeometry(0.03, 0.006, 6, 16).rotateX(Math.PI / 2), 0, sign * half, 0), s.accent));
    for (const y of [0.08, 0.13]) parts.push(paint(at(new THREE.TorusGeometry(0.023, 0.005, 6, 14).rotateX(Math.PI / 2), 0, sign * y, 0), s.accent));
  }
  parts.push(paint(at(rbox(0.05, 0.05, 0.05, 0.012), 0, 0, 0), s.metal));
  // Centre coupling details, emitter windows and activation studs.
  parts.push(paint(at(rbox(0.054, 0.016, 0.054, 0.004), 0, 0, 0), s.accent));
  for (const sign of [1, -1]) {
    parts.push(paint(at(riser(0.0245, 0.0245, 0.012, 12).rotateX(sign < 0 ? Math.PI : 0), 0, sign * (half - 0.085), 0), DARK));
    parts.push(paint(at(ball(0.006, 1, 1, 1, 8), 0.025, sign * 0.045, 0), BUTTON));
  }
  return merge(parts);
}

/**
 * A fighter's weapon(s). `main` is placed at the sword hand (staff: at the staff centre) with +y along
 * the main blade; `second` is the off-hand saber for dual wielders.
 */
export class Weapon {
  readonly main = new THREE.Group();
  readonly second = new THREE.Group();
  readonly blades: BladeVisual[] = [];
  readonly light: THREE.PointLight;
  readonly color: THREE.Color;
  /** Offset of each hand along the staff axis from its centre. */
  readonly staffHand = 0.15;
  private readonly hilts: THREE.Mesh[] = [];
  private boost = 0;
  /** 0..1 dimming when the blade light is right against a body (prevents white blow-outs). */
  nearDim = 1;
  /** Equalizes perceived light between blade colours (yellow/green are ~2.5x brighter than blue/red). */
  private readonly lightScale: number;
  private mainExt = 1;
  private secondExt = 1;

  constructor(
    readonly kind: WeaponKind,
    blade: THREE.ColorRepresentation,
    blade2: THREE.ColorRepresentation,
    hilt: HiltStyle,
    metal: THREE.Material,
  ) {
    this.color = new THREE.Color(blade);
    const lum = 0.2126 * this.color.r + 0.7152 * this.color.g + 0.0722 * this.color.b;
    this.lightScale = Math.min(1, 0.27 / Math.max(0.05, lum));
    const emitter = 0.1;
    if (kind === 'staff') {
      const half = 0.28;
      const mesh = new THREE.Mesh(staffHilt(hilt, half), metal);
      this.main.add(mesh);
      this.hilts.push(mesh);
      const a = new BladeVisual(blade, 0.86);
      a.group.position.y = half;
      const b = new BladeVisual(blade2, 0.86);
      b.group.position.y = -half;
      b.group.rotation.z = Math.PI;
      this.main.add(a.group, b.group);
      this.blades.push(a, b);
    } else if (kind === 'dual') {
      for (const [group, color, len, grip] of [
        [this.main, blade, 0.88, 0.17],
        [this.second, blade2, 0.7, 0.15],
      ] as const) {
        const mesh = new THREE.Mesh(classicHilt(hilt, grip), metal);
        group.add(mesh);
        this.hilts.push(mesh);
        const v = new BladeVisual(color, len, 0.9);
        v.group.position.y = emitter;
        group.add(v.group);
        this.blades.push(v);
      }
    } else {
      const curved = hilt.shape === 'curved';
      const mesh = new THREE.Mesh(curved ? curvedHilt(hilt) : classicHilt(hilt), metal);
      this.main.add(mesh);
      this.hilts.push(mesh);
      const v = new BladeVisual(blade, curved ? 1.04 : 1.0);
      v.group.position.y = emitter;
      this.main.add(v.group);
      this.blades.push(v);
    }
    for (const m of this.hilts) {
      m.castShadow = true;
      // ~1 px ink outline on the hilt (blades stay line-free).
      addOutline(m, hiltOutlineMaterial());
    }
    this.light = new THREE.PointLight(this.color, 2.4, 6, 1.8);
    // Staff: light out along blade A, not at the centre (which sits against the chest and blows out the robes).
    this.light.position.y = kind === 'staff' ? 0.28 + 0.45 : emitter + 0.45;
    this.main.add(this.light);
  }

  setExtension(main: number, second: number): void {
    this.mainExt = main;
    this.secondExt = second;
    if (this.kind === 'staff') {
      this.blades[0].setExtension(main);
      this.blades[1].setExtension(second);
    } else {
      this.blades[0].setExtension(main);
      if (this.blades[1]) this.blades[1].setExtension(second);
    }
    this.light.visible = Math.max(main, this.kind === 'single' ? 0 : second) > 0.05 && this.main.visible;
  }

  get lit(): boolean {
    return this.mainExt > 0.05 || (this.kind !== 'single' && this.secondExt > 0.05);
  }

  setVisible(main: boolean): void {
    this.main.visible = main;
  }

  pulse(amount: number): void {
    this.boost = Math.max(this.boost, amount);
  }

  update(dt: number, time: number, seed: number): void {
    this.boost = Math.max(0, this.boost - dt * 3.5);
    const flicker = 1 + Math.sin(time * 61 + seed) * 0.03 + Math.sin(time * 23.7 + seed * 2.1) * 0.025;
    for (const b of this.blades) b.setIntensity(this.boost, flicker);
    const lit = Math.max(this.mainExt, this.kind === 'single' ? 0 : this.secondExt);
    // The staff's light sits between the hands, right against the robes: keep it lower.
    this.light.intensity = (2.4 + this.boost * 2.5) * this.nearDim * flicker * lit * this.lightScale * (this.kind === 'single' ? 1 : this.kind === 'staff' ? 0.85 : 1.05);
  }

  dispose(): void {
    for (const m of this.hilts) m.geometry.dispose();
    for (const b of this.blades) b.dispose();
  }
}
