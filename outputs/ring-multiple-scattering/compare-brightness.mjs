import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Reproduces the framing of outputs/saturn-oblateness/app-ring-final/saturn-near.png
// (the state accepted before multiple scattering) so the ring brightness can be
// compared pixel for pixel against the same view.
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5199';
const output = new URL('./', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const settle = () => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked && document.getElementById('loading-screen').hidden;
}, null, { timeout: 90000 });
try {
  await page.goto(base + '/solar-system/', { waitUntil: 'domcontentloaded' });
  await settle();
  await page.locator('#catalog-filter').selectOption('planets');
  await page.locator('.planet-choice[data-body="saturn"]').click();
  await settle();
  await page.waitForFunction(
    () => window.solarAtlas.snapshot().bodies.find(b => b.id === 'saturn').detailReady,
    null, { timeout: 60000 },
  );
  await page.waitForTimeout(1200);
  const shot = await page.screenshot();
  await writeFile(new URL('saturn-near.png', output), shot);

  async function profile(path, y) {
    const { data, info } = await sharp(fileURLToPath(path)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const row = [];
    for (let x = 600; x < 1800; x += 24) {
      const i = (y * info.width + x) * info.channels;
      row.push((data[i] + data[i + 1] + data[i + 2]) / 3 / 255);
    }
    return row;
  }
  for (const [label, path] of [
    ['改动前 (单次散射 × 曝光 10)', '../saturn-oblateness/app-ring-final/saturn-near.png'],
    ['改动后 (含多次散射, 无曝光因子)', 'saturn-near.png'],
  ]) {
    const p = await profile(new URL(path, output), 950);
    const peak = Math.max(...p);
    const lit = p.filter(v => v > 0.02);
    const mean = lit.length ? lit.reduce((a, b) => a + b, 0) / lit.length : 0;
    console.log(`${label.padEnd(30)} 峰值 ${peak.toFixed(3)}  环区平均 ${mean.toFixed(3)}  亮起 ${lit.length}/${p.length}`);
  }
  console.log('errors:', errors.length, errors.slice(0, 3));
} finally {
  await browser.close();
}
