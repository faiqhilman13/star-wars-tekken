import * as THREE from 'three';

/**
 * Directional height fog shared by every arena material and the background dome.
 *
 * Fog colour depends on the view direction (warm abyss glow below the horizon,
 * dusky haze at the horizon, cold steel above, a halo toward the reactor) and
 * the fog amount on distance plus depth below the bridge. Fully fogged geometry
 * therefore blends seamlessly into the dome, which evaluates the same function.
 */

export interface FogUniforms {
  [key: string]: THREE.IUniform;
  uFogTop: THREE.IUniform<THREE.Color>;
  uFogMid: THREE.IUniform<THREE.Color>;
  uFogLow: THREE.IUniform<THREE.Color>;
  uFogHalo: THREE.IUniform<THREE.Color>;
  uFogHaloDir: THREE.IUniform<THREE.Vector3>;
  uFogDensity: THREE.IUniform<number>;
  uFogDepth: THREE.IUniform<number>;
}

export function createFogUniforms(): FogUniforms {
  return {
    uFogTop: { value: new THREE.Color(0.003, 0.007, 0.017) },
    uFogMid: { value: new THREE.Color(0.021, 0.026, 0.036) },
    uFogLow: { value: new THREE.Color(0.36, 0.105, 0.02) },
    uFogHalo: { value: new THREE.Color(0.16, 0.055, 0.012) },
    uFogHaloDir: { value: new THREE.Vector3(0, -0.12, -1).normalize() },
    uFogDensity: { value: 1 / 115 },
    uFogDepth: { value: 1.0 },
  };
}

/** GLSL: uniforms + arenaSky(dir) + arenaFogAmount(dist, worldY) + arenaApplyFog(). */
export const FOG_PARS_GLSL = /* glsl */ `
uniform vec3 uFogTop;
uniform vec3 uFogMid;
uniform vec3 uFogLow;
uniform vec3 uFogHalo;
uniform vec3 uFogHaloDir;
uniform float uFogDensity;
uniform float uFogDepth;

vec3 arenaSky( vec3 d ) {
  float y = d.y;
  vec3 c = mix( uFogMid, uFogTop, smoothstep( 0.03, 0.5, y ) );
  // warm abyss glow below the horizon, hottest straight down
  float below = 1.0 - smoothstep( -0.5, -0.03, y );
  c = mix( c, uFogLow, below );
  c += uFogLow * 0.35 * ( 1.0 - smoothstep( -0.95, -0.45, y ) );
  float h = max( dot( d, uFogHaloDir ), 0.0 );
  c += uFogHalo * ( pow( h, 14.0 ) * 0.45 + pow( h, 60.0 ) * 0.9 );
  return c;
}

float arenaFogAmount( float dist, float wy ) {
  float fd = 1.0 - exp( -dist * dist * uFogDensity * uFogDensity );
  float depth = clamp( ( -wy - 1.0 ) / 42.0, 0.0, 1.0 );
  float fh = ( 1.0 - exp( -depth * depth * 5.0 * uFogDepth ) ) * smoothstep( 4.0, 26.0, dist );
  return 1.0 - ( 1.0 - fd ) * ( 1.0 - fh );
}

vec3 arenaApplyFog( vec3 col, vec3 viewToFrag ) {
  float dist = length( viewToFrag );
  vec3 dir = viewToFrag / max( dist, 1e-4 );
  float f = arenaFogAmount( dist, cameraPosition.y + viewToFrag.y );
  return mix( col, arenaSky( dir ), f );
}
`;

const FOG_VARYING = 'varying vec3 vArenaFogDir;\n';
const FOG_VERTEX = '#include <project_vertex>\n vArenaFogDir = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;';

/** Patch a built-in material (Standard/Basic/Physical) so it uses the arena fog. */
export function applyArenaFog<T extends THREE.Material & { fog: boolean }>(material: T, uniforms: FogUniforms, key: string): T {
  material.fog = false;
  material.onBeforeCompile = (shader) => {
    for (const name of Object.keys(uniforms)) shader.uniforms[name] = uniforms[name];
    shader.vertexShader = FOG_VARYING + shader.vertexShader.replace('#include <project_vertex>', FOG_VERTEX);
    shader.fragmentShader =
      FOG_VARYING +
      FOG_PARS_GLSL +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\n gl_FragColor.rgb = arenaApplyFog( gl_FragColor.rgb, vArenaFogDir );',
      );
  };
  material.customProgramCacheKey = () => `arena-fog-${key}`;
  return material;
}

