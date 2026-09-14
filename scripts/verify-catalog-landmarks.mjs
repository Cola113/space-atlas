import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from 'three';
import sharp from 'sharp';
import { configureDeploymentAccess } from './deployment-access.mjs';
import { aimAtLanding } from './landing-navigation.mjs';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5191';
const output = new URL('../test-results/catalog-landmarks/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = [];
let currentPage, currentName;
const snapshot = page => page.evaluate(() => window.solarAtlas.snapshot());
const settle = page => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked && document.getElementById('loading-screen').hidden;
}, null, { timeout: 90000 });
async function selectBody(page, id, catalog = 'planets') {
  await page.locator('#catalog-filter').selectOption(catalog);
  await page.locator(`.planet-choice[data-body="${id}"]`).click();
  await settle(page);
  await page.waitForFunction(id => window.solarAtlas.snapshot().bodies.find(b => b.id === id).detailReady, id);
}
async function selectFeature(page, id) {
  await page.locator('#observation-settings summary').click();
  await page.locator('#landmark-select').selectOption(id);
  await page.keyboard.press('Escape');
  await settle(page);
  await page.waitForFunction(id => window.solarAtlas.snapshot().landmarks.active === id, id);
  await page.waitForFunction(() => !document.querySelector('#landmark-brief')?.hidden);
  assert.ok((await page.locator('#landmark-brief-text').textContent()).trim().length > 10, `${id}: missing landmark brief`);
}
async function capture(page, name) {
  const state = await snapshot(page);
  if (state.landmarks.active)
    assert.ok(state.landmarks.markers.find(marker => marker.id === state.landmarks.active)?.visible, name + ': selected marker is hidden');
  await page.screenshot({ path: fileURLToPath(new URL(name + '.png', output)) });
  const image = await page.locator('canvas').first().screenshot();
  const pixels = await sharp(image).resize(96, 64).removeAlpha().raw().toBuffer();
  assert.ok([...pixels].filter(value => value > 25).length > 100, name + ': blank canvas');
  const layout = await page.evaluate(() => {
    const reserved = ['#planet-info', '#observation-tools', '.scene-toolbar', '.explorer-bottom']
      .map(selector => document.querySelector(selector)).filter(el => !el.hidden).map(el => el.getBoundingClientRect());
    return { overflow: document.documentElement.scrollWidth > innerWidth,
      markers: [...document.querySelectorAll('[data-landmark]:not([hidden])')].map(button => {
        const label = button.querySelector('.landmark-name'), r = label.getBoundingClientRect();
        return { id: button.dataset.landmark, x: r.x, y: r.y, right: r.right, bottom: r.bottom,
          inBounds: r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight,
          clickable: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
          overlaps: reserved.some(b => r.x < b.right && r.right > b.x && r.y < b.bottom && r.bottom > b.y) };
      }) };
  });
  assert.equal(layout.overflow, false);
  for (const marker of layout.markers) assert.ok(marker.inBounds && marker.clickable && !marker.overlaps, JSON.stringify(marker));
  if (state.landmarks.active) {
    const brief = page.locator('#landmark-brief');
    const box = await brief.boundingBox(), vp = page.viewportSize();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height, name + ': brief outside viewport');
    assert.equal(await brief.evaluate(el => el.scrollWidth > el.clientWidth), false, name + ': brief text overflows');
  }
  report.push({ name, layout });
}
function checkPolarAim(state, id, pole = 1) {
  const body = state.bodies.find(b => b.id === id);
  const north = new Vector3(0, pole, 0).applyQuaternion(new Quaternion().fromArray(body.orientation));
  const view = new Vector3().fromArray(state.camera).sub(new Vector3().fromArray(state.target)).normalize();
  assert.ok(view.dot(north) > .995, `${id}: camera did not reach the pole (${view.dot(north)})`);
}
try {
  for (const [name, width, height] of [['desktop', 1440, 900], ['phone', 390, 844], ['short', 800, 450], ['compact', 640, 360]]
    .filter(([name]) => !process.env.ATLAS_VIEWPORT || name === process.env.ATLAS_VIEWPORT)) {
    currentName = name;
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: process.env.ATLAS_MOTION ? 'no-preference' : 'reduce', hasTouch: name === 'phone' });
    await configureDeploymentAccess(context, base);
    await context.addInitScript(() => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({ version: 1, value: { playing: false, followRotation: false } })));
    const page = await context.newPage(), errors = [];
    currentPage = page;
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base + '/solar-system/'); await settle(page);
    const badges = await page.evaluate(async () => {
      const { landableBodyIds } = await import('/solar-system/src/surface/sites.js');
      return { expected: landableBodyIds.slice().sort(), dock: [...document.querySelectorAll('.planet-choice:has(.landing-badge)')].map(el => el.dataset.body).sort(),
        atlas: [...document.querySelectorAll('.atlas-item:has(.landing-badge)')].map(el => el.dataset.body).sort() };
    });
    assert.deepEqual(badges.dock, badges.expected); assert.deepEqual(badges.atlas, badges.expected);
    await page.locator('#atlas-tab').click();
    await page.locator('#atlas-system').selectOption('saturn');
    await capture(page, name + '-atlas');
    await page.locator('.atlas-item[data-body="saturn"]').click(); await settle(page);
    assert.equal((await snapshot(page)).catalog, 'system:saturn');
    const moonNames = await page.locator('.planet-choice:not([hidden]) .choice-name').allTextContents();
    assert.deepEqual(moonNames.slice(0, 12), ['土星', '土卫一', '土卫二', '土卫三', '土卫四', '土卫五', '土卫六', '土卫七', '土卫八', '土卫九', '土卫十', '土卫十一']);
    assert.equal(await page.locator('#ring-shadow-legend').count(), 0);
    await selectFeature(page, 'ring-shadow');
    assert.equal((await snapshot(page)).landmarks.markers.find(m => m.id === 'ring-shadow').visible, true);
    await capture(page, name + '-ring-shadow');
    await page.locator('#landmark-brief-close').click();
    assert.equal(await page.locator('#landmark-brief').isVisible(), false);
    assert.equal((await snapshot(page)).landmarks.active, 'ring-shadow', 'closing information preserves feature tracking');
    await page.locator('[data-landmark="ring-shadow"] .landmark-name').click(); await settle(page);
    assert.equal(await page.locator('#landmark-brief').isVisible(), true);
    await selectFeature(page, 'hexagon');
    checkPolarAim(await snapshot(page), 'saturn');
    assert.equal((await snapshot(page)).landmarks.markers.find(m => m.id === 'hexagon').visible, true);
    await capture(page, name + '-hexagon');
    await selectBody(page, 'mars');
    await selectFeature(page, 'north-pole');
    checkPolarAim(await snapshot(page), 'mars');
    await capture(page, name + '-mars-pole');
    await selectBody(page, 'earth');
    assert.equal((await snapshot(page)).catalog, 'system:earth');
    await selectFeature(page, 'himalaya');
    assert.equal((await snapshot(page)).landmarks.markers.find(m => m.id === 'himalaya').visible, true);
    await capture(page, name + '-himalaya');
    const earthBefore = await snapshot(page);
    await page.locator('#play-toggle').click();
    await page.waitForTimeout(1200);
    const moving = await snapshot(page);
    assert.equal(moving.followRotation, true);
    assert.ok(moving.date > earthBefore.date);
    assert.notDeepEqual(moving.camera, earthBefore.camera);
    assert.equal(moving.landmarks.markers.find(m => m.id === 'himalaya').visible, true);
    await page.locator('#play-toggle').click();
    await selectBody(page, 'venus');
    assert.equal((await snapshot(page)).catalog, 'planets');
    assert.equal((await snapshot(page)).followRotation, false);
    for (const id of ['moon', 'europa', 'mars', 'io', 'titan', 'enceladus', 'pluto', 'miranda', 'mercury']) {
      await page.locator('#atlas-tab').click();
      await page.locator('#atlas-system').selectOption('all');
      await page.locator('#atlas-search').fill(id);
      await page.locator(`.atlas-item[data-body="${id}"]`).click();
      await settle(page);
      const landing = page.locator(`[data-landing-body="${id}"]`);
      assert.equal(await landing.count(), 1, `${id}: missing landing coordinate marker`);
      const initialPin = (await snapshot(page)).landmarks.landing;
      if (!initialPin.exposed) assert.equal(await landing.isVisible(), false, `${id}: obscured landing point is visible`);
      if (['moon', 'enceladus'].includes(id)) {
        await aimAtLanding(page, id, {back:true});
        assert.equal((await snapshot(page)).landmarks.landing.exposed, false);
        assert.equal(await landing.isVisible(), false);
        await aimAtLanding(page, id);
        assert.equal(await landing.isVisible(), true);
        const r = await landing.boundingBox(), icon = await landing.locator('svg').boundingBox();
        assert.ok(r.width >= 44 && r.height >= 44);
        assert.ok(icon.width <= 14 && icon.height <= 14);
        await landing.click({trial:true});
        await capture(page, `${name}-${id}-landing-point`);
      }
      assert.equal(await landing.locator('svg').count(), 1);
    }
    assert.equal(await page.locator('#landing-button').count(), 0);
    if (name === 'desktop') {
      await selectBody(page, 'saturn');
      for (let i = 0; i < 35 && (await snapshot(page)).catalog.startsWith('system:'); i++) {
        await page.locator('#zoom-out').click(); await settle(page); await page.waitForTimeout(180);
      }
      assert.equal((await snapshot(page)).catalog, 'planets', 'zoom out restores main catalog');
      for (let i = 0; i < 35 && (await snapshot(page)).catalog === 'planets'; i++) {
        await page.locator('#zoom-in').click(); await settle(page); await page.waitForTimeout(180);
      }
      assert.equal((await snapshot(page)).catalog, 'system:saturn', 'zoom in restores system catalog');
      await page.locator('#catalog-filter').selectOption('dwarfs');
      await page.waitForTimeout(500);
      assert.equal((await snapshot(page)).catalog, 'dwarfs', 'manual category stays selected until crossing a distance boundary');
    }
      await selectBody(page, 'sun');
      await page.waitForFunction(() => window.solarAtlas.snapshot().landmarks.markers.find(m => m.id === 'prominence')?.available);
      await selectFeature(page, 'prominence');
      await capture(page, name + '-prominence');
      await page.locator('#landmark-brief-close').click();
      await page.locator('#play-toggle').click();
      await page.locator('#body-details-button').click();
      await page.locator('#activity-rate').selectOption('4');
      await page.locator('#event-trigger').click();
      await page.waitForFunction(() => window.solarAtlas.snapshot().landmarks.markers.find(m => m.id === 'solar-eruption')?.available);
      await page.locator('#play-toggle').click();
      await selectFeature(page, 'solar-eruption');
      await capture(page, name + '-solar-eruption');
      await page.locator('#play-toggle').click();
      await page.waitForFunction(() => window.solarAtlas.snapshot().dynamics.bodies.find(b => b.id === 'sun').eventProgress > .65);
      await page.locator('#play-toggle').click();
      await capture(page, name + '-solar-eruption-expanded');
      const paused = await snapshot(page);
      await page.waitForTimeout(300);
      assert.deepEqual((await snapshot(page)).camera, paused.camera);
      await page.locator('#play-toggle').click();
      await page.waitForFunction(() => !window.solarAtlas.snapshot().landmarks.markers.find(m => m.id === 'solar-eruption')?.available, null, { timeout: 20000 });
      assert.equal((await snapshot(page)).landmarks.active, null);
      await page.locator('#play-toggle').click();
      await selectBody(page, 'enceladus', 'system:saturn');
      await page.waitForFunction(() => window.solarAtlas.snapshot().landmarks.markers.find(m => m.id === 'ice-plume')?.available);
      await selectFeature(page, 'ice-plume'); await capture(page, name + '-ice-plume');
      await selectBody(page, 'io', 'system:jupiter');
      assert.equal((await snapshot(page)).landmarks.markers.find(m => m.id === 'volcanic-plume').available, false);
      await page.locator('#play-toggle').click();
      await page.locator('#body-details-button').click();
      await page.locator('#event-trigger').click();
      await page.waitForFunction(() => window.solarAtlas.snapshot().landmarks.markers.find(m => m.id === 'volcanic-plume')?.available);
      await page.locator('#play-toggle').click();
      await selectFeature(page, 'volcanic-plume'); await capture(page, name + '-volcanic-plume');
    assert.deepEqual(errors, []);
    console.log(`${name}: sorted catalog, landing badges, landmark navigation and layout passed`);
    await context.close(); currentPage = null;
  }
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: fileURLToPath(new URL(currentName + '-failure.png', output)) });
    await writeFile(new URL(currentName + '-failure.json', output), JSON.stringify(await snapshot(currentPage), null, 2));
  }
  throw error;
} finally { await browser.close(); }
