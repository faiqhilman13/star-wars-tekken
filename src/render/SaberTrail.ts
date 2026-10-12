import * as THREE from 'three';

const SAMPLES = 28;
const SUBDIVISIONS = 4;

/**
 * Additive ribbon swept by the blade. Each rendered frame adds the current blade segment plus
 * slerped in-betweens, so a fast 60 Hz swing still draws a smooth arc instead of chords.
 */
export class SaberTrail {
  readonly mesh: THREE.Mesh;
  private readonly bases: THREE.Vector3[] = [];
  private readonly tips: THREE.Vector3[] = [];
  private readonly strength = new Float32Array(SAMPLES);
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private count = 0;
  private readonly lastBase = new THREE.Vector3();
  private readonly lastTip = new THREE.Vector3();
  private hasLast = false;
  private readonly dirA = new THREE.Vector3();
  private readonly dirB = new THREE.Vector3();
  private readonly qa = new THREE.Quaternion();
  private readonly qFull = new THREE.Quaternion();
  private readonly tmpBase = new THREE.Vector3();
  private readonly tmpTip = new THREE.Vector3();

  constructor(color: THREE.Color) {
    for (let i = 0; i < SAMPLES; i += 1) {
      this.bases.push(new THREE.Vector3());
      this.tips.push(new THREE.Vector3());
    }
    this.positions = new Float32Array(SAMPLES * 2 * 3);
    this.alphas = new Float32Array(SAMPLES * 2);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < SAMPLES - 1; i += 1) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry.setIndex(index);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color.clone() }, uCore: { value: color.clone().lerp(new THREE.Color(1, 1, 1), 0.7) } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform vec3 uCore;
        varying float vAlpha;
        void main() {
          float a = clamp(vAlpha, 0.0, 1.0);
          vec3 c = mix(uColor, uCore, a * a) * a * 1.6;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
  }

  setColor(color: THREE.Color): void {
    this.material.uniforms.uColor.value.copy(color);
    this.material.uniforms.uCore.value.copy(color).lerp(new THREE.Color(1, 1, 1), 0.7);
  }

  reset(): void {
    this.count = 0;
    this.hasLast = false;
    this.strength.fill(0);
    this.mesh.visible = false;
  }

  private pushSample(base: THREE.Vector3, tip: THREE.Vector3, strength: number): void {
    for (let i = SAMPLES - 1; i > 0; i -= 1) {
      this.bases[i].copy(this.bases[i - 1]);
      this.tips[i].copy(this.tips[i - 1]);
      this.strength[i] = this.strength[i - 1];
    }
    this.bases[0].copy(base);
    this.tips[0].copy(tip);
    this.strength[0] = strength;
    this.count = Math.min(SAMPLES, this.count + 1);
  }

  /**
   * @param intensity 0..1 how strongly this frame's motion should draw (attack active, speed).
   * @param fade seconds-based decay factor applied to older samples.
   */
  update(base: THREE.Vector3, tip: THREE.Vector3, intensity: number, dt: number): void {
    const decay = Math.exp(-dt * 16);
    for (let i = 0; i < this.count; i += 1) this.strength[i] *= decay;

    if (this.hasLast && intensity > 0.02) {
      // Insert slerped in-betweens from last frame's blade to this frame's.
      this.dirA.subVectors(this.lastTip, this.lastBase);
      this.dirB.subVectors(tip, base);
      const lenA = this.dirA.length();
      const lenB = this.dirB.length();
      if (lenA > 1e-4 && lenB > 1e-4) {
        this.dirA.divideScalar(lenA);
        this.dirB.divideScalar(lenB);
        this.qFull.setFromUnitVectors(this.dirA, this.dirB);
        for (let s = 1; s <= SUBDIVISIONS; s += 1) {
          const t = s / SUBDIVISIONS;
          this.qa.identity().slerp(this.qFull, t);
          this.tmpBase.lerpVectors(this.lastBase, base, t);
          this.tmpTip.copy(this.dirA).applyQuaternion(this.qa).multiplyScalar(lenA + (lenB - lenA) * t).add(this.tmpBase);
          this.pushSample(this.tmpBase, this.tmpTip, intensity);
        }
      } else {
        this.pushSample(base, tip, intensity);
      }
    } else {
      this.pushSample(base, tip, 0);
    }
    this.lastBase.copy(base);
    this.lastTip.copy(tip);
    this.hasLast = true;

    let any = false;
    for (let i = 0; i < SAMPLES; i += 1) {
      const b = i < this.count ? this.bases[i] : this.bases[Math.max(0, this.count - 1)];
      const t = i < this.count ? this.tips[i] : this.tips[Math.max(0, this.count - 1)];
      const age = i / (SAMPLES - 1);
      const s = i < this.count ? this.strength[i] * (1 - age) * (1 - age) : 0;
      if (s > 0.01) any = true;
      const o = i * 6;
      // Ribbon from 25% up the blade to the tip: the edge reads, the hilt doesn't smear.
      this.positions[o] = b.x + (t.x - b.x) * 0.25;
      this.positions[o + 1] = b.y + (t.y - b.y) * 0.25;
      this.positions[o + 2] = b.z + (t.z - b.z) * 0.25;
      this.positions[o + 3] = t.x;
      this.positions[o + 4] = t.y;
      this.positions[o + 5] = t.z;
      this.alphas[i * 2] = s * 0.15;
      this.alphas[i * 2 + 1] = s;
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.visible = any;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
