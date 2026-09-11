import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5190';
const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = [];
const settle = page => page.waitForFunction(() => window.solarAtlas?.snapshot().ready || window.observatory?.getState().ready || window.orionAtlas?.snapshot().ready, null, { timeout: 90000 });
async function screenshot(page, name) {
  await page.screenshot({ path: fileURLToPath(new URL(name + '.png', output)), animations: 'disabled' });
}
async function canvasPixels(page) {
  const data = await page.locator('canvas').first().screenshot();
  const { data: pixels } = await sharp(data).resize(96, 64).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const active = [...pixels].filter(value => value > 25).length;
  assert.ok(active > 90, `Canvas appears empty: ${active}`);
  return pixels;
}
async function switchScene(page, id) {
  await page.locator('#scene-switcher').click();
  await page.locator(`#scene-menu a[data-scene-link="${id}"]`).click();
  await page.waitForURL(`**/${id}/`);
  await settle(page);
}
async function checkHeader(page) {
  const bounds = await page.evaluate(() => {
    const rect = element => { const b = element.getBoundingClientRect(); return { x:b.x, y:b.y, right:b.right, bottom:b.bottom }; };
    return { brand:rect(document.getElementById('scene-switcher')), actions:rect(document.querySelector('.header-actions, .top-actions')), width:innerWidth, height:innerHeight, overflow:document.documentElement.scrollWidth > innerWidth };
  });
  assert.ok(bounds.brand.x >= 0 && bounds.brand.bottom < bounds.height && bounds.brand.right < bounds.actions.x, JSON.stringify(bounds));
  assert.equal(bounds.overflow, false);
  await page.locator('#scene-switcher').click();
  const menu = await page.locator('#scene-menu').boundingBox();
  assert.ok(menu.x >= 0 && menu.x + menu.width <= bounds.width && menu.y + menu.height <= bounds.height);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('scene-switcher').getAttribute('aria-expanded') === 'false');
  assert.equal(await page.locator('#scene-switcher').getAttribute('aria-expanded'), 'false');
  return bounds;
}
try {
  for (const [name, viewport] of [['desktop',{width:1920,height:1080}],['phone',{width:390,height:844}],['short',{width:800,height:450}],['compact',{width:640,height:360}]]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor:1, isMobile:name==='phone', hasTouch:name==='phone' });
    const page = await context.newPage();
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    page.on('request', request => requests.push(request.url()));
    await page.goto(base, { waitUntil:'domcontentloaded' });
    await settle(page);
    await page.waitForFunction(() => document.getElementById('loading-screen').hidden);
    assert.equal(new URL(page.url()).pathname, '/solar-system/');
    assert.ok(!requests.some(url => /(?:\/black-hole\/src\/|\/assets\/black-hole-)/.test(url)), 'Inactive black hole engine was loaded');
    await checkHeader(page);
    await screenshot(page, name + '-solar');
    await canvasPixels(page);
    await page.locator('#orbit-toggle').click();
    await page.locator('.planet-choice[data-body="saturn"]').click();
    await page.waitForFunction(() => window.solarAtlas.snapshot().selected === 'saturn' && !window.solarAtlas.snapshot().flight, null, { timeout:30000 });
    await page.locator('#play-toggle').click();
    const solar = await page.evaluate(() => window.solarAtlas.snapshot());
    assert.equal(solar.orbits, false);
    assert.equal(solar.playing, false);
    await switchScene(page, 'black-hole');
    await checkHeader(page);
    await screenshot(page, name + '-black-hole');
    const before = await canvasPixels(page);
    await page.evaluate(() => window.observatory.setTime(20));
    const after = await canvasPixels(page);
    assert.ok(before.some((value,index) => Math.abs(value-after[index]) > 3), 'Black hole is not changing');
    await page.evaluate(() => { window.observatory.setPaused(true); window.observatory.setView('edge', true); });
    const hole = await page.evaluate(() => window.observatory.getState());
    await switchScene(page, 'solar-system');
    const returned = await page.evaluate(() => window.solarAtlas.snapshot());
    assert.equal(returned.selected, 'saturn');
    assert.equal(returned.playing, false);
    assert.equal(returned.orbits, false);
    assert.ok(Math.abs(returned.distance - solar.distance) < 0.05);
    assert.equal(returned.failedTextures.length, 0);
    await screenshot(page, name + '-restored-saturn');
    await switchScene(page, 'black-hole');
    const restored = await page.evaluate(() => window.observatory.getState());
    assert.equal(restored.paused, true);
    assert.equal(restored.view, 'edge');
    assert.ok(Math.abs(restored.time - hole.time) < 0.001);
    assert.ok(Math.abs(restored.camera.azimuth - hole.camera.azimuth) < 0.001);
    await page.reload({ waitUntil:'domcontentloaded' });
    await settle(page);
    assert.equal(await page.evaluate(() => window.observatory.getState().paused), true);
    await page.goBack({ waitUntil:'domcontentloaded' });
    await settle(page);
    assert.equal(await page.evaluate(() => window.solarAtlas.snapshot().selected), 'saturn');
    await switchScene(page, 'orion-nebula');
    await checkHeader(page);
    await page.waitForFunction(() => window.orionAtlas.snapshot().frames > 80);
    await screenshot(page, name + '-orion');
    await canvasPixels(page);
    await page.locator('#cruise-button').click();
    const nebula = await page.evaluate(() => window.orionAtlas.snapshot());
    await switchScene(page, 'solar-system');
    assert.equal(await page.evaluate(() => window.solarAtlas.snapshot().selected), 'saturn');
    await switchScene(page, 'orion-nebula');
    const nebulaRestored = await page.evaluate(() => window.orionAtlas.snapshot());
    assert.equal(nebulaRestored.mode, 'cruise');
    assert.equal(nebulaRestored.cruiseTime, nebula.cruiseTime);
    assert.equal(nebulaRestored.cruise, false);
    for (const key of ['position','target']) nebula.pose[key].forEach((value,index) => {
      assert.ok(Math.abs(nebulaRestored.pose[key][index]-value)<1e-8, 'Nebula camera was not restored');
    });
    assert.deepEqual(errors, []);
    report.push({name, viewport, passed:true, solarBodies:returned.bodies.length, browserErrors:errors});
    console.log(`${name}: passed`);
    await context.close();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto(base + '/black-hole/');
  await settle(page);
  assert.ok(!requests.some(url => /(?:\/solar-system\/src\/|\/assets\/solar-system-)/.test(url)), 'Inactive solar engine was loaded');
  await context.close();
  await writeFile(new URL('integration.json', output), JSON.stringify({ base, report }, null, 2));
} finally { await browser.close(); }
