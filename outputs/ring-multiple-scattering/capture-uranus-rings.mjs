import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from 'three';
import sharp from 'sharp';

// Camera on the sunward side and nearly in the ring plane, which is what the user's
// screenshot shows: a lit globe with the ring crossing it as a dark line.
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5199';
const label = process.env.LABEL || 'sunlit-256';
const output = new URL('./uranus-ring/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const settle = page => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked && document.getElementById('loading-screen').hidden;
}, null, { timeout: 90000 });
try {
  const probe = await browser.newContext({ viewport: { width: 1200, height: 1200 }, reducedMotion: 'reduce' });
  const seedPage = await probe.newPage();
  await seedPage.goto(base + '/solar-system/', { waitUntil: 'domcontentloaded' });
  await settle(seedPage);
  await seedPage.locator('#catalog-filter').selectOption('planets');
  await seedPage.locator('.planet-choice[data-body="uranus"]').click();
  await settle(seedPage);
  const seed = await seedPage.evaluate(() => window.solarAtlas.snapshot());
  const uranus = seed.bodies.find(b => b.id === 'uranus');
  await probe.close();

  const q = new Quaternion().fromArray(uranus.orientation);
  const pole = new Vector3(0, 1, 0).applyQuaternion(q).normalize();
  const sun = new Vector3().fromArray(uranus.sunDirection).normalize();
  const inPlane = sun.clone().addScaledVector(pole, -sun.dot(pole)).normalize();
  const direction = inPlane.clone().addScaledVector(pole, 0.03).normalize();
  const openingDeg = Math.asin(Math.abs(direction.dot(pole))) * 180 / Math.PI;
  console.log(`${label}: ring-plane opening angle to the camera ${openingDeg.toFixed(2)} deg (camera on the sunward side)`);
  const offset = direction.multiplyScalar(uranus.radius * Number(process.env.DIST || 4.2)).toArray();

  const context = await browser.newContext({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  await context.addInitScript(({ date, offset }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({
    version: 1, value: { selected: 'uranus', playing: false, shadows: true, dynamics: true,
      followRotation: false, date, speed: 1000, speedUnit: 'realtime', direction: 1, offset, portrait: false },
  })), { date: seed.date, offset });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/solar-system/');
  await settle(page);
  await page.waitForTimeout(1200);
  const file = new URL(`${label}.png`, output);
  await writeFile(file, await page.screenshot());
  console.log(`${label}: errors=${errors.length}`);

  const { data, info } = await sharp(fileURLToPath(file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, channels } = info;
  const lum = (x, y) => { const i = (y * width + x) * channels; return (data[i] + data[i+1] + data[i+2]) / 3 / 255; };
  let left = width, right = 0, top = info.height, bottom = 0;
  for (let y = 300; y < info.height - 300; y += 2) for (let x = 700; x < width; x += 2)
    if (lum(x, y) > 0.30) { if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y; }
  const globeRadius = (right - left) / 2;
  console.log(`  lit disc x ${left}..${right} y ${top}..${bottom}; radius ${globeRadius} px; 1 px = ${(25362/globeRadius).toFixed(1)} km`);
  // Inside the lit disc, a row is "line present" when its darkest pixel is far below
  // that row's own median (the globe is smooth, so the line stands out locally).
  const rows = [];
  for (let y = top + 20; y < bottom - 20; y++) {
    const values = [];
    for (let x = left + 20; x < right - 20; x++) values.push({ x, v: lum(x, y) });
    const sorted = values.map(o => o.v).sort((a, b) => a - b);
    const rowMedian = sorted[Math.floor(sorted.length / 2)];
    const darkest = values.reduce((best, o) => (o.v < best.v ? o : best), values[0]);
    rows.push({ y, rowMedian, dark: darkest.v, x: darkest.x, hit: rowMedian > 0.2 && darkest.v < rowMedian * 0.55 });
  }
  const hits = rows.filter(r => r.hit);
  const runs = []; let current = null;
  rows.forEach(r => { if (r.hit) { if (!current) { current = { from: r.y, to: r.y }; runs.push(current); } else current.to = r.y; } else current = null; });
  const gaps = runs.slice(1).map((r, i) => r.from - runs[i].to - 1).sort((a, b) => a - b);
  console.log(`  rows on the line ${hits.length}/${rows.length}; darkening factor median ${(hits.length ? hits.map(h => h.dark / h.rowMedian).sort((a,b)=>a-b)[Math.floor(hits.length/2)] : 0).toFixed(3)}`);
  console.log(`  runs along the line ${runs.length}; run length median ${runs.length ? runs.map(r=>r.to-r.from+1).sort((a,b)=>a-b)[Math.floor(runs.length/2)] : 0} px; gap median ${gaps.length ? gaps[Math.floor(gaps.length/2)] : 0} px, max ${gaps.at(-1) ?? 0} px`);
} finally { await browser.close(); }
