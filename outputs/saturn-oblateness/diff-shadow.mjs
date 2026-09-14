import sharp from "sharp";

async function read(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

for (const name of ["2002-solstice-north", "2017-solstice-south", "2025-equinox-edge-on"]) {
  const a = await read(`outputs/saturn-oblateness/ring-shadow-dates-before/${name}.png`);
  const b = await read(`outputs/saturn-oblateness/ring-shadow-dates/${name}.png`);
  const n = Math.min(a.data.length, b.data.length);
  let sum = 0, max = 0, changed = 0, pixels = 0;
  for (let i = 0; i < n; i += 3) {
    const d = (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])) / 3;
    sum += d; if (d > max) max = d;
    if (d > 4) changed++;
    pixels++;
  }
  console.log(`${name.padEnd(24)} 平均差 ${(sum / pixels).toFixed(2)}  最大差 ${max.toFixed(0)}  明显变化像素 ${(changed / pixels * 100).toFixed(1)}%`);
}
