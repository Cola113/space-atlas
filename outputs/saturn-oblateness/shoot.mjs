import { chromium } from "playwright";

const URL = "http://127.0.0.1:5173/outputs/saturn-oblateness/index.html";
const OUT = "outputs/saturn-oblateness";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => {
  const el = document.getElementById("after-eq");
  return el && el.textContent && el.textContent !== "–";
}, null, { timeout: 20000 });
await page.waitForTimeout(600);

const maxZoom = await page.evaluate(() => Number(document.getElementById("zoom").max));
console.log("动态放大上限:", maxZoom.toFixed(2), "×");

async function apply({ ring, zoom, refCircle = true, wide = false }) {
  await page.evaluate(({ ring, zoom, refCircle, wide }) => {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el.type === "checkbox") el.checked = value;
      else el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("ring-angle", ring);
    set("zoom", zoom);
    set("ref-circle", refCircle);
    set("wide", wide);
  }, { ring, zoom, refCircle, wide });
  await page.waitForTimeout(450);
}

async function readout() {
  return page.evaluate(() => ({
    ring: document.getElementById("ring-angle-out").textContent,
    zoom: document.getElementById("zoom-out").textContent,
    before: {
      eq: document.getElementById("before-eq").textContent,
      po: document.getElementById("before-po").textContent,
      fl: document.getElementById("before-fl").textContent,
    },
    after: {
      eq: document.getElementById("after-eq").textContent,
      po: document.getElementById("after-po").textContent,
      fl: document.getElementById("after-fl").textContent,
    },
  }));
}

const shots = [];
const stage = page.locator(".stage");
for (const config of [
  { name: "01-app-size-1x", ring: 33, zoom: 1, crop: true },
  { name: "02-zoom-limit", ring: 33, zoom: 99 },
  { name: "03-zoom-limit-crop", ring: 33, zoom: 99, crop: true },
  { name: "04-edge-on-crop", ring: 1, zoom: 99, crop: true },
  { name: "05-wide-rings", ring: 33, zoom: 1, wide: true },
]) {
  await apply(config);
  if (config.crop) await stage.screenshot({ path: `${OUT}/${config.name}.png` });
  else await page.screenshot({ path: `${OUT}/${config.name}.png` });
  shots.push({ name: config.name, ...(await readout()) });
}

console.log(JSON.stringify(shots, null, 2));
console.log("console errors:", errors.length ? errors : "none");

await browser.close();
