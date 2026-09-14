import sharp from "sharp";

async function profile(path, y) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, channels } = info;
  const row = [];
  for (let x = 600; x < 1800; x += 24) {
    const i = (y * width + x) * channels;
    row.push(((data[i] + data[i + 1] + data[i + 2]) / 3 / 255));
  }
  return row;
}

// A horizontal cut through the ring system, well left of the planet.
const Y = 950;
for (const [label, path] of [
  ["改动前(美术贴图)", "outputs/saturn-oblateness/app-ring-tau/saturn-near.png"],
  ["改动后(τ 不透明度)", "outputs/saturn-oblateness/app-ring-exp/saturn-near.png"],
]) {
  const p = await profile(path, Y);
  const max = Math.max(...p);
  const lit = p.filter((v) => v > 0.02);
  const mean = lit.length ? lit.reduce((a, b) => a + b, 0) / lit.length : 0;
  console.log(`${label.padEnd(20)} 峰值 ${max.toFixed(3)}  环区平均 ${mean.toFixed(3)}  亮起像素 ${lit.length}/${p.length}`);
  console.log("  剖面:", p.map((v) => v.toFixed(2)).join(" "));
}
