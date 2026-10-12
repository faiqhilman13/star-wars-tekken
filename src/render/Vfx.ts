import * as THREE from 'three';

const SPARKS = 320;
const GLOWS = 360;
const DUSTS = 140;
const FLASHES = 12;
const RINGS = 10;
const BOLT_SEGMENTS = 64;
const BEAM_SEGMENTS = 3 * 18;
const WHITE = new THREE.Color(1, 1, 1);

interface Spark {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  max: number;
  color: THREE.Color;
  gravity: number;
}

interface Glow {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  color: THREE.Color;
  rise: number;
}

interface Pop {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  max: number;
  size: number;
  grow: number;
  peak: number;
}

function radialTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const POINT_VERTEX = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 color;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = alpha;
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uSoft;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float a = (1.0 - smoothstep(uSoft, 1.0, d)) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

export class Vfx {
  readonly group = new THREE.Group();
  private readonly sparks: Spark[] = [];
  private readonly sparkPositions = new Float32Array(SPARKS * 6);
  private readonly sparkColors = new Float32Array(SPARKS * 6);
  private readonly sparkGeo = new THREE.BufferGeometry();
  private readonly sparkLines: THREE.LineSegments;

  private readonly glows: Glow[] = [];
  private readonly glowGeo = new THREE.BufferGeometry();
  private readonly glowPos = new Float32Array(GLOWS * 3);
  private readonly glowCol = new Float32Array(GLOWS * 3);
  private readonly glowSize = new Float32Array(GLOWS);
  private readonly glowAlpha = new Float32Array(GLOWS);
  private readonly glowMat: THREE.ShaderMaterial;

  private readonly dusts: Glow[] = [];
  private readonly dustGeo = new THREE.BufferGeometry();
  private readonly dustPos = new Float32Array(DUSTS * 3);
  private readonly dustCol = new Float32Array(DUSTS * 3);
  private readonly dustSize = new Float32Array(DUSTS);
  private readonly dustAlpha = new Float32Array(DUSTS);
  private readonly dustMat: THREE.ShaderMaterial;

  private readonly flashes: Pop[] = [];
  private readonly rings: Pop[] = [];
  private readonly radial: THREE.CanvasTexture;

  private readonly boltGeo = new THREE.BufferGeometry();
  private readonly boltPos = new Float32Array(BOLT_SEGMENTS * 6);
  private readonly boltCol = new Float32Array(BOLT_SEGMENTS * 6);
  private readonly bolts: THREE.LineSegments;
  private boltLife = 0;
  private readonly boltCenter = new THREE.Vector3();
  private readonly boltColorA = new THREE.Color();
  private readonly boltColorB = new THREE.Color();

