// Walk the camera around the globe and, at each view, measure the brightness step across
// the seam meridian - located from the body's own attitude - against columns well away
// from it. The seam's pixel amplitude peaks where its meridian sits on the steep part of
// the shading, so the views have to be varied to find it at all.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from 'three';
import sharp from 'sharp';
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5271';
const output = new URL('./', import.meta.url);
const tag = process.env.TAG || 'scan';
const id = process.env.BODY || 'uranus';
const views = Number(process.env.VIEWS || 12);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const probeContext = await browser.newContext({ viewport: { width: 600, height: 600 }, reducedMotion: 'reduce' });
await probeContext.addInitScript(({ id }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
  version: 1, value: { selected: id, playing: false, shadows: false, dynamics: false, followRotation: false,
    date: Date.UTC(2026, 8, 15), speed: 1000, speedUnit: 'realtime', direction: 1, portrait: false } })), { id });
const probePage = await probeContext.newPage();
await probePage.goto(base + '/solar-system/');
await probePage.waitForTimeout(9000);
const probe = (await probePage.evaluate(() => window.solarAtlas.snapshot())).bodies.find(b => b.id === id);
await probeContext.close();
const attitude = new Quaternion().fromArray(probe.orientation);
const seamAxis = new Vector3(-1, 0, 0).applyQuaternion(attitude).normalize();
const sun = new Vector3().fromArray(probe.sunDirection).normalize();
const perpSun = sun.clone().addScaledVector(seamAxis, -sun.dot(seamAxis)).normalize();
const perpAlt = new Vector3().crossVectors(seamAxis, perpSun).normalize();
const viewport = 700, distance = 3.0;

const rows = [];
for (let step = 0; step < views; step++) {
  const turn = step / views * Math.PI * 2;
  const tilt = 0.61;   // radians off the seam axis: keeps the seam on the disc
  const direction = seamAxis.clone().multiplyScalar(Math.cos(tilt))
    .addScaledVector(perpSun, Math.sin(tilt) * Math.cos(turn))
    .addScaledVector(perpAlt, Math.sin(tilt) * Math.sin(turn)).normalize();
  const offset = direction.clone().multiplyScalar(probe.radius * distance).toArray();
  const context = await browser.newContext({ viewport: { width: viewport, height: viewport }, reducedMotion: 'reduce' });
  await context.addInitScript(({ id, offset }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
    version: 1, value: { selected: id, playing: false, shadows: false, dynamics: false, followRotation: false,
      date: Date.UTC(2026, 8, 15), speed: 1000, speedUnit: 'realtime', direction: 1, offset, portrait: false } })), { id, offset });
  const page = await context.newPage();
  await page.goto(base + '/solar-system/');
  await page.waitForTimeout(9000);
  const state = await page.evaluate(() => window.solarAtlas.snapshot());
  const body = state.bodies.find(b => b.id === id);
  const file = fileURLToPath(new URL(`${tag}-${id}-${step}.png`, output));
  await page.screenshot({ path: file });
  await context.close();

  const forward = direction.clone().negate();
  const up = new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(forward, up).normalize();
  const depth = distance * probe.radius;
  const along = depth + seamAxis.dot(forward) * probe.radius;
  const seamX = body.x + body.radiusPx * seamAxis.dot(right) / probe.radius * (depth / along) * probe.radius;
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lum = (x, y) => { const i = (y * info.width + x) * info.channels; return (data[i] + data[i + 1] + data[i + 2]) / 3; };
  const band = x0 => {
    const x = Math.round(x0); let sum = 0, count = 0;
    for (let y = 6; y < info.height - 6; y++) {
      const a = lum(x - 5, y), b = lum(x + 5, y);
      if (Math.min(a, b) < 30) continue;
      sum += (a + b) / 2 - lum(x, y); count++;
    }
    return count > 40 ? sum / count : NaN;
  };
  const seam = band(seamX);
  const controls = [-24, -12, 12, 24].map(dx => band(seamX + dx)).filter(Number.isFinite);
  rows.push({ step, seamX: Math.round(seamX), seam, controls });
  console.log(`${tag} ${String(step).padStart(2)} seam at ${Math.round(seamX)}: step ${Number.isFinite(seam) ? seam.toFixed(2) : '---'}` +
    `  controls ${controls.map(v => v.toFixed(2)).join(' ') || '---'}`);
}
await browser.close();
