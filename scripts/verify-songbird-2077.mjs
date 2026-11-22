import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { aimAtLanding } from './landing-navigation.mjs';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5191';
const outDir = resolve(process.env.OUT_DIR || 'test-results/songbird-2077');
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });

const snapshot = (page) => page.evaluate(() => window.solarAtlas.snapshot());
const settle = (page) =>
  page.waitForFunction(
    () => {
      const s = window.solarAtlas?.snapshot();
      return s?.ready && !s.flight && !s.ephemeris.blocked && document.getElementById('loading-screen').hidden;
    },
    null,
    { timeout: 90000 },
  );

async function checkNonBlankCanvas(page, label) {
  const image = await page.locator('canvas').last().screenshot();
  const pixels = await sharp(image).resize(96, 64).removeAlpha().raw().toBuffer();
  const lit = [...pixels].filter((v) => v > 18).length;
  assert.ok(lit > 60, `${label}: canvas looks blank (lit=${lit})`);
}

async function checkBriefLayout(page, label) {
  const brief = page.locator('#landmark-brief');
  assert.equal(await brief.isVisible(), true, `${label}: brief should be visible`);
  const box = await brief.boundingBox();
  const vp = page.viewportSize();
  assert.ok(
    box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width + 1 && box.y + box.height <= vp.height + 1,
    `${label}: brief outside viewport ${JSON.stringify(box)} vs ${JSON.stringify(vp)}`,
  );
  assert.equal(await brief.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false, `${label}: brief overflows horizontally`);
}

const results = [];

