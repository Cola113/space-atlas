import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5200';
const root = new URL('./', import.meta.url);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const date = Date.UTC(2026, 8, 25, 12);
const settle = page => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked && document.getElementById('loading-screen').hidden;
}, null, { timeout: 90000 });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(date => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
    version: 1, value: { selected: 'uranus', playing: false, shadows: true, dynamics: false,
      followRotation: false, date, speed: 1000, speedUnit: 'realtime', direction: 1, portrait: false },
  })), date);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + '/solar-system/');
  await settle(page);
  const select = async id => {
    await page.locator('#catalog-filter').selectOption('planets');
    await page.locator(`.planet-choice[data-body="${id}"]`).click();
    await settle(page);
    await page.waitForTimeout(500);
    assert.equal((await page.evaluate(() => window.solarAtlas.snapshot())).selected, id);
  };
  // Warm every ring in one context, then revisit Uranus to catch shared-program
  // cache contamination (all ring materials intentionally use the same cache key).
  for (const id of ['saturn', 'uranus', 'neptune', 'jupiter', 'uranus']) await select(id);
  const before = await page.evaluate(() => window.solarAtlas.snapshot());
  assert.equal(before.date, date);
  assert.equal(before.playing, false);
  await page.locator('#body-details-button').click();
  assert.ok((await page.locator('#body-details-dialog').innerText()).includes('艺术增强'));
  await page.locator('#close-body-details').click();
  await page.locator('#display-settings summary').click();
  await page.locator('#activity-toggle').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.equal((await page.evaluate(() => window.solarAtlas.snapshot())).date, date);
  await page.locator('#play-toggle').click();
  await page.waitForFunction(date => window.solarAtlas.snapshot().date > date, date);
  await page.locator('#play-toggle').click();
  const paused = await page.evaluate(() => window.solarAtlas.snapshot());
  await page.waitForTimeout(500);
  const still = await page.evaluate(() => window.solarAtlas.snapshot());
  assert.equal(still.date, paused.date);
  assert.deepEqual(still.bodies.find(b => b.id === 'uranus').orientation, paused.bodies.find(b => b.id === 'uranus').orientation);
  await page.locator('#surface-button').click();
  await settle(page);
  assert.equal((await page.evaluate(() => window.solarAtlas.snapshot())).selected, 'uranus');
  await page.locator('#back-button').click();
  await settle(page);
  await select('uranus');
  const screenshot = await page.locator('#universe canvas').screenshot();
  await writeFile(new URL('production-interaction.png', root), screenshot);
  const { data, info } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const state = await page.evaluate(() => window.solarAtlas.snapshot());
  const body = state.bodies.find(b => b.id === 'uranus');
  let visibleRingPixels = 0;
  for (let y = 270; y < 780; y++) for (let x = 540; x < 1270; x++) {
    const r = Math.hypot(x - body.x, y - body.y) / body.radiusPx;
    if (r < 1.15 || r > 2.3) continue;
    const i = (y * info.width + x) * info.channels;
    const value = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (value > 15 && value < 180) visibleRingPixels++;
  }
  assert.ok(visibleRingPixels > 1000, `Rings disappeared after changing planets: ${visibleRingPixels} pixels`);
  assert.deepEqual(errors, []);
  const report = { passed: true, errors, visibleRingPixels, pausedDate: paused.date,
    checks: ['normal camera transitions', 'shared shader cache', 'artistic disclosure', 'activity toggle', 'play/pause', 'close view and return', 'canvas pixels'] };
  await writeFile(new URL('interaction-report.json', root), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
