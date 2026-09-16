// 着陆天空里的天体是否与太阳系视图同模型、同贴图：量形状与环，并检查着色器无报错。
//   npx tsx scripts/verify-sky-bodies.mjs
import { chromium } from 'playwright';
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

const browser = await chromium.launch({ channel: 'msedge', headless: true });
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

  assert.deepEqual(errors, []);
  await writeFile(new URL('report.json', output), JSON.stringify({ base, report }, null, 2));
  console.log(JSON.stringify(report, null, 1));
} finally {
  await browser.close();
}
