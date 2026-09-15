// The two faces of the ring, side by side: same date, same distance, camera on the
// north polar axis and then on the south. Which one is the sunlit face comes from the
// snapshot's own sun direction, so the script never assumes it. Shadows are off, so what
// is measured is the slab's own lighting and not the planet's shadow across it.
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

async function probe() {
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

async function shoot(date, pole, shadows) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(({ date, offset, shadows }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
    version: 1, value: { selected: 'saturn', playing: false, shadows, dynamics: false,
      followRotation: false, date, speed: 1000, speedUnit: 'realtime', direction: 1, offset, portrait: false },
  })), { date, offset: pole.offset, shadows });
  const page = await context.newPage();
  await page.goto(base + '/solar-system/');
  await settle(page);
  await page.waitForTimeout(900);
  const state = await page.evaluate(() => window.solarAtlas.snapshot());
  const body = state.bodies.find(b => b.id === 'saturn');
  const buffer = await page.screenshot();
  await writeFile(new URL(`face-${date}-${pole.name}${shadows ? '' : '-noshadow'}.png`, output), buffer);
  await context.close();
  return { state, body };
}

const probeBody = await probe();
const orientation = new Quaternion().fromArray(probeBody.orientation);
const axis = new Vector3(0, 1, 0).applyQuaternion(orientation).normalize();
const poles = [
  { name: 'north', offset: axis.clone().multiplyScalar(probeBody.radius * 11).toArray(), sign: 1 },
  { name: 'south', offset: axis.clone().multiplyScalar(-probeBody.radius * 11).toArray(), sign: -1 },
];
const records = [];
for (const [date, iso] of [[Date.UTC(2002, 9, 1), '2002-10-01'], [Date.UTC(2017, 4, 1), '2017-05-01'], [Date.UTC(2026, 8, 15), '2026-09-15']]) {
  for (const pole of poles) {
    const { state, body } = await shoot(date, pole, false);
    const north = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().fromArray(body.orientation)).normalize();
    const sun = new Vector3().fromArray(body.sunDirection);
    // The camera sits on the pole axis, so the face it sees is the one the polar
    // component of its own offset points at, and the sunlit face is the one the sun's
    // polar component points at.
    const cameraSide = pole.sign;
    const sunSide = Math.sign(sun.dot(north));
    records.push({ date, iso, pole: pole.name, cameraSide, sunSide, lit: cameraSide === sunSide,
      x: body.x, y: body.y, radiusPx: body.radiusPx, radius: body.radius,
      sunElevation: Number((Math.asin(sun.dot(north)) * 180 / Math.PI).toFixed(2)),
      camera: state.camera, target: state.target });
    console.log(`${iso} ${pole.name}: sun elevation ${(Math.asin(sun.dot(north)) * 180 / Math.PI).toFixed(1)} deg, camera sees the ${cameraSide === sunSide ? 'sunlit' : 'unlit'} face`);
  }
}
await writeFile(new URL('faces.json', output), JSON.stringify(records, null, 1));
await browser.close();
