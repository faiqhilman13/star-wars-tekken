import * as THREE from 'three';

/**
 * Guilty Gear–style cel shading for the fighters (art/ANIME_DIRECTION.md, pipeline v5).
 *
 * - A dedicated character light fixed in view space (front-above-left of the camera), so fighters
 *   always read regardless of the arena lighting. The arena only adds coloured rims (its directional
 *   and spot lights), a subtle hemisphere tint, blade light, and the key light's shadow map.
 * - Two-step terminator: smoothstep around a threshold (shadeShift / shadeToony, MToon-style) between
 *   the lit colour and a hand-chosen shade colour. Received shadows fall to the shade colour with a hard
 *   edge, never toward black.
 * - Hard rims, an "angel ring" hair band and a two-tone metal highlight (matcap "hair" / "metal").
 * - Inverted-hull ink outlines (toonOutlineMaterial): back faces pushed out along the normal in clip
 *   space, a near-constant pixel width scaled by a per-vertex mask, tinted from the surface colour.
 */

export type Matcap = 'none' | 'metal' | 'hair';
export const MATCAP_ID: Record<Matcap, number> = { none: 0, metal: 1, hair: 2 };

/** Toon parameters (glTF material extras `toon`, pipeline v5). */
export interface ToonParams {
  shadeColor: THREE.Color;
  /** −1..1: shifts the terminator (positive = more lit). */
  shadeShift: number;
  /** 0..1: 1 = hard step, 0 = smooth. */
  shadeToony: number;
  rimColor: THREE.Color | null;
  rimPower: number;
  /** Outline width in metres (converted to pixels, clamped). */
  outlineWidth: number;
  outlineColor: THREE.Color;
  matcap: Matcap;
  /** Face skin: soft terminator, light received shadow. */
  face: boolean;
  /** Eyes, visor glints: no lighting at all. */
  unlit: boolean;
}

/** Shared per-rig uniforms (rim light colour, hit flash). */
export interface ToonRigUniforms {
  uRimColor: { value: THREE.Color };
  uRimStrength: { value: number };
  uFlashColor: { value: THREE.Color };
  uFlash: { value: number };
  uFlashFlat: { value: number };
}

/** Character light, view space: slightly left of, above and in front of the camera. */
const CHAR_LIGHT = new THREE.Vector3(-0.38, 0.62, 0.68).normalize();

