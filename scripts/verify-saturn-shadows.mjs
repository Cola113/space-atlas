import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from 'three';
import sharp from 'sharp';
import { configureDeploymentAccess } from './deployment-access.mjs';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5191';
const output = new URL(process.env.ATLAS_OUTPUT || '../test-results/saturn-shadows/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = [];
const settle = page => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked &&
    (s.selected !== 'saturn' || s.bodies.find(b => b.id === 'saturn').textureWidth >= 2048);
}, null, { timeout: 90000 });
async function toggle(page, enabled) {
  await page.locator('#observation-settings summary').click();
  await page.locator('#shadow-toggle').setChecked(enabled);
  await page.keyboard.press('Escape');
  await page.waitForFunction(enabled => window.solarAtlas.snapshot().shadows === enabled, enabled);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#ring-shadow-legend').isVisible(), enabled);
}
try {
  const probe = await browser.newContext({ viewport: { width: 1000, height: 1000 }, reducedMotion: 'reduce' });
  await configureDeploymentAccess(probe, base);
  const first = await probe.newPage();
  await first.goto(base + '/solar-system/');
  await settle(first);
  await first.locator('.planet-choice[data-body="saturn"]').click();
  await settle(first);
  const seed = await first.evaluate(() => window.solarAtlas.snapshot());
  const saturn = seed.bodies.find(b => b.id === 'saturn');
  await probe.close();
  for (const [name, width, height, pole] of [
    ['north', 1000, 1000, 1], ['south', 1000, 1000, -1],
    ['desktop', 1440, 900], ['phone', 390, 844], ['short', 800, 450], ['compact', 640, 360],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    await configureDeploymentAccess(context, base);
    const offset = pole ? new Vector3(.2, pole, .15).normalize()
      .applyQuaternion(new Quaternion().fromArray(saturn.orientation)).multiplyScalar(saturn.radius * 4.2).toArray() : undefined;
    await context.addInitScript(({ date, offset }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
      version: 1, value: { selected: 'saturn', playing: false, shadows: true, dynamics: true,
        followRotation: false, date, speed: 1000, speedUnit: 'realtime', direction: 1, offset, portrait: false },
    })), { date: seed.date, offset });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base + '/solar-system/');
    await settle(page);
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => window.solarAtlas.snapshot());
    assert.equal(await page.locator('#ring-shadow-legend').isVisible(), true);
    assert.equal(await page.locator('#shadow-toggle').getAttribute('aria-label'), '土星环投影');
    const layout = await page.evaluate(() => {
      const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; };
      const legend = document.getElementById('ring-shadow-legend'), r = legend.getBoundingClientRect();
      return { legend: box('#ring-shadow-legend'), info: box('#planet-info'), footer: box('.explorer-bottom'),
        hit: legend.contains(document.elementFromPoint(r.x + 12, r.y + r.height / 2)),
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(layout.hit && !layout.overflow && layout.legend.x >= 0 && layout.legend.right <= width);
    assert.ok(layout.info.bottom <= layout.footer.y - 7.9, `${name}: legend crowds footer`);
    const before = await page.screenshot({ path: fileURLToPath(new URL(name + '.png', output)) });
    const body = state.bodies.find(b => b.id === 'saturn');
    const crop = { left: Math.max(0, Math.min(width - 620, Math.round(body.x - 310))),
      top: Math.max(0, Math.min(height - 620, Math.round(body.y - 310))), width: 620, height: 620 };
    if (pole) await sharp(before).extract(crop).toFile(fileURLToPath(new URL(name + '-full.png', output)));
    await toggle(page, false);
    const after = await page.screenshot();
    if (pole) await sharp(after).extract(crop).toFile(fileURLToPath(new URL(name + '-without-shadows.png', output)));
    const unchanged = await page.evaluate(() => window.solarAtlas.snapshot());
    assert.deepEqual(unchanged.camera, state.camera);
    assert.equal(unchanged.date, state.date);
    if (!pole) {
      // Reopening settings and switching bodies must keep the text and legend in sync.
      await toggle(page, true);
      await page.locator('#surface-button').click(); await settle(page);
      assert.equal(await page.locator('#ring-shadow-legend').isVisible(), true);
      await page.locator('#back-button').click(); await settle(page);
      assert.equal(await page.locator('#ring-shadow-legend').isVisible(), false);
      await page.locator('#explore-earth').click(); await settle(page);
      assert.equal(await page.locator('#ring-shadow-legend').isVisible(), false);
      assert.equal(await page.locator('#shadow-toggle').getAttribute('aria-label'), '云层投影');
    }
    assert.deepEqual(errors, []);
    report.push({ name, date: state.date, camera: state.camera, target: state.target,
      orientation: body.orientation, sunDirection: body.sunDirection, layout, errors, passed: true });
    console.log(`${name}: ring shadow rendering, legend and toggle passed`);
    await context.close();
  }
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
} finally { await browser.close(); }
