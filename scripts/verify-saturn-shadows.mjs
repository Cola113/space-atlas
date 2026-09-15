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
  assert.equal((await page.evaluate(() => window.solarAtlas.snapshot())).landmarks.markers.find(m => m.id === 'ring-shadow').available, enabled);
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
    assert.equal(await page.locator('#ring-shadow-legend').count(), 0);
    assert.equal(state.landmarks.markers.find(m => m.id === 'ring-shadow').available, true);
    assert.equal(await page.locator('#shadow-toggle').getAttribute('aria-label'), '土星环投影');
    const layout = await page.evaluate(() => {
      const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; };
      return { info: box('#planet-info'), footer: box('.explorer-bottom'),
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(!layout.overflow);
    assert.ok(layout.info.bottom <= layout.footer.y - 7.9, `${name}: controls crowd footer`);
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
      // Reopening settings and switching bodies must keep the marker and toggle in sync.
      await toggle(page, true);
      await page.locator('#surface-button').click(); await settle(page);
      assert.equal((await page.evaluate(() => window.solarAtlas.snapshot())).landmarks.markers.find(m => m.id === 'ring-shadow').available, true);
      await page.locator('#back-button').click(); await settle(page);
      assert.equal(await page.locator('[data-landmark="ring-shadow"]').count(), 0);
      await page.locator('#explore-earth').click(); await settle(page);
      assert.equal(await page.locator('[data-landmark="ring-shadow"]').count(), 0);
      assert.equal(await page.locator('#shadow-toggle').getAttribute('aria-label'), '云层投影');
    }
    assert.deepEqual(errors, []);
    report.push({ name, date: state.date, camera: state.camera, target: state.target,
      orientation: body.orientation, sunDirection: body.sunDirection, layout, errors, passed: true });
    console.log(`${name}: scene marker, toggle wiring, layout and the ring-plane shadow pixels passed`);
    await context.close();
  }
  // The planet's shadow across the ring plane, measured on the ring surface alone.
  //
  // The dynamic layers are switched off for this pair: the ring particle swarm also
  // follows the projection toggle, but only by scaling its own alpha, and in these
  // framings it leaves a few hundred changed pixels that swamp the surface's shadow when
  // both are counted together. With the layers off the two states are unambiguous - a
  // working shadow darkens about 55,000 pixels of the ring annulus by more than 10%, and
  // a shadow that never reaches the ring surface darkens none. That is the regression
  // that shipped between 2026-09-15's ring generalisation and this check, and it was
  // found by eye rather than by any of the checks above.
  {
    const shots = {};
    for (const shadows of [true, false]) {
      const context = await browser.newContext({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
      await context.addInitScript(({ shadows }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
        version: 1, value: { selected: 'saturn', playing: false, shadows, dynamics: false,
          followRotation: false, date: Date.UTC(2002, 9, 1), speed: 1000, speedUnit: 'realtime', direction: 1, portrait: false },
      })), { shadows });
      const page = await context.newPage();
      await page.goto(base + '/solar-system/');
      await settle(page);
      await page.waitForTimeout(900);
      const state = await page.evaluate(() => window.solarAtlas.snapshot());
      const body = state.bodies.find(b => b.id === 'saturn');
      const buffer = await page.screenshot();
      if (shadows) await writeFile(new URL('ring-plane-shadow.png', output), buffer);
      else await writeFile(new URL('ring-plane-shadow-off.png', output), buffer);
      shots[shadows ? 'on' : 'off'] = { buffer, body };
      await context.close();
    }
    const pixels = async entry => {
      const { data, info } = await sharp(entry.buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return { data, info, lum: i => (data[i] + data[i + 1] + data[i + 2]) / 3 / 255 };
    };
    const on = await pixels(shots.on), off = await pixels(shots.off);
    const ratio = 2;
    const cx = shots.on.body.x * ratio, cy = shots.on.body.y * ratio, radiusPx = shots.on.body.radiusPx * ratio;
    let annulus = 0, strong = 0, deepest = 0;
    for (let y = 0; y < on.info.height; y++) for (let x = 0; x < on.info.width; x++) {
      const distance = Math.hypot(x - cx, y - cy) / radiusPx;
      if (distance < 1.15 || distance > 2.4) continue;
      annulus++;
      const i = (y * on.info.width + x) * on.info.channels;
      const drop = (off.lum(i) - on.lum(i));
      if (drop > deepest) deepest = drop;
      if (drop > .1) strong++;
    }
    console.log(`ring-plane shadow on the ring surface: ${strong} px of ${annulus} darkened by more than 10%, deepest ${deepest.toFixed(3)}`);
    report.push({ name: 'ring-plane-shadow', annulus, strongPixels: strong, deepestDarkening: Number(deepest.toFixed(3)) });
    assert.ok(deepest > .2, `the projection barely darkens the ring surface: deepest ${deepest.toFixed(3)}`);
    assert.ok(strong > 2000, `the projection darkens too little of the ring plane: ${strong} px of ${annulus}`);
  }
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
} finally { await browser.close(); }
