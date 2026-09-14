import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Same browser/device, fresh context, fixed 10 Mbit/s and 40 ms latency.
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5190';
const label = process.env.MEASURE_LABEL || 'current';
const runs = Number(process.env.MEASURE_RUNS || 3);
const output = new URL('../test-results/performance/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
try {
  for (let run = 0; run < runs; run++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 1250000, uploadThroughput: 1250000 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const started = performance.now();
      const observe = () => {
        if (window.solarAtlas?.snapshot().ready && window.solarAtlas.snapshot().renderCalls > 0 && document.getElementById('loading-screen')?.hidden) {
          window.startupMeasurement = { interactiveMs: performance.now() - started };
        } else requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
    });
    await page.goto(base + '/solar-system/', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.startupMeasurement || !document.getElementById('error-screen')?.hidden, null, { timeout: 120000 });
    if (errors.length || await page.locator('#error-screen').isVisible()) {
      await page.screenshot({ path: fileURLToPath(new URL(label + '-failure.png', output)) });
      throw new Error(errors.join('\n') || await page.locator('#error-message').textContent());
    }
    const result = await page.evaluate(() => {
      const canvas=document.querySelector('#universe canvas'),gl=canvas.getContext('webgl2'),extension=gl.getExtension('WEBGL_debug_renderer_info');
      return {
      renderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
      drawingBuffer:{width:gl.drawingBufferWidth,height:gl.drawingBufferHeight},
      readyMs: performance.now(),
      observed: window.startupMeasurement,
      snapshot: window.solarAtlas.snapshot(),
      textures: performance.getEntriesByType('resource').filter(r => r.name.includes('/textures/')).map(r => ({ path: new URL(r.name).pathname, bytes: r.encodedBodySize, start: r.startTime, end: r.responseEnd })),
    };});
    if (errors.length) throw new Error(errors.join('\n'));
    results.push(result);
    console.log(JSON.stringify({ run, readyMs: result.readyMs, textures: result.textures.length, bytes: result.textures.reduce((s, r) => s + r.bytes, 0) }));
    await page.screenshot({ path: fileURLToPath(new URL(label + '-' + run + '.png', output)) });
    await context.close();
  }
  await writeFile(new URL(label + '.json', output), JSON.stringify({ base, label, viewport: '1440x900', bandwidth: '10 Mbit/s', latencyMs: 40, cache: 'disabled', browser: browser.version(), results }, null, 2));
} finally { await browser.close(); }
