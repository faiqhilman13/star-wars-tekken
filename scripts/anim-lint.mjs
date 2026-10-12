// Runs dev/anim-lint.html and prints flagged frames.
// Usage: node scripts/anim-lint.mjs [--chars kael,vexa] [--clips light,heavy] [--url http://127.0.0.1:5188]
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const params = new URLSearchParams();
if (opt('--chars', null)) params.set('chars', opt('--chars'));
if (opt('--clips', null)) params.set('clips', opt('--clips'));
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${opt('--url', 'http://127.0.0.1:5188')}/dev/anim-lint.html?${params}`);
await page.waitForFunction(() => window.__READY__ === true, undefined, { timeout: 120000 });
const lines = await page.evaluate(() => window.__LINT__);
console.log(lines.length ? lines.join('\n') : 'clean');
console.log(`${lines.length} issue group(s)`);
if (errors.length) console.log('ERRORS', errors.join(' | '));
await browser.close();
