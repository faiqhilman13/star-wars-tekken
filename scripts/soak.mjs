// Lets attract mode (CPU vs CPU, random matchups) run and reports runtime errors + event counts.
// Usage: node scripts/soak.mjs [--seconds 25] [--url http://127.0.0.1:5188]
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const seconds = Number(opt('--seconds', '25'));
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack || e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon') && !m.text().includes('404')) errors.push(m.text());
});
await page.goto(opt('--url', 'http://127.0.0.1:5188'));
await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10, undefined, { timeout: 30000 });
const seen = new Set();
const t0 = Date.now();
let fps = [];
while (Date.now() - t0 < seconds * 1000) {
  const a = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.frame);
  await page.waitForTimeout(1000);
  const d = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  fps.push(d.frame - a);
  seen.add(d.game.fighters.map((f) => f.char).join('-'));
}
const d = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
console.log('matchups', [...seen].join(' '));
console.log('fps', fps.join(','));
console.log('calls', d.renderer.calls, 'tris', d.renderer.triangles);
console.log('events', JSON.stringify(d.game.events));
console.log(errors.length ? `ERRORS\n${errors.join('\n')}` : 'no errors');
await browser.close();
