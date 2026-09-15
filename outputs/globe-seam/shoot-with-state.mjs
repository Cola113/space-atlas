import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5271';
const id = process.env.BODY || 'venus';
const tag = process.env.TAG || 'state';
const output = new URL('./', import.meta.url);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 900, height: 900 }, reducedMotion: 'reduce' });
await context.addInitScript(({ id, offset }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
  version: 1, value: { selected: id, playing: false, shadows: false, dynamics: false, followRotation: false,
    date: Date.UTC(2026, 8, 15), speed: 1000, speedUnit: 'realtime', direction: 1, portrait: false,
    offset: JSON.parse(offset) } })), { id, offset: process.env.OFFSET || '[0,0,0]' });
const page = await context.newPage();
await page.goto(base + '/solar-system/');
await page.waitForFunction(() => { const s = window.solarAtlas?.snapshot(); return s?.ready && !s.flight && !s.ephemeris.blocked; }, null, { timeout: 120000 });
await page.waitForFunction(selected => window.solarAtlas?.snapshot()?.bodies.find(b => b.id === selected)?.detailReady, id, { timeout: 120000 });
await page.waitForTimeout(1500);
const state = await page.evaluate(() => window.solarAtlas.snapshot());
const body = state.bodies.find(b => b.id === id);
await page.screenshot({ path: fileURLToPath(new URL(`${tag}-${id}.png`, output)) });
await writeFile(new URL(`${tag}-${id}.json`, output), JSON.stringify({ state: { camera: state.camera, target: state.target, fieldOfView: state.fieldOfView }, body: { x: body.x, y: body.y, radiusPx: body.radiusPx, radius: body.radius, orientation: body.orientation } }));
console.log(`${tag} ${id}: centre ${body.x.toFixed(0)},${body.y.toFixed(0)} radius ${body.radiusPx.toFixed(0)}`);
await context.close();
await browser.close();
