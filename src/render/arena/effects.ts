import * as THREE from 'three';
import { FOG_PARS_GLSL, FOG_VARYING_GLSL, FOG_VERTEX_CUSTOM, type FogUniforms } from './atmosphere';
import type { Rng } from './textures';

/** Kinds of additive atmosphere card. */
export const enum GlowKind {
  Haze = 0,
  AbyssGlow = 1,
  Shaft = 2,
  Radial = 3,
}

/** Blink curve shared by GPU halos and CPU-driven bulbs so they stay in sync. */
export function blink(time: number, speed: number, phase: number): number {
  const s = 0.5 + 0.5 * Math.sin(time * speed + phase);
  return 0.12 + 0.88 * Math.pow(s, 6);
}

// ---------------------------------------------------------------------------
// Atmosphere: all additive cards (haze sheets, abyss glow, light shafts, halos)
// merged into ONE mesh/draw call. Additive blending is order-independent.
// ---------------------------------------------------------------------------

export class AtmosphereBuilder {
  private readonly pos: number[] = [];
  private readonly uv: number[] = [];
  private readonly params: number[] = [];
  private readonly tint: number[] = [];
  private readonly index: number[] = [];

  /** Add a quad from 4 corners (bl, br, tr, tl) with uv (0,0)-(1,1). */
  quad(
    corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
    kind: GlowKind,
    intensity: number,
    speed: number,
    seed: number,
    color: THREE.Color,
  ): void {
    const base = this.pos.length / 3;
    const uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      this.pos.push(c.x, c.y, c.z);
      this.uv.push(uvs[i * 2], uvs[i * 2 + 1]);
      this.params.push(kind, intensity, speed, seed);
      this.tint.push(color.r, color.g, color.b);
    }
    this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Vertical card facing +z centred at (x, y, z). */
  card(x: number, y: number, z: number, w: number, h: number, kind: GlowKind, intensity: number, speed: number, seed: number, color: THREE.Color, tilt = 0): void {
    const c = Math.cos(tilt);
    const s = Math.sin(tilt);
    const p = (u: number, v: number): THREE.Vector3 => new THREE.Vector3(x + u * c - v * s, y + u * s + v * c, z);
    this.quad([p(-w / 2, -h / 2), p(w / 2, -h / 2), p(w / 2, h / 2), p(-w / 2, h / 2)], kind, intensity, speed, seed, color);
  }

  /** Horizontal card in the xz plane at height y. */
  floor(x0: number, x1: number, z0: number, z1: number, y: number, kind: GlowKind, intensity: number, speed: number, seed: number, color: THREE.Color): void {
    this.quad(
      [new THREE.Vector3(x0, y, z1), new THREE.Vector3(x1, y, z1), new THREE.Vector3(x1, y, z0), new THREE.Vector3(x0, y, z0)],
      kind,
      intensity,
      speed,
      seed,
      color,
    );
  }

