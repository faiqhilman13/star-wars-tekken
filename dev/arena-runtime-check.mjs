// Runtime checks for the arena: reduced-motion determinism, live quality switching, dispose().
// Usage: node dev/arena-runtime-check.mjs   (vite on :5191 must be running)
import { chromium } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const BASE = process.env.ARENA_URL ?? 'http://127.0.0.1:5191/dev/arena-preview.html';
function findPhysicalChromium() {
  const local = process.env.LOCALAPPDATA;
  if (!local) return undefined;
  const pkgs = join(local, 'Packages');
  if (!existsSync(pkgs)) return undefined;
  for (const pkg of readdirSync(pkgs).filter((d) => d.startsWith('Claude_'))) {
    const pw = join(pkgs, pkg, 'LocalCache', 'Local', 'ms-playwright');
    if (!existsSync(pw)) continue;
    for (const d of readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      const exe = join(pw, d, 'chrome-win64', 'chrome.exe');
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}
let browser;
try {
  browser = await chromium.launch({ channel: 'chromium' });
} catch {
  browser = await chromium.launch({ channel: 'chromium', executablePath: findPhysicalChromium() });
}

async function open(q) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}?w=640&h=360&${q}`);
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 90_000 });
  return { page, errors };
}
function diff(a, b) {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  let n = 0;
  for (let i = 0; i < pa.data.length; i += 4) {
    if (Math.abs(pa.data[i] - pb.data[i]) + Math.abs(pa.data[i + 1] - pb.data[i + 1]) + Math.abs(pa.data[i + 2] - pb.data[i + 2]) > 6) n++;
  }
  return n / (pa.width * pa.height);
}

// 1) reduced motion: identical frames for different clock times
const r1 = await open('reduced=1&t=3&anim=1');
await r1.page.waitForTimeout(400);
const shotA = await r1.page.screenshot();
const r2 = await open('reduced=1&t=97&anim=1');
await r2.page.waitForTimeout(1500);
const shotB = await r2.page.screenshot();
console.log('reduced-motion pixel diff fraction (expect ~0):', diff(shotA, shotB).toFixed(5));
// sanity: animated frames at different times do differ
const a1 = await open('t=3&anim=0');
const shotC = await a1.page.screenshot();
const a2 = await open('t=9&anim=0');
const shotD = await a2.page.screenshot();
console.log('animated pixel diff fraction (expect > 0):', diff(shotC, shotD).toFixed(5));

// 2) live quality switching + 3) dispose
const q = await open('t=3');
const res = await q.page.evaluate(async () => {
  const arena = window.__ARENA__;
  const renderer = window.__RENDERER__;
  const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const out = {};
  arena.setQuality('low');
  await wait();
  out.lowMap = arena.keyLight.shadow.mapSize.x + '/' + (arena.keyLight.shadow.map?.width ?? 'none');
  arena.setQuality('high');
  await wait();
  out.highMap = arena.keyLight.shadow.mapSize.x + '/' + (arena.keyLight.shadow.map?.width ?? 'none');
  arena.setReducedMotion(true);
  await wait();
  arena.setReducedMotion(false);
  await wait();
  out.texBefore = renderer.info.memory.textures;
  out.geoBefore = renderer.info.memory.geometries;
  arena.dispose();
  await wait();
  await wait();
  out.texAfter = renderer.info.memory.textures;
  out.geoAfter = renderer.info.memory.geometries;
  out.wallX = arena.wallX;
  return out;
});
console.log('runtime:', JSON.stringify(res));
const allErrors = [...r1.errors, ...r2.errors, ...a1.errors, ...a2.errors, ...q.errors];
console.log('page errors:', allErrors.length ? allErrors.slice(0, 5).join(' | ') : 'none');
await browser.close();