const VERT = /* glsl */ `
#define TOON_FIGHTER
varying vec3 vViewPosition;
#ifdef TOON_VERTEX_PARAMS
  attribute vec4 toon;
  attribute vec3 shade;
  varying vec4 vToon;
  varying vec3 vShade;
#endif
#if defined( TOON_MAP ) || defined( TOON_SLOTS )
  varying vec2 vToonUv;
#endif
#ifdef TOON_SLOTS
  // Per-material parameters, looked up per vertex (uniform arrays index freely in the vertex stage).
  attribute float slot;
  uniform vec3 uSlotColor[ TOON_SLOT_COUNT ];
  uniform vec3 uSlotShade[ TOON_SLOT_COUNT ];
  uniform vec3 uSlotRim[ TOON_SLOT_COUNT ];
  uniform vec4 uSlotParams[ TOON_SLOT_COUNT ];
  uniform vec4 uSlotFlags[ TOON_SLOT_COUNT ];
  flat varying int vSlot;
  flat varying vec3 vSlotColor;
  flat varying vec3 vSlotShade;
  flat varying vec3 vSlotRim;
  flat varying vec4 vSlotParams;
  flat varying vec4 vSlotFlags;
#endif
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  #ifdef TOON_VERTEX_PARAMS
    vToon = toon;
    vShade = shade;
  #endif
  #if defined( TOON_MAP ) || defined( TOON_SLOTS )
    vToonUv = uv;
  #endif
  #ifdef TOON_SLOTS
    int si = clamp( int( slot + 0.5 ), 0, TOON_SLOT_COUNT - 1 );
    vSlot = si;
    vSlotColor = uSlotColor[ si ];
    vSlotShade = uSlotShade[ si ];
    vSlotRim = uSlotRim[ si ];
    vSlotParams = uSlotParams[ si ];
    vSlotFlags = uSlotFlags[ si ];
  #endif
  #include <color_vertex>
  #include <morphinstance_vertex>
  #include <morphcolor_vertex>
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <normal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  vViewPosition = - mvPosition.xyz;
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#define TOON_FIGHTER
varying vec3 vViewPosition;
uniform vec3 diffuse;
uniform float opacity;
uniform float uAlphaTest;
uniform vec3 uShadeColor;
uniform float uShadeShift;
uniform float uShadeToony;
uniform float uMatcap;
uniform float uFace;
uniform float uUnlit;
uniform vec3 uMatRim;
uniform float uMatRimPower;
uniform vec3 uCharLight;
uniform float uCharLightGain;
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform vec3 uFlashColor;
uniform float uFlash;
uniform float uFlashFlat;
uniform float uMaxLum;
uniform float uDisplayGain;
#ifdef TOON_VERTEX_PARAMS
  varying vec4 vToon;
  varying vec3 vShade;
#endif
#ifdef TOON_MAP
  uniform sampler2D uMap;
#endif
#if defined( TOON_MAP ) || defined( TOON_SLOTS )
  varying vec2 vToonUv;
#endif
#ifdef TOON_SLOTS
  flat varying int vSlot;
  flat varying vec3 vSlotColor;
  flat varying vec3 vSlotShade;
  flat varying vec3 vSlotRim;
  flat varying vec4 vSlotParams;
  flat varying vec4 vSlotFlags;
  TOON_SLOT_SAMPLERS
#endif
#include <common>
#include <color_pars_fragment>

// Inverse of three's ACESFilmicToneMapping (exposure 1): the frame is tone-mapped downstream (OutputPass or
// the material chunk), so toon colours are pre-compensated to land on screen exactly as authored, with no
// ACES wash on brights and no toe lift on shadows.
vec3 toonInverseACES( vec3 display ) {
  const mat3 invOut = mat3(
    vec3( 0.643038, 0.059269, 0.005962 ),
    vec3( 0.311187, 0.931436, 0.063929 ),
    vec3( 0.045775, 0.009295, 0.930118 )
  );
  const mat3 invIn = mat3(
    vec3( 1.764741, -0.147028, -0.036337 ),
    vec3( -0.675778, 1.160252, -0.162436 ),
    vec3( -0.088963, -0.013224, 1.198773 )
  );
  vec3 y = clamp( invOut * display, 0.0, 0.8 );
  vec3 A = 1.0 - 0.983729 * y;
  vec3 B = 0.0245786 - 0.4329510 * y;
  vec3 C = -0.000090537 - 0.238081 * y;
  vec3 v = ( -B + sqrt( max( B * B - 4.0 * A * C, 0.0 ) ) ) / ( 2.0 * A );
  return max( invIn * v * 0.6, 0.0 );
}
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <shadowmap_pars_fragment>
#include <logdepthbuf_pars_fragment>

void main() {
  vec4 diffuseColor = vec4( diffuse, opacity );
  float shift = uShadeShift;
  float toony = uShadeToony;
  float matcap = uMatcap;
  float face = uFace;
  float unlit = uUnlit;
  float alphaCut = uAlphaTest;
  vec3 matRimC = uMatRim;
  float matRimP = uMatRimPower;
  vec3 shadeCol = uShadeColor;
  #include <logdepthbuf_fragment>
  #ifdef TOON_MAP
    vec4 texel = texture2D( uMap, vToonUv );
    diffuseColor *= texel;
    shadeCol = uShadeColor * texel.rgb;
  #endif
  #ifdef TOON_SLOTS
    // Slot draw: this fragment's material from the vertex slot (explicit gradients keep mips right at seams).
    vec2 tdx = dFdx( vToonUv );
    vec2 tdy = dFdy( vToonUv );
    vec4 texel;
    TOON_SLOT_FETCH
    diffuseColor = vec4( vSlotColor, 1.0 ) * texel;
    shadeCol = vSlotShade * texel.rgb;
    shift = vSlotParams.x;
    toony = vSlotParams.y;
    matcap = vSlotParams.z;
    face = vSlotParams.w;
    unlit = vSlotFlags.x;
    alphaCut = vSlotFlags.y;
    matRimP = vSlotFlags.z;
    matRimC = vSlotRim;
  #endif
  #include <color_fragment>
  if ( diffuseColor.a < alphaCut ) discard;
  #include <normal_fragment_begin>

  vec3 lit = diffuseColor.rgb;
  #ifdef TOON_VERTEX_PARAMS
    shift = vToon.x;
    toony = vToon.y;
    matcap = vToon.z;
    face = vToon.w;
    shadeCol = lit * vShade;
  #endif

  vec3 V = normalize( vViewPosition );
  float NdotV = saturate( dot( normal, V ) );
  vec3 col;
  if ( unlit > 0.5 ) {
    col = lit;
  } else {
    // Two-step terminator against the character light.
    float NdotL = dot( normal, uCharLight );
    float soft = 1.0 - toony;
    float t = smoothstep( -soft - 0.02, soft + 0.02, NdotL + shift );
    // Faces: a wide soft band biased toward light (GG keeps faces clean).
    t = mix( t, smoothstep( -0.75, 0.25, NdotL + shift + 0.25 ), face );

    // Received shadow (arena key light), hard-edged, into the shade colour.
    float sh = 1.0;
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
      DirectionalLightShadow ks = directionalLightShadows[ 0 ];
      sh = receiveShadow ? getShadow( directionalShadowMap[ 0 ], ks.shadowMapSize, ks.shadowIntensity, ks.shadowBias, ks.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
      sh = smoothstep( 0.3, 0.6, sh );
      sh = mix( sh, 1.0, face * 0.6 );
    #endif
    t *= sh;
    col = mix( shadeCol, lit, t ) * uCharLightGain;

    // Subtle ambient tint from the arena (hemisphere).
    vec3 amb = ambientLightColor;
    #if ( NUM_HEMI_LIGHTS > 0 )
      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
        amb += getHemisphereLightIrradiance( hemisphereLights[ i ], normal );
      }
      #pragma unroll_loop_end
    #endif
    col += lit * amb * 0.04 * t;

    // Hard rim mask (silhouette band).
    float rimBase = 1.0 - NdotV;
    float rimHard = smoothstep( 0.6, 0.66, rimBase );
    vec3 rimAcc = vec3( 0.0 );
    #if NUM_DIR_LIGHTS > 0
      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) { {
        vec3 Ld = directionalLights[ i ].direction;
        float back = saturate( -Ld.z * 0.8 + 0.2 );
        float wrap = smoothstep( -0.2, 0.25, dot( normal, Ld ) );
        rimAcc += directionalLights[ i ].color * wrap * back;
      } }
      #pragma unroll_loop_end
    #endif
    #if NUM_SPOT_LIGHTS > 0
      IncidentLight spotIL;
      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) { {
        getSpotLightInfo( spotLights[ i ], - vViewPosition, spotIL );
        float wrapS = smoothstep( -0.2, 0.25, dot( normal, spotIL.direction ) );
        rimAcc += spotIL.color * wrapS * saturate( -spotIL.direction.z * 0.8 + 0.2 ) * 0.5;
      } }
      #pragma unroll_loop_end
    #endif
    // Arena lights only tint the silhouette (clamped: the reactor spots are very bright).
    // Only real curved silhouettes get it: there NdotV changes quickly from pixel to pixel, while a
    // flat panel seen edge-on (a trailing cape) is uniformly grazing and must not turn rim-coloured.
    // Dark materials take less (a black cape shouldn't glow orange).
    float curvedEdge = smoothstep( 0.02, 0.08, fwidth( NdotV ) );
    float albedoK = 0.45 + 0.55 * saturate( dot( lit, vec3( 0.299, 0.587, 0.114 ) ) * 2.5 );
    col += min( rimAcc, vec3( 1.2 ) ) * rimHard * curvedEdge * albedoK * ( matcap > 1.5 ? 0.04 : 0.12 );

    // Blade light: cel-banded coloured light plus a rim kick.
    #if NUM_POINT_LIGHTS > 0
      IncidentLight pointIL;
      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) { {
        getPointLightInfo( pointLights[ i ], - vViewPosition, pointIL );
        float nl = dot( normal, pointIL.direction );
        vec3 pc = min( pointIL.color, vec3( 1.2 ) );
        col += lit * pc * smoothstep( 0.05, 0.2, nl ) * 0.12;
        col += pc * rimHard * smoothstep( -0.3, 0.2, nl ) * 0.03;
      } }
      #pragma unroll_loop_end
    #endif

    // Highlights.
    if ( matcap > 1.5 ) {
      // Hair "angel ring": a crisp band across the crown, facing the camera.
      float ring = smoothstep( 0.34, 0.4, normal.y ) * ( 1.0 - smoothstep( 0.58, 0.64, normal.y ) ) * smoothstep( 0.2, 0.4, NdotV );
      col += ( lit * 1.1 + vec3( 0.07, 0.06, 0.06 ) ) * ring * mix( 0.5, 1.0, t );
    } else if ( matcap > 0.5 ) {
      // Two-tone metal: horizon band in the reflection plus a hard specular glint.
      vec3 R = reflect( - V, normal );
      float horizon = smoothstep( -0.04, 0.04, R.y );
      col *= mix( 0.6, 1.1, horizon );
      vec3 H = normalize( uCharLight + V );
      float spec = smoothstep( 0.96, 0.972, dot( normal, H ) );
      col += ( lit * 2.0 + vec3( 0.25 ) ) * spec * sh;
    }
    // Material rim (toon extras): a narrow hard band, never a glow.
    // (Weaker on hair: thin cards are edge-on and would turn the whole lock rim-coloured.)
    float matRimK = ( matcap > 1.5 ? 0.06 : 0.16 ) * ( 1.0 - 0.6 * t );
    col += matRimC * smoothstep( 0.5, 0.56, pow( rimBase, max( 0.5, matRimP ) * 0.5 ) ) * matRimK;
    // Character rim (game-driven colour / strength).
    // Character rim: a coloured accent on the shaded edges only, so it never haloes the ink line.
    col += uRimColor * uRimStrength * smoothstep( 0.66, 0.72, rimBase ) * ( 1.0 - t ) * ( matcap > 1.5 ? 0.2 : 0.55 );
  }
  // Soft luminance cap: the body never reaches the bloom threshold (only glows and flashes do).
  float L = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
  float knee = uMaxLum * 0.8;
  if ( L > knee ) {
    float Lc = knee + ( uMaxLum - knee ) * ( 1.0 - exp( - ( L - knee ) / ( uMaxLum - knee ) ) );
    col *= Lc / L;
  }
  col = toonInverseACES( col * uDisplayGain );
  // Hit flash (after the cap: a deliberate glow): own colours brighten (hits) or a flat tint (parry, lightning).
  col += uFlashColor * uFlash * mix( lit * 3.0 + 0.03, vec3( 1.0 ), uFlashFlat );

  gl_FragColor = vec4( col, diffuseColor.a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    // Fighters at the fight plane stay nearly haze-free (GG keeps them punchy); the set keeps its full fog.
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor * 0.15 );
  #endif
}
`;

