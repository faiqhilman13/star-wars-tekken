import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

type CanvasSample = { ok: boolean; variance?: number; colorBuckets?: number };

async function sampleCanvas(page: Page): Promise<CanvasSample> {
  const buffer = await page.locator('#game-canvas').screenshot();
  const png = PNG.sync.read(buffer);
  let min = 255;
  let max = 0;
  const buckets = new Set<string>();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 4096));
  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const o = pixel * 4;
    const r = png.data[o];
    const g = png.data[o + 1];
    const b = png.data[o + 2];
    min = Math.min(min, r, g, b);
    max = Math.max(max, r, g, b);
    buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
  }
  return { ok: max - min > 40 && buckets.size > 24, variance: max - min, colorBuckets: buckets.size };
}

const fighter = (page: Page, i: 0 | 1) =>
  page.evaluate((index) => window.__THREE_GAME_DIAGNOSTICS__?.game?.fighters[index] ?? null, i);
const swings = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.game?.events.swing ?? 0);

test('title → VS CPU → real input moves and attacks', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 20);
  expect(await sampleCanvas(page)).toMatchObject({ ok: true });
  await expect(page.locator('#title-screen')).toBeVisible();

  const mobile = testInfo.project.name.includes('mobile');
  await page.locator('.menu-item[data-action="cpu"]').click();
  // Character select: P1 picks, then the CPU opponent.
  await expect(page.locator('#select-screen')).toBeVisible();
  await expect(page.locator('#select-screen .card')).toHaveCount(4);
  await testInfo.attach(`${testInfo.project.name}-select`, { body: await page.screenshot(), contentType: 'image/png' });
  await page.locator('#select-screen .card').nth(0).click();
  await page.locator('#select-screen .card').nth(1).click();
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.game?.mode === 'cpu' && window.__THREE_GAME_DIAGNOSTICS__?.game?.phase === 'fight', undefined, { timeout: 10000 });
  // Stop the CPU from crowding the test: push P2 back out of range is not possible from input, so act fast.
  const before = await fighter(page, 0);
  expect(before).not.toBeNull();

  if (mobile) {
    await expect(page.locator('#touch-stick')).toBeVisible();
    const box = await page.locator('#touch-stick').boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + box.width * 0.45, cy, { steps: 4 });
      await page.waitForTimeout(500);
      await page.mouse.up();
    }
  } else {
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(500);
    await page.keyboard.up('KeyD');
  }
  const after = await fighter(page, 0);
  expect(after, 'P1 should have moved toward the opponent or been engaged').not.toBeNull();
  const moved = Math.abs((after?.x ?? 0) - (before?.x ?? 0)) > 0.25 || after?.state !== 'idle';
  expect(moved).toBe(true);

  const swingsBefore = await swings(page);
  if (mobile) {
    await page.locator('.touch-button.light').dispatchEvent('pointerdown', { pointerId: 7, isPrimary: true });
    await page.waitForTimeout(80);
    await page.locator('.touch-button.light').dispatchEvent('pointerup', { pointerId: 7, isPrimary: true });
  } else {
    await page.keyboard.down('KeyJ');
    await page.waitForTimeout(60);
    await page.keyboard.up('KeyJ');
  }
  await expect.poll(() => swings(page), { timeout: 3000 }).toBeGreaterThan(swingsBefore);

  // Pause and resume.
  if (mobile) await page.locator('#pause-button').click();
  else await page.keyboard.press('Escape');
  await expect(page.locator('#pause-screen')).toBeVisible();
  await page.locator('#pause-screen .menu-item[data-action="resume"]').click();
  await expect(page.locator('#pause-screen')).toBeHidden();

  await testInfo.attach(`${testInfo.project.name}-fight`, { body: await page.screenshot(), contentType: 'image/png' });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
