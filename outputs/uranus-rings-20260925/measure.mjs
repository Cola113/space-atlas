import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = new URL('./', import.meta.url);
const beforeReport = JSON.parse(await readFile(new URL('physical-report.json', root), 'utf8'));
const afterReport = JSON.parse(await readFile(new URL('final-report.json', root), 'utf8'));
const measurements = [];
for (const name of ['default', 'edge']) {
  const before = beforeReport.find(r => r.name === name), after = afterReport.find(r => r.name === name);
  assert.deepEqual(before.body.physicalPositionKm, after.body.physicalPositionKm);
  assert.deepEqual(before.body.orientation, after.body.orientation);
  assert.equal(before.body.radiusPx, after.body.radiusPx);
  const a = await sharp(await readFile(new URL(`physical-${name}.png`, root))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(await readFile(new URL(`final-${name}.png`, root))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(a.info, b.info);
  const { width, height, channels } = a.info;
  const body = after.body;
  const samples = { background: [], globe: [] };
  for (let y = 250; y < Math.min(height - 220, body.y + body.radiusPx * 2.3); y++) {
    for (let x = Math.max(320, Math.floor(body.x - body.radiusPx * 2.3)); x < Math.min(width - 150, body.x + body.radiusPx * 2.3); x++) {
      const r = Math.hypot(x + .5 - body.x, y + .5 - body.y) / body.radiusPx;
      const region = r < .8 ? 'globe' : r > 1.15 && r < 2.3 ? 'background' : null;
      if (!region) continue;
      const i = (y * width + x) * channels;
      const old = (a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3;
      const current = (b.data[i] + b.data[i + 1] + b.data[i + 2]) / 3;
      samples[region].push(current - old);
    }
  }
  const summary = Object.fromEntries(Object.entries(samples).map(([region, values]) => [region, {
    brighterPixels: values.filter(d => d >= 5).length,
    darkerPixels: values.filter(d => d <= -5).length,
    maximumGain: values.reduce((max, value) => Math.max(max, value), 0),
    maximumLoss: -values.reduce((min, value) => Math.min(min, value), 0),
  }]));
  assert.ok(summary.background.brighterPixels > 150, `${name}: ring does not read against the background`);
  assert.ok(summary.globe.maximumLoss < 12, `${name}: presentation creates a dark scratch on the disk`);
  measurements.push({ name, ...summary, passed: true });
}
await writeFile(new URL('measurements.json', root), JSON.stringify(measurements, null, 2));
console.log(JSON.stringify(measurements, null, 2));
const left = await sharp(await readFile(new URL('physical-default.png', root))).extract({ left: 550, top: 275, width: 720, height: 485 }).toBuffer();
const right = await sharp(await readFile(new URL('final-default.png', root))).extract({ left: 550, top: 275, width: 720, height: 485 }).toBuffer();
await sharp({ create: { width: 1456, height: 485, channels: 3, background: '#182327' } })
  .composite([{ input: left, left: 0, top: 0 }, { input: right, left: 736, top: 0 }])
  .png().toFile(fileURLToPath(new URL('comparison.png', root)));
