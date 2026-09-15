// One Saturn framing with everything the photometry needs next to the pixels.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5271';
const output = new URL('./', import.meta.url);
const tag = process.env.TAG || 'view';
const date = Number(process.env.DATE || Date.UTC(2026, 8, 15));
const offset = JSON.parse(process.env.OFFSET || 'null');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' });
await context.addInitScript(({ date, offset }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
  version: 1, value: { selected: 'saturn', playing: false, shadows: false, dynamics: false, followRotation: false,
    date, speed: 1000, speedUnit: 'realtime', direction: 1, portrait: false, ...(offset ? { offset } : {}) } })), { date, offset });
const page = await context.newPage();
await page.goto(base + '/solar-system/');
await page.waitForFunction(() => { const s = window.solarAtlas?.snapshot(); return s?.ready && !s.flight && !s.ephemeris.blocked; }, null, { timeout: 120000 });
await page.waitForFunction(() => window.solarAtlas?.snapshot()?.bodies.find(b => b.id === 'saturn')?.detailReady, null, { timeout: 120000 });
await page.waitForTimeout(1800);
const state = await page.evaluate(() => window.solarAtlas.snapshot());
const body = state.bodies.find(b => b.id === 'saturn');
await page.screenshot({ path: fileURLToPath(new URL(`${tag}.png`, output)) });
await writeFile(new URL(`${tag}.json`, output), JSON.stringify({
  date, camera: state.camera, target: state.target, fieldOfView: state.fieldOfView,
  sun: body.sunDirection, orientation: body.orientation,
  body: { x: body.x, y: body.y, radiusPx: body.radiusPx, radius: body.radius, rings: body.rings || null },
  lighting: state.lighting,
}, null, 1));
console.log(`${tag}: centre ${body.x.toFixed(0)},${body.y.toFixed(0)} radius ${body.radiusPx.toFixed(0)}px  exposure ${state.lighting.intensity}`);
await context.close();
await browser.close();
