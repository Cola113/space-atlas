import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

// Ring-only sample boxes, chosen inside the ring annulus and clear of the planet in
// both frames: the left C/B ring band and the upper-left arc.
const boxes = [
  ['左侧 C/B 环', 1210, 850, 1400, 940],
  ['左上 A 环弧', 1400, 640, 1560, 700],
  ['右侧 A 环', 2380, 900, 2520, 980],
  ['外环边缘', 2650, 880, 2760, 930],
];
async function luminance(path) {
  const { data, info } = await sharp(fileURLToPath(path)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}
const before = await luminance(new URL('../saturn-oblateness/app-ring-final/saturn-near.png', import.meta.url));
const after = await luminance(new URL('saturn-near.png', import.meta.url));
console.log('box'.padEnd(16), 'before'.padStart(8), 'after'.padStart(8), 'ratio'.padStart(8));
for (const [label, x0, y0, x1, y1] of boxes) {
  const mean = ({ data, info }) => {
    let sum = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * info.width + x) * info.channels;
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3; n++;
    }
    return sum / n / 255;
  };
  const b = mean(before), a = mean(after);
  console.log(label.padEnd(16), b.toFixed(4).padStart(8), a.toFixed(4).padStart(8), (a / b).toFixed(3).padStart(8));
}
