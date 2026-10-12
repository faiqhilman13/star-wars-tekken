/**
 * Saber Duel - procedural audio engine.
 *
 * Every sound is synthesized at runtime with the Web Audio API: no samples, no network.
 * All variation comes from the injected seeded RNG (never Math.random).
 *
 * Graph
 *   one-shot voices --> sfxBus -----------------------------+
 *          \--> reverb send --> convolver --> reverbOut --+  |
 *   saber hums   --> humBus --+                           |  |
 *   reactor bed  --> ambBus --+--> duckBus --> gameplayBus <-+
 *   tension pulse--> musicBus-+                 |         |
 *                                               v         v
 *   UI + announcer stingers --> uiBus -------> mix (sum) <-+
 *   mix --> DynamicsCompressor (limiter) --> soft clipper --> pauseGain --> masterGain (volume*mute) --> destination
 *
 * setDuck() scales duckBus (hum + ambience + tension), setPaused() scales gameplayBus (UI stays audible),
 * suspend()/resume() fade pauseGain and suspend the AudioContext itself.
 */

export type FighterIndex = 0 | 1;
export type AudioGroup = 'sfx' | 'hum' | 'ambience' | 'music' | 'ui';
/** kael = single blue blade, vexa = single red blade, asha = dual sabers, thane = saberstaff. */
export type HumStyle = 'kael' | 'vexa' | 'asha' | 'thane';

export interface AudioEngineOptions {
  /** Inject a context (e.g. an OfflineAudioContext for level measurement). An injected context is never closed. */
  context?: BaseAudioContext;
}

export interface OfflineEvent {
  /** Seconds from the start of the render. */
  at: number;
  run: (engine: AudioEngine) => void;
}

export interface LevelStats {
  peak: number;
  peakDb: number;
  rms: number;
  rmsDb: number;
  /** Loudest 50 ms window RMS (momentary loudness). */
  maxMomentaryRms: number;
  maxMomentaryRmsDb: number;
}

export interface AudioDebugState {
  hasContext: boolean;
  contextState: string;
  unlocked: boolean;
  muted: boolean;
  volume: number;
  duck: number;
  intensity: number;
  ambience: boolean;
  paused: boolean;
  suspended: boolean;
  activeVoices: number;
  humOn: [boolean, boolean];
  humStyles: [HumStyle, HumStyle];
  grip: boolean;
  lightning: boolean;
  spinningBlade: boolean;
  steamHisses: number;
  tensionBeats: number;
}

// ---------------------------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------------------------

const LOOKAHEAD = 0.005; // s added to currentTime so attack ramps are never scheduled in the past
const MAX_VOICES = 40; // concurrent non-critical one-shots
const PAN_SCALE = 0.7;
const DETUNE_PAIR: readonly number[] = [-8, 8];
const MIX_LEVEL = 0.62; // sum of everything into the limiter

/**
 * Hum character per style. Every hum voice owns 6 oscillators: blade A = [0..2], blade B = [3..5].
 * Single-blade styles keep blade B silent (blade2 = 0). `level` is the per-voice gain before the limiter,
 * calibrated so every style idles near -33 dBFS RMS.
 */
interface HumStyleDef {
  f: number;
  types: readonly OscillatorType[];
  ratios: readonly number[];
  gains: readonly number[];
  blade2: number;
  phaseRate: number;
  phaseCents: number;
  lp: number;
  q: number;
  wobble: number;
  wobbleDepth: number;
  lfoRate: number;
  drift: number;
  hp: number;
  buzz: number;
  rough: number;
  level: number;
  igniteGap: number;
}

const HUM_STYLES: Record<HumStyle, HumStyleDef> = {
  // KAEL: clean blue blade, 108 Hz.
  kael: {
    f: 108,
    types: ['sawtooth', 'sawtooth', 'triangle', 'sawtooth', 'sawtooth', 'triangle'],
    ratios: [1, 1.0065, 2, 1, 1.0065, 2],
    gains: [0.5, 0.45, 0.22, 0.5, 0.45, 0.22],
    blade2: 0,
    phaseRate: 0.5,
    phaseCents: 0,
    lp: 470,
    q: 2.4,
    wobble: 0.86,
    wobbleDepth: 0.12,
    lfoRate: 15.5,
    drift: 0.55,
    hp: 2300,
    buzz: 0.3,
    rough: 0,
    level: 0.11,
    igniteGap: 0,
  },
  // VEXA: lower, rougher red blade (saturated, resonant), 92 Hz.
  vexa: {
    f: 92,
    types: ['sawtooth', 'sawtooth', 'square', 'sawtooth', 'sawtooth', 'square'],
    ratios: [1, 0.9875, 0.5, 1, 0.9875, 0.5],
    gains: [0.5, 0.45, 0.14, 0.5, 0.45, 0.14],
    blade2: 0,
    phaseRate: 0.5,
    phaseCents: 0,
    lp: 390,
    q: 4.2,
    wobble: 0.8,
    wobbleDepth: 0.18,
    lfoRate: 18.5,
    drift: 0.8,
    hp: 1800,
    buzz: 0.4,
    rough: 1,
    level: 0.08,
    igniteGap: 0,
  },
  // ASHA: dual sabers - brighter/higher, second blade detuned ~+16 cents with a faint shimmer.
  asha: {
    f: 118,
    types: ['sawtooth', 'sawtooth', 'triangle', 'sawtooth', 'sawtooth', 'triangle'],
    ratios: [1, 1.005, 2, 1.0095, 1.0145, 2.018],
    gains: [0.5, 0.42, 0.2, 0.5, 0.42, 0.2],
    blade2: 0.7,
    phaseRate: 0.9,
    phaseCents: 4,
    lp: 560,
    q: 2.2,
    wobble: 0.86,
    wobbleDepth: 0.12,
    lfoRate: 16.5,
    drift: 0.6,
    hp: 2500,
    buzz: 0.34,
    rough: 0,
    level: 0.09,
    igniteGap: 0.07,
  },
  // THANE: saberstaff - deeper, two blades phasing slowly against each other.
  thane: {
    f: 84,
    types: ['sawtooth', 'sawtooth', 'square', 'sawtooth', 'sawtooth', 'square'],
    ratios: [1, 1.006, 0.5, 1.0035, 1.0095, 0.5017],
    gains: [0.5, 0.45, 0.12, 0.5, 0.45, 0.12],
    blade2: 0.85,
    phaseRate: 0.28,
    phaseCents: 14,
    lp: 360,
    q: 3.4,
    wobble: 0.84,
    wobbleDepth: 0.15,
    lfoRate: 13.5,
    drift: 0.4,
    hp: 1900,
    buzz: 0.32,
    rough: 0.35,
    level: 0.085,
    igniteGap: 0.15,
  },
};

const DEFAULT_STYLES: readonly HumStyle[] = ['kael', 'vexa'];

const GROUP_LEVEL: Record<AudioGroup, number> = {
  sfx: 1,
  hum: 1,
  ambience: 0.42,
  music: 0.55,
  ui: 1,
};

const WHITE = 0;
const PINK = 1;
const BROWN = 2;
const CRACKLE = 3;

const RING_PLATE: readonly number[] = [1, 2.76, 5.4, 8.93, 1.47];
const RING_PLATE_G: readonly number[] = [0.16, 0.09, 0.05, 0.03, 0.07];
const RING_PLATE_D: readonly number[] = [1.1, 0.75, 0.5, 0.32, 0.9];
const RING_GUARD: readonly number[] = [1, 1.51, 2.37, 3.11];
const RING_GUARD_G: readonly number[] = [0.2, 0.12, 0.09, 0.045];
const RING_GUARD_D: readonly number[] = [0.42, 0.32, 0.24, 0.16];
const RING_FLOOR: readonly number[] = [1, 2.32, 4.25, 6.63];
const RING_FLOOR_G: readonly number[] = [0.1, 0.07, 0.04, 0.025];
const RING_FLOOR_D: readonly number[] = [0.7, 0.5, 0.35, 0.22];
const RING_BELL: readonly number[] = [1, 2, 2.76, 4.07, 5.4];
const RING_BELL_G: readonly number[] = [0.13, 0.07, 0.06, 0.03, 0.02];
const RING_BELL_D: readonly number[] = [3.2, 2.4, 1.8, 1.2, 0.9];

// Parry "shing": inharmonic partials spanning ~2.1-5.2 kHz, long crystalline decay.
const RING_PARRY: readonly number[] = [1, 1.0014, 1.34, 1.79, 2.41, 1.13];
const RING_PARRY_G: readonly number[] = [0.28, 0.18, 0.22, 0.16, 0.09, 0.13];
const RING_PARRY_D: readonly number[] = [0.8, 0.75, 0.62, 0.5, 0.35, 0.68];
const RING_CLANK: readonly number[] = [1, 1.73, 2.61, 3.9];
const RING_CLANK_G: readonly number[] = [0.18, 0.12, 0.08, 0.05];
const RING_CLANK_D: readonly number[] = [0.3, 0.22, 0.16, 0.1];
const RING_FLOOR_SOFT_G: readonly number[] = [0.05, 0.035, 0.02, 0.012];
const RING_FLOOR_SOFT_D: readonly number[] = [0.45, 0.32, 0.22, 0.15];

const CHORD_ROUND: readonly number[] = [0, 7, 12, 19];
const CHORD_PICKUP: readonly number[] = [0, 7, 12];
const CHORD_FIGHT: readonly number[] = [0, 7, 12, 16, 19];
const CHORD_VICTORY: readonly number[] = [-12, 0, 4, 7, 12];
const PHRASE_VICTORY: readonly number[] = [0, 4, 7];
const CHORD_MINOR: readonly number[] = [0, 3, 7, 12];
const CHORD_LOW: readonly number[] = [-12, 0, 7];
const CHORD_OCT: readonly number[] = [0, 12];
const CHORD_VERSUS: readonly number[] = [-12, 0, 3, 7, 12];
const ARP_ASHA: readonly number[] = [0, 4, 7, 12];

// ---------------------------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------------------------

interface Voice {
  ctx: BaseAudioContext;
  t: number;
  out: GainNode;
  nodes: AudioNode[];
  last: AudioScheduledSourceNode | null;
  end: number;
}

interface HumVoice {
  style: HumStyle;
  oscs: OscillatorNode[]; // 6: blade A [0..2], blade B [3..5]
  oscGains: GainNode[];
  freqs: number[]; // mutated in place by setHumStyle (no per-frame allocation)
  bladeB: GainNode;
  phaseLfo: OscillatorNode;
  phaseDepth: GainNode;
  clean: GainNode;
  rough: GainNode;
  lp: BiquadFilterNode;
  lpBase: number;
  wobble: GainNode;
  lfoDepth: GainNode;
  drift: OscillatorNode;
  driftDepth: GainNode;
  hp: BiquadFilterNode;
  buzz: GainNode;
  buzzBase: number;
  lfo: OscillatorNode;
  lfoRate: number;
  speed: GainNode;
  level: number;
  gate: GainNode;
  pan: StereoPannerNode;
  sweep: ConstantSourceNode;
  on: boolean;
  lockUntil: number;
  lastS: number;
  lastPan: number;
}

/** A persistent continuous effect (grip, lightning, spinning blade): built once on first use, then gated. */
interface LoopVoice {
  gate: GainNode;
  pan: StereoPannerNode;
  level: number;
  tauIn: number;
  tauOut: number;
  active: boolean;
  lastPan: number;
}

interface SpinLoop extends LoopVoice {
  lfo: OscillatorNode;
  lastRate: number;
}

interface Ambience {
  gate: GainNode;
  active: boolean;
}

// ---------------------------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------------------------

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function panFor(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const p = x / 9;
  return (p < -1 ? -1 : p > 1 ? 1 : p) * PAN_SCALE;
}

function toDb(v: number): number {
  return 20 * Math.log10(v > 1e-9 ? v : 1e-9);
}

/** mulberry32 - only used to fill noise/IR buffers from a single draw of the injected RNG. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Freeze a param at its current value so new automation starts from where it is (no jumps). */
function holdParam(p: AudioParam, t: number): void {
  const v = p.value;
  p.cancelScheduledValues(t);
  p.setValueAtTime(v, t);
}

/** Attack then exponential decay; `decay` is the time to fall 60 dB. Returns the end time. */
function envAD(p: AudioParam, t: number, peak: number, attack: number, decay: number): number {
  const a = attack < 0.001 ? 0.001 : attack;
  const end = t + a + decay;
  p.setValueAtTime(0, t);
  if (!(peak > 0)) return end;
  p.linearRampToValueAtTime(peak, t + a);
  p.exponentialRampToValueAtTime(peak * 0.001, end);
  p.setValueAtTime(0, end);
  return end;
}

/** Attack, hold, exponential release (60 dB). Returns the end time. */
function envAHR(p: AudioParam, t: number, peak: number, attack: number, hold: number, release: number): number {
  const a = attack < 0.001 ? 0.001 : attack;
  const end = t + a + hold + release;
  p.setValueAtTime(0, t);
  if (!(peak > 0)) return end;
  p.linearRampToValueAtTime(peak, t + a);
  p.setValueAtTime(peak, t + a + hold);
  p.exponentialRampToValueAtTime(peak * 0.001, end);
  p.setValueAtTime(0, end);
  return end;
}

/** Exponential rise from silence (a "reverse" swell) followed by a short cut. Returns the end time. */
function envSwell(p: AudioParam, t: number, peak: number, rise: number, cut: number): number {
  p.setValueAtTime(peak * 0.001, t);
  p.exponentialRampToValueAtTime(peak, t + rise);
  p.linearRampToValueAtTime(0, t + rise + cut);
  return t + rise + cut;
}

function sweepExp(p: AudioParam, t: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(from, t);
  p.exponentialRampToValueAtTime(to, t + dur);
}

/** Set a param now (tau <= 0) or glide to it with a time constant. */
function glide(p: AudioParam, v: number, t: number, tau: number): void {
  if (tau <= 0) {
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
  } else {
    p.setTargetAtTime(v, t, tau);
  }
}

/** Half-wave rectifier with a slight expansion: turns noise into a bursty positive envelope. */
function makeRectifierCurve(): Float32Array<ArrayBuffer> {
  const n = 1025;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = x <= 0 ? 0 : Math.pow(x, 1.3);
  }
  return curve;
}

function makeDriveCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 2049;
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

/**
 * Safety soft clipper. Fed through a 0.5 pre-gain, so curve input u in [-1,1] represents signal v = 2u in [-2,2].
 * Unity gain for |v| <= 0.9, smooth knee to a hard ceiling of 0.995 - output can never exceed 1.0.
 */
function makeSoftClipCurve(): Float32Array<ArrayBuffer> {
  const n = 8193;
  const curve = new Float32Array(n);
  const knee = 0.9;
  const room = 0.095;
  for (let i = 0; i < n; i++) {
    const v = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(v);
    const y = a <= knee ? a : knee + room * Math.tanh((a - knee) / room);
    curve[i] = v < 0 ? -y : y;
  }
  return curve;
}

function normalizeRms(data: Float32Array, target: number): void {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / data.length);
  const k = rms > 0 ? target / rms : 1;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] * k;
    data[i] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
}

