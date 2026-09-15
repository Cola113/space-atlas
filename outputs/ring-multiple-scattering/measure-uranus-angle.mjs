import { chromium } from 'playwright';
import { Vector3, Quaternion } from 'three';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
for (const [label, seed] of [['default framing', null], ['close view', 'close']]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://127.0.0.1:5199/solar-system/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const s = window.solarAtlas?.snapshot(); return s?.ready && document.getElementById('loading-screen').hidden; }, null, { timeout: 90000 });
  await page.locator('#catalog-filter').selectOption('planets');
  await page.locator('.planet-choice[data-body="uranus"]').click();
  await page.waitForTimeout(1200);
  if (seed) { await page.locator('#surface-button').click(); await page.waitForTimeout(1200); }
  const s = await page.evaluate(() => window.solarAtlas.snapshot());
  const u = s.bodies.find(b => b.id === 'uranus');
  const body = new Vector3().fromArray(u.position);
  const camera = new Vector3().fromArray(s.camera);
  const pole = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().fromArray(u.orientation)).normalize();
  const toCamera = camera.clone().sub(body).normalize();
  const opening = 90 - Math.acos(Math.abs(toCamera.dot(pole))) * 180 / Math.PI;
  console.log(`${label.padEnd(16)} ring-plane opening angle to the camera = ${opening.toFixed(1)} deg  (0 = edge-on, 90 = face-on)`);
  await page.close();
}
await browser.close();
