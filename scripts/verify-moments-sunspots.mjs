// Browser verification for curated celestial moments, live Jupiter shadow transit finder,
// and solar differential rotation + schematic bipolar sunspot groups across four viewports.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { launchBrowser } from './browser-launch.mjs';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5191';
const out = new URL(process.env.ATLAS_OUTPUT || '../test-results/moments-sunspots/', import.meta.url);
await mkdir(out, { recursive: true });

const browser = await launchBrowser();
const report = [];

const snap = (page) => page.evaluate(() => window.solarAtlas.snapshot());
const settle = (page) =>
  page.waitForFunction(
    () => {
      const s = window.solarAtlas?.snapshot();
      return s?.ready && !s.flight && !s.ephemeris.blocked;
    },
    null,
    { timeout: 60000 },
  );

async function canvasSample(page) {
  const buf = await page.locator('#universe canvas').screenshot({ animations: 'disabled', timeout: 60000 });
  const { data } = await sharp(buf).resize(96, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return data;
}

async function checkControlBox(page, selector, label) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  const r = await el.boundingBox();
  const vp = page.viewportSize();
  assert.ok(r && r.width >= 43.9 && r.height >= 43.9, `${label} ${selector} too small: ${JSON.stringify(r)}`);
  assert.ok(r.x >= -0.5 && r.y >= -0.5 && r.x + r.width <= vp.width + 0.5 && r.y + r.height <= vp.height + 0.5,
    `${label} ${selector} outside viewport: ${JSON.stringify(r)}`);
  return r;
}

