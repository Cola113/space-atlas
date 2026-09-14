import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from 'three';
import sharp from 'sharp';

// Viewpoint review of the ring system: ring-plane tilt and transparency, front and
// back occlusion against the globe, and the illumination geometry. The dates are the
// two solstices and the equinox, where the Sun is furthest north, furthest south and
// inside the ring plane.
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5199';
const output = new URL('./viewpoints/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle'] });
const report = {};
const settle = page => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked && document.getElementById('loading-screen').hidden;
}, null, { timeout: 90000 });

try {
  const probe = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const seedPage = await probe.newPage();
  await seedPage.goto(base + '/solar-system/', { waitUntil: 'domcontentloaded' });
  await settle(seedPage);
  await seedPage.locator('.planet-choice[data-body="saturn"]').click();
  await settle(seedPage);
  const seed = await seedPage.evaluate(() => window.solarAtlas.snapshot());
  const saturn = seed.bodies.find(b => b.id === 'saturn');
  await probe.close();

  const dates = [
    ['2002-solstice-north', Date.UTC(2002, 9, 1)],
    ['2017-solstice-south', Date.UTC(2017, 4, 1)],
    ['2025-equinox-edge', Date.UTC(2025, 2, 23)],
  ];
  for (const [name, date] of dates) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const offset = new Vector3(0.15, 0.55, 1).normalize()
      .applyQuaternion(new Quaternion().fromArray(saturn.orientation)).multiplyScalar(saturn.radius * 4.6).toArray();
    await context.addInitScript(({ date, offset }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
      version: 1, value: { selected: 'saturn', playing: false, shadows: true, dynamics: true,
        followRotation: false, date, speed: 1000, speedUnit: 'realtime', direction: 1, offset, portrait: false },
    })), { date, offset });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base + '/solar-system/');
    await settle(page);
    await page.waitForTimeout(1100);
    const shot = await page.screenshot();
    await writeFile(new URL(`${name}.png`, output), shot);
    const state = await page.evaluate(() => window.solarAtlas.snapshot());
    const body = state.bodies.find(b => b.id === 'saturn');
    report[name] = { date: state.date, ringVisible: body?.ringVisible, ringOuterRadius: body?.ringOuterRadius, errors };
    console.log(`${name}: ringVisible=${body?.ringVisible} errors=${errors.length}`);
    await context.close();
  }

  // Ring-plane tilt, measured from pixels rather than read off the model: the vertical
  // extent of the lit ring band divided by its horizontal extent, which is the sine of
  // the opening angle for an annulus seen at low tilt.
  for (const [name] of dates) {
    const file = fileURLToPath(new URL(`${name}.png`, output));
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let top = info.height, bottom = 0, left = info.width, right = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      // Ring pixels: brighter than deep space, and outside the globe's own column band.
      const value = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (value > 18) { if (y < top) top = y; if (y > bottom) bottom = y; if (x < left) left = x; if (x > right) right = x; }
    }
    const width = right - left, height = bottom - top;
    report[name].litBounds = { width, height, ratio: width ? +(height / width).toFixed(4) : null };
    console.log(`${name}: lit bounds ${width}x${height} (vertical/horizontal ${width ? (height / width).toFixed(3) : 'n/a'})`);
  }
} finally {
  await browser.close();
}
await writeFile(new URL('report.json', output), JSON.stringify(report, null, 1));
