import { expect, test, type Page } from '@playwright/test';

// Bot playtests drive Saber Duel through real keyboard input and measure whether the fight
// actually progresses: damage dealt, rounds resolving, movement, softlocks, and error-free play.

type Snap = {
  frame: number;
  score: number;
  phase: string;
  round: number;
  screen: string;
  p1: { x: number; state: string; health: number; maxHealth: number; meter: number; rounds: number };
  p2: { x: number; state: string; health: number; rounds: number };
  roundEnds: number;
};

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const d = window.__THREE_GAME_DIAGNOSTICS__;
    if (!d?.game) throw new Error('diagnostics missing');
    const [a, b] = d.game.fighters;
    return {
      frame: d.frame,
      score: d.score,
      phase: d.game.phase,
      round: d.game.round,
      screen: d.game.screen,
      p1: { x: a.x, state: a.state, health: a.health, maxHealth: a.maxHealth, meter: a.meter, rounds: a.rounds },
      p2: { x: b.x, state: b.state, health: b.health, rounds: b.rounds },
      roundEnds: d.game.events.roundEnd ?? 0,
    };
  });
}

async function tap(page: Page, key: string, ms = 50): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

async function hold(page: Page, keys: string[], ms: number): Promise<void> {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function boot(page: Page, difficulty: 'easy' | 'normal' | 'hard'): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.seed(12345));
  await page.locator(`[data-difficulty="${difficulty}"]`).click();
  await page.locator('.menu-item[data-action="cpu"]').click();
  await page.locator('#select-screen .card').nth(0).click();
  await page.locator('#select-screen .card').nth(1).click();
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.game?.mode === 'cpu' && window.__THREE_GAME_DIAGNOSTICS__?.game?.phase === 'fight', undefined, { timeout: 10000 });
}

test('bot playtest: aggressive player deals damage and rounds resolve', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Keyboard bot runs on desktop; touch is covered by visual.spec.ts');
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await boot(page, 'normal');

  const start = await snap(page);
  const snaps: Snap[] = [start];
  let softlockWindows = 0;
  let distance = 0;
  let stepOfFirstScore = -1;
  const deadline = Date.now() + 75_000;
  let step = 0;

  while (Date.now() < deadline) {
    const s = await snap(page);
    if (s.screen === 'result') break;
    const dx = s.p2.x - s.p1.x;
    const fwd = dx >= 0 ? 'KeyD' : 'KeyA';
    const back = dx >= 0 ? 'KeyA' : 'KeyD';
    const gap = Math.abs(dx);
    const pattern = step % 6;
    if (s.phase !== 'fight') {
      await page.waitForTimeout(250);
    } else if (gap > 2.1) {
      if (pattern === 3) {
        // Jump in with an air slash.
        await hold(page, ['KeyW', fwd], 90);
        await page.waitForTimeout(330);
        await tap(page, 'KeyJ');
        await page.waitForTimeout(350);
      } else if (s.p1.meter >= 100 && pattern === 5) {
        await tap(page, 'KeyL');
        await page.waitForTimeout(450);
      } else {
        await hold(page, [fwd], 260);
      }
    } else if (pattern === 0 || pattern === 2) {
      // Light, light, heavy chain.
      await tap(page, 'KeyJ');
      await page.waitForTimeout(110);
      await tap(page, 'KeyJ');
      await page.waitForTimeout(110);
      await tap(page, 'KeyK');
      await page.waitForTimeout(380);
    } else if (pattern === 1) {
      await hold(page, ['KeyS'], 60);
      await hold(page, ['KeyS', 'KeyK'], 60);
      await page.waitForTimeout(450);
    } else if (pattern === 4 && gap < 1.25) {
      await hold(page, ['KeyJ', 'KeyK'], 60);
      await page.waitForTimeout(500);
    } else {
      // Guard a beat, then crouch slash.
      await hold(page, [back], 300);
      await hold(page, ['KeyS', 'KeyJ'], 60);
      await page.waitForTimeout(250);
    }
    const after = await snap(page);
    distance += Math.abs(after.p1.x - s.p1.x);
    if (stepOfFirstScore < 0 && after.score > start.score) stepOfFirstScore = step;
    const stuck = after.frame > s.frame && after.p1.x === s.p1.x && after.p1.state === s.p1.state && after.score === s.score && after.phase === 'fight' && s.phase === 'fight';
    if (stuck) softlockWindows += 1;
    snaps.push(after);
    step += 1;
  }

  const end = await snap(page);
  const metrics = {
    seed: 12345,
    steps: step,
    framesAdvanced: end.frame - start.frame,
    distanceTravelled: +distance.toFixed(2),
    damageDealt: end.score - start.score,
    stepOfFirstScore,
    roundEnds: end.roundEnds,
    rounds: { p1: end.p1.rounds, p2: end.p2.rounds },
    finalScreen: end.screen,
    softlockWindows,
    errors,
  };
  await testInfo.attach('bot-metrics.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  console.log('BOT_METRICS', JSON.stringify(metrics));

  expect(metrics.framesAdvanced).toBeGreaterThan(600);
  expect(metrics.distanceTravelled).toBeGreaterThan(3);
  expect(metrics.damageDealt, 'scripted attacks must land').toBeGreaterThan(200);
  expect(metrics.roundEnds, 'at least one round must resolve').toBeGreaterThanOrEqual(1);
  expect(metrics.softlockWindows).toBeLessThan(Math.max(4, step * 0.15));
  expect(errors).toEqual([]);
});

test('bot playtest: idle player loses, results screen appears, rematch restarts', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Keyboard bot runs on desktop');
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await boot(page, 'hard');
  const t0 = Date.now();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.game?.events.roundEnd ?? 0) >= 1, undefined, { timeout: 100_000 });
  const firstKoSeconds = (Date.now() - t0) / 1000;
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.game?.screen === 'result', undefined, { timeout: 120_000 });
  const result = await snap(page);
  await expect(page.locator('#result-screen')).toBeVisible();
  await expect(page.locator('.result-title')).toContainText('VEXA');
  await testInfo.attach('result-screen', { body: await page.screenshot(), contentType: 'image/png' });

  await page.locator('#result-screen .menu-item[data-action="rematch"]').click();
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.game?.phase === 'fight', undefined, { timeout: 8000 });
  const rematch = await snap(page);
  const metrics = { firstKoSeconds: +firstKoSeconds.toFixed(1), resultRounds: { p1: result.p1.rounds, p2: result.p2.rounds }, rematchRound: rematch.round, rematchHealth: [rematch.p1.health, rematch.p2.health], errors };
  console.log('IDLE_METRICS', JSON.stringify(metrics));
  await testInfo.attach('idle-metrics.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  expect(result.p2.rounds).toBe(2);
  expect(rematch.round).toBe(1);
  expect(rematch.p1.health).toBe(rematch.p1.maxHealth);
  expect(errors).toEqual([]);
});
