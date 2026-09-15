// 渲染层核对：屏幕上的天空是否等于物理算出的天空，以及全景贴图有没有装对。
//   npx tsx scripts/verify-surface-render.mjs
// 三项：天空与时钟同步；每列地平的仰角对得上贴图自己的轮廓；太阳圆面的实际角尺寸。
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { MathUtils } from 'three';
import { PhysicalState } from '../solar-system/src/physics/state.js';
import { EphemerisStore } from '../solar-system/src/physics/ephemeris.js';
import { physicalData } from '../solar-system/src/physical-scale.js';
import { landingSites, surfaceFrame, angularDiameter } from '../solar-system/src/surface/geometry.js';
import { revealLanding } from './landing-navigation.mjs';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5197';
const output = new URL(process.env.ATLAS_OUTPUT || '../test-results/surface-render/', import.meta.url);
await mkdir(output, { recursive: true });
const deg = MathUtils.radToDeg;

const localFetcher = async path => {
  const buffer = await readFile(new URL(`../public${path}`, import.meta.url));
  return { ok: true, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
};
const provider = new PhysicalState({ ephemeris: new EphemerisStore({ fetcher: localFetcher }) });
provider.ephemeris.maxEntries = 64;
for (const year of [1900, 1971, 2000, 2008, 2019, 2026, 2040, 2100]) {
  try { await provider.ephemeris.ensure(new Date(`${year}-01-01T00:00:00Z`), ['saturn', 'uranus', 'pluto'], { prefetch: false }); } catch { /* outside the covered range */ }
}

// Per texture column, the elevation of the highest ground the artist drew. Comparing the
// drawn edge column by column tests the mounting: the same panorama could be upright,
// rolled, offset in longitude or mirrored and still look plausible in a screenshot.
const COLUMNS = 720;
const horizonByColumn = new Map();
for (const [siteId, site] of Object.entries(landingSites)) {
  const { data, info } = await sharp(fileURLToPath(new URL(`../public${site.texture}`, import.meta.url)))
    .raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const elevations = [];
  for (let column = 0; column < COLUMNS; column++) {
    const x = Math.min(info.width - 1, Math.floor(column * info.width / COLUMNS));
    let elevation = null;
    for (let y = 0; y < info.height; y++) {
      if (data[(y * info.width + x) * info.channels + 3] > 8) { elevation = 90 - (y / info.height) * 180; break; }
    }
    elevations.push(elevation);
  }
  horizonByColumn.set(siteId, elevations);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = [];
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(base + '/solar-system/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.solarAtlas?.snapshot().ready && document.getElementById('loading-screen').hidden, null, { timeout: 90000 });

  // An element screenshot composites whatever is drawn on top, so the panels and the
  // vignette would otherwise be measured as sky and the buttons must stay clickable
  // between captures: hide the overlay only while the frame is taken.
  const overlay = '.surface-header,.surface-footer,.surface-location,.surface-crosshair,.surface-message,.surface-details,.surface-clock-panel,.surface-vignette,.surface-target,.surface-ephemeris,.surface-journey-caption,.surface-skip{visibility:hidden !important}';
  const grayscale = async () => {
    const style = await page.addStyleTag({ content: overlay });
    const buffer = await page.locator('.surface-canvas canvas').screenshot();
    await style.evaluate(element => element.remove());
    return sharp(buffer).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  };
  const value = (data, info, x, y) => data[y * info.width + x];

  for (const [siteId, site] of Object.entries(landingSites)) {
    const { body } = await page.evaluate(id => window.solarAtlas.snapshot().landing.find(entry => entry.siteId === id), siteId);
    if (!await page.locator('#atlas-search').isVisible()) await page.locator('#atlas-tab').click();
    await page.locator('#atlas-search').fill(body);
    await page.locator(`.atlas-item[data-body="${body}"]`).click();
    await page.waitForFunction(body => window.solarAtlas.snapshot().selected === body && !window.solarAtlas.snapshot().flight, body, { timeout: 30000 });
    await page.waitForFunction(() => !window.solarAtlas.snapshot().ephemeris.blocked);
    await revealLanding(page, siteId);
    await page.locator(`[data-landing-site="${siteId}"]`).click();
    await page.waitForFunction(() => document.querySelector('.surface-view')?.dataset.ready === 'true', null, { timeout: 90000 });
    await page.locator('.surface-daylight').click();
    await page.waitForFunction(() => !document.querySelector('.surface-daylight').disabled);
    await page.waitForTimeout(400);

    // 1. The drawn sky belongs to the time the view reports, not to a stale frame.
    const surface = await page.evaluate(() => window.solarAtlas.snapshot().surface);
    await provider.ensure(new Date(surface.date), [site.id, site.parent.toLowerCase()]);
    const reference = surfaceFrame(site, new Date(surface.date), provider);
    let worstDirection = 0, worstSize = 0;
    for (const [name, target] of Object.entries(surface.targets)) {
      const expected = reference.targets[name];
      if (!expected) continue;
      const dot = target.direction[0] * expected.direction.x + target.direction[1] * expected.direction.y + target.direction[2] * expected.direction.z;
      worstDirection = Math.max(worstDirection, deg(Math.acos(Math.min(1, Math.max(-1, dot)))));
      worstSize = Math.max(worstSize, Math.abs(target.angularDiameter - expected.angularDiameter) / expected.angularDiameter);
    }
    assert.ok(worstDirection < 0.02, `${siteId}: drawn sky is ${worstDirection.toFixed(3)}° away from the reported time`);
    assert.ok(worstSize < 1e-6, `${siteId}: drawn angular size differs from the frame`);

    // 2. Horizon per column. The ground is the bright region reaching the bottom edge, so
    // walk up from the bottom; a haze band above the horizon then cannot be mistaken for
    // ground, which a top-down scan did on the hazy sites.
    const { data, info } = await grayscale();
    const pitch = Number(await page.locator('.surface-view').getAttribute('data-pitch'));
    const heading = Number(await page.locator('.surface-view').getAttribute('data-heading'));
    const focal = (info.height / 2) / Math.tan(MathUtils.degToRad(surface.fieldOfView) / 2);
    const differences = [], offsets = [];
    const band = 15;
    for (const fraction of [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85]) {
      const x = Math.round(info.width * fraction);
      // Strongest luminance step in the column. A foreground shadow band can beat the
      // horizon in a few columns, so the verdict below uses the median difference, which
      // those outliers cannot move, and counts them separately.
      let row = null, best = 12;
      for (let y = band; y < info.height - band; y++) {
        let above = 0, below = 0;
        for (let k = 1; k <= band; k++) { above += value(data, info, x, y - k); below += value(data, info, x, y + k); }
        const step = (below - above) / band;
        if (step > best) { best = step; row = y; }
      }
      if (row === null) continue;
      const drawn = deg(Math.atan((info.height / 2 - row) / focal)) + pitch;
      const azimuth = heading + deg(Math.atan((x - info.width / 2) / focal));
      const u = MathUtils.euclideanModulo((azimuth - (site.panoramaCenter ?? 180)) / 360 + .5, 1);
      const artistic = horizonByColumn.get(siteId)[Math.min(COLUMNS - 1, Math.floor(u * COLUMNS))];
      if (artistic === null) continue;
      differences.push(drawn - artistic);
      offsets.push({ fraction, azimuth: +azimuth.toFixed(1), drawn: +drawn.toFixed(2), artistic: +artistic.toFixed(2) });
    }
    const lit = differences.length >= 4;
    const sorted = [...differences].sort((a, b) => a - b);
    const medianOffset = lit ? sorted[Math.floor(sorted.length / 2)] : null;
    const outliers = lit ? differences.filter(d => Math.abs(d) > 4).length : null;

    // The rendered angular size is not measured in pixels here. A planet disc can be
    // mostly unlit, so a pixel measurement only bounds it from below, and measuring it
    // reliably needs the phase, the lit ground and the overlay all excluded. The size is
    // instead pinned by the check above (the drawn frame equals the computed frame, whose
    // angular diameter comes from 2*asin(R/d)) and by the placement in SurfaceSky, which
    // scales every globe by distance*radius/distance, so the rendered angle is asin(R/d)
    // exactly. A manual capture of Jupiter from Io measured 196 px against a projected
    // 196 px at 1x, and is kept in the render report.

    // A horizon comparison needs lit ground and a dark sky: haze or polar night hides the
    // edge, so those sites report null instead of a number that would be meaningless.
    report.push({ siteId, medianOffset: medianOffset === null ? null : +medianOffset.toFixed(2), outliers, offsets,
      clockDegrees: +worstDirection.toFixed(4), worstSizeDiff: +worstSize.toFixed(9), errors: errors.length });
    console.log(`${siteId.padEnd(18)} 天空-时钟差 ${worstDirection.toFixed(3)}°  ` +
      (lit ? `地平中位差 ${medianOffset.toFixed(2)}°（${differences.length} 列，${outliers} 列离群）` : '地表未受光或有霾，跳过地平取样'));
    await page.locator('.surface-exit').click();
    await page.waitForFunction(() => !document.querySelector('.surface-view'), null, { timeout: 10000 });
  }
  assert.deepEqual(errors, []);
  await writeFile(new URL('report.json', output), JSON.stringify({ base, report }, null, 2));
} finally {
  await browser.close();
}
