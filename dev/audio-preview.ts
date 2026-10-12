import { AudioEngine, type FighterIndex, type HumStyle, type LevelStats, type OfflineEvent } from '../src/audio/AudioEngine';

/** Local mulberry32 so this page does not depend on files the lead may be rewriting. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const engine = new AudioEngine(seeded(1337));

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

const fighterSel = el<HTMLSelectElement>('fighter');
const xInput = el<HTMLInputElement>('x');
const strengthInput = el<HTMLInputElement>('strength');
const roundInput = el<HTMLInputElement>('round');
const tipInput = el<HTMLInputElement>('tip');
const on0 = el<HTMLInputElement>('on0');
const on1 = el<HTMLInputElement>('on1');
const status = el<HTMLSpanElement>('status');

const charInput = el<HTMLInputElement>('char');
const gripBox = el<HTMLInputElement>('grip');
const lightningBox = el<HTMLInputElement>('lightning');
const spinBox = el<HTMLInputElement>('spin');
const spinSpeedInput = el<HTMLInputElement>('spin-speed');

const fighter = (): FighterIndex => (fighterSel.value === '1' ? 1 : 0);
const xVal = (): number => Number(xInput.value);
const strength = (): number => Number(strengthInput.value);

const STYLES: readonly HumStyle[] = ['kael', 'vexa', 'asha', 'thane'];
const asStyle = (v: string): HumStyle => STYLES.find((s) => s === v) ?? 'kael';
for (const i of [0, 1] as const) {
  el<HTMLSelectElement>(`style${i}`).addEventListener('change', (e) => {
    engine.setHumStyle(i, asStyle((e.target as HTMLSelectElement).value));
  });
}

function bindOutput(input: HTMLInputElement, outId: string): void {
  const out = el<HTMLOutputElement>(outId);
  const sync = (): void => {
    out.textContent = input.value;
  };
  input.addEventListener('input', sync);
  sync();
}
bindOutput(xInput, 'x-out');
bindOutput(strengthInput, 'strength-out');
bindOutput(tipInput, 'tip-out');
bindOutput(spinSpeedInput, 'spin-speed-out');

// ---------------------------------------------------------------------------------------------
// Buttons for every one-shot
// ---------------------------------------------------------------------------------------------

type Action = [label: string, run: () => void];

const actions: Action[] = [
  ['ignite', () => {
    engine.ignite(fighter(), xVal());
    (fighter() === 0 ? on0 : on1).checked = true;
  }],
  ['retract', () => {
    engine.retract(fighter(), xVal());
    (fighter() === 0 ? on0 : on1).checked = false;
  }],
  ['swing', () => engine.swing(fighter(), strength(), xVal())],
  ['hit', () => engine.hit(strength(), xVal())],
  ['block', () => engine.block(xVal())],
  ['clash', () => engine.clash(xVal())],
  ['forceCharge', () => engine.forceCharge(xVal())],
  ['forcePush', () => engine.forcePush(xVal())],
  ['forceImpact', () => engine.forceImpact(xVal())],
  ['throwHit', () => engine.throwHit(xVal())],
  ['jump', () => engine.jump(xVal())],
  ['land', () => engine.land(xVal())],
  ['dash', () => engine.dash(xVal())],
  ['step', () => engine.step(xVal())],
  ['knockdown', () => engine.knockdown(xVal())],
  ['superFlash', () => engine.superFlash()],
  ['ko', () => engine.ko()],
  ['roundStart', () => engine.roundStart(Number(roundInput.value))],
  ['fight', () => engine.fight()],
  ['timeWarning', () => engine.timeWarning()],
  ['victory', () => engine.victory()],
  ['uiMove', () => engine.uiMove()],
  ['uiSelect', () => engine.uiSelect()],
  ['uiBack', () => engine.uiBack()],
  ['parry', () => engine.parry(xVal())],
  ['parried', () => engine.parried(xVal())],
  ['runStep', () => engine.runStep(xVal())],
  ['skid', () => engine.skid(xVal())],
  ['bodyBounce', () => engine.bodyBounce(xVal())],
  ['slide', () => engine.slide(xVal())],
  ['flip', () => engine.flip(xVal())],
  ['leap', () => engine.leap(xVal())],
  ['gripStart', () => {
    engine.gripStart(xVal());
    gripBox.checked = true;
  }],
  ['lightningHit', () => engine.lightningHit(xVal())],
  ['staffThrow', () => {
    engine.staffThrow(xVal());
    spinBox.checked = true;
  }],
  ['staffCatch', () => {
    engine.staffCatch(xVal());
    spinBox.checked = false;
  }],
  ['characterSelect', () => engine.characterSelect(Number(charInput.value))],
  ['versus', () => engine.versus()],
];

const buttonsHost = el<HTMLDivElement>('buttons');
for (const [label, run] of actions) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.dataset.action = label;
  b.addEventListener('click', () => {
    void engine.unlock();
    run();
  });
  buttonsHost.appendChild(b);
}

// ---------------------------------------------------------------------------------------------
// Unlock + mix controls
// ---------------------------------------------------------------------------------------------

function refreshStatus(): void {
  const s = engine.getDebugState();
  status.textContent =
    `${s.unlocked ? 'unlocked' : 'locked'} | ctx ${s.contextState} | voices ${s.activeVoices}` +
    ` | hum ${s.humOn[0] ? s.humStyles[0] : '-'} / ${s.humOn[1] ? s.humStyles[1] : '-'}` +
    ` | loops ${s.grip ? 'G' : '-'}${s.lightning ? 'L' : '-'}${s.spinningBlade ? 'S' : '-'}`;
}

el<HTMLButtonElement>('unlock').addEventListener('click', () => {
  void engine.unlock().then(refreshStatus);
});
el<HTMLInputElement>('volume').addEventListener('input', (e) => engine.setMasterVolume(Number((e.target as HTMLInputElement).value)));
el<HTMLInputElement>('mute').addEventListener('change', (e) => engine.setMuted((e.target as HTMLInputElement).checked));
el<HTMLInputElement>('duck').addEventListener('input', (e) => engine.setDuck(Number((e.target as HTMLInputElement).value)));
el<HTMLInputElement>('intensity').addEventListener('input', (e) => engine.setIntensity(Number((e.target as HTMLInputElement).value)));
el<HTMLInputElement>('ambience').addEventListener('change', (e) => engine.setAmbience((e.target as HTMLInputElement).checked));
el<HTMLInputElement>('paused').addEventListener('change', (e) => engine.setPaused((e.target as HTMLInputElement).checked));
el<HTMLButtonElement>('suspend').addEventListener('click', () => engine.suspend());
el<HTMLButtonElement>('resume').addEventListener('click', () => engine.resume());

// ---------------------------------------------------------------------------------------------
// Per-frame hum driver + swing sweep
// ---------------------------------------------------------------------------------------------

let sweepStart = -1;
const SWEEP_MS = 300;
const SWEEP_PEAK = 22;

function startSweep(): void {
  sweepStart = performance.now();
}
el<HTMLButtonElement>('sweep').addEventListener('click', () => {
  void engine.unlock();
  startSweep();
});

function frame(now: number): void {
  let tip = Number(tipInput.value);
  if (sweepStart >= 0) {
    const u = (now - sweepStart) / SWEEP_MS;
    if (u >= 1) sweepStart = -1;
    else tip = Math.max(tip, SWEEP_PEAK * Math.sin(Math.PI * u));
  }
  const f = fighter();
  engine.updateSaber(0, on0.checked, f === 0 ? xVal() : -3, f === 0 ? tip : 0);
  engine.updateSaber(1, on1.checked, f === 1 ? xVal() : 3, f === 1 ? tip : 0);
  engine.setGrip(gripBox.checked, xVal());
  engine.setLightning(lightningBox.checked, xVal());
  engine.setSpinningBlade(spinBox.checked, Math.sin(now / 450) * 7, Number(spinSpeedInput.value));
  refreshStatus();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------------------------
// Offline measurement
// ---------------------------------------------------------------------------------------------

interface Scenario {
  name: string;
  duration: number;
  events: OfflineEvent[];
  from?: number;
  to?: number;
  /** Also report RMS inside a band-pass [centerHz, Q] (cut-through measurement). */
  band?: [number, number];
}

