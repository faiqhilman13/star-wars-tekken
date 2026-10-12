// Scripted smoke + level test for src/audio/AudioEngine.ts.
// Usage: start `npx vite --port 5192 --strictPort --host 127.0.0.1`, then `node dev/audio-test.mjs`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const URL = process.env.AUDIO_PREVIEW_URL ?? 'http://127.0.0.1:5192/dev/audio-preview.html';

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`FAIL ${msg}`);
};
const ok = (msg) => console.log(`ok   ${msg}`);

const LAUNCH_ARGS = ['--autoplay-policy=no-user-gesture-required'];

/** Prefer the full Chromium channel; fall back to any runnable Playwright headless shell (or AUDIO_TEST_EXE). */
async function launch() {
  try {
    return await chromium.launch({ channel: 'chromium', args: LAUNCH_ARGS });
  } catch (err) {
    console.log(`note: channel 'chromium' failed to launch (${String(err.message).split('\n')[0]}); trying fallbacks`);
  }
  const candidates = [];
  if (process.env.AUDIO_TEST_EXE) candidates.push(process.env.AUDIO_TEST_EXE);
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'ms-playwright');
  try {
    for (const dir of fs.readdirSync(root).sort().reverse()) {
      if (dir.startsWith('chromium_headless_shell-')) {
        candidates.push(path.join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'));
        candidates.push(path.join(root, dir, 'chrome-linux', 'headless_shell'));
      }
    }
  } catch {
    /* no browsers dir */
  }
  for (const executablePath of candidates) {
    if (!fs.existsSync(executablePath)) continue;
    try {
      const b = await chromium.launch({ executablePath, args: LAUNCH_ARGS });
      console.log(`note: launched ${executablePath}`);
      return b;
    } catch {
      /* try next */
    }
  }
  throw new Error('no runnable Chromium found');
}

const browser = await launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.__audio !== 'undefined');

// 1. Before unlock: everything is a no-op.
const before = await page.evaluate(() => {
  const r = window.__audio.preUnlockSmoke();
  const live = window.__audio.callEverything(); // live engine, not yet unlocked
  return { ...r, live, state: window.__audio.state() };
});
if (before.unlocked) fail('cold engine reports unlocked');
else ok(`pre-unlock/disposed engine swallowed ${before.calls} calls; live locked engine swallowed ${before.live} calls (ctx: ${before.state.contextState})`);

// 2. Unlock through a real click.
await page.click('#unlock');
await page.waitForFunction(() => window.__audio.engine.unlocked, null, { timeout: 5000 });
const unlocked = await page.evaluate(() => window.__audio.state());
if (unlocked.contextState !== 'running') fail(`context state after unlock: ${unlocked.contextState}`);
else ok('unlocked; AudioContext running');

// Repeated unlock is safe.
await page.evaluate(async () => {
  await window.__audio.engine.unlock();
  await window.__audio.engine.unlock();
});

// 3. Click every UI button (wiring) and call every method programmatically.
await page.check('#on0');
await page.check('#on1');
const buttons = await page.$$eval('#buttons button', (bs) => bs.map((b) => b.dataset.action));
for (const action of buttons) {
  await page.click(`#buttons button[data-action="${action}"]`);
  await page.waitForTimeout(60);
}
ok(`clicked ${buttons.length} one-shot buttons`);

const calls = await page.evaluate(() => window.__audio.callEverything());
ok(`callEverything: ${calls} calls`);

// 4. Hum: per-frame updateSaber with a swing sweep, slider drag, ambience, intensity.
await page.click('#buttons button[data-action="ignite"]');
await page.click('#sweep');
await page.waitForTimeout(400);
await page.fill('#tip', '25');
await page.dispatchEvent('#tip', 'input');
await page.waitForTimeout(300);
await page.fill('#tip', '0');
await page.dispatchEvent('#tip', 'input');
await page.check('#ambience');
await page.fill('#intensity', '0.8');
await page.dispatchEvent('#intensity', 'input');
await page.waitForTimeout(1500);

