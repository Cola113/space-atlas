import { chromium } from "playwright";
import { configureDeploymentAccess } from "../../scripts/deployment-access.mjs";

const base = "http://127.0.0.1:5173";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
await configureDeploymentAccess(ctx, base);
const page = await ctx.newPage();
await page.goto(base + "/solar-system/");
await page.waitForFunction(() => window.solarAtlas?.snapshot()?.ready
  && document.getElementById("loading-screen").hidden, null, { timeout: 90000 });

const s = await page.evaluate(() => window.solarAtlas.snapshot());
console.log("seed.date =", JSON.stringify(s.date), "| typeof", typeof s.date);
const raw = await page.evaluate(() => sessionStorage.getItem("space-atlas:scene:solar-system"));
console.log("sessionStorage 片段:", String(raw).slice(0, 300));

const inputs = await page.evaluate(() => [...document.querySelectorAll("input")]
  .map((i) => ({ id: i.id, type: i.type, value: i.value }))
  .filter((i) => /date|time/i.test(i.id + i.type)));
console.log("日期相关输入:", JSON.stringify(inputs));

await browser.close();
