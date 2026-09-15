// The same date and framing as the default view, but the camera on the other side of the
// ring plane: this is where the app used to show both faces the same, and now shows the
// face the sun is not on.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from 'three';
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5271';
const output = new URL('./', import.meta.url);
const tag = process.env.TAG || 'faces';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const settle = page => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked &&
    (s.selected !== 'saturn' || s.bodies.find(b => b.id === 'saturn').textureWidth >= 2048);
}, null, { timeout: 90000 });

const probe = await (async () => {
  const context = await browser.newContext({ viewport: { width: 800, height: 800 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(base + '/solar-system/');
  await settle(page);
  await page.locator('.planet-choice[data-body="saturn"]').click();
  await settle(page);
  const body = (await page.evaluate(() => window.solarAtlas.snapshot())).bodies.find(b => b.id === 'saturn');
  await context.close();
  return body;
})();
const axis = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().fromArray(probe.orientation)).normalize();

for (const [iso, date] of [['2002-10-01', Date.UTC(2002, 9, 1)], ['2017-05-01', Date.UTC(2017, 4, 1)], ['2026-09-15', Date.UTC(2026, 8, 15)]]) {
  for (const [side, sign] of [['below', -1], ['above', 1]]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const offset = axis.clone().multiplyScalar(sign * probe.radius * 8.5).toArray();
    await context.addInitScript(({ date, offset }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
      version: 1, value: { selected: 'saturn', playing: false, shadows: true, dynamics: true,
        followRotation: false, date, speed: 1000, speedUnit: 'realtime', direction: 1, offset, portrait: false },
    })), { date, offset });
    const page = await context.newPage();
    await page.goto(base + '/solar-system/');
    await settle(page);
    await page.waitForTimeout(900);
    const state = await page.evaluate(() => window.solarAtlas.snapshot());
    const body = state.bodies.find(b => b.id === 'saturn');
    const north = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().fromArray(body.orientation)).normalize();
    const sunSide = Math.sign(new Vector3().fromArray(body.sunDirection).dot(north));
    await page.screenshot({ path: fileURLToPath(new URL(`${tag}-under-${iso}-${side}.png`, output)) });
    await context.close();
    console.log(`${tag} ${iso} ${side}: camera ${sign > 0 ? 'north' : 'south'} side, sun ${sunSide > 0 ? 'north' : 'south'} side -> ${sign === sunSide ? 'lit' : 'unlit'} face`);
  }
}
await browser.close();
