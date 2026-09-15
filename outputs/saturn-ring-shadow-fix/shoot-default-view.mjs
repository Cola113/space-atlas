// The framing the user reported from: Saturn picked from the catalogue at the default
// camera, with the dynamic layers on, screenshots with the projection on and off.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5271';
const output = new URL('./', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const settle = page => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked &&
    (s.selected !== 'saturn' || s.bodies.find(b => b.id === 'saturn').textureWidth >= 2048);
}, null, { timeout: 90000 });

for (const [name, date] of [['2026-09-15', Date.UTC(2026, 8, 15)], ['2002-10-01', Date.UTC(2002, 9, 1)], ['2017-05-01', Date.UTC(2017, 4, 1)]]) {
  for (const shadows of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(({ date, shadows }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
      version: 1, value: { selected: 'saturn', playing: false, shadows, dynamics: true,
        followRotation: false, date, speed: 1000, speedUnit: 'realtime', direction: 1, portrait: false },
    })), { date, shadows });
    const page = await context.newPage();
    await page.goto(base + '/solar-system/');
    await settle(page);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: fileURLToPath(new URL(`default-${name}-${shadows ? 'on' : 'off'}.png`, output)) });
    await context.close();
  }
  console.log(`${name} shot`);
}
await browser.close();