function makeNoiseBuffers(ctx: BaseAudioContext, r: () => number): AudioBuffer[] {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 2);

  const white = ctx.createBuffer(1, len, sr);
  const w = white.getChannelData(0);
  for (let i = 0; i < len; i++) w[i] = r() * 2 - 1;
  normalizeRms(w, 0.3);

  // Paul Kellet's refined pink filter.
  const pink = ctx.createBuffer(1, len, sr);
  const pk = pink.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < len; i++) {
    const x = r() * 2 - 1;
    b0 = 0.99886 * b0 + x * 0.0555179;
    b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522;
    b5 = -0.7616 * b5 - x * 0.016898;
    pk[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362;
    b6 = x * 0.115926;
  }
  normalizeRms(pk, 0.3);

  // Brown: leaky integrator, then detrended so the loop seam is continuous (no click every 2 s).
  const brown = ctx.createBuffer(1, len, sr);
  const br = brown.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (r() * 2 - 1)) / 1.02;
    br[i] = last;
  }
  const drift = br[len - 1] - br[0];
  let mean = 0;
  for (let i = 0; i < len; i++) {
    br[i] -= (drift * i) / (len - 1);
    mean += br[i];
  }
  mean /= len;
  for (let i = 0; i < len; i++) br[i] -= mean;
  normalizeRms(br, 0.3);

  // Crackle: bursty sparse sparks (short ringing clicks) over a faint hiss bed.
  const crackle = ctx.createBuffer(1, len, sr);
  const cr = crackle.getChannelData(0);
  let density = 0.5;
  let spark = 0;
  let sparkDecay = 0;
  let sparkSign = 1;
  for (let i = 0; i < len; i++) {
    if ((i & 255) === 0) density = 0.15 + 0.85 * r();
    if (r() < 0.0035 * density) {
      spark = (0.35 + 0.65 * r()) * (r() < 0.5 ? -1 : 1);
      sparkDecay = 0.55 + 0.4 * r();
      sparkSign = -1;
    }
    cr[i] = spark + (r() * 2 - 1) * 0.025;
    spark *= sparkDecay * sparkSign;
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(cr[i]));
  if (peak > 0) for (let i = 0; i < len; i++) cr[i] /= peak;

  return [white, pink, brown, crackle];
}

/** Short metallic-hall impulse response: pre-delay, a few catwalk reflections, darkening noise tail. */
function makeReverbIR(ctx: BaseAudioContext, r: () => number): AudioBuffer {
  const sr = ctx.sampleRate;
  const dur = 1.5;
  const len = Math.floor(sr * dur);
  const ir = ctx.createBuffer(2, len, sr);
  const taps = [0.011, 0.017, 0.023, 0.031, 0.043, 0.058];
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    const pre = Math.floor(sr * 0.008);
    let y = 0;
    for (let i = pre; i < len; i++) {
      const t = i / sr;
      const x = (r() * 2 - 1) * Math.exp(-t / 0.32);
      const a = 0.85 - 0.7 * (t / dur);
      y += a * (x - y);
      d[i] = y;
    }
    for (let k = 0; k < taps.length; k++) {
      const idx = Math.floor(sr * (taps[k] + c * 0.0013 * (k + 1)));
      if (idx < len) d[idx] += (k % 2 === 0 ? 1 : -1) * (0.5 - k * 0.06);
    }
  }
  return ir;
}

function createRealtimeContext(): AudioContext | null {
  const g = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor({ latencyHint: 'interactive' });
  } catch {
    try {
      return new Ctor();
    } catch {
      return null;
    }
  }
}

function isOfflineContext(ctx: BaseAudioContext): boolean {
  return typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
}

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------

export class AudioEngine {
  private readonly rng: () => number;
  private readonly injected: BaseAudioContext | null;

  private ctx: BaseAudioContext | null = null;
  private realtime: AudioContext | null = null;
  private ownsContext = false;
  private offline = false;
  private built = false;
  private unlockedFlag = false;
  private disposed = false;
  private userSuspended = false;
  private unlockPending: Promise<void> | null = null;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private pumpTimer: ReturnType<typeof setInterval> | null = null;

  // Settings that persist from before unlock.
  private muted = false;
  private volume = 1;
  private duck = 1;
  private paused = false;
  private ambienceWanted = false;
  private intensity = 0;
  private readonly groupVolume: Record<AudioGroup, number> = { sfx: 1, hum: 1, ambience: 1, music: 1, ui: 1 };
  private readonly humStyles: HumStyle[] = [DEFAULT_STYLES[0], DEFAULT_STYLES[1]];

  // Graph.
  private masterGain: GainNode | null = null;
  private pauseGain: GainNode | null = null;
  private gameplayBus: GainNode | null = null;
  private duckBus: GainNode | null = null;
  /** Internal sidechain ducks used by parry() so it cuts through (independent from setDuck). */
  private sfxDuck: GainNode | null = null;
  private bedDuck: GainNode | null = null;
  /** Un-ducked sfx path for priority sounds (parry). Follows the sfx group volume. */
  private priorityBus: GainNode | null = null;
  private buses: Record<AudioGroup, GainNode> | null = null;
  private grip: LoopVoice | null = null;
  private lightning: LoopVoice | null = null;
  private spin: SpinLoop | null = null;
  private reverbIn: GainNode | null = null;
  private noise: AudioBuffer[] = [];
  private driveCurve: Float32Array<ArrayBuffer> | null = null;
  private hums: HumVoice[] = [];
  private amb: Ambience | null = null;
  private persistent: AudioScheduledSourceNode[] = [];

  private activeVoices = 0;
  private readonly lastPlayed = new Map<string, number>();
  private nextHiss = 0;
  private nextBeat = 0;
  private hissCount = 0;
  private beatCount = 0;

  constructor(rng: () => number, options?: AudioEngineOptions) {
    this.rng = rng;
    this.injected = options?.context ?? null;
  }

  // -------------------------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------------------------

  get unlocked(): boolean {
    return this.unlockedFlag && !this.disposed;
  }

  /** Create/resume the AudioContext. Call from a user gesture; safe to call repeatedly. */
  unlock(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.unlockPending) return this.unlockPending;
    if (!this.ctx) {
      const ctx = this.injected ?? createRealtimeContext();
      if (!ctx) return Promise.resolve();
      this.ctx = ctx;
      this.ownsContext = this.injected === null;
      this.offline = isOfflineContext(ctx);
      this.realtime = this.offline ? null : (ctx as AudioContext);
      try {
        this.build(ctx);
      } catch {
        this.teardownGraph();
        if (this.ownsContext && this.realtime) void this.realtime.close().catch(() => undefined);
        this.ctx = null;
        this.realtime = null;
        return Promise.resolve();
      }
      if (this.realtime) {
        const rt = this.realtime;
        rt.onstatechange = () => {
          if (rt.state === 'running' && this.built && !this.disposed) {
            this.markUnlocked();
            this.applyPauseGain();
          }
        };
      }
    }
    if (this.offline) {
      this.markUnlocked();
      return Promise.resolve();
    }
    const rt = this.realtime;
    if (!rt) return Promise.resolve();
    this.kickSilentBuffer(rt);
    if (rt.state === 'running') {
      this.markUnlocked();
      this.applyPauseGain();
      return Promise.resolve();
    }
    if (this.userSuspended || rt.state === 'closed') return Promise.resolve();
    let resumed: Promise<void>;
    try {
      resumed = rt.resume();
    } catch {
      return Promise.resolve();
    }
    const pending = resumed
      .then(
        () => {
          if (rt.state === 'running') {
            this.markUnlocked();
            this.applyPauseGain();
          }
        },
        () => undefined,
      )
      .finally(() => {
        this.unlockPending = null;
      });
    this.unlockPending = pending;
    return pending;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMaster();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMasterVolume(v: number): void {
    this.volume = clamp01(v);
    this.applyMaster();
  }

  /** Extra: per-group volume 0..1 (settings menu). */
  setGroupVolume(group: AudioGroup, v: number): void {
    this.groupVolume[group] = clamp01(v);
    const b = this.buses;
    const ctx = this.ctx;
    if (!b || !ctx) return;
    b[group].gain.setTargetAtTime(GROUP_LEVEL[group] * this.groupVolume[group], ctx.currentTime, 0.02);
    if (group === 'sfx' && this.priorityBus) {
      this.priorityBus.gain.setTargetAtTime(GROUP_LEVEL.sfx * this.groupVolume.sfx, ctx.currentTime, 0.02);
    }
  }

  /** 0..1 multiplier on hum + ambience (+ tension pulse). ~60 ms smooth ramp. */
  setDuck(amount: number): void {
    const a = clamp01(amount);
    if (Math.abs(a - this.duck) < 0.0005) return;
    this.duck = a;
    const ctx = this.ctx;
    if (!ctx || !this.duckBus) return;
    this.duckBus.gain.setTargetAtTime(a, ctx.currentTime, 0.02);
  }