try {
  for (const [vpName, width, height, reduced] of [
    ['desktop', 1440, 900, 'reduce'],
    ['phone', 390, 844, 'reduce'],
    ['short', 800, 450, 'reduce'],
    ['desktop-motion', 1440, 900, 'no-preference'],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: reduced,
      hasTouch: vpName === 'phone',
    });
    await context.addInitScript(() => {
      if (!sessionStorage.getItem('space-atlas:scene:solar-system')) {
        sessionStorage.setItem(
          'space-atlas:scene:solar-system',
          JSON.stringify({ version: 1, value: { playing: false, followRotation: false, date: Date.UTC(2026, 8, 27, 5, 30, 0), timelineEpoch: Date.UTC(1971, 7, 1, 17, 0, 0) } }),
        );
      }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
    });

    await page.goto(`${base}/solar-system/`);
    await settle(page);

    // 1. In 2026, select Moon and confirm pure science baseline (no 2077 leaks)
    await page.locator('#atlas-tab').click();
    await page.locator('#atlas-search').fill('月球');
    await page.locator('.atlas-item[data-body="moon"]').click();
    await settle(page);
    await page.waitForFunction(() => window.solarAtlas.snapshot().bodies.find((b) => b.id === 'moon')?.detailReady);

    const s2026 = await snapshot(page);
    assert.equal(s2026.easterEgg.songbird2077, false, `${vpName}: 2077 leaked in 2026`);
    assert.equal(s2026.easterEgg.crystalPalaceVisible, false, `${vpName}: Crystal Palace visible in 2026`);
    assert.equal(s2026.landmarks.landing.some((l) => l.siteId === 'moon-tycho'), false, `${vpName}: moon-tycho pin leaked in 2026`);
    assert.equal(s2026.landmarks.markers.find((m) => m.id === 'crystal-palace-l1')?.available, false, `${vpName}: L1 landmark available in 2026`);

    // 2. Open Atlas and search secret keyword "百灵鸟"
    await page.locator('#atlas-tab').click();
    await page.locator('#atlas-search').fill('百灵鸟');
    await page.waitForSelector('#atlas-easter-hint:not([hidden])');
    assert.equal(await page.locator('#atlas-empty').isVisible(), false);
    if (vpName === 'desktop') {
      await page.screenshot({ path: resolve(outDir, '01-atlas-secret-search.png') });
    }

    // 3. Click Atlas secret launch -> jumps to 2077 & selects Moon Tycho
    await page.locator('#atlas-easter-launch').click();
    await settle(page);
    await page.waitForFunction(() => window.solarAtlas.snapshot().easterEgg.songbird2077 === true);
    await page.waitForFunction(() => window.solarAtlas.snapshot().landmarks.active === 'tycho');
    await checkBriefLayout(page, `${vpName}-tycho-2077`);
    await checkNonBlankCanvas(page, `${vpName}-orbit-tycho`);

    const s2077 = await snapshot(page);
    assert.equal(s2077.easterEgg.crystalPalaceVisible, true, `${vpName}: Crystal Palace not visible in 2077`);
    assert.equal(s2077.easterEgg.transferArcVisible, true, `${vpName}: transfer arc not visible in 2077`);
    assert.ok(s2077.landmarks.landing.some((l) => l.siteId === 'moon-tycho'), `${vpName}: moon-tycho pin missing in 2077`);
    assert.equal(s2077.landmarks.markers.find((m) => m.id === 'crystal-palace-l1')?.available, true, `${vpName}: L1 landmark missing in 2077`);

    // Toggle radio button cleanly
    const radioBtn = page.locator('.landmark-brief-easter-btn').first();
    await radioBtn.click();
    await page.waitForTimeout(150);
    await radioBtn.click();

    await page.screenshot({ path: resolve(outDir, `02-orbit-tycho-2077-${vpName}.png`) });

    // 4. Select L1 Crystal Palace landmark & verify card + close-brief preserves tracking
    await page.locator('#observation-settings summary').click();
    await page.locator('#landmark-select').selectOption('crystal-palace-l1');
    await page.keyboard.press('Escape');
    await settle(page);
    await page.waitForFunction(() => window.solarAtlas.snapshot().landmarks.active === 'crystal-palace-l1');
    await checkBriefLayout(page, `${vpName}-crystal-palace-l1`);
    if (vpName === 'desktop') {
      await page.screenshot({ path: resolve(outDir, '03-orbit-crystal-palace-l1.png') });
    }
    await page.locator('#landmark-brief-close').click();
    assert.equal((await snapshot(page)).landmarks.active, 'crystal-palace-l1', `${vpName}: closing brief should preserve tracking`);

    // 5. Select Sea of Tranquility -> verify 2077 tribute note
    await page.locator('#observation-settings summary').click();
    await page.locator('#landmark-select').selectOption('mare-tranquillitatis');
    await page.keyboard.press('Escape');
    await settle(page);
    await checkBriefLayout(page, `${vpName}-tranquillitatis-2077`);

    // 6. Aim at moon-tycho pin and land on Tycho Terminal 2077!
    await page.locator('#landmark-brief-close').click();
    await aimAtLanding(page, 'moon-tycho');
    const tychoPin = page.locator('[data-landing-site="moon-tycho"]');
    await tychoPin.waitFor({ state: 'visible', timeout: 15000 });
    await tychoPin.click();

    await page.waitForFunction(() => document.querySelector('.surface-view')?.dataset.phase === 'landed', null, { timeout: 60000 });
    await page.waitForTimeout(300);
    await checkNonBlankCanvas(page, `${vpName}-surface-tycho-1x`);

    if (vpName === 'desktop' || vpName === 'phone' || vpName === 'short') {
      await page.screenshot({ path: resolve(outDir, `04-surface-tycho-1x-${vpName}.png`) });
    }

    // Aim at Earth and zoom telescope to 4x and 8x to inspect Crystal Palace at L1!
    await page.locator('.surface-parent').click();
    await page.waitForTimeout(reduced === 'reduce' ? 150 : 1200);
    // 1x -> 2x -> 4x
    await page.locator('.surface-telescope').click();
    await page.locator('.surface-telescope').click();
    await page.waitForTimeout(300);

    const surf4x = (await snapshot(page)).surface;
    assert.equal(surf4x.magnification, 4);
    assert.equal(surf4x.easterEgg.songbird2077, true, `${vpName}: surface 2077 inactive`);
    assert.equal(surf4x.easterEgg.crystalPalaceVisible, true, `${vpName}: Crystal Palace missing in lunar sky`);
    assert.equal(surf4x.easterEgg.crystalPalaceLabelVisible, true, `${vpName}: Crystal Palace HUD label missing at 4x`);

    if (vpName === 'desktop' || vpName === 'phone' || vpName === 'short') {
      await page.screenshot({ path: resolve(outDir, `05-surface-tycho-4x-crystal-palace-${vpName}.png`) });
    }

    // Zoom to 8x
    await page.locator('.surface-telescope').click();
    await page.waitForTimeout(300);
    if (vpName === 'desktop') {
      await page.screenshot({ path: resolve(outDir, '06-surface-tycho-8x-crystal-palace.png') });
    }

    // Open surface details drawer and verify Tycho pin emblem + radio button
    await page.locator('.surface-info-button').click();
    await page.waitForSelector('.surface-easter-card');
    if (vpName === 'desktop' || vpName === 'phone') {
      await page.screenshot({ path: resolve(outDir, `07-surface-tycho-details-${vpName}.png`) });
    }
    await page.locator('.surface-details-close').click();

    // Return to orbit cleanly
    await page.locator('.surface-exit').click();
    await page.waitForFunction(() => !document.querySelector('.surface-view'), null, { timeout: 30000 });
    await settle(page);

    // 7. On desktop, also verify Earth Mauna Kea 2077 4x Moon Echo & rewind cleanup to 2026!
    if (vpName === 'desktop') {
      await page.locator('#atlas-tab').click();
      await page.locator('#atlas-search').fill('地球');
      await page.locator('.atlas-item[data-body="earth"]').click();
      await settle(page);
      const earthMoonDate = await page.evaluate(async () => {
        const { surfaceFrame, horizonAngles, landingSites } = await import('/solar-system/src/surface/geometry.js');
        const { physicalState } = await import('/solar-system/src/physics/state.js');
        for (let h = 0; h < 48; h += 1) {
          const d = new Date(Date.UTC(2077, 5, 12, h, 0, 0));
          await physicalState.ensure(d, ['earth', 'moon'], { prefetch: false });
          const f = surfaceFrame(landingSites.earth, d, physicalState);
          const moonAlt = horizonAngles(f.targets.Moon.direction).altitude;
          const sunAlt = horizonAngles(f.targets.Sun.direction).altitude;
          if (moonAlt > 22 && sunAlt < -6) return d.toISOString();
        }
        return null;
      });
      assert.ok(earthMoonDate, 'could not find 2077 night moon window over Mauna Kea');
      await page.evaluate((iso) => {
        sessionStorage.setItem(
          'space-atlas:scene:solar-system',
          JSON.stringify({ version: 1, value: { selected: 'earth', playing: false, followRotation: false, date: Date.parse(iso), timelineEpoch: Date.UTC(1971, 7, 1, 17, 0, 0) } }),
        );
      }, earthMoonDate);
      await page.reload();
      await settle(page);
      await aimAtLanding(page, 'earth');
      await page.locator('[data-landing-site="earth"]').click();
      await page.waitForFunction(() => document.querySelector('.surface-view')?.dataset.phase === 'landed', null, { timeout: 60000 });
      await page.locator('.surface-moon').click();
      await page.waitForTimeout(400);
      const earthSurf = (await snapshot(page)).surface;
      assert.equal(earthSurf.magnification, 4);
      assert.equal(earthSurf.easterEgg.songbird2077, true);
      assert.equal(earthSurf.easterEgg.tychoEchoVisible, true, 'Mauna Kea 4x Moon Tycho echo not active');
      await page.screenshot({ path: resolve(outDir, '08-surface-earth-maunakea-tycho-echo-2077.png') });
      await page.locator('.surface-exit').click();
      await page.waitForFunction(() => !document.querySelector('.surface-view'), null, { timeout: 30000 });
      await settle(page);

      // Rewind to 2026 on Moon -> verify complete cleanup!
      await page.locator('#atlas-tab').click();
      await page.locator('#atlas-search').fill('月球');
      await page.locator('.atlas-item[data-body="moon"]').click();
      await settle(page);
      await page.locator('#date-jump').click();
      await page.locator('#time-year-input').fill('2026');
      await page.locator('#time-jump-apply').click();
      await page.waitForTimeout(300);
      const sRewind = await snapshot(page);
      assert.equal(sRewind.easterEgg.songbird2077, false, 'rewind to 2026 did not disable 2077 mode');
      assert.equal(sRewind.easterEgg.crystalPalaceVisible, false, 'rewind to 2026 left Crystal Palace visible');
      assert.equal(sRewind.landmarks.landing.some((l) => l.siteId === 'moon-tycho'), false, 'rewind to 2026 left moon-tycho pin active');
    }

    assert.deepEqual(errors, [], `${vpName} console/page errors: ${errors.join('; ')}`);
    results.push({ viewport: vpName, width, height, reduced, ok: true });
    await context.close();
  }
  await writeFile(resolve(outDir, 'report.json'), JSON.stringify(results, null, 2));
  console.log('SONGBIRD 2077 PLAYWRIGHT VERIFICATION PASSED:', JSON.stringify(results));
} finally {
  await browser.close();
}
