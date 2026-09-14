import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const label = process.argv[2] || "after";
const OUT = `outputs/saturn-oblateness/app-${label}`;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

const settle = () => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && !s.ephemeris.blocked
    && document.getElementById("loading-screen").hidden;
}, null, { timeout: 90000 });

await page.goto("http://127.0.0.1:5173/solar-system/", { waitUntil: "domcontentloaded" });
await settle();

await page.locator("#catalog-filter").selectOption("planets");
await page.locator('.planet-choice[data-body="saturn"]').click();
await settle();
await page.waitForFunction(
  () => window.solarAtlas.snapshot().bodies.find((b) => b.id === "saturn").detailReady,
  null, { timeout: 60000 },
);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/saturn-near.png` });

// 北极六边形：位于 90°N，是扁平位移最大的位置
async function selectFeature(id) {
  await page.locator("#observation-settings summary").click();
  await page.locator("#landmark-select").selectOption(id);
  await page.keyboard.press("Escape");
  await settle();
  await page.waitForFunction(
    (x) => window.solarAtlas.snapshot().landmarks.active === x, id, { timeout: 30000 },
  );
  await page.waitForTimeout(1400);
}

await selectFeature("hexagon");
await page.screenshot({ path: `${OUT}/hexagon-north-pole.png` });

await selectFeature("ring-shadow");
await page.screenshot({ path: `${OUT}/ring-shadow.png` });

const report = await page.evaluate(() => {
  const s = window.solarAtlas.snapshot();
  const saturn = s.bodies.find((b) => b.id === "saturn");
  const marker = document.querySelector('[data-landmark]:not([hidden])');
  return {
    activeLandmark: s.landmarks.active,
    markerVisible: marker ? marker.dataset.landmark : null,
    markerRect: marker ? marker.getBoundingClientRect().toJSON() : null,
    saturnRadius: saturn.radius,
  };
});

console.log(label, JSON.stringify(report, null, 2));
console.log("errors:", errors.length ? errors : "none");
await browser.close();
