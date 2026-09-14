import sharp from "sharp";

async function diff(a, b, label) {
  const A = await sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = Math.min(A.data.length, B.data.length);
  let sum = 0, max = 0, changed = 0, pixels = 0;
  for (let i = 0; i < n; i += 3) {
    const d = (Math.abs(A.data[i] - B.data[i])
      + Math.abs(A.data[i + 1] - B.data[i + 1])
      + Math.abs(A.data[i + 2] - B.data[i + 2])) / 3;
    sum += d;
    if (d > max) max = d;
    if (d > 3) changed++;
    pixels++;
  }
  console.log(`${label.padEnd(22)} 平均 ${(sum / pixels).toFixed(2)}  最大 ${max.toFixed(0)}  变化像素 ${(changed / pixels * 100).toFixed(2)}%`);
}

await diff("outputs/saturn-oblateness/aa-before-crop.png", "outputs/saturn-oblateness/aa-after-crop.png", "近景裁切");
await diff("outputs/saturn-oblateness/app-aa-before/ring-shadow.png", "outputs/saturn-oblateness/app-aa-after/ring-shadow.png", "环影地标视角");