/** RBJ band-pass (0 dB peak) run over the whole buffer; RMS (dBFS) of the filtered signal inside [from, to]. */
function bandRmsDb(buf: AudioBuffer, from: number, to: number, f0: number, q: number): number {
  const sr = buf.sampleRate;
  const w0 = (2 * Math.PI * f0) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w0)) / a0;
  const a2 = (1 - alpha) / a0;
  const start = Math.floor(from * sr);
  const end = Math.min(buf.length, Math.ceil(to * sr));
  let sum = 0;
  let count = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < end; i++) {
      const x = d[i];
      const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      if (i >= start) {
        sum += y * y;
        count++;
      }
    }
  }
  return 20 * Math.log10(Math.max(1e-9, Math.sqrt(sum / Math.max(1, count))));
}

const ev = (at: number, run: (e: AudioEngine) => void): OfflineEvent => ({ at, run });

const scenarios: Scenario[] = [
  { name: 'hum idle (KAEL)', duration: 2, from: 1, to: 2, events: [ev(0, (e) => e.updateSaber(0, true, 0, 0))] },
  { name: 'hum idle (VEXA)', duration: 2, from: 1, to: 2, events: [ev(0, (e) => e.updateSaber(1, true, 0, 0))] },
  { name: 'hum idle (both)', duration: 2, from: 1, to: 2, events: [ev(0, (e) => { e.updateSaber(0, true, -3, 0); e.updateSaber(1, true, 3, 0); })] },
  { name: 'hum full swing (KAEL, tip 25)', duration: 2, from: 1, to: 2, events: [ev(0, (e) => e.updateSaber(0, true, 0, 25))] },
  { name: 'hum full swing (VEXA, tip 25)', duration: 2, from: 1, to: 2, events: [ev(0, (e) => e.updateSaber(1, true, 0, 25))] },
  { name: 'ambience bed', duration: 6, from: 4, to: 6, events: [ev(0, (e) => e.setAmbience(true))] },
  { name: 'ignite', duration: 1.2, events: [ev(0.05, (e) => e.ignite(0, 0))] },
  { name: 'retract (after ignite, from 1.0 s)', duration: 2, from: 1, events: [ev(0.05, (e) => e.ignite(0, 0)), ev(1, (e) => e.retract(0, 0))] },
  { name: 'swing(1)', duration: 1, events: [ev(0.05, (e) => e.swing(0, 1, 0))] },
  { name: 'hit(0.3)', duration: 1, events: [ev(0.05, (e) => e.hit(0.3, 0))] },
  { name: 'hit(1)', duration: 1.2, events: [ev(0.05, (e) => e.hit(1, 0))] },
  { name: 'block', duration: 1, events: [ev(0.05, (e) => e.block(0))] },
  { name: 'clash', duration: 1.6, events: [ev(0.05, (e) => e.clash(0))] },
  { name: 'forceCharge', duration: 1.2, events: [ev(0.05, (e) => e.forceCharge(0))] },
  { name: 'forcePush', duration: 1.2, events: [ev(0.05, (e) => e.forcePush(0))] },
  { name: 'forceImpact', duration: 1.2, events: [ev(0.05, (e) => e.forceImpact(0))] },
  { name: 'throwHit', duration: 1, events: [ev(0.05, (e) => e.throwHit(0))] },
  { name: 'knockdown', duration: 1.4, events: [ev(0.05, (e) => e.knockdown(0))] },
  { name: 'step', duration: 0.5, events: [ev(0.05, (e) => e.step(0))] },
  { name: 'jump', duration: 0.5, events: [ev(0.05, (e) => e.jump(0))] },
  { name: 'land', duration: 0.5, events: [ev(0.05, (e) => e.land(0))] },
  { name: 'dash', duration: 0.6, events: [ev(0.05, (e) => e.dash(0))] },
  { name: 'superFlash', duration: 2, events: [ev(0.05, (e) => e.superFlash())] },
  { name: 'ko', duration: 4.5, events: [ev(0.05, (e) => e.ko())] },
  { name: 'roundStart(1)', duration: 1.6, events: [ev(0.05, (e) => e.roundStart(1))] },
  { name: 'fight', duration: 1.2, events: [ev(0.05, (e) => e.fight())] },
  { name: 'victory', duration: 2.5, events: [ev(0.05, (e) => e.victory())] },
  { name: 'timeWarning', duration: 0.5, events: [ev(0.05, (e) => e.timeWarning())] },
  { name: 'uiMove', duration: 0.4, events: [ev(0.05, (e) => e.uiMove())] },
  { name: 'uiSelect', duration: 0.6, events: [ev(0.05, (e) => e.uiSelect())] },
  { name: 'uiBack', duration: 0.6, events: [ev(0.05, (e) => e.uiBack())] },
  // ---- 4-fighter expansion ----
  { name: 'hum idle (ASHA dual)', duration: 2, from: 1, to: 2, events: [ev(0, (e) => { e.setHumStyle(0, 'asha'); e.updateSaber(0, true, 0, 0); })] },
  { name: 'hum idle (THANE staff)', duration: 2, from: 1, to: 2, events: [ev(0, (e) => { e.setHumStyle(1, 'thane'); e.updateSaber(1, true, 0, 0); })] },
  { name: 'hum full swing (ASHA, tip 25)', duration: 2, from: 1, to: 2, events: [ev(0, (e) => { e.setHumStyle(0, 'asha'); e.updateSaber(0, true, 0, 25); })] },
  { name: 'hum full swing (THANE, tip 25)', duration: 2, from: 1, to: 2, events: [ev(0, (e) => { e.setHumStyle(1, 'thane'); e.updateSaber(1, true, 0, 25); })] },
  { name: 'ignite (ASHA, 2 snaps 70 ms)', duration: 1.4, events: [ev(0, (e) => e.setHumStyle(0, 'asha')), ev(0.05, (e) => e.ignite(0, 0))] },
  { name: 'ignite (THANE, 2 snaps 150 ms)', duration: 1.4, events: [ev(0, (e) => e.setHumStyle(1, 'thane')), ev(0.05, (e) => e.ignite(1, 0))] },
  { name: 'parry', duration: 1.2, events: [ev(0.05, (e) => e.parry(0))] },
  { name: 'parried', duration: 1, events: [ev(0.05, (e) => e.parried(0))] },
  { name: 'runStep', duration: 0.5, events: [ev(0.05, (e) => e.runStep(0))] },
  { name: 'skid', duration: 0.7, events: [ev(0.05, (e) => e.skid(0))] },
  { name: 'bodyBounce', duration: 1, events: [ev(0.05, (e) => e.bodyBounce(0))] },
  { name: 'slide', duration: 0.8, events: [ev(0.05, (e) => e.slide(0))] },
  { name: 'flip', duration: 0.8, events: [ev(0.05, (e) => e.flip(0))] },
  { name: 'leap', duration: 1, events: [ev(0.05, (e) => e.leap(0))] },
  { name: 'gripStart', duration: 1, events: [ev(0.05, (e) => e.gripStart(0))] },
  { name: 'lightningHit', duration: 0.8, events: [ev(0.05, (e) => e.lightningHit(0))] },
  { name: 'staffThrow', duration: 0.9, events: [ev(0.05, (e) => e.staffThrow(0))] },
  { name: 'staffCatch', duration: 0.8, events: [ev(0.05, (e) => e.staffCatch(0))] },
  { name: 'characterSelect(0)', duration: 1, events: [ev(0.05, (e) => e.characterSelect(0))] },
  { name: 'characterSelect(1)', duration: 1, events: [ev(0.05, (e) => e.characterSelect(1))] },
  { name: 'characterSelect(2)', duration: 1, events: [ev(0.05, (e) => e.characterSelect(2))] },
  { name: 'characterSelect(3)', duration: 1, events: [ev(0.05, (e) => e.characterSelect(3))] },
  { name: 'versus', duration: 2.2, events: [ev(0.05, (e) => e.versus())] },
  { name: 'LOOP lightning (1 s)', duration: 1.2, from: 0.1, to: 1.1, events: [ev(0, (e) => e.setLightning(true, 0))] },
  { name: 'LOOP grip (1 s)', duration: 1.2, from: 0.1, to: 1.1, events: [ev(0, (e) => e.setGrip(true, 0))] },
  {
    name: 'LOOP spinning blade (1 s, speed 0.6, x per frame)',
    duration: 1.2,
    from: 0.1,
    to: 1.1,
    events: Array.from({ length: 70 }, (_, k) => ev(k / 60, (e) => e.setSpinningBlade(true, Math.sin((k / 60) * Math.PI * 2) * 7, 0.6))),
  },
  {
    name: 'BUSY mix (no parry), window 0.6-0.9 s',
    duration: 1.2,
    from: 0.6,
    to: 0.9,
    band: [3200, 0.8],
    events: [
      ev(0, (e) => { e.setHumStyle(0, 'asha'); e.setHumStyle(1, 'thane'); e.updateSaber(0, true, -2, 25); e.updateSaber(1, true, 2, 25); e.setLightning(true, 1); e.setGrip(true, -1); }),
      ev(0.6, (e) => { e.hit(1, 0); e.clash(0); }),
    ],
  },
  {
    name: 'BUSY mix + parry, window 0.6-0.9 s',
    duration: 1.2,
    from: 0.6,
    to: 0.9,
    band: [3200, 0.8],
    events: [
      ev(0, (e) => { e.setHumStyle(0, 'asha'); e.setHumStyle(1, 'thane'); e.updateSaber(0, true, -2, 25); e.updateSaber(1, true, 2, 25); e.setLightning(true, 1); e.setGrip(true, -1); }),
      ev(0.6, (e) => { e.hit(1, 0); e.clash(0); e.parry(0); }),
    ],
  },
  {
    name: 'OVERLAP2 dual hums@25 + loops + parry + KO + clash + hit',
    duration: 4.5,
    events: [
      ev(0, (e) => {
        e.setHumStyle(0, 'asha'); e.setHumStyle(1, 'thane'); e.setAmbience(true); e.setIntensity(1);
        e.updateSaber(0, true, -2, 25); e.updateSaber(1, true, 2, 25);
        e.setLightning(true, 0); e.setGrip(true, 1); e.setSpinningBlade(true, -1, 1);
      }),
      ev(0.6, (e) => {
        e.ko(); e.parry(0); e.clash(0); e.hit(1, 0); e.lightningHit(0); e.gripStart(0); e.leap(0); e.versus();
        e.superFlash(); e.knockdown(0); e.forceImpact(0); e.staffCatch(0); e.parried(1); e.characterSelect(3);
      }),
      ev(0.65, (e) => { e.hit(1, 1); e.clash(1); e.parry(1); }),
      ev(0.72, (e) => { e.hit(1, -1); e.clash(-1); e.bodyBounce(0); e.skid(0); }),
    ],
  },
  {
    name: 'OVERLAP hums@25 + ambience + clash + hit(1) + ko',
    duration: 4.5,
    events: [
      ev(0, (e) => { e.setAmbience(true); e.updateSaber(0, true, -2, 25); e.updateSaber(1, true, 2, 25); }),
      ev(0.6, (e) => { e.clash(0); e.hit(1, 0.5); e.ko(); }),
    ],
  },
  {
    name: 'STRESS everything at once',
    duration: 4.5,
    events: [
      ev(0, (e) => { e.setAmbience(true); e.setIntensity(1); e.updateSaber(0, true, -2, 25); e.updateSaber(1, true, 2, 25); }),
      ev(0.6, (e) => {
        e.clash(0); e.hit(1, 0); e.ko(); e.superFlash(); e.forceImpact(0); e.knockdown(0); e.throwHit(0);
        e.block(0); e.forcePush(0); e.fight(); e.roundStart(3); e.victory(); e.swing(0, 1, 0); e.swing(1, 1, 0);
      }),
      ev(0.64, (e) => e.hit(1, 1)),
      ev(0.68, (e) => { e.clash(1); e.hit(1, -1); }),
      ev(0.75, (e) => { e.hit(1, 2); e.clash(-2); }),
    ],
  },
];

