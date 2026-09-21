import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { launchBrowser } from './browser-launch.mjs';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5191';
const output = new URL('../test-results/venus-weather/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await launchBrowser();
const report = [];
let currentPage, currentName;
const snapshot = page => page.evaluate(() => window.solarAtlas.snapshot());
const weather = s => s.dynamics.bodies.find(b => b.id === 'venus');

async function settle(page) {
  await page.waitForFunction(() => {
    const s = window.solarAtlas?.snapshot();
    return s?.ready && !s.flight && !s.ephemeris.blocked && document.getElementById('loading-screen').hidden
      && s.bodies.find(b => b.id === 'venus')?.textureWidth >= 2048;
  }, null, { timeout: 90000 });
}

async function capture(page, name) {
  await page.screenshot({ path: fileURLToPath(new URL(name + '.png', output)) });
  const pixels = await sharp(await page.locator('canvas').first().screenshot()).resize(128, 80).removeAlpha().raw().toBuffer();
  assert.ok([...pixels].filter(x => x > 30).length > 300, name + ': blank canvas');
  const layout = await page.evaluate(() => {
    const close = document.querySelector('#landmark-brief-close');
    const r = close ? close.getBoundingClientRect() : null;
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      briefHidden: !document.querySelector('#landmark-brief') || document.querySelector('#landmark-brief').hidden,
      closeAccessible: r ? (r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight) : true,
    };
  });
  assert.equal(layout.overflow, false);
  if (!layout.briefHidden) assert.ok(layout.closeAccessible, name + ': brief close inaccessible');
  report.push({ name, layout, weather: weather(await snapshot(page)) });
}

