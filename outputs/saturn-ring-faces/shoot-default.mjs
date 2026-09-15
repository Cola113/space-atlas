// The app's own framing, one shot per solstice: the sun is south in 2002 and north in
// 2017, so the default camera shows a different face of the ring at each.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5271';
const output = new URL('./', import.meta.url);
const tag = process.env.TAG || 'after';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const settle = page => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked &&
    (s.selected !== 'saturn' || s.bodies.find(b => b.id === 'saturn').textureWidth >= 2048);
}, null, { timeout: 90000 });
for (const [iso, date] of [['2002-10-01', Date.UTC(2002, 9, 1)], ['2017-05-01', Date.UTC(2017, 4, 1)], ['2026-09-15', Date.UTC(2026, 8, 15)]]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(({ date }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
    version: 1, value: { selected: 'saturn', playing: false, shadows: true, dynamics: true,
      followRotation: false, date, speed: 1000, speedUnit: 'realtime', direction: 1, portrait: false },
  })), { date });
  const page = await context.newPage();
  await page.goto(base + '/solar-system/');
  await settle(page);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: fileURLToPath(new URL(`${tag}-default-${iso}.png`, output)) });
  await context.close();
  console.log(`${tag} ${iso} shot`);
}
await browser.close();
