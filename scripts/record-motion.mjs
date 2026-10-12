// Records a short unpaused gameplay clip (real keyboard input vs the CPU) for motion review.
// Usage: node scripts/record-motion.mjs [--url http://127.0.0.1:5188] [--out artifacts/pass-1/motion-desktop.webm] [--seconds 12] [--chars kael,vexa]
import { chromium } from '@playwright/test';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = opt('--url', 'http://127.0.0.1:5188');
const out = opt('--out', 'artifacts/pass-1/motion-desktop.webm');
const seconds = Number(opt('--seconds', '12'));
const chars = opt('--chars', 'kael,vexa').split(',');
const tmpDir = path.join(path.dirname(out), '.video-tmp');

await mkdir(tmpDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: tmpDir, size: { width: 1280, height: 720 } } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.seed(777));
await page.locator('[data-difficulty="normal"]').click();
await page.locator('.menu-item[data-action="cpu"]').click();
const roster = ['kael', 'vexa', 'asha', 'thane'];
for (const c of chars) await page.locator('#select-screen .card').nth(Math.max(0, roster.indexOf(c))).click();
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.game?.mode === 'cpu' && window.__THREE_GAME_DIAGNOSTICS__?.game?.phase === 'fight', undefined, { timeout: 10000 });

const sleep = (ms) => page.waitForTimeout(ms);
const hold = async (keys, ms) => {
  for (const k of keys) await page.keyboard.down(k);
  await sleep(ms);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
};
const end = Date.now() + seconds * 1000;
const script = [
  [['KeyD'], 650],
  [['KeyJ'], 50], [[], 110], [['KeyJ'], 50], [[], 110], [['KeyK'], 50], [[], 500],
  [['KeyA'], 420],
  [['KeyS'], 80], [['KeyS', 'KeyK'], 60], [[], 600],
  [['KeyW', 'KeyD'], 90], [[], 330], [['KeyJ'], 50], [[], 600],
  [['KeyD'], 300], [['KeyK'], 50], [[], 650],
  [['KeyA'], 600],
  [['KeyL'], 50], [[], 700],
  [['KeyD'], 120], [[], 60], [['KeyD'], 120], [[], 300],
  [['KeyJ', 'KeyK'], 60], [[], 700],
];
let i = 0;
while (Date.now() < end) {
  const [keys, ms] = script[i % script.length];
  await hold(keys, ms);
  i += 1;
}
const diag = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.game);
const video = page.video();
await context.close();
await browser.close();
const recorded = video ? await video.path() : null;
if (recorded) {
  await mkdir(path.dirname(out), { recursive: true });
  await rename(recorded, out);
}
await rm(tmpDir, { recursive: true, force: true });
console.log(JSON.stringify({ out, events: diag?.events, fighters: diag?.fighters, errors }));
