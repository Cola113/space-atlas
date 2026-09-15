// Face-on view of the ring plane, far enough out that the whole system fits. With the
// camera on the polar axis the plane is perpendicular to the optical axis, so screen
// pixels map linearly to ring-plane radii: the shadow's true shape in the plane is what
// the image shows, and it can be compared against the shader's own formula.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from 'three';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5271';
const output = new URL('./', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const settle = page => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked &&
    (s.selected !== 'saturn' || s.bodies.find(b => b.id === 'saturn').textureWidth >= 2048);
}, null, { timeout: 90000 });

async function probeOrientation() {
  const context = await browser.newContext({ viewport: { width: 800, height: 800 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(base + '/solar-system/');
  await settle(page);
  await page.locator('.planet-choice[data-body="saturn"]').click();
  await settle(page);
  const body = (await page.evaluate(() => window.solarAtlas.snapshot())).bodies.find(b => b.id === 'saturn');
  await context.close();
  return body;
}

async function shoot(date, shadows, offset) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(({ date, offset, shadows }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
    version: 1, value: { selected: 'saturn', playing: false, shadows, dynamics: false,
      followRotation: false, date, speed: 1000, speedUnit: 'realtime', direction: 1, offset, portrait: false },
  })), { date, offset, shadows });
  const page = await context.newPage();
  await page.goto(base + '/solar-system/');
  await settle(page);
  await page.waitForTimeout(900);
  const state = await page.evaluate(() => window.solarAtlas.snapshot());
  const body = state.bodies.find(b => b.id === 'saturn');
  const buffer = await page.screenshot();
  await writeFile(new URL(`faceon-${date}-${shadows ? 'on' : 'off'}.png`, output), buffer);
  await context.close();
  return { state, body };
}

const probe = await probeOrientation();
const orientation = new Quaternion().fromArray(probe.orientation);
const north = new Vector3(0, 1, 0).applyQuaternion(orientation);
const dates = [Date.UTC(2002, 9, 1), Date.UTC(2026, 8, 15), Date.UTC(2017, 4, 1)];
const out = [];
for (const date of dates) {
  const offset = north.clone().multiplyScalar(probe.radius * 11).toArray();
  const on = await shoot(date, true, offset);
  const off = await shoot(date, false, offset);
  out.push({ date, iso: new Date(date).toISOString(), on: { state: on.state, body: on.body }, off: { state: off.state, body: off.body } });
  const b = on.body;
  console.log(`${new Date(date).toISOString()}  camera=${on.state.camera.map(v => v.toFixed(2))} target=${on.state.target.map(v => v.toFixed(2))}` +
    `  radius=${b.radius} radiusPx=${b.radiusPx.toFixed(1)} x=${b.x.toFixed(1)} y=${b.y.toFixed(1)}` +
    `  sun=${b.sunDirection.map(v => v.toFixed(4))}  orientation=${b.orientation.map(v => v.toFixed(4))}`);
}
await writeFile(new URL('faceon.json', output), JSON.stringify(out, null, 2));
await browser.close();
