// The two faces of a ring, measured against each other.
//
// The ring slab is lit from one side: the face the sun is on reflects, and the face the
// camera is on when the sun is behind the ring is lit only by light that crossed the
// slab. For an optically thick ring that is nearly black, for a thin one it is most of
// the reflected brightness - which is what the observer sees, and what the renderer used
// to miss entirely by taking the absolute value of the sun's cosine from the ring normal
// and lighting both faces alike.
//
// The framing puts the camera on the polar axis at eleven radii, so the ring plane is
// square to the camera and the planet's own projected disc is the ruler; each band below
// is a radial shell around it. Shadows are off, so what is measured is the slab's own
// lighting and not the planet's shadow across it.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from 'three';
import sharp from 'sharp';
import { configureDeploymentAccess } from './deployment-access.mjs';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5191';
const output = new URL(process.env.ATLAS_OUTPUT || '../test-results/ring-faces/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const settle = page => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked &&
    (s.selected !== 'saturn' || s.bodies.find(b => b.id === 'saturn').textureWidth >= 2048);
}, null, { timeout: 90000 });
const report = [];
try {
  const probe = await browser.newContext({ viewport: { width: 800, height: 800 }, reducedMotion: 'reduce' });
  await configureDeploymentAccess(probe, base);
  const first = await probe.newPage();
  await first.goto(base + '/solar-system/');
  await settle(first);
  await first.locator('.planet-choice[data-body="saturn"]').click();
  await settle(first);
  const saturn = (await first.evaluate(() => window.solarAtlas.snapshot())).bodies.find(b => b.id === 'saturn');
  await probe.close();
  const pole = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().fromArray(saturn.orientation)).normalize();

  const shots = {};
  for (const [name, sign] of [['north', 1], ['south', -1]]) {
    const context = await browser.newContext({ viewport: { width: 1000, height: 1000 }, reducedMotion: 'reduce' });
    await configureDeploymentAccess(context, base);
    const offset = pole.clone().multiplyScalar(sign * saturn.radius * 11).toArray();
    await context.addInitScript(({ offset }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
      version: 1, value: { selected: 'saturn', playing: false, shadows: false, dynamics: false,
        followRotation: false, date: Date.UTC(2002, 9, 1), speed: 1000, speedUnit: 'realtime', direction: 1, offset, portrait: false },
    })), { offset });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base + '/solar-system/');
    await settle(page);
    await page.waitForTimeout(900);
    const state = await page.evaluate(() => window.solarAtlas.snapshot());
    const body = state.bodies.find(b => b.id === 'saturn');
    const north = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().fromArray(body.orientation)).normalize();
    // The camera is on the pole axis, so the face it sees is the one its own offset points
    // at, and the sunlit face is the one the sun's polar component points at.
    shots[name] = {
      buffer: await page.screenshot(), errors, body,
      sunlit: sign * new Vector3().fromArray(body.sunDirection).dot(north) > 0,
      sunElevation: Math.asin(new Vector3().fromArray(body.sunDirection).dot(north)) * 180 / Math.PI,
    };
    await writeFile(new URL(`${name}.png`, output), shots[name].buffer);
    assert.deepEqual(errors, []);
    await context.close();
  }
  assert.equal(shots.north.sunlit, !shots.south.sunlit,
    'the two polar views are on the same side of the sun; the check needs one of each');

  // The sun and the camera are on the same side in one view and on opposite sides in the
  // other, at the same angles, so the pair isolates the face and nothing else.
  const read = async shot => {
    const { data, info } = await sharp(shot.buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    const bands = [['B ring', 1.55, 1.90], ['A ring', 2.05, 2.25]];
    return Object.fromEntries(bands.map(([name, inner, outer]) => {
      let sum = 0, count = 0;
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const radius = Math.hypot(x + .5 - shot.body.x, y + .5 - shot.body.y) / shot.body.radiusPx;
        if (radius < inner || radius > outer) continue;
        const i = (y * info.width + x) * info.channels;
        sum += linear((data[i] + data[i + 1] + data[i + 2]) / 3 / 255); count++;
      }
      return [name, count ? sum / count : 0];
    }));
  };
  const litShot = shots.north.sunlit ? shots.north : shots.south;
  const unlitShot = shots.north.sunlit ? shots.south : shots.north;
  const lit = await read(litShot), unlit = await read(unlitShot);
  const ratio = name => unlit[name] / lit[name];
  console.log(`sun ${litShot.sunElevation.toFixed(1)} degrees, camera on the sunlit face: B ring ${lit['B ring'].toExponential(2)},`
    + ` A ring ${lit['A ring'].toExponential(2)}`);
  console.log(`camera on the unlit face: B ring ${unlit['B ring'].toExponential(2)} (${(100 * ratio('B ring')).toFixed(1)}% of lit),`
    + ` A ring ${unlit['A ring'].toExponential(2)} (${(100 * ratio('A ring')).toFixed(1)}% of lit)`);
  report.push({ name: 'ring-faces', sunElevation: Number(litShot.sunElevation.toFixed(2)), lit, unlit,
    ratio: { b: Number(ratio('B ring').toFixed(3)), a: Number(ratio('A ring').toFixed(3)) } });
  assert.ok(lit['B ring'] > 1e-3, `the sunlit B ring is too dim to compare against: ${lit['B ring'].toExponential(2)}`);
  // An optically thick ring seen from the unlit side is dark: at the 2002 solstice the
  // solver puts the B ring at a fifth of its reflected brightness and the A ring at half.
  assert.ok(ratio('B ring') < .35, `the unlit B ring is ${(100 * ratio('B ring')).toFixed(1)}% of the lit one, which is not dark`);
  assert.ok(ratio('A ring') > .3 && ratio('A ring') < .8,
    `the unlit A ring is ${(100 * ratio('A ring')).toFixed(1)}% of the lit one, which is neither transparent nor opaque`);
  // The physical signature the two bands are there to pin: a thin ring transmits more of
  // its light than a thick one. Lighting both faces the same, as the absolute value of the
  // sun's cosine did, leaves both ratios at one.
  assert.ok(ratio('A ring') > ratio('B ring') * 1.5,
    `the unlit face does not distinguish the rings: A ${(100 * ratio('A ring')).toFixed(1)}%, B ${(100 * ratio('B ring')).toFixed(1)}%`);
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
} finally { await browser.close(); }