  /**
   * Extra: pause-menu helper. Fades every gameplay bus (sfx, hum, ambience, tension) but keeps the UI bus
   * audible so menu navigation sounds still play. Independent from suspend()/resume().
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
    const ctx = this.ctx;
    if (!ctx || !this.gameplayBus) return;
    this.gameplayBus.gain.setTargetAtTime(paused ? 0 : 1, ctx.currentTime, 0.04);
  }

  /** Silence everything (tab hidden / hard pause). State is kept; one-shots are dropped while suspended. */
  suspend(): void {
    if (this.userSuspended || this.disposed) return;
    this.userSuspended = true;
    const ctx = this.ctx;
    if (!ctx || !this.pauseGain) return;
    holdParam(this.pauseGain.gain, ctx.currentTime);
    this.pauseGain.gain.setTargetAtTime(0, ctx.currentTime, 0.012);
    const rt = this.realtime;
    if (!rt) return;
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      if (this.userSuspended && rt.state === 'running') void rt.suspend().catch(() => undefined);
    }, 80);
  }

  resume(): void {
    if (!this.userSuspended || this.disposed) return;
    this.userSuspended = false;
    if (this.suspendTimer !== null) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
    const ctx = this.ctx;
    if (!ctx || !this.pauseGain) return;
    const fadeIn = (): void => {
      if (this.userSuspended || !this.pauseGain || !this.ctx) return;
      holdParam(this.pauseGain.gain, this.ctx.currentTime);
      this.pauseGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.02);
    };
    const rt = this.realtime;
    if (rt && rt.state === 'suspended') {
      rt.resume().then(() => {
        if (rt.state === 'running') this.markUnlocked();
        fadeIn();
      }, () => undefined);
    } else {
      fadeIn();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopPump();
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    this.teardownGraph();
    if (this.realtime) this.realtime.onstatechange = null;
    if (this.ownsContext && this.realtime && this.realtime.state !== 'closed') {
      void this.realtime.close().catch(() => undefined);
    }
    this.ctx = null;
    this.realtime = null;
    this.unlockedFlag = false;
  }

  /** Extra: snapshot for tests / debug overlays. */
  getDebugState(): AudioDebugState {
    return {
      hasContext: this.ctx !== null,
      contextState: this.ctx ? this.ctx.state : 'none',
      unlocked: this.unlocked,
      muted: this.muted,
      volume: this.volume,
      duck: this.duck,
      intensity: this.intensity,
      ambience: this.ambienceWanted,
      paused: this.paused,
      suspended: this.userSuspended,
      activeVoices: this.activeVoices,
      humOn: [this.hums[0]?.on ?? false, this.hums[1]?.on ?? false],
      humStyles: [this.humStyles[0], this.humStyles[1]],
      grip: this.grip?.active ?? false,
      lightning: this.lightning?.active ?? false,
      spinningBlade: this.spin?.active ?? false,
      steamHisses: this.hissCount,
      tensionBeats: this.beatCount,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Saber hum (continuous)
  // -------------------------------------------------------------------------------------------

  /** Call every rendered frame per fighter. Allocation-free; only touches params when values move. */
  updateSaber(i: FighterIndex, on: boolean, x: number, tipSpeed: number): void {
    const h = this.hums[i];
    const ctx = this.ctx;
    if (h === undefined || ctx === null || this.disposed) return;
    const now = ctx.currentTime;
    if (on !== h.on && now >= h.lockUntil) {
      h.on = on;
      holdParam(h.gate.gain, now);
      if (on) {
        h.gate.gain.setTargetAtTime(1, now, 0.03);
        holdParam(h.sweep.offset, now);
        h.sweep.offset.setTargetAtTime(0, now, 0.03);
      } else {
        h.gate.gain.setTargetAtTime(0, now, 0.04);
      }
    }
    const pan = panFor(x);
    if (pan - h.lastPan > 0.004 || h.lastPan - pan > 0.004) {
      h.lastPan = pan;
      h.pan.pan.setTargetAtTime(pan, now, 0.03);
    }
    let s = ((Number.isFinite(tipSpeed) ? tipSpeed : 0) - 1.5) / 21;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    s = s * (2 - s); // ease-out: medium swings already swell
    const ds = s - h.lastS;
    if (ds > 0.006 || ds < -0.006 || (s === 0 && h.lastS !== 0)) {
      const tau = ds > 0 ? 0.012 : 0.05; // fast swell, slower tail
      h.lastS = s;
      const k = 1 + 0.4 * s;
      for (let j = 0; j < h.oscs.length; j++) h.oscs[j].frequency.setTargetAtTime(h.freqs[j] * k, now, tau);
      h.lp.frequency.setTargetAtTime(h.lpBase * (1 + 2.6 * s), now, tau);
      h.speed.gain.setTargetAtTime(h.level * (1 + 2.3 * s), now, tau);
      h.buzz.gain.setTargetAtTime(h.buzzBase * (1 + 2.5 * s), now, tau);
      h.lfo.frequency.setTargetAtTime(h.lfoRate * (1 + 0.45 * s), now, tau);
    }
  }

  /**
   * Extra (4-fighter roster): hum character for fighter slot i. kael/vexa = single blade, asha = dual sabers,
   * thane = saberstaff. Safe before unlock (applied when the graph is built). Call on character select,
   * not per frame (switching oscillator shapes mid-hum can click).
   */
  setHumStyle(i: FighterIndex, style: HumStyle): void {
    if ((i !== 0 && i !== 1) || !Object.prototype.hasOwnProperty.call(HUM_STYLES, style)) return;
    this.humStyles[i] = style;
    const h = this.hums[i];
    const ctx = this.ctx;
    if (!h || !ctx || this.disposed) return;
    this.applyHumStyle(h, style, ctx.currentTime, false);
  }

  /**
   * Ignition in the fighter's hum style: snap + hiss + rising tone that hands over to the hum.
   * asha fires two snaps ~70 ms apart; thane two snaps ~150 ms apart (one end of the staff, then the other).
   */
  ignite(i: FighterIndex, x: number): void {
    const def = HUM_STYLES[this.humStyles[i]];
    const gap = def.igniteGap;
    const h = this.hums[i];
    const ctx = this.ctx;
    if (h && ctx && this.ready()) {
      const now = ctx.currentTime + LOOKAHEAD;
      if (!h.on) {
        holdParam(h.sweep.offset, now);
        h.sweep.offset.setValueAtTime(-1900, now);
        h.sweep.offset.linearRampToValueAtTime(80, now + 0.17);
        h.sweep.offset.setTargetAtTime(0, now + 0.17, 0.06);
      }
      if (gap > 0) {
        // second blade joins the hum when it ignites
        h.bladeB.gain.cancelScheduledValues(now);
        h.bladeB.gain.setValueAtTime(0, now);
        h.bladeB.gain.setValueAtTime(0, now + gap);
        h.bladeB.gain.linearRampToValueAtTime(def.blade2, now + gap + 0.08);
      }
      holdParam(h.gate.gain, now);
      h.gate.gain.linearRampToValueAtTime(1.3, now + 0.15);
      h.gate.gain.setTargetAtTime(1, now + 0.15, 0.1);
      h.lastPan = panFor(x);
      h.pan.pan.setValueAtTime(h.lastPan, now);
      h.on = true;
      h.lockUntil = now + 0.45 + gap;
    }
    const v = this.begin(i === 0 ? 'ignite0' : 'ignite1', 0.1, x, 0.85 * this.gainVar(), 0.25, null, true);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const f = def.f * p;
    const blades = gap > 0 ? 2 : 1;
    for (let b = 0; b < blades; b++) {
      const tb = t + b * gap;
      const lvl = (b === 0 ? 1 : 0.85) / (blades === 2 ? 1.15 : 1);
      // saberstaff: one end, then the other
      const dest = gap > 0.1 ? this.panNode(v, b === 0 ? -0.3 : 0.3, v.out) : v.out;
      const fb = f * (b === 0 ? 1 : 1.012);
      // snap
      const g1 = this.gain(v, dest);
      const e1 = envAD(g1.gain, tb, 0.9 * lvl, 0.001, 0.06);
      this.noiseSrc(v, WHITE, tb, e1 + 0.01, this.filter(v, 'bandpass', 2800 * p * (b === 0 ? 1 : 1.18), 0.9, g1));
      // crackle accent
      const g2 = this.gain(v, dest);
      const e2 = envAD(g2.gain, tb, 0.55 * lvl, 0.002, 0.28);
      this.noiseSrc(v, CRACKLE, tb, e2 + 0.01, this.filter(v, 'highpass', 1500, 0.7, g2));
      // rising tone into the hum
      const g4 = this.gain(v, dest);
      const e4 = envAHR(g4.gain, tb, 0.32 * lvl, 0.03, 0.16, 0.4);
      const lp = this.filter(v, 'lowpass', 250, 4, g4);
      lp.frequency.setValueAtTime(250, tb);
      lp.frequency.exponentialRampToValueAtTime(2400, tb + 0.16);
      lp.frequency.exponentialRampToValueAtTime(650, tb + 0.5);
      for (let k = 0; k < DETUNE_PAIR.length; k++) {
        const o = this.osc(v, 'sawtooth', fb * 0.3, tb, e4 + 0.02, lp);
        o.detune.value = DETUNE_PAIR[k];
        o.frequency.exponentialRampToValueAtTime(fb * 1.15, tb + 0.16);
        o.frequency.exponentialRampToValueAtTime(fb, tb + 0.45);
      }
    }
    // hiss sweeping down (one, stretched across both ignitions)
    const g3 = this.gain(v, v.out);
    const e3 = envAHR(g3.gain, t, 0.4, 0.01, 0.06 + gap, 0.42);
    const bp3 = this.filter(v, 'bandpass', 5000, 0.8, g3);
    sweepExp(bp3.frequency, t, 5200 * p, 1100 * p, 0.42 + gap);
    this.noiseSrc(v, WHITE, t, e3 + 0.01, bp3);
    this.end(v);
  }

  /** Descending power-down; the hum pitch-drops and fades with it. */
  retract(i: FighterIndex, x: number): void {
    const def = HUM_STYLES[this.humStyles[i]];
    const h = this.hums[i];
    const ctx = this.ctx;
    if (h && ctx && this.ready()) {
      const now = ctx.currentTime + LOOKAHEAD;
      holdParam(h.gate.gain, now);
      h.gate.gain.setTargetAtTime(0, now, 0.1);
      holdParam(h.sweep.offset, now);
      h.sweep.offset.linearRampToValueAtTime(-1800, now + 0.45);
      h.on = false;
      h.lockUntil = now + 0.5;
    }
    const v = this.begin(i === 0 ? 'retract0' : 'retract1', 0.1, x, 0.75 * this.gainVar(), 0.22, null, true);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const f = def.f * p;
    const g = this.gain(v, v.out);
    const e = envAHR(g.gain, t, 0.3, 0.01, 0.14 + def.igniteGap * 0.5, 0.38);
    const lp = this.filter(v, 'lowpass', 1800, 5, g);
    sweepExp(lp.frequency, t, 1800, 160, 0.5);
    for (let k = 0; k < DETUNE_PAIR.length; k++) {
      const o = this.osc(v, 'sawtooth', f * 1.1, t, e + 0.02, lp);
      o.detune.value = DETUNE_PAIR[k];
      o.frequency.exponentialRampToValueAtTime(f * 0.25, t + 0.5);
    }
    if (def.blade2 > 0) {
      // second blade powers down a beat later
      const t2 = t + Math.max(0.04, def.igniteGap * 0.5);
      const o2 = this.osc(v, 'sawtooth', f * 1.13, t2, e + 0.02, lp);
      o2.frequency.exponentialRampToValueAtTime(f * 0.27, t2 + 0.5);
    }
    const gh = this.gain(v, v.out);
    const eh = envAD(gh.gain, t, 0.22, 0.005, 0.4);
    const bp = this.filter(v, 'bandpass', 3000, 0.9, gh);
    sweepExp(bp.frequency, t, 3200 * p, 650 * p, 0.4);
    this.noiseSrc(v, WHITE, t, eh + 0.01, bp);
    const gt = this.gain(v, v.out);
    const et = envAD(gt.gain, t + 0.36, 0.25, 0.004, 0.14);
    const ot = this.osc(v, 'sine', 85 * p, t + 0.36, et + 0.01, gt);
    ot.frequency.exponentialRampToValueAtTime(40 * p, t + 0.48);
    this.end(v);
  }

  // -------------------------------------------------------------------------------------------
  // Combat one-shots
  // -------------------------------------------------------------------------------------------

  swing(i: FighterIndex, strength: number, x: number): void {
    const st = clamp01(strength);
    const v = this.begin(i === 0 ? 'swing0' : 'swing1', 0.04, x, (0.38 + 0.47 * st) * this.gainVar(), 0.16, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const f = HUM_STYLES[this.humStyles[i]].f * p;
    const dur = 0.2 + 0.16 * st;
    // air whoosh
    const ga = this.gain(v, v.out);
    const ea = envAHR(ga.gain, t, 0.6, dur * 0.4, dur * 0.1, dur * 0.9);
    const bp = this.filter(v, 'bandpass', 450, 1.1, ga);
    bp.frequency.setValueAtTime(450 * p, t);
    bp.frequency.exponentialRampToValueAtTime((1800 + 1400 * st) * p, t + dur * 0.45);
    bp.frequency.exponentialRampToValueAtTime(600 * p, t + dur * 1.3);
    this.noiseSrc(v, PINK, t, ea + 0.02, bp);
    // Doppler-ish saber swell
    const gs = this.gain(v, v.out);
    const es = envAHR(gs.gain, t, 0.36, dur * 0.45, 0.02, dur * 0.8);
    const lp = this.filter(v, 'lowpass', 500, 3, gs);
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.exponentialRampToValueAtTime(2200 + 1200 * st, t + dur * 0.45);
    lp.frequency.exponentialRampToValueAtTime(420, es);
    for (let k = 0; k < DETUNE_PAIR.length; k++) {
      const o = this.osc(v, 'sawtooth', f * 1.05, t, es + 0.02, lp);
      o.detune.value = DETUNE_PAIR[k];
      o.frequency.exponentialRampToValueAtTime(f * (1.35 + 0.15 * st), t + dur * 0.45);
      o.frequency.exponentialRampToValueAtTime(f * 0.92, es);
    }
    this.end(v);
  }

  /** Saber burns flesh: sizzle + crackle + zap + low body thump. Heavier = longer, lower, louder. */
  hit(strength: number, x: number): void {
    const st = clamp01(strength);
    const v = this.begin('hit', 0.03, x, (0.55 + 0.45 * st) * this.gainVar(), 0.22 + 0.1 * st, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const dur = 0.22 + 0.4 * st;
    // sizzle
    const gz = this.gain(v, v.out);
    const ez = envAHR(gz.gain, t, 0.3, 0.004, dur * 0.25, dur * 0.85);
    this.noiseSrc(v, WHITE, t, ez + 0.01, this.filter(v, 'highpass', 2600 * p, 0.8, gz));
    // crackle
    const gc = this.gain(v, v.out);
    const ec = envAD(gc.gain, t, 0.95, 0.002, dur);
    this.noiseSrc(v, CRACKLE, t, ec + 0.01, this.filter(v, 'bandpass', 3200 * p, 0.7, gc), 0.9 + 0.2 * this.rng());
    // burn zap (chopped saw)
    const gzap = this.gain(v, v.out);
    const ezap = envAD(gzap.gain, t, 0.3, 0.002, 0.16 + 0.12 * st);
    const bpz = this.filter(v, 'bandpass', 1100 * p, 1.6, gzap);
    const chop = this.gain(v, bpz, 0.5);
    this.lfo(v, 'square', 55, 0.5, t, ezap + 0.01, chop.gain);
    const oz = this.osc(v, 'sawtooth', 260 * p, t, ezap + 0.01, chop);
    oz.frequency.exponentialRampToValueAtTime(110 * p, t + 0.14);
    // body thump
    const gt = this.gain(v, v.out);
    const et = envAD(gt.gain, t, 0.75 + 0.25 * st, 0.003, 0.18 + 0.24 * st);
    const ot = this.osc(v, 'sine', (140 - 45 * st) * p, t, et + 0.01, gt);
    ot.frequency.exponentialRampToValueAtTime((58 - 18 * st) * p, t + 0.1 + 0.12 * st);
    // body noise
    const gb = this.gain(v, v.out);
    const eb = envAD(gb.gain, t, 0.5 + 0.3 * st, 0.002, 0.12 + 0.14 * st);
    this.noiseSrc(v, BROWN, t, eb + 0.01, this.filter(v, 'lowpass', 380, 0.7, gb));
    this.end(v);
  }

  /** Blade-on-blade guard: bright transient + crackle + short metallic ring. */
  block(x: number): void {
    const v = this.begin('block', 0.035, x, 1.2 * this.gainVar(), 0.3, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const g1 = this.gain(v, v.out);
    const e1 = envAD(g1.gain, t, 1.5, 0.001, 0.05);
    this.noiseSrc(v, WHITE, t, e1 + 0.01, this.filter(v, 'bandpass', 4200 * p, 1.1, g1));
    const g2 = this.gain(v, v.out);
    const e2 = envAD(g2.gain, t, 1.5, 0.002, 0.2);
    this.noiseSrc(v, CRACKLE, t, e2 + 0.01, this.filter(v, 'highpass', 1800, 0.7, g2), 1.1);
    this.partials(v, 1180 * p, RING_GUARD, RING_GUARD_G, RING_GUARD_D, t, v.out);
    const gz = this.gain(v, v.out);
    const ez = envAD(gz.gain, t, 0.35, 0.002, 0.1);
    const oz = this.osc(v, 'sawtooth', 210 * p, t, ez + 0.01, this.filter(v, 'bandpass', 1300, 1.2, gz));
    oz.frequency.exponentialRampToValueAtTime(150 * p, t + 0.06);
    const gt = this.gain(v, v.out);
    const et = envAD(gt.gain, t, 0.35, 0.002, 0.09);
    const ot = this.osc(v, 'sine', 170 * p, t, et + 0.01, gt);
    ot.frequency.exponentialRampToValueAtTime(85 * p, t + 0.05);
    this.end(v);
  }

  /** Big blade lock: loud electric crackle, ~0.5 s sustained buzz, metallic ring. */
  clash(x: number): void {
    const v = this.begin('clash', 0.06, x, 1.2 * this.gainVar(), 0.38, null, true);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    // transient
    const g1 = this.gain(v, v.out);
    const e1 = envAD(g1.gain, t, 0.8, 0.001, 0.07);
    this.noiseSrc(v, WHITE, t, e1 + 0.01, this.filter(v, 'highpass', 700, 0.7, g1));
    // sustained electric crackle with jitter
    const gc = this.gain(v, v.out);
    const ec = envAHR(gc.gain, t, 1, 0.003, 0.34, 0.3);
    const jit = this.gain(v, gc, 0.65);
    this.lfo(v, 'square', 23, 0.35, t, ec + 0.01, jit.gain);
    this.noiseSrc(v, CRACKLE, t, ec + 0.01, this.filter(v, 'bandpass', 3200 * p, 0.7, jit), 1.3);
    // sustained buzz: both blades beating through a driven, chopped path
    const gb = this.gain(v, v.out);
    const eb = envAHR(gb.gain, t, 0.3, 0.008, 0.38, 0.22);
    const lp = this.filter(v, 'lowpass', 2600, 1, gb);
    const am = this.gain(v, lp, 0.6);
    this.lfo(v, 'square', 31, 0.4, t, eb + 0.01, am.gain);
    const shaper = v.ctx.createWaveShaper();
    shaper.curve = this.driveCurve;
    shaper.connect(am);
    v.nodes.push(shaper);
    const pre = this.gain(v, shaper, 0.55);
    this.osc(v, 'sawtooth', HUM_STYLES[this.humStyles[0]].f * 0.97 * p, t, eb + 0.01, pre);
    this.osc(v, 'sawtooth', HUM_STYLES[this.humStyles[1]].f * 1.03 * p, t, eb + 0.01, pre);
    this.osc(v, 'square', 154 * p, t, eb + 0.01, this.gain(v, pre, 0.4));
    // metallic ring
    this.partials(v, 620 * p, RING_PLATE, RING_PLATE_G, RING_PLATE_D, t, v.out);
    // thump
    const gt = this.gain(v, v.out);
    const et = envAD(gt.gain, t, 0.7, 0.002, 0.3);
    const ot = this.osc(v, 'sine', 120 * p, t, et + 0.01, gt);
    ot.frequency.exponentialRampToValueAtTime(45 * p, t + 0.15);
    this.end(v);
  }

  forceCharge(x: number): void {
    const v = this.begin('fcharge', 0.15, x, 0.75 * this.gainVar(), 0.35, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const dur = 0.6;
    const gr = this.gain(v, v.out);
    const er = envAHR(gr.gain, t, 0.75, dur * 0.85, 0.05, 0.3);
    const lp = this.filter(v, 'lowpass', 160, 1.2, gr);
    sweepExp(lp.frequency, t, 160, 800, dur);
    this.noiseSrc(v, BROWN, t, er + 0.01, lp);
    const gs = this.gain(v, v.out);
    const es = envAHR(gs.gain, t, 0.5, dur * 0.8, 0.05, 0.3);
    const os = this.osc(v, 'sine', 38 * p, t, es + 0.01, gs);
    os.frequency.exponentialRampToValueAtTime(64 * p, t + dur);
    const gsh = this.gain(v, v.out);
    const esh = envAHR(gsh.gain, t, 0.16, dur * 0.85, 0.02, 0.25);
    const trem = this.gain(v, gsh, 0.6);
    this.lfo(v, 'sine', 9, 0.4, t, esh + 0.01, trem.gain);
    const bp = this.filter(v, 'bandpass', 1500, 6, trem);
    sweepExp(bp.frequency, t, 1500 * p, 4200 * p, dur);
    this.noiseSrc(v, WHITE, t, esh + 0.01, bp);
    const gtn = this.gain(v, v.out);
    const etn = envAHR(gtn.gain, t, 0.05, dur * 0.8, 0.05, 0.25);
    const o1 = this.osc(v, 'sine', 180 * p, t, etn + 0.01, gtn);
    o1.frequency.exponentialRampToValueAtTime(270 * p, t + dur);
    const o2 = this.osc(v, 'sine', 181.5 * p, t, etn + 0.01, gtn);
    o2.frequency.exponentialRampToValueAtTime(272.5 * p, t + dur);
    this.end(v);
  }

  forcePush(x: number): void {
    const v = this.begin('fpush', 0.1, x, 0.9 * this.gainVar(), 0.4, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const gw = this.gain(v, v.out);
    const ew = envAD(gw.gain, t, 1, 0.006, 0.42);
    const ow = this.osc(v, 'sine', 85 * p, t, ew + 0.01, gw);
    ow.frequency.exponentialRampToValueAtTime(30 * p, t + 0.35);
    const gw2 = this.gain(v, v.out);
    const ew2 = envAD(gw2.gain, t, 0.25, 0.006, 0.25);
    const ow2 = this.osc(v, 'triangle', 170 * p, t, ew2 + 0.01, gw2);
    ow2.frequency.exponentialRampToValueAtTime(60 * p, t + 0.2);
    const gr = this.gain(v, v.out);
    const er = envAHR(gr.gain, t, 0.6, 0.03, 0.12, 0.45);
    const bp = this.filter(v, 'bandpass', 300, 0.9, gr);
    bp.frequency.setValueAtTime(300 * p, t);
    bp.frequency.exponentialRampToValueAtTime(2200 * p, t + 0.15);
    bp.frequency.exponentialRampToValueAtTime(500 * p, t + 0.6);
    this.noiseSrc(v, PINK, t, er + 0.01, bp);
    const ga = this.gain(v, v.out);
    const ea = envAD(ga.gain, t, 0.18, 0.01, 0.3);
    this.noiseSrc(v, WHITE, t, ea + 0.01, this.filter(v, 'highpass', 2500, 0.7, ga));
    this.end(v);
  }

  forceImpact(x: number): void {
    const v = this.begin('fimpact', 0.06, x, 0.95 * this.gainVar(), 0.42, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const gt = this.gain(v, v.out);
    const et = envAD(gt.gain, t, 1, 0.003, 0.5);
    const ot = this.osc(v, 'sine', 70 * p, t, et + 0.01, gt);
    ot.frequency.exponentialRampToValueAtTime(28 * p, t + 0.45);
    const gb = this.gain(v, v.out);
    const eb = envAD(gb.gain, t, 0.65, 0.002, 0.25);
    this.noiseSrc(v, BROWN, t, eb + 0.01, this.filter(v, 'lowpass', 500, 0.7, gb));
    const gr = this.gain(v, v.out);
    const er = envAHR(gr.gain, t, 0.35, 0.005, 0.05, 0.5);
    const bp = this.filter(v, 'bandpass', 1800, 1, gr);
    sweepExp(bp.frequency, t, 1800 * p, 350 * p, 0.5);
    this.noiseSrc(v, PINK, t, er + 0.01, bp);
    const gc = this.gain(v, v.out);
    const ec = envAD(gc.gain, t, 0.35, 0.001, 0.05);
    this.noiseSrc(v, WHITE, t, ec + 0.01, this.filter(v, 'bandpass', 2500, 0.9, gc));
    this.end(v);
  }

  /** Body slam plus a synthesized formant "grunt" exhale (no voice samples). */
  throwHit(x: number): void {
    const v = this.begin('throw', 0.08, x, 0.85 * this.gainVar(), 0.25, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const gi = this.gain(v, v.out);
    const ei = envAD(gi.gain, t, 0.9, 0.003, 0.24);
    const oi = this.osc(v, 'sine', 140 * p, t, ei + 0.01, gi);
    oi.frequency.exponentialRampToValueAtTime(50 * p, t + 0.16);
    const gb = this.gain(v, v.out);
    const eb = envAD(gb.gain, t, 0.6, 0.002, 0.14);
    this.noiseSrc(v, BROWN, t, eb + 0.01, this.filter(v, 'lowpass', 600, 0.7, gb));
    const gs = this.gain(v, v.out);
    const es = envAD(gs.gain, t, 0.3, 0.001, 0.05);
    this.noiseSrc(v, WHITE, t, es + 0.01, this.filter(v, 'bandpass', 1800, 1, gs));
    // grunt: buzzy source through "uh" formants
    const tg = t + 0.02;
    const gg = this.gain(v, v.out);
    const eg = envAHR(gg.gain, tg, 0.35, 0.015, 0.07, 0.16);
    const f1 = this.filter(v, 'bandpass', 640 * p, 5, gg);
    const f2g = this.gain(v, gg, 0.6);
    const f2 = this.filter(v, 'bandpass', 1080 * p, 6, f2g);
    const f0 = this.filter(v, 'lowpass', 2500, 0.7, f1);
    f0.connect(f2);
    const og = this.osc(v, 'sawtooth', 122 * p, tg, eg + 0.01, f0);
    og.frequency.exponentialRampToValueAtTime(86 * p, tg + 0.22);
    const gcl = this.gain(v, v.out);
    const ecl = envAD(gcl.gain, t, 0.16, 0.01, 0.16);
    this.noiseSrc(v, PINK, t, ecl + 0.01, this.filter(v, 'bandpass', 1200, 0.9, gcl));
    this.end(v);
  }

  // -------------------------------------------------------------------------------------------
  // Foley (quiet)
  // -------------------------------------------------------------------------------------------

  jump(x: number): void {
    const v = this.begin('jump', 0.06, x, 0.3 * this.gainVar(), 0.08, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const gw = this.gain(v, v.out);
    const ew = envAHR(gw.gain, t, 0.6, 0.03, 0.03, 0.14);
    const bp = this.filter(v, 'bandpass', 700, 1.3, gw);
    sweepExp(bp.frequency, t, 700 * p, 1700 * p, 0.16);
    this.noiseSrc(v, PINK, t, ew + 0.01, bp);
    const gs = this.gain(v, v.out);
    const es = envAD(gs.gain, t, 0.35, 0.001, 0.04);
    this.noiseSrc(v, WHITE, t, es + 0.01, this.filter(v, 'highpass', 1500, 0.7, gs));
    const gl = this.gain(v, v.out);
    const el = envAD(gl.gain, t, 0.35, 0.002, 0.07);
    const ol = this.osc(v, 'sine', 125 * p, t, el + 0.01, gl);
    ol.frequency.exponentialRampToValueAtTime(80 * p, t + 0.06);
    this.end(v);
  }

  land(x: number): void {
    const v = this.begin('land', 0.06, x, 0.42 * this.gainVar(), 0.12, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const gt = this.gain(v, v.out);
    const et = envAD(gt.gain, t, 0.85, 0.002, 0.14);
    const ot = this.osc(v, 'sine', 150 * p, t, et + 0.01, gt);
    ot.frequency.exponentialRampToValueAtTime(55 * p, t + 0.09);
    const gn = this.gain(v, v.out);
    const en = envAD(gn.gain, t, 0.55, 0.001, 0.09);
    this.noiseSrc(v, BROWN, t, en + 0.01, this.filter(v, 'lowpass', 900, 0.7, gn));
    const gm = this.gain(v, v.out);
    const em = envAD(gm.gain, t, 0.07, 0.001, 0.14);
    this.osc(v, 'sine', 1850 * p, t, em + 0.01, gm);
    this.osc(v, 'sine', 2770 * p, t, em + 0.01, gm);
    this.end(v);
  }

  dash(x: number): void {
    const v = this.begin('dash', 0.06, x, 0.36 * this.gainVar(), 0.1, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const gw = this.gain(v, v.out);
    const ew = envAHR(gw.gain, t, 0.65, 0.02, 0.04, 0.17);
    const bp = this.filter(v, 'bandpass', 1800, 1, gw);
    sweepExp(bp.frequency, t, 1800 * p, 600 * p, 0.2);
    this.noiseSrc(v, PINK, t, ew + 0.01, bp);
    const gs = this.gain(v, v.out);
    const es = envAD(gs.gain, t, 0.3, 0.001, 0.07);
    this.noiseSrc(v, WHITE, t, es + 0.01, this.filter(v, 'bandpass', 2500 * p, 0.8, gs));
    this.end(v);
  }

  step(x: number): void {
    const v = this.begin('step', 0.07, x, 0.26 * this.gainVar(), 0.05, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const gt = this.gain(v, v.out);
    const et = envAD(gt.gain, t, 0.6, 0.001, 0.06);
    const ot = this.osc(v, 'sine', 190 * p, t, et + 0.01, gt);
    ot.frequency.exponentialRampToValueAtTime(95 * p, t + 0.04);
    const gc = this.gain(v, v.out);
    const ec = envAD(gc.gain, t, 0.4, 0.001, 0.025);
    this.noiseSrc(v, WHITE, t, ec + 0.01, this.filter(v, 'highpass', 2000, 0.7, gc));
    const gm = this.gain(v, v.out);
    const em = envAD(gm.gain, t, 0.05, 0.001, 0.06);
    this.osc(v, 'sine', 2400 * p, t, em + 0.01, gm);
    this.end(v);
  }

  /** Body hitting the metal catwalk: thud + clang + bouncing grate rattle. */
  knockdown(x: number): void {
    const v = this.begin('knockdown', 0.1, x, 0.9 * this.gainVar(), 0.35, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const gt = this.gain(v, v.out);
    const et = envAD(gt.gain, t, 1, 0.003, 0.4);
    const ot = this.osc(v, 'sine', 95 * p, t, et + 0.01, gt);
    ot.frequency.exponentialRampToValueAtTime(32 * p, t + 0.3);
    const gb = this.gain(v, v.out);
    const eb = envAD(gb.gain, t, 0.7, 0.002, 0.22);
    this.noiseSrc(v, BROWN, t, eb + 0.01, this.filter(v, 'lowpass', 450, 0.7, gb));
    this.partials(v, 310 * p, RING_FLOOR, RING_FLOOR_G, RING_FLOOR_D, t, v.out);
    // rattle: one noise source, two resonances, a single gain with bouncing spikes
    const gr = this.gain(v, v.out);
    gr.gain.setValueAtTime(0, t);
    let tt = t + 0.04;
    let amp = 0.55;
    for (let k = 0; k < 7; k++) {
      tt += 0.025 + this.rng() * 0.06;
      gr.gain.setValueAtTime(0, tt);
      gr.gain.linearRampToValueAtTime(amp, tt + 0.002);
      gr.gain.exponentialRampToValueAtTime(amp * 0.01, tt + 0.04);
      amp *= 0.72;
    }
    gr.gain.setValueAtTime(0, tt + 0.045);
    const r1 = this.filter(v, 'bandpass', 3200 * p, 5, gr);
    const r2 = this.filter(v, 'bandpass', 2100 * p, 8, gr);
    const src = this.noiseSrc(v, WHITE, t, tt + 0.06, r1);
    src.connect(r2);
    this.end(v);
  }

  // -------------------------------------------------------------------------------------------
  // Big moments
  // -------------------------------------------------------------------------------------------

  /** Sharp accent on the flash, rising swell, impact at +0.5 s. */
  superFlash(): void {
    const v = this.begin('super', 0.2, 0, 0.9, 0.45, null, true);
    if (!v) return;
    const t = v.t;
    const ga = this.gain(v, v.out);
    const ea = envAD(ga.gain, t, 0.35, 0.001, 0.14);
    this.noiseSrc(v, WHITE, t, ea + 0.01, this.filter(v, 'highpass', 3000, 0.7, ga));
    const gb = this.gain(v, v.out);
    const eb = envAD(gb.gain, t, 0.08, 0.002, 0.5);
    this.osc(v, 'sine', 1760, t, eb + 0.01, gb);
    this.osc(v, 'sine', 2637, t, eb + 0.01, gb);
    const rise = 0.5;
    const gs = this.gain(v, v.out);
    const es = envSwell(gs.gain, t, 0.5, rise, 0.03);
    const bp = this.filter(v, 'bandpass', 300, 1.2, gs);
    sweepExp(bp.frequency, t, 300, 5000, rise);
    this.noiseSrc(v, PINK, t, es + 0.01, bp);
    const gtn = this.gain(v, v.out);
    const etn = envSwell(gtn.gain, t, 0.16, rise, 0.03);
    const lp = this.filter(v, 'lowpass', 400, 2, gtn);
    sweepExp(lp.frequency, t, 400, 3500, rise);
    const roots = [110, 165, 220];
    for (let k = 0; k < roots.length; k++) {
      const o = this.osc(v, 'sawtooth', roots[k], t, etn + 0.01, lp);
      o.frequency.exponentialRampToValueAtTime(roots[k] * 2, t + rise);
    }
    const ti = t + rise;
    const gi = this.gain(v, v.out);
    const ei = envAD(gi.gain, ti, 1, 0.003, 0.6);
    const oi = this.osc(v, 'sine', 90, ti, ei + 0.01, gi);
    oi.frequency.exponentialRampToValueAtTime(30, ti + 0.5);
    const gc = this.gain(v, v.out);
    const ec = envAD(gc.gain, ti, 0.55, 0.002, 0.45);
    this.noiseSrc(v, WHITE, ti, ec + 0.01, this.filter(v, 'lowpass', 5000, 0.7, gc));
    this.partials(v, 440, RING_PLATE, RING_PLATE_G, RING_PLATE_D, ti, v.out);
    this.end(v);
  }

  /** Huge low boom, reverse swell, then a ringing tail. ~3.5 s. */
  ko(): void {
    const v = this.begin('ko', 0.5, 0, 1, 0.55, null, true);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const gb = this.gain(v, v.out);
    const eb = envAD(gb.gain, t, 1, 0.004, 1.6);
    const ob = this.osc(v, 'sine', 62 * p, t, eb + 0.01, gb);
    ob.frequency.exponentialRampToValueAtTime(22 * p, t + 1.4);
    const gs = this.gain(v, v.out);
    const es = envAD(gs.gain, t, 0.45, 0.004, 1.1);
    const os = this.osc(v, 'triangle', 124 * p, t, es + 0.01, gs);
    os.frequency.exponentialRampToValueAtTime(40 * p, t + 0.8);
    const gn = this.gain(v, v.out);
    const en = envAD(gn.gain, t, 0.9, 0.002, 0.9);
    this.noiseSrc(v, BROWN, t, en + 0.01, this.filter(v, 'lowpass', 220, 0.7, gn));
    const gc = this.gain(v, v.out);
    const ec = envAD(gc.gain, t, 0.5, 0.001, 0.3);
    this.noiseSrc(v, WHITE, t, ec + 0.01, this.filter(v, 'lowpass', 3000, 0.7, gc));
    // reverse swell
    const ts = t + 0.2;
    const rise = 0.9;
    const gr = this.gain(v, v.out);
    const er = envSwell(gr.gain, ts, 0.32, rise, 0.04);
    const bp = this.filter(v, 'bandpass', 400, 0.8, gr);
    sweepExp(bp.frequency, ts, 400, 3200, rise);
    this.noiseSrc(v, PINK, ts, er + 0.01, bp);
    const gtn = this.gain(v, v.out);
    const etn = envSwell(gtn.gain, ts, 0.12, rise, 0.04);
    this.osc(v, 'triangle', 220 * p, ts, etn + 0.01, gtn);
    this.osc(v, 'triangle', 330 * p, ts, etn + 0.01, gtn);
    // ringing tail
    const tr = ts + rise;
    this.partials(v, 220 * p, RING_BELL, RING_BELL_G, RING_BELL_D, tr, v.out);
    const gl = this.gain(v, v.out);
    const el = envAD(gl.gain, tr, 0.16, 0.02, 2.4);
    this.osc(v, 'sine', 55 * p, tr, el + 0.01, gl);
    const ga = this.gain(v, v.out);
    const ea = envAD(ga.gain, tr, 0.55, 0.003, 0.45);
    const oa = this.osc(v, 'sine', 80 * p, tr, ea + 0.01, ga);
    oa.frequency.exponentialRampToValueAtTime(40 * p, tr + 0.3);
    this.end(v);
  }

  // -------------------------------------------------------------------------------------------
  // Parry, movement foley and Force powers (4-fighter expansion)
  // -------------------------------------------------------------------------------------------

  /**
   * Crystalline deflection: glint + inharmonic 2.1-5.2 kHz "shing" ring (~0.6-0.8 s) + fast whoosh + low thump.
   * Plays on an un-ducked priority path and briefly dips the sfx bus and beds so it cuts through a busy mix.
   */
  parry(x: number): void {
    const v = this.begin('parry', 0.05, x, 1.3 * this.gainVar(), 0.5, this.priorityBus, true);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    this.autoDuck(t, 0.4, 0.5, 0.2, 0.35);
    // glint transient
    const gt = this.gain(v, v.out);
    const et = envAD(gt.gain, t, 0.6, 0.001, 0.06);
    this.noiseSrc(v, WHITE, t, et + 0.01, this.filter(v, 'highpass', 4500, 0.7, gt));
    // pitched "shing" sweep
    const gs = this.gain(v, v.out);
    const es = envAD(gs.gain, t, 0.22, 0.002, 0.16);
    const os = this.osc(v, 'sine', 2600 * p, t, es + 0.01, gs);
    os.frequency.exponentialRampToValueAtTime(5200 * p, t + 0.05);
    // crystalline ring (the first two partials beat ~3 Hz for shimmer)
    this.partials(v, 2150 * p, RING_PARRY, RING_PARRY_G, RING_PARRY_D, t, v.out);
    // fast filtered whoosh
    const gw = this.gain(v, v.out);
    const ew = envAHR(gw.gain, t, 0.8, 0.02, 0.02, 0.16);
    const bp = this.filter(v, 'bandpass', 1200, 1.3, gw);
    bp.frequency.setValueAtTime(1200 * p, t);
    bp.frequency.exponentialRampToValueAtTime(5000 * p, t + 0.06);
    bp.frequency.exponentialRampToValueAtTime(1800 * p, t + 0.2);
    this.noiseSrc(v, PINK, t, ew + 0.01, bp);
    // short low thump
    const gl = this.gain(v, v.out);
    const el = envAD(gl.gain, t, 0.7, 0.002, 0.14);
    const ol = this.osc(v, 'sine', 150 * p, t, el + 0.01, gl);
    ol.frequency.exponentialRampToValueAtTime(60 * p, t + 0.06);
    this.end(v);
  }

  /** The victim's blade knocked away: dull clank + descending, wobbling saber tone. */
  parried(x: number): void {
    const v = this.begin('parried', 0.06, x, 0.85 * this.gainVar(), 0.3, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    this.partials(v, 420 * p, RING_CLANK, RING_CLANK_G, RING_CLANK_D, t, v.out);
    const gn = this.gain(v, v.out);
    const en = envAD(gn.gain, t, 0.6, 0.001, 0.09);
    this.noiseSrc(v, PINK, t, en + 0.01, this.filter(v, 'bandpass', 900 * p, 1.2, gn));
    const gd = this.gain(v, v.out);
    const ed = envAD(gd.gain, t, 0.5, 0.002, 0.1);
    const od = this.osc(v, 'sine', 200 * p, t, ed + 0.01, gd);
    od.frequency.exponentialRampToValueAtTime(90 * p, t + 0.06);
    const f = 104 * p;
    const gw = this.gain(v, v.out);
    const ew = envAHR(gw.gain, t, 0.32, 0.01, 0.15, 0.35);
    const am = this.gain(v, gw, 0.6);
    const amLfo = this.lfo(v, 'sine', 9, 0.4, t, ew + 0.01, am.gain);
    amLfo.frequency.exponentialRampToValueAtTime(4, t + 0.5);
    const lp = this.filter(v, 'lowpass', 1400, 3, am);
    sweepExp(lp.frequency, t, 1400, 300, 0.5);
    for (let k = 0; k < DETUNE_PAIR.length; k++) {
      const o = this.osc(v, 'sawtooth', f * 1.1, t, ew + 0.01, lp);
      o.detune.value = DETUNE_PAIR[k];
      o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.5);
      this.lfo(v, 'sine', 8 + k, f * 0.05, t, ew + 0.01, o.frequency);
    }
    this.end(v);
  }

  /** Heavier, quicker boot strike on the metal deck (louder than step()). */
  runStep(x: number): void {
    const v = this.begin('runstep', 0.055, x, 0.42 * this.gainVar(), 0.08, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const gt = this.gain(v, v.out);
    const et = envAD(gt.gain, t, 0.9, 0.001, 0.09);
    const ot = this.osc(v, 'sine', 170 * p, t, et + 0.01, gt);
    ot.frequency.exponentialRampToValueAtTime(70 * p, t + 0.045);
    const gb = this.gain(v, v.out);
    const eb = envAD(gb.gain, t, 0.6, 0.001, 0.06);
    this.noiseSrc(v, BROWN, t, eb + 0.01, this.filter(v, 'lowpass', 1100, 0.7, gb));
    const gc = this.gain(v, v.out);
    const ec = envAD(gc.gain, t, 0.45, 0.001, 0.02);
    this.noiseSrc(v, WHITE, t, ec + 0.01, this.filter(v, 'highpass', 2500, 0.7, gc));
    const gm = this.gain(v, v.out);
    const em = envAD(gm.gain, t, 0.06, 0.001, 0.12);
    this.osc(v, 'sine', 1420 * p, t, em + 0.01, gm);
    this.osc(v, 'sine', 2210 * p, t, em + 0.01, gm);
    this.end(v);
  }

  /** Sliding stop: ~0.3 s boot scrape on the deck. */
  skid(x: number): void {
    const v = this.begin('skid', 0.12, x, 0.5 * this.gainVar(), 0.15, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const gs = this.gain(v, v.out);
    const es = envAHR(gs.gain, t, 0.9, 0.015, 0.16, 0.14);
    const jit = this.gain(v, gs, 0.6);
    this.lfo(v, 'square', 37, 0.4, t, es + 0.01, jit.gain);
    const bp = this.filter(v, 'bandpass', 2600, 2.5, jit);
    sweepExp(bp.frequency, t, 2600 * p, 1500 * p, 0.3);
    this.noiseSrc(v, WHITE, t, es + 0.01, bp);
    const gg = this.gain(v, v.out);
    const eg = envAHR(gg.gain, t, 0.6, 0.01, 0.15, 0.12);
    this.noiseSrc(v, CRACKLE, t, eg + 0.01, this.filter(v, 'highpass', 1500, 0.7, gg), 1.4);
    const gl = this.gain(v, v.out);
    const el = envAHR(gl.gain, t, 0.5, 0.01, 0.12, 0.12);
    this.noiseSrc(v, BROWN, t, el + 0.01, this.filter(v, 'lowpass', 300, 0.7, gl));
    this.end(v);
  }

  /** Body bouncing off the metal floor after a knockdown (softer than knockdown()). */
  bodyBounce(x: number): void {
    const v = this.begin('bounce', 0.08, x, 0.6 * this.gainVar(), 0.25, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const gt = this.gain(v, v.out);
    const et = envAD(gt.gain, t, 0.8, 0.002, 0.25);
    const ot = this.osc(v, 'sine', 115 * p, t, et + 0.01, gt);
    ot.frequency.exponentialRampToValueAtTime(45 * p, t + 0.15);
    const gb = this.gain(v, v.out);
    const eb = envAD(gb.gain, t, 0.45, 0.002, 0.14);
    this.noiseSrc(v, BROWN, t, eb + 0.01, this.filter(v, 'lowpass', 500, 0.7, gb));
    this.partials(v, 330 * p, RING_FLOOR, RING_FLOOR_SOFT_G, RING_FLOOR_SOFT_D, t, v.out);
    const gr = this.gain(v, v.out);
    gr.gain.setValueAtTime(0, t);
    let tt = t + 0.03;
    let amp = 0.3;
    for (let k = 0; k < 3; k++) {
      tt += 0.03 + this.rng() * 0.05;
      gr.gain.setValueAtTime(0, tt);
      gr.gain.linearRampToValueAtTime(amp, tt + 0.002);
      gr.gain.exponentialRampToValueAtTime(amp * 0.01, tt + 0.035);
      amp *= 0.65;
    }
    gr.gain.setValueAtTime(0, tt + 0.04);
    this.noiseSrc(v, WHITE, t, tt + 0.05, this.filter(v, 'bandpass', 3000 * p, 5, gr));
    this.end(v);
  }

  /** Body sliding along the deck: ~0.4 s cloth + metal scrape. */
  slide(x: number): void {
    const v = this.begin('slide', 0.15, x, 0.5 * this.gainVar(), 0.15, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const gb = this.gain(v, v.out);
    const eb = envAHR(gb.gain, t, 0.6, 0.03, 0.25, 0.15);
    this.noiseSrc(v, PINK, t, eb + 0.01, this.filter(v, 'bandpass', 700 * p, 0.9, gb));
    const gs = this.gain(v, v.out);
    const es = envAHR(gs.gain, t, 0.7, 0.03, 0.22, 0.15);
    const jit = this.gain(v, gs, 0.65);
    this.lfo(v, 'sine', 19, 0.35, t, es + 0.01, jit.gain);
    const bp = this.filter(v, 'bandpass', 2200, 3, jit);
    sweepExp(bp.frequency, t, 2200 * p, 1300 * p, 0.4);
    this.noiseSrc(v, WHITE, t, es + 0.01, bp);
    const gc = this.gain(v, v.out);
    const ec = envAHR(gc.gain, t, 0.4, 0.03, 0.22, 0.15);
    this.noiseSrc(v, BROWN, t, ec + 0.01, this.filter(v, 'lowpass', 500, 0.7, gc));
    this.end(v);
  }

  /** Somersault / spinning jump: air whoosh + cloth flutter. */
  flip(x: number): void {
    const v = this.begin('flip', 0.08, x, 0.7 * this.gainVar(), 0.12, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const ga = this.gain(v, v.out);
    const ea = envAHR(ga.gain, t, 0.6, 0.08, 0.06, 0.26);
    const bp = this.filter(v, 'bandpass', 500, 1.1, ga);
    bp.frequency.setValueAtTime(500 * p, t);
    bp.frequency.exponentialRampToValueAtTime(2000 * p, t + 0.15);
    bp.frequency.exponentialRampToValueAtTime(700 * p, t + 0.4);
    this.noiseSrc(v, PINK, t, ea + 0.01, bp);
    const gf = this.gain(v, v.out);
    const ef = envAHR(gf.gain, t, 0.55, 0.04, 0.12, 0.2);
    const am = this.gain(v, gf, 0.5);
    const flutter = this.lfo(v, 'sine', 24, 0.5, t, ef + 0.01, am.gain);
    flutter.frequency.exponentialRampToValueAtTime(12, t + 0.35);
    this.noiseSrc(v, PINK, t, ef + 0.01, this.filter(v, 'bandpass', 1300 * p, 0.8, am));
    this.end(v);
  }

  /** Powerful take-off whoosh for the leap-strike special. */
  leap(x: number): void {
    const v = this.begin('leap', 0.1, x, 0.75 * this.gainVar(), 0.2, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const gp = this.gain(v, v.out);
    const ep = envAD(gp.gain, t, 0.8, 0.003, 0.2);
    const op = this.osc(v, 'sine', 95 * p, t, ep + 0.01, gp);
    op.frequency.exponentialRampToValueAtTime(50 * p, t + 0.12);
    const gs = this.gain(v, v.out);
    const es = envAD(gs.gain, t, 0.35, 0.001, 0.1);
    this.noiseSrc(v, PINK, t, es + 0.01, this.filter(v, 'bandpass', 1500, 1, gs));
    const gw = this.gain(v, v.out);
    const ew = envAHR(gw.gain, t, 0.85, 0.12, 0.06, 0.38);
    const bp = this.filter(v, 'bandpass', 300, 1, gw);
    bp.frequency.setValueAtTime(300 * p, t);
    bp.frequency.exponentialRampToValueAtTime(2800 * p, t + 0.22);
    bp.frequency.exponentialRampToValueAtTime(900 * p, t + 0.55);
    this.noiseSrc(v, PINK, t, ew + 0.01, bp);
    const ga = this.gain(v, v.out);
    const ea = envAHR(ga.gain, t, 0.2, 0.1, 0.05, 0.25);
    this.noiseSrc(v, WHITE, t, ea + 0.01, this.filter(v, 'highpass', 3500, 0.7, ga));
    this.end(v);
  }

  /** Force choke onset: low pressure "whump" (the continuous layer is setGrip). */
  gripStart(x: number): void {
    const v = this.begin('gripstart', 0.2, x, 0.85 * this.gainVar(), 0.35, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const gw = this.gain(v, v.out);
    const ew = envAD(gw.gain, t, 1, 0.006, 0.45);
    const ow = this.osc(v, 'sine', 80 * p, t, ew + 0.01, gw);
    ow.frequency.exponentialRampToValueAtTime(34 * p, t + 0.3);
    const gp = this.gain(v, v.out);
    const ep = envAHR(gp.gain, t, 0.7, 0.04, 0.05, 0.4);
    const lp = this.filter(v, 'lowpass', 200, 1.5, gp);
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.06);
    lp.frequency.exponentialRampToValueAtTime(250, t + 0.45);
    this.noiseSrc(v, BROWN, t, ep + 0.01, lp);
    const gq = this.gain(v, v.out);
    const eq = envAD(gq.gain, t, 0.3, 0.02, 0.4);
    const bq = this.filter(v, 'bandpass', 400, 4, gq);
    sweepExp(bq.frequency, t, 400 * p, 900 * p, 0.4);
    this.noiseSrc(v, PINK, t, eq + 0.01, bq);
    this.end(v);
  }

  /**
   * Force choke loop: eerie resonant low hum + strained whine + slow tremolo. ~80 ms ramp in/out.
   * Call every frame (or on change); allocation-free after the first activation. Pans by x.
   */
  setGrip(active: boolean, x: number): void {
    const ctx = this.ctx;
    const b = this.buses;
    if (!ctx || !b || !this.built || this.disposed) return;
    let l = this.grip;
    if (!l) {
      if (!active) return;
      l = this.grip = this.buildGrip(ctx, b.sfx);
    }
    this.loopUpdate(l, active, x, ctx.currentTime);
  }

  /** Force lightning loop: violent crackle + bursts + 120 Hz harmonic buzz. Fast in (~35 ms), ~80 ms out. */
  setLightning(active: boolean, x: number): void {
    const ctx = this.ctx;
    const b = this.buses;
    if (!ctx || !b || !this.built || this.disposed) return;
    let l = this.lightning;
    if (!l) {
      if (!active) return;
      l = this.lightning = this.buildLightning(ctx, b.sfx);
    }
    this.loopUpdate(l, active, x, ctx.currentTime);
  }

  /** Lightning landing on the victim: sizzle + crackle + chopped zap. */
  lightningHit(x: number): void {
    const v = this.begin('lhit', 0.08, x, 1.1 * this.gainVar(), 0.25, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const gs = this.gain(v, v.out);
    const es = envAHR(gs.gain, t, 0.5, 0.003, 0.08, 0.28);
    this.noiseSrc(v, WHITE, t, es + 0.01, this.filter(v, 'highpass', 3200 * p, 0.7, gs));
    const gc = this.gain(v, v.out);
    const ec = envAD(gc.gain, t, 1.1, 0.002, 0.3);
    this.noiseSrc(v, CRACKLE, t, ec + 0.01, this.filter(v, 'bandpass', 3800 * p, 0.8, gc), 1.5);
    const gz = this.gain(v, v.out);
    const ez = envAD(gz.gain, t, 0.35, 0.002, 0.18);
    const bpz = this.filter(v, 'bandpass', 1400 * p, 1.4, gz);
    const chop = this.gain(v, bpz, 0.5);
    this.lfo(v, 'square', 70, 0.5, t, ez + 0.01, chop.gain);
    const oz = this.osc(v, 'sawtooth', 320 * p, t, ez + 0.01, chop);
    oz.frequency.exponentialRampToValueAtTime(130 * p, t + 0.15);
    const gb = this.gain(v, v.out);
    const eb = envAD(gb.gain, t, 0.45, 0.002, 0.12);
    const ob = this.osc(v, 'sine', 120 * p, t, eb + 0.01, gb);
    ob.frequency.exponentialRampToValueAtTime(60 * p, t + 0.08);
    this.end(v);
  }

  /** Saberstaff thrown like a boomerang: heavy whoosh + saber swell (the flight loop is setSpinningBlade). */
  staffThrow(x: number): void {
    const v = this.begin('sthrow', 0.15, x, 0.8 * this.gainVar(), 0.2, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const f = HUM_STYLES.thane.f * p;
    const gw = this.gain(v, v.out);
    const ew = envAHR(gw.gain, t, 0.7, 0.1, 0.04, 0.3);
    const bp = this.filter(v, 'bandpass', 350, 1, gw);
    bp.frequency.setValueAtTime(350 * p, t);
    bp.frequency.exponentialRampToValueAtTime(2400 * p, t + 0.12);
    bp.frequency.exponentialRampToValueAtTime(700 * p, t + 0.4);
    this.noiseSrc(v, PINK, t, ew + 0.01, bp);
    const gs = this.gain(v, v.out);
    const es = envAHR(gs.gain, t, 0.35, 0.1, 0.03, 0.3);
    const lp = this.filter(v, 'lowpass', 400, 3, gs);
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(2600, t + 0.12);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.45);
    for (let k = 0; k < DETUNE_PAIR.length; k++) {
      const o = this.osc(v, 'sawtooth', f * 1.1, t, es + 0.01, lp);
      o.detune.value = DETUNE_PAIR[k];
      o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.12);
      o.frequency.exponentialRampToValueAtTime(f * 0.9, t + 0.45);
    }
    const gc = this.gain(v, v.out);
    const ec = envAD(gc.gain, t, 0.25, 0.001, 0.05);
    this.noiseSrc(v, WHITE, t, ec + 0.01, this.filter(v, 'bandpass', 2200, 0.9, gc));
    this.end(v);
  }

  /**
   * Thrown staff in flight: pulsing whoom-whoom. `speed` is normalized 0..1 (clamped) -> 8..14 Hz pulse rate.
   * Call every frame with the blade's world x; allocation-free after the first activation.
   */
  setSpinningBlade(active: boolean, x: number, speed: number): void {
    const ctx = this.ctx;
    const b = this.buses;
    if (!ctx || !b || !this.built || this.disposed) return;
    let l = this.spin;
    if (!l) {
      if (!active) return;
      l = this.spin = this.buildSpin(ctx, b.sfx);
    }
    const now = ctx.currentTime;
    this.loopUpdate(l, active, x, now);
    const rate = 8 + 6 * clamp01(speed);
    if (rate - l.lastRate > 0.05 || l.lastRate - rate > 0.05) {
      l.lastRate = rate;
      l.lfo.frequency.setTargetAtTime(rate, now, 0.05);
    }
  }

  /** Staff caught: snap + palm slap + short hum swell. */
  staffCatch(x: number): void {
    const v = this.begin('scatch', 0.15, x, 0.85 * this.gainVar(), 0.25, null, false);
    if (!v) return;
    const t = v.t;
    const p = this.pitchVar();
    const f = HUM_STYLES.thane.f * p;
    const gn = this.gain(v, v.out);
    const en = envAD(gn.gain, t, 0.8, 0.001, 0.05);
    this.noiseSrc(v, WHITE, t, en + 0.01, this.filter(v, 'bandpass', 2500 * p, 1, gn));
    const gt = this.gain(v, v.out);
    const et = envAD(gt.gain, t, 0.5, 0.001, 0.09);
    const ot = this.osc(v, 'sine', 180 * p, t, et + 0.01, gt);
    ot.frequency.exponentialRampToValueAtTime(80 * p, t + 0.05);
    const gs = this.gain(v, v.out);
    const es = envAD(gs.gain, t, 0.35, 0.001, 0.06);
    this.noiseSrc(v, PINK, t, es + 0.01, this.filter(v, 'bandpass', 1200, 1, gs));
    const gh = this.gain(v, v.out);
    const eh = envAHR(gh.gain, t, 0.32, 0.06, 0.08, 0.3);
    const lp = this.filter(v, 'lowpass', 300, 3, gh);
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(1400, t + 0.08);
    lp.frequency.exponentialRampToValueAtTime(420, t + 0.4);
    this.osc(v, 'sawtooth', f, t, eh + 0.01, lp);
    this.osc(v, 'sawtooth', f * 1.006, t, eh + 0.01, lp);
    this.end(v);
  }

  /** Character-select stinger, distinct per roster index 0..3 (0 KAEL, 1 VEXA, 2 ASHA, 3 THANE). */
  characterSelect(i: number): void {
    const idx = Number.isFinite(i) ? ((Math.round(i) % 4) + 4) % 4 : 0;
    const v = this.begin('charsel', 0.08, 0, 0.9, 0.3, this.buses ? this.buses.ui : null, true);
    if (!v) return;
    const t = v.t;
    // shared saber "shwing"
    const gw = this.gain(v, v.out);
    const ew = envAHR(gw.gain, t, 0.3, 0.03, 0.02, 0.18);
    const bp = this.filter(v, 'bandpass', 600, 1.5, gw);
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(3500, t + 0.08);
    bp.frequency.exponentialRampToValueAtTime(1500, t + 0.25);
    this.noiseSrc(v, PINK, t, ew + 0.01, bp);
    const tm = t + 0.04;
    if (idx === 0) {
      // KAEL: bright, heroic open fifth
      this.brass(v, 293.66, CHORD_PICKUP, tm, 0.16, 0.36, 3800);
      this.partials(v, 1174.7, RING_BELL, RING_BELL_G, RING_GUARD_D, tm, this.gain(v, v.out, 1.6));
    } else if (idx === 1) {
      // VEXA: dark minor chord + growl
      this.brass(v, 220, CHORD_MINOR, tm, 0.2, 0.2, 1800);
      const gg = this.gain(v, v.out);
      const eg = envAHR(gg.gain, tm, 0.2, 0.02, 0.15, 0.25);
      const lp = this.filter(v, 'lowpass', 400, 2, gg);
      this.osc(v, 'sawtooth', 55, tm, eg + 0.01, lp);
      this.osc(v, 'sawtooth', 55.4, tm, eg + 0.01, lp);
    } else if (idx === 2) {
      // ASHA: quick sparkling arpeggio
      for (let k = 0; k < ARP_ASHA.length; k++) {
        this.brass(v, 329.63 * Math.pow(2, ARP_ASHA[k] / 12), CHORD_OCT, tm + k * 0.05, 0.04, 0.27, 4200);
      }
      this.partials(v, 1318.5, RING_BELL, RING_BELL_G, RING_GUARD_D, tm + 0.15, this.gain(v, v.out, 1.6));
    } else {
      // THANE: low, heavy power chord + drum
      this.brass(v, 146.83, CHORD_LOW, tm, 0.28, 0.22, 1400);
      const gd = this.gain(v, v.out);
      const ed = envAD(gd.gain, tm, 0.6, 0.003, 0.35);
      const od = this.osc(v, 'sine', 90, tm, ed + 0.01, gd);
      od.frequency.exponentialRampToValueAtTime(50, tm + 0.2);
    }
    this.end(v);
  }

  /** Round-1 "versus" moment: left hit, right answer, riser, then a big slam chord with drum, crash and ring. */
  versus(): void {
    const v = this.begin('versus', 0.5, 0, 0.85, 0.45, this.buses ? this.buses.ui : null, true);
    if (!v) return;
    const t = v.t;
    this.brass(v, 146.83, CHORD_PICKUP, t, 0.09, 0.22, 2600, this.panNode(v, -0.6, v.out));
    this.brass(v, 174.61, CHORD_PICKUP, t + 0.2, 0.09, 0.22, 2600, this.panNode(v, 0.6, v.out));
    const gr = this.gain(v, v.out);
    const er = envSwell(gr.gain, t + 0.05, 0.3, 0.4, 0.02);
    const bp = this.filter(v, 'bandpass', 400, 1.2, gr);
    sweepExp(bp.frequency, t + 0.05, 400, 4000, 0.4);
    this.noiseSrc(v, PINK, t + 0.05, er + 0.01, bp);
    const ts = t + 0.45;
    this.brass(v, 146.83, CHORD_VERSUS, ts, 0.6, 0.3, 3000);
    const gd = this.gain(v, v.out);
    const ed = envAD(gd.gain, ts, 1, 0.003, 0.6);
    const od = this.osc(v, 'sine', 90, ts, ed + 0.01, gd);
    od.frequency.exponentialRampToValueAtTime(45, ts + 0.3);
    const gc = this.gain(v, v.out);
    const ec = envAD(gc.gain, ts, 0.45, 0.001, 0.6);
    this.noiseSrc(v, WHITE, ts, ec + 0.01, this.filter(v, 'highpass', 1500, 0.7, gc));
    this.partials(v, 330, RING_PLATE, RING_PLATE_G, RING_PLATE_D, ts, v.out);
    this.end(v);
  }

  // -------------------------------------------------------------------------------------------
  // Announcer-style stingers and UI (routed to the UI bus: never ducked or paused)
  // -------------------------------------------------------------------------------------------

  roundStart(round: number): void {
    const r = Number.isFinite(round) ? Math.max(1, Math.min(5, Math.round(round))) : 1;
    const v = this.begin('round', 0.3, 0, 1.05, 0.35, this.buses ? this.buses.ui : null, true);
    if (!v) return;
    const t = v.t;
    const root = 146.83 * Math.pow(2, ((r - 1) * 3) / 12); // D3, F3, G#3, B3, D4
    this.brass(v, root * Math.pow(2, -2 / 12), CHORD_PICKUP, t, 0.07, 0.2, 2200);
    const tm = t + 0.15;
    this.brass(v, root, CHORD_ROUND, tm, 0.7, 0.26, 2600 + r * 200);
    if (r >= 3) this.brass(v, root / 2, CHORD_PICKUP, tm, 0.7, 0.12, 900);
    const gt = this.gain(v, v.out);
    const et = envAD(gt.gain, tm, 0.6, 0.003, 0.45);
    const ot = this.osc(v, 'sine', 98, tm, et + 0.01, gt);
    ot.frequency.exponentialRampToValueAtTime(60, tm + 0.25);
    this.end(v);
  }

  fight(): void {
    const v = this.begin('fight', 0.3, 0, 0.9, 0.4, this.buses ? this.buses.ui : null, true);
    if (!v) return;
    const t = v.t;
    this.brass(v, 220, CHORD_FIGHT, t, 0.2, 0.3, 4200);
    const gc = this.gain(v, v.out);
    const ec = envAD(gc.gain, t, 0.45, 0.001, 0.4);
    this.noiseSrc(v, WHITE, t, ec + 0.01, this.filter(v, 'highpass', 1200, 0.7, gc));
    const gt = this.gain(v, v.out);
    const et = envAD(gt.gain, t, 1, 0.002, 0.32);
    const ot = this.osc(v, 'sine', 120, t, et + 0.01, gt);
    ot.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    this.end(v);
  }

  timeWarning(): void {
    const v = this.begin('timewarn', 0.25, 0, 0.5, 0.08, this.buses ? this.buses.ui : null, true);
    if (!v) return;
    const t = v.t;
    const gb = this.gain(v, v.out);
    const eb = envAHR(gb.gain, t, 0.28, 0.002, 0.045, 0.06);
    this.osc(v, 'square', 1318.5, t, eb + 0.01, this.filter(v, 'lowpass', 3500, 0.7, gb));
    const gh = this.gain(v, v.out);
    const eh = envAD(gh.gain, t, 0.06, 0.002, 0.1);
    this.osc(v, 'sine', 2637, t, eh + 0.01, gh);
    const gc = this.gain(v, v.out);
    const ec = envAD(gc.gain, t, 0.3, 0.001, 0.012);
    this.noiseSrc(v, WHITE, t, ec + 0.01, this.filter(v, 'highpass', 4000, 0.7, gc));
    this.end(v);
  }

  victory(): void {
    const v = this.begin('victory', 0.5, 0, 0.85, 0.4, this.buses ? this.buses.ui : null, true);
    if (!v) return;
    const t = v.t;
    const root = 196; // G3
    for (let k = 0; k < PHRASE_VICTORY.length; k++) {
      this.brass(v, root * Math.pow(2, PHRASE_VICTORY[k] / 12), CHORD_PICKUP, t + k * 0.13, 0.06, 0.18, 2600);
    }
    const tc = t + 0.42;
    this.brass(v, root, CHORD_VICTORY, tc, 0.85, 0.26, 3200);
    const gt = this.gain(v, v.out);
    const et = envAD(gt.gain, tc, 0.6, 0.003, 0.5);
    const ot = this.osc(v, 'sine', 98, tc, et + 0.01, gt);
    ot.frequency.exponentialRampToValueAtTime(62, tc + 0.3);
    this.partials(v, 784, RING_BELL, RING_BELL_G, RING_GUARD_D, tc, v.out);
    this.end(v);
  }

  uiMove(): void {
    const v = this.begin('uimove', 0.03, 0, 0.9, 0, this.buses ? this.buses.ui : null, true);
    if (!v) return;
    const t = v.t;
    const g = this.gain(v, v.out);
    const e = envAD(g.gain, t, 0.25, 0.002, 0.07);
    const o = this.osc(v, 'triangle', 1320, t, e + 0.01, g);
    o.frequency.exponentialRampToValueAtTime(1480, t + 0.03);
    const gc = this.gain(v, v.out);
    const ec = envAD(gc.gain, t, 0.12, 0.001, 0.01);
    this.noiseSrc(v, WHITE, t, ec + 0.01, this.filter(v, 'highpass', 3000, 0.7, gc));
    this.end(v);
  }

  uiSelect(): void {
    const v = this.begin('uiselect', 0.05, 0, 1.0, 0.1, this.buses ? this.buses.ui : null, true);
    if (!v) return;
    const t = v.t;
    const g1 = this.gain(v, v.out);
    const e1 = envAD(g1.gain, t, 0.25, 0.002, 0.12);
    this.osc(v, 'triangle', 880, t, e1 + 0.01, g1);
    const t2 = t + 0.065;
    const g2 = this.gain(v, v.out);
    const e2 = envAD(g2.gain, t2, 0.28, 0.002, 0.22);
    this.osc(v, 'triangle', 1320, t2, e2 + 0.01, g2);
    const g3 = this.gain(v, v.out);
    const e3 = envAD(g3.gain, t2, 0.05, 0.002, 0.25);
    this.osc(v, 'sine', 2640, t2, e3 + 0.01, g3);
    this.end(v);
  }

  uiBack(): void {
    const v = this.begin('uiback', 0.05, 0, 0.9, 0.05, this.buses ? this.buses.ui : null, true);
    if (!v) return;
    const t = v.t;
    const g1 = this.gain(v, v.out);
    const e1 = envAD(g1.gain, t, 0.25, 0.002, 0.1);
    this.osc(v, 'triangle', 784, t, e1 + 0.01, g1);
    const t2 = t + 0.06;
    const g2 = this.gain(v, v.out);
    const e2 = envAD(g2.gain, t2, 0.22, 0.002, 0.16);
    this.osc(v, 'triangle', 523, t2, e2 + 0.01, g2);
    this.end(v);
  }

  // -------------------------------------------------------------------------------------------
  // Beds
  // -------------------------------------------------------------------------------------------

  /** Reactor drone bed: low noise + sub hum + slow pulse + occasional steam hiss. */
  setAmbience(on: boolean): void {
    this.ambienceWanted = on;
    this.applyAmbience();
    this.updatePump();
  }

  /** 0..1: drives a subtle heartbeat-like tension pulse (0 = off). */
  setIntensity(v: number): void {
    this.intensity = clamp01(v);
    this.updatePump();
  }

  // -------------------------------------------------------------------------------------------
  // Offline measurement helpers (static)
  // -------------------------------------------------------------------------------------------

  /**
   * Render engine events through an OfflineAudioContext (same code paths as live playback).
   * Events at the same render quantum run together. Returns null if OfflineAudioContext is unavailable.
   */
  static async renderOffline(
    rng: () => number,
    durationSec: number,
    events: readonly OfflineEvent[],
    sampleRate = 48000,
  ): Promise<AudioBuffer | null> {
    if (typeof OfflineAudioContext === 'undefined') return null;
    const length = Math.max(128, Math.ceil(durationSec * sampleRate));
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
    const engine = new AudioEngine(rng, { context: ctx });
    await engine.unlock();
    const groups = new Map<number, OfflineEvent[]>();
    for (const ev of events) {
      const frame = Math.round((Math.max(0, ev.at) * sampleRate) / 128) * 128;
      if (frame >= length) continue;
      const list = groups.get(frame);
      if (list) list.push(ev);
      else groups.set(frame, [ev]);
    }
    for (const [frame, list] of groups) {
      if (frame === 0) {
        for (const ev of list) ev.run(engine);
        continue;
      }
      void ctx.suspend(frame / sampleRate).then(() => {
        try {
          for (const ev of list) ev.run(engine);
        } finally {
          void ctx.resume();
        }
      });
    }
    const buffer = await ctx.startRendering();
    engine.dispose();
    return buffer;
  }

  /** Peak / RMS / loudest-50ms RMS over [from, to] seconds, all channels. */
  static analyze(buffer: AudioBuffer, from = 0, to = buffer.duration): LevelStats {
    const sr = buffer.sampleRate;
    const a = Math.max(0, Math.floor(from * sr));
    const b = Math.min(buffer.length, Math.ceil(to * sr));
    const n = Math.max(0, b - a);
    const chans: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
    const energy = new Float64Array(n);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let e = 0;
      for (const ch of chans) {
        const s = ch[a + i];
        const abs = s < 0 ? -s : s;
        if (abs > peak) peak = abs;
        e += s * s;
      }
      e /= chans.length || 1;
      energy[i] = e;
      sum += e;
    }
    const win = Math.max(1, Math.round(0.05 * sr));
    let acc = 0;
    let maxMean = 0;
    for (let i = 0; i < n; i++) {
      acc += energy[i];
      if (i >= win) acc -= energy[i - win];
      const mean = acc / Math.min(i + 1, win);
      if (i >= win - 1 && mean > maxMean) maxMean = mean;
    }
    if (n > 0 && n < win) maxMean = acc / n;
    const rms = n > 0 ? Math.sqrt(sum / n) : 0;
    const mom = Math.sqrt(maxMean);
    return { peak, peakDb: toDb(peak), rms, rmsDb: toDb(rms), maxMomentaryRms: mom, maxMomentaryRmsDb: toDb(mom) };
  }

  // -------------------------------------------------------------------------------------------
  // Internals: graph construction
  // -------------------------------------------------------------------------------------------

  private build(ctx: BaseAudioContext): void {
    const seeded = mulberry32(Math.floor(this.rng() * 4294967296));
    this.noise = makeNoiseBuffers(ctx, seeded);
    this.driveCurve = makeDriveCurve(2.5);

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : this.volume;
    master.connect(ctx.destination);
    const pause = ctx.createGain();
    pause.gain.value = this.userSuspended ? 0 : 1;
    pause.connect(master);
    const clipPre = ctx.createGain();
    clipPre.gain.value = 0.5;
    const clip = ctx.createWaveShaper();
    clip.curve = makeSoftClipCurve();
    clip.oversample = 'none';
    clipPre.connect(clip);
    clip.connect(pause);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 3;
    comp.ratio.value = 20;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    comp.connect(clipPre);
    const mix = ctx.createGain();
    mix.gain.value = MIX_LEVEL;
    mix.connect(comp);

    const gameplay = ctx.createGain();
    gameplay.gain.value = this.paused ? 0 : 1;
    gameplay.connect(mix);
    const bedDuck = ctx.createGain();
    bedDuck.connect(gameplay);
    const duck = ctx.createGain();
    duck.gain.value = this.duck;
    duck.connect(bedDuck);
    const sfxDuck = ctx.createGain();
    sfxDuck.connect(gameplay);

    const mk = (group: AudioGroup, dest: AudioNode): GainNode => {
      const g = ctx.createGain();
      g.gain.value = GROUP_LEVEL[group] * this.groupVolume[group];
      g.connect(dest);
      return g;
    };
    const priority = mk('sfx', gameplay);
    const buses: Record<AudioGroup, GainNode> = {
      sfx: mk('sfx', sfxDuck),
      hum: mk('hum', duck),
      ambience: mk('ambience', duck),
      music: mk('music', duck),
      ui: mk('ui', mix),
    };

    const reverbIn = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = makeReverbIR(ctx, seeded);
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.32;
    reverbIn.connect(conv);
    conv.connect(reverbOut);
    reverbOut.connect(mix);

    this.masterGain = master;
    this.pauseGain = pause;
    this.gameplayBus = gameplay;
    this.duckBus = duck;
    this.sfxDuck = sfxDuck;
    this.bedDuck = bedDuck;
    this.priorityBus = priority;
    this.buses = buses;
    this.reverbIn = reverbIn;

    this.hums = [this.buildHum(ctx, 0, buses.hum), this.buildHum(ctx, 1, buses.hum)];
    this.amb = this.buildAmbience(ctx, buses.ambience);
    this.built = true;
    this.applyAmbience();
  }

  private buildHum(ctx: BaseAudioContext, i: number, dest: AudioNode): HumVoice {
    const pre = ctx.createGain();
    const bladeB = ctx.createGain();
    bladeB.gain.value = 0;
    bladeB.connect(pre);
    const sweep = ctx.createConstantSource();
    sweep.offset.value = -1900;
    const phaseLfo = ctx.createOscillator();
    const phaseDepth = ctx.createGain();
    phaseDepth.gain.value = 0;
    phaseLfo.connect(phaseDepth);
    const oscs: OscillatorNode[] = [];
    const oscGains: GainNode[] = [];
    const freqs: number[] = [];
    for (let k = 0; k < 6; k++) {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.connect(og);
      og.connect(k < 3 ? pre : bladeB);
      sweep.connect(o.detune);
      if (k >= 3) phaseDepth.connect(o.detune); // slow phasing between the two blades
      oscs.push(o);
      oscGains.push(og);
      freqs.push(100);
    }
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    // Clean and saturated paths crossfaded per style (VEXA fully saturated, THANE partly).
    const clean = ctx.createGain();
    pre.connect(clean);
    clean.connect(lp);
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDriveCurve(1.8);
    const rough = ctx.createGain();
    pre.connect(shaper);
    shaper.connect(rough);
    rough.connect(lp);
    const wobble = ctx.createGain();
    lp.connect(wobble);
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.connect(lfoDepth);
    lfoDepth.connect(wobble.gain);
    const drift = ctx.createOscillator();
    const driftDepth = ctx.createGain();
    drift.connect(driftDepth);
    driftDepth.connect(lp.frequency);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.Q.value = 0.9;
    pre.connect(hp);
    const buzz = ctx.createGain();
    hp.connect(buzz);
    const speed = ctx.createGain();
    wobble.connect(speed);
    buzz.connect(speed);
    const gate = ctx.createGain();
    gate.gain.value = 0;
    speed.connect(gate);
    const pan = ctx.createStereoPanner();
    const startPan = i === 0 ? -0.25 : 0.25;
    pan.pan.value = startPan;
    gate.connect(pan);
    pan.connect(dest);
    const h: HumVoice = {
      style: this.humStyles[i],
      oscs,
      oscGains,
      freqs,
      bladeB,
      phaseLfo,
      phaseDepth,
      clean,
      rough,
      lp,
      lpBase: 400,
      wobble,
      lfoDepth,
      drift,
      driftDepth,
      hp,
      buzz,
      buzzBase: 0.3,
      lfo,
      lfoRate: 15,
      speed,
      level: 0.1,
      gate,
      pan,
      sweep,
      on: false,
      lockUntil: 0,
      lastS: 0,
      lastPan: startPan,
    };
    const t = ctx.currentTime;
    this.applyHumStyle(h, h.style, t, true);
    for (const o of oscs) o.start(t);
    lfo.start(t);
    drift.start(t);
    sweep.start(t);
    phaseLfo.start(t);
    this.persistent.push(...oscs, lfo, drift, sweep, phaseLfo);
    return h;
  }

  /** Re-voice a hum in place (no node creation). `immediate` = set values now (build time). */
  private applyHumStyle(h: HumVoice, style: HumStyle, t: number, immediate: boolean): void {
    const d = HUM_STYLES[style];
    h.style = style;
    const tau = immediate ? 0 : 0.015;
    const s = h.lastS;
    const k = 1 + 0.4 * s;
    for (let j = 0; j < h.oscs.length; j++) {
      h.oscs[j].type = d.types[j];
      h.freqs[j] = d.f * d.ratios[j];
      glide(h.oscs[j].frequency, h.freqs[j] * k, t, tau);
      glide(h.oscGains[j].gain, d.gains[j], t, tau);
    }
    glide(h.bladeB.gain, d.blade2, t, tau);
    glide(h.phaseLfo.frequency, d.phaseRate, t, tau);
    glide(h.phaseDepth.gain, d.phaseCents, t, tau);
    glide(h.clean.gain, 1 - d.rough, t, tau);
    glide(h.rough.gain, d.rough, t, tau);
    h.lpBase = d.lp;
    glide(h.lp.frequency, d.lp * (1 + 2.6 * s), t, tau);
    glide(h.lp.Q, d.q, t, tau);
    glide(h.wobble.gain, d.wobble, t, tau);
    glide(h.lfoDepth.gain, d.wobbleDepth, t, tau);
    h.lfoRate = d.lfoRate;
    glide(h.lfo.frequency, d.lfoRate * (1 + 0.45 * s), t, tau);
    glide(h.drift.frequency, d.drift, t, tau);
    glide(h.driftDepth.gain, d.lp * 0.08, t, tau);
    glide(h.hp.frequency, d.hp, t, tau);
    h.buzzBase = d.buzz;
    glide(h.buzz.gain, d.buzz * (1 + 2.5 * s), t, tau);
    h.level = d.level;
    glide(h.speed.gain, d.level * (1 + 2.3 * s), t, tau);
  }

  // -------------------------------------------------------------------------------------------
  // Internals: continuous effect loops (built lazily on first activation, then reused)
  // -------------------------------------------------------------------------------------------

  private loopVoice(ctx: BaseAudioContext, dest: AudioNode, level: number, tauIn: number, tauOut: number): LoopVoice {
    const gate = ctx.createGain();
    gate.gain.value = 0;
    const pan = ctx.createStereoPanner();
    gate.connect(pan);
    pan.connect(dest);
    return { gate, pan, level, tauIn, tauOut, active: false, lastPan: 0 };
  }

  private startPersistent(ctx: BaseAudioContext, sources: readonly AudioScheduledSourceNode[]): void {
    const t = ctx.currentTime;
    for (const s of sources) {
      if (s instanceof AudioBufferSourceNode) s.start(t, this.rng() * 1.5);
      else s.start(t);
      this.persistent.push(s);
    }
  }

  private loopNoise(ctx: BaseAudioContext, kind: number, rate: number): AudioBufferSourceNode {
    const s = ctx.createBufferSource();
    s.buffer = this.noise[kind];
    s.loop = true;
    s.playbackRate.value = rate;
    return s;
  }

  /** Oscillator for a loop; connects to a node or an AudioParam, optionally through a fixed gain. */
  private loopOsc(ctx: BaseAudioContext, type: OscillatorType, freq: number, dest: AudioNode | AudioParam | null, gain = 1): OscillatorNode {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (dest === null) return o;
    let src: AudioNode = o;
    if (gain !== 1) {
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g);
      src = g;
    }
    if (dest instanceof AudioParam) src.connect(dest);
    else src.connect(dest);
    return o;
  }

  /** Force choke: eerie resonant low hum + strained high whine + slow tremolo + pressure bed. */
  private buildGrip(ctx: BaseAudioContext, dest: AudioNode): LoopVoice {
    const l = this.loopVoice(ctx, dest, 0.55, 0.027, 0.027);
    const trem = ctx.createGain();
    trem.gain.value = 0.7;
    trem.connect(l.gate);
    const tremLfo = this.loopOsc(ctx, 'sine', 3.2, trem.gain, 0.3);
    // low resonant hum with a slowly wandering formant
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 220;
    bp.Q.value = 7;
    const gLow = ctx.createGain();
    gLow.gain.value = 2.2;
    bp.connect(gLow);
    gLow.connect(trem);
    const bpLfo = this.loopOsc(ctx, 'sine', 0.4, bp.frequency, 55);
    const s1 = this.loopOsc(ctx, 'sawtooth', 55, bp);
    const s2 = this.loopOsc(ctx, 'sawtooth', 55.6, bp);
    const sub = this.loopOsc(ctx, 'sine', 110, trem, 0.16);
    // strained whine with vibrato
    const whine = ctx.createGain();
    whine.gain.value = 0.035;
    whine.connect(trem);
    const w1 = this.loopOsc(ctx, 'sine', 1850, whine);
    const w2 = this.loopOsc(ctx, 'sine', 2470, whine, 0.5);
    const vib = this.loopOsc(ctx, 'sine', 5.5, null);
    const vd1 = ctx.createGain();
    vd1.gain.value = 22;
    vib.connect(vd1);
    vd1.connect(w1.frequency);
    const vd2 = ctx.createGain();
    vd2.gain.value = 29;
    vib.connect(vd2);
    vd2.connect(w2.frequency);
    // pressure bed
    const press = this.loopNoise(ctx, BROWN, 1);
    const plp = ctx.createBiquadFilter();
    plp.type = 'lowpass';
    plp.frequency.value = 380;
    const gPress = ctx.createGain();
    gPress.gain.value = 0.3;
    press.connect(plp);
    plp.connect(gPress);
    gPress.connect(trem);
    this.startPersistent(ctx, [tremLfo, bpLfo, s1, s2, sub, w1, w2, vib, press]);
    return l;
  }

  /** Force lightning: rectified-noise bursts gating hiss + a driven 120 Hz harmonic buzz, plus spark clicks. */
  private buildLightning(ctx: BaseAudioContext, dest: AudioNode): LoopVoice {
    const l = this.loopVoice(ctx, dest, 0.8, 0.012, 0.027);
    // bursty positive envelope: fast brown noise through a half-wave rectifier
    const envSrc = this.loopNoise(ctx, BROWN, 7);
    const rect = ctx.createWaveShaper();
    rect.curve = makeRectifierCurve();
    envSrc.connect(rect);
    // noise bursts
    const hiss = this.loopNoise(ctx, WHITE, 1);
    const hhp = ctx.createBiquadFilter();
    hhp.type = 'highpass';
    hhp.frequency.value = 1400;
    const burst = ctx.createGain();
    burst.gain.value = 0.16;
    hiss.connect(hhp);
    hhp.connect(burst);
    burst.connect(l.gate);
    const toBurst = ctx.createGain();
    toBurst.gain.value = 1.15;
    rect.connect(toBurst);
    toBurst.connect(burst.gain);
    // sharp clicks
    const sparks = this.loopNoise(ctx, CRACKLE, 1.7);
    const shp = ctx.createBiquadFilter();
    shp.type = 'highpass';
    shp.frequency.value = 2200;
    const gSpark = ctx.createGain();
    gSpark.gain.value = 0.42;
    sparks.connect(shp);
    shp.connect(gSpark);
    gSpark.connect(l.gate);
    // buzzing 120 Hz harmonic tone, driven, chopped and pitch-jittered by the burst envelope
    const pre = ctx.createGain();
    pre.gain.value = 0.38;
    const b1 = this.loopOsc(ctx, 'sawtooth', 120, pre);
    const b2 = this.loopOsc(ctx, 'square', 240, pre, 0.5);
    const b3 = this.loopOsc(ctx, 'sawtooth', 360, pre, 0.3);
    const drive = ctx.createWaveShaper();
    drive.curve = this.driveCurve;
    pre.connect(drive);
    const bhp = ctx.createBiquadFilter();
    bhp.type = 'highpass';
    bhp.frequency.value = 150;
    const blp = ctx.createBiquadFilter();
    blp.type = 'lowpass';
    blp.frequency.value = 3500;
    const buzzAmp = ctx.createGain();
    buzzAmp.gain.value = 0.2;
    drive.connect(bhp);
    bhp.connect(blp);
    blp.connect(buzzAmp);
    buzzAmp.connect(l.gate);
    const toBuzz = ctx.createGain();
    toBuzz.gain.value = 0.45;
    rect.connect(toBuzz);
    toBuzz.connect(buzzAmp.gain);
    const chop = this.loopOsc(ctx, 'square', 47, buzzAmp.gain, 0.08);
    const jitter = ctx.createGain();
    jitter.gain.value = 90;
    rect.connect(jitter);
    jitter.connect(b1.detune);
    jitter.connect(b3.detune);
    this.startPersistent(ctx, [envSrc, hiss, sparks, b1, b2, b3, chop]);
    return l;
  }

  /** Thrown saberstaff: hum + air, amplitude/filter/pitch pulsing at 8-14 Hz (whoom-whoom). */
  private buildSpin(ctx: BaseAudioContext, dest: AudioNode): SpinLoop {
    const base = this.loopVoice(ctx, dest, 0.7, 0.03, 0.05);
    const am = ctx.createGain();
    am.gain.value = 0.55;
    am.connect(base.gate);
    const lfo = this.loopOsc(ctx, 'sine', 10, am.gain, 0.45);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 2;
    lp.connect(am);
    const lpDepth = ctx.createGain();
    lpDepth.gain.value = 650;
    lfo.connect(lpDepth);
    lpDepth.connect(lp.frequency);
    const f = HUM_STYLES.thane.f * 1.14;
    const o1 = this.loopOsc(ctx, 'sawtooth', f, lp, 0.5);
    const o2 = this.loopOsc(ctx, 'sawtooth', f * 1.008, lp, 0.45);
    const o3 = this.loopOsc(ctx, 'triangle', f * 2, lp, 0.2);
    const pd = ctx.createGain();
    pd.gain.value = f * 0.06; // Doppler-ish pitch wobble
    lfo.connect(pd);
    pd.connect(o1.frequency);
    pd.connect(o2.frequency);
    const pd2 = ctx.createGain();
    pd2.gain.value = f * 0.12;
    lfo.connect(pd2);
    pd2.connect(o3.frequency);
    const air = this.loopNoise(ctx, PINK, 1);
    const abp = ctx.createBiquadFilter();
    abp.type = 'bandpass';
    abp.frequency.value = 1100;
    abp.Q.value = 1;
    const gAir = ctx.createGain();
    gAir.gain.value = 0.5;
    air.connect(abp);
    abp.connect(gAir);
    gAir.connect(am);
    this.startPersistent(ctx, [lfo, o1, o2, o3, air]);
    return { gate: base.gate, pan: base.pan, level: base.level, tauIn: base.tauIn, tauOut: base.tauOut, active: false, lastPan: 0, lfo, lastRate: 10 };
  }

  /** Allocation-free per-frame update of a loop's gate and pan. */
  private loopUpdate(l: LoopVoice, active: boolean, x: number, now: number): void {
    const pan = panFor(x);
    if (active !== l.active) {
      l.active = active;
      holdParam(l.gate.gain, now);
      l.gate.gain.setTargetAtTime(active ? l.level : 0, now, active ? l.tauIn : l.tauOut);
      if (active) {
        l.pan.pan.cancelScheduledValues(now);
        l.pan.pan.setValueAtTime(pan, now);
        l.lastPan = pan;
        return;
      }
    }
    if (pan - l.lastPan > 0.004 || l.lastPan - pan > 0.004) {
      l.lastPan = pan;
      l.pan.pan.setTargetAtTime(pan, now, 0.02);
    }
  }

  private buildAmbience(ctx: BaseAudioContext, dest: AudioNode): Ambience {
    const gate = ctx.createGain();
    gate.gain.value = 0;
    gate.connect(dest);
    const pulse = ctx.createGain();
    pulse.gain.value = 0.78;
    pulse.connect(gate);
    const pulseLfo = ctx.createOscillator();
    pulseLfo.frequency.value = 0.21;
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.22;
    pulseLfo.connect(pulseDepth);
    pulseDepth.connect(pulse.gain);

    const brown = ctx.createBufferSource();
    brown.buffer = this.noise[BROWN];
    brown.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 150;
    lp.Q.value = 0.8;
    const gBrown = ctx.createGain();
    gBrown.gain.value = 0.3;
    brown.connect(lp);
    lp.connect(gBrown);
    gBrown.connect(pulse);
    const lpLfo = ctx.createOscillator();
    lpLfo.frequency.value = 0.13;
    const lpDepth = ctx.createGain();
    lpDepth.gain.value = 45;
    lpLfo.connect(lpDepth);
    lpDepth.connect(lp.frequency);

    const pink = ctx.createBufferSource();
    pink.buffer = this.noise[PINK];
    pink.loop = true;
    pink.playbackRate.value = 0.93;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 1.4;
    const gPink = ctx.createGain();
    gPink.gain.value = 0.03;
    pink.connect(bp);
    bp.connect(gPink);
    gPink.connect(gate);

    const sub = ctx.createGain();
    sub.gain.value = 1;
    sub.connect(pulse);
    const freqs = [41.2, 82.4, 123.6, 246.9];
    const gains = [0.06, 0.02, 0.01, 0.004];
    const t = ctx.currentTime;
    for (let k = 0; k < freqs.length; k++) {
      const o = ctx.createOscillator();
      o.frequency.value = freqs[k];
      const g = ctx.createGain();
      g.gain.value = gains[k];
      o.connect(g);
      g.connect(sub);
      o.start(t);
      this.persistent.push(o);
    }
    pulseLfo.start(t);
    lpLfo.start(t);
    brown.start(t);
    pink.start(t, 0.7);
    this.persistent.push(pulseLfo, lpLfo, brown, pink);
    return { gate, active: false };
  }

  private teardownGraph(): void {
    for (const s of this.persistent) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      try {
        s.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.persistent = [];
    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.hums = [];
    this.amb = null;
    this.grip = null;
    this.lightning = null;
    this.spin = null;
    this.buses = null;
    this.masterGain = null;
    this.pauseGain = null;
    this.gameplayBus = null;
    this.duckBus = null;
    this.sfxDuck = null;
    this.bedDuck = null;
    this.priorityBus = null;
    this.reverbIn = null;
    this.built = false;
  }

  // -------------------------------------------------------------------------------------------
  // Internals: state application
  // -------------------------------------------------------------------------------------------

  private ready(): boolean {
    const c = this.ctx;
    if (c === null || !this.built || this.disposed || this.userSuspended) return false;
    return this.offline || c.state === 'running';
  }

  private markUnlocked(): void {
    if (this.unlockedFlag) return;
    this.unlockedFlag = true;
    this.updatePump();
  }

  private kickSilentBuffer(ctx: AudioContext): void {
    // iOS Safari: playing a buffer inside the gesture fully unlocks output.
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch {
      /* ignore */
    }
  }

  /** Pause fade follows userSuspended (repairs a fade left at 0 if a resume() was blocked by autoplay). */
  private applyPauseGain(): void {
    const ctx = this.ctx;
    if (!ctx || !this.pauseGain) return;
    this.pauseGain.gain.setTargetAtTime(this.userSuspended ? 0 : 1, ctx.currentTime, 0.02);
  }

  private applyMaster(): void {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(this.muted ? 0 : this.volume, ctx.currentTime, 0.02);
  }

  private applyAmbience(): void {
    const a = this.amb;
    const ctx = this.ctx;
    if (!a || !ctx || this.disposed || a.active === this.ambienceWanted) return;
    a.active = this.ambienceWanted;
    const now = ctx.currentTime;
    holdParam(a.gate.gain, now);
    a.gate.gain.setTargetAtTime(a.active ? 1 : 0, now, a.active ? 0.5 : 0.2);
    if (a.active) this.nextHiss = now + 2 + this.rng() * 4;
  }

  private updatePump(): void {
    const want = !this.offline && this.unlockedFlag && !this.disposed && (this.ambienceWanted || this.intensity > 0.04);
    if (want && this.pumpTimer === null) {
      const ctx = this.ctx;
      if (ctx) this.nextBeat = ctx.currentTime + 0.1;
      this.pumpTimer = setInterval(() => this.pump(), 50);
    } else if (!want) {
      this.stopPump();
    }
  }

  private stopPump(): void {
    if (this.pumpTimer !== null) clearInterval(this.pumpTimer);
    this.pumpTimer = null;
  }

  /** Lookahead scheduler for steam hisses and the tension pulse (runs on a 50 ms timer, uses context time). */
  private pump(): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready()) return;
    const now = ctx.currentTime;
    if (this.ambienceWanted) {
      if (this.nextHiss < now - 1) this.nextHiss = now + 1 + this.rng() * 4;
      while (this.nextHiss < now + 0.3) {
        this.steamHiss(Math.max(this.nextHiss, now + LOOKAHEAD));
        this.nextHiss += 5 + this.rng() * 9;
      }
    }
    const inten = this.intensity;
    if (inten > 0.04) {
      if (this.nextBeat < now) this.nextBeat = now + 0.05;
      while (this.nextBeat < now + 0.25) {
        const beatLen = 60 / (66 + 54 * inten);
        this.tensionBeat(this.nextBeat, inten, beatLen);
        this.nextBeat += beatLen;
      }
    }
  }

  private steamHiss(at: number): void {
    const x = (this.rng() * 2 - 1) * 9;
    const v = this.begin(null, 0, x, 0.6 + 0.4 * this.rng(), 0.45, this.buses ? this.buses.ambience : null, false, at);
    if (!v) return;
    this.hissCount++;
    const t = v.t;
    const atk = 0.12 + 0.25 * this.rng();
    const hold = 0.3 + 0.8 * this.rng();
    const rel = 0.5 + 0.6 * this.rng();
    const g = this.gain(v, v.out);
    const e = envAHR(g.gain, t, 0.14, atk, hold, rel);
    const hp = this.filter(v, 'highpass', 2400, 0.7, g);
    sweepExp(hp.frequency, t, 2400, 3400, atk + hold + rel);
    this.noiseSrc(v, WHITE, t, e + 0.01, hp);
    const gb = this.gain(v, v.out);
    const eb = envAHR(gb.gain, t, 0.05, atk, hold, rel);
    this.noiseSrc(v, PINK, t, eb + 0.01, this.filter(v, 'bandpass', 900, 0.7, gb));
    this.end(v);
  }

  private tensionBeat(at: number, inten: number, beatLen: number): void {
    const v = this.begin(null, 0, 0, 1, 0.05, this.buses ? this.buses.music : null, false, at);
    if (!v) return;
    this.beatCount++;
    const t = v.t;
    const g1 = this.gain(v, v.out);
    const e1 = envAD(g1.gain, t, 0.5 * inten, 0.004, 0.25);
    const o1 = this.osc(v, 'sine', 64, t, e1 + 0.01, g1);
    o1.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    const t2 = t + 0.17;
    const g2 = this.gain(v, v.out);
    const e2 = envAD(g2.gain, t2, 0.3 * inten, 0.004, 0.22);
    const o2 = this.osc(v, 'sine', 60, t2, e2 + 0.01, g2);
    o2.frequency.exponentialRampToValueAtTime(42, t2 + 0.11);
    if (inten > 0.55) {
      const t3 = t + beatLen * 0.5;
      const g3 = this.gain(v, v.out);
      const e3 = envAD(g3.gain, t3, (inten - 0.55) * 0.35, 0.001, 0.04);
      this.noiseSrc(v, WHITE, t3, e3 + 0.01, this.filter(v, 'highpass', 6500, 0.7, g3));
    }
    this.end(v);
  }

  // -------------------------------------------------------------------------------------------
  // Internals: voice helpers
  // -------------------------------------------------------------------------------------------

  private pitchVar(): number {
    return 1 + (this.rng() - 0.5) * 0.12; // +/-6 %
  }

  private gainVar(): number {
    return 1 + (this.rng() - 0.5) * 0.16; // ~ +/-0.7 dB
  }

  private begin(
    key: string | null,
    cooldown: number,
    x: number,
    gain: number,
    send: number,
    bus: GainNode | null,
    critical: boolean,
    at?: number,
  ): Voice | null {
    const ctx = this.ctx;
    if (ctx === null || !this.ready() || !this.buses) return null;
    const now = ctx.currentTime;
    if (key !== null && cooldown > 0) {
      const last = this.lastPlayed.get(key);
      if (last !== undefined && now - last < cooldown && now >= last) return null;
      this.lastPlayed.set(key, now);
    }
    if (!critical && this.activeVoices >= MAX_VOICES) return null;
    const out = ctx.createGain();
    out.gain.value = gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = panFor(x);
    out.connect(pan);
    pan.connect(bus ?? this.buses.sfx);
    const nodes: AudioNode[] = [out, pan];
    if (send > 0 && this.reverbIn) {
      const s = ctx.createGain();
      s.gain.value = send;
      pan.connect(s);
      s.connect(this.reverbIn);
      nodes.push(s);
    }
    this.activeVoices++;
    const start = now + LOOKAHEAD;
    return { ctx, t: at !== undefined && at > start ? at : start, out, nodes, last: null, end: 0 };
  }

  private end(v: Voice): void {
    const last = v.last;
    const cleanup = (): void => {
      for (const n of v.nodes) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    if (last) last.onended = cleanup;
    else cleanup();
  }

  private track(v: Voice, s: AudioScheduledSourceNode, stop: number): void {
    v.nodes.push(s);
    if (stop >= v.end) {
      v.end = stop;
      v.last = s;
    }
  }

  private gain(v: Voice, dest: AudioNode, value = 0): GainNode {
    const g = v.ctx.createGain();
    g.gain.value = value;
    g.connect(dest);
    v.nodes.push(g);
    return g;
  }

  private filter(v: Voice, type: BiquadFilterType, freq: number, q: number, dest: AudioNode): BiquadFilterNode {
    const f = v.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    v.nodes.push(f);
    return f;
  }

  private osc(v: Voice, type: OscillatorType, freq: number, t: number, stop: number, dest: AudioNode): OscillatorNode {
    const o = v.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(stop);
    this.track(v, o, stop);
    return o;
  }

  private lfo(v: Voice, type: OscillatorType, freq: number, depth: number, t: number, stop: number, param: AudioParam): OscillatorNode {
    const o = v.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const d = v.ctx.createGain();
    d.gain.value = depth;
    o.connect(d);
    d.connect(param);
    v.nodes.push(d);
    o.start(t);
    o.stop(stop);
    this.track(v, o, stop);
    return o;
  }

  /** Extra stereo offset inside a voice (e.g. the two ends of a saberstaff). */
  private panNode(v: Voice, pan: number, dest: AudioNode): StereoPannerNode {
    const p = v.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(dest);
    v.nodes.push(p);
    return p;
  }

  /** Brief sidechain dip of the sfx bus and the hum/ambience beds so a priority sound reads clearly. */
  private autoDuck(t: number, sfxDepth: number, bedDepth: number, hold: number, release: number): void {
    const a = this.sfxDuck;
    const b = this.bedDuck;
    if (!a || !b) return;
    holdParam(a.gain, t);
    a.gain.setTargetAtTime(sfxDepth, t, 0.004);
    a.gain.setTargetAtTime(1, t + hold, release / 3);
    holdParam(b.gain, t);
    b.gain.setTargetAtTime(bedDepth, t, 0.004);
    b.gain.setTargetAtTime(1, t + hold, release / 3);
  }

  private noiseSrc(v: Voice, kind: number, t: number, stop: number, dest: AudioNode, rate = 1): AudioBufferSourceNode {
    const buf = this.noise[kind];
    const s = v.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(dest);
    s.start(t, this.rng() * Math.max(0, buf.duration - 0.05));
    s.stop(stop);
    this.track(v, s, stop);
    return s;
  }

  private partials(
    v: Voice,
    base: number,
    ratios: readonly number[],
    gains: readonly number[],
    decays: readonly number[],
    t: number,
    dest: AudioNode,
  ): number {
    let end = t;
    const n = Math.min(ratios.length, gains.length, decays.length);
    for (let k = 0; k < n; k++) {
      const g = this.gain(v, dest);
      const e = envAD(g.gain, t, gains[k], 0.002, decays[k]);
      this.osc(v, 'sine', base * ratios[k], t, e + 0.01, g);
      if (e > end) end = e;
    }
    return end;
  }

  /** Brass-like synth chord: detuned saw pairs, pitch scoop, filter "blat" envelope. */
  private brass(
    v: Voice,
    root: number,
    semis: readonly number[],
    t: number,
    hold: number,
    peak: number,
    bright: number,
    dest: AudioNode = v.out,
  ): number {
    const g = this.gain(v, dest);
    const end = envAHR(g.gain, t, peak, 0.025, hold, 0.3);
    const lp = this.filter(v, 'lowpass', 300, 1.2, g);
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(bright, t + 0.06);
    lp.frequency.exponentialRampToValueAtTime(bright * 0.55, t + 0.07 + hold);
    const mixG = this.gain(v, lp, 1 / Math.sqrt(semis.length * 2));
    for (let s = 0; s < semis.length; s++) {
      const f = root * Math.pow(2, semis[s] / 12);
      for (let k = 0; k < DETUNE_PAIR.length; k++) {
        const o = this.osc(v, 'sawtooth', f, t, end + 0.02, mixG);
        o.detune.setValueAtTime(DETUNE_PAIR[k] - 35, t);
        o.detune.linearRampToValueAtTime(DETUNE_PAIR[k], t + 0.06);
      }
    }
    return end;
  }
}