  build(noise: THREE.Texture, fog: FogUniforms, time: THREE.IUniform<number>, pulse: THREE.IUniform<number>): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('aParams', new THREE.Float32BufferAttribute(this.params, 4));
    geo.setAttribute('aTint', new THREE.Float32BufferAttribute(this.tint, 3));
    geo.setIndex(this.index);
    geo.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      name: 'arena.atmosphere',
      uniforms: { ...fog, uNoise: { value: noise }, uTime: time, uPulse: pulse },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute vec4 aParams;
        attribute vec3 aTint;
        varying vec2 vUv;
        varying vec4 vParams;
        varying vec3 vTint;
        varying vec3 vWorld;
        ${FOG_VARYING_GLSL}
        void main() {
          vUv = uv;
          vParams = aParams;
          vTint = aTint;
          vec4 wp = modelMatrix * vec4( position, 1.0 );
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          ${FOG_VERTEX_CUSTOM}
        }`,
      fragmentShader: /* glsl */ `
        ${FOG_PARS_GLSL}
        uniform sampler2D uNoise;
        uniform float uTime;
        uniform float uPulse;
        varying vec2 vUv;
        varying vec4 vParams;
        varying vec3 vTint;
        varying vec3 vWorld;
        ${FOG_VARYING_GLSL}
        float edgeFade( vec2 uv, float m ) {
          return smoothstep( 0.0, m, uv.x ) * ( 1.0 - smoothstep( 1.0 - m, 1.0, uv.x ) )
               * smoothstep( 0.0, m, uv.y ) * ( 1.0 - smoothstep( 1.0 - m, 1.0, uv.y ) );
        }
        void main() {
          float kind = vParams.x;
          float speed = vParams.z;
          float seed = vParams.w;
          float a = 0.0;
          vec3 tint = vTint;
          if ( kind < 0.5 ) {
            // drifting haze sheet
            vec2 p = vec2( vWorld.x * 0.016 + uTime * speed + seed, vWorld.y * 0.028 + seed * 0.37 );
            float n = texture2D( uNoise, p ).r;
            float n2 = texture2D( uNoise, p * 2.7 + vec2( -uTime * speed * 1.6, uTime * 0.004 ) ).g;
            float vert = smoothstep( 0.0, 0.3, vUv.y ) * ( 1.0 - smoothstep( 0.45, 1.0, vUv.y ) );
            float side = smoothstep( 0.0, 0.2, vUv.x ) * ( 1.0 - smoothstep( 0.8, 1.0, vUv.x ) );
            a = smoothstep( 0.25, 0.9, n * 0.75 + n2 * 0.4 ) * vert * side;
            // warm where lit from the abyss, cold steel-blue higher up
            tint = mix( vTint, vec3( 0.32, 0.42, 0.62 ), smoothstep( -6.0, 16.0, vWorld.y ) );
          } else if ( kind < 1.5 ) {
            // glowing abyss layer, brightest around the reactor
            vec2 p = vWorld.xz * 0.011 + vec2( seed, uTime * speed );
            float n = texture2D( uNoise, p ).r * 0.65 + texture2D( uNoise, p * 3.3 + vec2( uTime * speed * 0.6, 0.0 ) ).g * 0.5;
            float r = length( ( vWorld.xz - vec2( 0.0, -52.0 ) ) / vec2( 95.0, 75.0 ) );
            a = ( 1.0 - smoothstep( 0.05, 1.0, r ) ) * ( 0.3 + 0.9 * n ) * edgeFade( vUv, 0.12 );
            a *= 0.85 + 0.15 * uPulse;
          } else if ( kind < 2.5 ) {
            // light shaft: uv.x across, uv.y along (1 = source end)
            float across = 1.0 - abs( vUv.x * 2.0 - 1.0 );
            float core = pow( max( across, 0.0 ), 1.8 );
            float streak = texture2D( uNoise, vec2( vUv.x * 1.3 + seed, vUv.y * 0.35 + uTime * speed ) ).b;
            float along = smoothstep( 0.0, 0.45, vUv.y ) * ( 1.0 - smoothstep( 0.88, 1.0, vUv.y ) );
            a = core * along * ( 0.62 + 0.5 * streak );
          } else {
            // radial halo; speed > 0 blinks, speed < 0 follows the reactor pulse
            vec2 c = vUv * 2.0 - 1.0;
            float d = length( c );
            a = pow( max( 1.0 - d, 0.0 ), 2.4 );
            if ( speed > 0.0 ) {
              float s = 0.5 + 0.5 * sin( uTime * speed + seed );
              a *= 0.12 + 0.88 * pow( s, 6.0 );
            } else if ( speed < 0.0 ) {
              a *= uPulse;
            }
          }
          vec3 col = tint * a * vParams.y;
          float dist = length( vArenaFogDir );
          float f = arenaFogAmount( dist, cameraPosition.y + vArenaFogDir.y );
          col *= 1.0 - 0.7 * f;
          gl_FragColor = vec4( col, 1.0 );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'arena.atmosphere';
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    return mesh;
  }
}

// ---------------------------------------------------------------------------
// Embers: one Points system, motion fully in the vertex shader (time uniform).
// ---------------------------------------------------------------------------

export interface Embers {
  points: THREE.Points;
  uniforms: { uTime: THREE.IUniform<number>; uViewH: THREE.IUniform<number> };
  setCount(n: number): void;
}

