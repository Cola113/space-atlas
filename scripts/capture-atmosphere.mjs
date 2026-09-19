// Records a planet over time and reports how much of its disc changes between frames.
//
//   NODE_PATH=$PWD/node_modules node scripts/capture-atmosphere.mjs <body> <outDir> [frames] [intervalMs] [zoom]
//
// Starts the project's own production server (server/index.js) on a free port, opens headless
// Edge, seeds the session (selected body, playing, activity on), waits until the body's texture
// has loaded, then saves numbered PNGs and reports, over the disc:
//   the fraction of pixels whose luminance changes by more than 8/255 between the first and the
//   last frame, and between consecutive frames.
// The numbers describe the display, not a wind speed. <zoom> scales the camera offset
// (1 = the default framing, 0.45 = closer). Evidence for the 2026-09-19 Saturn change and how to
// read the numbers: outputs/saturn-atmosphere/README.md.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import sharp from 'sharp';

const [, , body = 'saturn', outDir = 'test-results/atmosphere', framesArg = '8', intervalArg = '700', zoomArg = '1'] = process.argv;
const frames = Number(framesArg);
const interval = Number(intervalArg);
const zoom = Number(zoomArg);
const root = process.cwd();

const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const waitHttp = url => new Promise((resolve, reject) => {
  const started = Date.now();
  const tick = () => http.get(url, res => { res.resume(); resolve(); }).on('error', () => {
    if (Date.now() - started > 90000) reject(new Error('server did not start'));
    else setTimeout(tick, 500);
  });
  tick();
});
const makeSeed = (extra = {}) => ({ version: 1, value: {
  selected: body, playing: true, shadows: true, dynamics: true, followRotation: false,
  date: Date.UTC(2002, 9, 1), speed: 500, speedUnit: 'realtime', direction: 1, portrait: false, ...extra } });

function discStats(shots, a, b) {
  const pa = shots[a].data, pb = shots[b].data;
  const { x, y, radiusPx } = shots[a].pos;
  const w = shots[a].width, h = shots[a].height;
  let n = 0, over8 = 0, over20 = 0, total = 0;
  for (let py = Math.max(0, Math.floor(y - radiusPx)); py < Math.min(h, Math.ceil(y + radiusPx)); py++) {
    for (let px = Math.max(0, Math.floor(x - radiusPx)); px < Math.min(w, Math.ceil(x + radiusPx)); px++) {
      const dx = px - x, dy = py - y;
      if (dx * dx + dy * dy > radiusPx * radiusPx * 0.94) continue;
      const i = (py * w + px) * 3;
      n++;
      const la = (pa[i] + pa[i + 1] + pa[i + 2]) / 3, lb = (pb[i] + pb[i + 1] + pb[i + 2]) / 3;
      const d = Math.abs(la - lb);
      total += d;
      if (d > 8) over8++;
      if (d > 20) over20++;
    }
  }
  return { discPixels: n, meanAbsDiff: +(total / n).toFixed(2), pctOver8: +(over8 / n * 100).toFixed(1), pctOver20: +(over20 / n * 100).toFixed(1) };
}

fs.mkdirSync(outDir, { recursive: true });
const port = await freePort();
const server = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
let browser;
try {
  await waitHttp(base + '/solar-system/');
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
  await context.addInitScript(({ seed }) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify(seed)), { seed: makeSeed() });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const settle = () => page.waitForFunction((body) => {
    const s = window.solarAtlas && window.solarAtlas.snapshot && window.solarAtlas.snapshot();
    if (!s || !s.ready || s.flight || (s.ephemeris && s.ephemeris.blocked)) return false;
    const b = s.bodies.find(x => x.id === body);
    return !!b && b.textureWidth >= 2048;
  }, body, { timeout: 180000 });
  await page.goto(base + '/solar-system/');
  await settle();
  if (zoom !== 1) {
    const s = await page.evaluate(() => window.solarAtlas.snapshot());
    const off = s.camera.map((v, i) => (v - s.target[i]) * zoom);
    await page.evaluate((seed) => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify(seed)), makeSeed({ offset: off }));
    await page.reload();
    await settle();
  }
  await page.waitForTimeout(1200);
  const shots = [];
  for (let i = 0; i < frames; i++) {
    const state = await page.evaluate(() => window.solarAtlas.snapshot());
    const one = state.bodies.find(x => x.id === body);
    const file = path.join(outDir, `${body}-${String(i).padStart(3, '0')}.png`);
    fs.writeFileSync(file, await page.screenshot());
    shots.push({ file, pos: { x: one.x, y: one.y, radiusPx: one.radiusPx }, t: Date.now(),
      playing: state.playing, date: state.date, activityTime: state.dynamics.bodies.find(b => b.id === body).time });
    await page.waitForTimeout(interval);
  }
  for (const shot of shots) {
    const { data, info } = await sharp(shot.file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    shot.data = data; shot.width = info.width; shot.height = info.height;
  }
  const out = { body, zoom, frames, interval,
    spanSeconds: +((shots[frames - 1].t - shots[0].t) / 1000).toFixed(1),
    state: shots.map(s => ({ playing: s.playing, date: s.date, activityTime: +s.activityTime.toFixed(2) })),
    firstToLast: discStats(shots, 0, frames - 1), consecutive: discStats(shots, 0, 1), errors };
  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(outDir, `${body}-motion.json`), JSON.stringify(out, null, 1));
} finally {
  if (browser) await browser.close();
  server.kill();
}