const OUTLINE_VERT = /* glsl */ `
uniform vec2 uRes;
uniform float uWidth;
uniform float uMinPx;
uniform float uMaxPx;
#ifdef OUTLINE_MASK
  attribute float outline;
#endif
#ifdef OUTLINE_VCOLOR
  attribute vec3 outlineColor;
  varying vec3 vOutline;
#endif
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  #include <color_vertex>
  #ifdef OUTLINE_VCOLOR
    vOutline = outlineColor;
  #endif
  #include <morphinstance_vertex>
  #include <morphcolor_vertex>
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  float mask = 1.0;
  #ifdef OUTLINE_MASK
    mask = outline;
  #endif
  // Outward normal in view space (not transformedNormal: FLIP_SIDED would flip it for BackSide).
  vec3 nView = normalize( normalMatrix * objectNormal );
  vec4 clip = gl_Position;
  vec2 dir = ( projectionMatrix * vec4( nView, 0.0 ) ).xy * uRes;
  float dl = length( dir );
  dir = dl > 1e-6 ? dir / dl : vec2( 0.0 );
  // Bold GG-style lines: metric width converted to pixels, clamped to [uMinPx, uMaxPx] at 1080p and scaled
  // with the render size (min side / 1080), then the per-vertex mask (inner lines are thinner).
  float px = uWidth * projectionMatrix[ 1 ][ 1 ] * uRes.y * 0.5 / max( clip.w, 1e-3 );
  float resScale = min( uRes.x, uRes.y ) / 1080.0;
  px = clamp( px, uMinPx * resScale, uMaxPx * resScale ) * mask;
  if ( mask > 0.01 ) px = max( px, 0.85 );
  clip.xy += dir * px * 2.0 / uRes * clip.w;
  // Nudge back a hair so lines never cover the surface they outline.
  clip.z += 0.0004 * clip.w;
  gl_Position = clip;
  #include <fog_vertex>
}
`;

