import sharp from "sharp";

const file = "public/solar-system/textures/2k_saturn_ring_alpha.png";
const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const row = Math.floor(height / 2);

// The shader maps radius -> u as (r - 1.28) / 1.07, so u = 0 is 1.28 R and u = 1 is 2.35 R.
const R_EQ = 60268;
const U0 = 1.28, SPAN = 1.07;
const radiusKm = (u) => (U0 + u * SPAN) * R_EQ;

const alpha = [];
for (let x = 0; x < width; x++) alpha.push(data[(row * width + x) * channels + 3] / 255);

console.log(`贴图 ${width}x${height}，取样行 ${row}`);
console.log(`按当前映射 u=0 -> ${Math.round(radiusKm(0)).toLocaleString()} km，u=1 -> ${Math.round(radiusKm(1)).toLocaleString()} km\n`);

// PDS inner/outer boundaries for the major features, in km.
const features = [
  ["D 内缘", 66900], ["C 内缘", 74491, "gap-start"], ["Maxwell 缝", 87343], ["Bond 缝", 88686],
  ["B 内缘", 91975], ["B 外缘", 117570], ["卡西尼缝", 117500], ["Huygens 缝", 117500],
  ["A 内缘", 122050], ["Encke 缝", 133423], ["Keeler 缝", 136487], ["A 外缘", 136770],
  ["F 环", 139826],
];

console.log("=== 真实半径在当前映射下对应的贴图位置 ===");
for (const [name, km] of features) {
  const u = (km / R_EQ - U0) / SPAN;
  const inside = u >= 0 && u <= 1;
  const value = inside ? alpha[Math.min(width - 1, Math.round(u * (width - 1)))] : null;
  console.log(
    `${name.padEnd(12)} ${String(km).padStart(7)} km  u=${u.toFixed(3)}  ` +
    (inside ? `alpha=${value.toFixed(3)}` : "** 落在贴图范围之外 **"),
  );
}

console.log("\n=== 贴图 alpha 剖面（64 档，每档一个平均）===");
const bins = 64;
for (let i = 0; i < bins; i++) {
  const from = Math.floor((i * width) / bins), to = Math.floor(((i + 1) * width) / bins);
  const slice = alpha.slice(from, to);
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const lo = radiusKm(i / bins), hi = radiusKm((i + 1) / bins);
  const bar = "█".repeat(Math.round(mean * 40));
  console.log(`${String(Math.round(lo)).padStart(7)}-${String(Math.round(hi)).padStart(7)} km ${mean.toFixed(3)} ${bar}`);
}