  private readonly beamGeo = new THREE.BufferGeometry();
  private readonly beamPos = new Float32Array(BEAM_SEGMENTS * 6);
  private readonly beamCol = new Float32Array(BEAM_SEGMENTS * 6);
  private readonly beam: THREE.LineSegments;
  private beamOn = false;
  private readonly waves: Array<{ group: THREE.Group; shell: THREE.Mesh; rings: THREE.Mesh[]; mat: THREE.ShaderMaterial; ringMat: THREE.MeshBasicMaterial; glow: THREE.Mesh; glowMat: THREE.MeshBasicMaterial }> = [];
  private readonly auras: Array<{ mesh: THREE.Mesh; mat: THREE.ShaderMaterial; level: number }> = [];
  private readonly charges: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }> = [];

  private sparkCursor = 0;
  private glowCursor = 0;
  private dustCursor = 0;
  private flashCursor = 0;
  private ringCursor = 0;
  private time = 0;
  private reduced = false;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();

  constructor(private readonly rng: () => number) {
    this.radial = radialTexture();

    for (let i = 0; i < SPARKS; i += 1) {
      this.sparks.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, color: new THREE.Color(), gravity: 9 });
    }
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparkGeo.setAttribute('color', new THREE.BufferAttribute(this.sparkColors, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparkLines = new THREE.LineSegments(
      this.sparkGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.sparkLines.frustumCulled = false;
    this.sparkLines.renderOrder = 12;
    this.group.add(this.sparkLines);

    for (let i = 0; i < GLOWS; i += 1) {
      this.glows.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, size: 1, color: new THREE.Color(), rise: 0 });
    }
    this.glowGeo.setAttribute('position', new THREE.BufferAttribute(this.glowPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.glowGeo.setAttribute('color', new THREE.BufferAttribute(this.glowCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.glowGeo.setAttribute('size', new THREE.BufferAttribute(this.glowSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.glowGeo.setAttribute('alpha', new THREE.BufferAttribute(this.glowAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 300 }, uSoft: { value: 0.0 } },
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const glowPoints = new THREE.Points(this.glowGeo, this.glowMat);
    glowPoints.frustumCulled = false;
    glowPoints.renderOrder = 11;
    this.group.add(glowPoints);

    for (let i = 0; i < DUSTS; i += 1) {
      this.dusts.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, size: 1, color: new THREE.Color(), rise: 0 });
    }
    this.dustGeo.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.dustGeo.setAttribute('color', new THREE.BufferAttribute(this.dustCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.dustGeo.setAttribute('size', new THREE.BufferAttribute(this.dustSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.dustGeo.setAttribute('alpha', new THREE.BufferAttribute(this.dustAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 300 }, uSoft: { value: 0.1 } },
      vertexShader: POINT_VERTEX,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = (1.0 - smoothstep(0.05, 0.5, length(c))) * vAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor, a);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    const dustPoints = new THREE.Points(this.dustGeo, this.dustMat);
    dustPoints.frustumCulled = false;
    dustPoints.renderOrder = 8;
    this.group.add(dustPoints);

    const quad = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < FLASHES; i += 1) {
      const material = new THREE.MeshBasicMaterial({ map: this.radial, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(quad, material);
      mesh.visible = false;
      mesh.renderOrder = 13;
      this.group.add(mesh);
      this.flashes.push({ mesh, material, life: 0, max: 1, size: 1, grow: 1, peak: 1 });
    }
    const ringGeo = new THREE.RingGeometry(0.86, 1, 64);
    for (let i = 0; i < RINGS; i += 1) {
      const material = new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const mesh = new THREE.Mesh(ringGeo, material);
      mesh.visible = false;
      mesh.renderOrder = 12;
      this.group.add(mesh);
      this.rings.push({ mesh, material, life: 0, max: 1, size: 1, grow: 1, peak: 1 });
    }

    this.boltGeo.setAttribute('position', new THREE.BufferAttribute(this.boltPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.boltGeo.setAttribute('color', new THREE.BufferAttribute(this.boltCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.bolts = new THREE.LineSegments(
      this.boltGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.bolts.frustumCulled = false;
    this.bolts.visible = false;
    this.bolts.renderOrder = 14;
    this.group.add(this.bolts);

    this.beamGeo.setAttribute('position', new THREE.BufferAttribute(this.beamPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.beamGeo.setAttribute('color', new THREE.BufferAttribute(this.beamCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.beam = new THREE.LineSegments(
      this.beamGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    this.beam.renderOrder = 14;
    this.group.add(this.beam);
    for (let i = 0; i < 2; i += 1) this.waves.push(this.makeWave());
    for (let i = 0; i < 2; i += 1) this.auras.push(this.makeAura());
    for (let i = 0; i < 2; i += 1) {
      const mat = new THREE.MeshBasicMaterial({ map: this.radial, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(quad, mat);
      mesh.visible = false;
      mesh.renderOrder = 13;
      this.group.add(mesh);
      this.charges.push({ mesh, mat });
    }
  }

  private makeWave() {
    const group = new THREE.Group();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uIntensity: { value: 1 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vPos;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vPos = position;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uIntensity; uniform float uTime;
        varying vec3 vN; varying vec3 vV; varying vec3 vPos;
        void main() {
          float rim = pow(clamp(1.0 - abs(dot(vN, vV)), 0.0, 1.0), 2.2);
          float bands = 0.65 + 0.35 * sin(vPos.y * 18.0 - uTime * 14.0 + vPos.z * 9.0);
          float a = (rim * 1.4 + 0.08) * bands * uIntensity;
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const shellGeo = new THREE.SphereGeometry(0.5, 28, 20);
    shellGeo.scale(0.75, 1.25, 0.9);
    const shell = new THREE.Mesh(shellGeo, mat);
    group.add(shell);
    const ringMat = new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
    const rings: THREE.Mesh[] = [];
    const torus = new THREE.TorusGeometry(0.5, 0.025, 6, 40);
    for (let i = 0; i < 3; i += 1) {
      const ring = new THREE.Mesh(torus, ringMat);
      ring.rotation.y = Math.PI / 2;
      group.add(ring);
      rings.push(ring);
    }
    const glowMat = new THREE.MeshBasicMaterial({ map: this.radial, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat);
    group.add(glow);
    group.visible = false;
    group.renderOrder = 12;
    this.group.add(group);
    return { group, shell, rings, mat, ringMat, glow, glowMat };
  }

  private makeAura() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uIntensity: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uIntensity; uniform float uTime;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          float rim = pow(clamp(1.0 - abs(dot(vN, vV)), 0.0, 1.0), 1.6);
          float flame = 0.6 + 0.4 * sin(vUv.x * 40.0 + uTime * 9.0 + vUv.y * 12.0);
          float fade = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.3) * smoothstep(0.0, 0.08, vUv.y);
          gl_FragColor = vec4(uColor * rim * flame * fade * uIntensity, 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const geo = new THREE.CylinderGeometry(0.42, 0.6, 2.4, 32, 1, true);
    geo.translate(0, 1.2, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.renderOrder = 7;
    this.group.add(mesh);
    return { mesh, mat, level: 0 };
  }

  setReducedMotion(enabled: boolean): void {
    this.reduced = enabled;
  }

  clear(): void {
    for (const s of this.sparks) s.life = 0;
    for (const g of this.glows) g.life = 0;
    for (const d of this.dusts) d.life = 0;
    for (const f of this.flashes) {
      f.life = 0;
      f.mesh.visible = false;
    }
    for (const r of this.rings) {
      r.life = 0;
      r.mesh.visible = false;
    }
    this.boltLife = 0;
    this.bolts.visible = false;
    this.beam.visible = false;
    this.beamOn = false;
    for (const w of this.waves) w.group.visible = false;
    for (const a of this.auras) {
      a.level = 0;
      a.mesh.visible = false;
    }
    for (const c of this.charges) c.mesh.visible = false;
  }

  // ------------------------------------------------------------- emitters

  sparkBurst(pos: THREE.Vector3, color: THREE.ColorRepresentation, count: number, speed: number, dirX = 0, upBias = 0.3): void {
    const c = this.tmpColor.set(color);
    for (let i = 0; i < count; i += 1) {
      const s = this.sparks[this.sparkCursor];
      this.sparkCursor = (this.sparkCursor + 1) % SPARKS;
      const theta = this.rng() * Math.PI * 2;
      const phi = (this.rng() - 0.5) * Math.PI * 0.9;
      const v = speed * (0.35 + this.rng() * 0.9);
      s.p.copy(pos);
      s.v.set(Math.cos(theta) * Math.cos(phi) + dirX * 0.8, Math.sin(theta) * Math.cos(phi) + upBias, Math.sin(phi) * 0.7).normalize().multiplyScalar(v);
      s.max = 0.18 + this.rng() * 0.35;
      s.life = s.max;
      s.gravity = 7 + this.rng() * 6;
      s.color.copy(c).lerp(WHITE, this.rng() * 0.6).multiplyScalar(1.6);
    }
  }

  glowBurst(pos: THREE.Vector3, color: THREE.ColorRepresentation, count: number, speed: number, size: number, life: number, rise = 0): void {
    const c = this.tmpColor.set(color);
    for (let i = 0; i < count; i += 1) {
      const g = this.glows[this.glowCursor];
      this.glowCursor = (this.glowCursor + 1) % GLOWS;
      g.p.copy(pos);
      g.v.set(this.rng() - 0.5, this.rng() - 0.5, (this.rng() - 0.5) * 0.6).normalize().multiplyScalar(speed * (0.3 + this.rng()));
      g.max = life * (0.6 + this.rng() * 0.6);
      g.life = g.max;
      g.size = size * (0.6 + this.rng() * 0.8);
      g.color.copy(c);
      g.rise = rise;
    }
  }

  dust(pos: THREE.Vector3, count: number, spread: number, push = 0): void {
    for (let i = 0; i < count; i += 1) {
      const d = this.dusts[this.dustCursor];
      this.dustCursor = (this.dustCursor + 1) % DUSTS;
      d.p.set(pos.x + (this.rng() - 0.5) * spread, 0.05 + this.rng() * 0.1, pos.z + (this.rng() - 0.5) * 0.5);
      d.v.set((this.rng() - 0.5) * 1.6 + push, 0.25 + this.rng() * 0.5, (this.rng() - 0.5) * 0.6);
      d.max = 0.5 + this.rng() * 0.5;
      d.life = d.max;
      d.size = 0.35 + this.rng() * 0.35;
      d.color.setRGB(0.3, 0.31, 0.34);
      d.rise = 0;
    }
  }

  flash(pos: THREE.Vector3, color: THREE.ColorRepresentation, size: number, life: number, peak = 1.6): void {
    const f = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % FLASHES;
    f.mesh.position.copy(pos);
    f.material.color.set(color);
    f.size = size;
    f.grow = 0.4;
    f.life = life;
    f.max = life;
    f.peak = peak;
    f.mesh.visible = true;
  }

  ring(pos: THREE.Vector3, color: THREE.ColorRepresentation, size: number, life: number, peak = 1.4): void {
    const r = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % RINGS;
    r.mesh.position.copy(pos);
    r.material.color.set(color);
    r.size = size;
    r.life = life;
    r.max = life;
    r.peak = peak;
    r.mesh.visible = true;
  }

  lightning(pos: THREE.Vector3, a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, duration: number): void {
    this.boltCenter.copy(pos);
    this.boltColorA.set(a);
    this.boltColorB.set(b);
    this.boltLife = duration;
  }

  // ---------------------------------------------------------- persistent

  setWave(owner: number, active: boolean, pos: THREE.Vector3, dir: number, color: THREE.Color, age: number): void {
    const w = this.waves[owner];
    w.group.visible = active;
    if (!active) return;
    w.group.position.copy(pos);
    w.group.scale.set(dir, 1, 1);
    const grow = Math.min(1, 0.45 + age / 10);
    w.shell.scale.setScalar(grow);
    w.mat.uniforms.uColor.value.copy(color);
    w.mat.uniforms.uIntensity.value = 0.7;
    w.mat.uniforms.uTime.value = this.time;
    w.ringMat.color.copy(color).multiplyScalar(0.8);
    w.rings.forEach((ring, i) => {
      const phase = (this.time * 3.2 + i / 3) % 1;
      ring.position.x = -phase * 0.9;
      const s = (0.55 + phase * 0.55) * grow;
      ring.scale.set(s, s * 1.3, s);
    });
    w.glowMat.color.copy(color).multiplyScalar(0.55);
    w.glow.scale.setScalar(1.6 * grow);
  }

  /**
   * Force lightning: jagged branching bolts from two hands to a target, rebuilt every frame while
   * active (call each frame; pass active=false to hide).
   */
  setBeam(active: boolean, handA: THREE.Vector3, handB: THREE.Vector3, target: THREE.Vector3, color: THREE.Color): void {
    this.beamOn = active;
    this.beam.visible = active;
    if (!active) return;
    const per = BEAM_SEGMENTS / 3;
    const sources = [handA, handB, handA];
    for (let b = 0; b < 3; b += 1) {
      const src = sources[b];
      let px = src.x;
      let py = src.y;
      let pz = src.z;
      const tx = target.x + (this.rng() - 0.5) * 0.5;
      const ty = target.y + (this.rng() - 0.5) * 0.9;
      const tz = target.z + (this.rng() - 0.5) * 0.3;
      for (let s = 0; s < per; s += 1) {
        const t = (s + 1) / per;
        const wob = Math.sin(t * Math.PI) * 0.35;
        const nx = src.x + (tx - src.x) * t + (this.rng() - 0.5) * wob;
        const ny = src.y + (ty - src.y) * t + (this.rng() - 0.5) * wob;
        const nz = src.z + (tz - src.z) * t + (this.rng() - 0.5) * wob * 0.6;
        const o = (b * per + s) * 6;
        this.beamPos[o] = px;
        this.beamPos[o + 1] = py;
        this.beamPos[o + 2] = pz;
        this.beamPos[o + 3] = nx;
        this.beamPos[o + 4] = ny;
        this.beamPos[o + 5] = nz;
        const k = 1.6 + this.rng() * 1.4;
        const white = this.rng() < 0.35 ? 1 : 0.4;
        this.beamCol[o] = (color.r * (1 - white) + white) * k;
        this.beamCol[o + 1] = (color.g * (1 - white) + white) * k;
        this.beamCol[o + 2] = (color.b * (1 - white) + white) * k;
        this.beamCol[o + 3] = this.beamCol[o] * 0.7;
        this.beamCol[o + 4] = this.beamCol[o + 1] * 0.7;
        this.beamCol[o + 5] = this.beamCol[o + 2] * 0.7;
        px = nx;
        py = ny;
        pz = nz;
      }
    }
    this.beamGeo.attributes.position.needsUpdate = true;
    this.beamGeo.attributes.color.needsUpdate = true;
  }

  get beamActive(): boolean {
    return this.beamOn;
  }

  setAura(index: number, level: number, x: number, color: THREE.Color): void {
    const a = this.auras[index];
    a.level += (level - a.level) * 0.25;
    a.mesh.visible = a.level > 0.02;
    if (!a.mesh.visible) return;
    a.mesh.position.set(x, 0, 0);
    a.mat.uniforms.uColor.value.copy(color);
    a.mat.uniforms.uIntensity.value = a.level * 1.4;
    a.mat.uniforms.uTime.value = this.time;
  }

  setCharge(index: number, amount: number, pos: THREE.Vector3, color: THREE.Color): void {
    const c = this.charges[index];
    c.mesh.visible = amount > 0.02;
    if (!c.mesh.visible) return;
    c.mesh.position.copy(pos);
    c.mat.color.copy(color).multiplyScalar(1.4);
    c.mesh.scale.setScalar(0.25 + amount * 0.45 + Math.sin(this.time * 30) * 0.03);
  }

  // --------------------------------------------------------------- update

  update(dt: number, camera: THREE.Camera, pixelScale: number): void {
    this.time += dt;
    this.glowMat.uniforms.uScale.value = pixelScale;
    this.dustMat.uniforms.uScale.value = pixelScale;

    for (let i = 0; i < SPARKS; i += 1) {
      const s = this.sparks[i];
      const o = i * 6;
      if (s.life <= 0) {
        this.sparkPositions.fill(0, o, o + 6);
        this.sparkColors.fill(0, o, o + 6);
        continue;
      }
      s.life -= dt;
      s.v.y -= s.gravity * dt;
      s.v.multiplyScalar(Math.exp(-dt * 2.2));
      s.p.addScaledVector(s.v, dt);
      if (s.p.y < 0.01) {
        s.p.y = 0.01;
        s.v.y = Math.abs(s.v.y) * 0.35;
        s.v.x *= 0.6;
      }
      const k = Math.max(0, s.life / s.max);
      const streak = 0.028;
      this.sparkPositions[o] = s.p.x;
      this.sparkPositions[o + 1] = s.p.y;
      this.sparkPositions[o + 2] = s.p.z;
      this.sparkPositions[o + 3] = s.p.x - s.v.x * streak;
      this.sparkPositions[o + 4] = s.p.y - s.v.y * streak;
      this.sparkPositions[o + 5] = s.p.z - s.v.z * streak;
      const r = s.color.r * k;
      const g = s.color.g * k;
      const b = s.color.b * k;
      this.sparkColors[o] = r;
      this.sparkColors[o + 1] = g;
      this.sparkColors[o + 2] = b;
      this.sparkColors[o + 3] = r * 0.2;
      this.sparkColors[o + 4] = g * 0.2;
      this.sparkColors[o + 5] = b * 0.2;
    }
    (this.sparkGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.sparkGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

    this.updatePoints(this.glows, this.glowPos, this.glowCol, this.glowSize, this.glowAlpha, dt, true);
    this.glowGeo.attributes.position.needsUpdate = true;
    this.glowGeo.attributes.color.needsUpdate = true;
    this.glowGeo.attributes.size.needsUpdate = true;
    this.glowGeo.attributes.alpha.needsUpdate = true;
    this.updatePoints(this.dusts, this.dustPos, this.dustCol, this.dustSize, this.dustAlpha, dt, false);
    this.dustGeo.attributes.position.needsUpdate = true;
    this.dustGeo.attributes.color.needsUpdate = true;
    this.dustGeo.attributes.size.needsUpdate = true;
    this.dustGeo.attributes.alpha.needsUpdate = true;

    for (const f of this.flashes) {
      if (f.life <= 0) {
        f.mesh.visible = false;
        continue;
      }
      f.life -= dt;
      const k = Math.max(0, f.life / f.max);
      const u = 1 - k;
      f.mesh.quaternion.copy(camera.quaternion);
      f.mesh.scale.setScalar(f.size * (1 + u * f.grow));
      f.material.opacity = k * k * f.peak;
    }
    for (const r of this.rings) {
      if (r.life <= 0) {
        r.mesh.visible = false;
        continue;
      }
      r.life -= dt;
      const k = Math.max(0, r.life / r.max);
      const u = 1 - k;
      r.mesh.quaternion.copy(camera.quaternion);
      r.mesh.scale.setScalar(r.size * (0.2 + 0.8 * (1 - (1 - u) * (1 - u))));
      r.material.opacity = k * r.peak;
    }
    for (const c of this.charges) if (c.mesh.visible) c.mesh.quaternion.copy(camera.quaternion);
    for (const w of this.waves) if (w.group.visible) w.glow.quaternion.copy(camera.quaternion);

    this.updateBolts(dt);
  }

  private updatePoints(
    list: Glow[],
    pos: Float32Array,
    col: Float32Array,
    size: Float32Array,
    alpha: Float32Array,
    dt: number,
    additive: boolean,
  ): void {
    for (let i = 0; i < list.length; i += 1) {
      const g = list[i];
      if (g.life <= 0) {
        alpha[i] = 0;
        continue;
      }
      g.life -= dt;
      g.v.y += g.rise * dt;
      g.v.multiplyScalar(Math.exp(-dt * (additive ? 2.5 : 3)));
      g.p.addScaledVector(g.v, dt);
      const k = Math.max(0, g.life / g.max);
      pos[i * 3] = g.p.x;
      pos[i * 3 + 1] = g.p.y;
      pos[i * 3 + 2] = g.p.z;
      col[i * 3] = g.color.r;
      col[i * 3 + 1] = g.color.g;
      col[i * 3 + 2] = g.color.b;
      if (additive) {
        size[i] = g.size * (0.4 + 0.6 * k);
        alpha[i] = k * 1.4;
      } else {
        size[i] = g.size * (1.6 - 0.9 * k);
        alpha[i] = Math.sin(k * Math.PI) * 0.18;
      }
    }
  }

  private updateBolts(dt: number): void {
    if (this.boltLife <= 0) {
      this.bolts.visible = false;
      return;
    }
    this.boltLife -= dt;
    this.bolts.visible = true;
    const boltsCount = 4;
    const perBolt = BOLT_SEGMENTS / boltsCount;
    for (let b = 0; b < boltsCount; b += 1) {
      const angle = this.rng() * Math.PI * 2;
      const len = 0.35 + this.rng() * 0.55;
      let px = this.boltCenter.x;
      let py = this.boltCenter.y;
      let pz = this.boltCenter.z + 0.05;
      const color = b % 2 === 0 ? this.boltColorA : this.boltColorB;
      for (let s = 0; s < perBolt; s += 1) {
        const t = (s + 1) / perBolt;
        const nx = this.boltCenter.x + Math.cos(angle) * len * t + (this.rng() - 0.5) * 0.12;
        const ny = this.boltCenter.y + Math.sin(angle) * len * t + (this.rng() - 0.5) * 0.12;
        const nz = this.boltCenter.z + 0.05 + (this.rng() - 0.5) * 0.08;
        const o = (b * perBolt + s) * 6;
        this.boltPos[o] = px;
        this.boltPos[o + 1] = py;
        this.boltPos[o + 2] = pz;
        this.boltPos[o + 3] = nx;
        this.boltPos[o + 4] = ny;
        this.boltPos[o + 5] = nz;
        const k = (1 - t) * 2.2;
        this.boltCol[o] = (color.r * 0.6 + 0.4) * k;
        this.boltCol[o + 1] = (color.g * 0.6 + 0.4) * k;
        this.boltCol[o + 2] = (color.b * 0.6 + 0.4) * k;
        this.boltCol[o + 3] = color.r * k * 0.8;
        this.boltCol[o + 4] = color.g * k * 0.8;
        this.boltCol[o + 5] = color.b * k * 0.8;
        px = nx;
        py = ny;
        pz = nz;
      }
    }
    this.boltGeo.attributes.position.needsUpdate = true;
    this.boltGeo.attributes.color.needsUpdate = true;
    void this.tmp;
    void this.reduced;
  }

  dispose(): void {
    this.sparkGeo.dispose();
    this.beamGeo.dispose();
    this.glowGeo.dispose();
    this.dustGeo.dispose();
    this.boltGeo.dispose();
    this.radial.dispose();
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const m = mesh.material as THREE.Material;
        m.dispose();
      }
    });
  }
}