try {
  for (const [name, width, height, motion] of [
    ['desktop', 1440, 900, 'no-preference'],
    ['phone', 390, 844, 'reduce'],
    ['short', 800, 450, 'reduce'],
  ].filter(([name]) => !process.env.ATLAS_VIEWPORT || process.env.ATLAS_VIEWPORT === name)) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: motion });
    await context.addInitScript(() => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
      version: 1,
      value: {
        selected: 'venus',
        playing: false,
        followRotation: false,
        date: Date.UTC(2002, 9, 1, 12),
        activityRate: 4,
        speed: 500,
        speedUnit: 'realtime',
        dynamics: true,
        shadows: true,
      },
    })));

    const page = await context.newPage(), errors = [];
    currentPage = page;
    currentName = name;
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(base + '/solar-system/');
    await settle(page);
    await capture(page, name + '-atmosphere');

    // Test cloud clock progression on play
    await page.locator('#play-toggle').click();
    await page.waitForTimeout(1600);
    await page.locator('#play-toggle').click();
    const playingState = await snapshot(page);
    assert.ok(weather(playingState).time > 0, 'cloud clock did not advance');
    await capture(page, name + '-atmosphere-moving');

    // Paused state must stay completely still (framebuffer determinism)
    await settle(page);
    const paused = await snapshot(page);
    const a = await page.locator('canvas').first().screenshot();
    await page.waitForTimeout(400);
    const b = await page.locator('canvas').first().screenshot();
    assert.deepEqual(weather(await snapshot(page)).weather, weather(paused).weather);

    const globe = paused.bodies.find(body => body.id === 'venus');
    const aa = await sharp(a).removeAlpha().raw().toBuffer();
    const bb = await sharp(b).removeAlpha().raw().toBuffer();
    let changed = 0, total = 0, max = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (Math.hypot(x - globe.x, y - globe.y) > globe.radiusPx * 0.6) continue;
        const i = (y * width + x) * 3;
        const delta = Math.max(...[0, 1, 2].map(c => Math.abs(aa[i + c] - bb[i + c])));
        total++;
        if (delta > 2) changed++;
        max = Math.max(max, delta);
      }
    }
    console.log(name, 'paused globe pixels', { changed, total, max });
    assert.ok(changed / total < 0.001, 'paused cloud tops keep changing');

    // Test activity trigger
    await page.locator('#body-details-button').click();
    const initialStatus = (await snapshot(page)).dynamics;
    assert.equal(initialStatus.enabled, true);
    // The trigger button is only enabled while the simulation plays and no event is running. Close the
    // details dialog first: it overlays the transport controls, so drive the toggle through the DOM.
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.getElementById('play-toggle').click());
    await page.waitForFunction(() => {
      const snap = window.solarAtlas.snapshot();
      return snap.playing && snap.dynamics.bodies.find(b => b.id === 'venus')?.eventProgress < 0;
    });
    await page.locator('#body-details-button').click();
    await page.locator('#event-trigger').click();
    await page.waitForFunction(() => {
      const snap = window.solarAtlas.snapshot();
      return snap.dynamics.bodies.find(b => b.id === 'venus')?.eventProgress >= .2;
    });
    await page.evaluate(() => document.getElementById('play-toggle').click());
    await capture(page, name + '-wave-active');

    // Test cloud layer toggle (hide clouds to reveal radar surface). The checkbox itself is visually
    // hidden behind the switch track, so drive it through the DOM.
    await page.evaluate(() => document.getElementById('layer-toggle').click());
    await page.waitForFunction(() => {
      const snap = window.solarAtlas.snapshot();
      const v = snap.dynamics.bodies.find(b => b.id === 'venus');
      return v?.weather?.cloudVisible === 0;
    });
    const radarState = await snapshot(page);
    // The snapshot exposes no activity status; the label the user actually reads lives in the DOM, and
    // the paused state outranks the radar label, so read it while the simulation is running.
    await page.evaluate(() => document.getElementById('play-toggle').click());
    await page.waitForFunction(() => window.solarAtlas.snapshot().playing
      && document.getElementById('activity-state').textContent === '雷达地表');
    assert.equal(await page.locator('#activity-state').textContent(), '雷达地表', 'status label did not update for radar surface');
    await page.evaluate(() => document.getElementById('play-toggle').click());
    assert.equal(radarState.dynamics.bodies.find(b => b.id === 'venus').weather.cloudVisible, 0);
    await capture(page, name + '-radar-surface');

    // Re-enable clouds
    await page.evaluate(() => document.getElementById('layer-toggle').click());
    await page.waitForFunction(() => {
      const snap = window.solarAtlas.snapshot();
      const v = snap.dynamics.bodies.find(b => b.id === 'venus');
      return v?.weather?.cloudVisible === 1;
    });
    const cloudRestoredState = await snapshot(page);
    assert.equal(cloudRestoredState.dynamics.bodies.find(b => b.id === 'venus').weather.cloudVisible, 1);

    // Test disabling dynamics from display settings. The pause label outranks the activity label, so
    // resume playback first.
    await page.evaluate(() => document.getElementById('play-toggle').click());
    await page.waitForFunction(() => window.solarAtlas.snapshot().playing);
    await page.locator('#display-settings summary').click();
    await page.locator('#activity-toggle').click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.solarAtlas.snapshot().dynamics.enabled);
    const disabledState = await snapshot(page);
    assert.equal(disabledState.dynamics.enabled, false);
    assert.equal(await page.locator('#activity-state').textContent(), '活动已关闭');

    // Restore dynamics
    await page.locator('#display-settings summary').click();
    await page.locator('#activity-toggle').click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.solarAtlas.snapshot().dynamics.enabled);

    assert.deepEqual(errors, []);
    await context.close();
    currentPage = null;
  }

  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
  console.log('Venus weather: cloud motion, pause, layer toggle, radar surface, labels and shader compilation passed.');
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: fileURLToPath(new URL(currentName + '-failure.png', output)) });
    await writeFile(new URL(currentName + '-failure.json', output), JSON.stringify(await snapshot(currentPage), null, 2));
  }
  throw error;
} finally {
  await browser.close();
}
