import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from 'three';
import sharp from 'sharp';

// A ring drawn at its measured width is thinner than a pixel at any framing that shows the
// whole body: Uranus's rings are 1.6 to 58 km against roughly 140 km per pixel in the view
// this was reported from. At that size the rasteriser's fixed sample positions catch a
// ribbon on some pixels and miss it on others, so a ring that should be a faint continuous
// line becomes a trail of specks.
//
// The ring shader widens each annulus to a minimum screen width and divides its opacity by
// the same factor, which keeps the light correct while making the coverage continuous. This
// script measures the difference: walk the line row by row, high-pass the row so the
// globe's own shading and its terminator drop out, and look at how much each row is dipped
// by a narrow dark feature. With continuous coverage the dips are steady; with speckle most
// rows have no dip at all.
//
//   node scripts/verify-ring-thin-coverage.mjs
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5199';
const output = new URL('../test-results/ring-thin-coverage/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const settle = page => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked && document.getElementById('loading-screen').hidden;
}, null, { timeout: 90000 });

// Dips measured on the two states this fix was calibrated against: the render with the
// widening reads 1.29 with 35% of rows empty, and the render without it reads 2.17 with 66%
// of rows empty. The empty rows that remain are the real gaps between the Uranian ring
// groups, not dropouts.
const MAX_SPECKLE_INDEX = 1.7;
const MAX_EMPTY_SHARE = .5;

try {
  const probe = await browser.newContext({ viewport: { width: 900, height: 900 }, reducedMotion: 'reduce' });
  const seedPage = await probe.newPage();
  await seedPage.goto(base + '/solar-system/', { waitUntil: 'domcontentloaded' });
  await settle(seedPage);
  await seedPage.locator('#catalog-filter').selectOption('planets');
  await seedPage.locator('.planet-choice[data-body="uranus"]').click();
  await settle(seedPage);
  const seed = await seedPage.evaluate(() => window.solarAtlas.snapshot());
  const uranus = seed.bodies.find(b => b.id === 'uranus');
  await probe.close();

  // Camera on the sunward side, within a couple of degrees of the ring plane, and far
  // enough that the widest Uranian ring is about one pixel across.
  const pole = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().fromArray(uranus.orientation)).normalize();
  const sun = new Vector3().fromArray(uranus.sunDirection).normalize();
  const direction = sun.clone().addScaledVector(pole, -sun.dot(pole)).normalize().addScaledVector(pole, .03).normalize();
  const offset = direction.multiplyScalar(uranus.radius * 13).toArray();
  const context = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  await context.addInitScript(({ date, offset }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
    version: 1, value: { selected: 'uranus', playing: false, shadows: true, dynamics: true,
      followRotation: false, date, speed: 1000, speedUnit: 'realtime', direction: 1, offset, portrait: false },
  })), { date: seed.date, offset });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(base + '/solar-system/');
  await settle(page);
  await page.waitForTimeout(1200);
  const shot = await page.screenshot();
  await writeFile(new URL('uranus-ring-line.png', output), shot);

  const state = await page.evaluate(() => window.solarAtlas.snapshot());
  const body = state.bodies.find(b => b.id === 'uranus');
  const ratio = 2;
  const centreX = body.x * ratio, centreY = body.y * ratio, radiusPx = body.radiusPx * ratio;
  const kmPerPixel = body.radiusKm / radiusPx;
  console.log(`globe ${radiusPx.toFixed(0)} px radius, ${kmPerPixel.toFixed(0)} km per pixel; widest ring 58 km = ${(58 / kmPerPixel).toFixed(2)} px`);

  const { data, info } = await sharp(fileURLToPath(new URL('uranus-ring-line.png', output))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, channels } = info;
  const lum = (x, y) => { const i = (y * width + x) * channels; return (data[i] + data[i + 1] + data[i + 2]) / 3 / 255; };
  const half = 16;
  const dips = [];
  for (let y = Math.round(centreY - radiusPx * .5); y <= Math.round(centreY + radiusPx * .5); y++) {
    let worst = 0, bright = 0;
    for (let x = Math.round(centreX - radiusPx * .45); x <= Math.round(centreX + radiusPx * .45); x++) {
      let sum = 0, count = 0;
      for (let k = -half; k <= half; k++) { sum += lum(x + k, y); count++; }
      const smooth = sum / count;
      if (smooth > .35) { bright++; worst = Math.max(worst, smooth - lum(x, y)); }
    }
    if (bright > radiusPx * .5) dips.push(worst);
  }
  const mean = dips.reduce((a, b) => a + b, 0) / dips.length;
  const sd = Math.sqrt(dips.reduce((a, b) => a + (b - mean) ** 2, 0) / dips.length);
  const empty = dips.filter(d => d < mean * .25).length;
  const index = sd / mean, share = empty / dips.length;
  console.log(`line rows ${dips.length}, mean dip ${mean.toFixed(4)}, speckle index ${index.toFixed(3)}, rows with no dip ${empty} (${(share * 100).toFixed(0)}%)`);
  await writeFile(new URL('report.json', output), JSON.stringify({ kmPerPixel, rows: dips.length, meanDip: mean, speckleIndex: index, emptyShare: share, gates: { MAX_SPECKLE_INDEX, MAX_EMPTY_SHARE }, errors }, null, 1));
  if (errors.length) throw new Error(errors.join('\n'));
  if (!(index < MAX_SPECKLE_INDEX)) throw new Error(`the ring line reads as speckle: index ${index.toFixed(3)} is not below ${MAX_SPECKLE_INDEX}`);
  if (!(share < MAX_EMPTY_SHARE)) throw new Error(`the ring line is missing from ${(share * 100).toFixed(0)}% of the rows it crosses`);
  console.log('sub-pixel ring coverage passed');
} finally {
  await browser.close();
}
