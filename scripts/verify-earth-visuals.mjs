// 视觉验收：地球·冒纳凯阿落点的夜景、日照、手机与短横屏。
// ATLAS_URL 默认 127.0.0.1:5192；输出 ATLAS_EARTH_OUTPUT 默认 ../work/verify-earth/。
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser-launch.mjs';
import { configureDeploymentAccess } from './deployment-access.mjs';
import { revealLanding } from './landing-navigation.mjs';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5192';
const output = new URL(process.env.ATLAS_EARTH_OUTPUT || '../work/verify-earth/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await launchBrowser();

async function land(page, viewportName) {
  await page.goto(base + '/solar-system/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.solarAtlas?.snapshot().ready && document.getElementById('loading-screen').hidden, null, { timeout: 90000 });
  if (!await page.locator('#atlas-search').isVisible()) await page.locator('#atlas-tab').click();
  await page.locator('#atlas-search').fill('地球');
  await page.locator('.atlas-item[data-body="earth"]').click();
  await page.waitForFunction(() => window.solarAtlas.snapshot().selected === 'earth' && !window.solarAtlas.snapshot().flight, null, { timeout: 30000 });
  await page.waitForFunction(() => !window.solarAtlas.snapshot().ephemeris.blocked);
  await revealLanding(page, 'earth');
  await page.locator('[data-landing-site="earth"]').click();
  await page.waitForFunction(() => document.querySelector('.surface-view')?.dataset.ready === 'true', null, { timeout: 90000 });
  // 从总览降落继承模拟日期（1971-08-01 17:00 UTC，白天）。用 1k× 连续推进几天
  // （100k× 会让昼夜频闪，曝光平滑被平均成白天），到一个满月前后的夜晚
  // （太阳 −8° 以下、月亮已升起）再暂停截图，验证夜景渲染。
  await page.locator('#surface-rate').evaluate(el => { el.value = 1; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('.surface-pause').click();
  await page.waitForFunction(() => {
    const s = window.solarAtlas.snapshot().surface;
    if (!s) return false;
    const alt = t => Math.asin(t.direction[1]) * 180 / Math.PI;
    return alt(s.targets.Sun) < -8 && alt(s.targets.Moon) > 8;
  }, null, { timeout: 180000, polling: 200 });
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => {
    const s = window.solarAtlas.snapshot().surface;
    const alt = t => Math.asin(t.direction[1]) * 180 / Math.PI;
    return { date: new Date(s.date).toISOString(), moonAlt: alt(s.targets.Moon), sunAlt: alt(s.targets.Sun),
      moonDiameter: s.targets.Moon.angularDiameter * 180 / Math.PI };
  });
  console.log(viewportName, JSON.stringify(state));
  await page.locator('.surface-canvas canvas').screenshot({ path: fileURLToPath(new URL(`${viewportName}-night.png`, output)) });
  if (viewportName === 'desktop') {
    // 时钟仍在跑就先暂停（月亮静止），再闭环对准月亮后截图。
    if (await page.evaluate(() => window.solarAtlas.snapshot().surface.playing)) await page.locator('.surface-pause').click();
    await page.waitForTimeout(1200);
    await page.locator('.surface-canvas canvas').focus();
    for (let i = 0; i < 60; i++) {
      const view = await page.evaluate(() => {
        const root = document.querySelector('.surface-view');
        const s = window.solarAtlas.snapshot().surface;
        const az = t => ((Math.atan2(t.direction[0], -t.direction[2]) * 180 / Math.PI) % 360 + 360) % 360;
        return { heading: parseFloat(root.dataset.heading), pitch: parseFloat(root.dataset.pitch),
          moonAz: az(s.targets.Moon), moonAlt: Math.asin(s.targets.Moon.direction[1]) * 180 / Math.PI,
          magnification: s.magnification };
      });
      const dh = ((view.moonAz - view.heading + 540) % 360) - 180;
      const dp = view.moonAlt - view.pitch;
      const step = 3 / view.magnification;
      if (Math.abs(dh) < step && Math.abs(dp) < step) break;
      if (Math.abs(dh) >= step) await page.keyboard.press(dh > 0 ? 'ArrowRight' : 'ArrowLeft');
      if (Math.abs(dp) >= step) await page.keyboard.press(dp > 0 ? 'ArrowUp' : 'ArrowDown');
      await page.waitForTimeout(130);
    }
    const aimed = await page.evaluate(() => {
      const root = document.querySelector('.surface-view');
      const s = window.solarAtlas.snapshot().surface;
      const az = t => ((Math.atan2(t.direction[0], -t.direction[2]) * 180 / Math.PI) % 360 + 360) % 360;
      return { heading: root.dataset.heading, pitch: root.dataset.pitch,
        moonAz: az(s.targets.Moon).toFixed(2), moonAlt: (Math.asin(s.targets.Moon.direction[1]) * 180 / Math.PI).toFixed(2),
        moonDistanceKm: s.targets.Moon.distanceKm };
    });
    console.log('aimed', JSON.stringify(aimed));
    await page.waitForTimeout(900);
    await page.locator('.surface-canvas canvas').screenshot({ path: fileURLToPath(new URL('desktop-night-moon.png', output)) });
  }
  return state;
}

for (const [name, viewport, dsf] of [['desktop', { width: 1440, height: 900 }, 1], ['phone', { width: 390, height: 844 }, 3], ['short', { width: 640, height: 360 }, 2]]) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dsf, reducedMotion: 'reduce' });
  await configureDeploymentAccess(context, base);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /shader|program|GL_INVALID/i.test(m.text())) errors.push(m.text()); });
  page.on('response', r => { if (r.url().startsWith(base) && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  try {
    await land(page, name);
    if (name === 'desktop') {
      await page.locator('.surface-daylight').click();
      await page.waitForFunction(() => !document.querySelector('.surface-daylight').disabled, null, { timeout: 60000 });
      await page.waitForTimeout(2000);
      const day = await page.evaluate(() => {
        const s = window.solarAtlas.snapshot().surface;
        return { date: new Date(s.date).toISOString(), sunAlt: Math.asin(s.targets.Sun.direction[1]) * 180 / Math.PI };
      });
      console.log('desktop-day', JSON.stringify(day));
      await page.locator('.surface-canvas canvas').screenshot({ path: fileURLToPath(new URL('desktop-day.png', output)) });
      // 返回轨道，确认恢复
      await page.locator('.surface-exit').click();
      await page.waitForTimeout(2500);
      const back = await page.evaluate(() => ({ selected: window.solarAtlas.snapshot().selected, surface: Boolean(window.solarAtlas.snapshot().surface) }));
      console.log('return', JSON.stringify(back));
      await page.screenshot({ path: fileURLToPath(new URL('desktop-return.png', output)) });
    }
  } finally {
    if (errors.length) { await writeFile(new URL(`${name}-errors.json`, output), JSON.stringify(errors, null, 2)); console.log(name, 'ERRORS', errors); }
    await context.close();
  }
}
await browser.close();
console.log('earth visual screenshots done');
