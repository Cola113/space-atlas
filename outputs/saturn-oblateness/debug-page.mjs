import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on("pageerror", (e) => { if (errors.length < 2) errors.push((e.stack || String(e)).slice(0, 2500)); });

await page.goto("http://127.0.0.1:5173/solar-system/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(12000);
const state = await page.evaluate(() => {
  const s = window.solarAtlas?.snapshot?.();
  return s ? { ready: s.ready, selected: s.selected, hidden: document.getElementById("loading-screen")?.hidden } : { error: "no snapshot" };
});
console.log("页面状态:", JSON.stringify(state));
console.log("\n=== pageerror 堆栈 ===");
console.log(errors.length ? errors.join("\n\n") : "(无)");
await browser.close();