try {
  const viewports = [
    ['desktop', 1440, 900, 1],
    ['phone', 390, 844, 3],
    ['tablet', 800, 450, 2],
    ['short', 640, 360, 2],
  ];

  for (const [name, width, height, dpr] of viewports) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: dpr,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && /shader|program|GL_INVALID/i.test(m.text())) errors.push(m.text());
    });
    page.on('response', (r) => {
      if (r.url().startsWith(base) && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
    });

    await page.goto(base + '/solar-system/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.solarAtlas?.snapshot().ready && document.getElementById('loading-screen').hidden, null, { timeout: 90000 });

    // 1. Open Moments dialog from display-settings (available on every viewport) and verify controls + Escape restore.
    await page.locator('#display-settings summary').click();
    await checkControlBox(page, '#moments-button', name);
    await page.locator('#moments-button').click();
    await page.waitForFunction(() => document.getElementById('moments-dialog')?.open === true);
    await checkControlBox(page, '#close-moments', name);
    await checkControlBox(page, '#find-next-jupiter-transit', name);
    await checkControlBox(page, '[data-moment-id="io-shadow-transit"]', name);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} dialog horizontal overflow`);
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-moments-dialog.png`, out)), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('moments-dialog')?.open === false);
    assert.equal(await page.locator('#display-settings summary').evaluate((e) => document.activeElement === e), true, `${name} focus restore after Escape`);

    // 2. Jump to Sun differential rotation & sunspots moment and verify active groups + pixel difference on activity toggle.
    await page.locator('#display-settings summary').click();
    await page.locator('#moments-button').click();
    await page.locator('[data-moment-id="sun-differential-spots"]').click();
    await page.waitForFunction(() => window.solarAtlas.snapshot().selected === 'sun' && !window.solarAtlas.snapshot().flight, null, { timeout: 30000 });
    await page.waitForFunction(() => {
      const sun = window.solarAtlas.snapshot().dynamics.bodies.find((b) => b.id === 'sun');
      return sun?.sunspots?.count >= 4;
    }, null, { timeout: 30000 });
    const sunSnap = await snap(page);
    const sunDyn = sunSnap.dynamics.bodies.find((b) => b.id === 'sun');
    assert.equal(sunSnap.speed, 100000);
    assert.equal(sunSnap.playing, true);
    assert.ok(sunDyn.sunspots.count >= 4, `${name} expected >=4 sunspot groups, got ${sunDyn.sunspots.count}`);

    // Pause so we compare identical timestamps with/without schematic sunspots + granulation activity.
    await page.locator('#play-toggle').click();
    await page.waitForTimeout(150);
    const withSpots = await canvasSample(page);
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-sun-sunspots.png`, out)), animations: 'disabled' });

    await page.locator('#display-settings summary').click();
    await page.locator('#activity-toggle').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const sunOff = (await snap(page)).dynamics.bodies.find((b) => b.id === 'sun');
    assert.equal(sunOff.sunspots.count, 0, `${name} sunspots should clear when activity disabled`);
    const withoutSpots = await canvasSample(page);
    let maxPixelDiff = 0;
    for (let i = 0; i < withSpots.length; i++) maxPixelDiff = Math.max(maxPixelDiff, Math.abs(withSpots[i] - withoutSpots[i]));
    assert.ok(maxPixelDiff >= 10, `${name} toggling solar sunspot activity barely changed pixels (maxDiff=${maxPixelDiff})`);

    // Re-enable activity.
    await page.locator('#display-settings summary').click();
    await page.locator('#activity-toggle').click();
    await page.keyboard.press('Escape');

    // 3. Jump to Io shadow transit moment and verify active shadow is in view.
    await page.locator('#display-settings summary').click();
    await page.locator('#moments-button').click();
    await page.locator('[data-moment-id="io-shadow-transit"]').click();
    await page.waitForFunction(
      () => {
        const s = window.solarAtlas.snapshot();
        return s.selected === 'jupiter' && !s.flight && s.moonTransits?.jupiter?.[0]?.active === true;
      },
      null,
      { timeout: 30000 },
    );
    const jupSnap = await snap(page);
    assert.equal(jupSnap.playing, false);
    assert.equal(new Date(jupSnap.date).toISOString(), '2026-01-02T13:00:00.000Z');
    const ioTransit = jupSnap.moonTransits.jupiter[0];
    assert.ok(ioTransit.screen && ioTransit.screen.x > 0 && ioTransit.screen.x < width && ioTransit.screen.y > 0 && ioTransit.screen.y < height,
      `${name} Io shadow not on screen: ${JSON.stringify(ioTransit.screen)}`);
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-io-transit.png`, out)), animations: 'disabled' });

    // 4. Desktop-only deep checks: Titan glint, live Jupiter finder, Sunspot landmark brief, Phobos surface moment.
    if (name === 'desktop') {
      // Sunspot landmark brief check
      await page.locator('#display-settings summary').click();
      await page.locator('#moments-button').click();
      await page.locator('[data-moment-id="sun-differential-spots"]').click();
      await settle(page);
      await page.locator('#observation-settings summary').click();
      await page.locator('#landmark-select').selectOption('sunspot-group');
      await settle(page);
      const briefText = await page.locator('#landmark-brief').textContent();
      assert.match(briefText, /Snodgrass & Ulrich/, 'sunspot landmark brief must cite differential rotation formula');
      await page.locator('#landmark-brief-close').click();

      // Triton shadow & physical disc transit on Neptune (NEP098, 2046-07-07 03:30 UTC)
      await page.locator('#display-settings summary').click();
      await page.locator('#moments-button').click();
      await page.locator('[data-moment-id="triton-shadow-transit"]').click();
      await page.waitForFunction(
        () => {
          const s = window.solarAtlas.snapshot();
          return s.selected === 'neptune' && !s.flight && !s.ephemeris.blocked
            && s.moonTransits?.neptune?.[0]?.active === true
            && s.moonTransitDiscs?.some((d) => d.id === 'triton' && d.visible);
        },
        null,
        { timeout: 60000 },
      );
      await page.waitForTimeout(250);
      const nepSnap = await snap(page);
      const triShadow = nepSnap.moonTransits.neptune[0];
      const triDisc = nepSnap.moonTransitDiscs.find((d) => d.id === 'triton' && d.visible);
      assert.equal(new Date(nepSnap.date).toISOString(), '2046-07-07T03:30:00.000Z');
      assert.ok(triShadow.shadowDiameterKm > 2550 && triShadow.shadowDiameterKm < 2650);
      assert.ok(triShadow.screen && triShadow.screen.x > 0 && triShadow.screen.x < width && triShadow.screen.y > 0 && triShadow.screen.y < height);
      assert.ok(triDisc.screen && Math.hypot(triDisc.screen.x - triShadow.screen.x, triDisc.screen.y - triShadow.screen.y) > 25,
        `Triton disc and shadow too close: disc=${JSON.stringify(triDisc.screen)}, shadow=${JSON.stringify(triShadow.screen)}`);
      // Pixel check: Neptune's weather-patched clouds must be markedly darker at the projected Triton umbra than 24px away.
      const nepBuf = await page.locator('#universe canvas').screenshot({ animations: 'disabled', timeout: 60000 });
      const { data: nepRgb, info: nepInfo } = await sharp(nepBuf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const lumAt = (x, y) => {
        const px = Math.max(0, Math.min(nepInfo.width - 1, Math.round(x)));
        const py = Math.max(0, Math.min(nepInfo.height - 1, Math.round(y)));
        const idx = (py * nepInfo.width + px) * 3;
        return 0.2126 * nepRgb[idx] + 0.7152 * nepRgb[idx + 1] + 0.0722 * nepRgb[idx + 2];
      };
      const umbraLum = lumAt(triShadow.screen.x, triShadow.screen.y);
      const ringLum = (lumAt(triShadow.screen.x + 28, triShadow.screen.y) + lumAt(triShadow.screen.x - 28, triShadow.screen.y)
        + lumAt(triShadow.screen.x, triShadow.screen.y + 28) + lumAt(triShadow.screen.x, triShadow.screen.y - 28)) / 4;
      assert.ok(ringLum - umbraLum > 25, `Triton shadow not visibly darkening Neptune clouds (umbra=${umbraLum.toFixed(1)}, surrounding=${ringLum.toFixed(1)})`);
      await page.screenshot({ path: fileURLToPath(new URL('desktop-triton-transit.png', out)), animations: 'disabled' });

      // Titan sea glint moment
      await page.locator('#display-settings summary').click();
      await page.locator('#moments-button').click();
      await page.locator('[data-moment-id="titan-sea-glint"]').click();
      await page.waitForFunction(() => window.solarAtlas.snapshot().selected === 'titan' && !window.solarAtlas.snapshot().flight && !window.solarAtlas.snapshot().ephemeris.blocked, null, { timeout: 30000 });
      await page.waitForTimeout(200);
      assert.equal(new Date((await snap(page)).date).toISOString(), '2014-08-19T14:00:00.000Z');
      const titanBuf = await page.locator('#universe canvas').screenshot({ animations: 'disabled', timeout: 60000 });
      const { data: titanRgb } = await sharp(titanBuf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let brightGlintPixels = 0;
      for (let i = 0; i < titanRgb.length; i += 3) {
        if (titanRgb[i] > 235 && titanRgb[i + 1] > 215 && titanRgb[i + 2] > 165) brightGlintPixels++;
      }
      assert.ok(brightGlintPixels >= 8, `expected bright Titan specular sea glint pixels, got ${brightGlintPixels}`);
      await page.screenshot({ path: fileURLToPath(new URL('desktop-titan-glint.png', out)), animations: 'disabled' });

      // Live Jupiter shadow transit finder from time-settings entry
      await page.locator('#time-settings summary').click();
      await checkControlBox(page, '#time-moments-button', 'desktop-time');
      await page.locator('#time-moments-button').click();
      const beforeLiveDate = (await snap(page)).date;
      await page.locator('#find-next-jupiter-transit').click();
      await page.waitForFunction(
        (prev) => {
          const s = window.solarAtlas.snapshot();
          return s.selected === 'jupiter' && !s.flight && s.date > prev && s.moonTransits?.jupiter?.some((m) => m.active);
        },
        beforeLiveDate,
        { timeout: 30000 },
      );

      // Surface moment: Phobos Stickney
      await page.locator('#display-settings summary').click();
      await page.locator('#moments-button').click();
      await page.locator('[data-moment-id="phobos-mars-sky"]').click();
      await page.waitForFunction(() => document.querySelector('.surface-view')?.dataset.ready === 'true', null, { timeout: 90000 });
      const surfaceSnap = (await snap(page)).surface;
      assert.equal(surfaceSnap.siteId, 'phobos-311e');
      assert.equal(new Date(surfaceSnap.date).toISOString(), '2026-09-27T00:52:00.000Z');
      await page.screenshot({ path: fileURLToPath(new URL('desktop-phobos-moment.png', out)), animations: 'disabled' });
      await page.locator('.surface-exit').click();
      await page.waitForFunction(() => !document.querySelector('.surface-view'), null, { timeout: 10000 });
    }

    assert.deepEqual(errors, [], `${name} browser errors: ${errors.join('; ')}`);
    report.push({ viewport: name, sunspotCount: sunDyn.sunspots.count, sunPixelDiff: maxPixelDiff, ioShadowScreen: ioTransit.screen, passed: true });
    console.log(`${name}: moments + sunspots passed (spots=${sunDyn.sunspots.count}, maxDiff=${maxPixelDiff})`);
    await context.close();
  }

  await writeFile(new URL('report.json', out), JSON.stringify({ base, passed: true, report }, null, 2));
} finally {
  await browser.close();
}