export interface ScenarioResult extends LevelStats {
  name: string;
  bandDb?: number;
}

async function measureLevels(): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const s of scenarios) {
    const buf = await AudioEngine.renderOffline(seeded(42), s.duration, s.events);
    if (!buf) throw new Error('OfflineAudioContext unavailable');
    const from = s.from ?? 0;
    const to = s.to ?? buf.duration;
    const row: ScenarioResult = { name: s.name, ...AudioEngine.analyze(buf, from, to) };
    if (s.band) row.bandDb = bandRmsDb(buf, from, to, s.band[0], s.band[1]);
    results.push(row);
  }
  return results;
}

function formatLevels(rows: ScenarioResult[]): string {
  const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
  const num = (v: number): string => v.toFixed(3);
  const db = (v: number): string => `${v.toFixed(1)} dB`;
  const lines = [`${pad('scenario', 62)}${pad('peak', 18)}${pad('rms', 18)}max 50ms rms`];
  for (const r of rows) {
    lines.push(
      `${pad(r.name, 62)}${pad(`${num(r.peak)} ${db(r.peakDb)}`, 18)}${pad(`${num(r.rms)} ${db(r.rmsDb)}`, 18)}${num(r.maxMomentaryRms)} ${db(r.maxMomentaryRmsDb)}${r.bandDb !== undefined ? `   [2-5 kHz band rms ${db(r.bandDb)}]` : ''}`,
    );
  }
  return lines.join('\n');
}

