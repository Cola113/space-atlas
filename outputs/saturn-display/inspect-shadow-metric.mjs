// Why does the face-on shadow assertion read 2.21 radii across? Reproduce the suite's
// framing and print the pixels it calls darkened, worst first.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from 'three';
import sharp from 'sharp';
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5271';
const output = new URL('./', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const settle = page => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked &&
    (s.selected !== 'saturn' || s.bodies.find(b => b.id === 'saturn').textureWidth >= 2048);
}, null, { timeout: 90000 });
const probeContext = await browser.newContext({ viewport: { width: 800, height: 800 }, reducedMotion: 'reduce' });
const probePage = await probeContext.newPage();
await probePage.goto(base + '/solar-system/');
await settle(probePage);
await probePage.locator('.planet-choice[data-body="saturn"]').click();
await settle(probePage);
const saturn = (await probePage.evaluate(() => window.solarAtlas.snapshot())).bodies.find(b => b.id === 'saturn');
await probeContext.close();

const shots = {};
for (const shadows of [true, false]) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 1000 }, reducedMotion: 'reduce' });
  const offset = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().fromArray(saturn.orientation))
    .normalize().multiplyScalar(saturn.radius * 11).toArray();
  await context.addInitScript(({ offset, shadows }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
    version: 1, value: { selected: 'saturn', playing: false, shadows, dynamics: false,
      followRotation: false, date: Date.UTC(2002, 9, 1), speed: 1000, speedUnit: 'realtime', direction: 1, offset, portrait: false },
  })), { offset, shadows });
  const page = await context.newPage();
  await page.goto(base + '/solar-system/');
  await settle(page);
  await page.waitForTimeout(900);
  const state = await page.evaluate(() => window.solarAtlas.snapshot());
  const body = state.bodies.find(b => b.id === 'saturn');
  const buffer = await page.screenshot();
  await writeFile(new URL(`inspect-${shadows ? 'on' : 'off'}.png`, output), buffer);
  shots[shadows ? 'on' : 'off'] = { buffer, body, state };
  await context.close();
}
const read = async entry => {
  const { data, info } = await sharp(entry.buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info, lum: i => (data[i] + data[i + 1] + data[i + 2]) / 3 / 255 };
};
const on = await read(shots.on), off = await read(shots.off);
const { body, state } = shots.on;
const eye = new Vector3().fromArray(state.camera), look = new Vector3().fromArray(state.target);
const forward = look.clone().sub(eye).normalize();
const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
const up = new Vector3().crossVectors(right, forward).normalize();
const north = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().fromArray(body.orientation)).normalize();
const sun = new Vector3().fromArray(body.sunDirection);
const inPlane = sun.clone().addScaledVector(north, -sun.dot(north)).normalize();
const axis = { x: inPlane.dot(right), y: -inPlane.dot(up) };
const rows = [];
let darkest = 0;
for (let y = 0; y < off.info.height; y++) for (let x = 0; x < off.info.width; x++) {
  const i = (y * off.info.width + x) * off.info.channels;
  const lit = off.lum(i);
  if (lit < .01) continue;
  const drop = (lit - on.lum(i)) / lit;
  if (drop > darkest) darkest = drop;
  if (drop <= .1) continue;
  const dx = x + .5 - body.x, dy = y + .5 - body.y;
  const distance = Math.hypot(dx, dy) / body.radiusPx;
  if (distance < 1.05 || distance > 2.4) continue;
  const across = Math.abs(-dx * axis.y + dy * axis.x) / body.radiusPx;
  const along = (dx * axis.x + dy * axis.y) / body.radiusPx;
  rows.push({ x, y, across: Number(across.toFixed(3)), along: Number(along.toFixed(3)), drop: Number(drop.toFixed(2)), lit: Number((lit * 255).toFixed(1)) });
}
rows.sort((a, b) => b.across - a.across);
console.log(`darkened ${rows.length} pixels, deepest relative drop ${darkest.toFixed(3)}`);
console.log('worst across:', rows.slice(0, 12).map(r => `(${r.x},${r.y}) across ${r.across} along ${r.along} drop ${r.drop} lit ${r.lit}`).join('\n  '));
await browser.close();
