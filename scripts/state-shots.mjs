// Captures test-hook states to PNGs (quick visual check of integration work).
// Usage: node scripts/state-shots.mjs [--states title,select,parry] [--out artifacts/state-shots] [--w 1600 --h 900] [--live 0.4]
//   A state may carry characters: "active-play:asha:thane". --live lets the sim run N seconds after staging.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const base = opt('--url', 'http://127.0.0.1:5188');
const states = opt('--states', 'title,select,active-play,parry,grip,lightning,staff,leap,super,ko,result').split(',');
const outDir = opt('--out', 'artifacts/state-shots');
const w = Number(opt('--w', '1600'));
const h = Number(opt('--h', '900'));
const live = Number(opt('--live', '0'));

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
});
await page.goto(`${base}/?seed=7`);
await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__), undefined, { timeout: 30000 });
await page.waitForTimeout(800);
for (const state of states) {
  await page.evaluate((s) => window.__THREE_GAME_TEST_HOOKS__.setState(s), state);
  if (live > 0) {
    const f0 = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.frame);
    await page.waitForTimeout(live * 1000);
    const f1 = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.frame);
    console.log(`  live: ${f1 - f0} rendered frames`);
  }
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true));
  await page.waitForTimeout(250);
  const diag = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.game);
  const file = path.join(outDir, `${state.replace(/:/g, '-')}.png`);
  await page.screenshot({ path: file });
  const fighters = diag.fighters.map((f) => `${f.char}:${f.state}${f.move ? `/${f.move}` : ''}@${f.x},${f.y}`).join('  ');
  console.log(`${file}  screen=${diag.screen} mode=${diag.mode}  ${fighters}`);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(false));
}
if (errors.length) console.log('ERRORS', errors.join(' | '));
await browser.close();
