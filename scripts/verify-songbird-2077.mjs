import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { Body, Equator, Horizon, Observer } from 'astronomy-engine';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5191';
const outDir = resolve(process.env.OUT_DIR || 'test-results/songbird-2077');
await mkdir(outDir, { recursive: true });

// Compute a genuine 2077 night window over Mauna Kea (19.8207 N, 155.4681 W)
// where the Moon stands high (> 22 deg) and the Sun is well below twilight (< -10 deg),
// without needing dev-only browser imports so this script works on built `dist/` too.
function findMaunaKea2077NightWindow() {
  const observer = new Observer(19.8207, -155.4681, 4207);
  for (let h = 0; h < 96; h += 1) {
    const date = new Date(Date.UTC(2077, 5, 12, h, 0, 0));
    const sunEq = Equator(Body.Sun, date, observer, true, true);
    const moonEq = Equator(Body.Moon, date, observer, true, true);
    const sunAlt = Horizon(date, observer, sunEq.ra, sunEq.dec, 'normal').altitude;
    const moonAlt = Horizon(date, observer, moonEq.ra, moonEq.dec, 'normal').altitude;
    if (sunAlt < -10 && moonAlt > 22) return date.toISOString();
  }
  throw new Error('Could not find a 2077 night Moon window over Mauna Kea');
}

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

async function checkNonBlankCanvas(page, label, minLit = 60) {
  const image = await page.locator('canvas').last().screenshot();
  const pixels = await sharp(image).resize(96, 64).removeAlpha().raw().toBuffer();
  const lit = [...pixels].filter((v) => v > 18).length;
  assert.ok(lit > minLit, `${label}: canvas looks blank (lit=${lit})`);
}