const OUTLINE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uDarken;
uniform float uOpacity;
#ifdef OUTLINE_VCOLOR
  varying vec3 vOutline;
#endif
#include <common>
#include <color_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec3 c = uColor;
  #ifdef USE_COLOR
    // Ink tinted from the surface colour: darker and a touch more saturated, never pure black.
    vec3 s = vColor.rgb;
    float l = dot( s, vec3( 0.299, 0.587, 0.114 ) );
    c = max( mix( vec3( l ), s, 1.35 ), vec3( 0.0 ) ) * uDarken + vec3( 0.012, 0.01, 0.014 );
  #endif
  #ifdef OUTLINE_VCOLOR
    c = vOutline;
  #endif
  // Ink is unlit and stays dark: it never takes light, rim or bloom.
  c = min( c, vec3( 0.3 ) );
  gl_FragColor = vec4( c, uOpacity );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    // Fighters at the fight plane stay nearly haze-free (GG keeps them punchy); the set keeps its full fog.
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor * 0.1 );
  #endif
}
`;

/** Shared outline viewport size (pixels of the current render target). */
const outlineRes = { value: new THREE.Vector2(1280, 720) };
const viewport = new THREE.Vector4();
/** Keep the outline pixel maths in sync with whatever target is being rendered (call per outline mesh). */
export function trackOutlineResolution(mesh: THREE.Object3D): void {
  mesh.onBeforeRender = (renderer) => {
    renderer.getCurrentViewport(viewport);
    outlineRes.value.set(Math.max(1, viewport.z), Math.max(1, viewport.w));
  };
}

/** Global toggles (dev/model-lab). */
export const toonSettings = { outlines: true };

/** One material of a slot draw (toon.ts slot mode). */
export interface ToonSlot {
  color: THREE.Color;
  map: THREE.Texture | null;
  params: ToonParams;
  alphaTest: number;
}

export interface ToonMaterialOptions {
  /** Multi-material draw: per-vertex `slot` attribute selects one of these (max 8). */
  slots?: ToonSlot[];
  /** Per-vertex toon params (attributes `toon` vec4 + `shade` vec3) and vertex colours as albedo. */
  vertexParams?: boolean;
  /** Vertex colours as albedo with uniform toon params (hilts). */
  vertexColors?: boolean;
  params?: Partial<ToonParams>;
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  alphaTest?: number;
  side?: THREE.Side;
  transparent?: boolean;
  depthWrite?: boolean;
  name?: string;
}

/** Defaults by material role. */
export function toonDefaults(role: 'skin' | 'face' | 'cloth' | 'leather' | 'metal' | 'hair' | 'eyes'): ToonParams {
  const base: ToonParams = {
    shadeColor: new THREE.Color(0.55, 0.5, 0.62),
    shadeShift: 0,
    shadeToony: 0.9,
    rimColor: null,
    rimPower: 3,
    outlineWidth: 0.0065,
    outlineColor: new THREE.Color(0.08, 0.06, 0.07),
    matcap: 'none',
    face: false,
    unlit: false,
  };
  if (role === 'skin' || role === 'face') {
    base.shadeColor.setRGB(0.78, 0.5, 0.44);
    base.shadeShift = 0.05;
    base.face = role === 'face';
  } else if (role === 'metal') {
    base.shadeColor.setRGB(0.42, 0.42, 0.48);
    base.matcap = 'metal';
  } else if (role === 'hair') {
    base.shadeColor.setRGB(0.52, 0.42, 0.5);
    base.matcap = 'hair';
  } else if (role === 'leather') {
    base.shadeColor.setRGB(0.55, 0.45, 0.45);
  } else if (role === 'eyes') {
    base.unlit = true;
  }
  return base;
}

export type ToonMaterial = THREE.ShaderMaterial & { isToon: true };

let white: THREE.DataTexture | null = null;
/** 1x1 white texture for slots without a base colour map. */
function whiteTexture(): THREE.DataTexture {
  if (!white) {
    white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;
  }
  return white;
}

export function toonMaterial(rig: ToonRigUniforms, opts: ToonMaterialOptions = {}): ToonMaterial {
  const p = { ...toonDefaults('cloth'), ...(opts.params ?? {}) };
  const uniforms = {
    ...THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]),
    diffuse: { value: new THREE.Color(opts.color ?? 0xffffff) },
    opacity: { value: 1 },
    uAlphaTest: { value: opts.alphaTest ?? 0 },
    uShadeColor: { value: p.shadeColor.clone() },
    uShadeShift: { value: p.shadeShift },
    uShadeToony: { value: p.shadeToony },
    uMatcap: { value: MATCAP_ID[p.matcap] },
    uFace: { value: p.face ? 1 : 0 },
    uUnlit: { value: p.unlit ? 1 : 0 },
    uMatRim: { value: (p.rimColor ?? new THREE.Color(0, 0, 0)).clone() },
    uMatRimPower: { value: p.rimPower },
    uCharLight: { value: CHAR_LIGHT },
    uCharLightGain: { value: 1.0 },
    uMaxLum: { value: 0.88 },
    uDisplayGain: { value: 0.92 },
    uMap: { value: opts.map ?? null },
    // Shared per-rig values (same objects: setRim / setFlash update every toon material of the rig).
    uRimColor: rig.uRimColor,
    uRimStrength: rig.uRimStrength,
    uFlashColor: rig.uFlashColor,
    uFlash: rig.uFlash,
    uFlashFlat: rig.uFlashFlat,
  };
  const defines: Record<string, string> = {};
  if (opts.vertexParams) defines.TOON_VERTEX_PARAMS = '';
  if (opts.map) defines.TOON_MAP = '';
  let frag = FRAG;
  const slots = opts.slots;
  if (slots && slots.length) {
    const n = slots.length;
    defines.TOON_SLOTS = '';
    defines.TOON_SLOT_COUNT = String(n);
    const u = uniforms as Record<string, { value: unknown }>;
    u.uSlotColor = { value: slots.map((sl) => sl.color.clone()) };
    u.uSlotShade = { value: slots.map((sl) => sl.params.shadeColor.clone()) };
    u.uSlotRim = { value: slots.map((sl) => (sl.params.rimColor ?? new THREE.Color(0, 0, 0)).clone()) };
    u.uSlotParams = { value: slots.map((sl) => new THREE.Vector4(sl.params.shadeShift, sl.params.shadeToony, MATCAP_ID[sl.params.matcap], sl.params.face ? 1 : 0)) };
    u.uSlotFlags = { value: slots.map((sl) => new THREE.Vector4(sl.params.unlit ? 1 : 0, sl.alphaTest, sl.params.rimPower, 0)) };
    slots.forEach((sl, i) => {
      u[`uSlotMap${i}`] = { value: sl.map ?? whiteTexture() };
    });
    const samplers = slots.map((_, i) => `uniform sampler2D uSlotMap${i};`).join('\n  ');
    const fetch = slots
      .map((_, i) => `${i ? 'else ' : ''}${i < n - 1 ? `if ( vSlot == ${i} ) ` : ''}texel = textureGrad( uSlotMap${i}, vToonUv, tdx, tdy );`)
      .join('\n    ');
    frag = frag.replace('TOON_SLOT_SAMPLERS', samplers).replace('TOON_SLOT_FETCH', fetch);
  } else {
    frag = frag.replace('TOON_SLOT_SAMPLERS', '').replace('TOON_SLOT_FETCH', '');
  }
  const m = new THREE.ShaderMaterial({
    name: opts.name ?? 'toon',
    uniforms,
    defines,
    vertexShader: VERT,
    fragmentShader: frag,
    lights: true,
    fog: true,
    side: opts.side ?? THREE.FrontSide,
    transparent: opts.transparent ?? false,
    depthWrite: opts.depthWrite ?? true,
  }) as ToonMaterial;
  m.vertexColors = !!(opts.vertexParams || opts.vertexColors);
  m.isToon = true;
  m.userData.toon = p;
  // Shadow casting with alpha cut-outs (hair cards): the depth pass reads map + alphaTest.
  if (opts.map && (opts.alphaTest ?? 0) > 0) {
    (m as unknown as { map: THREE.Texture }).map = opts.map;
    m.alphaTest = opts.alphaTest ?? 0;
  }
  return m;
}

export interface OutlineOptions {
  /** Width in metres at the character (converted to pixels, then clamped to [minPx, maxPx]). */
  width?: number;
  minPx?: number;
  maxPx?: number;
  /** Ink from vertex colours (darkened) instead of a flat colour. */
  fromVertexColor?: boolean;
  /** Per-vertex outline colour attribute `outlineColor` (merged GLB hulls). */
  vertexOutlineColor?: boolean;
  /** Per-vertex `outline` mask attribute. */
  mask?: boolean;
  color?: THREE.ColorRepresentation;
  darken?: number;
}

export function toonOutlineMaterial(opts: OutlineOptions = {}): THREE.ShaderMaterial {
  const defines: Record<string, string> = {};
  if (opts.mask) defines.OUTLINE_MASK = '';
  if (opts.vertexOutlineColor) defines.OUTLINE_VCOLOR = '';
  const m = new THREE.ShaderMaterial({
    name: 'toon-outline',
    uniforms: {
      ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      uRes: outlineRes,
      uWidth: { value: opts.width ?? 0.0065 },
      uMinPx: { value: opts.minPx ?? 3.4 },
      uMaxPx: { value: opts.maxPx ?? 4.2 },
      uColor: { value: new THREE.Color(opts.color ?? 0x140f12) },
      uDarken: { value: opts.darken ?? 0.26 },
      uOpacity: { value: 1 },
    },
    defines,
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    side: THREE.BackSide,
    fog: true,
  });
  m.vertexColors = !!opts.fromVertexColor;
  m.userData.outline = true;
  return m;
}

/** Inverted-hull outline for a (skinned or rigid) mesh: shares geometry and skeleton. */
export function addOutline(mesh: THREE.Mesh, material: THREE.Material): THREE.Mesh {
  let hull: THREE.Mesh;
  const skinned = mesh as THREE.SkinnedMesh;
  if (skinned.isSkinnedMesh) {
    const s = new THREE.SkinnedMesh(skinned.geometry, material);
    s.bind(skinned.skeleton, skinned.bindMatrix);
    s.bindMode = skinned.bindMode;
    hull = s;
  } else {
    hull = new THREE.Mesh(mesh.geometry, material);
  }
  hull.name = `${mesh.name || 'mesh'}-outline`;
  hull.frustumCulled = mesh.frustumCulled;
  hull.castShadow = false;
  hull.receiveShadow = false;
  hull.userData.noShadow = true;
  hull.userData.outline = true;
  hull.renderOrder = mesh.renderOrder;
  if (mesh.morphTargetInfluences) {
    // Morphing parts: the hull follows the same influences array.
    hull.morphTargetInfluences = mesh.morphTargetInfluences;
    hull.morphTargetDictionary = mesh.morphTargetDictionary;
  }
  trackOutlineResolution(hull);
  if (skinned.isSkinnedMesh) {
    hull.position.copy(mesh.position);
    hull.quaternion.copy(mesh.quaternion);
    hull.scale.copy(mesh.scale);
    mesh.parent?.add(hull);
  } else {
    mesh.add(hull);
  }
  return hull;
}

/** Shared hilt material + outline (weapons are vertex-coloured metal). */
const hiltRim: ToonRigUniforms = {
  uRimColor: { value: new THREE.Color(0, 0, 0) },
  uRimStrength: { value: 0 },
  uFlashColor: { value: new THREE.Color(1, 1, 1) },
  uFlash: { value: 0 },
  uFlashFlat: { value: 0 },
};
let hiltOutline: THREE.ShaderMaterial | null = null;
export function hiltOutlineMaterial(): THREE.ShaderMaterial {
  hiltOutline ??= toonOutlineMaterial({ width: 0.002, minPx: 1.1, maxPx: 1.4, fromVertexColor: true, darken: 0.22 });
  return hiltOutline;
}
export function sharedHiltRim(): ToonRigUniforms {
  return hiltRim;
}

/** Per-vertex toon attribute values for procedural bodies. */
export interface VertexToon {
  shift: number;
  toony: number;
  matcap: number;
  face: number;
  /** Shade multiplier applied to the vertex colour. */
  shade: [number, number, number];
  /** Outline width mask (0 = none). */
  outline: number;
}