// 5. Hammer: 60 Hz-style call storm to check the voice cap / cooldowns hold.
const storm = await page.evaluate(async () => {
  const e = window.__audio.engine;
  let peakVoices = 0;
  for (let f = 0; f < 120; f++) {
    e.updateSaber(0, true, Math.sin(f / 10) * 9, (f % 20) * 1.2);
    e.updateSaber(1, true, -Math.sin(f / 10) * 9, ((f + 10) % 20) * 1.2);
    e.step(0);
    e.hit(1, 0);
    e.block(0);
    e.swing(0, 1, 0);
    e.runStep(0);
    e.parry(0);
    e.setDuck(f % 30 < 5 ? 0.4 : 1);
    e.setGrip(f % 60 < 30, Math.cos(f / 8) * 9);
    e.setLightning(f % 40 < 25, Math.sin(f / 7) * 9);
    e.setSpinningBlade(f % 50 < 35, Math.sin(f / 5) * 8, (f % 10) / 10);
    peakVoices = Math.max(peakVoices, e.getDebugState().activeVoices);
    await new Promise((r) => setTimeout(r, 16));
  }
  e.setGrip(false, 0);
  e.setLightning(false, 0);
  e.setSpinningBlade(false, 0, 0);
  return peakVoices;
});
ok(`call storm (120 frames x 11 calls incl. per-frame loops): peak concurrent voices = ${storm}`);
if (storm > 60) fail(`voice count unbounded: ${storm}`);

// 5b. Hum styles + continuous loops toggle as expected.
const styles = await page.evaluate(async () => {
  const e = window.__audio.engine;
  const seen = [];
  for (const st of ['asha', 'thane', 'vexa', 'kael']) {
    e.setHumStyle(0, st);
    e.setHumStyle(1, st);
    e.ignite(0, -2);
    e.ignite(1, 2);
    await new Promise((r) => setTimeout(r, 450));
    seen.push(e.getDebugState().humStyles.join('/'));
  }
  e.setHumStyle(0, 'kael');
  e.setHumStyle(1, 'vexa');
  // The preview's per-frame loop calls setGrip/setLightning/setSpinningBlade from these checkboxes.
  const boxes = ['grip', 'lightning', 'spin'].map((id) => document.getElementById(id));
  for (const b of boxes) b.checked = true;
  await new Promise((r) => setTimeout(r, 300));
  const on = e.getDebugState();
  for (const b of boxes) b.checked = false;
  await new Promise((r) => setTimeout(r, 200));
  const off = e.getDebugState();
  return { seen, on: [on.grip, on.lightning, on.spinningBlade], off: [off.grip, off.lightning, off.spinningBlade], final: off.humStyles };
});
if (styles.seen.join(',') !== 'asha/asha,thane/thane,vexa/vexa,kael/kael') fail(`hum styles: ${styles.seen.join(',')}`);
else ok(`hum styles switch + style ignitions: ${styles.seen.join(', ')}`);
if (styles.on.some((v) => !v) || styles.off.some((v) => v)) fail(`loops toggle: on=${styles.on} off=${styles.off}`);
else ok('grip / lightning / spinning blade loops toggle on and off');

// 6. Suspend / resume / mute / volume.
const sr = await page.evaluate(async () => {
  const e = window.__audio.engine;
  e.suspend();
  e.hit(1, 0); // dropped while suspended (must not queue)
  await new Promise((r) => setTimeout(r, 250));
  const suspendedState = e.getDebugState().contextState;
  e.resume();
  await new Promise((r) => setTimeout(r, 250));
  const resumedState = e.getDebugState().contextState;
  e.setMuted(true);
  const muted = e.isMuted();
  e.setMuted(false);
  e.setMasterVolume(0.7);
  e.setPaused(true);
  e.uiMove();
  e.setPaused(false);
  return { suspendedState, resumedState, muted };
});
if (sr.suspendedState !== 'suspended' || sr.resumedState !== 'running' || !sr.muted) fail(`suspend/resume/mute: ${JSON.stringify(sr)}`);
else ok(`suspend -> ${sr.suspendedState}, resume -> ${sr.resumedState}, mute ok`);