async function checkBriefLayout(page, label) {
  const brief = page.locator('#landmark-brief');
  assert.equal(await brief.isVisible(), true, `${label}: brief should be visible`);
  const metrics = await page.evaluate(() => {
    const el = document.getElementById('landmark-brief');
    const body = el.querySelector('.landmark-brief-body');
    const toastEl = document.getElementById('toast');
    const toolsEl = document.getElementById('observation-tools');
    const b = el.getBoundingClientRect();
    const toastVisible = toastEl && toastEl.classList.contains('show');
    const t = toastVisible ? toastEl.getBoundingClientRect() : null;
    const obs = toolsEl && !toolsEl.hidden ? toolsEl.getBoundingClientRect() : null;
    const hit = (a, c) => Boolean(a && c && a.left < c.right && a.right > c.left && a.top < c.bottom && a.bottom > c.top);
    const toastOverlap = hit(t, b);
    const toolsOverlap = hit(obs, b);
    return {
      rect: { x: b.x, y: b.y, w: b.width, h: b.height },
      vp: { w: innerWidth, h: innerHeight },
      overflowX: el.scrollWidth > el.clientWidth + 1,
      scrollTop: body ? body.scrollTop : 0,
      toastOverlap,
      toolsOverlap,
    };
  });
  assert.ok(
    metrics.rect.x >= 0 &&
    metrics.rect.y >= 0 &&
    metrics.rect.x + metrics.rect.w <= metrics.vp.w + 1 &&
    metrics.rect.y + metrics.rect.h <= metrics.vp.h + 1,
    `${label}: brief outside viewport ${JSON.stringify(metrics)}`,
  );
  assert.equal(metrics.overflowX, false, `${label}: brief overflows horizontally`);
  assert.equal(metrics.scrollTop, 0, `${label}: brief body scrolled down (${metrics.scrollTop}px), clipping header/text`);
  assert.equal(metrics.toastOverlap, false, `${label}: toast overlaps landmark brief`);
  assert.equal(metrics.toolsOverlap, false, `${label}: observation-tools overlaps landmark brief`);
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

    // 1. In 2026, select Moon & Tycho landmark and verify 100% pure scientific baseline (zero 2077 prompts or leaks)
    await page.locator('#atlas-tab').click();
    await page.locator('#atlas-search').fill('月球');
    await page.locator('.atlas-item[data-body="moon"]').click();
    await settle(page);
    await page.waitForFunction(() => window.solarAtlas.snapshot().bodies.find((b) => b.id === 'moon')?.detailReady);

    await page.locator('#observation-settings summary').click();
    await page.locator('#landmark-select').selectOption('tycho');
    await page.keyboard.press('Escape');
    await settle(page);
    assert.equal(await page.locator('#landmark-brief-easter').isVisible(), false, `${vpName}: 2026 Tycho leaked easter hint`);
    await page.locator('#landmark-brief-close').click();

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
    await checkBriefLayout(page, `${vpName}-tycho-2077-initial`);
    await checkNonBlankCanvas(page, `${vpName}-orbit-tycho`);

    const s2077 = await snapshot(page);
    assert.equal(s2077.easterEgg.crystalPalaceVisible, true, `${vpName}: Crystal Palace not visible in 2077`);
    assert.equal(s2077.landmarks.markers.find((m) => m.id === 'crystal-palace-l1')?.available, true, `${vpName}: L1 landmark missing in 2077`);

    // CRITICAL: Verify BOTH Tycho landmark AND moon-tycho ice-cyan landing pin are simultaneously visible & non-overlapping
    // without closing the landmark brief!
    const pinPair = await page.evaluate(() => {
      const lm = document.querySelector('[data-landmark="tycho"]');
      const pin = document.querySelector('[data-landing-site="moon-tycho"]');
      const lmLabel = lm?.querySelector('.landmark-name')?.getBoundingClientRect();
      const pinLabel = pin?.querySelector('.landmark-name')?.getBoundingClientRect();
      const overlap = Boolean(
        lmLabel && pinLabel &&
        lmLabel.left < pinLabel.right && lmLabel.right > pinLabel.left &&
        lmLabel.top < pinLabel.bottom && lmLabel.bottom > pinLabel.top,
      );
      return {
        lmVisible: Boolean(lm && !lm.hidden),
        pinVisible: Boolean(pin && !pin.hidden),
        overlap,
      };
    });
    assert.equal(pinPair.lmVisible, true, `${vpName}: Tycho landmark hidden`);
    assert.equal(pinPair.pinVisible, true, `${vpName}: moon-tycho pin swallowed by Tycho landmark!`);
    assert.equal(pinPair.overlap, false, `${vpName}: Tycho landmark and moon-tycho labels overlap!`);

    // Toggle radio button cleanly & verify scrollTop remains 0 (in-place update, zero clip!)
    const radioBtn = page.locator('.landmark-brief-easter-btn').first();
    await radioBtn.click();
    await page.waitForTimeout(150);
    await radioBtn.click();
    await checkBriefLayout(page, `${vpName}-tycho-2077-after-radio`);

    await page.screenshot({ path: resolve(outDir, `02-orbit-tycho-2077-${vpName}.png`) });

    // 4. Select L1 Crystal Palace landmark -> verify crisp close-up framing + card layout + close preserves tracking
    await page.locator('#observation-settings summary').click();
    await page.locator('#landmark-select').selectOption('crystal-palace-l1');
    await page.keyboard.press('Escape');
    await settle(page);
    await page.waitForFunction(() => window.solarAtlas.snapshot().landmarks.active === 'crystal-palace-l1');
    await checkBriefLayout(page, `${vpName}-crystal-palace-l1`);
    const cpSnap = await snapshot(page);
    const camToTarget = Math.hypot(
      cpSnap.camera[0] - cpSnap.target[0],
      cpSnap.camera[1] - cpSnap.target[1],
      cpSnap.camera[2] - cpSnap.target[2],
    );
    assert.ok(camToTarget < 0.65, `${vpName}: Crystal Palace close-up camera too far (${camToTarget.toFixed(2)})`);
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

    // 6. Select Tycho again and click the visible moon-tycho landing pin directly!
    await page.locator('#observation-settings summary').click();
    await page.locator('#landmark-select').selectOption('tycho');
    await page.keyboard.press('Escape');
    await settle(page);
    const tychoPin = page.locator('[data-landing-site="moon-tycho"]');
    await tychoPin.waitFor({ state: 'visible', timeout: 15000 });
    await tychoPin.click();

    await page.waitForFunction(() => document.querySelector('.surface-view')?.dataset.phase === 'landed', null, { timeout: 60000 });
    await page.waitForTimeout(300);
    await checkNonBlankCanvas(page, `${vpName}-surface-tycho-1x`);

    // Verify Earth is cleanly below the header bar (no collision with SURFACE EXPLORER)
    const earthFraming = await page.evaluate(() => {
      const s = window.solarAtlas.snapshot().surface;
      const header = document.querySelector('.surface-header').getBoundingClientRect();
      const target = s.targets.Earth;
      const pitch = Number(document.querySelector('.surface-view').dataset.pitch);
      const fov = s.fieldOfView;
      const earthAlt = Math.asin(Math.max(-1, Math.min(1, target.direction[1]))) * 180 / Math.PI;
      const yFrac = 0.5 - (earthAlt - pitch) / fov;
      const earthY = yFrac * innerHeight;
      return { earthY, headerBottom: header.bottom, earthAlt, pitch };
    });
    assert.ok(
      earthFraming.earthY > earthFraming.headerBottom + 12,
      `${vpName}: Earth collides with header (${JSON.stringify(earthFraming)})`,
    );

    if (vpName === 'desktop' || vpName === 'phone' || vpName === 'short') {
      await page.screenshot({ path: resolve(outDir, `04-surface-tycho-1x-${vpName}.png`) });
    }

    // On desktop, also drag right and down to inspect the foreground brushed titanium relay puck + bootprints
    if (vpName === 'desktop') {
      const canvas = page.locator('.surface-canvas canvas');
      const box = await canvas.boundingBox();
      // Drag left by ~1050px (rotates heading right ~72 deg) and up by ~900px (pitches down ~62 deg)
      for (let step = 0; step < 2; step += 1) {
        await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.78);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.36, box.y + box.height * 0.28, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(100);
      }
      await page.waitForTimeout(250);
      await page.screenshot({ path: resolve(outDir, '04b-surface-tycho-foreground-puck.png') });
      await page.locator('.surface-reset').click();
      await page.waitForTimeout(200);
    }

    // Aim at Earth and zoom telescope to 4x and 8x to inspect sunlit Crystal Palace at L1!
    await page.locator('.surface-parent').click();
    await page.waitForTimeout(reduced === 'reduce' ? 150 : 1200);
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

    // 7. On desktop, verify rewind from 2077 to 2026 cleans up everything including active crystal-palace-l1
    if (vpName === 'desktop') {
      await page.locator('#observation-settings summary').click();
      await page.locator('#landmark-select').selectOption('crystal-palace-l1');
      await page.keyboard.press('Escape');
      await settle(page);
      await page.locator('#date-jump').click();
      await page.locator('#time-year-input').fill('2026');
      await page.locator('#time-jump-apply').click();
      await page.waitForTimeout(350);
      await settle(page);
      const sRewind = await snapshot(page);
      assert.equal(sRewind.easterEgg.songbird2077, false, 'rewind to 2026 did not disable 2077 mode');
      assert.equal(sRewind.easterEgg.crystalPalaceVisible, false, 'rewind to 2026 left Crystal Palace visible');
      assert.equal(sRewind.landmarks.active, null, 'rewind to 2026 left crystal-palace-l1 active');
      assert.equal(sRewind.landmarks.landing.some((l) => l.siteId === 'moon-tycho'), false, 'rewind to 2026 left moon-tycho pin active');
    }

    assert.deepEqual(errors, [], `${vpName} console/page errors: ${errors.join('; ')}`);
    results.push({ viewport: vpName, width, height, reduced, ok: true });
    await context.close();
  }

  // 8. Dedicated fresh context for Earth Mauna Kea 2077 NIGHT 4x Moon Echo
  // (avoids pagehide overwriting sessionStorage on reload, verifying real dark night sky!)
  const nightIso = findMaunaKea2077NightWindow();
  const nightCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await nightCtx.addInitScript((iso) => {
    sessionStorage.setItem(
      'space-atlas:scene:solar-system',
      JSON.stringify({ version: 1, value: { selected: 'earth', playing: false, followRotation: false, date: Date.parse(iso), timelineEpoch: Date.UTC(1971, 7, 1, 17, 0, 0) } }),
    );
  }, nightIso);
  const nightPage = await nightCtx.newPage();
  const nightErrors = [];
  nightPage.on('pageerror', (err) => nightErrors.push(`pageerror: ${err.message}`));
  nightPage.on('console', (msg) => { if (msg.type() === 'error') nightErrors.push(`console: ${msg.text()}`); });
  await nightPage.goto(`${base}/solar-system/`);
  await settle(nightPage);
  // Rotate camera onto Mauna Kea landing pin via keyboard/orbit or click once exposed
  const earthPin = nightPage.locator('[data-landing-site="earth"]');
  for (let i = 0; i < 16; i += 1) {
    if (await earthPin.isVisible()) break;
    await nightPage.mouse.move(720, 450);
    await nightPage.mouse.down();
    await nightPage.mouse.move(580, 440, { steps: 6 });
    await nightPage.mouse.up();
    await nightPage.waitForTimeout(120);
  }
  await earthPin.waitFor({ state: 'visible', timeout: 10000 });
  await earthPin.click();
  await nightPage.waitForFunction(() => document.querySelector('.surface-view')?.dataset.phase === 'landed', null, { timeout: 60000 });
  await nightPage.locator('.surface-moon').click();
  await nightPage.waitForTimeout(400);
  const earthSurf = (await snapshot(nightPage)).surface;
  const sunAltDeg = Math.asin(Math.max(-1, Math.min(1, earthSurf.targets.Sun.direction[1]))) * 180 / Math.PI;
  assert.ok(sunAltDeg < -6, `Mauna Kea test must be at night, got sunAlt=${sunAltDeg.toFixed(1)} deg`);
  assert.equal(earthSurf.magnification, 4);
  assert.equal(earthSurf.easterEgg.songbird2077, true);
  assert.equal(earthSurf.easterEgg.tychoEchoVisible, true, 'Mauna Kea 4x Moon Tycho echo not active');
  await nightPage.screenshot({ path: resolve(outDir, '08-surface-earth-maunakea-tycho-echo-2077.png') });
  assert.deepEqual(nightErrors, [], `maunakea-night errors: ${nightErrors.join('; ')}`);
  results.push({ viewport: 'maunakea-night', date: nightIso, sunAltDeg: Number(sunAltDeg.toFixed(1)), ok: true });
  await nightCtx.close();

  await writeFile(resolve(outDir, 'report.json'), JSON.stringify(results, null, 2));
  console.log('SONGBIRD 2077 PLAYWRIGHT VERIFICATION PASSED:', JSON.stringify(results));
} finally {
  await browser.close();
}
