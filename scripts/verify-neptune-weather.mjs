import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { launchBrowser } from './browser-launch.mjs';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5191';
const output = new URL('../test-results/neptune-weather/behavior/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await launchBrowser();
const report = [];
let currentPage, currentName;
const snapshot = page => page.evaluate(() => window.solarAtlas.snapshot());
const neptune = state => state.dynamics.bodies.find(body => body.id === 'neptune');

async function settle(page) {
  await page.waitForFunction(() => {
    const state = window.solarAtlas?.snapshot();
    return state?.ready && !state.flight && !state.ephemeris.blocked
      && document.getElementById('loading-screen').hidden
      && state.bodies.find(body => body.id === 'neptune')?.textureWidth >= 2048;
  }, null, { timeout: 90000 });
}

async function capture(page, name) {
  await page.screenshot({ path: fileURLToPath(new URL(name + '.png', output)) });
  const pixels = await sharp(await page.locator('canvas').first().screenshot())
    .resize(128, 80).removeAlpha().raw().toBuffer();
  assert.ok([...pixels].filter(value => value > 30).length > 300, name + ': blank canvas');
}

try {
  for (const [name, width, height, motion] of [
    ['desktop', 1440, 900, 'no-preference'],
    ['phone', 390, 844, 'reduce'],
    ['short', 800, 450, 'reduce'],
  ].filter(([name]) => !process.env.ATLAS_VIEWPORT || process.env.ATLAS_VIEWPORT === name)) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: motion });
    await context.addInitScript(() => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
      version: 1, value: {
        selected: 'neptune', playing: false, followRotation: false,
        date: Date.UTC(2002, 9, 1, 12), activityRate: 4,
        speed: 500, speedUnit: 'realtime', dynamics: true, shadows: true,
      },
    })));
    const page = await context.newPage();
    currentPage = page;
    currentName = name;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base + '/solar-system/');
    await settle(page);
    await capture(page, name + '-idle');

    await page.locator('#body-details-button').click();
    const copy = await page.evaluate(() => ({
      title: document.getElementById('feature-title').textContent,
      text: document.getElementById('feature-description').textContent,
      trigger: document.getElementById('event-label').textContent,
    }));
    console.log(name, 'copy', JSON.stringify(copy));
    assert.equal(copy.title, '纬向云流与暗斑示意');
    assert.match(copy.text, /示意.*加速|加速.*示意/);
    assert.equal(copy.trigger, '演示暗斑发展');
    await page.keyboard.press('Escape');

    await page.locator('#play-toggle').click();
    await page.waitForTimeout(1600);
    await page.locator('#play-toggle').click();
    const paused = await snapshot(page);
    assert.ok(neptune(paused).time > 0, name + ': cloud clock did not advance');
    assert.equal(neptune(paused).eventProgress, -1);
    assert.deepEqual(neptune(paused).weather.progress, -1);
    const first = await sharp(await page.locator('canvas').first().screenshot()).removeAlpha().raw().toBuffer();
    await page.waitForTimeout(400);
    const second = await sharp(await page.locator('canvas').first().screenshot()).removeAlpha().raw().toBuffer();
    assert.deepEqual(neptune(await snapshot(page)).weather, neptune(paused).weather);
    const globe = paused.bodies.find(body => body.id === 'neptune');
    let changed = 0, total = 0, max = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (Math.hypot(x - globe.x, y - globe.y) > globe.radiusPx * .6) continue;
      const i = (y * width + x) * 3;
      const delta = Math.max(Math.abs(first[i] - second[i]), Math.abs(first[i + 1] - second[i + 1]), Math.abs(first[i + 2] - second[i + 2]));
      if (delta > 2) changed++;
      max = Math.max(max, delta);
      total++;
    }
    const frozen = { changed, total, max };
    console.log(name, 'pausedPixels', JSON.stringify(frozen));
    assert.ok(total > 100 && changed / total < .001, name + ': paused globe moves');

    await page.locator('#play-toggle').click();
    await page.waitForFunction(() => document.getElementById('activity-state').textContent === '纬向亮云流动');
    await page.locator('#body-details-button').click();
    assert.equal(await page.locator('#event-trigger').isEnabled(), true);
    await page.locator('#event-trigger').click();
    await page.waitForFunction(() => {
      const body = window.solarAtlas.snapshot().dynamics.bodies.find(item => item.id === 'neptune');
      return body?.weather?.progress > .2 && body.weather.activity > .3;
    });
    const event = await snapshot(page);
    const activeLabel = await page.locator('#activity-state').textContent();
    console.log(name, 'active', JSON.stringify({ eventCount: neptune(event).eventCount, weather: neptune(event).weather, label: activeLabel }));
    assert.equal(activeLabel, '暗斑与伴生亮云');
    await capture(page, name + '-active');

    await page.waitForFunction(() => window.solarAtlas.snapshot().dynamics.bodies.find(body => body.id === 'neptune')?.weather?.progress === -1,
      null, { timeout: 20000 });
    const expired = await snapshot(page);
    console.log(name, 'expired', JSON.stringify({ eventCount: neptune(expired).eventCount, weather: neptune(expired).weather }));
    assert.ok(neptune(expired).eventCount >= 1 && neptune(expired).weather.activity === 0);
    await page.waitForFunction(() => document.getElementById('activity-state').textContent === '纬向亮云流动');
    assert.equal(await page.locator('#activity-state').textContent(), '纬向亮云流动');

    await page.locator('#body-details-button').click();
    await page.locator('#event-trigger').click();
    await page.waitForFunction(() => window.solarAtlas.snapshot().dynamics.bodies.find(body => body.id === 'neptune')?.weather?.progress >= 0);
    await page.locator('#display-settings summary').click();
    await page.locator('#activity-toggle').click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.solarAtlas.snapshot().dynamics.enabled);
    const disabled = await snapshot(page);
    console.log(name, 'disabled', JSON.stringify({ enabled: disabled.dynamics.enabled, weather: neptune(disabled).weather,
      label: await page.locator('#activity-state').textContent() }));
    assert.equal(neptune(disabled).weather.progress, -1);
    assert.equal(neptune(disabled).weather.activity, 0);
    assert.equal(await page.locator('#activity-state').textContent(), '活动已关闭');
    await page.locator('#display-settings summary').click();
    await page.locator('#activity-toggle').click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.solarAtlas.snapshot().dynamics.enabled);
    assert.equal(neptune(await snapshot(page)).weather.progress, -1, 'cancelled storm reappears');
    assert.deepEqual(errors, []);
    report.push({ name, copy, frozen, eventCount: neptune(expired).eventCount, errors });
    await context.close();
    currentPage = null;
  }
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: fileURLToPath(new URL(currentName + '-failure.png', output)) });
    await writeFile(new URL(currentName + '-failure.json', output), JSON.stringify(await snapshot(currentPage), null, 2));
  }
  throw error;
} finally {
  await browser.close();
}
