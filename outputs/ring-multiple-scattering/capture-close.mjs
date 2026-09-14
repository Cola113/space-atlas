import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { Quaternion, Vector3 } from 'three';

// Zoomed views of the dark ring systems, to check that each declared region draws as
// its own annulus at its measured width rather than being lost to a radial profile.
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5199';
const output = new URL('./ring-systems/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const settle = page => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked && document.getElementById('loading-screen').hidden;
}, null, { timeout: 90000 });
try {
  for (const [id, distance, direction] of [
    ['uranus', 9, [.05, .55, 1]],
    ['neptune', 4.5, [.05, .55, 1]],
    ['jupiter', 5, [.4, .3, 1]],
  ]) {
    const probe = await browser.newContext({ viewport: { width: 1200, height: 1200 }, reducedMotion: 'reduce' });
    const first = await probe.newPage();
    await first.goto(base + '/solar-system/', { waitUntil: 'domcontentloaded' });
    await settle(first);
    await first.locator('#catalog-filter').selectOption('planets');
    await first.locator(`.planet-choice[data-body="${id}"]`).click();
    await settle(first);
    const state = await first.evaluate(() => window.solarAtlas.snapshot());
    const body = state.bodies.find(b => b.id === id);
    await probe.close();
    const offset = new Vector3(...direction).normalize()
      .applyQuaternion(new Quaternion().fromArray(body.orientation)).multiplyScalar(body.radius * distance).toArray();
    const context = await browser.newContext({ viewport: { width: 1200, height: 1200 }, reducedMotion: 'reduce' });
    await context.addInitScript(({ date, offset, id }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
      version: 1, value: { selected: id, playing: false, shadows: true, dynamics: true,
        followRotation: false, date, speed: 1000, speedUnit: 'realtime', direction: 1, offset, portrait: false },
    })), { date: state.date, offset, id });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(base + '/solar-system/');
    await settle(page);
    await page.waitForTimeout(1200);
    await writeFile(new URL(`${id}-close.png`, output), await page.screenshot());
    console.log(`${id}: captured, errors=${errors.length}`);
    await context.close();
  }
} finally { await browser.close(); }
