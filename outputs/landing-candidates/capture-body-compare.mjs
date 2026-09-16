// 同一颗天体在两个视图里的样子：总览 vs 着陆天空。
import { chromium } from 'playwright';
import { revealLanding } from '../../scripts/landing-navigation.mjs';
const base = process.env.ATLAS_URL;
const overlays = '.surface-header,.surface-footer,.surface-location,.surface-crosshair,.surface-message,.surface-details,.surface-clock-panel,.surface-vignette,.surface-target,.surface-ephemeris,.surface-journey-caption,.surface-skip{visibility:hidden !important}';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })).newPage();
await page.goto(base + '/solar-system/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.solarAtlas?.snapshot().ready && document.getElementById('loading-screen').hidden, null, { timeout: 90000 });
// 总览：选中土星并等高清贴图
await page.locator('#atlas-tab').click();
await page.locator('#atlas-search').fill('saturn');
await page.locator('.atlas-item[data-body="saturn"]').click();
await page.waitForFunction(() => window.solarAtlas.snapshot().selected === 'saturn' && !window.solarAtlas.snapshot().flight, null, { timeout: 30000 });
await page.waitForFunction(() => !window.solarAtlas.snapshot().ephemeris.blocked);
await page.waitForTimeout(2500);
await page.screenshot({ path: 'D:/星际图鉴-imagegen/previews/overview-saturn.png' });
// 着陆：土卫二看土星与环
if (!await page.locator('#atlas-search').isVisible()) await page.locator('#atlas-tab').click();
await page.locator('#atlas-search').fill('enceladus');
await page.locator('.atlas-item[data-body="enceladus"]').click();
await page.waitForFunction(() => window.solarAtlas.snapshot().selected === 'enceladus' && !window.solarAtlas.snapshot().flight, null, { timeout: 30000 });
await revealLanding(page, 'enceladus');
await page.locator('[data-landing-site="enceladus"]').click();
await page.waitForFunction(() => document.querySelector('.surface-view')?.dataset.ready === 'true', null, { timeout: 90000 });
await page.locator('.surface-daylight').click();
await page.waitForFunction(() => !document.querySelector('.surface-daylight').disabled);
await page.locator('.surface-parent').click();
await page.waitForTimeout(800);
const style = await page.addStyleTag({ content: overlays });
await page.locator('.surface-canvas canvas').screenshot({ path: 'D:/星际图鉴-imagegen/previews/landing-enceladus-saturn.png' });
await style.evaluate(el => el.remove());
console.log('captured');
await browser.close();
