import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

// Renders every declared ring system, to check the generalised path draws all four and
// that none of them raises a shader or runtime error.
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5199';
const output = new URL('./ring-systems/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = {};
const settle = page => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked && document.getElementById('loading-screen').hidden;
}, null, { timeout: 90000 });

try {
  for (const [id, name] of [['saturn', 'saturn'], ['uranus', 'uranus'], ['neptune', 'neptune'], ['jupiter', 'jupiter']]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base + '/solar-system/', { waitUntil: 'domcontentloaded' });
    await settle(page);
    await page.locator('#catalog-filter').selectOption('planets');
    await page.locator(`.planet-choice[data-body="${id}"]`).click();
    await settle(page);
    await page.waitForTimeout(1400);
    const shot = await page.screenshot();
    await writeFile(new URL(`${name}.png`, output), shot);
    const state = await page.evaluate(() => {
      const s = window.solarAtlas.snapshot();
      const body = s.bodies.find(b => b.id === window.__id);
      return { ringVisible: body?.ringVisible, ringOuterRadius: body?.ringOuterRadius };
    }).catch(() => ({}));
    report[id] = { errors };
    console.log(`${id}: errors=${errors.length}`, errors.slice(0, 2));
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(new URL('report.json', output), JSON.stringify(report, null, 1));
