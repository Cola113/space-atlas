// 着陆天空里的天体是否与太阳系视图同模型、同贴图：量形状与环，并检查着色器无报错。
//   npx tsx scripts/verify-sky-bodies.mjs
import { chromium } from 'playwright';
import {launchBrowser} from './browser-launch.mjs';

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { bodyModels } from '../solar-system/src/body-models.js';
import { ringSystemFor } from '../solar-system/src/ring-systems.js';
import { revealLanding } from './landing-navigation.mjs';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5197';
const output = new URL(process.env.ATLAS_OUTPUT || '../test-results/sky-bodies/', import.meta.url);
await mkdir(output, { recursive: true });
const overlays = '.surface-header,.surface-footer,.surface-location,.surface-crosshair,.surface-message,.surface-details,.surface-clock-panel,.surface-vignette,.surface-target,.surface-ephemeris,.surface-journey-caption,.surface-skip{visibility:hidden !important}';

const browser = await launchBrowser();
const report = [];
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /shader|program|GL_INVALID/i.test(message.text())) errors.push(message.text()); });
  page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(base + '/solar-system/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.solarAtlas?.snapshot().ready && document.getElementById('loading-screen').hidden, null, { timeout: 90000 });

  const land = async (siteId, bodyId) => {
    if (!await page.locator('#atlas-search').isVisible()) await page.locator('#atlas-tab').click();
    await page.locator('#atlas-search').fill(bodyId);
    await page.locator(`.atlas-item[data-body="${bodyId}"]`).click();
    await page.waitForFunction(body => window.solarAtlas.snapshot().selected === body && !window.solarAtlas.snapshot().flight, bodyId, { timeout: 30000 });
    await page.waitForFunction(() => !window.solarAtlas.snapshot().ephemeris.blocked);
    await revealLanding(page, siteId);
    await page.locator(`[data-landing-site="${siteId}"]`).click();
    await page.waitForFunction(() => document.querySelector('.surface-view')?.dataset.ready === 'true', null, { timeout: 90000 });
  };
  const capture = async () => {
    const style = await page.addStyleTag({ content: overlays });
    const buffer = await page.locator('.surface-canvas canvas').screenshot();
    await style.evaluate(element => element.remove());
    return sharp(buffer).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  };
  const exit = async () => {
    await page.locator('.surface-exit').click();
    await page.waitForFunction(() => !document.querySelector('.surface-view'), null, { timeout: 10000 });
  };

  // 1. The parent's outline is asserted in the unit tests, not here: a planet seen from its
  //    own moon is usually a crescent, and the bounding box of a lit crescent is not the
  //    disc, so a pixel ratio would measure the phase rather than the shape.

  // 2. Saturn's rings from Enceladus, which orbits inside the ring plane: this is the
  //    geometry a Lambert surface renders black and the slab model renders as a line.
  await land('enceladus', 'enceladus');
  await page.locator('.surface-parent').click();
  await page.waitForTimeout(800);
  {
    const shot = await capture();
    const value = (x, y) => shot.data[y * shot.info.width + x];
    // Sky level well above the ring, then the brightest row within a few pixels of the
    // ring line on the sunward side of the planet.
    // The ring is a line a pixel or two wide at this opening angle, so a row average
    // dilutes it into the sky. The peak within the band is the quantity that says whether
    // the slab is lit; the sky is the same statistic measured well away from the ring.
    const peakIn = (x0, x1, y0, y1) => {
      let peak = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (value(x, y) > peak) peak = value(x, y);
      return peak;
    };
    const sky = peakIn(600, 950, 40, 140);
    let ringPeak = 0, ringRow = 0;
    for (let y = 250; y < 430; y++) {
      let peak = 0;
      for (let x = 660; x < 990; x++) if (value(x, y) > peak) peak = value(x, y);
      if (peak > ringPeak) { ringPeak = peak; ringRow = y; }
    }
    report.push({ check: 'saturn-ring', skyPeak: sky, ringPeak, ringRow });
    const span = system => system.regions.reduce((total, [, inner]) => Math.min(total, inner), Infinity);
    assert.ok(Math.abs(span(ringSystemFor('saturn')) - 66900) < 1, 'the shipped ring system no longer starts at the D ring');
    assert.ok(ringPeak > sky + 20, `the ring is not lit above the sky (ring peak ${ringPeak} vs sky peak ${sky})`);
    await page.screenshot({ path: fileURLToPath(new URL('enceladus-rings.png', output)) });
  }
  await exit();

  // 3. Saturn's rings from Iapetus (inclined orbit, sunlit south face in 2031): wide open rings.
  await page.locator('#display-settings summary').click();
  await page.locator('#moments-button').click();
  await page.locator('[data-moment-id="iapetus-open-rings"]').click();
  await page.waitForFunction(() => document.querySelector('.surface-view')?.dataset.ready === 'true', null, { timeout: 90000 });
  await page.locator('.surface-parent').click();
  await page.waitForTimeout(800);
  {
    const shot = await capture();
    const width = shot.info.width;
    const value = (x, y) => shot.data[y * width + x];
    const skySamples = [];
    for (let y = 30; y < 140; y++) for (let x = 200; x < 800; x++) skySamples.push(value(x, y));
    skySamples.sort((a, b) => a - b);
    const skyP95 = skySamples[Math.floor(skySamples.length * 0.95)];
    let centerPeak = 0, litPixels = 0;
    for (let y = 270; y < 430; y++) for (let x = 420; x < 580; x++) {
      const v = value(x, y);
      if (v > centerPeak) centerPeak = v;
      if (v > 60) litPixels++;
    }
    report.push({ check: 'iapetus-saturn-rings', skyP95, centerPeak, litPixels });
    assert.ok(skyP95 < 20, `Iapetus upper sky is not clear black (skyP95=${skyP95})`);
    assert.ok(centerPeak > 100 && litPixels >= 15, `Iapetus Saturn rings not lit clearly above horizon (centerPeak=${centerPeak}, litPixels=${litPixels})`);
    await page.screenshot({ path: fileURLToPath(new URL('iapetus-rings.png', output)) });

    for (let k = 0; k < 3; k++) await page.locator('.surface-telescope').click();
    await page.waitForFunction(() => window.solarAtlas.snapshot().surface?.magnification === 8);
    await page.waitForTimeout(300);
    const shot8x = await capture();
    const val8x = (x, y) => shot8x.data[y * shot8x.info.width + x];
    const skySamples8x = [];
    for (let y = 20; y < 90; y++) for (let x = 100; x < 900; x++) skySamples8x.push(val8x(x, y));
    skySamples8x.sort((a, b) => a - b);
    const skyP958x = skySamples8x[Math.floor(skySamples8x.length * 0.95)];
    let litPixels8x = 0;
    for (let y = 200; y < 500; y++) for (let x = 300; x < 700; x++) if (val8x(x, y) > 60) litPixels8x++;
    report.push({ check: 'iapetus-saturn-rings-8x', skyP95: skyP958x, litPixels8x });
    assert.ok(skyP958x < 20, `Iapetus 8x upper sky is not clear black (skyP95=${skyP958x})`);
    assert.ok(litPixels8x >= 400, `Iapetus 8x Saturn+rings too small or occluded (litPixels8x=${litPixels8x})`);
    await page.screenshot({ path: fileURLToPath(new URL('iapetus-rings-8x.png', output)) });
  }
  await exit();

  assert.deepEqual(errors, []);
  await writeFile(new URL('report.json', output), JSON.stringify({ base, report }, null, 2));
  console.log(JSON.stringify(report, null, 1));
} finally {
  await browser.close();
}
