import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from 'three';
import sharp from 'sharp';

// Uranus seen nearly in the ring plane at the framing the speckle was reported from:
// the globe is a few hundred pixels across, so the measured ring widths are a small
// fraction of a pixel. LABEL distinguishes the two runs; RING_MIN_PIXELS = 0 in
// dynamics.js reproduces the pre-fix rendering exactly.
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5199';
const label = process.env.LABEL || 'line';
const distance = Number(process.env.DIST || 13);
const output = new URL('./uranus-ring/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const settle = page => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked && document.getElementById('loading-screen').hidden;
}, null, { timeout: 90000 });
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
  const q = new Quaternion().fromArray(uranus.orientation);
  const pole = new Vector3(0, 1, 0).applyQuaternion(q).normalize();
  const sun = new Vector3().fromArray(uranus.sunDirection).normalize();
  const inPlane = sun.clone().addScaledVector(pole, -sun.dot(pole)).normalize();
  const direction = inPlane.clone().addScaledVector(pole, 0.03).normalize();
  const offset = direction.multiplyScalar(uranus.radius * distance).toArray();

  const context = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  await context.addInitScript(({ date, offset }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
    version: 1, value: { selected: 'uranus', playing: false, shadows: true, dynamics: true,
      followRotation: false, date, speed: 1000, speedUnit: 'realtime', direction: 1, offset, portrait: false },
  })), { date: seed.date, offset });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/solar-system/');
  await settle(page);
  await page.waitForTimeout(1200);
  const file = new URL(`${label}.png`, output);
  await writeFile(file, await page.screenshot());
  // The globe's own screen geometry comes from the app's state, so the measurement does
  // not have to find the disc by thresholding.
  const after = await page.evaluate(() => window.solarAtlas.snapshot());
  const body = after.bodies.find(b => b.id === 'uranus');
  const ratio = 2;
  const centreX = body.x * ratio, centreY = body.y * ratio, radiusPx = body.radiusPx * ratio;
  console.log(`${label}: errors ${errors.length}; globe ${radiusPx.toFixed(0)} px radius at (${centreX.toFixed(0)},${centreY.toFixed(0)}); 1 px = ${(25362 / radiusPx).toFixed(0)} km`);

  const { data, info } = await sharp(fileURLToPath(file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, channels } = info;
  const lum = (x, y) => { const i = (y * width + x) * channels; return (data[i] + data[i+1] + data[i+2]) / 3 / 255; };
  // Flux-style invariant. The ring darkens the globe it crosses; the amount of light it
  // takes out is proportional to the area it covers, so summing the darkening over the
  // rows and multiplying by the area of a pixel must be independent of how far away the
  // camera is. A ring that the rasteriser samples stochastically loses light at coarse
  // framings and breaks the invariant; one drawn with continuous coverage keeps it.
  // Local baseline: the row's own median after dropping its darkest 5%, so the globe's
  // smooth shading and limb darkening cancel and only narrow dark features remain. What
  // those features take out of the row is proportional to the area the ring covers, so
  // the sum times the area of a pixel must not depend on the camera distance. A ring the
  // rasteriser samples stochastically loses light when it gets small and breaks that;
  // one drawn with continuous coverage keeps it.
  let removed = 0, rows = 0;
  for (let y = Math.round(centreY - radiusPx * 0.62); y <= Math.round(centreY + radiusPx * 0.62); y++) {
    const values = [];
    for (let x = Math.round(centreX - radiusPx * 0.86); x <= Math.round(centreX + radiusPx * 0.86); x++) values.push(lum(x, y));
    const sorted = [...values].sort((a, b) => a - b);
    const kept = sorted.slice(0, Math.floor(sorted.length * 0.95));
    const baseline = kept[Math.floor(kept.length * 0.5)];
    if (baseline < 0.25) continue;
    for (const v of values) removed += Math.max(0, baseline - v) / baseline;
    rows++;
  }
  const kmPerPx = 25362 / radiusPx;
  console.log(`  rows ${rows}; removed ${removed.toFixed(1)} px-rows; invariant removed x km^2 = ${(removed * kmPerPx * kmPerPx).toExponential(3)}`);
} finally { await browser.close(); }
