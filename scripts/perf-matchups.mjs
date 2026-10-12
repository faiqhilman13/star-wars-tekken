// Draw calls / triangles / rendered fps for every character pairing on desktop and mobile viewports.
// Usage: node scripts/perf-matchups.mjs [--url http://127.0.0.1:5190] [--pairs kael.vexa,asha.asha]
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = opt('--url', 'http://127.0.0.1:5190');
const ids = ['kael', 'vexa', 'asha', 'thane'];
const all = [];
for (let i = 0; i < ids.length; i += 1) for (let j = i; j < ids.length; j += 1) all.push(`${ids[i]}.${ids[j]}`);
const pairs = opt('--pairs', all.join(',')).split(',');

const browser = await chromium.launch({ channel: 'chromium' });
const rows = [];
for (const [w, h, label] of [
  [1920, 1080, 'desktop'],
  [390, 844, 'mobile'],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: label === 'mobile', isMobile: label === 'mobile' });
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), undefined, { timeout: 60000 });
  await page.waitForTimeout(1500);
  for (const pair of pairs) {
    await page.evaluate((s) => window.__THREE_GAME_TEST_HOOKS__.setState(`active-play.${s}`), pair);
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.renderer);
    const f0 = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.frame);
    await page.waitForTimeout(1000);
    const f1 = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.frame);
    rows.push({ view: label, pair, calls: r.calls, tris: r.triangles, fps: f1 - f0 });
  }
  await page.close();
}
await browser.close();
for (const r of rows) console.log(`${r.view.padEnd(8)} ${r.pair.padEnd(12)} calls ${String(r.calls).padStart(3)}  tris ${String(r.tris).padStart(7)}  fps ~${r.fps}`);
const worst = (v) => Math.max(...rows.filter((r) => r.view === v).map((r) => r.calls));
console.log(`worst desktop ${worst('desktop')}  worst mobile ${worst('mobile')}`);
