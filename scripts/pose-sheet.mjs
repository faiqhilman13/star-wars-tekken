// Renders pose-lab contact sheets to PNG files.
// Usage: node scripts/pose-sheet.mjs --char kael --clips light,heavy,sweep [--opp 1.7] [--out artifacts/pose-sheets] [--extra "step=2&cols=6"]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const base = opt('--url', 'http://127.0.0.1:5188');
const char = opt('--char', 'kael');
const clips = opt('--clips', 'stance').split(',');
const opp = opt('--opp', '0');
const extra = opt('--extra', '');
const outDir = opt('--out', 'artifacts/pose-sheets');

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1900, height: 1200 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
for (const clip of clips) {
  const url = `${base}/dev/pose-lab.html?char=${char}&clip=${clip}&opp=${opp}${extra ? `&${extra}` : ''}`;
  await page.goto(url);
  try {
    await page.waitForFunction(() => window.__READY__ === true, undefined, { timeout: 30000 });
  } catch {
    console.log(`TIMEOUT ${clip}`, errors.join(' | '));
    continue;
  }
  const data = await page.evaluate(() => window.__SHEET__);
  const file = path.join(outDir, `${char}-${clip}.png`);
  await writeFile(file, Buffer.from(data.split(',')[1], 'base64'));
  console.log(file);
}
if (errors.length) console.log('ERRORS', errors.join(' | '));
await browser.close();
