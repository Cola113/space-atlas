// Run with npx tsx: display definitions reference the shared JSON registry.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { bodies } from '../solar-system/src/data.js';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5191';
const output = new URL('../test-results/solar-loading/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = [];
const bodyKey = id => { const body = bodies.find(item => item.id === id); return body.baseTexture || `2k_${body.texture}.jpg`; };
async function ready(page) {
  await page.waitForFunction(() => window.solarAtlas?.snapshot().loading.interactiveAt || !document.getElementById('error-screen')?.hidden, null, { timeout: 45000 });
  assert.equal(await page.locator('#error-screen').isVisible(), false, await page.locator('#error-message').textContent());
}
async function capture(page, name) {
  await page.screenshot({ path: fileURLToPath(new URL(name + '.png', output)) });
  const { data } = await sharp(await page.locator('#universe canvas').screenshot()).resize(160, 100).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.ok([...data].filter(value => value > 25).length > 60, 'rendered scene is blank');
}
async function choose(page, id, catalog) {
  await page.locator('#catalog-filter').selectOption(catalog);
  await page.locator(`.planet-choice[data-body="${id}"]`).click();
  await page.waitForFunction(id => window.solarAtlas.snapshot().selected === id, id);
}
async function instrumentation(page) {
  await page.addInitScript(() => {
    window.resourceStarts = [];
    const original = window.fetch;
    window.fetch = function(input, options) {
      window.resourceStarts.push({ url: String(input), start: performance.now() });
      return original.call(this, input, options);
    };
  });
}

try {
  const viewports = process.env.LOADING_CHECK === 'retry' ? [] : [['desktop',1440,900,1], ['phone',390,844,3], ['tablet',800,450,2], ['compact',640,360,2]];
  for (const [name, width, height, dpr] of viewports) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [], held = [];
    page.on('pageerror', error => errors.push(error.message));
    await instrumentation(page);
    let releaseBackground = false;
    // Keep every background texture and sky resource unavailable. Readiness
    // must depend only on the 11 previews, even on a high-DPI small screen.
    await page.route(/\/solar-system\/(textures|sky)\//, async route => {
      if (route.request().url().includes('/textures/previews/') || releaseBackground) return route.continue();
      held.push(route);
    });
    try {
      await page.goto(base + '/solar-system/', { waitUntil: 'domcontentloaded' });
      await ready(page);
      await page.locator('#play-toggle').click();
      const initial = await page.evaluate(() => ({ snapshot: window.solarAtlas.snapshot(), starts: window.resourceStarts }));
      assert.equal(initial.snapshot.playing, false);
      assert.equal(initial.snapshot.bodies.length, bodies.length);
      const beforeFrame = initial.starts.filter(item => item.start < initial.snapshot.loading.firstFrameAt && item.url.includes('/textures/'));
      assert.equal(beforeFrame.length, 11);
      assert.ok(beforeFrame.every(item => item.url.includes('/previews/')));
      assert.ok(initial.snapshot.loading.queue.active <= 2);
      assert.ok(initial.snapshot.loading.queue.peak <= 4);
      assert.equal(initial.snapshot.starfield.mode, 'bright-stars');
      assert.equal(initial.snapshot.starfield.galaxyReady, false);
      await capture(page, name + '-background-held');
      const initialIdentity = initial.snapshot.bodies.map(item => [item.id, item.meshId]);

      // A new selection gets priority over the original background sequence;
      // a second target can be selected while that first selection is loading.
      await choose(page, 'charon', 'system:pluto');
      await choose(page, 'miranda', 'system:uranus');
      const pending = await page.evaluate(() => window.solarAtlas.snapshot());
      assert.equal(pending.selected, 'miranda');
      const queued = pending.loading.queue.queued;
      const targetKey = '/solar-system/textures/' + bodyKey('miranda');
      assert.equal(queued.find(item => item.key === targetKey)?.priority, 90);
      assert.equal(queued.find(item => item.key.endsWith(bodyKey('charon')))?.priority, 0);
      await page.waitForFunction(() => {const s=window.solarAtlas.snapshot();return !s.flight&&!s.ephemeris.blocked&&s.bodies.find(b=>b.id==='miranda').physicalAvailable;}, null, { timeout: 45000 });
      const stable = await page.evaluate(() => window.solarAtlas.snapshot());
      const body = stable.bodies.find(item => item.id === 'miranda');
      assert.equal(body.textureWidth, 0);
      assert.equal(body.detailReady, true);
      assert.match(await page.locator('#resolution-status').textContent(), /正在加载/);
      assert.match(await page.locator('#planet-english').textContent(), /细节加载中/);
      await capture(page, name + '-selected-loading');
      releaseBackground = true;
      const startsBeforeRelease = await page.evaluate(() => window.resourceStarts.length);
      await Promise.all(held.splice(0).map(route => route.continue().catch(() => {})));
      await page.waitForFunction(() => window.solarAtlas.snapshot().bodies.find(item => item.id === 'miranda').textureWidth >= 1900, null, { timeout: 60000 });
      const loaded = await page.evaluate(() => window.solarAtlas.snapshot());
      assert.equal(loaded.selected, 'miranda');
      assert.equal(loaded.date, stable.date);
      assert.ok(loaded.camera.every((value, i) => Math.abs(value - stable.camera[i]) < 1e-8));
      assert.ok(loaded.target.every((value, i) => Math.abs(value - stable.target[i]) < 1e-8));
      assert.deepEqual(loaded.bodies.map(item => [item.id, item.meshId]), initialIdentity);
      // A first JPL response legitimately replaces a missing physical state.
      // Texture replacement must preserve every already available body at the
      // frozen date, including the selected body whose gate has now resolved.
      for(const before of stable.bodies.filter(b=>b.physicalAvailable)){
        const after=loaded.bodies.find(b=>b.id===before.id);
        assert.deepEqual([after.position,after.rotation,after.physicalPositionKm,after.physicalOrientation],
          [before.position,before.rotation,before.physicalPositionKm,before.physicalOrientation],before.id+' changed during texture replacement');
      }
      assert.equal(loaded.loading.queue.concurrency, 2);
      assert.equal(loaded.failedTextures.length, 0);
      const admitted = await page.evaluate(index => window.resourceStarts.slice(index).filter(item => item.url.includes('/textures/') && !item.url.includes('/thumbnails/')), startsBeforeRelease);
      assert.equal(admitted[0]?.url, targetKey, 'next free request slot must serve the last selected body');
      await capture(page, name + '-selected-loaded');
      // Hidden atlas entries must not have issued their image requests.
      const thumbnails = await page.evaluate(() => window.resourceStarts.filter(item => item.url.includes('/thumbnails/')).map(item => item.url));
      assert.ok(!thumbnails.some(url => url.endsWith('/eris.webp')));
      assert.equal(new Set(thumbnails).size, thumbnails.length, 'visible thumbnail requests were duplicated');
      assert.deepEqual(errors, []);
      report.push({ name, viewport: { width, height, dpr }, firstFrameAt: initial.snapshot.loading.firstFrameAt,
        beforeFrame, queue: { peak: loaded.loading.queue.peak, backgroundConcurrency: loaded.loading.queue.concurrency },
        stableDate: loaded.date, stableMeshCount: loaded.bodies.length, thumbnails });
      console.log(JSON.stringify({ name, status: 'passed', firstFrameAt: initial.snapshot.loading.firstFrameAt }));
    } catch (error) {
      await writeFile(new URL(name + '-failure.json', output), JSON.stringify({ error: String(error), errors,
        state: await page.evaluate(() => ({ snapshot: window.solarAtlas?.snapshot(), text: document.body.innerText, starts: window.resourceStarts })).catch(() => null) }, null, 2));
      await page.screenshot({ path: fileURLToPath(new URL(name + '-failure.png', output)) }).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }

  const context = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 2 });
  const page = await context.newPage(), errors = [], blocked = [];
  page.on('pageerror', error => errors.push(error.message));
  let failPreview = true;
  await instrumentation(page);
  await page.route('**/textures/previews/earth.webp', route => {
    if (failPreview) blocked.push(route); else return route.continue();
  });
  // Do not allow the full map to conceal the preview's failure/retry result.
  await page.route('**/textures/2k_earth_daymap.jpg', route => blocked.push(route));
  await page.route('**/textures/' + bodies.find(body => body.id === 'earth').high, route => blocked.push(route));
  try {
    await page.goto(base + '/solar-system/', { waitUntil: 'domcontentloaded' });
    await ready(page);
    const failed = await page.evaluate(() => window.solarAtlas.snapshot());
    assert.ok(failed.failedTextures.includes('previews/earth.webp'));
    assert.equal(failed.bodies.find(body => body.id === 'earth').textureWidth, 0);
    const duration = await page.evaluate(() => window.solarAtlas.snapshot().loading.firstFrameAt - window.resourceStarts.find(item => item.url.endsWith('/previews/earth.webp')).start);
    assert.ok(duration >= 7900 && duration < 14000, `8 second fallback took ${duration}ms`);
    await choose(page, 'earth', 'planets');
    const retry = page.locator('#resource-retry');
    const rect = await retry.boundingBox();
    assert.ok(rect.width >= 44 && rect.height >= 44);
    await retry.click({ trial: true });
    await capture(page, 'compact-preview-timeout');
    failPreview = false;
    await retry.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !window.solarAtlas.snapshot().failedTextures.includes('previews/earth.webp'), null, { timeout: 20000 });
    await page.waitForFunction(() => window.solarAtlas.snapshot().bodies.find(body => body.id === 'earth').textureWidth === 768, null, { timeout: 20000 });
    assert.deepEqual(errors, []);
    await capture(page, 'compact-preview-recovered');
    report.push({ name: 'timeout-and-keyboard-retry', previewFailureMs: duration, retryButton: rect });
    console.log(JSON.stringify({ name: 'timeout-and-keyboard-retry', status: 'passed', duration }));
  } catch (error) {
    await writeFile(new URL('retry-failure.json', output), JSON.stringify({ error: String(error), errors,
      state: await page.evaluate(() => ({ snapshot: window.solarAtlas?.snapshot(), text: document.body.innerText, starts: window.resourceStarts })).catch(() => null) }, null, 2));
    await page.screenshot({ path: fileURLToPath(new URL('retry-failure.png', output)) }).catch(() => {});
    throw error;
  } finally { await context.close(); }
  await writeFile(new URL(process.env.LOADING_CHECK === 'retry' ? 'retry-report.json' : 'report.json', output), JSON.stringify(report, null, 2));
} finally { await browser.close(); }
