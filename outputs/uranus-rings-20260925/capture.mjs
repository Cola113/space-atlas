import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { Quaternion, Vector3 } from 'three';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5199';
const label = process.env.LABEL || 'current';
const output = new URL('./', import.meta.url);
const date = Date.UTC(2026, 8, 25, 12);
const baseline = process.env.BASELINE === '1';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = [];
const settle = page => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked && document.getElementById('loading-screen').hidden;
}, null, { timeout: 90000 });
await mkdir(output, { recursive: true });
const setup = async (viewport, offset, selected = 'uranus') => {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  // Dev-server A/B: disable only the presentation uniforms. No working files change.
  if (baseline) await context.route('**/solar-system/src/ring-display.js*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const body = source.replace(/const enhanced = bodyId === ["']uranus["'];/, 'const enhanced = false;');
    if (body === source) throw new Error('Could not disable ring presentation for baseline.');
    await route.fulfill({ response, body });
  });
  await context.addInitScript(({ date, offset, selected }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
    version: 1, value: { selected, playing: false, shadows: true, dynamics: false,
      followRotation: false, date, speed: 1000, speedUnit: 'realtime', direction: 1, ...(offset ? { offset } : {}), portrait: false },
  })), { date, offset, selected });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + '/solar-system/', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.waitForTimeout(1400);
  return { context, page, errors };
};
try {
  const seed = await setup({ width: 1440, height: 1000 });
  const s = await seed.page.evaluate(() => window.solarAtlas.snapshot());
  const body = s.bodies.find(b => b.id === 'uranus');
  const pole = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().fromArray(body.orientation)).normalize();
  const sun = new Vector3().fromArray(body.sunDirection).normalize();
  const inPlane = sun.clone().addScaledVector(pole, -sun.dot(pole)).normalize();
  await writeFile(new URL(`${label}-default.png`, output), await seed.page.screenshot());
  report.push({ name: 'default', errors: seed.errors, body });
  await seed.context.close();
  const variants = [
    ['oblique', { width: 1440, height: 1000 }, .7, 10],
    ['edge', { width: 900, height: 900 }, .03, 13],
    ['back', { width: 1440, height: 1000 }, -.7, 10],
    ['phone', { width: 390, height: 844 }, .7, 18],
    ['landscape', { width: 844, height: 390 }, .7, 10],
  ];
  for (const [name, viewport, opening, distance] of variants) {
    if (process.env.ONLY && !process.env.ONLY.split(',').includes(name)) continue;
    const offset = inPlane.clone().addScaledVector(pole, opening).normalize().multiplyScalar(body.radius * distance).toArray();
    const { page, context, errors } = await setup(viewport, offset);
    await writeFile(new URL(`${label}-${name}.png`, output), await page.screenshot());
    const state = await page.evaluate(() => window.solarAtlas.snapshot());
    report.push({ name, errors, date: state.date, body: state.bodies.find(b => b.id === 'uranus') });
    console.log(`${label}/${name}: ${errors.length} errors`);
    await context.close();
  }
  await writeFile(new URL(`${label}-report.json`, output), JSON.stringify(report, null, 2));
  if (report.some(r => r.errors.length)) throw new Error('Browser or shader errors; see report.');
} finally { await browser.close(); }
