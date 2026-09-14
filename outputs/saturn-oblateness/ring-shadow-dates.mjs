import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { configureDeploymentAccess } from "../../scripts/deployment-access.mjs";

const base = process.env.ATLAS_URL || "http://127.0.0.1:5173";
const OUT = "outputs/saturn-oblateness/ring-shadow-dates";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });

// Read the live scene state once so the seeded session matches its schema.
const probe = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
await configureDeploymentAccess(probe, base);
const seedPage = await probe.newPage();
await seedPage.goto(base + "/solar-system/");
await seedPage.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && document.getElementById("loading-screen").hidden;
}, null, { timeout: 90000 });
await seedPage.locator('.planet-choice[data-body="saturn"]').click();
await seedPage.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && s.bodies.find((b) => b.id === "saturn").detailReady;
}, null, { timeout: 60000 });
const seed = await seedPage.evaluate(() => window.solarAtlas.snapshot());
const saturn = seed.bodies.find((b) => b.id === "saturn");
await probe.close();

// Saturn ring-plane geometry: solstice 2002-10 (Sun far north of the ring plane),
// solstice 2017-05 (Sun far south), equinox 2025-03 (Sun in the ring plane).
// The app stores `date` as epoch milliseconds, not a string.
const cases = [
  { name: "2002-solstice-north", date: Date.UTC(2002, 9, 1) },
  { name: "2017-solstice-south", date: Date.UTC(2017, 4, 1) },
  { name: "2025-equinox-edge-on", date: Date.UTC(2025, 2, 23) },
];

// Rotate a world vector into the body frame using the inverse of its quaternion.
function toBodyFrame(quaternion, vector) {
  const [x, y, z, w] = quaternion;
  const [vx, vy, vz] = vector;
  const ix = -x, iy = -y, iz = -z;
  const tx = 2 * (iy * vz - iz * vy);
  const ty = 2 * (iz * vx - ix * vz);
  const tz = 2 * (ix * vy - iy * vx);
  return [
    vx + w * tx + (iy * tz - iz * ty),
    vy + w * ty + (iz * tx - ix * tz),
    vz + w * tz + (ix * ty - iy * tx),
  ];
}

const results = [];
for (const item of cases) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 1000 }, reducedMotion: "reduce" });
  await configureDeploymentAccess(context, base);
  // Keep the app's own default Saturn framing, so each capture is the view a
  // reader actually gets; only the simulation date changes.
  await context.addInitScript(({ date }) => sessionStorage.setItem(
    "space-atlas:scene:solar-system",
    JSON.stringify({ version: 1, value: {
      selected: "saturn", playing: false, shadows: true, dynamics: true,
      followRotation: false, date, speed: 1000, speedUnit: "realtime",
      direction: 1, portrait: false } }),
  ), { date: item.date });

  const page = await context.newPage();
  await page.goto(base + "/solar-system/");
  await page.waitForFunction(() => {
    const s = window.solarAtlas?.snapshot();
    return s?.ready && s.selected === "saturn" && document.getElementById("loading-screen").hidden;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1200);

  const state = await page.evaluate(() => window.solarAtlas.snapshot());
  const body = state.bodies.find((b) => b.id === "saturn");
  const shot = await page.screenshot();
  const crop = { left: Math.max(0, Math.round(body.x - 300)), top: Math.max(0, Math.round(body.y - 300)), width: 600, height: 600 };
  const clip = {
    left: Math.min(crop.left, 1000 - crop.width), top: Math.min(crop.top, 1000 - crop.height),
    width: crop.width, height: crop.height,
  };
  await sharp(shot).extract(clip).toFile(`${OUT}/${item.name}.png`);

  const local = toBodyFrame(body.orientation, state.lightDirection);
  results.push({
    case: item.name,
    date: new Date(item.date).toISOString().slice(0, 10),
    // Sun elevation above Saturn's ring plane; 0° means the Sun lies in the ring
    // plane, so the ring shadow collapses to a line. ±26.7° are the solstices.
    solarElevationDeg: Number((Math.asin(local[1]) * 180 / Math.PI).toFixed(2)),
    bodyFrameSun: local.map((v) => Number(v.toFixed(3))),
  });
  await context.close();
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
