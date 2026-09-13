import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const output = new URL('../test-results/solar-loading/', import.meta.url);
await mkdir(output, { recursive: true });
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5191';
const fixture = await sharp(fileURLToPath(new URL('../public/solar-system/textures/2k_earth_clouds.jpg', import.meta.url)))
  .resize(2048, 1024).ensureAlpha().png().toBuffer();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const errors = [], requests = [];
let revision = 0;
const date = Date.now() - 3600000;
const frame = () => ({ file: `clouds-${String(revision).padStart(20, '0')}.png`, observedAt: new Date(date + revision * 3600000).toISOString(),
  width: 2048, height: 1024, projection: 'EPSG:4326', coveragePercent: 75 });
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({ version: 1,
    value: { selected: 'earth', observedEarth: true, playing: false, speed: 1000, speedUnit: 'realtime' } }));
  window.fetchStarts = [];
  const original = window.fetch;
  window.fetch = function(url, options) { window.fetchStarts.push({ url: String(url), time: performance.now() }); return original.call(this, url, options); };
});
await page.route('**/api/clouds**', async route => {
  const path = new URL(route.request().url()).pathname;
  requests.push(path);
  if (path.includes('/images/')) return route.fulfill({ status: 200, contentType: 'image/png', body: fixture });
  if (path.endsWith('/refresh')) revision++;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ frame: frame(), refreshing: false, error: null }) });
});
try {
  await page.goto(base + '/solar-system/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.solarAtlas?.snapshot().observedClouds.available, null, { timeout: 60000 });
  const first = await page.evaluate(() => ({ snapshot: window.solarAtlas.snapshot(), starts: window.fetchStarts }));
  assert.equal(first.snapshot.observedClouds.enabled, true);
  assert.equal(first.snapshot.playing, false);
  const api = first.starts.filter(item => item.url.includes('/api/clouds'));
  assert.ok(api.length >= 2);
  assert.ok(api.every(item => item.time > first.snapshot.loading.firstFrameAt), 'restored live cloud mode must wait for the first frame');
  assert.equal(first.snapshot.loading.queue.concurrency, 2);
  assert.equal(first.snapshot.observedClouds.failed, false);
  assert.equal(first.snapshot.observedClouds.frame.file, frame().file);
  await page.locator('#body-details-button').click();
  await page.locator('#cloud-refresh').click();
  await page.waitForFunction(() => window.solarAtlas.snapshot().observedClouds.pendingObservedAt !== null, null, { timeout: 30000 });
  const paused = await page.evaluate(() => window.solarAtlas.snapshot().observedClouds);
  assert.equal(paused.frame.file, first.snapshot.observedClouds.frame.file, 'new weather must not replace a paused frame');
  await page.locator('#close-body-details').click();
  await page.locator('#play-toggle').click();
  await page.waitForFunction(file => window.solarAtlas.snapshot().observedClouds.frame.file === file && window.solarAtlas.snapshot().observedClouds.blend === 1, frame().file, { timeout: 60000 });
  const final = await page.evaluate(() => window.solarAtlas.snapshot());
  assert.equal(final.observedClouds.failed, false);
  assert.equal(final.observedClouds.textureCount, 1);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: fileURLToPath(new URL('observed-cloud-loading.png', output)) });
  await writeFile(new URL('cloud-report.json', output), JSON.stringify({ firstFrameAt: first.snapshot.loading.firstFrameAt, apiStarts: api, requests, final: final.observedClouds, errors }, null, 2));
  console.log('restored observed clouds: deferred loading, refresh, paused pending frame and resume passed');
} catch (error) {
  await writeFile(new URL('cloud-failure.json', output), JSON.stringify({ error: String(error), errors, requests,
    state: await page.evaluate(() => ({ snapshot: window.solarAtlas?.snapshot(), starts: window.fetchStarts, text: document.body.innerText })).catch(() => null) }, null, 2));
  await page.screenshot({ path: fileURLToPath(new URL('cloud-failure.png', output)) }).catch(() => {});
  throw error;
} finally { await browser.close(); }