el<HTMLButtonElement>('measure').addEventListener('click', () => {
  const out = el<HTMLPreElement>('levels');
  out.textContent = 'rendering...';
  measureLevels().then(
    (rows) => {
      out.textContent = formatLevels(rows);
    },
    (err: unknown) => {
      out.textContent = `error: ${String(err)}`;
    },
  );
});

// ---------------------------------------------------------------------------------------------
// Scripted test hooks
// ---------------------------------------------------------------------------------------------

/** Calls every public method with a spread of arguments (including bad ones). */
function callEverything(target: AudioEngine): number {
  let calls = 0;
  const c = (fn: () => void): void => {
    fn();
    calls++;
  };
  const xs = [-9, -3, 0, 4.5, 9, 20, Number.NaN];
  c(() => target.setMasterVolume(0.9));
  c(() => target.setMuted(false));
  c(() => target.isMuted());
  c(() => target.setDuck(0.5));
  c(() => target.setDuck(1));
  c(() => target.setAmbience(true));
  c(() => target.setIntensity(0.7));
  for (const i of [0, 1] as const) {
    c(() => target.ignite(i, xs[i]));
    c(() => target.updateSaber(i, true, xs[i + 1], 0));
    c(() => target.updateSaber(i, true, xs[i + 2], 25));
    c(() => target.updateSaber(i, true, xs[6], Number.NaN));
    c(() => target.swing(i, 0.2, xs[i]));
    c(() => target.swing(i, 1.5, xs[i + 3]));
  }
  for (const x of xs) {
    c(() => target.hit(Math.abs(x) / 9, x));
    c(() => target.block(x));
    c(() => target.step(x));
  }
  c(() => target.clash(0));
  c(() => target.forceCharge(-4));
  c(() => target.forcePush(-4));
  c(() => target.forceImpact(4));
  c(() => target.throwHit(1));
  c(() => target.jump(-2));
  c(() => target.land(-2));
  c(() => target.dash(3));
  c(() => target.knockdown(5));
  c(() => target.superFlash());
  c(() => target.ko());
  for (const r of [1, 2, 3, 9, Number.NaN]) c(() => target.roundStart(r));
  c(() => target.fight());
  c(() => target.timeWarning());
  c(() => target.victory());
  // 4-fighter expansion
  for (const st of STYLES) {
    for (const i of [0, 1] as const) {
      c(() => target.setHumStyle(i, st));
      c(() => target.ignite(i, xs[i + 2]));
      c(() => target.updateSaber(i, true, xs[i + 1], 12));
    }
  }
  c(() => target.setHumStyle(0, 'nope' as HumStyle)); // ignored at runtime
  for (const x of xs) {
    c(() => target.parry(x));
    c(() => target.runStep(x));
    c(() => target.setGrip(true, x));
    c(() => target.setLightning(true, x));
    c(() => target.setSpinningBlade(true, x, Math.abs(x) / 9));
  }
  c(() => target.setSpinningBlade(true, 0, Number.NaN));
  c(() => target.setSpinningBlade(true, 0, 99));
  c(() => target.parried(2));
  c(() => target.skid(-2));
  c(() => target.bodyBounce(3));
  c(() => target.slide(3));
  c(() => target.flip(-1));
  c(() => target.leap(1));
  c(() => target.gripStart(-3));
  c(() => target.lightningHit(3));
  c(() => target.staffThrow(-4));
  c(() => target.staffCatch(4));
  for (const k of [0, 1, 2, 3, 7, -1, 2.6, Number.NaN]) c(() => target.characterSelect(k));
  c(() => target.versus());
  c(() => target.setGrip(false, 0));
  c(() => target.setLightning(false, 0));
  c(() => target.setSpinningBlade(false, 0, 0));
  c(() => target.setHumStyle(0, 'kael'));
  c(() => target.setHumStyle(1, 'vexa'));
  c(() => target.uiMove());
  c(() => target.uiSelect());
  c(() => target.uiBack());
  c(() => target.retract(0, 0));
  c(() => target.retract(1, 0));
  c(() => target.setGroupVolume('music', 0.8));
  c(() => target.setPaused(false));
  return calls;
}

/** A never-unlocked engine must swallow every call. */
function preUnlockSmoke(): { calls: number; unlocked: boolean } {
  const cold = new AudioEngine(seeded(7));
  const calls = callEverything(cold);
  cold.suspend();
  cold.resume();
  cold.dispose();
  const afterDispose = callEverything(cold);
  return { calls: calls + afterDispose, unlocked: cold.unlocked };
}

declare global {
  interface Window {
    __audio: {
      engine: AudioEngine;
      AudioEngine: typeof AudioEngine;
      callEverything: () => number;
      preUnlockSmoke: () => { calls: number; unlocked: boolean };
      sweep: () => void;
      measureLevels: () => Promise<ScenarioResult[]>;
      formatLevels: (rows: ScenarioResult[]) => string;
      state: () => ReturnType<AudioEngine['getDebugState']>;
    };
  }
}

window.__audio = {
  engine,
  AudioEngine,
  callEverything: () => callEverything(engine),
  preUnlockSmoke,
  sweep: startSweep,
  measureLevels,
  formatLevels,
  state: () => engine.getDebugState(),
};