export function createEmbers(rng: Rng, max: number, fog: FogUniforms, time: THREE.IUniform<number>): Embers {
  const pos = new Float32Array(max * 3);
  const seed = new Float32Array(max * 4);
  const range = new Float32Array(max * 2);
  for (let i = 0; i < max; i++) {
    const under = i % 4 === 3; // every 4th ember rises under the bridge (seen through the truss)
    let x: number;
    let z: number;
    let y0: number;
    let h: number;
    if (under) {
      x = (rng() - 0.5) * 30;
      z = -1.6 + rng() * 4.0;
      y0 = -9;
      h = 8.2; // dies out before reaching the deck underside (y ≈ -0.8)
    } else {
      x = (rng() - 0.5) * 50;
      z = -2.9 - Math.pow(rng(), 2.0) * 22;
      y0 = -12;
      h = 27;
    }
    pos[i * 3] = x;
    pos[i * 3 + 1] = rng() * h; // initial offset inside its loop
    pos[i * 3 + 2] = z;
    seed[i * 4] = rng() * Math.PI * 2; // phase
    seed[i * 4 + 1] = 0.35 + rng() * 0.75; // rise speed
    seed[i * 4 + 2] = 0.045 + Math.pow(rng(), 2) * 0.08; // world size
    seed[i * 4 + 3] = rng(); // heat (colour/brightness)
    range[i * 2] = y0;
    range[i * 2 + 1] = h;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  geo.setAttribute('aRange', new THREE.BufferAttribute(range, 2));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -10), 40);
  const uniforms = { uTime: time, uViewH: { value: 720 } };
  const mat = new THREE.ShaderMaterial({
    name: 'arena.embers',
    uniforms: { ...fog, ...uniforms },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      ${FOG_PARS_GLSL}
      attribute vec4 aSeed;
      attribute vec2 aRange;
      uniform float uTime;
      uniform float uViewH;
      varying float vAlpha;
      varying vec3 vColor;
      ${FOG_VARYING_GLSL}
      void main() {
        float h = aRange.y;
        float y = mod( position.y + uTime * aSeed.y, h );
        float life = y / h;
        float ph = aSeed.x;
        vec3 wp = vec3(
          position.x + sin( uTime * 0.6 + ph ) * 0.5 + sin( uTime * 0.21 + ph * 3.0 ) * 1.1,
          aRange.x + y,
          position.z + cos( uTime * 0.45 + ph * 2.0 ) * 0.45 );
        vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        float dist = max( -mvPosition.z, 0.1 );
        float px = aSeed.z * uViewH * 0.5 * projectionMatrix[1][1] / dist;
        float shrink = clamp( px / 1.6, 0.0, 1.0 );
        gl_PointSize = max( px, 1.6 );
        float twinkle = 0.65 + 0.35 * sin( uTime * ( 2.0 + aSeed.w * 5.0 ) + ph * 7.0 );
        vAlpha = smoothstep( 0.0, 0.12, life ) * ( 1.0 - smoothstep( 0.6, 1.0, life ) ) * twinkle * shrink * shrink;
        // never drift above the deck in front of the fighters
        vAlpha *= 1.0 - step( 0.9, wp.z ) * smoothstep( -0.9, -0.3, wp.y );
        vColor = mix( vec3( 1.0, 0.3, 0.05 ), vec3( 1.0, 0.68, 0.28 ), aSeed.w ) * ( 1.3 + aSeed.w * 1.4 );
        ${FOG_VERTEX_CUSTOM}
        float f = arenaFogAmount( length( vArenaFogDir ), cameraPosition.y + vArenaFogDir.y );
        vAlpha *= 1.0 - 0.75 * f;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        float d = length( gl_PointCoord - 0.5 ) * 2.0;
        float a = 1.0 - smoothstep( 0.0, 1.0, d );
        a *= a;
        gl_FragColor = vec4( vColor * a * vAlpha, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'arena.embers';
  points.frustumCulled = false;
  points.renderOrder = 11;
  return {
    points,
    uniforms,
    setCount(n: number) {
      geo.setDrawRange(0, Math.max(0, Math.min(max, n)));
    },
  };
}

// ---------------------------------------------------------------------------
// Reactor plasma column (emissive, animated, fogged).
// ---------------------------------------------------------------------------

export function createPlasmaMaterial(
  noise: THREE.Texture,
  fog: FogUniforms,
  time: THREE.IUniform<number>,
  pulse: THREE.IUniform<number>,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'arena.plasma',
    uniforms: {
      ...fog,
      uNoise: { value: noise },
      uTime: time,
      uPulse: pulse,
      uDeep: { value: new THREE.Color(0.16, 0.025, 0.005) },
      uWarm: { value: new THREE.Color(1.0, 0.27, 0.04) },
      uHot: { value: new THREE.Color(1.5, 0.78, 0.3) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      ${FOG_VARYING_GLSL}
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vWorld = wp.xyz;
        vNormalW = normalize( mat3( modelMatrix ) * normal );
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        ${FOG_VERTEX_CUSTOM}
      }`,
    fragmentShader: /* glsl */ `
      ${FOG_PARS_GLSL}
      uniform sampler2D uNoise;
      uniform float uTime;
      uniform float uPulse;
      uniform vec3 uDeep;
      uniform vec3 uWarm;
      uniform vec3 uHot;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      ${FOG_VARYING_GLSL}
      void main() {
        float y = vWorld.y;
        float n = texture2D( uNoise, vec2( vUv.x * 4.0, y * 0.03 - uTime * 0.045 ) ).r;
        float n2 = texture2D( uNoise, vec2( vUv.x * 10.0 + uTime * 0.01, y * 0.085 - uTime * 0.15 ) ).g;
        float bands = 0.5 + 0.5 * sin( y * 0.9 - uTime * 1.6 + n * 6.0 );
        float plasma = n * 0.55 + n2 * 0.45 + bands * 0.12;
        float prof = smoothstep( -70.0, -14.0, y ) * ( 1.0 - smoothstep( 0.0, 16.0, y ) );
        vec3 V = normalize( cameraPosition - vWorld );
        float facing = max( dot( normalize( vNormalW ), V ), 0.0 );
        float heat = plasma * ( 0.4 + 0.6 * prof ) * ( 0.45 + 0.55 * facing ) * uPulse;
        vec3 col = mix( uDeep, uWarm, smoothstep( 0.12, 0.55, heat ) );
        col = mix( col, uHot, smoothstep( 0.6, 0.95, heat ) );
        col *= 0.35 + 1.15 * heat;
        col = arenaApplyFog( col, vArenaFogDir );
        gl_FragColor = vec4( col, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