await page.waitForTimeout(3000);
const settled = await page.evaluate(() => window.__audio.state());
ok(`after tails: activeVoices=${settled.activeVoices}, hum=${JSON.stringify(settled.humOn)}`);
if (settled.steamHisses < 1) fail(`ambience steam hiss never scheduled (${settled.steamHisses})`);
else ok(`ambience scheduler: ${settled.steamHisses} steam hiss(es)`);
if (settled.tensionBeats < 3) fail(`tension pulse not scheduled (${settled.tensionBeats})`);
else ok(`tension scheduler: ${settled.tensionBeats} beats`);

// 7. Offline renders: peak / RMS.
const rows = await page.evaluate(() => window.__audio.measureLevels());
const table = await page.evaluate((r) => window.__audio.formatLevels(r), rows);
console.log('\n' + table + '\n');
const by = (name) => rows.find((r) => r.name.startsWith(name));
for (const r of rows) {
  if (r.peak > 1.0) fail(`${r.name}: peak ${r.peak.toFixed(4)} > 1.0`);
}
const humIdle = by('hum idle (KAEL)');
const humFull = by('hum full swing (KAEL');
const hit1 = by('hit(1)');
if (humIdle && hit1) {
  const ratioDb = hit1.maxMomentaryRmsDb - humIdle.rmsDb;
  if (ratioDb < 12) fail(`idle hum too close to hit: ${ratioDb.toFixed(1)} dB`);
  else ok(`hit(1) momentary RMS is ${ratioDb.toFixed(1)} dB above idle hum RMS`);
}
if (humIdle && humFull) ok(`full swing hum is ${(humFull.rmsDb - humIdle.rmsDb).toFixed(1)} dB above idle`);
for (const name of ['hum idle (ASHA', 'hum idle (THANE']) {
  const r = by(name);
  if (r && humIdle) ok(`${name}): ${(r.rmsDb - humIdle.rmsDb).toFixed(1)} dB vs KAEL idle`);
}
const parry = by('parry');
if (parry && hit1) ok(`parry loudest 50 ms is ${(parry.maxMomentaryRmsDb - hit1.maxMomentaryRmsDb).toFixed(1)} dB vs hit(1)`);
const busy = by('BUSY mix (no parry)');
const busyParry = by('BUSY mix + parry');
if (busy && busyParry) {
  const band = busyParry.bandDb - busy.bandDb;
  if (band < 3) fail(`parry does not cut through the busy mix (2-5 kHz band +${band.toFixed(1)} dB)`);
  else ok(`parry over a busy mix (asha+thane full swing, lightning, grip, hit, clash): 2-5 kHz band +${band.toFixed(1)} dB, broadband loudest 50 ms ${(busyParry.maxMomentaryRmsDb - busy.maxMomentaryRmsDb).toFixed(1)} dB (others auto-ducked)`);
}
const maxPeak = Math.max(...rows.map((r) => r.peak));
ok(`max peak across all renders: ${maxPeak.toFixed(4)}`);

// 8. Dispose: everything becomes a no-op.
const disposed = await page.evaluate(() => {
  const e = window.__audio.engine;
  e.dispose();
  const n = window.__audio.callEverything();
  e.dispose();
  return { n, unlocked: e.unlocked };
});
if (disposed.unlocked) fail('engine still unlocked after dispose');
else ok(`dispose: ${disposed.n} post-dispose calls swallowed`);

await page.waitForTimeout(200);
if (errors.length) {
  for (const e of errors) console.log(e);
  fail(`${errors.length} console errors/warnings`);
} else ok('no console errors, warnings or page errors');

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nALL PASSED');
process.exit(failures.length ? 1 : 0);
