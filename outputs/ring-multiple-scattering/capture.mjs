import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { Quaternion, Vector3 } from 'three';
import sharp from 'sharp';

// Renders Saturn with and without the solved multiple-scattering table and measures
// the ring pixels, so the brightness change from removing the display exposure
// factor is a number rather than an impression.
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5199';
const output = new URL('./', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = {};
const settle = page => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked &&
    s.bodies.find(b => b.id === 'saturn')?.textureWidth >= 2048;
}, null, { timeout: 90000 });

try {
  const probe = await browser.newContext({ viewport: { width: 1200, height: 1200 }, reducedMotion: 'reduce' });
  const first = await probe.newPage();
  await first.goto(base + '/solar-system/');
  await settle(first);
  await first.locator('.planet-choice[data-body="saturn"]').click();
  await settle(first);
  const seed = await first.evaluate(() => window.solarAtlas.snapshot());
  const saturn = seed.bodies.find(b => b.id === 'saturn');
  await probe.close();
  report.date = seed.date;

  for (const [name, width, height, direction] of [
    ['wide-rings-desktop', 1440, 900, [.15, .55, 1]],
    ['wide-rings-phone', 390, 844, [.15, .55, 1]],
    ['short-landscape', 800, 450, [.15, .55, 1]],
    ['north-pole', 1000, 1000, [.2, 1, .15]],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const offset = new Vector3(...direction).normalize()
      .applyQuaternion(new Quaternion().fromArray(saturn.orientation)).multiplyScalar(saturn.radius * 4.2).toArray();
    await context.addInitScript(({ date, offset }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
      version: 1, value: { selected: 'saturn', playing: false, shadows: true, dynamics: true,
        followRotation: false, date, speed: 1000, speedUnit: 'realtime', direction: 1, offset, portrait: false },
    })), { date: seed.date, offset });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base + '/solar-system/');
    await settle(page);
    await page.waitForTimeout(900);
    const shot = await page.screenshot();
    await writeFile(new URL(`${name}.png`, output), shot);
    // Ring pixels live in the horizontal band through the planet, away from the globe.
    const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const row = Math.round(info.height * 0.5), samples = [];
    for (let x = 0; x < info.width; x++) {
      const i = (row * info.width + x) * info.channels;
      samples.push([data[i], data[i + 1], data[i + 2]]);
    }
    const lit = samples.filter(([r, g, b]) => r + g + b > 24);
    const mean = lit.reduce((sum, [r, g, b]) => [sum[0] + r, sum[1] + g, sum[2] + b], [0, 0, 0])
      .map(value => value / Math.max(lit.length, 1));
    const peak = samples.reduce((best, [r, g, b]) => Math.max(best, (r + g + b) / 3), 0);
    report[name] = { width, height, litPixels: lit.length, meanRgb: mean.map(v => +v.toFixed(1)),
      peakMean: +peak.toFixed(1), errors };
    console.log(`${name}: lit=${lit.length} mean=[${mean.map(v => v.toFixed(1)).join(', ')}] peak=${peak.toFixed(1)} errors=${errors.length}`);
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(new URL('report.json', output), JSON.stringify(report, null, 1));