/** Vertex snippet for custom ShaderMaterials: computes vArenaFogDir (world-space camera→vertex). */
export const FOG_VERTEX_CUSTOM = 'vArenaFogDir = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;';
export const FOG_VARYING_GLSL = FOG_VARYING;

/**
 * Background dome drawn at the far plane regardless of camera far distance.
 * Uses only the view rotation, so it never needs repositioning.
 */
export function createSkyDome(uniforms: FogUniforms): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    name: 'arena.sky',
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * vec4( ( viewMatrix * vec4( position, 0.0 ) ).xyz, 1.0 );
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      ${FOG_PARS_GLSL}
      varying vec3 vDir;
      void main() {
        gl_FragColor = vec4( arenaSky( normalize( vDir ) ), 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), mat);
  dome.name = 'arena.skyDome';
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  return dome;
}

/**
 * Bake a small procedural environment (dome gradient + light panels) into a PMREM
 * texture so metal surfaces (deck, fighters' hilts) pick up the stage palette.
 */
export function createEnvironment(renderer: THREE.WebGLRenderer, uniforms: FogUniforms): THREE.WebGLRenderTarget {
  const envScene = new THREE.Scene();
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      // the env bake keeps the warm glow localized so metals stay steel-blue
      uFogHalo: { value: uniforms.uFogHalo.value.clone().multiplyScalar(0.3) },
      uFogLow: { value: uniforms.uFogLow.value.clone().multiplyScalar(0.75) },
      uFogMid: { value: new THREE.Color(0.03, 0.038, 0.055) },
      uBoost: { value: 2.2 },
    },
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: /* glsl */ `
      ${FOG_PARS_GLSL}
      uniform float uBoost;
      varying vec3 vDir;
      void main() { gl_FragColor = vec4( arenaSky( normalize( vDir ) ) * uBoost, 1.0 ); }`,
  });
  const disposables: Array<{ dispose(): void }> = [skyMat];
  const sphereGeo = new THREE.SphereGeometry(40, 32, 16);
  disposables.push(sphereGeo);
  envScene.add(new THREE.Mesh(sphereGeo, skyMat));

  const planeGeo = new THREE.PlaneGeometry(1, 1);
  disposables.push(planeGeo);
  const panel = (x: number, y: number, z: number, w: number, h: number, color: number, intensity: number): void => {
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      side: THREE.DoubleSide,
    });
    disposables.push(m);
    const mesh = new THREE.Mesh(planeGeo, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, 1);
    mesh.lookAt(0, 0, 0);
    envScene.add(mesh);
  };
  // Overhead cool work-light strips (give metal a crisp top highlight).
  panel(0, 22, 6, 34, 4, 0xc8d6ff, 2.4);
  panel(-14, 20, -10, 14, 3, 0xb8c8f0, 1.8);
  panel(16, 19, -14, 12, 3, 0xb8c8f0, 1.6);
  // Reactor core glow behind the bridge.
  panel(0, -4, -30, 9, 18, 0xff8a3a, 1.8);
  // Abyss glow below.
  panel(0, -26, 0, 70, 70, 0xff6a24, 0.7);
  // Cool window bands on the chamber wall (horizon reflections on the deck).
  panel(-26, 3, -18, 26, 1.2, 0x9fb6e0, 1.4);
  panel(26, 3, -18, 26, 1.2, 0x9fb6e0, 1.4);
  panel(0, 9, -30, 30, 1.0, 0x9fb6e0, 1.0);
  // Amber warning practicals at the bulkheads.
  panel(-24, 4, 4, 2, 6, 0xffa040, 2.5);
  panel(24, 4, 4, 2, 6, 0xffa040, 2.5);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.035);
  pmrem.dispose();
  for (const d of disposables) d.dispose();
  return rt;
}
