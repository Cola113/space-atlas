import sharp from "sharp";

async function read(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

for (const name of ["north", "south"]) {
  const on = await read(`test-results/saturn-shadows/${name}-full.png`);
  const off = await read(`test-results/saturn-shadows/${name}-without-shadows.png`);
  const n = Math.min(on.data.length, off.data.length);
  let sum = 0, max = 0, changed = 0, pixels = 0;
  for (let i = 0; i < n; i += 3) {
    const d = (Math.abs(on.data[i] - off.data[i])
      + Math.abs(on.data[i + 1] - off.data[i + 1])
      + Math.abs(on.data[i + 2] - off.data[i + 2])) / 3;
    sum += d;
    if (d > max) max = d;
    if (d > 3) changed++;
    pixels++;
  }
  console.log(
    `${name.padEnd(6)} 阴影开/关差异: 平均 ${(sum / pixels).toFixed(2)}` +
    `  最大 ${max.toFixed(0)}  可见变化像素 ${(changed / pixels * 100).toFixed(2)}%`,
  );
}
