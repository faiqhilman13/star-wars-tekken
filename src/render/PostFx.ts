import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.55 },
    uTime: { value: 0 },
    uGrain: { value: 0.035 },
    uImpact: { value: 0 },
    uDarken: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uTime;
    uniform float uGrain;
    uniform float uImpact;
    uniform float uDarken;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 dir = vUv - 0.5;
      // Brief chromatic split on heavy impacts only.
      float ca = uImpact * 0.006;
      vec4 c = texture2D(tDiffuse, vUv);
      if (ca > 0.0001) {
        c.r = texture2D(tDiffuse, vUv + dir * ca).r;
        c.b = texture2D(tDiffuse, vUv - dir * ca).b;
      }
      float d = length(dir * vec2(1.0, 0.82));
      c.rgb *= mix(1.0, 1.0 - smoothstep(0.25, 0.82, d), uVignette);
      // Super freeze: everything but the brightest light sinks.
      float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(c.rgb, c.rgb * smoothstep(0.4, 1.6, lum) * 1.2 + vec3(0.0, 0.0, 0.015), uDarken);
      c.rgb += (hash(vUv * 1024.0 + uTime) - 0.5) * uGrain;
      gl_FragColor = c;
    }
  `,
};

export class PostFx {
  readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly finish: ShaderPass;
  private enabled = true;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    // Threshold above lit-cloth luminance: only blades, lights and VFX bloom (pale robes stay readable).
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.26, 1.0);
    this.composer.addPass(this.bloom);
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number, dpr: number): void {
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);
  }

  setQuality(quality: 'high' | 'low'): void {
    // Toon fighters: a tighter, weaker bloom keeps blade glow without washing the cel-shaded bodies.
    this.bloom.strength = quality === 'high' ? 0.5 : 0.45;
    this.bloom.radius = quality === 'high' ? 0.26 : 0.22;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  update(time: number, impact: number, darken: number, grain: boolean): void {
    const u = this.finish.uniforms;
    u.uTime.value = grain ? time % 100 : 0;
    u.uGrain.value = grain ? 0.03 : 0.0;
    u.uImpact.value = impact;
    u.uDarken.value = darken;
  }

  render(): void {
    if (this.enabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.composer.dispose();
    this.bloom.dispose();
  }
}
