// Capture arena preview screenshots at the extreme camera framings.
// Usage: node dev/capture-arena.mjs [prefix] [onlyName,...]
// Requires: npx vite --port 5191 --strictPort --host 127.0.0.1 running.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.ARENA_URL ?? 'http://127.0.0.1:5191/dev/arena-preview.html';
const OUT = resolve('artifacts/arena-shots');
const prefix = process.argv[2] ?? 'shot';
const only = process.argv[3] ? process.argv[3].split(',') : null;
mkdirSync(OUT, { recursive: true });

const shots = [
  { name: 'default', q: 'camX=0&camZ=10.5', w: 1280, h: 720 },
  { name: 'left-near', q: 'camX=-4.6&camZ=9', w: 1280, h: 720 },
  { name: 'right-far', q: 'camX=4.6&camZ=17', w: 1280, h: 720 },
  { name: 'square-far', q: 'camX=0&camZ=16', w: 700, h: 700 },
  { name: 'ultrawide', q: 'camX=4.6&camZ=17', w: 1680, h: 700 },
  { name: 'ultrawide-left-near', q: 'camX=-4.6&camZ=9', w: 1680, h: 700 },
  { name: 'square-right-near', q: 'camX=4.6&camZ=9', w: 700, h: 700 },
  { name: 'low', q: 'camX=0&camZ=10.5&quality=low', w: 1280, h: 720 },
  { name: 'reduced', q: 'camX=0&camZ=12&reduced=1', w: 1280, h: 720 },
];

// Under the packaged Claude desktop app, %LOCALAPPDATA% is virtualized and Node cannot
// spawn the browser through the virtual path; fall back to the physical package path.
function findPhysicalChromium() {
  const local = process.env.LOCALAPPDATA;
  if (!local) return undefined;
  const pkgs = join(local, 'Packages');
  if (!existsSync(pkgs)) return undefined;
  for (const pkg of readdirSync(pkgs).filter((d) => d.startsWith('Claude_'))) {
    const pw = join(pkgs, pkg, 'LocalCache', 'Local', 'ms-playwright');
    if (!existsSync(pw)) continue;
    const dirs = readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      const exe = join(pw, d, 'chrome-win64', 'chrome.exe');
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

let browser;
try {
  browser = await chromium.launch({ channel: 'chromium', executablePath: process.env.CHROME_PATH || undefined });
} catch (err) {
  const exe = findPhysicalChromium();
  if (!exe) throw err;
  console.log('falling back to', exe);
  browser = await chromium.launch({ channel: 'chromium', executablePath: exe });
}
const results = [];
for (const s of shots) {
  if (only && !only.includes(s.name)) continue;
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}?${s.q}&w=${s.w}&h=${s.h}&t=4&anim=0`);
  try {
    await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 90_000 });
  } catch (e) {
    console.log(s.name, 'TIMEOUT', errors.join('\n'));
    await page.close();
    continue;
  }
  const stats = await page.evaluate(() => window.__STATS__);
  const path = `${OUT}/${prefix}-${s.name}.png`;
  await page.screenshot({ path });
  results.push({ name: s.name, ...stats });
  console.log(s.name, JSON.stringify(stats));
  if (errors.length) console.log('  console:', errors.slice(0, 5).join('\n  '));
  await page.close();
}
await browser.close();
