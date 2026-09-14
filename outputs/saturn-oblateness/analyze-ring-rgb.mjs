import sharp from "sharp";

const file = "public/solar-system/textures/2k_saturn_ring_alpha.png";
const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const row = Math.floor(height / 2);

const stats = [];
for (let x = 0; x < width; x += 1) {
  const i = (row * width + x) * channels;
  stats.push([data[i], data[i + 1], data[i + 2]]);
}
const mean = [0, 1, 2].map((c) => stats.reduce((a, p) => a + p[c], 0) / stats.length);
const variance = [0, 1, 2].map((c) => stats.reduce((a, p) => a + (p[c] - mean[c]) ** 2, 0) / stats.length);
console.log("RGB 均值:", mean.map((v) => v.toFixed(1)).join(", "));
console.log("RGB 标准差:", variance.map((v) => Math.sqrt(v).toFixed(1)).join(", "));
console.log("相对起伏:", variance.map((v, i) => ((Math.sqrt(v) / mean[i]) * 100).toFixed(1) + "%").join(", "));

// Where RGB does vary, does it follow the alpha structure or vary independently?
const withAlpha = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const pairs = [];
for (let x = 0; x < width; x++) {
  const i = (row * width + x) * withAlpha.info.channels;
  const a = withAlpha.data[i + 3] / 255;
  const lum = (withAlpha.data[i] + withAlpha.data[i + 1] + withAlpha.data[i + 2]) / 3;
  pairs.push([a, lum]);
}
const meanA = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
const meanL = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
let cov = 0, va = 0, vl = 0;
for (const [a, l] of pairs) { cov += (a - meanA) * (l - meanL); va += (a - meanA) ** 2; vl += (l - meanL) ** 2; }
console.log("\nalpha 与 RGB 亮度的相关系数:", (cov / Math.sqrt(va * vl)).toFixed(3));

console.log("\n=== 每 128 px 的平均 RGB 与 alpha（看结构落在哪个通道）===");
for (let from = 0; from < width; from += 128) {
  const to = Math.min(width, from + 128);
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  for (let x = from; x < to; x++) {
    const i = (row * width + x) * withAlpha.info.channels;
    r += withAlpha.data[i]; g += withAlpha.data[i + 1]; b += withAlpha.data[i + 2];
    a += withAlpha.data[i + 3] / 255; n++;
  }
  console.log(`px ${String(from).padStart(4)}-${String(to).padStart(4)}  RGB ${(r / n).toFixed(0).padStart(3)},${(g / n).toFixed(0).padStart(3)},${(b / n).toFixed(0).padStart(3)}  alpha ${(a / n).toFixed(3)}`);
}
