// Builds a contact sheet (grid of frames) from a gameplay video for motion review.
// Usage: node scripts/contact-sheet.mjs --video http://127.0.0.1:5188/artifacts/pass-1/motion-desktop.webm --start 2 --step 0.25 --count 16 --out artifacts/pass-1/motion-sheet-1.png
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const video = opt('--video', 'http://127.0.0.1:5188/artifacts/pass-1/motion-desktop.webm');
const start = Number(opt('--start', '2'));
const step = Number(opt('--step', '0.25'));
const count = Number(opt('--count', '16'));
const cols = Number(opt('--cols', '4'));
const out = opt('--out', 'artifacts/pass-1/motion-sheet.png');
const w = 400;
const h = 225;

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: cols * w, height: Math.ceil(count / cols) * h } });
const cells = Array.from({ length: count }, (_, i) => +(start + i * step).toFixed(3));
await page.setContent(`<!doctype html><html><body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${w}px);">
${cells.map((t) => `<div style="position:relative;width:${w}px;height:${h}px"><video muted preload="auto" src="${video}#t=${t}" data-t="${t}" style="width:${w}px;height:${h}px;display:block"></video><span style="position:absolute;left:4px;top:2px;color:#ff0;font:12px sans-serif;text-shadow:0 0 3px #000">${t.toFixed(2)}s</span></div>`).join('')}
</body></html>`);
await page.evaluate(async () => {
  const videos = [...document.querySelectorAll('video')];
  await Promise.all(
    videos.map(
      (v) =>
        new Promise((resolve) => {
          const t = Number(v.dataset.t);
          const go = () => {
            v.addEventListener('seeked', () => resolve(null), { once: true });
            v.currentTime = t;
          };
          if (v.readyState >= 1) go();
          else v.addEventListener('loadedmetadata', go, { once: true });
          setTimeout(() => resolve(null), 8000);
        }),
    ),
  );
});
await page.waitForTimeout(300);
await page.screenshot({ path: out });
await browser.close();
console.log(out);
