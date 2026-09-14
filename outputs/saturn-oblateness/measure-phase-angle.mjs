import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://127.0.0.1:5173/solar-system/", { waitUntil: "domcontentloaded" });
const settle = () => page.waitForFunction(() => {
  const s = window.solarAtlas?.snapshot();
  return s?.ready && !s.flight && document.getElementById("loading-screen").hidden;
}, null, { timeout: 90000 });
await settle();
await page.locator('.planet-choice[data-body="saturn"]').click();
await page.waitForFunction(() => window.solarAtlas.snapshot().bodies.find((b) => b.id === "saturn").detailReady, null, { timeout: 60000 });
await page.waitForTimeout(1200);

const info = await page.evaluate(() => {
  const s = window.solarAtlas.snapshot();
  const b = s.bodies.find((x) => x.id === "saturn");
  return { sun: s.lightDirection, camera: s.camera, target: s.target, orientation: b.orientation };
});

// Phase angle: Sun-particle-observer, computed in the body frame so the ring plane
// orientation does not matter.
function rotateByInverseQuaternion(q, v) {
  const [x, y, z, w] = q;
  const ix = -x, iy = -y, iz = -z;
  const tx = 2 * (iy * v[2] - iz * v[1]);
  const ty = 2 * (iz * v[0] - ix * v[2]);
  const tz = 2 * (ix * v[1] - iy * v[0]);
  return [
    v[0] + w * tx + (iy * tz - iz * ty),
    v[1] + w * ty + (iz * tx - ix * tz),
    v[2] + w * tz + (ix * ty - iy * tx),
  ];
}
const norm = (v) => { const n = Math.hypot(...v); return v.map((c) => c / n); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const sunLocal = norm(rotateByInverseQuaternion(info.orientation, norm(info.sun)));
const observerLocal = norm(rotateByInverseQuaternion(info.orientation, norm(info.camera.map((c, i) => c - info.target[i]))));

console.log("太阳方向（土星本体系）:", sunLocal.map((v) => v.toFixed(3)).join(", "));
console.log("视线方向（土星本体系）:", observerLocal.map((v) => v.toFixed(3)).join(", "));
console.log("环面入射角 mu0 = |sun.z| :", Math.abs(sunLocal[2]).toFixed(3));
console.log("环面出射角 mu  = |view.z|:", Math.abs(observerLocal[2]).toFixed(3));
const cosAlpha = dot(sunLocal, observerLocal);
console.log("相位角 α =", (Math.acos(cosAlpha) * 180 / Math.PI).toFixed(1), "°");

const g = -0.6, g2 = g * g;
const phase = (c) => (1 - g2) / (1 + g2 + 2 * g * c) ** 1.5;
console.log("该相位角下 HG 值 P(α) =", phase(cosAlpha).toFixed(3), "   （背散射峰值 P(0) =", phase(1).toFixed(2), "）");
await browser.close();
